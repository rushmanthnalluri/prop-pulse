"""Upload validation + registry tests (workflow-architecture §2.3/§3.1/§3.2, §8 matrix).

Covers the acceptance-C2 rejection matrix (corrupt / empty / duplicate Ids /
schema / cardinality / row cap / extension), the registry lifecycle (list /
get / delete, bundled-delete semantics) and storage containment. All writes go
to ``tmp_path`` via monkeypatched storage roots — the real ``data/uploads``
and ``models/workflow`` are never touched.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest

from ml.data.ingest import RAW_TRAIN_CSV
from ml.workflow import datasets
from ml.workflow.datasets import (
    CorruptUpload,
    DatasetBusyError,
    UnknownDataset,
    UploadValidationError,
    delete_dataset,
    get_record,
    list_datasets,
    load_dataset_frame,
    read_csv_bytes,
    save_upload,
    validate_upload,
)

#: A small, schema-valid upload built from a slice of the real raw Ames CSV
#: (read-only; guarantees the 81-column contract without hand-fabricating one).
_SLICE_ROWS = 60


def _ames_csv_bytes(n: int = _SLICE_ROWS) -> bytes:
    return pd.read_csv(RAW_TRAIN_CSV).head(n).to_csv(index=False).encode("utf-8")


@pytest.fixture()
def csv_bytes() -> bytes:
    return _ames_csv_bytes()


@pytest.fixture()
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect upload/sandbox storage roots onto tmp_path for one test."""
    monkeypatch.setattr(datasets, "UPLOADS_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(datasets, "WORKFLOW_MODELS_ROOT", tmp_path / "workflow_models")
    return tmp_path


# ---------------------------------------------------------------------------
# read_csv_bytes — parsing boundary (§3.1)
# ---------------------------------------------------------------------------

class TestReadCsvBytes:
    def test_roundtrip(self, csv_bytes: bytes) -> None:
        df = read_csv_bytes(csv_bytes)
        assert df.shape == (_SLICE_ROWS, 81)
        assert pd.api.types.is_integer_dtype(df["Id"])

    def test_utf8_sig_bom(self, csv_bytes: bytes) -> None:
        df = read_csv_bytes(b"\xef\xbb\xbf" + csv_bytes)
        assert list(df.columns)[0] == "Id"  # BOM stripped, not glued to the header

    def test_nul_bytes_are_corrupt(self) -> None:
        with pytest.raises(CorruptUpload) as excinfo:
            read_csv_bytes(b"not,a,csv\x00\x01")
        assert excinfo.value.code == "corrupt_csv"
        assert excinfo.value.report.ok is False

    def test_empty_body_is_empty_file(self) -> None:
        with pytest.raises(CorruptUpload) as excinfo:
            read_csv_bytes(b"")
        assert excinfo.value.code == "empty_file"

    def test_non_utf8_is_corrupt(self) -> None:
        with pytest.raises(CorruptUpload) as excinfo:
            read_csv_bytes(b"\xff\xfe\x00\x01")
        assert excinfo.value.code == "corrupt_csv"
        assert excinfo.value.parse_error is not None


# ---------------------------------------------------------------------------
# validate_upload — the ordered §2.3 checks
# ---------------------------------------------------------------------------

class TestValidateUpload:
    def test_valid_frame_passes_all_checks(self) -> None:
        # the full bundled CSV: 1460 rows, no cardinality warnings (acceptance C1)
        df = read_csv_bytes(RAW_TRAIN_CSV.read_bytes())
        report = validate_upload(df)
        assert report.ok
        codes = {c["code"]: c["status"] for c in report.checks}
        assert codes == {
            "format": "pass",
            "parse": "pass",
            "empty": "pass",
            "row_cap": "pass",
            "unique_id": "pass",
            "schema": "pass",
            "categories": "pass",
            "ranges": "pass",
            "cardinality": "pass",
        }

    def test_header_only_is_empty_file(self, csv_bytes: bytes) -> None:
        header = csv_bytes.split(b"\n", 1)[0] + b"\n"
        report = validate_upload(read_csv_bytes(header))
        assert not report.ok
        assert report.code == "empty_file"

    def test_row_cap(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(100)
        tiled = pd.concat(
            [base.assign(Id=range(i * 100 + 1, i * 100 + 101)) for i in range(201)],
            ignore_index=True,
        )
        assert len(tiled) == 20_100
        report = validate_upload(tiled)
        assert not report.ok
        assert report.code == "row_cap_exceeded"
        assert report.checks[-1]["code"] == "row_cap"

    def test_duplicate_ids_named_with_count(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(50)
        dup = pd.concat([base, base.head(10)], ignore_index=True)
        report = validate_upload(dup)
        assert not report.ok
        assert report.code == "duplicate_ids"
        assert report.n_duplicate_ids == 10
        assert report.duplicate_id_sample == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    def test_schema_mismatch_names_missing_columns(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(20).drop(columns=["SalePrice"])
        report = validate_upload(base)
        assert not report.ok
        assert report.code == "schema_mismatch"
        assert report.missing_columns == ["SalePrice"]
        assert "SalePrice" in report.message

    def test_category_violations_collected(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(20)
        base.loc[0, "MSZoning"] = "XX"
        base.loc[1, "SaleCondition"] = "YY"
        report = validate_upload(base)
        assert not report.ok
        assert report.code == "category_violations"
        assert {v["column"] for v in report.violations} == {"MSZoning", "SaleCondition"}

    def test_range_violations_collected(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(20)
        base.loc[0, "SalePrice"] = 5  # below the documented 10_000 floor
        report = validate_upload(base)
        assert not report.ok
        assert report.code == "range_violations"
        assert report.violations[0]["column"] == "SalePrice"
        assert report.violations[0]["n_out_of_range"] == 1

    def test_cardinality_warnings_are_non_fatal(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(30)
        base["Exterior1st"] = [f"material-{i}" for i in range(len(base))]  # free text
        report = validate_upload(base)
        assert report.ok
        warns = [c for c in report.checks if c["status"] == "warn"]
        assert any("Exterior1st" in c["detail"] and "unique value per row" in c["detail"] for c in warns)

    def test_constant_column_warns(self) -> None:
        base = pd.read_csv(RAW_TRAIN_CSV).head(30)
        base["Street"] = "Pave"
        report = validate_upload(base)
        assert report.ok
        warns = [c for c in report.checks if c["status"] == "warn"]
        assert any("Street" in c["detail"] and "constant" in c["detail"] for c in warns)

    def test_extra_columns_warn_and_are_named(self) -> None:
        """An 82-column upload passes, disclosing the ignored extras (QA m4)."""
        base = pd.read_csv(RAW_TRAIN_CSV).head(30)
        base["BogusColumn"] = range(len(base))
        report = validate_upload(base)
        assert report.ok
        extra = [c for c in report.checks if c["code"] == "extra_columns"]
        assert len(extra) == 1
        assert extra[0]["status"] == "warn"
        assert "BogusColumn" in extra[0]["detail"]
        assert "ignored" in extra[0]["detail"]

    def test_extra_columns_list_is_capped(self) -> None:
        """More than 10 extras are truncated to the first 10 names + a count."""
        base = pd.read_csv(RAW_TRAIN_CSV).head(30)
        for i in range(12):
            base[f"Extra{i:02d}"] = 1
        report = validate_upload(base)
        assert report.ok
        (extra,) = [c for c in report.checks if c["code"] == "extra_columns"]
        assert "Extra09" in extra["detail"]
        assert "Extra10" not in extra["detail"]
        assert "12 extra columns" in extra["detail"]
        assert "…and 2 more" in extra["detail"]

    def test_no_extra_columns_no_check_row(self) -> None:
        """An exact-schema upload earns no extra_columns row at all."""
        base = pd.read_csv(RAW_TRAIN_CSV).head(30)
        report = validate_upload(base)
        assert report.ok
        assert all(c["code"] != "extra_columns" for c in report.checks)


# ---------------------------------------------------------------------------
# save_upload / registry lifecycle (§2.2/§3.2)
# ---------------------------------------------------------------------------

class TestSaveUpload:
    def test_happy_path(self, sandbox: Path, csv_bytes: bytes) -> None:
        record = save_upload(csv_bytes, "My Houses.csv")
        assert record.dataset_id.startswith("ds_")
        assert len(record.dataset_id) == 11
        assert record.name == "My_Houses.csv"  # sanitized (§4.9)
        assert record.source == "upload"
        assert record.deletable
        assert record.n_rows == _SLICE_ROWS
        assert record.n_cols == 81
        assert record.sha256_12 == hashlib.sha256(csv_bytes).hexdigest()[:12]
        assert record.validation is not None and record.validation.ok
        assert record.prepare is None

        root = datasets.upload_dir(record.dataset_id)
        assert (root / "raw.csv").read_bytes() == csv_bytes  # verbatim bytes
        stored = json.loads((root / "dataset.json").read_text())
        assert set(stored) == {
            "dataset_id", "name", "source", "created_at",
            "sha256_12", "n_rows", "n_cols", "prepare",
        }  # exact §2.2 shape

    def test_xlsx_extension_rejected(self, sandbox: Path, csv_bytes: bytes) -> None:
        with pytest.raises(UploadValidationError) as excinfo:
            save_upload(csv_bytes, "houses.xlsx")
        assert excinfo.value.report.code == "unsupported_format"
        assert not datasets.UPLOADS_ROOT.exists() or not list(datasets.UPLOADS_ROOT.iterdir())

    @pytest.mark.parametrize(
        "payload",
        [
            b"not,a,csv\x00\x01",  # corrupt
            b"",  # empty
        ],
        ids=["corrupt", "empty"],
    )
    def test_failures_leave_no_directory(self, sandbox: Path, payload: bytes) -> None:
        with pytest.raises(CorruptUpload):
            save_upload(payload, "bad.csv")
        assert not datasets.UPLOADS_ROOT.exists() or not list(datasets.UPLOADS_ROOT.iterdir())

    def test_validation_failure_leaves_no_directory(self, sandbox: Path) -> None:
        bad = pd.read_csv(RAW_TRAIN_CSV).head(20).drop(columns=["SalePrice"])
        with pytest.raises(UploadValidationError) as excinfo:
            save_upload(bad.to_csv(index=False).encode("utf-8"), "broken.csv")
        assert excinfo.value.report.code == "schema_mismatch"
        assert not datasets.UPLOADS_ROOT.exists() or not list(datasets.UPLOADS_ROOT.iterdir())


class TestRegistry:
    def test_bundled_record(self) -> None:
        record = get_record("ames")
        assert record.dataset_id == "ames"
        assert record.source == "bundled"
        assert not record.deletable
        assert (record.n_rows, record.n_cols) == (1460, 81)
        assert record.prepare is None or set(record.prepare) == {
            "config", "fingerprint", "prepared_at",
        }

    def test_list_prepends_ames(self, sandbox: Path, csv_bytes: bytes) -> None:
        saved = save_upload(csv_bytes, "a.csv")
        records = list_datasets()
        assert records[0].dataset_id == "ames"
        assert records[0].source == "bundled"
        assert [r.dataset_id for r in records[1:]] == [saved.dataset_id]

    def test_get_unknown_and_malformed_ids(self, sandbox: Path) -> None:
        for bad in ("ds_00000000", "nope", "ds_XYZ12345", "../ames", "ames "):
            with pytest.raises(UnknownDataset):
                get_record(bad)

    def test_containment_guard(self, sandbox: Path) -> None:
        with pytest.raises(UnknownDataset):
            datasets.upload_dir("ds_..%2f..")  # fails the id regex before any fs touch

    def test_load_dataset_frame(self, sandbox: Path, csv_bytes: bytes) -> None:
        saved = save_upload(csv_bytes, "a.csv")
        frame = load_dataset_frame(saved.dataset_id)
        assert frame.shape == (_SLICE_ROWS, 81)
        assert frame["Id"].tolist() == list(range(1, _SLICE_ROWS + 1))
        ames = load_dataset_frame("ames")
        assert ames.shape == (1460, 81)

    def test_delete_upload_removes_both_directories(self, sandbox: Path, csv_bytes: bytes) -> None:
        saved = save_upload(csv_bytes, "a.csv")
        sandbox_dir = datasets.sandbox_dir(saved.dataset_id)
        (sandbox_dir / "jobs").mkdir(parents=True)
        delete_dataset(saved.dataset_id)
        assert not datasets.upload_dir(saved.dataset_id).exists()
        assert not sandbox_dir.exists()
        assert saved.dataset_id not in {r.dataset_id for r in list_datasets()}
        with pytest.raises(UnknownDataset):
            delete_dataset(saved.dataset_id)

    def test_delete_bundled_raises_spec_message(self) -> None:
        with pytest.raises(ValueError, match="^The bundled dataset cannot be deleted$"):
            delete_dataset("ames")

    def test_delete_blocked_by_running_job(self, sandbox: Path, csv_bytes: bytes) -> None:
        saved = save_upload(csv_bytes, "a.csv")
        job_dir = datasets.sandbox_dir(saved.dataset_id) / "jobs" / "job_deadbeef"
        job_dir.mkdir(parents=True)
        (job_dir / "status.json").write_text(json.dumps({"status": "running"}))
        with pytest.raises(DatasetBusyError):
            delete_dataset(saved.dataset_id)
        # a finished job does not block deletion
        (job_dir / "status.json").write_text(json.dumps({"status": "done"}))
        delete_dataset(saved.dataset_id)
        assert not datasets.upload_dir(saved.dataset_id).exists()
