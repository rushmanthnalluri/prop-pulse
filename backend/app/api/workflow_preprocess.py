"""Workflow preprocessing routes — stage 06 (workflow-architecture §3.8).

``POST …/preprocess/preview`` runs the real leakage-safe chain and **persists**
it (stage 07 trains on exactly what was previewed, §3.8); it is synchronous
(<= ~5 s at the row cap). ``GET …/preprocess`` reports the persisted state.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from filelock import FileLock, Timeout

from ml.workflow import datasets as wf_datasets
from ml.workflow.datasets import UnknownDataset
from ml.workflow.prepare import prepare_dataset, preview_report

from backend.app.api.deps import get_workflow_dataset_service
from ml.workflow.admission import (
    JOB_SUBMISSION_LOCK_NAME,
    TrainingAdmissionLock,
    read_training_owner,
)
from backend.app.schemas.workflow import PreprocessPreviewRequest, PreprocessStatusOut
from backend.app.services.workflow import (
    ACTIVE_JOB_STATES,
    WorkflowDatasetService,
    job_status_scan,
)

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

    # Acquire locks in the same order as job submission and dataset deletion.
    # Serializing submissions alone is not enough: preprocessing must also refuse
    # to rewrite a dataset that already has a queued child waiting for admission.
    queue_root = wf_datasets.WORKFLOW_MODELS_ROOT
    queue_root.mkdir(parents=True, exist_ok=True)
    submission_lock = FileLock(str(queue_root / JOB_SUBMISSION_LOCK_NAME))
    try:
        submission_lock.acquire(timeout=0)
    except Timeout as exc:
        raise HTTPException(
            status_code=409,
            detail="another workflow job is being submitted; retry shortly",
        ) from exc

    lock = TrainingAdmissionLock(
        dataset_id=dataset_id, job_id=None, operation="preprocess"
    )
    lock_acquired = False
    try:
        # Revalidate after acquiring the submission lock: a deletion that won
        # the lock immediately before this request must surface as a clean 404.
        service.get_dataset(dataset_id)

        active_jobs = [
            job for job in job_status_scan(dataset_id)
            if str(job.get("status")) in ACTIVE_JOB_STATES
        ]
        if active_jobs:
            job = active_jobs[0]
            raise HTTPException(
                status_code=409,
                detail=(
                    f"cannot re-prepare dataset {dataset_id!r} while job "
                    f"{job.get('job_id')!r} is {job.get('status')!r}; "
                    "wait for its queued/running work to finish"
                ),
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
        lock_acquired = True
        try:
            report = prepare_dataset(dataset_id, config)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            # Row-window and cleaner failures are client-actionable -> 400.
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return report.to_dict()
    finally:
        if lock_acquired:
            lock.release()
        submission_lock.release()
