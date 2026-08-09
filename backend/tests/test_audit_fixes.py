"""Regression tests for the wave-C audit fixes (docs/audit/FINDINGS.md).

Covers the backend-owned defects:

- AUD-01  NaN/±Inf/1e999 JSON literals in numeric fields → 422 (was 500).
- AUD-02  64 KiB body limit also enforced for streamed/chunked bodies.
- AUD-03  Unhandled-exception 500s are counted in ``/metrics``.
- AUD-04  ``requests_by_path`` uses route templates + an ``unmatched`` bucket.
- AUD-11  The sklearn ``parallel.delayed`` UserWarning is filtered at import.
- AUD-17  ``sale_date`` bounded to 2006-01-01..2026-12-31.
- AUD-18  ``/model/info`` + ``/model/importance`` validate via response_model.
- AUD-19  ``/model/info`` no longer exposes internal artifact paths.
- AUD-20  Settings ``.env`` lookup is anchored to the repo root.
- AUD-21  Drift disk read outside the metrics lock; recording failures logged.
- AUD-22  ``_probability`` fails loudly when ``classes_`` lacks class 1.

Run from the repo root: ``.venv/Scripts/python.exe -m pytest backend/tests -q``.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.schemas.responses import ModelImportanceResponse, ModelInfoResponse
from backend.app.security import MAX_BODY_BYTES, SECURITY_HEADERS
from backend.app.services.monitoring_service import MonitoringService
from backend.app.services.prediction_service import PredictionService
from backend.tests.test_api import MINIMAL_PAYLOAD
from ml.paths import REPO_ROOT


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """Real-champion app with a tmp prediction log (mirrors test_api)."""
    log_path = tmp_path_factory.mktemp("predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def _post_raw(client: TestClient, payload: dict) -> "object":
    """POST ``payload`` as a raw JSON body, preserving NaN/Inf literals."""
    raw = json.dumps(payload)  # json.dumps keeps NaN/Infinity literals
    return client.post(
        "/predict", content=raw.encode(), headers={"Content-Type": "application/json"}
    )


# ---------------------------------------------------------------------------
# AUD-01 — non-finite numerics → 422 (not 500)
# ---------------------------------------------------------------------------


def test_nan_inf_float_fields_rejected_422(client: TestClient) -> None:
    """NaN/±Inf in float fields → 422 with field detail (was 500, AUD-01)."""
    for field, value in (
        ("lot_frontage", float("nan")),
        ("garage_area", float("inf")),
        ("mas_vnr_area", float("-inf")),
    ):
        response = _post_raw(client, {**MINIMAL_PAYLOAD, field: value})
        assert response.status_code == 422, (field, response.status_code)
        assert field in response.text


def test_non_finite_int_fields_rejected_422(client: TestClient) -> None:
    """1e999/NaN in int fields → 422 too (overflows to inf; was 500, AUD-01)."""
    raw = json.dumps(MINIMAL_PAYLOAD)
    for label, mutant in (
        ("1e999 gr_liv_area", raw.replace('"gr_liv_area": 1500', '"gr_liv_area": 1e999')),
        ("NaN bedrooms", raw.replace('"bedrooms": 3', '"bedrooms": NaN')),
    ):
        response = client.post(
            "/predict", content=mutant.encode(), headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422, (label, response.status_code)


def test_non_finite_422_body_is_clean_json(client: TestClient) -> None:
    """The 422 body parses as JSON and carries a detail list (sanitized input)."""
    response = _post_raw(client, {**MINIMAL_PAYLOAD, "lot_frontage": float("nan")})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, list) and detail
    assert "Traceback" not in response.text


def test_finite_values_still_accepted(client: TestClient) -> None:
    """Happy path unchanged: ordinary finite values still predict (AUD-01)."""
    response = client.post("/predict/price", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# AUD-02 — streamed/chunked bodies counted against the 64 KiB limit
# ---------------------------------------------------------------------------


def _chunked(data: bytes, chunk_size: int = 8192):
    """Yield ``data`` in chunks — httpx then sends no Content-Length."""
    for offset in range(0, len(data), chunk_size):
        yield data[offset : offset + chunk_size]


def test_chunked_oversized_body_rejected_413(client: TestClient) -> None:
    """A 200 KB chunked body (no Content-Length) → 413 (was 200, AUD-02)."""
    raw = json.dumps(MINIMAL_PAYLOAD).encode()
    oversized = raw + b" " * (200 * 1024 - len(raw))
    response = client.post(
        "/predict",
        content=_chunked(oversized),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert "detail" in response.json()
    for header, value in SECURITY_HEADERS.items():
        assert response.headers.get(header) == value


def test_chunked_valid_body_accepted(client: TestClient) -> None:
    """A within-limit chunked body is parsed normally (stream handoff works)."""
    raw = json.dumps(MINIMAL_PAYLOAD).encode()
    response = client.post(
        "/predict/price",
        content=_chunked(raw),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 200, response.text
    assert 20_000 <= response.json()["estimated_price"] <= 2_000_000


# ---------------------------------------------------------------------------
# AUD-03 + AUD-04 — /metrics counting and key cardinality
# ---------------------------------------------------------------------------


def test_unhandled_500_counted_in_metrics(tmp_path: Path) -> None:
    """A forced unhandled exception increments errors_total (was 0→0, AUD-03)
    and is keyed by the matched route template (AUD-04)."""
    app = create_app(Settings(prediction_log_path=str(tmp_path / "predictions.jsonl")))

    @app.get("/_test_boom_metrics", include_in_schema=False)
    def _test_boom_metrics() -> None:  # pragma: no cover — always raises
        raise RuntimeError("boom-for-metrics")

    with TestClient(app, raise_server_exceptions=False) as test_client:
        before = test_client.get("/metrics").json()
        response = test_client.get("/_test_boom_metrics")
        assert response.status_code == 500
        after = test_client.get("/metrics").json()

    assert after["errors_total"] == before["errors_total"] + 1
    assert after["requests_by_path"].get("/_test_boom_metrics", 0) == 1


def test_unknown_paths_bucketed_as_unmatched(client: TestClient) -> None:
    """404 probes land in one 'unmatched' bucket, not raw-URL keys (AUD-04)."""
    probe = "/no-such-route-audit-probe"
    assert client.get(probe).status_code == 404
    body = client.get("/metrics").json()
    assert body["requests_by_path"].get("unmatched", 0) >= 1
    assert probe not in body["requests_by_path"]


def test_matched_requests_use_route_templates(client: TestClient) -> None:
    """Known endpoints are keyed by their path template (AUD-04)."""
    client.post("/predict/price", json=MINIMAL_PAYLOAD)
    body = client.get("/metrics").json()
    assert body["requests_by_path"].get("/predict/price", 0) >= 1


def test_metrics_recording_failure_logged_not_silent(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A metrics-recording failure warns instead of passing silently (AUD-21)
    and never breaks the response."""
    monitoring = client.app.state.monitoring_service

    def _broken(path: str, status_code: int, latency_ms: float) -> None:
        raise RuntimeError("metrics sink broken")

    monkeypatch.setattr(monitoring, "record_request", _broken)
    with caplog.at_level(logging.WARNING):
        response = client.get("/health")
    assert response.status_code == 200
    assert "metrics recording failed" in caplog.text


# ---------------------------------------------------------------------------
# AUD-11 — sklearn parallel UserWarning flood suppressed at app import
# ---------------------------------------------------------------------------


def test_sklearn_parallel_warning_flood_suppressed() -> None:
    """The sklearn ``parallel.delayed`` flood is suppressed by the app (AUD-11).

    Runs in a subprocess: pytest manages its own warning state per test, so
    the process-global rule + ``showwarning`` guard pinned by
    ``backend.app.main`` are only observable in a clean interpreter. The probe
    fires the exact message four times: before import (shows), after import
    (filter ignores it), after ``resetwarnings()`` (simulates the
    catch_warnings race that empties the global filters under load — the
    ``showwarning`` guard still drops it), and a control UserWarning (must
    still show, proving only the flood message is dropped).
    """
    flood_msg = (
        "`sklearn.utils.parallel.delayed` should be used with "
        "`sklearn.utils.parallel.Parallel` to propagate configuration"
    )

    def fire(msg: str, lineno: int) -> str:
        return (
            f"warnings.warn_explicit({msg!r}, UserWarning, 'parallel.py', {lineno},"
            " module='sklearn.utils.parallel')\n"
        )

    code = (
        "import warnings\n"
        "shown = []\n"
        "warnings.showwarning = lambda *args, **kwargs: shown.append(args)\n"
        + fire(flood_msg, 144)
        + "print('BEFORE', len(shown))\n"
        "import backend.app.main\n"  # pins the ignore rule + showwarning guard
        + fire(flood_msg, 145)
        + "print('AFTER_FILTER', len(shown))\n"
        "warnings.resetwarnings()\n"  # the race: global filters emptied
        + fire(flood_msg, 146)
        + "print('AFTER_GUARD', len(shown))\n"
        "warnings.warn('audit-control-warning', UserWarning)\n"
        "print('DELEGATED', len(shown))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert "BEFORE 1" in result.stdout  # without the app the warning shows
    assert "AFTER_FILTER 1" in result.stdout  # import-time ignore rule works
    assert "AFTER_GUARD 1" in result.stdout  # race-proof showwarning guard works
    assert "DELEGATED 2" in result.stdout  # other warnings still get through


# ---------------------------------------------------------------------------
# AUD-17 — sale_date bounds (consistent with yr_sold 2006–2026)
# ---------------------------------------------------------------------------


def test_sale_date_out_of_bounds_rejected_422(client: TestClient) -> None:
    """sale_date outside 2006-01-01..2026-12-31 → 422 (was 200, AUD-17)."""
    for value in ("1800-01-01", "2005-12-31", "2027-01-01", "2030-12-31"):
        response = client.post("/predict", json={**MINIMAL_PAYLOAD, "sale_date": value})
        assert response.status_code == 422, value
        assert "sale_date" in response.text


def test_sale_date_bounds_accepted(client: TestClient) -> None:
    """Boundary dates 2006-01-01 / 2026-12-31 remain valid."""
    for value in ("2006-01-01", "2026-12-31"):
        response = client.post(
            "/predict/price", json={**MINIMAL_PAYLOAD, "sale_date": value}
        )
        assert response.status_code == 200, (value, response.text)


# ---------------------------------------------------------------------------
# AUD-18 + AUD-19 — /model/info, /model/importance validation + path stripping
# ---------------------------------------------------------------------------


def test_model_endpoints_have_response_models(client: TestClient) -> None:
    """Both model metadata endpoints validate their payloads (AUD-18)."""
    # FastAPI 0.141 nests included routers as _IncludedRouter; descend into
    # original_router to reach the APIRoute objects.
    routes: dict[str, Any] = {}
    for route in client.app.routes:
        inner = getattr(route, "original_router", None)
        for sub in inner.routes if inner is not None else [route]:
            path = getattr(sub, "path", None)
            if path:
                routes[path] = sub
    assert routes["/model/info"].response_model is ModelInfoResponse
    assert routes["/model/importance"].response_model is ModelImportanceResponse


def test_model_info_exposes_no_artifact_paths(client: TestClient) -> None:
    """No 'path' key anywhere in /model/info; names/metrics kept (AUD-19)."""
    response = client.get("/model/info")
    assert response.status_code == 200
    body = response.json()

    def _find_path_keys(obj: object) -> list[str]:
        found: list[str] = []
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key == "path":
                    found.append(str(value))
                else:
                    found.extend(_find_path_keys(value))
        return found

    assert _find_path_keys(body) == []
    assert body["regression"]["name"] == "ridge"
    assert body["classification"]["name"] == "random_forest"
    assert body["regression"]["val_metrics"]["rmsle"] > 0
    assert body["headline_metrics"]["classification"]["threshold"] > 0


# ---------------------------------------------------------------------------
# AUD-20 — .env lookup anchored to the repo root
# ---------------------------------------------------------------------------


def test_env_file_anchored_to_repo_root() -> None:
    """Settings reads ``<REPO_ROOT>/.env`` regardless of the CWD (AUD-20)."""
    env_file = Settings.model_config["env_file"]
    assert Path(env_file).is_absolute()
    assert env_file == str(REPO_ROOT / ".env")


# ---------------------------------------------------------------------------
# AUD-21 — drift-summary disk read happens outside the metrics lock
# ---------------------------------------------------------------------------


def test_drift_read_outside_metrics_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """latest_drift_summary() runs with the metrics lock free (AUD-21)."""
    service = MonitoringService(REPO_ROOT / "reports" / "drift" / "definitely-missing.json")
    observed: dict[str, bool] = {}
    original = service.latest_drift_summary

    def _probe() -> dict:
        acquired = service._lock.acquire(blocking=False)
        observed["lock_was_free"] = acquired
        if acquired:
            service._lock.release()
        return original()

    monkeypatch.setattr(service, "latest_drift_summary", _probe)
    snapshot = service.snapshot()
    assert observed["lock_was_free"] is True
    assert snapshot["drift"]["status"] == "no_data"


# ---------------------------------------------------------------------------
# AUD-22 — _probability fails loudly without the positive class
# ---------------------------------------------------------------------------


class _ClassifierWithoutPositiveClass:
    """predict_proba works but classes_ lacks 1 — a broken artifact."""

    classes_ = np.array([0, 2])

    def predict_proba(self, features: pd.DataFrame) -> np.ndarray:
        return np.array([[0.5, 0.5]])


def test_probability_fails_loudly_without_positive_class() -> None:
    """classes_ without 1 → RuntimeError (no silent proba[-1], AUD-22)."""
    service = PredictionService(
        regression_model=None,
        classification_model=_ClassifierWithoutPositiveClass(),
        neighborhood_stats=None,  # type: ignore[arg-type] — unused by _probability
        threshold=0.5,
        residual_interval={"q_low": -0.1, "q_high": 0.1},
    )
    with pytest.raises(RuntimeError, match="positive class 1"):
        service._probability(pd.DataFrame({"x": [1]}))
