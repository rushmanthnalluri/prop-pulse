"""Cross-process workflow admission lock tests."""
from __future__ import annotations

from pathlib import Path

import pytest

from ml.workflow import datasets
from ml.workflow.admission import TrainingAdmissionLock, read_training_owner


def test_admission_lock_is_shared_and_reports_owner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / 'models'
    root.mkdir()
    monkeypatch.setattr(datasets, 'WORKFLOW_MODELS_ROOT', root)

    first = TrainingAdmissionLock(dataset_id='d1', job_id='job_a', operation='training')
    second = TrainingAdmissionLock(dataset_id='d2', job_id='job_b', operation='training')

    assert first.acquire() is True
    try:
        assert second.acquire() is False
        owner = read_training_owner()
        assert owner == {'dataset_id': 'd1', 'job_id': 'job_a', 'operation': 'training'}
    finally:
        first.release()

    assert second.acquire() is True
    second.release()
    assert read_training_owner() is None
