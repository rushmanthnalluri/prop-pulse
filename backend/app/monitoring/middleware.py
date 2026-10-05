"""Request metrics middleware — per-request counters + latency (SPEC §10)."""
from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

__all__ = ["MetricsMiddleware", "route_template_key", "START_TIME_SCOPE_KEY", "REQUEST_ID_SCOPE_KEY", "REQUEST_ID_HEADER"]

logger = logging.getLogger(__name__)

#: Scope key under which :class:`MetricsMiddleware` stashes the request start
#: time. The generic-500 handler runs outside the user middleware stack
#: (Starlette ``ServerErrorMiddleware``), so it reads the start time back from
#: the scope to record a realistic latency (AUD-03).
START_TIME_SCOPE_KEY = "proppulse.metrics_started_at"
REQUEST_ID_SCOPE_KEY = "proppulse.request_id"
REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

#: Metrics bucket for requests that matched no route (404 probes): arbitrary
#: URLs must not grow ``requests_by_path`` without bound (AUD-04).
UNMATCHED_PATH_KEY = "unmatched"


def route_template_key(request: Request) -> str:
    """Metrics key for one request: the matched route's path template.

    FastAPI stores the matched route in ``request.scope["route"]``; its
    ``path`` is the template (e.g. ``/predict/price``), never the raw URL.
    Requests without a match fall back to :data:`UNMATCHED_PATH_KEY`.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path else UNMATCHED_PATH_KEY


class MetricsMiddleware(BaseHTTPMiddleware):
    """Record request count and latency into the monitoring service.

    The service instance is resolved per request from ``app.state`` so the
    middleware can be attached before the lifespan has populated state.
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        """Time the request and record it (never blocks the response)."""
        started = time.perf_counter()
        request.scope[START_TIME_SCOPE_KEY] = started
        incoming_id = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming_id if _REQUEST_ID_RE.fullmatch(incoming_id) else uuid.uuid4().hex
        request.scope[REQUEST_ID_SCOPE_KEY] = request_id
        request.state.request_id = request_id

        monitoring = getattr(request.app.state, "monitoring_service", None)
        if monitoring is not None:
            try:
                monitoring.begin_request()
            except Exception as exc:  # noqa: BLE001
                logger.warning("metrics begin_request failed: %s", exc)

        response = await call_next(request)
        latency_ms = (time.perf_counter() - started) * 1000.0
        if monitoring is not None:
            try:
                monitoring.record_request(
                    route_template_key(request), response.status_code, latency_ms
                )
            except Exception as exc:  # noqa: BLE001 — metrics must never break serving
                logger.warning(
                    "metrics recording failed for %s request_id=%s: %s",
                    request.url.path,
                    request_id,
                    exc,
                )
        response.headers[REQUEST_ID_HEADER] = request_id
        return response
