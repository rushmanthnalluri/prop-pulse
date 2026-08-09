"""Leakage-safe preprocessing preview + train preparation (workflow-architecture §3.8, §4).

Stage 06 runs the real offline chain — same functions, same call discipline as
:func:`ml.data.pipeline.run_pipeline` (§5.4 reuse checklist):

1. split (:func:`ml.workflow.split.split_dataset`) — uploads only; the bundled
   ``ames`` dataset's canonical ``data/processed`` splits are used in place;
2. outlier rule on TRAIN only (:func:`ml.data.outliers.apply_outlier_rules`);
3. :func:`ml.data.clean.fit_cleaner` on train -> :func:`apply_cleaner` per split;
4. :class:`ml.data.sale_speed.SaleSpeedSimulator` ``.fit(train)`` ->
   :func:`attach_sale_speed` per split (SIMULATED target, labelled everywhere);
5. :func:`ml.data.pipeline.join_neighborhood_geo` per split;
6. refit train-only artifacts into the sandbox root (§4.1):
   :func:`ml.features.stats.fit_neighborhood_stats` and
   :func:`ml.features.defaults.compute_feature_defaults` — written to
   ``models/workflow/<dataset_id>/``, never the champion locations;
7. :func:`ml.features.pipeline.build_feature_frame` with the *sandbox* stats
   passed explicitly (``stats=None`` would load the champion artifact).

Leakage invariant (§4.7): every fitted statistic — outlier rule, cleaner, DOM
simulator, neighborhood stats, feature defaults — is fit on the sandbox train
split only; val/test are transformed with frozen statistics.

Persistence (§2.2/§3.8): uploads get ``data/uploads/<id>/processed/{train,val,
test}.csv``; every dataset gets ``models/workflow/<id>/{neighborhood_stats.json,
feature_defaults.json, prepare_report.json}``; the upload's ``dataset.json``
``prepare`` block is updated atomically. ``data/processed/`` and the champion
artifacts are never written.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ml.data.clean import apply_cleaner, fit_cleaner
from ml.data.ingest import load_neighborhood_geo, load_raw_train
from ml.data.outliers import apply_outlier_rules
from ml.data.pipeline import join_neighborhood_geo
from ml.data.sale_speed import SaleSpeedSimulator, attach_sale_speed
from ml.data.validate import validate_processed
from ml.features.defaults import compute_feature_defaults, save_feature_defaults
from ml.features.pipeline import MODEL_FEATURES, RAW_INPUT_COLUMNS, build_feature_frame
from ml.features.stats import fit_neighborhood_stats, save_neighborhood_stats
from ml.paths import PROCESSED_DIR, RANDOM_SEED, REPO_ROOT
from ml.workflow.datasets import (
    BUNDLED_DATASET_ID,
    DatasetRecord,
    UnknownDataset,
    _write_json_atomic,
    get_record,
    load_dataset_frame,
    sandbox_dir,
    upload_dir,
)
from ml.workflow.split import resolve_strategy, split_dataset

logger = logging.getLogger(__name__)

__all__ = [
    "LEAKAGE_NOTE",
    "MIN_TRAIN_ROWS",
    "PrepareConfig",
    "PrepareReport",
    "load_prepared_splits",
    "prepare_dataset",
    "preview_report",
]

#: Training requires at least this many post-split train rows (§2.3 row window).
MIN_TRAIN_ROWS = 150

#: Rendered verbatim by the stage-06 UI (§6.3-06 leakage guarantee line).
LEAKAGE_NOTE = (
    "Every statistic was fit on the training rows only — validation and test "
    "rows are transformed with frozen values."
)

#: The 8 recognizable columns shown in the before/after sample panels (§3.8).
_SAMPLE_COLUMNS: list[str] = [
    "Id", "Neighborhood", "LotFrontage", "OverallQual",
    "GrLivArea", "YrSold", "MoSold", "SalePrice",
]

_PREPARE_REPORT_NAME = "prepare_report.json"


# ---------------------------------------------------------------------------
# Config & report
# ---------------------------------------------------------------------------

class PrepareConfig(BaseModel):
    """Stage-06 preprocessing configuration (§3.8 preview request body)."""

    model_config = ConfigDict(extra="forbid")

    outlier_rule: bool = True
    split_strategy: Literal["auto", "time", "random"] = "auto"
    val_frac: float = Field(default=0.15, gt=0.0, lt=1.0)
    test_frac: float = Field(default=0.15, gt=0.0, lt=1.0)
    seed: int = Field(default=RANDOM_SEED, ge=0)

    @model_validator(mode="after")
    def _fractions_leave_a_train_split(self) -> "PrepareConfig":
        if self.val_frac + self.test_frac >= 0.9:
            raise ValueError(
                f"val_frac + test_frac must leave >= 10% train rows, got "
                f"{self.val_frac} + {self.test_frac}"
            )
        return self


@dataclass
class PrepareReport:
    """The persisted result of stage 06 (§3.8 response payload).

    Attributes:
        splits: ``{"train", "val", "test", "rule"}`` — post-outlier row counts
            plus ``"time(YrSold)"`` / ``"random(<seed>)"``.
        steps: per-step detail entries (split, outlier_rule, clean,
            sale_speed_target, geo_join, sandbox_stats, features).
        before/after: ``{n_rows, n_cols, total_missing}`` of the raw frame vs
            the persisted processed splits (``after.total_missing`` is 0 —
            :func:`apply_cleaner` raises otherwise).
        sample_before/sample_after: 5 rows x the 8 key columns, JSON-safe.
    """

    dataset_id: str
    config: dict[str, Any]
    fingerprint: str
    prepared_at: str
    splits: dict[str, Any]
    steps: list[dict[str, Any]]
    before: dict[str, Any]
    after: dict[str, Any]
    sample_before: list[dict[str, Any]] = field(default_factory=list)
    sample_after: list[dict[str, Any]] = field(default_factory=list)
    leakage_note: str = LEAKAGE_NOTE

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe dict (the ``prepare_report.json`` on-disk shape)."""
        return {
            "dataset_id": self.dataset_id,
            "config": self.config,
            "fingerprint": self.fingerprint,
            "prepared_at": self.prepared_at,
            "splits": self.splits,
            "steps": self.steps,
            "before": self.before,
            "after": self.after,
            "sample_before": self.sample_before,
            "sample_after": self.sample_after,
            "leakage_note": self.leakage_note,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "PrepareReport":
        """Rebuild a report from the persisted ``prepare_report.json`` mapping."""
        return cls(
            dataset_id=str(payload["dataset_id"]),
            config=dict(payload["config"]),
            fingerprint=str(payload["fingerprint"]),
            prepared_at=str(payload["prepared_at"]),
            splits=dict(payload["splits"]),
            steps=list(payload["steps"]),
            before=dict(payload["before"]),
            after=dict(payload["after"]),
            sample_before=list(payload.get("sample_before", [])),
            sample_after=list(payload.get("sample_after", [])),
            leakage_note=str(payload.get("leakage_note", LEAKAGE_NOTE)),
        )


# ---------------------------------------------------------------------------
# Small JSON-safety helpers (numpy scalars / NaN are not JSON-serializable)
# ---------------------------------------------------------------------------

def _json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    if hasattr(value, "item"):  # numpy / pandas scalar
        try:
            return _json_value(value.item())
        except (ValueError, AttributeError):
            pass
    return value if isinstance(value, (str, int, float, bool)) else str(value)


def _sample_records(df: pd.DataFrame, n: int = 5) -> list[dict[str, Any]]:
    """First ``n`` rows x :data:`_SAMPLE_COLUMNS`, as JSON-safe records."""
    cols = [c for c in _SAMPLE_COLUMNS if c in df.columns]
    return [
        {str(k): _json_value(v) for k, v in row.items()}
        for row in df[cols].head(n).to_dict("records")
    ]


def _frame_summary(df: pd.DataFrame) -> dict[str, Any]:
    return {
        "n_rows": int(len(df)),
        "n_cols": int(df.shape[1]),
        "total_missing": int(df.isna().sum().sum()),
    }


def _rel(path: Path) -> str:
    """Repo-relative path for payloads (absolute fallback for redirected roots)."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _fingerprint(config: PrepareConfig, sha256_12: str) -> str:
    """``sha1`` of canonical config JSON + the dataset content hash (§2.2)."""
    canonical = json.dumps(config.model_dump(), sort_keys=True)
    return hashlib.sha1(f"{canonical}|{sha256_12}".encode("utf-8")).hexdigest()


def _rule_label(resolved_strategy: str, seed: int) -> str:
    return "time(YrSold)" if resolved_strategy == "time" else f"random({seed})"


def _persist_report(report: PrepareReport) -> Path:
    path = sandbox_dir(report.dataset_id) / _PREPARE_REPORT_NAME
    _write_json_atomic(path, report.to_dict())
    return path


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def prepare_dataset(dataset_id: str, config: PrepareConfig) -> PrepareReport:
    """Run stage 06 and persist its outputs (§3.8 steps 1–7).

    Uploads run the full chain; the bundled ``ames`` dataset uses its canonical
    ``data/processed`` splits in place (§3.8) and only refits the train-only
    sandbox artifacts + builds the report. Either way the report is persisted
    to ``models/workflow/<dataset_id>/prepare_report.json`` and returned.

    Raises:
        UnknownDataset: unknown id (-> 404).
        ValueError: post-split train rows outside the §2.3 window
            (>= :data:`MIN_TRAIN_ROWS`) or an unsplittable config for this data
            (-> 400); also propagates ``ValueError`` from ``apply_cleaner``
            when the raw data carries NAs with no documented policy (the stage
            04 ``blocking`` case -> 400 with the cleaner's message).
    """
    record = get_record(dataset_id)  # raises UnknownDataset
    if dataset_id == BUNDLED_DATASET_ID:
        return _prepare_ames(record, config)
    return _prepare_upload(record, config)


def preview_report(dataset_id: str) -> PrepareReport | None:
    """Return the last persisted :class:`PrepareReport`, or ``None`` if never prepared.

    Raises:
        UnknownDataset: unknown id (-> 404).
    """
    if dataset_id != BUNDLED_DATASET_ID:
        if not upload_dir(dataset_id).exists():  # also regex-validates the id
            raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")
    report_path = sandbox_dir(dataset_id) / _PREPARE_REPORT_NAME
    if not report_path.exists():
        return None
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    return PrepareReport.from_dict(payload)


def load_prepared_splits(dataset_id: str) -> dict[str, pd.DataFrame]:
    """Load the persisted processed splits ``{"train", "val", "test"}``.

    Reads ``data/processed/*.csv`` in place for ``ames`` (§3.8) and
    ``data/uploads/<id>/processed/*.csv`` for uploads; both with
    ``keep_default_na=False`` (absent features are stored as the literal
    string ``"None"``). This is the per-dataset replacement for
    ``ml.training.common.load_split`` (fixed ``PROCESSED_DIR``; §5.4 NOT-used list).

    Raises:
        UnknownDataset: unknown id (-> 404).
        FileNotFoundError: the dataset has not been prepared yet — the job
            runner auto-prepares with the default config in this case (§3.9).
    """
    if dataset_id == BUNDLED_DATASET_ID:
        base = PROCESSED_DIR
        hint = "run `python -m ml.data.pipeline` first"
    else:
        root = upload_dir(dataset_id)  # regex-validates the id (§4.9)
        if not root.exists():
            raise UnknownDataset(f"unknown dataset id: {dataset_id!r}")
        base = root / "processed"
        hint = "run stage 06 (POST preprocess/preview) first; jobs auto-prepare (§3.9)"
    splits: dict[str, pd.DataFrame] = {}
    for name in ("train", "val", "test"):
        path = base / f"{name}.csv"
        if not path.exists():
            raise FileNotFoundError(
                f"prepared split not found: {path} — dataset {dataset_id!r} is not prepared; {hint}"
            )
        splits[name] = pd.read_csv(path, keep_default_na=False)
    return splits


# ---------------------------------------------------------------------------
# Upload path — full chain (§3.8 steps 1–7)
# ---------------------------------------------------------------------------

def _prepare_upload(record: DatasetRecord, config: PrepareConfig) -> PrepareReport:
    raw = load_dataset_frame(record.dataset_id)
    before = _frame_summary(raw)
    steps: list[dict[str, Any]] = []

    # 1) split
    resolved = resolve_strategy(raw, config.split_strategy)
    rule = _rule_label(resolved, config.seed)
    splits = split_dataset(
        raw, config.split_strategy, config.val_frac, config.test_frac, config.seed
    )
    steps.append(
        {
            "step": "split",
            "strategy_requested": config.split_strategy,
            "rule": rule,
            "train": int(len(splits["train"])),
            "val": int(len(splits["val"])),
            "test": int(len(splits["test"])),
        }
    )

    # 2) outlier rule (train only)
    if config.outlier_rule:
        trimmed, outlier_report = apply_outlier_rules(splits["train"])
        splits["train"] = trimmed
        partial = outlier_report["partial_sale_grlivarea_gt_4000"]
        steps.append(
            {
                "step": "outlier_rule",
                "enabled": True,
                "rows_removed": int(partial["n_removed"]),
                "removed_ids": list(partial["removed_ids"]),
                "applied_to": "train split only",
            }
        )
    else:
        steps.append(
            {"step": "outlier_rule", "enabled": False, "rows_removed": 0, "removed_ids": []}
        )

    # Row window (§2.3/§3.8: 400 when post-split train rows are out of window)
    n_train = len(splits["train"])
    if n_train < MIN_TRAIN_ROWS:
        raise ValueError(
            f"post-split train split has {n_train} rows; training and preprocessing "
            f"require >= {MIN_TRAIN_ROWS} (dataset has {len(raw)} rows total — "
            "the 01–05 exploration stages remain available)"
        )

    # 3) clean (fit on train only)
    na_filled = {
        str(col): int(n) for col, n in raw.isna().sum().items() if int(n) > 0
    }
    cleaner = fit_cleaner(splits["train"])
    splits = {name: apply_cleaner(df, cleaner) for name, df in splits.items()}
    steps.append(
        {
            "step": "clean",
            "fit_on": "train split only",
            "total_na_filled": int(sum(na_filled.values())),
            "na_filled_by_column": na_filled,
        }
    )

    # 4) SIMULATED sale-speed target (fit on train only)
    simulator = SaleSpeedSimulator(seed=RANDOM_SEED).fit(splits["train"])
    splits = {name: attach_sale_speed(df, simulator) for name, df in splits.items()}
    steps.append(
        {
            "step": "sale_speed_target",
            "provider": "simulated",
            "simulated": True,
            "fit_on": "train split only",
            "positive_rate_train": round(float(splits["train"]["sells_within_30_days"].mean()), 4),
            "positive_rate_val": round(float(splits["val"]["sells_within_30_days"].mean()), 4),
            "positive_rate_test": round(float(splits["test"]["sells_within_30_days"].mean()), 4),
            "note": "SIMULATED target (ADR-3) — seeded days-on-market simulation; "
            "not a real-world performance claim",
        }
    )

    # 5) geo join (approximate centroids, ADR-2)
    geo = load_neighborhood_geo()
    splits = {name: join_neighborhood_geo(df, geo) for name, df in splits.items()}
    steps.append(
        {
            "step": "geo_join",
            "neighborhoods_mapped": int(
                pd.concat(splits.values())["Neighborhood"].nunique()
            ),
            "note": "approximate neighborhood centroids (data/external/neighborhood_geo.csv, ADR-2)",
        }
    )

    # Safety net identical to the offline pipeline (ml/data/pipeline.py step 7).
    for name, df in splits.items():
        validate_processed(df, name)

    # Persist processed splits (§2.2) — the uploaded bytes stay untouched.
    processed_dir = upload_dir(record.dataset_id) / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    for name, df in splits.items():
        df.to_csv(processed_dir / f"{name}.csv", index=False)

    # Artifacts are fit on the CSV-round-tripped train frame — the exact call
    # discipline of the offline pipeline (ml/features/pipeline.py main reads
    # data/processed/train.csv back), so e.g. MSSubClass re-infers to int64 and
    # its default is the train median, matching the champion convention (AUD-13).
    train = pd.read_csv(processed_dir / "train.csv", keep_default_na=False)

    # 6) refit train-only artifacts into the sandbox root (§4.1)
    sandbox = sandbox_dir(record.dataset_id)
    stats = fit_neighborhood_stats(train)
    stats_path = save_neighborhood_stats(stats, sandbox / "neighborhood_stats.json")
    defaults = compute_feature_defaults(train, RAW_INPUT_COLUMNS)
    defaults_path = save_feature_defaults(defaults, sandbox / "feature_defaults.json")
    steps.append(
        {
            "step": "sandbox_stats",
            "fit_on": "train split only",
            "n_neighborhoods": int(len(stats.neighborhoods)),
            "n_months": int(stats.n_months),
            "n_feature_defaults": int(len(defaults)),
            "neighborhood_stats_path": _rel(stats_path),
            "feature_defaults_path": _rel(defaults_path),
        }
    )

    # 7) feature build (before/after column diff; stats passed explicitly —
    #    stats=None would load the CHAMPION neighborhood stats, §4.7)
    features = build_feature_frame(train, stats=stats)
    if list(features.columns) != MODEL_FEATURES:
        raise RuntimeError("build_feature_frame did not produce the MODEL_FEATURES columns")
    if int(features.isna().sum().sum()):
        raise RuntimeError("build_feature_frame produced NaNs on the prepared train split")
    steps.append(
        {
            "step": "features",
            "columns_before": int(train.shape[1]),
            "columns_after": int(features.shape[1]),
            "fit_on": "train split only (neighborhood stats)",
            "note": "model-ready frame via build_feature_frame with sandbox stats",
        }
    )

    after = _frame_summary(pd.concat(splits.values(), ignore_index=True))
    report = PrepareReport(
        dataset_id=record.dataset_id,
        config=config.model_dump(),
        fingerprint=_fingerprint(config, record.sha256_12),
        prepared_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        splits={
            "train": int(len(splits["train"])),
            "val": int(len(splits["val"])),
            "test": int(len(splits["test"])),
            "rule": rule,
        },
        steps=steps,
        before=before,
        after=after,
        sample_before=_sample_records(raw),
        sample_after=_sample_records(splits["train"]),
    )
    _persist_report(report)

    # Keep the registry record's prepare block in sync (§2.2, atomic rewrite).
    record.prepare = {
        "config": report.config,
        "fingerprint": report.fingerprint,
        "prepared_at": report.prepared_at,
    }
    _write_json_atomic(upload_dir(record.dataset_id) / "dataset.json", record.to_stored_dict())

    logger.info(
        "prepared upload %s: splits=%s fingerprint=%s",
        record.dataset_id, report.splits, report.fingerprint[:12],
    )
    return report


# ---------------------------------------------------------------------------
# Bundled path — canonical splits used in place (§3.8)
# ---------------------------------------------------------------------------

def _prepare_ames(record: DatasetRecord, config: PrepareConfig) -> PrepareReport:
    raw = load_raw_train()
    before = _frame_summary(raw)
    splits = load_prepared_splits(BUNDLED_DATASET_ID)  # reads data/processed in place
    steps: list[dict[str, Any]] = []

    # 1) canonical splits (ADR-4) — never re-split, never rewritten (§3.8)
    steps.append(
        {
            "step": "split",
            "strategy_requested": config.split_strategy,
            "rule": "time(YrSold)",
            "train": int(len(splits["train"])),
            "val": int(len(splits["val"])),
            "test": int(len(splits["test"])),
            "note": "canonical data/processed splits used in place (ADR-4); the config's "
            "split strategy/fractions are recorded but not applied to the bundled dataset",
        }
    )

    # 2) outlier rule — applied upstream by the canonical pipeline (train only)
    outliers_report_path = PROCESSED_DIR / "outliers_report.json"
    removed_ids: list[int] = []
    if outliers_report_path.exists():
        payload = json.loads(outliers_report_path.read_text(encoding="utf-8"))
        removed_ids = list(payload["partial_sale_grlivarea_gt_4000"]["removed_ids"])
    steps.append(
        {
            "step": "outlier_rule",
            "enabled": True,
            "rows_removed": len(removed_ids),
            "removed_ids": removed_ids,
            "applied_to": "train split only",
            "note": "applied upstream by the canonical pipeline (data/processed/outliers_report.json)",
        }
    )

    if len(splits["train"]) < MIN_TRAIN_ROWS:  # defensive; canonical train is 945
        raise ValueError(
            f"canonical train split has {len(splits['train'])} rows < {MIN_TRAIN_ROWS} — "
            "run `python -m ml.data.pipeline` to regenerate data/processed"
        )

    # 3) clean — numbers from the raw frame (the canonical CSVs are already cleaned)
    na_filled = {
        str(col): int(n) for col, n in raw.isna().sum().items() if int(n) > 0
    }
    steps.append(
        {
            "step": "clean",
            "fit_on": "train split only",
            "total_na_filled": int(sum(na_filled.values())),
            "na_filled_by_column": na_filled,
            "note": "applied upstream by the canonical pipeline; counts are the raw frame's "
            "missing cells, all filled per the documented NA policies",
        }
    )

    # 4) sale-speed target — the committed canonical splits carry the simulated
    #    target (data/processed/schema.json, verified against the pipeline notes)
    schema_path = PROCESSED_DIR / "schema.json"
    provider = "simulated"
    if schema_path.exists():
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        notes = " ".join(schema.get("notes", [])) + " " + schema.get("simulated_target", "")
        provider = "simulated" if "SIMULATED" in notes.upper() else "observed"
    steps.append(
        {
            "step": "sale_speed_target",
            "provider": provider,
            "simulated": provider == "simulated",
            "fit_on": "train split only",
            "positive_rate_train": round(float(splits["train"]["sells_within_30_days"].mean()), 4),
            "positive_rate_val": round(float(splits["val"]["sells_within_30_days"].mean()), 4),
            "positive_rate_test": round(float(splits["test"]["sells_within_30_days"].mean()), 4),
            "note": "SIMULATED target (ADR-3) — seeded days-on-market simulation; "
            "not a real-world performance claim",
        }
    )

    # 5) geo join — already present in the canonical splits (ADR-2)
    steps.append(
        {
            "step": "geo_join",
            "neighborhoods_mapped": int(
                pd.concat(splits.values())["Neighborhood"].nunique()
            ),
            "note": "approximate neighborhood centroids (data/external/neighborhood_geo.csv, ADR-2)",
        }
    )

    # 6) refit train-only artifacts into the sandbox root (same function, same
    #    train rows as the champion artifact — separate sandbox file, §4.1)
    sandbox = sandbox_dir(BUNDLED_DATASET_ID)
    stats = fit_neighborhood_stats(splits["train"])
    stats_path = save_neighborhood_stats(stats, sandbox / "neighborhood_stats.json")
    defaults = compute_feature_defaults(splits["train"], RAW_INPUT_COLUMNS)
    defaults_path = save_feature_defaults(defaults, sandbox / "feature_defaults.json")
    steps.append(
        {
            "step": "sandbox_stats",
            "fit_on": "train split only",
            "n_neighborhoods": int(len(stats.neighborhoods)),
            "n_months": int(stats.n_months),
            "n_feature_defaults": int(len(defaults)),
            "neighborhood_stats_path": _rel(stats_path),
            "feature_defaults_path": _rel(defaults_path),
        }
    )

    # 7) feature build on the canonical train split with sandbox stats
    features = build_feature_frame(splits["train"], stats=stats)
    if list(features.columns) != MODEL_FEATURES:
        raise RuntimeError("build_feature_frame did not produce the MODEL_FEATURES columns")
    if int(features.isna().sum().sum()):
        raise RuntimeError("build_feature_frame produced NaNs on the canonical train split")
    steps.append(
        {
            "step": "features",
            "columns_before": int(splits["train"].shape[1]),
            "columns_after": int(features.shape[1]),
            "fit_on": "train split only (neighborhood stats)",
            "note": "model-ready frame via build_feature_frame with sandbox stats",
        }
    )

    after = _frame_summary(pd.concat(splits.values(), ignore_index=True))
    report = PrepareReport(
        dataset_id=BUNDLED_DATASET_ID,
        config=config.model_dump(),
        fingerprint=_fingerprint(config, record.sha256_12),
        prepared_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        splits={
            "train": int(len(splits["train"])),
            "val": int(len(splits["val"])),
            "test": int(len(splits["test"])),
            "rule": "time(YrSold)",
        },
        steps=steps,
        before=before,
        after=after,
        sample_before=_sample_records(raw),
        sample_after=_sample_records(splits["train"]),
    )
    _persist_report(report)
    logger.info(
        "prepared bundled ames: splits=%s fingerprint=%s",
        report.splits, report.fingerprint[:12],
    )
    return report
