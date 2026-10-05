"""Workflow preprocessing routes — stage 06 (workflow-architecture §3.8).

``POST …/preprocess/preview`` runs the real leakage-safe chain and **persists**
it (stage 07 trains on exactly what was previewed, §3.8); it is synchronous
(<= ~5 s at the row cap). ``GET …/preprocess`` reports the persisted state.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ml.workflow.datasets import UnknownDataset
from ml.workflow.prepare import prepare_dataset, preview_report

from backend.app.api.deps import get_workflow_dataset_service
from ml.workflow.admission import (
    TrainingAdmissionLock,
    read_training_owner,
)
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
    try:
        report = preview_report(dataset_id)
    except UnknownDataset as exc:  # deleted between the gate and the read
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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
            window (or the cleaner's no-policy failure).
    """
    service.get_dataset(dataset_id)  # 404 gate
    config = body.config  # already validated — the request schema IS PrepareConfig

    # Preparation rewrites the split/artifact state that a training job uses.
    # Hold the same cross-process admission lock for the whole preparation so
    # a re-prepare cannot race a running trainer and invalidate its fingerprint.
    lock = TrainingAdmissionLock(
        dataset_id=dataset_id, job_id=None, operation="preprocess"
    )
    if not lock.acquire():
        owner = read_training_owner()
        detail = (
            f"cannot re-prepare while job {owner.get('job_id')} on dataset "
            f"{owner.get('dataset_id')} is running"
            if owner
            else "cannot re-prepare while another training/preprocessing operation is running"
        )
        raise HTTPException(status_code=409, detail=detail)
    try:
        report = prepare_dataset(dataset_id, config)
    except UnknownDataset as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        # Row-window and cleaner failures are client-actionable -> 400.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        lock.release()
    return report.to_dict()
