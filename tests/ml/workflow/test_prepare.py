"""Split determinism + stage-06 prepare leakage invariants (§3.8/§4.6/§4.7, §8 matrix).

The leakage tests are the heart of WF-B1: they prove every fitted statistic
(neighborhood stats, feature defaults, cleaner imputations) comes from the
TRAIN split only. All writes go to ``tmp_path`` via monkeypatched storage
roots; the ames test additionally asserts the canonical artifacts under
``data/processed/`` and ``models/`` are untouched.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest
from pydantic import ValidationError

from ml.data.clean import fit_cleaner
from ml.data.ingest import RAW_TRAIN_CSV
from ml.features.defaults import compute_feature_defaults
from ml.features.pipeline import RAW_INPUT_COLUMNS
from ml.features.stats import fit_neighborhood_stats, load_neighborhood_stats
from ml.paths import MODELS_DIR, PROCESSED_DIR
from ml.workflow import datasets
from ml.workflow.datasets import UnknownDataset, save_upload, sandbox_dir, upload_dir
from ml.workflow.prepare import (
    MIN_TRAIN_ROWS,
    PrepareConfig,
    load_prepared_splits,
    prepare_dataset,
    preview_report,
)
from ml.workflow.split import resolve_strategy, split_dataset

#: 240 rows -> 168/36/36 at the default fractions; 168 >= MIN_TRAIN_ROWS.
_UPLOAD_ROWS = 240


@pytest.fixture()
def sandbox(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(datasets, "UPLOADS_ROOT", tmp_path / "uploads")
    monkeypatch.setattr(datasets, "WORKFLOW_MODELS_ROOT", tmp_path / "workflow_models")
    return tmp_path


@pytest.fixture()
def upload_id(sandbox: Path) -> str:
    data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode("utf-8")
    return save_upload(data, "slice.csv").dataset_id


def _toy_frame(n: int = 40, years: tuple[int, ...] = (2006, 2007)) -> pd.DataFrame:
    """Tiny synthetic frame — split needs no schema, only Id/YrSold/MoSold."""
    return pd.DataFrame(
        {
            "Id": range(1, n + 1),
            "YrSold": [years[i % len(years)] for i in range(n)],
            "MoSold": [i % 12 + 1 for i in range(n)],
        }
    )


# ---------------------------------------------------------------------------
# split_dataset (§3.8 step 1, §4.6 determinism)
# ---------------------------------------------------------------------------

class TestSplit:
    def test_auto_resolves_time_with_two_years(self) -> None:
        assert resolve_strategy(_toy_frame(), "auto") == "time"

    def test_auto_falls_back_to_random_for_single_year(self) -> None:
        assert resolve_strategy(_toy_frame(years=(2008,)), "auto") == "random"

    def test_explicit_time_requires_two_years(self) -> None:
        with pytest.raises(ValueError, match=">= 2 distinct sale years"):
            split_dataset(_toy_frame(years=(2008,)), "time")

    def test_unknown_strategy_rejected(self) -> None:
        with pytest.raises(ValueError, match="unknown split strategy"):
            split_dataset(_toy_frame(), "shuffle")

    def test_time_blocks_are_contiguous_and_deterministic(self) -> None:
        df = _toy_frame(40)
        first = split_dataset(df, "auto", 0.15, 0.15, 42)
        second = split_dataset(df, "auto", 0.15, 0.15, 42)
        for name in ("train", "val", "test"):
            assert first[name]["Id"].tolist() == second[name]["Id"].tolist()

        key = lambda f: list(zip(f["YrSold"], f["MoSold"], f["Id"]))  # noqa: E731
        assert max(key(first["train"])) < min(key(first["val"]))
        assert max(key(first["val"])) < min(key(first["test"]))

    def test_random_split_seeded_and_disjoint(self) -> None:
        df = _toy_frame(100)
        a = split_dataset(df, "random", 0.15, 0.15, 42)
        b = split_dataset(df, "random", 0.15, 0.15, 42)
        c = split_dataset(df, "random", 0.15, 0.15, 1)
        assert a["train"]["Id"].tolist() == b["train"]["Id"].tolist()
        assert a["train"]["Id"].tolist() != c["train"]["Id"].tolist()
        ids = [set(a[name]["Id"]) for name in ("train", "val", "test")]
        assert not (ids[0] & ids[1] or ids[0] & ids[2] or ids[1] & ids[2])
        assert sum(len(s) for s in ids) == 100

    def test_fractions_respected(self) -> None:
        df = _toy_frame(200)
        splits = split_dataset(df, "random", 0.2, 0.1, 42)
        assert (len(splits["train"]), len(splits["val"]), len(splits["test"])) == (140, 40, 20)


# ---------------------------------------------------------------------------
# PrepareConfig validation (§3.8: 422 bad config)
# ---------------------------------------------------------------------------

class TestPrepareConfig:
    def test_defaults(self) -> None:
        cfg = PrepareConfig()
        assert cfg.outlier_rule and cfg.split_strategy == "auto"
        assert (cfg.val_frac, cfg.test_frac, cfg.seed) == (0.15, 0.15, 42)

    def test_rejects_bad_strategy(self) -> None:
        with pytest.raises(ValidationError):
            PrepareConfig(split_strategy="shuffle")

    def test_rejects_extra_keys(self) -> None:
        with pytest.raises(ValidationError):
            PrepareConfig(unknown_field=True)

    def test_rejects_fractions_that_starve_train(self) -> None:
        with pytest.raises(ValidationError):
            PrepareConfig(val_frac=0.5, test_frac=0.45)


# ---------------------------------------------------------------------------
# prepare_dataset — upload path
# ---------------------------------------------------------------------------

class TestPrepareUpload:
    def test_end_to_end_payload(self, upload_id: str) -> None:
        report = prepare_dataset(upload_id, PrepareConfig())
        assert report.splits == {"train": 168, "val": 36, "test": 36, "rule": "time(YrSold)"}
        assert report.before == {"n_rows": 240, "n_cols": 81, "total_missing": report.before["total_missing"]}
        assert report.after["n_rows"] == 240
        assert report.after["n_cols"] == 85
        assert report.after["total_missing"] == 0
        assert [s["step"] for s in report.steps] == [
            "split", "outlier_rule", "clean", "sale_speed_target",
            "geo_join", "sandbox_stats", "features",
        ]
        sale_speed = next(s for s in report.steps if s["step"] == "sale_speed_target")
        assert sale_speed["provider"] == "simulated" and sale_speed["simulated"] is True
        features = next(s for s in report.steps if s["step"] == "features")
        assert (features["columns_before"], features["columns_after"]) == (85, 94)
        assert len(report.sample_before) == 5 and len(report.sample_after) == 5
        json.dumps(report.to_dict())  # payload must be JSON-serializable

    def test_persists_processed_splits_and_sandbox_artifacts(self, upload_id: str) -> None:
        prepare_dataset(upload_id, PrepareConfig())
        processed = upload_dir(upload_id) / "processed"
        assert sorted(p.name for p in processed.iterdir()) == ["test.csv", "train.csv", "val.csv"]
        sandbox = sandbox_dir(upload_id)
        assert sorted(p.name for p in sandbox.iterdir()) == [
            "feature_defaults.json", "neighborhood_stats.json", "prepare_report.json",
        ]
        stored = json.loads((upload_dir(upload_id) / "dataset.json").read_text())
        assert set(stored["prepare"]) == {"config", "fingerprint", "prepared_at"}

    def test_fingerprint_deterministic_per_config(self, upload_id: str) -> None:
        first = prepare_dataset(upload_id, PrepareConfig())
        second = prepare_dataset(upload_id, PrepareConfig())
        assert first.fingerprint == second.fingerprint
        other = prepare_dataset(upload_id, PrepareConfig(seed=1))
        assert other.fingerprint != first.fingerprint

    def test_preview_report_roundtrip(self, upload_id: str) -> None:
        assert preview_report(upload_id) is None
        report = prepare_dataset(upload_id, PrepareConfig())
        loaded = preview_report(upload_id)
        assert loaded is not None
        assert loaded.to_dict() == report.to_dict()

    def test_load_prepared_splits(self, upload_id: str) -> None:
        prepare_dataset(upload_id, PrepareConfig())
        splits = load_prepared_splits(upload_id)
        assert {k: len(v) for k, v in splits.items()} == {"train": 168, "val": 36, "test": 36}
        # processed contract: zero NaNs, absent features stored as literal "None"
        assert not splits["train"].isna().any().any()
        assert (splits["train"]["PoolQC"] == "None").any()
        assert set(splits["train"].columns) == set(splits["val"].columns)

    def test_load_prepared_splits_unprepared(self, upload_id: str) -> None:
        with pytest.raises(FileNotFoundError, match="not prepared"):
            load_prepared_splits(upload_id)
        with pytest.raises(UnknownDataset):
            load_prepared_splits("ds_00000000")

    def test_row_window_enforced(self, sandbox: Path) -> None:
        # 200 rows -> 140 post-split train rows < MIN_TRAIN_ROWS -> 400 upstream
        data = pd.read_csv(RAW_TRAIN_CSV).head(200).to_csv(index=False).encode("utf-8")
        dataset_id = save_upload(data, "small.csv").dataset_id
        with pytest.raises(ValueError, match=str(MIN_TRAIN_ROWS)):
            prepare_dataset(dataset_id, PrepareConfig())
        assert preview_report(dataset_id) is None

    def test_split_strategy_override_to_random(self, upload_id: str) -> None:
        report = prepare_dataset(upload_id, PrepareConfig(split_strategy="random", seed=7))
        assert report.splits["rule"] == "random(7)"


class TestLeakageInvariants:
    """§4.7: every fitted statistic is computed on the train split only."""

    def test_neighborhood_stats_equal_train_only_refit(self, upload_id: str) -> None:
        prepare_dataset(upload_id, PrepareConfig())
        train = load_prepared_splits(upload_id)["train"]
        expected = fit_neighborhood_stats(train)  # independent train-only refit
        artifact = load_neighborhood_stats(sandbox_dir(upload_id) / "neighborhood_stats.json")
        assert artifact.to_dict() == expected.to_dict()
        assert artifact.n_train_rows == len(train)

    def test_feature_defaults_equal_train_only_recompute(self, upload_id: str) -> None:
        prepare_dataset(upload_id, PrepareConfig())
        train = load_prepared_splits(upload_id)["train"]
        expected = compute_feature_defaults(train, RAW_INPUT_COLUMNS)
        stored = json.loads((sandbox_dir(upload_id) / "feature_defaults.json").read_text())
        assert stored["defaults"] == expected

    def test_cleaner_imputation_uses_train_medians(self, sandbox: Path) -> None:
        """Blank LotFrontage on the 40 newest rows (they land in val/test under
        the time split); every imputed value must equal the TRAIN neighborhood
        median (or the global train median fallback) — never val/test data."""
        raw = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS)
        newest_first = raw.sort_values(["YrSold", "MoSold", "Id"]).tail(40)
        raw.loc[newest_first.index, "LotFrontage"] = None
        assert raw["LotFrontage"].isna().sum() > 0
        dataset_id = save_upload(raw.to_csv(index=False).encode("utf-8"), "gappy.csv").dataset_id

        prepare_dataset(dataset_id, PrepareConfig())
        splits = load_prepared_splits(dataset_id)
        cleaner = fit_cleaner(splits["train"])  # independent train-only refit

        raw_by_id = raw.set_index("Id")
        checked = 0
        for name in ("val", "test"):
            for row in splits[name].itertuples():
                if pd.isna(raw_by_id.loc[row.Id, "LotFrontage"]):
                    expected = cleaner.lot_frontage_medians.get(
                        row.Neighborhood, cleaner.lot_frontage_global
                    )
                    assert float(row.LotFrontage) == pytest.approx(expected)
                    checked += 1
        assert checked > 0  # the crafted NaNs must actually land in val/test

    def test_val_test_ids_never_in_train(self, upload_id: str) -> None:
        prepare_dataset(upload_id, PrepareConfig())
        splits = load_prepared_splits(upload_id)
        train_ids = set(splits["train"]["Id"])
        assert not train_ids & set(splits["val"]["Id"])
        assert not train_ids & set(splits["test"]["Id"])


# ---------------------------------------------------------------------------
# prepare_dataset — bundled ames path (canonical splits used in place)
# ---------------------------------------------------------------------------

def _repo_artifact_hashes() -> dict[str, str]:
    paths = [
        PROCESSED_DIR / "train.csv",
        PROCESSED_DIR / "val.csv",
        PROCESSED_DIR / "test.csv",
        PROCESSED_DIR / "schema.json",
        PROCESSED_DIR / "outliers_report.json",
        MODELS_DIR / "neighborhood_stats.json",
        MODELS_DIR / "feature_defaults.json",
        MODELS_DIR / "champion.json",
    ]
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}


class TestPrepareAmes:
    def test_canonical_splits_used_in_place(self, sandbox: Path) -> None:
        report = prepare_dataset("ames", PrepareConfig())
        assert report.splits == {"train": 945, "val": 338, "test": 175, "rule": "time(YrSold)"}
        assert report.after == {"n_rows": 1458, "n_cols": 85, "total_missing": 0}
        assert report.before["n_rows"] == 1460 and report.before["n_cols"] == 81
        outlier = next(s for s in report.steps if s["step"] == "outlier_rule")
        assert outlier["rows_removed"] == 2
        sale_speed = next(s for s in report.steps if s["step"] == "sale_speed_target")
        assert sale_speed["provider"] == "simulated"
        loaded = preview_report("ames")
        assert loaded is not None and loaded.fingerprint == report.fingerprint

    def test_sandbox_stats_match_train_only_numbers(self, sandbox: Path) -> None:
        prepare_dataset("ames", PrepareConfig())
        artifact = load_neighborhood_stats(sandbox_dir("ames") / "neighborhood_stats.json")
        assert artifact.n_train_rows == 945
        # same train rows + same function as the champion artifact -> same numbers,
        # but written to the sandbox root, never the champion location (§4.1)
        champion = load_neighborhood_stats(MODELS_DIR / "neighborhood_stats.json")
        assert artifact.neighborhoods == champion.neighborhoods
        assert artifact.global_fallback == champion.global_fallback

    def test_repo_artifacts_untouched(self, sandbox: Path) -> None:
        before = _repo_artifact_hashes()
        prepare_dataset("ames", PrepareConfig())
        assert _repo_artifact_hashes() == before
