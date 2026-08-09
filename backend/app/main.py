"""FastAPI application factory for the PropPulse backend (SPEC §8).

The lifespan loads every serving artifact once into ``app.state`` (champion
models, ``champion.json``, neighborhood stats, micro-market lookup, metrics
registry, prediction logger). Routes are mounted at root level — no
``/api/v1`` prefix (documented in ``backend/README.md``).

Run from the repo root::

    .venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import json
import logging
import math
import time
import warnings
from contextlib import asynccontextmanager
from typing import Any

import joblib
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.api import comps, health, market, model, predict
from backend.app.api import (
    workflow_datasets,
    workflow_eda,
    workflow_jobs,
    workflow_preprocess,
)
from backend.app.config import Settings, get_settings
from backend.app.monitoring.middleware import (
    START_TIME_SCOPE_KEY,
    MetricsMiddleware,
    route_template_key,
)
from backend.app.monitoring.prediction_log import PredictionLogger
from backend.app.security import (
    SECURITY_HEADERS,
    BodySizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from backend.app.services.cluster_service import ClusterService
from backend.app.services.comps_service import CompsService
from backend.app.services.monitoring_service import MonitoringService
from backend.app.services.prediction_service import (
    PredictionService,
    force_single_threaded,
)
from ml.clustering.serve import MicroMarketLookup
from ml.features.stats import load_neighborhood_stats
from ml.monitoring.reference import load_reference_stats
from ml.paths import REPO_ROOT
from ml.tracking import feature_version

logger = logging.getLogger(__name__)

# AUD-11: under concurrent /predict load on Python 3.14, scikit-learn's
# joblib shim emits a UserWarning flood from ``sklearn.utils.parallel``
# (~140+ lines per request; docs/audit/performance.md F1). The warning is
# operationally meaningless for serving (predictions are unaffected), so it
# is suppressed process-wide. Two layers are needed on this (non-free-
# threaded) build, because warning filters are process-global there and
# sklearn's own ``catch_warnings()``/``resetwarnings()`` inside its shim race
# with concurrent requests, transiently emptying the global filter list:
#
# 1. this ignore rule covers every non-racing context, and
# 2. the ``showwarning`` chokepoint below drops the message deterministically
#    even when a race let the warn fire.
warnings.filterwarnings(
    "ignore",
    message=r"`sklearn\.utils\.parallel\.delayed` should be used with",
    category=UserWarning,
    module=r"sklearn\.utils\.parallel",
)

_showwarning_orig = warnings.showwarning


def _showwarning_drop_sklearn_parallel_flood(
    message: Warning,
    category: type[Warning],
    filename: str,
    lineno: int,
    file: Any | None = None,
    line: str | None = None,
) -> None:
    """Drop the sklearn ``parallel.delayed`` UserWarning; delegate the rest."""
    if category is UserWarning and "sklearn.utils.parallel.delayed" in str(message):
        return
    _showwarning_orig(message, category, filename, lineno, file=file, line=line)


warnings.showwarning = _showwarning_drop_sklearn_parallel_flood

#: Minimal valid serving payload used to warm the SHAP explainer singleton
#: during startup (fields per SPEC §8; values are arbitrary but plausible).
_SHAP_WARMUP_PAYLOAD: dict[str, Any] = {
    "neighborhood": "NAmes",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 0,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1500,
    "lot_area": 8000,
    "total_bsmt_sf": 1000,
    "year_built": 1975,
    "overall_qual": 6,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}


def _load_champion(settings: Settings) -> dict[str, Any]:
    """Read ``champion.json`` from the configured model directory."""
    path = settings.resolved_model_dir / "champion.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _sanitize_validation_errors(errors: list[Any]) -> list[Any]:
    """Replace non-finite floats in pydantic error payloads with strings.

    Python's ``json.loads`` accepts ``NaN``/``Infinity``/``1e999`` literals;
    pydantic rejects them, but the raw error dict echoes the non-finite
    ``input`` value — which Starlette's strict JSON renderer
    (``allow_nan=False``) cannot serialize, turning a client-error 422 into
    an unhandled 500 (AUD-01). Sanitizing keeps the 422 contract intact.
    """

    def _clean(value: Any) -> Any:
        if isinstance(value, float) and not math.isfinite(value):
            return str(value)
        if isinstance(value, dict):
            return {key: _clean(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [_clean(item) for item in value]
        return value

    return [_clean(error) for error in errors]


def _resolve_artifact(path_str: str) -> Any:
    """Resolve a repo-relative artifact path from ``champion.json``."""
    path = REPO_ROOT / path_str
    return path if path.exists() else None


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app; artifacts load during the lifespan startup."""
    settings = settings or get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(levelname)s %(name)s: %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        """Load all champion artifacts into ``app.state`` (SPEC §8)."""
        champion = _load_champion(settings)

        regression_path = _resolve_artifact(champion["regression"]["path"])
        classification_path = _resolve_artifact(champion["classification"]["path"])
        models_loaded = {
            "regression": regression_path is not None,
            "classification": classification_path is not None,
        }
        if not all(models_loaded.values()):
            missing = [name for name, ok in models_loaded.items() if not ok]
            raise RuntimeError(f"champion artifacts missing: {missing}")

        neighborhood_stats = load_neighborhood_stats()
        micro_market = MicroMarketLookup()
        feature_list_path = settings.resolved_model_dir / "feature_list.json"
        features_payload = json.loads(feature_list_path.read_text(encoding="utf-8"))
        # Train distribution extremes (outer PSI bin edges) for the confidence
        # block's out-of-range checks (Task: confidence honesty block).
        reference_ranges = {
            name: (float(spec["bin_edges"][0]), float(spec["bin_edges"][-1]))
            for name, spec in load_reference_stats()["numeric"].items()
        }

        app.state.settings = settings
        app.state.champion = champion
        app.state.neighborhood_stats = neighborhood_stats
        app.state.model_features = list(features_payload["features"])
        app.state.model_version = {
            "regression": f"{champion['regression']['name']}_{champion['regression']['version']}",
            "classification": (
                f"{champion['classification']['name']}_{champion['classification']['version']}"
            ),
            "feature_version": feature_version(feature_list_path),
        }
        app.state.model_version_string = (
            f"{app.state.model_version['regression']}"
            f"+{app.state.model_version['classification']}"
        )
        app.state.prediction_service = PredictionService(
            regression_model=joblib.load(regression_path),
            classification_model=force_single_threaded(joblib.load(classification_path)),
            neighborhood_stats=neighborhood_stats,
            threshold=champion["classification"]["threshold"],
            residual_interval=champion["regression"]["residual_interval"],
            reference_ranges=reference_ranges,
        )
        app.state.cluster_service = ClusterService(micro_market)
        app.state.comps_service = CompsService()
        app.state.monitoring_service = MonitoringService(settings.resolved_drift_report_path)
        app.state.prediction_logger = PredictionLogger(settings.resolved_prediction_log_path)
        app.state.models_loaded = models_loaded

        # Static GET payloads: built once here instead of per request. The
        # importance artifact is read once too — a missing/malformed file is
        # cached as an error state so /model/importance keeps returning 503.
        app.state.market_clusters_payload = app.state.cluster_service.market_clusters()
        app.state.market_trends_payload = app.state.comps_service.market_trends(
            {cid: entry["label"] for cid, entry in micro_market.clusters.items()}
        )
        app.state.model_info_payload = model.build_model_info_payload(app.state)
        app.state.model_importance = model.load_model_importance(settings.resolved_model_dir)

        # Warm the lazy SHAP explainer singleton so the first user request
        # does not pay the ~4-5 s build (reports/PERFORMANCE.md). Best-effort:
        # any failure leaves the lazy first-request path intact and never
        # blocks startup.
        try:
            from ml.explainability.service import explain_instance  # noqa: PLC0415

            explain_instance(
                app.state.prediction_service.build_features(_SHAP_WARMUP_PAYLOAD), top_n=5
            )
            logger.info("SHAP explainer warmed during startup")
        except Exception as exc:  # noqa: BLE001 — warm-up must never block startup
            logger.warning("SHAP warm-up failed; first request will build it lazily: %s", exc)

        logger.info(
            "PropPulse API ready: regression=%s classification=%s feature_version=%s",
            app.state.model_version["regression"],
            app.state.model_version["classification"],
            app.state.model_version["feature_version"],
        )
        yield

    app = FastAPI(
        title="PropPulse API",
        version="1.0.0",
        description=(
            "Property valuation: price (ridge, log1p target), 30-day sale "
            "probability (calibrated random forest; SIMULATED target, ADR-3), "
            "micro-market clusters, SHAP explanations."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(MetricsMiddleware)
    # Security hardening (reports/SECURITY.md): added after MetricsMiddleware so
    # SecurityHeadersMiddleware is the outermost user middleware — its headers
    # then land on every response that passes through the stack, including the
    # 413s produced by BodySizeLimitMiddleware.
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    app.include_router(health.router)
    app.include_router(predict.router)
    app.include_router(model.router)
    app.include_router(market.router)
    app.include_router(comps.router)
    # Guided-ML-workflow routes (workflow-architecture §5.3): root-level
    # /workflow/* like every other router; lifespan is untouched — workflow
    # services are per-request (backend/app/api/deps.py).
    app.include_router(workflow_datasets.router)
    app.include_router(workflow_eda.router)
    app.include_router(workflow_preprocess.router)
    app.include_router(workflow_jobs.router)

    @app.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """422 with field details; non-finite inputs sanitized (AUD-01)."""
        return JSONResponse(
            status_code=422,
            content={"detail": jsonable_encoder(_sanitize_validation_errors(exc.errors()))},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """Generic 500 — log internally, never leak stack traces (SPEC §8).

        Starlette's ``ServerErrorMiddleware`` runs outside the user middleware
        stack, so this response bypasses ``SecurityHeadersMiddleware`` — the
        security headers are attached here explicitly. The same ordering means
        ``MetricsMiddleware`` never sees these failures, so the error is
        counted into the monitoring service here directly (AUD-03).
        """
        logger.exception("unhandled error on %s %s", request.method, request.url.path)
        monitoring = getattr(request.app.state, "monitoring_service", None)
        if monitoring is not None:
            try:
                started_at = request.scope.get(START_TIME_SCOPE_KEY)
                latency_ms = (
                    (time.perf_counter() - started_at) * 1000.0
                    if started_at is not None
                    else 0.0
                )
                monitoring.record_request(route_template_key(request), 500, latency_ms)
            except Exception as metrics_exc:  # noqa: BLE001 — must not mask the 500
                logger.warning("metrics recording failed in 500 handler: %s", metrics_exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
            headers=SECURITY_HEADERS,
        )

    return app


app = create_app()
