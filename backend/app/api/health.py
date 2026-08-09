"""Health and metrics endpoints: ``/health``, ``/metrics``."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from backend.app.api.deps import get_monitoring_service
from backend.app.schemas.responses import HealthResponse, MetricsResponse
from backend.app.services.monitoring_service import MonitoringService

router = APIRouter(tags=["monitoring"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> dict[str, Any]:
    """Liveness plus per-model loaded status."""
    return {
        "status": "ok",
        "models_loaded": dict(request.app.state.models_loaded),
    }


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    service: MonitoringService = Depends(get_monitoring_service),
) -> dict[str, Any]:
    """Request counters, average latency, and the latest drift summary."""
    return service.snapshot()
