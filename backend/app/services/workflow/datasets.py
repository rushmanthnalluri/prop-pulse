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

import logging
from typing import Any

from fastapi import HTTPException
from filelock import FileLock, Timeout

from ml.workflow import datasets as wf_datasets
from ml.workflow.admission import (
    JOB_SUBMISSION_LOCK_NAME,
    TrainingAdmissionLock,
    read_training_owner,
)
from ml.workflow.datasets import (
    MAX_UPLOAD_ROWS,
    CorruptUpload,
    DatasetBusyError,
    DatasetRecord,
    UnknownDataset,
    UploadReport,
    UploadValidationError,
)
from ml.workflow.prepare import (
    MIN_TRAIN_ROWS,
    PrepareConfig,
    effective_train_row_count,
    preview_report,
)

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
    # Lazy: jobs.py imports this module at module level (circular at import time).
    from backend.app.services.workflow.jobs import _read_status_file  # noqa: PLC0415

    jobs_dir = wf_datasets.sandbox_dir(dataset_id) / "jobs"
    statuses: list[dict[str, Any]] = []
    if not jobs_dir.exists():
        return statuses
    for status_file in sorted(jobs_dir.glob("*/status.json")):
        payload = _read_status_file(status_file)
        if payload is None:
            logger.warning("skipping unreadable job status %s", status_file)
            continue
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
        """Delete an upload under the same submission/admission lock order as training."""
        # Preserve 400/404 validation responses even when another workflow is active.
        try:
            wf_datasets.get_record(dataset_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except UnknownDataset as exc:
            raise _unknown_404(exc) from exc
        if dataset_id == wf_datasets.BUNDLED_DATASET_ID:
            raise HTTPException(
                status_code=400, detail="The bundled dataset cannot be deleted"
            )

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

        admission = TrainingAdmissionLock(
            dataset_id=dataset_id, job_id=None, operation="dataset-delete"
        )
        admission_acquired = False
        try:
            admission_acquired = admission.acquire()
            if not admission_acquired:
                owner = read_training_owner()
                if owner is None:
                    detail = (
                        "cannot delete while another workflow operation is active; "
                        "retry when it finishes"
                    )
                else:
                    detail = (
                        f"cannot delete dataset {dataset_id!r} while workflow operation "
                        f"{owner.get('operation')!r} is active on dataset "
                        f"{owner.get('dataset_id')!r}"
                    )
                    if owner.get("job_id") is not None:
                        detail += f" (job {owner.get('job_id')!r})"
                raise HTTPException(status_code=409, detail=detail)

            try:
                wf_datasets.delete_dataset(dataset_id)
            except ValueError as exc:  # bundled: "The bundled dataset cannot be deleted"
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except UnknownDataset as exc:
                raise _unknown_404(exc) from exc
            except DatasetBusyError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
        finally:
            if admission_acquired:
                admission.release()
            submission_lock.release()

    # -- state assembly (§3.2) -----------------------------------------------

    def build_state(self, record: DatasetRecord) -> dict[str, Any]:
        """Assemble the stepper's server truth for one dataset.

        Job counts come from the on-disk status files; ``objectives_done``
        lists objectives with at least one completed job. ``can_train``
        enforces the §2.3 row window (post-split train rows >=
        ``MIN_TRAIN_ROWS`` and upload rows <= ``MAX_UPLOAD_ROWS``); the train
        count is the persisted post-outlier preparation split size when prepared,
        else the exact default preparation calculation is used without writing artifacts.
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
        """Return train eligibility using the exact stage-06 row calculation."""
        if record.n_rows > MAX_UPLOAD_ROWS:
            return False, (
                f"dataset has {record.n_rows} rows; training is capped at "
                f"{MAX_UPLOAD_ROWS} rows (the 01-05 exploration stages remain available)"
            )

        try:
            report = preview_report(record.dataset_id)
        except UnknownDataset:
            report = None

        # A prepared dataset's persisted config is the configuration whose
        # fingerprint downstream jobs will bind to. For a fresh dataset the
        # same default PrepareConfig used by the self-healing trainer applies.
        if report is not None:
            try:
                n_train = int(report.splits['train'])
            except (KeyError, TypeError, ValueError) as exc:
                return False, f"dataset preparation report is corrupt: {exc}"
        else:
            try:
                n_train = effective_train_row_count(record.dataset_id, PrepareConfig())
            except (ValueError, FileNotFoundError) as exc:
                return False, f"dataset cannot be prepared for training: {exc}"

        if n_train < MIN_TRAIN_ROWS:
            return False, (
                f"post-preparation train split has {n_train} rows; training and "
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
