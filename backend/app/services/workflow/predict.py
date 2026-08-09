"""Sandbox prediction service (workflow-architecture §3.11, §4.3/§4.4, §5.2).

Request-scoped accessor over ``ml.workflow.predict.SandboxModelService``
instances cached on the service by ``(dataset_id, job_id)`` (the ml layer
additionally caches stats/defaults by ``(path, mtime)`` — never the champion
module-global loaders, §4.4).

Sandbox predictions are **never** written to ``logs/predictions.jsonl``
(§3.11 — the log feeds champion drift monitoring; this layer simply does not
log). Responses are passed through verbatim: they carry the sandbox
provenance block from the ml layer (§3.11).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from ml.workflow.datasets import UnknownDataset
from ml.workflow.prepare import preview_report

from backend.app.services.workflow.datasets import DONE_JOB_STATES, normalize_job_status
from backend.app.services.workflow.jobs import WorkflowJobService

logger = logging.getLogger(__name__)

#: Red-team F1: plain-English provenance note on stale-split sandbox predictions.
_STALE_SPLIT_NOTE = (
    "trained on a previous preprocessing configuration — re-run "
    "preprocessing-aware training for current-split results"
)


class WorkflowPredictService:
    """Sandbox prediction facade (one per request, §5.3)."""

    def __init__(self) -> None:
        self._job_service = WorkflowJobService()
        self._models: dict[tuple[str, str], Any] = {}

    def _sandbox_model(self, dataset_id: str, job_id: str) -> Any:
        """Cached ``SandboxModelService`` per ``(dataset_id, job_id)``; 503 pre-WF-B2."""
        key = (dataset_id, job_id)
        if key not in self._models:
            try:
                from ml.workflow.predict import SandboxModelService  # noqa: PLC0415
            except ImportError as exc:
                raise HTTPException(
                    status_code=503,
                    detail="the workflow training engine (ml.workflow.predict) is not "
                    "available in this build",
                ) from exc
            self._models[key] = SandboxModelService(dataset_id, job_id)
        return self._models[key]

    def predict(
        self, job_id: str, candidate: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Run a sandbox prediction for one completed candidate (§3.11).

        ``payload`` is the validated ``PropertyInput.to_serving_payload()``.

        Raises:
            HTTPException: 404 unknown job/candidate; 409 job not done /
                candidate failed; 422 the payload cannot be scored (or the
                objective does not serve predictions); 503 pre-WF-B2.
        """
        dataset_id, _job_dir, status = self._job_service._job_dir_for(job_id)
        objective = str(status.get("objective"))
        if normalize_job_status(status.get("status")) not in DONE_JOB_STATES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"job {job_id} is not complete "
                    f"(status: {normalize_job_status(status.get('status'))})"
                ),
            )
        results = status.get("results") or {}
        if candidate not in results:
            raise HTTPException(
                status_code=404,
                detail=f"job {job_id} has no candidate {candidate!r} "
                f"(known: {sorted(results)})",
            )
        if normalize_job_status(results[candidate].get("status")) not in DONE_JOB_STATES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"candidate {candidate!r} of job {job_id} did not complete "
                    f"(status: {results[candidate].get('status')})"
                ),
            )
        if objective == "regression":
            method = "predict_price"
        elif objective == "classification":
            method = "predict_proba"
        else:
            raise HTTPException(
                status_code=422,
                detail=f"objective {objective!r} does not serve per-row predictions",
            )
        model = self._sandbox_model(dataset_id, job_id)
        try:
            response = getattr(model, method)(payload, candidate)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        # Red-team F1: the prediction still works on a stale-split job, but the
        # provenance block must say so — the pipeline is old-split while the
        # sandbox stats it combines with are new-split after a re-prepare.
        try:
            current = preview_report(dataset_id)
        except UnknownDataset:
            current = None
        if current is not None and status.get("prepare_fingerprint") != current.fingerprint:
            provenance = response.get("provenance")
            if isinstance(provenance, dict):
                provenance["stale_split"] = True
                provenance["stale_note"] = _STALE_SPLIT_NOTE
        return response


__all__ = ["WorkflowPredictService"]
