"""Service layer for the guided-ML-workflow API (workflow-architecture §5.2).

Thin adapters over ``ml.workflow.*``: they own the exception -> HTTP mapping
(the mapping contract pinned in ``ml/workflow/datasets.py``'s docstring) and
the HTTP-side assembly (dataset ``state``, job status reads, models merge).
They hold no champion state and are constructed lazily per request via
``backend/app/api/deps.py`` (§5.3 — the lifespan stays untouched).
"""
from __future__ import annotations

from backend.app.services.workflow.datasets import WorkflowDatasetService
from backend.app.services.workflow.eda import WorkflowEdaService
from backend.app.services.workflow.jobs import WorkflowJobService
from backend.app.services.workflow.predict import WorkflowPredictService

__all__ = [
    "WorkflowDatasetService",
    "WorkflowEdaService",
    "WorkflowJobService",
    "WorkflowPredictService",
]
