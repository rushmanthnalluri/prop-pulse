"""Workflow EDA routes — stages 01-05 (workflow-architecture §3.3-§3.7).

All payloads are computed per request by ``ml.workflow.profile`` (no cache,
§3.3) and are browser-sized (value counts capped at 8, box groups at 25,
scatter seeded-downsampled, §3.7).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from backend.app.api.deps import get_workflow_eda_service
from backend.app.schemas.workflow import (
    FeaturesOut,
    MissingOut,
    ProfileOut,
    StatsOut,
    VizOut,
)
from backend.app.services.workflow import WorkflowEdaService

router = APIRouter(tags=["workflow"])


@router.get("/workflow/datasets/{dataset_id}/profile", response_model=ProfileOut)
def dataset_profile(
    dataset_id: str,
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Dataset profile: shape, dtypes, duplicate ids, missing cells, head-8 (§3.3)."""
    return service.profile(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/features", response_model=FeaturesOut)
def dataset_features(
    dataset_id: str,
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Feature inventory + objective/target reporting (§3.4).

    The classification target entry carries ``derived: "simulated"`` and its
    train-portion ``positive_rate`` (ADR-3 SIMULATED badge data, §7).
    """
    return service.features(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/stats", response_model=StatsOut)
def dataset_stats(
    dataset_id: str,
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Descriptive statistics (numeric + categorical + the SalePrice callout, §3.5)."""
    return service.stats(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/missing", response_model=MissingOut)
def dataset_missing(
    dataset_id: str,
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Missing-value analysis with the pipeline's real treatment policies (§3.6)."""
    return service.missing(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/viz/histogram", response_model=VizOut)
def viz_histogram(
    dataset_id: str,
    column: str = Query(...),
    bins: int = Query(default=30, ge=1, le=200),
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Histogram bins + summary stats for a numeric column (§3.7); 422 unknown/mistyped column."""
    return service.viz(dataset_id, "histogram", column=column, bins=bins)


@router.get("/workflow/datasets/{dataset_id}/viz/scatter", response_model=VizOut)
def viz_scatter(
    dataset_id: str,
    x: str = Query(...),
    y: str = Query(...),
    max_points: int = Query(default=1500, ge=1, le=20000),
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Seeded-downsampled scatter points for two numeric columns (§3.7)."""
    return service.viz(dataset_id, "scatter", x=x, y=y, max_points=max_points)


@router.get("/workflow/datasets/{dataset_id}/viz/box", response_model=VizOut)
def viz_box(
    dataset_id: str,
    column: str = Query(...),
    by: str = Query(...),
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Per-group box stats sorted by median desc, <= 25 groups (§3.7)."""
    return service.viz(dataset_id, "box", column=column, by=by)


@router.get("/workflow/datasets/{dataset_id}/viz/correlation", response_model=VizOut)
def viz_correlation(
    dataset_id: str,
    target: str = Query(default="SalePrice"),
    top: int = Query(default=20, ge=1, le=60),
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Numeric correlation matrix: top ``top`` by |corr with target| + target (§3.7)."""
    return service.viz(dataset_id, "correlation", target=target, top=top)


@router.get("/workflow/datasets/{dataset_id}/viz/category", response_model=VizOut)
def viz_category(
    dataset_id: str,
    column: str = Query(...),
    agg: str = Query(default="median"),
    target: str = Query(default="SalePrice"),
    service: WorkflowEdaService = Depends(get_workflow_eda_service),
) -> dict[str, Any]:
    """Per-category aggregate of the target (``agg`` = median|mean|count, §3.7)."""
    return service.viz(dataset_id, "category", column=column, target=target, agg=agg)
