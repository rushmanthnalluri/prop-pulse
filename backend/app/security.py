"""HTTP security hardening middleware (see ``reports/SECURITY.md``).

Two small middlewares wired in ``backend.app.main.create_app``:

- :class:`SecurityHeadersMiddleware` — sets baseline security headers on every
  response (outermost user middleware so error responses are covered too).
- :class:`BodySizeLimitMiddleware` — rejects over-sized request bodies with
  413 before any parsing happens.

The generic-500 path is a special case: Starlette's ``ServerErrorMiddleware``
sits *outside* the user middleware stack, so its response never passes through
:class:`SecurityHeadersMiddleware`. ``main.py`` therefore attaches
:data:`SECURITY_HEADERS` to the 500 ``JSONResponse`` directly.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

__all__ = [
    "SECURITY_HEADERS",
    "MAX_BODY_BYTES",
    "BODY_LIMIT_RULES",
    "SecurityHeadersMiddleware",
    "BodySizeLimitMiddleware",
]

#: Baseline headers applied to every API response.
SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    # All responses are API JSON (model metadata/predictions) — never cache.
    "Cache-Control": "no-store",
}

#: Maximum accepted request body (64 KiB). Legit ``PropertyInput`` payloads
#: are well under 1 KiB; anything larger is rejected with 413 before parsing.
MAX_BODY_BYTES = 64 * 1024

#: Per-route body-limit overrides as ``(method, exact path, limit_bytes)``,
#: checked in order before falling back to :data:`MAX_BODY_BYTES`
#: (workflow-architecture §5.3): the CSV upload route accepts up to 10 MiB
#: (≈30k Ames-width rows; mirrors the workflow's documented cap); every other
#: route keeps the global 64 KiB limit. Exact path match only.
BODY_LIMIT_RULES: tuple[tuple[str, str, int], ...] = (
    ("POST", "/workflow/datasets", 10 * 1024 * 1024),
)


def _resolve_body_limit(method: str, path: str) -> int:
    """The enforced body limit for ``(method, path)``: first rule match, else global."""
    for rule_method, rule_path, limit in BODY_LIMIT_RULES:
        if method == rule_method and path == rule_path:
            return limit
    return MAX_BODY_BYTES


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set :data:`SECURITY_HEADERS` on every response that passes through."""

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        """Add the security headers to the downstream response."""
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject bodies larger than the resolved limit with HTTP 413.

    The limit is :data:`MAX_BODY_BYTES` unless a :data:`BODY_LIMIT_RULES`
    entry matches ``(method, exact path)`` (e.g. the 10 MiB workflow upload
    route). Two enforcement paths:

    - ``Content-Length`` present → the declared size is checked before the
      body is read or parsed (fast path).
    - No declared length (e.g. ``Transfer-Encoding: chunked``) → the body is
      consumed chunk by chunk and counted, and the request is rejected as
      soon as the running total exceeds the limit (AUD-02). Bodies within
      the limit are handed downstream through the request's body cache — the
      same mechanism ``Request.body()`` uses — so parsing is unaffected.
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        """Return 413 when the declared or streamed body size exceeds the resolved limit."""
        limit = _resolve_body_limit(request.method, request.url.path)
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:  # malformed header — let the app deal with it
                declared = 0
            if declared > limit:
                return _too_large_response(limit)
            return await call_next(request)

        # No declared length: count the streamed bytes and cap them (AUD-02).
        received = bytearray()
        async for chunk in request.stream():
            received.extend(chunk)
            if len(received) > limit:
                return _too_large_response(limit)
        # Feed the consumed body downstream (Request.body() sets the same
        # attribute; BaseHTTPMiddleware forwards the cached body to the app).
        request._body = bytes(received)  # noqa: SLF001
        return await call_next(request)


def _too_large_response(limit: int) -> JSONResponse:
    """Uniform 413 payload for both the declared-size and streamed paths."""
    return JSONResponse(
        status_code=413,
        content={"detail": f"Request body too large; limit is {limit} bytes"},
    )
