"""Workflow training-job routes — stages 07-09 (workflow-architecture §3.9-§3.11).

Job execution is a subprocess (``python -m ml.workflow.train_job``); this
router only validates, spawns and reads the status-file protocol. One job at
a time server-wide (409 otherwise, §4.8).
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query

from backend.app.api.deps import (
    get_workflow_job_service,
    get_workflow_predict_service,
)
from backend.app.schemas.property import PropertyInput
from backend.app.schemas.workflow import JobAcceptedOut, JobOut, JobRequest, ModelsOut
from backend.app.services.workflow import WorkflowJobService, WorkflowPredictService

router = APIRouter(tags=["workflow"])


@router.post(
    "/workflow/datasets/{dataset_id}/jobs", status_code=202, response_model=JobAcceptedOut
)
def create_job(
    dataset_id: str,
    body: JobRequest,
    service: WorkflowJobService = Depends(get_workflow_job_service),
) -> dict[str, Any]:
    """Queue a training job (stage 07, §3.9) -> 202 ``{job_id, status, links}``.

    Errors: 400 row window; 404 dataset; 409 a job is already running
    (message names it); 422 unknown candidates (message lists the valid set).
    An unprepared dataset is auto-prepared by the subprocess with the default
    config (surfaced as a ``preparing`` phase, §3.9).
    """
    return service.create_job(dataset_id, body.objective, body.candidates)


@router.get("/workflow/datasets/{dataset_id}/jobs", response_model=list[JobOut])
def list_jobs(
    dataset_id: str,
    service: WorkflowJobService = Depends(get_workflow_job_service),
) -> list[dict[str, Any]]:
    """Past jobs of a dataset, newest first (§3.9 status-file scan)."""
    return service.list_jobs(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/models", response_model=ModelsOut)
def list_models(
    dataset_id: str,
    objective: Literal["regression", "classification", "clustering"] = Query(
        default="regression"
    ),
    service: WorkflowJobService = Depends(get_workflow_job_service),
) -> dict[str, Any]:
    """Comparison-table source: latest successful result per candidate (§3.9).

    Regression with >= 2 candidates carries the paired-bootstrap honesty
    block; classification results always carry ``simulated_target: true`` in
    the provenance block (§7).
    """
    return service.models_payload(dataset_id, objective)


@router.get("/workflow/jobs/{job_id}", response_model=JobOut)
def get_job(
    job_id: str,
    service: WorkflowJobService = Depends(get_workflow_job_service),
) -> dict[str, Any]:
    """Live job status: phase, per-candidate progress, results, error (§3.9)."""
    return service.get_job(job_id)


@router.get("/workflow/jobs/{job_id}/evaluation/{candidate}")
def job_evaluation(
    job_id: str,
    candidate: str,
    service: WorkflowJobService = Depends(get_workflow_job_service),
) -> dict[str, Any]:
    """Sandbox evaluation payload for one completed candidate (stage 08, §3.10).

    Val-split only — the sandbox test split stays sealed (§4.3). 404 unknown
    job/candidate; 409 no completed result yet.
    """
    return service.evaluation_payload(job_id, candidate)


@router.post("/workflow/jobs/{job_id}/predict/{candidate}")
def sandbox_predict(
    job_id: str,
    candidate: str,
    payload_input: PropertyInput,
    service: WorkflowPredictService = Depends(get_workflow_predict_service),
) -> dict[str, Any]:
    """Sandbox prediction with the user's own trained model (stage 09, §3.11).

    Reuses the champion ``PropertyInput`` schema unchanged; the response
    carries the sandbox provenance block (never the champion's). Sandbox
    predictions are never written to ``logs/predictions.jsonl`` (§3.11).
    Errors: 404 job/candidate; 409 job not done / candidate failed; 422 payload.
    """
    return service.predict(job_id, candidate, payload_input.to_serving_payload())
