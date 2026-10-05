from __future__ import annotations

from pathlib import Path

import pytest

from ml.workflow import datasets as wf_datasets
from ml.workflow.admission import TrainingAdmissionLock, read_training_owner


def test_training_admission_lock_is_shared_by_processes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wf_datasets, "WORKFLOW_MODELS_ROOT", tmp_path)
    first = TrainingAdmissionLock(dataset_id="d1", job_id="job_a", operation="training")
    second = TrainingAdmissionLock(dataset_id="d2", job_id="job_b", operation="training")
    assert first.acquire() is True
    try:
        assert second.acquire() is False
        owner = read_training_owner()
        assert owner is not None
        assert owner["job_id"] == "job_a"
        assert owner["dataset_id"] == "d1"
    finally:
        first.release()
    assert second.acquire() is True
    second.release()


def test_training_admission_lock_cleans_owner_on_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(wf_datasets, "WORKFLOW_MODELS_ROOT", tmp_path)
    lock = TrainingAdmissionLock(dataset_id="d1", job_id="job_a", operation="training")
    assert lock.acquire() is True
    assert (tmp_path / ".training.lock.json").exists()
    lock.release()
    assert read_training_owner() is None
    assert not (tmp_path / ".training.lock.json").exists()
