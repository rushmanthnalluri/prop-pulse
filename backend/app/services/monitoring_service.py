"""Monitoring service — request metrics registry + drift summary exposure.

Counters/latency are populated by
:class:`backend.app.monitoring.middleware.MetricsMiddleware`; the drift summary
is read from ``reports/drift/latest.json`` (written by
``ml.monitoring.drift_check``) with a ``no_data`` fallback (SPEC §10).
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Any

from ml.paths import REPO_ROOT

logger = logging.getLogger(__name__)

__all__ = ["MonitoringService"]


def _scrub_server_paths(payload: dict[str, Any]) -> dict[str, Any]:
    """Relativize absolute filesystem paths in a served drift report.

    ``reports/drift/latest.json`` is served verbatim, but older reports (and
    any generated with an out-of-repo ``--log`` path) can carry absolute
    server paths in ``log_path`` and embedded in ``recommendation_text`` —
    disclosing host layout through ``GET /metrics``. The payload shape is
    unchanged: same keys, same types, only the path values are rewritten.
    """
    raw = payload.get("log_path")
    if not isinstance(raw, str) or not raw:
        return payload
    candidate = Path(raw)
    if not candidate.is_absolute():
        return payload
    try:
        display = candidate.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        display = candidate.name
    scrubbed = dict(payload)
    scrubbed["log_path"] = display
    text = scrubbed.get("recommendation_text")
    if isinstance(text, str):
        scrubbed["recommendation_text"] = text.replace(raw, display)
    return scrubbed


class MonitoringService:
    """Thread-safe request metrics + latest drift report reader.

    Args:
        drift_report_path: Location of ``reports/drift/latest.json``.
    """

    def __init__(self, drift_report_path: Path) -> None:
        self._drift_report_path = Path(drift_report_path)
        self._started_at = time.monotonic()
        self._lock = threading.Lock()
        self._requests_total = 0
        self._errors_total = 0
        self._requests_by_path: dict[str, int] = {}
        self._latency_sum_ms = 0.0

    def record_request(self, path: str, status_code: int, latency_ms: float) -> None:
        """Record one served request (called by the metrics middleware)."""
        with self._lock:
            self._requests_total += 1
            self._requests_by_path[path] = self._requests_by_path.get(path, 0) + 1
            self._latency_sum_ms += float(latency_ms)
            if status_code >= 500:
                self._errors_total += 1

    def latest_drift_summary(self) -> dict[str, Any]:
        """Latest drift report, or a ``no_data`` placeholder (SPEC §10)."""
        path = self._drift_report_path
        if not path.exists():
            return {
                "status": "no_data",
                "detail": "reports/drift/latest.json not found — run "
                "`python -m ml.monitoring.drift_check` after predictions are logged.",
            }
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:  # JSONDecodeError + UnicodeDecodeError
            logger.warning("unreadable drift report %s: %s", path, exc)
            # Never echo the exception (it can contain absolute server paths).
            return {"status": "no_data", "detail": "unreadable drift report"}
        if not isinstance(payload, dict):
            return {"status": "no_data"}
        return _scrub_server_paths(payload)

    def snapshot(self) -> dict[str, Any]:
        """Full ``GET /metrics`` payload: counters, avg latency, drift summary."""
        # Disk I/O happens outside the lock so a stalled filesystem cannot
        # block record_request() for in-flight requests (AUD-21).
        drift = self.latest_drift_summary()
        with self._lock:
            total = self._requests_total
            avg_latency = self._latency_sum_ms / total if total else 0.0
            return {
                "requests_total": total,
                "errors_total": self._errors_total,
                "requests_by_path": dict(self._requests_by_path),
                "avg_latency_ms": round(avg_latency, 3),
                "uptime_seconds": round(time.monotonic() - self._started_at, 3),
                "drift": drift,
            }
