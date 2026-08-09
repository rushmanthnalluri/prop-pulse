"""Shared FastAPI dependencies — accessors for lifespan-loaded app state."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Request

from backend.app.services.cluster_service import ClusterService
from backend.app.services.monitoring_service import MonitoringService
from backend.app.services.prediction_service import PredictionService
from backend.app.services.workflow import (
    WorkflowDatasetService,
    WorkflowEdaService,
    WorkflowJobService,
    WorkflowPredictService,
)

__all__ = [
    "get_prediction_service",
    "get_cluster_service",
    "get_monitoring_service",
    "get_champion",
    "model_version_payload",
    "model_version_string",
    "get_workflow_data_dir",
    "get_workflow_dataset_service",
    "get_workflow_eda_service",
    "get_workflow_job_service",
    "get_workflow_predict_service",
]


def get_prediction_service(request: Request) -> PredictionService:
    """Champion-backed prediction service (loaded at startup)."""
    return request.app.state.prediction_service


def get_cluster_service(request: Request) -> ClusterService:
    """Micro-market cluster service (loaded at startup)."""
    return request.app.state.cluster_service


def get_monitoring_service(request: Request) -> MonitoringService:
    """Request-metrics + drift-summary service (loaded at startup)."""
    return request.app.state.monitoring_service


def get_champion(request: Request) -> dict[str, Any]:
    """Parsed ``models/champion.json``."""
    return request.app.state.champion


def model_version_payload(request: Request) -> dict[str, str]:
    """``{regression, classification, feature_version}`` response section."""
    return dict(request.app.state.model_version)


def model_version_string(request: Request) -> str:
    """Compact ``name_version+name_version`` tag for the prediction log."""
    return request.app.state.model_version_string


# ---------------------------------------------------------------------------
# Workflow services (workflow-architecture §5.3)
#
# These hold no champion state, so they are NOT lifespan-loaded: each request
# gets a fresh instance built from settings/REPO_ROOT (module-level state in
# the job service — the single-job guard and the orphan sweep — is
# process-wide by design, §4.8).
# ---------------------------------------------------------------------------


def get_workflow_data_dir(request: Request) -> Path:
    """The configured data directory (upload storage root lives beneath it)."""
    return request.app.state.settings.resolved_data_dir


def get_workflow_dataset_service(request: Request) -> WorkflowDatasetService:
    """Workflow dataset lifecycle service (constructed per request)."""
    return WorkflowDatasetService()


def get_workflow_eda_service(request: Request) -> WorkflowEdaService:
    """Workflow EDA dispatch service (constructed per request)."""
    return WorkflowEdaService()


def get_workflow_job_service(request: Request) -> WorkflowJobService:
    """Workflow job service (per request; first construction runs the orphan sweep)."""
    return WorkflowJobService()


def get_workflow_predict_service(request: Request) -> WorkflowPredictService:
    """Sandbox prediction service (constructed per request)."""
    return WorkflowPredictService()
