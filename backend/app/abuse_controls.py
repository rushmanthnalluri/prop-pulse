"""Bounded, conservative abuse controls for public PropPulse routes.

Limits are deliberately keyed only by the ASGI peer address (request.client.host).
Never trust a raw X-Forwarded-For value here: it is caller-controlled unless a
trusted proxy/server has normalized it. This in-process limiter is a defense
in depth for the current single-instance deployment, not a distributed quota
system; use a shared gateway/Redis limiter before scaling horizontally.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# (requests, window seconds). Workflow mutations and training are intentionally
# much tighter than read-only routes because they consume storage/CPU/memory.
DEFAULT_LIMITS: dict[str, tuple[int, int]] = {
    "prediction": (30, 60),
    "workflow_write": (8, 60),
    "training": (2, 60),
    "general": (120, 60),
}
_HEALTH_PATHS = {"/", "/health", "/ready", "/openapi.json", "/docs", "/redoc"}


def _route_bucket(method: str, path: str) -> tuple[str, tuple[int, int]] | None:
    if method == "OPTIONS" or path in _HEALTH_PATHS or path.startswith("/docs/"):
        return None
    if method == "POST" and path in {
        "/predict", "/predict/price", "/predict/sale-probability",
        "/workflow/jobs",
    }:
        return "prediction", DEFAULT_LIMITS["prediction"]
    if path.startswith("/workflow/") and method in {"POST", "PUT", "PATCH", "DELETE"}:
        if method == "POST" and path.endswith("/jobs"):
            return "training", DEFAULT_LIMITS["training"]
        return "workflow_write", DEFAULT_LIMITS["workflow_write"]
    return "general", DEFAULT_LIMITS["general"]


class AbuseControlMiddleware(BaseHTTPMiddleware):
    """Per-peer rolling-window limits with bounded state and Retry-After."""

    def __init__(self, app, *, max_buckets: int = 10_000) -> None:
        super().__init__(app)
        self._lock = threading.Lock()
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._max_buckets = max_buckets
        # Environment overrides support operations without source changes.
        self._limits = dict(DEFAULT_LIMITS)
        for name, (default_count, default_window) in DEFAULT_LIMITS.items():
            try:
                count = int(os.getenv(f"PROPULSE_RATE_LIMIT_{name.upper()}", default_count))
                window = int(os.getenv(f"PROPULSE_RATE_WINDOW_{name.upper()}", default_window))
                if count > 0 and window > 0:
                    self._limits[name] = (count, window)
            except (TypeError, ValueError):
                # Invalid optional override falls back to safe built-in defaults.
                pass

    async def dispatch(self, request: Request, call_next) -> Response:
        route = _route_bucket(request.method.upper(), request.url.path)
        if route is None:
            return await call_next(request)

        category, _ = route
        limit, window = self._limits[category]
        # Use the direct peer only; do not accept spoofable forwarding headers.
        peer = request.client.host if request.client is not None else "unknown"
        key = (peer, category)
        now = time.monotonic()
        with self._lock:
            events = self._events.get(key)
            if events is None:
                # Bound memory if clients rotate source addresses.
                if len(self._events) >= self._max_buckets:
                    oldest_key = min(
                        self._events,
                        key=lambda bucket: self._events[bucket][0]
                        if self._events[bucket] else now,
                    )
                    self._events.pop(oldest_key, None)
                events = deque()
                self._events[key] = events
            while events and now - events[0] >= window:
                events.popleft()
            if len(events) >= limit:
                retry_after = max(1, int(window - (now - events[0])))
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded; retry later"},
                    headers={"Retry-After": str(retry_after)},
                )
            events.append(now)

        response = await call_next(request)
        response.headers.setdefault("X-RateLimit-Limit", str(limit))
        return response
