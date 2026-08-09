"""Workflow dataset registry — bundled ``ames`` + uploaded CSVs (workflow-architecture §2, §3.1).

Storage layout (§2.2; all paths derive from :mod:`ml.paths`, never hardcoded)::

    data/uploads/<dataset_id>/raw.csv       # verbatim uploaded bytes
    data/uploads/<dataset_id>/dataset.json  # the per-dataset registry record

There is **no central registry file** (§2.2): :func:`list_datasets` scans
``data/uploads/*/dataset.json`` and prepends the synthesized ``ames`` record.
Dataset ids are regex-validated (``^(ames|ds_[0-9a-f]{8})$``) and every path is
resolved with a containment check before any file touch (§4.9).

Upload validation (§2.3) accepts the **full Ames raw schema only** — the feature
pipeline needs the 81 Ames columns, so arbitrary CSVs are rejected with a
structured :class:`UploadReport` instead of fabricating features. Validation
wraps :func:`ml.data.validate.validate_raw`; because ``validate_raw`` raises on
the *first* violation while §2.3 requires *collected* violations plus named
missing columns and duplicate counts, the category/range rules are collected
per column from the same public rule tables (:data:`EXPECTED_CATEGORIES`,
:data:`NUMERIC_RANGES`) and ``validate_raw`` is run afterwards as the
authoritative final gate.

HTTP mapping contract for the service layer (WF-B3):

- :class:`UnknownDataset` -> 404
- :class:`CorruptUpload` -> 422 (``e.report.code`` is ``corrupt_csv`` or ``empty_file``)
- :class:`UploadValidationError` -> 422 (``e.report`` carries the structured checks)
- ``ValueError`` from :func:`delete_dataset` (bundled) -> 400
- :class:`DatasetBusyError` from :func:`delete_dataset` -> 409
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

import pandas as pd

from ml.data.ingest import RAW_TRAIN_CSV, load_raw_train
from ml.data.validate import (
    EXPECTED_CATEGORIES,
    NUMERIC_RANGES,
    RAW_COLUMNS,
    SchemaError,
    validate_raw,
)
from ml.paths import DATA_DIR, MODELS_DIR

logger = logging.getLogger(__name__)

__all__ = [
    "BUNDLED_DATASET_ID",
    "MAX_UPLOAD_ROWS",
    "UPLOADS_ROOT",
    "WORKFLOW_MODELS_ROOT",
    "CorruptUpload",
    "DatasetBusyError",
    "DatasetRecord",
    "UnknownDataset",
    "UploadReport",
    "UploadValidationError",
    "delete_dataset",
    "get_record",
    "list_datasets",
    "load_dataset_frame",
    "read_csv_bytes",
    "sandbox_dir",
    "save_upload",
    "upload_dir",
    "validate_upload",
]

#: The always-present, never-deletable bundled dataset (§2.1).
BUNDLED_DATASET_ID = "ames"

#: Upload row cap (§2.3): larger bodies get full EDA but cannot be trained on.
MAX_UPLOAD_ROWS = 20_000

#: Storage roots (§2.2). Module-level constants so tests can monkeypatch them
#: onto ``tmp_path`` — production code must never write outside these roots.
UPLOADS_ROOT = DATA_DIR / "uploads"
WORKFLOW_MODELS_ROOT = MODELS_DIR / "workflow"

#: §4.9 — dataset ids are regex-validated before any file touch.
_DATASET_ID_RE = re.compile(r"^(ames|ds_[0-9a-f]{8})$")

#: §4.9 — user filenames live only in ``dataset.json.name`` after sanitization.
_FILENAME_DISALLOWED = re.compile(r"[^A-Za-z0-9._-]+")

#: Upload extension whitelist (§2.3: CSV only — openpyxl is not installed).
_ALLOWED_SUFFIX = ".csv"

#: Job states that block dataset deletion (§2.3 lifecycle: 409 while running).
_BLOCKING_JOB_STATES = frozenset({"queued", "preparing", "running"})


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class UnknownDataset(Exception):
    """Unknown or malformed ``dataset_id`` -> HTTP 404."""


class CorruptUpload(ValueError):
    """The request body could not be decoded/parsed as CSV -> HTTP 422.

    Attributes:
        code: ``"corrupt_csv"`` (undecodable/unparseable/binary content) or
            ``"empty_file"`` (no data rows at all — pandas ``EmptyDataError``).
        parse_error: the underlying parser/decoder message.
        report: an :class:`UploadReport` with the failed ``parse`` check, so the
            service layer can handle this exactly like a validation failure.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str = "corrupt_csv",
        parse_error: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.parse_error = parse_error
        self.report = UploadReport(
            ok=False,
            checks=[
                {"code": "format", "status": "pass", "detail": "CSV filename/extension accepted"},
                {"code": "parse", "status": "fail", "detail": message},
            ],
            code=code,
            message=message,
            parse_error=parse_error,
        )


class UploadValidationError(ValueError):
    """A parsed upload failed the §2.3 ordered checks -> HTTP 422.

    Attributes:
        report: the structured :class:`UploadReport` (``code``, ``message``,
            ``missing_columns`` / ``n_duplicate_ids`` / ``violations`` …).
    """

    def __init__(self, report: "UploadReport") -> None:
        super().__init__(report.message or "upload validation failed")
        self.report = report


class DatasetBusyError(RuntimeError):
    """A running/queued job references the dataset -> HTTP 409."""


# ---------------------------------------------------------------------------
# Records & reports
# ---------------------------------------------------------------------------

@dataclass
class UploadReport:
    """Structured result of the §2.3 ordered upload checks.

    ``checks`` mirrors the §3.1 response shape: one entry per check with
    ``code`` ∈ ``format|parse|empty|row_cap|unique_id|schema|extra_columns|categories|ranges|cardinality``
    and ``status`` ∈ ``pass|warn|fail``. The failure-detail fields are only
    populated when ``ok`` is False (or, for ``parse_error``, on corrupt input).
    """

    ok: bool
    checks: list[dict[str, str]] = field(default_factory=list)
    code: str | None = None
    message: str | None = None
    missing_columns: list[str] = field(default_factory=list)
    n_duplicate_ids: int = 0
    duplicate_id_sample: list[int] = field(default_factory=list)
    violations: list[dict[str, Any]] = field(default_factory=list)
    parse_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe dict; optional detail keys appear only when populated."""
        payload: dict[str, Any] = {"ok": self.ok, "checks": self.checks}
        if self.code is not None:
            payload["code"] = self.code
        if self.message is not None:
            payload["message"] = self.message
        if self.missing_columns:
            payload["missing_columns"] = list(self.missing_columns)
        if self.n_duplicate_ids:
            payload["n_duplicate_ids"] = self.n_duplicate_ids
            payload["duplicate_id_sample"] = list(self.duplicate_id_sample)
        if self.violations:
            payload["violations"] = self.violations
        if self.parse_error is not None:
            payload["parse_error"] = self.parse_error
        return payload


@dataclass
class DatasetRecord:
    """One registry entry (§2.2 ``dataset.json`` + the derived ``deletable`` flag).

    Attributes:
        prepare: ``None`` until stage 06 persists
            ``{"config", "fingerprint", "prepared_at"}`` (§2.2, §3.8).
        validation: the :class:`UploadReport` from upload time — populated by
            :func:`save_upload` only, never persisted (§2.2 record shape).
    """

    dataset_id: str
    name: str
    source: str  # "bundled" | "upload"
    created_at: str
    sha256_12: str
    n_rows: int
    n_cols: int
    prepare: dict[str, Any] | None = None
    validation: UploadReport | None = None

    @property
    def deletable(self) -> bool:
        """Only uploads are deletable; the bundled dataset never is (§2.1)."""
        return self.source == "upload"

    def to_stored_dict(self) -> dict[str, Any]:
        """The exact §2.2 ``dataset.json`` shape (no derived fields)."""
        return {
            "dataset_id": self.dataset_id,
            "name": self.name,
            "source": self.source,
            "created_at": self.created_at,
            "sha256_12": self.sha256_12,
            "n_rows": self.n_rows,
            "n_cols": self.n_cols,
            "prepare": self.prepare,
        }

    def to_dict(self) -> dict[str, Any]:
        """API-facing dict: the stored shape plus ``deletable`` (§3.2)."""
        payload = self.to_stored_dict()
        payload["deletable"] = self.deletable
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "DatasetRecord":
        """Rebuild a record from a stored ``dataset.json`` mapping."""
        return cls(
            dataset_id=str(payload["dataset_id"]),
            name=str(payload["name"]),
            source=str(payload["source"]),
            created_at=str(payload["created_at"]),
            sha256_12=str(payload["sha256_12"]),
            n_rows=int(payload["n_rows"]),
            n_cols=int(payload["n_cols"]),
            prepare=payload.get("prepare"),
        )


# ---------------------------------------------------------------------------
# Paths & containment (§4.9)
# ---------------------------------------------------------------------------

def _check_dataset_id(dataset_id: str) -> None:
    """Validate the id against the §4.9 regex; raise :class:`UnknownDataset`."""
    if not isinstance(dataset_id, str) or not _DATASET_ID_RE.fullmatch(dataset_id):
        raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")


def _contained(root: Path, path: Path) -> Path:
    """Resolve ``path`` and assert it stays inside ``root`` (MECH §6 pattern)."""
    root_resolved = root.resolve()
    resolved = path.resolve()
    if os.path.commonpath([str(root_resolved), str(resolved)]) != str(root_resolved):
        raise UnknownDataset(f"dataset path escapes its sandbox root: {path}")
    return resolved


def upload_dir(dataset_id: str) -> Path:
    """The upload's storage directory ``data/uploads/<dataset_id>/`` (contained).

    Raises:
        UnknownDataset: for malformed ids and for ``"ames"`` (the bundled
            dataset has no upload directory — its data lives in
            ``data/raw/ames/`` and ``data/processed/``).
    """
    _check_dataset_id(dataset_id)
    if dataset_id == BUNDLED_DATASET_ID:
        raise UnknownDataset("the bundled 'ames' dataset has no upload directory")
    return _contained(UPLOADS_ROOT, UPLOADS_ROOT / dataset_id)


def sandbox_dir(dataset_id: str) -> Path:
    """The sandbox artifact root ``models/workflow/<dataset_id>/`` (contained).

    Everything the workflow writes under ``models/`` lives below this root
    (§4.1); ``"ames"`` is a valid sandbox id (§2.2: ``models/workflow/ames/``).
    """
    _check_dataset_id(dataset_id)
    return _contained(WORKFLOW_MODELS_ROOT, WORKFLOW_MODELS_ROOT / dataset_id)


def _record_path(dataset_id: str) -> Path:
    return upload_dir(dataset_id) / "dataset.json"


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    """Write JSON via a sibling temp file + ``os.replace`` (atomic registry writes)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Filename sanitization (§3.1 — werkzeug-free basename + allowlist)
# ---------------------------------------------------------------------------

def _safe_filename(filename: str | None) -> str:
    """Sanitize a user-supplied filename for storage in ``dataset.json.name``.

    Keeps only ``[A-Za-z0-9._-]`` after stripping any directory components;
    falls back to ``"upload.csv"`` when nothing usable remains. The stored
    file itself is always the server-generated ``raw.csv`` (§4.9).
    """
    name = (filename or "").strip() or "upload.csv"
    name = name.replace("\\", "/").rsplit("/", 1)[-1]  # basename, both separators
    name = _FILENAME_DISALLOWED.sub("_", name)
    if name in {"", ".", ".."}:
        name = "upload.csv"
    return name[:120]


# ---------------------------------------------------------------------------
# Parsing & validation (§2.3 ordered checks)
# ---------------------------------------------------------------------------

def read_csv_bytes(data: bytes) -> pd.DataFrame:
    """Decode (utf-8-sig) and parse a raw CSV body into a frame.

    Mirrors :func:`ml.data.ingest.load_raw_train`'s parsing of raw Ames CSVs
    (``Id`` pinned to int64, default NA handling) so an upload validates and
    later reloads identically. Note: ``keep_default_na=False`` would be wrong
    here — that flag is for the *processed* CSVs that store the literal string
    ``"None"``; raw uploads carry true empty cells that must become NaN for
    the category/range/missing machinery (validated against the bundled Ames
    CSV, which only parses to the documented 13,965 missing cells this way).

    Raises:
        CorruptUpload: on undecodable bytes, binary (NUL-containing) content,
            any parser exception (``code="corrupt_csv"``), or a body with no
            data rows at all (``code="empty_file"``, pandas ``EmptyDataError``).
    """
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CorruptUpload(
            "the request body is not valid UTF-8 text — upload a CSV file",
            parse_error=str(exc),
        ) from exc
    if "\x00" in text:
        raise CorruptUpload(
            "the request body contains NUL bytes — this is binary content, not a CSV file",
            parse_error="NUL byte in decoded text",
        )
    try:
        return pd.read_csv(StringIO(text), dtype={"Id": "int64"})
    except pd.errors.EmptyDataError as exc:
        raise CorruptUpload(
            "the file is empty — no CSV header or data rows could be parsed",
            code="empty_file",
            parse_error=str(exc),
        ) from exc
    except Exception as exc:  # parser errors, Id dtype coercion, … (§2.3: any exception)
        raise CorruptUpload(
            f"the body could not be parsed as CSV: {exc}",
            parse_error=str(exc),
        ) from exc


def _fail(
    checks: list[dict[str, str]],
    check_code: str,
    detail: str,
    report_code: str,
    **extra: Any,
) -> UploadReport:
    """Append a failed check and build the (not-ok) report."""
    checks.append({"code": check_code, "status": "fail", "detail": detail})
    return UploadReport(ok=False, checks=checks, code=report_code, message=detail, **extra)


def validate_upload(df: pd.DataFrame) -> UploadReport:
    """Run the §2.3 ordered validation checks on a parsed upload frame.

    Order (first failure wins): empty -> row cap -> unique ``Id`` -> 81-column
    schema -> category rules -> numeric ranges -> cardinality (warnings only).
    Extra columns past the 81-column schema earn a non-fatal ``extra_columns``
    warn row naming them (they are stored but ignored downstream).
    ``format``/``parse`` are reported as passing because a frame exists by the
    time this runs (:func:`read_csv_bytes` and the filename check gate those).
    Category/range violations are *collected* across all columns (§2.3), then
    :func:`ml.data.validate.validate_raw` runs as the authoritative final gate.
    """
    checks: list[dict[str, str]] = [
        {"code": "format", "status": "pass", "detail": "CSV filename/extension accepted"},
        {"code": "parse", "status": "pass", "detail": "body parsed as CSV (utf-8-sig)"},
    ]

    # 1) non-empty
    if len(df) == 0:
        return _fail(checks, "empty", "the CSV has a header but no data rows", "empty_file")
    checks.append({"code": "empty", "status": "pass", "detail": f"{len(df)} data rows"})

    # 2) row cap
    if len(df) > MAX_UPLOAD_ROWS:
        return _fail(
            checks,
            "row_cap",
            f"{len(df)} rows exceeds the {MAX_UPLOAD_ROWS}-row upload cap",
            "row_cap_exceeded",
        )
    checks.append(
        {"code": "row_cap", "status": "pass", "detail": f"{len(df)} <= {MAX_UPLOAD_ROWS} rows"}
    )

    # 3) unique Id
    if "Id" in df.columns:
        n_dupes = int(df["Id"].duplicated().sum())
        if n_dupes:
            sample = sorted(int(i) for i in df.loc[df["Id"].duplicated(), "Id"].head(10))
            return _fail(
                checks,
                "unique_id",
                f"{n_dupes} rows repeat an already-seen Id (e.g. {sample[:5]})",
                "duplicate_ids",
                n_duplicate_ids=n_dupes,
                duplicate_id_sample=sample,
            )
        checks.append(
            {"code": "unique_id", "status": "pass", "detail": "all Id values are unique"}
        )
    else:
        checks.append(
            {
                "code": "unique_id",
                "status": "pass",
                "detail": "n/a — the Id column is missing (reported by the schema check)",
            }
        )

    # 4) schema: all 81 raw Ames columns present (missing named, §3.1)
    missing = [c for c in RAW_COLUMNS if c not in df.columns]
    if missing:
        return _fail(
            checks,
            "schema",
            f"missing required Ames columns: {missing}",
            "schema_mismatch",
            missing_columns=missing,
        )
    checks.append(
        {"code": "schema", "status": "pass", "detail": f"all {len(RAW_COLUMNS)} Ames columns present"}
    )

    # 4b) extra columns (non-fatal, QA m4): tolerated by the pipeline but named
    #     so the user knows they are ignored (capped: first 10 + count).
    extra_columns = [c for c in df.columns if c not in RAW_COLUMNS]
    if extra_columns:
        shown = extra_columns[:10]
        detail = (
            f"{len(extra_columns)} extra column{'s' if len(extra_columns) != 1 else ''} "
            "not part of the Ames schema — stored but ignored by every stage: "
            + ", ".join(str(c) for c in shown)
        )
        if len(extra_columns) > len(shown):
            detail += f" …and {len(extra_columns) - len(shown)} more"
        checks.append({"code": "extra_columns", "status": "warn", "detail": detail})

    # 5) category rules (collected across columns; mirrors validate.py _check_categories)
    violations: list[dict[str, Any]] = []
    for col, allowed in EXPECTED_CATEGORIES.items():
        if col not in df.columns:
            continue
        unexpected = set(df[col].dropna().unique()) - allowed
        if unexpected:
            violations.append(
                {
                    "rule": "categories",
                    "column": col,
                    "unexpected": sorted(str(v) for v in unexpected),
                    "allowed": sorted(allowed),
                }
            )
    if violations:
        cols = [v["column"] for v in violations]
        return _fail(
            checks,
            "categories",
            f"unexpected categories in columns {cols}",
            "category_violations",
            violations=violations,
        )
    checks.append(
        {"code": "categories", "status": "pass", "detail": "category sets match the Ames schema"}
    )

    # 6) numeric ranges (collected; mirrors validate.py _check_ranges, coercion-safe)
    range_violations: list[dict[str, Any]] = []
    for col, (lo, hi) in NUMERIC_RANGES.items():
        if col not in df.columns:
            continue
        coerced = pd.to_numeric(df[col], errors="coerce")
        n_nonnumeric = int((coerced.isna() & df[col].notna()).sum())
        if n_nonnumeric:
            range_violations.append(
                {
                    "rule": "ranges",
                    "column": col,
                    "detail": f"{n_nonnumeric} non-numeric values in a numeric column",
                    "range": [lo, hi],
                }
            )
            continue
        values = coerced.dropna()
        bad = values[(values < lo) | (values > hi)]
        if len(bad):
            range_violations.append(
                {
                    "rule": "ranges",
                    "column": col,
                    "n_out_of_range": int(len(bad)),
                    "range": [lo, hi],
                    "example": float(bad.iloc[0]),
                }
            )
    if range_violations:
        cols = [v["column"] for v in range_violations]
        return _fail(
            checks,
            "ranges",
            f"values outside the documented Ames ranges in columns {cols}",
            "range_violations",
            violations=range_violations,
        )
    checks.append(
        {"code": "ranges", "status": "pass", "detail": "numeric values within documented ranges"}
    )

    # Authoritative final gate: validate_raw re-asserts columns/unique/categories/
    # ranges. It cannot fail after the checks above; a failure here is reported
    # as a violation rather than crashing the upload (defensive parity, §5.4).
    try:
        validate_raw(df)
    except SchemaError as exc:
        return _fail(
            checks,
            "ranges",
            f"validate_raw rejected the frame: {exc}",
            "range_violations",
            violations=[{"rule": "validate_raw", "detail": str(exc)}],
        )

    # 7) cardinality warnings (non-fatal, §2.3): constant columns; free-text
    #    columns where every row carries a different value (Id excepted).
    warnings: list[str] = []
    n_rows = len(df)
    for col in df.columns:
        n_unique = int(df[col].nunique(dropna=False))
        if n_unique == 1:
            warnings.append(f"column '{col}' is constant (1 unique value)")
        elif (
            col != "Id"
            and not pd.api.types.is_numeric_dtype(df[col])
            and n_unique == n_rows
        ):
            warnings.append(f"column '{col}' has a unique value per row (free text?)")
    if warnings:
        for warning in warnings:
            checks.append({"code": "cardinality", "status": "warn", "detail": warning})
    else:
        checks.append(
            {"code": "cardinality", "status": "pass", "detail": "no constant or free-text columns"}
        )

    return UploadReport(ok=True, checks=checks)


# ---------------------------------------------------------------------------
# Registry operations (§2.2/§2.3/§3.2)
# ---------------------------------------------------------------------------

def _ames_record() -> DatasetRecord:
    """Synthesize the bundled dataset's record (§2.2 — never stored on disk)."""
    frame = load_dataset_frame(BUNDLED_DATASET_ID)
    raw_path = RAW_TRAIN_CSV
    sha256_12 = hashlib.sha256(raw_path.read_bytes()).hexdigest()[:12]
    created_at = datetime.fromtimestamp(
        raw_path.stat().st_mtime, tz=timezone.utc
    ).isoformat(timespec="seconds")
    prepare = _load_prepare_meta(BUNDLED_DATASET_ID)
    return DatasetRecord(
        dataset_id=BUNDLED_DATASET_ID,
        name="Ames Housing (bundled)",
        source="bundled",
        created_at=created_at,
        sha256_12=sha256_12,
        n_rows=int(len(frame)),
        n_cols=int(frame.shape[1]),
        prepare=prepare,
    )


def _load_prepare_meta(dataset_id: str) -> dict[str, Any] | None:
    """Read the ``{"config","fingerprint","prepared_at"}`` block of the last prepare.

    For uploads this lives in ``dataset.json``; for ``ames`` it is recovered
    from the persisted prepare report under the sandbox root (the bundled
    dataset has no ``dataset.json``, §2.2). Returns ``None`` when never prepared.
    """
    if dataset_id == BUNDLED_DATASET_ID:
        report_path = sandbox_dir(dataset_id) / "prepare_report.json"
        if not report_path.exists():
            return None
        try:
            payload = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return {
            "config": payload.get("config"),
            "fingerprint": payload.get("fingerprint"),
            "prepared_at": payload.get("prepared_at"),
        }
    record_file = _record_path(dataset_id)
    if not record_file.exists():
        return None
    try:
        payload = json.loads(record_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload.get("prepare")


def save_upload(data: bytes, filename: str) -> DatasetRecord:
    """Validate and store an uploaded CSV (§3.1).

    Flow: sanitize filename -> extension whitelist -> :func:`read_csv_bytes`
    -> :func:`validate_upload` -> write ``raw.csv`` (verbatim bytes) +
    ``dataset.json`` (atomic) under ``data/uploads/ds_<uuid8>/``. Validation
    happens *before* any directory is created, and any mid-write failure
    removes the partial directory — a failed upload never leaves state behind
    (§2.3: "each failure deletes the stored file"; acceptance C2).

    Args:
        data: raw request body bytes (already size-capped by the transport).
        filename: user-supplied filename (sanitized; only ``.csv`` accepted).

    Returns:
        The stored :class:`DatasetRecord` with ``validation`` populated.

    Raises:
        UploadValidationError: extension or content validation failed (422).
        CorruptUpload: the body is not parseable CSV (422).
    """
    name = _safe_filename(filename)
    if not name.lower().endswith(_ALLOWED_SUFFIX):
        report = UploadReport(
            ok=False,
            checks=[
                {
                    "code": "format",
                    "status": "fail",
                    "detail": f"unsupported file extension in {name!r} — only .csv is accepted "
                    "(xlsx support is deliberately omitted: openpyxl is not installed)",
                }
            ],
            code="unsupported_format",
            message=f"unsupported file extension in {name!r} — only .csv is accepted",
        )
        raise UploadValidationError(report)

    df = read_csv_bytes(data)  # CorruptUpload propagates (before any state is written)
    report = validate_upload(df)
    if not report.ok:
        raise UploadValidationError(report)

    sha256_12 = hashlib.sha256(data).hexdigest()[:12]
    for _attempt in range(5):  # uuid8 collision insurance
        dataset_id = "ds_" + uuid.uuid4().hex[:8]
        target = upload_dir(dataset_id)
        if not target.exists():
            break
    else:  # pragma: no cover - astronomically unlikely
        raise RuntimeError("could not allocate a fresh dataset id")

    record = DatasetRecord(
        dataset_id=dataset_id,
        name=name,
        source="upload",
        created_at=_utc_now_iso(),
        sha256_12=sha256_12,
        n_rows=int(len(df)),
        n_cols=int(df.shape[1]),
        prepare=None,
        validation=report,
    )
    try:
        target.mkdir(parents=True, exist_ok=False)
        (target / "raw.csv").write_bytes(data)
        _write_json_atomic(_record_path(dataset_id), record.to_stored_dict())
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise
    logger.info("stored upload %s (%s): %d rows x %d cols", dataset_id, name, len(df), df.shape[1])
    return record


def load_dataset_frame(dataset_id: str) -> pd.DataFrame:
    """Load the raw frame: bundled Ames ``train.csv`` or the upload's ``raw.csv``.

    Uploads are re-parsed exactly as at upload time (``Id`` int64, default NA
    handling) so validation-time and serving-time frames are identical.
    """
    _check_dataset_id(dataset_id)
    if dataset_id == BUNDLED_DATASET_ID:
        return load_raw_train()
    raw_path = upload_dir(dataset_id) / "raw.csv"
    if not raw_path.exists():
        raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")
    return pd.read_csv(raw_path, dtype={"Id": "int64"})


def get_record(dataset_id: str) -> DatasetRecord:
    """Return the registry record for one dataset.

    Raises:
        UnknownDataset: malformed id, ``ames`` is always known, uploads must
            have a stored ``dataset.json`` (-> HTTP 404 otherwise).
    """
    _check_dataset_id(dataset_id)
    if dataset_id == BUNDLED_DATASET_ID:
        return _ames_record()
    record_file = _record_path(dataset_id)
    if not record_file.exists():
        raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")
    try:
        payload = json.loads(record_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UnknownDataset(
            f"dataset {dataset_id!r} has an unreadable registry record: {exc}"
        ) from exc
    return DatasetRecord.from_dict(payload)


def list_datasets() -> list[DatasetRecord]:
    """Scan ``data/uploads/*/dataset.json`` and prepend the synthesized ``ames`` record."""
    records = [_ames_record()]
    uploads: list[DatasetRecord] = []
    if UPLOADS_ROOT.exists():
        for child in sorted(UPLOADS_ROOT.iterdir()):
            if not child.is_dir():
                continue
            try:
                records_upload = get_record(child.name)
            except UnknownDataset:
                logger.warning("skipping malformed upload directory %s", child.name)
                continue
            uploads.append(records_upload)
    uploads.sort(key=lambda r: r.created_at, reverse=True)
    records.extend(uploads)
    return records


def delete_dataset(dataset_id: str) -> None:
    """Delete an upload's storage *and* sandbox directories (§2.3 lifecycle).

    Raises:
        ValueError: ``"The bundled dataset cannot be deleted"`` (-> HTTP 400).
        UnknownDataset: unknown upload id (-> HTTP 404).
        DatasetBusyError: a job status file under the sandbox root reports
            ``queued``/``preparing``/``running`` (-> HTTP 409; complements the
            API's in-memory single-job guard with on-disk truth).
    """
    _check_dataset_id(dataset_id)
    if dataset_id == BUNDLED_DATASET_ID:
        raise ValueError("The bundled dataset cannot be deleted")
    target = upload_dir(dataset_id)  # raises UnknownDataset for ames/bad ids
    if not target.exists():
        raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")

    sandbox = sandbox_dir(dataset_id)
    jobs_dir = sandbox / "jobs"
    if jobs_dir.exists():
        for status_file in sorted(jobs_dir.glob("*/status.json")):
            try:
                status = json.loads(status_file.read_text(encoding="utf-8")).get("status")
            except (OSError, json.JSONDecodeError):
                continue
            if status in _BLOCKING_JOB_STATES:
                raise DatasetBusyError(
                    f"dataset {dataset_id} has a {status} job "
                    f"({status_file.parent.name}) — wait for it to finish before deleting"
                )

    shutil.rmtree(target)
    shutil.rmtree(sandbox, ignore_errors=True)
    logger.info("deleted dataset %s (upload + sandbox directories)", dataset_id)
