"""Cross-process admission lock for workflow training and preprocessing."""
from __future__ import annotations

import json
import os
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

from filelock import FileLock, Timeout

from ml.workflow import datasets as wf_datasets

__all__ = ["TrainingAdmissionLock", "read_training_owner"]


def _lock_path() -> Path:
    return wf_datasets.WORKFLOW_MODELS_ROOT / ".training.lock"


def _owner_path() -> Path:
    return wf_datasets.WORKFLOW_MODELS_ROOT / ".training.lock.json"


def _write_owner(payload: dict[str, Any]) -> None:
    path = _owner_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_training_owner() -> dict[str, Any] | None:
    """Return lock owner metadata when another process currently holds the lock."""
    lock = FileLock(str(_lock_path()))
    try:
        lock.acquire(timeout=0)
    except Timeout:
        try:
            payload = json.loads(_owner_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return payload if isinstance(payload, dict) else None
    else:
        lock.release()
        return None


class TrainingAdmissionLock(AbstractContextManager["TrainingAdmissionLock"]):
    """Non-blocking exclusive lock shared by every workflow process."""

    def __init__(self, *, dataset_id: str, job_id: str | None, operation: str) -> None:
        self.dataset_id = dataset_id
        self.job_id = job_id
        self.operation = operation
        self._lock = FileLock(str(_lock_path()), timeout=0)
        self._acquired = False

    def acquire(self) -> bool:
        """Try to acquire the shared workflow lock."""
        try:
            self._lock.acquire(timeout=0)
        except Timeout:
            return False
        self._acquired = True
        try:
            _write_owner(
                {
                    "dataset_id": self.dataset_id,
                    "job_id": self.job_id,
                    "operation": self.operation,
                }
            )
        except Exception:
            self._lock.release()
            self._acquired = False
            raise
        return True

    def release(self) -> None:
        """Release the lock and clear its owner metadata."""
        if not self._acquired:
            return
        try:
            try:
                payload = json.loads(_owner_path().read_text(encoding="utf-8"))
            except (OSError, ValueError):
                payload = None
            if (
                isinstance(payload, dict)
                and payload.get("dataset_id") == self.dataset_id
                and payload.get("job_id") == self.job_id
                and payload.get("operation") == self.operation
            ):
                _owner_path().unlink(missing_ok=True)
        finally:
            self._lock.release()
            self._acquired = False

    def __enter__(self) -> "TrainingAdmissionLock":
        if not self.acquire():
            owner = read_training_owner()
            detail = (
                f"busy with job {owner.get('job_id')} on dataset {owner.get('dataset_id')}"
                if owner
                else "busy with another training/preprocessing operation"
            )
            raise RuntimeError(detail)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.release()
