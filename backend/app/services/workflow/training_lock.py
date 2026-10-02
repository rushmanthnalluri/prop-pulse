"""Cross-process training admission lock for the workflow service.

The workflow trainer is CPU-heavy and writes shared model/job artifacts. A
process-local threading.Lock is insufficient when uvicorn runs more than one
worker or the deployment has multiple API processes. This module uses a
filesystem lock (filelock) so admission is serialized across processes while
the existing status-file protocol remains the source of job truth.

The lock is intentionally held for the lifetime of a training subprocess, not
just the POST request. Preprocessing uses the same lock for the duration of
its write, preventing a re-prepare from changing the split fingerprint while
a job is training.
"""
from __future__ import annotations

import json
import os
from contextlib import AbstractContextManager
from typing import Any

from filelock import FileLock, Timeout

from ml.workflow.datasets import WORKFLOW_MODELS_ROOT

__all__ = ["TrainingAdmissionLock", "read_training_owner"]

LOCK_PATH = WORKFLOW_MODELS_ROOT / ".training.lock"
OWNER_PATH = WORKFLOW_MODELS_ROOT / ".training.lock.json"


def _write_owner(payload: dict[str, Any]) -> None:
    OWNER_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OWNER_PATH.with_name(OWNER_PATH.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, OWNER_PATH)


def read_training_owner() -> dict[str, Any] | None:
    """Return the current lock owner's metadata when the lock is held."""
    lock = FileLock(str(LOCK_PATH))
    try:
        lock.acquire(timeout=0)
    except Timeout:
        try:
            payload = json.loads(OWNER_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None
    else:
        lock.release()
        return None


class TrainingAdmissionLock(AbstractContextManager["TrainingAdmissionLock"]):
    """Exclusive cross-process training/preparation lock.

    acquire uses a non-blocking timeout so HTTP callers can return a
    deterministic 409 rather than waiting behind a multi-minute model fit.
    """

    def __init__(self, *, dataset_id: str, job_id: str | None, operation: str) -> None:
        self.dataset_id = dataset_id
        self.job_id = job_id
        self.operation = operation
        self._lock = FileLock(str(LOCK_PATH), timeout=0)
        self._acquired = False

    def acquire(self) -> bool:
        """Try to acquire the exclusive lock; return False when busy."""
        try:
            self._lock.acquire(timeout=0)
        except Timeout:
            return False
        self._acquired = True
        _write_owner(
            {
                "dataset_id": self.dataset_id,
                "job_id": self.job_id,
                "operation": self.operation,
            }
        )
        return True

    def release(self) -> None:
        """Release the lock and clear matching owner metadata."""
        if not self._acquired:
            return
        try:
            try:
                payload = json.loads(OWNER_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                payload = None
            if (
                isinstance(payload, dict)
                and payload.get("dataset_id") == self.dataset_id
                and payload.get("job_id") == self.job_id
                and payload.get("operation") == self.operation
            ):
                OWNER_PATH.unlink(missing_ok=True)
        finally:
            self._lock.release()
            self._acquired = False

    def __enter__(self) -> "TrainingAdmissionLock":
        if not self.acquire():
            owner = read_training_owner()
            detail = (
                f"busy with job {owner.get('job_id')} on dataset "
                f"{owner.get('dataset_id')}"
                if owner
                else "busy with another training/preprocessing operation"
            )
            raise RuntimeError(detail)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()
