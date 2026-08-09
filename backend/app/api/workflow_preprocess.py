"""Workflow preprocessing routes — stage 06 (workflow-architecture §3.8).

``POST …/preprocess/preview`` runs the real leakage-safe chain and **persists**
it (stage 07 trains on exactly what was previewed, §3.8); it is synchronous
(<= ~5 s at the row cap). ``GET …/preprocess`` reports the persisted state.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ml.workflow.datasets import UnknownDataset
from ml.workflow.prepare import PrepareConfig, prepare_dataset, preview_report

from backend.app.api.deps import get_workflow_dataset_service
from backend.app.schemas.workflow import PreprocessPreviewRequest, PreprocessStatusOut
from backend.app.services.workflow import WorkflowDatasetService

router = APIRouter(tags=["workflow"])


@router.get(
    "/workflow/datasets/{dataset_id}/preprocess", response_model=PreprocessStatusOut
)
def get_preprocess(
    dataset_id: str,
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> dict[str, Any]:
    """The persisted stage-06 state ``{prepared, config, fingerprint, summary}`` (§3.8)."""
    record = service.get_dataset(dataset_id)  # 404 gate
    report = preview_report(dataset_id)
    prepare = record.get("prepare")
    return {
        "prepared": report is not None,
        "config": (prepare or {}).get("config"),
        "fingerprint": (prepare or {}).get("fingerprint"),
        "summary": report.to_dict() if report else None,
    }


@router.post("/workflow/datasets/{dataset_id}/preprocess/preview")
def preprocess_preview(
    dataset_id: str,
    body: PreprocessPreviewRequest,
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> dict[str, Any]:
    """Run + persist stage 06 and return the full before/after report (§3.8).

    Raises:
        HTTPException: 404 unknown dataset; 400 rows outside the training
            window (or the cleaner's no-policy failure); 422 config rejected
            by the ml-layer model (defensive — the request schema mirrors it).
    """
    service.get_dataset(dataset_id)  # 404 gate
    try:
        config = PrepareConfig(**body.config.model_dump())
    except ValueError as exc:  # pydantic ValidationError subclasses ValueError
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        report = prepare_dataset(dataset_id, config)
    except UnknownDataset as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        # Row-window and cleaner no-policy failures are client-actionable -> 400
        # (mapping pinned in ml/workflow/prepare.py).
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return report.to_dict()
