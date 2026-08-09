"""Dataset lifecycle service for the workflow API (workflow-architecture §3.1/§3.2, §5.2).

Exception -> HTTP mapping (pinned in ``ml/workflow/datasets.py``):

- ``UnknownDataset`` -> 404
- ``CorruptUpload`` / ``UploadValidationError`` -> 422 with the documented
  dict-shaped detail ``{"code", "message", "report"}`` (§3 deviation: every
  other service error is ``{"detail": "<string>"}``; upload 422 is structured
  so the UI can render the per-check report)
- ``ValueError`` from ``delete_dataset`` (bundled) -> 400
- ``DatasetBusyError`` -> 409

Also owns the ``state`` block assembly (§3.2): prepared flag, job counts from
a scan of ``models/workflow/<id>/jobs/*/status.json``, and the training row
window (``MIN_TRAIN_ROWS``..``MAX_UPLOAD_ROWS``, §2.3).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException

from ml.workflow import datasets as wf_datasets
from ml.workflow.datasets import (
    BUNDLED_DATASET_ID,
    MAX_UPLOAD_ROWS,
    CorruptUpload,
    DatasetBusyError,
    DatasetRecord,
    UnknownDataset,
    UploadReport,
    UploadValidationError,
)
from ml.workflow.prepare import MIN_TRAIN_ROWS, preview_report

logger = logging.getLogger(__name__)

#: Job states that count as "running" for the state block (§3.2). The status
#: file protocol accepts both ``complete`` (on disk) and ``done`` (API shape).
ACTIVE_JOB_STATES = frozenset({"queued", "preparing", "running"})
DONE_JOB_STATES = frozenset({"complete", "done"})


def upload_error_detail(report: UploadReport, fallback: str) -> dict[str, Any]:
    """The documented dict-shaped 422 detail for upload failures (§3.1 deviation)."""
    return {
        "code": report.code or "upload_invalid",
        "message": report.message or fallback,
        "report": report.to_dict(),
    }


def _unknown_404(exc: UnknownDataset) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


def job_status_scan(dataset_id: str) -> list[dict[str, Any]]:
    """Read every ``jobs/*/status.json`` of a dataset (tolerant of partial files)."""
    jobs_dir = wf_datasets.sandbox_dir(dataset_id) / "jobs"
    statuses: list[dict[str, Any]] = []
    if not jobs_dir.exists():
        return statuses
    for status_file in sorted(jobs_dir.glob("*/status.json")):
        try:
            payload = json.loads(status_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("skipping unreadable job status %s", status_file)
            continue
        if isinstance(payload, dict):
            statuses.append(payload)
    return statuses


def normalize_job_status(status: Any) -> str:
    """Map the on-disk ``complete`` to the §3.9 API spelling ``done`` (pass the rest)."""
    return "done" if status == "complete" else str(status)


class WorkflowDatasetService:
    """Stateless adapter over ``ml.workflow.datasets`` (one per request, §5.3)."""

    # -- upload (§3.1) -------------------------------------------------------

    def upload(self, data: bytes, filename: str) -> dict[str, Any]:
        """Validate + store an upload; return the 201 payload (record + validation + preview).

        Raises:
            HTTPException: 422 with the dict-shaped detail on validation/parse
                failure (``CorruptUpload``/``UploadValidationError``).
        """
        try:
            record = wf_datasets.save_upload(data, filename)
        except CorruptUpload as exc:
            raise HTTPException(
                status_code=422, detail=upload_error_detail(exc.report, str(exc))
            ) from exc
        except UploadValidationError as exc:
            raise HTTPException(
                status_code=422, detail=upload_error_detail(exc.report, str(exc))
            ) from exc

        # The 8-row preview head (§3.1): reuse the profiling core's JSON-safe
        # head rather than re-implementing NaN handling.
        from ml.workflow.profile import profile_dataset  # noqa: PLC0415

        head = profile_dataset(wf_datasets.load_dataset_frame(record.dataset_id))["head"]
        payload = record.to_dict()
        payload["validation"] = {"ok": True, "checks": (record.validation.checks if record.validation else [])}
        payload["preview"] = {"head": head}
        return payload

    # -- lifecycle (§3.2) ----------------------------------------------------

    def list_datasets(self) -> list[dict[str, Any]]:
        """All datasets (bundled first, uploads newest-first)."""
        return [record.to_dict() for record in wf_datasets.list_datasets()]

    def get_dataset(self, dataset_id: str) -> dict[str, Any]:
        """The record plus its ``state`` block (§3.2)."""
        record = self._record_or_404(dataset_id)
        payload = record.to_dict()
        payload["state"] = self.build_state(record)
        return payload

    def get_state(self, dataset_id: str) -> dict[str, Any]:
        """Just the ``state`` block (the stepper's server truth, §6.2)."""
        return self.build_state(self._record_or_404(dataset_id))

    def delete_dataset(self, dataset_id: str) -> None:
        """Delete an upload (storage + sandbox); 400 bundled, 404 unknown, 409 busy."""
        try:
            wf_datasets.delete_dataset(dataset_id)
        except ValueError as exc:  # bundled: "The bundled dataset cannot be deleted"
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except UnknownDataset as exc:
            raise _unknown_404(exc) from exc
        except DatasetBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    # -- state assembly (§3.2) -----------------------------------------------

    def build_state(self, record: DatasetRecord) -> dict[str, Any]:
        """Assemble the stepper's server truth for one dataset.

        Job counts come from the on-disk status files; ``objectives_done``
        lists objectives with at least one completed job. ``can_train``
        enforces the §2.3 row window (post-split train rows >=
        ``MIN_TRAIN_ROWS`` and upload rows <= ``MAX_UPLOAD_ROWS``); the train
        count is the persisted split size when prepared, else the default
        70/15/15 estimate.
        """
        statuses = job_status_scan(record.dataset_id)
        counts = {"total": len(statuses), "running": 0, "done": 0, "failed": 0}
        objectives_done: set[str] = set()
        for payload in statuses:
            status = normalize_job_status(payload.get("status"))
            if status in ACTIVE_JOB_STATES:
                counts["running"] += 1
            elif status in DONE_JOB_STATES:
                counts["done"] += 1
                objective = payload.get("objective")
                if objective:
                    objectives_done.add(str(objective))
            elif status == "failed":
                counts["failed"] += 1

        can_train, blocked_reason = self._train_window(record)
        has_done_job = counts["done"] > 0
        return {
            "prepared": record.prepare is not None,
            "prepare_config": (record.prepare or {}).get("config"),
            "jobs": counts,
            "objectives_done": sorted(objectives_done),
            "can_train": can_train,
            "can_evaluate": has_done_job,
            "can_predict_sandbox": has_done_job,
            "train_blocked_reason": blocked_reason,
        }

    @staticmethod
    def _train_window(record: DatasetRecord) -> tuple[bool, str | None]:
        """The §2.3 training row window; ``(False, reason)`` when outside it."""
        if record.n_rows > MAX_UPLOAD_ROWS:
            return False, (
                f"dataset has {record.n_rows} rows; training is capped at "
                f"{MAX_UPLOAD_ROWS} rows (the 01-05 exploration stages remain available)"
            )
        n_train: int | None = None
        try:
            report = preview_report(record.dataset_id)
        except UnknownDataset:
            report = None
        if report is not None:
            n_train = int(report.splits.get("train", 0))
        else:
            # Default-fraction estimate (70/15/15) for an unprepared dataset.
            n = record.n_rows
            n_train = n - round(n * 0.15) - round(n * 0.15)
        if n_train < MIN_TRAIN_ROWS:
            return False, (
                f"post-split train split has ~{n_train} rows; training and "
                f"preprocessing require >= {MIN_TRAIN_ROWS} (dataset has "
                f"{record.n_rows} rows total — the 01-05 exploration stages "
                "remain available)"
            )
        return True, None

    # -- shared --------------------------------------------------------------

    @staticmethod
    def _record_or_404(dataset_id: str) -> DatasetRecord:
        try:
            return wf_datasets.get_record(dataset_id)
        except UnknownDataset as exc:
            raise _unknown_404(exc) from exc


__all__ = [
    "ACTIVE_JOB_STATES",
    "DONE_JOB_STATES",
    "WorkflowDatasetService",
    "job_status_scan",
    "normalize_job_status",
    "upload_error_detail",
]
