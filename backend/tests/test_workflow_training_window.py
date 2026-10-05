"""Training eligibility regression tests."""
from __future__ import annotations

import pytest

from backend.app.services.workflow.datasets import WorkflowDatasetService
from ml.workflow import datasets as wf_datasets


def _record(n_rows: int) -> wf_datasets.DatasetRecord:
    return wf_datasets.DatasetRecord(
        dataset_id='ds_00000001',
        name='window-test.csv',
        source='upload',
        created_at='2026-01-01T00:00:00+00:00',
        sha256_12='0123456789ab',
        n_rows=n_rows,
        n_cols=81,
    )


def test_train_window_uses_post_preparation_count(monkeypatch: pytest.MonkeyPatch) -> None:
    """A nominally large-enough raw dataset is blocked after outlier trimming."""
    monkeypatch.setattr(
        'backend.app.services.workflow.datasets.effective_train_row_count',
        lambda dataset_id, config: 149,
    )
    ok, reason = WorkflowDatasetService._train_window(_record(216))
    assert ok is False
    assert 'post-preparation train split has 149 rows' in reason


def test_train_window_allows_effective_minimum(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        'backend.app.services.workflow.datasets.effective_train_row_count',
        lambda dataset_id, config: 150,
    )
    ok, reason = WorkflowDatasetService._train_window(_record(216))
    assert ok is True
    assert reason is None
