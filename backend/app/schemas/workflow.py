"""Request/response schemas for the guided-ML-workflow API (workflow-architecture §3, §5.2).

Request models (:class:`PreprocessConfig`, :class:`JobRequest`) mirror the
pinned request bodies of §3.8/§3.9 and are validated by FastAPI (422 with the
standard ``{"detail": [...]}`` list shape). :class:`PreprocessConfig` mirrors
``ml.workflow.prepare.PrepareConfig`` field-for-field so the ml-layer model
can be constructed from it without a second validation failure.

Response models mirror the §3 payload shapes with dynamic nested blocks typed
as ``Any`` (the payloads are owned by ``ml.workflow.*`` and are already
JSON-safe); all allow extra keys so additive ml-layer fields pass through.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ml.paths import RANDOM_SEED

__all__ = [
    "JobRequest",
    "PreprocessConfig",
    "PreprocessPreviewRequest",
    "DatasetRecordOut",
    "StateOut",
    "DatasetDetailOut",
    "UploadValidationOut",
    "DatasetCreatedOut",
    "JobAcceptedOut",
    "JobOut",
    "PreprocessStatusOut",
    "ModelsOut",
    "ProfileOut",
    "FeaturesOut",
    "StatsOut",
    "MissingOut",
    "HistogramOut",
    "ScatterOut",
    "BoxOut",
    "CorrelationOut",
    "CategoryOut",
    "VizOut",
]


# ---------------------------------------------------------------------------
# Request bodies (§3.8, §3.9)
# ---------------------------------------------------------------------------

class PreprocessConfig(BaseModel):
    """Stage-06 preprocessing configuration (§3.8; mirrors ``ml.workflow.prepare.PrepareConfig``)."""

    model_config = ConfigDict(extra="forbid")

    outlier_rule: bool = True
    split_strategy: Literal["auto", "time", "random"] = "auto"
    val_frac: float = Field(default=0.15, gt=0.0, lt=1.0)
    test_frac: float = Field(default=0.15, gt=0.0, lt=1.0)
    seed: int = Field(default=RANDOM_SEED, ge=0)

    @model_validator(mode="after")
    def _fractions_leave_a_train_split(self) -> "PreprocessConfig":
        if self.val_frac + self.test_frac >= 0.9:
            raise ValueError(
                f"val_frac + test_frac must leave >= 10% train rows, got "
                f"{self.val_frac} + {self.test_frac}"
            )
        return self


class PreprocessPreviewRequest(BaseModel):
    """``POST /workflow/datasets/{id}/preprocess/preview`` body (§3.8)."""

    model_config = ConfigDict(extra="forbid")

    config: PreprocessConfig = Field(default_factory=PreprocessConfig)


class JobRequest(BaseModel):
    """``POST /workflow/datasets/{id}/jobs`` body (§3.9).

    Candidate validity is objective-dependent and enforced by the job service
    (422 naming the valid set — the response lists valid candidates).
    """

    model_config = ConfigDict(extra="forbid")

    objective: Literal["regression", "classification", "clustering"]
    candidates: list[str] = Field(min_length=1)


# ---------------------------------------------------------------------------
# Datasets (§3.1, §3.2)
# ---------------------------------------------------------------------------

class _ExtraAllow(BaseModel):
    model_config = ConfigDict(extra="allow")


class DatasetRecordOut(_ExtraAllow):
    """One dataset registry entry (§2.2 record + derived ``deletable``, §3.2)."""

    dataset_id: str
    name: str
    source: Literal["bundled", "upload"]
    created_at: str
    sha256_12: str
    n_rows: int
    n_cols: int
    prepare: dict[str, Any] | None
    deletable: bool


class StateOut(_ExtraAllow):
    """The stepper's server truth (§3.2 ``state`` block)."""

    prepared: bool
    prepare_config: dict[str, Any] | None
    jobs: dict[str, int]
    objectives_done: list[str]
    can_train: bool
    can_evaluate: bool
    can_predict_sandbox: bool
    train_blocked_reason: str | None


class DatasetDetailOut(DatasetRecordOut):
    """``GET /workflow/datasets/{id}`` — the record plus its ``state`` (§3.2)."""

    state: StateOut


class UploadValidationOut(_ExtraAllow):
    """The upload validation summary embedded in the 201 response (§3.1)."""

    ok: bool
    checks: list[dict[str, str]]


class DatasetCreatedOut(DatasetRecordOut):
    """201 response of ``POST /workflow/datasets`` (§3.1)."""

    validation: UploadValidationOut
    preview: dict[str, Any]


# ---------------------------------------------------------------------------
# Jobs (§3.9)
# ---------------------------------------------------------------------------

class JobAcceptedOut(_ExtraAllow):
    """202 response of ``POST /workflow/datasets/{id}/jobs`` (§3.9)."""

    job_id: str
    status: str
    links: dict[str, str]


class JobOut(_ExtraAllow):
    """``GET /workflow/jobs/{job_id}`` — live view of the job status file (§3.9)."""

    job_id: str
    dataset_id: str
    objective: str
    status: str
    progress: dict[str, Any]
    results: dict[str, Any]
    error: str | None
    created_at: str | None
    finished_at: str | None


class ModelsOut(_ExtraAllow):
    """``GET /workflow/datasets/{id}/models`` — the comparison table source (§3.9)."""

    objective: str
    dataset_id: str
    candidates: list[dict[str, Any]]
    selection: dict[str, Any]
    bootstrap: dict[str, Any] | None
    provenance: dict[str, Any]


# ---------------------------------------------------------------------------
# Preprocess (§3.8)
# ---------------------------------------------------------------------------

class PreprocessStatusOut(_ExtraAllow):
    """``GET /workflow/datasets/{id}/preprocess`` (§3.8)."""

    prepared: bool
    config: dict[str, Any] | None
    fingerprint: str | None
    summary: dict[str, Any] | None


# ---------------------------------------------------------------------------
# Stage 01–05 payloads (§3.3–§3.7) — shapes owned by ml/workflow/profile.py
# ---------------------------------------------------------------------------

class ProfileOut(_ExtraAllow):
    """``GET …/profile`` (§3.3)."""

    dataset_id: str
    name: str
    n_rows: int
    n_cols: int
    n_numeric: int
    n_categorical: int
    n_duplicate_ids: int
    total_missing_cells: int
    head: list[dict[str, Any]]
    columns: list[dict[str, str]]


class FeaturesOut(_ExtraAllow):
    """``GET …/features`` (§3.4)."""

    raw_features: list[dict[str, Any]]
    pipeline_features: list[dict[str, Any]]
    targets: dict[str, Any]
    recommended_split: dict[str, Any]


class StatsOut(_ExtraAllow):
    """``GET …/stats`` (§3.5)."""

    numeric: list[dict[str, Any]]
    categorical: list[dict[str, Any]]
    target: dict[str, Any] | None


class MissingOut(_ExtraAllow):
    """``GET …/missing`` (§3.6)."""

    total_missing: int
    n_columns_with_missing: int
    n_complete_columns: int
    columns: list[dict[str, Any]]
    blocking: list[dict[str, Any]]


class HistogramOut(_ExtraAllow):
    """``viz/histogram`` (§3.7)."""

    column: str
    bins: list[dict[str, Any]]
    stats: dict[str, Any]


class ScatterOut(_ExtraAllow):
    """``viz/scatter`` (§3.7)."""

    x: str
    y: str
    points: list[list[float]]
    n_total: int
    sampled: bool


class BoxOut(_ExtraAllow):
    """``viz/box`` (§3.7)."""

    column: str
    by: str
    groups: list[dict[str, Any]]


class CorrelationOut(_ExtraAllow):
    """``viz/correlation`` (§3.7)."""

    target: str
    features: list[str]
    matrix: list[list[Any]]


class CategoryOut(_ExtraAllow):
    """``viz/category`` (§3.7)."""

    column: str
    target: str
    agg: str
    groups: list[dict[str, Any]]


#: Union of the per-kind visualization payloads (§3.7).
VizOut = HistogramOut | ScatterOut | BoxOut | CorrelationOut | CategoryOut
