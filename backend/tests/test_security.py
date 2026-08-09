"""Security hardening tests (reports/SECURITY.md).

Covers the middleware in ``backend/app/security.py`` (headers + 64 KiB body
limit), the generic-500 response shape (no internals leaked), and a battery of
abuse payloads proving ``PropertyInput`` strictness. Run from the repo root:
``.venv/Scripts/python.exe -m pytest backend/tests/test_security.py -q``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.security import MAX_BODY_BYTES, SECURITY_HEADERS
from backend.tests.test_api import MINIMAL_PAYLOAD

#: Sentinel string that must never appear in an HTTP response.
LEAK_SENTINEL = "boom-sentinel-internal-detail"


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """Real-champion app with a tmp prediction log (mirrors test_api)."""
    log_path = tmp_path_factory.mktemp("predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as test_client:
        yield test_client


def _assert_security_headers(response) -> None:  # noqa: ANN001 — httpx.Response
    """Every baseline security header is present with the expected value."""
    for header, value in SECURITY_HEADERS.items():
        assert response.headers.get(header) == value, f"missing/incorrect {header}"


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------


def test_security_headers_on_success(client: TestClient) -> None:
    """200 responses carry all baseline security headers."""
    response = client.get("/health")
    assert response.status_code == 200
    _assert_security_headers(response)


def test_security_headers_on_error_responses(client: TestClient) -> None:
    """422 (validation) and 404 (unknown route) carry the headers too."""
    bad = client.post("/predict", json={**MINIMAL_PAYLOAD, "overall_qual": 99})
    assert bad.status_code == 422
    _assert_security_headers(bad)

    missing = client.get("/no-such-route")
    assert missing.status_code == 404
    _assert_security_headers(missing)


# ---------------------------------------------------------------------------
# Request-body size limit
# ---------------------------------------------------------------------------


def test_oversized_body_rejected_413(client: TestClient) -> None:
    """A body larger than 64 KiB is rejected with 413 before JSON parsing."""
    oversized = json.dumps(MINIMAL_PAYLOAD).encode() + b" " * (
        MAX_BODY_BYTES + 1 - len(json.dumps(MINIMAL_PAYLOAD))
    )
    assert len(oversized) == MAX_BODY_BYTES + 1
    response = client.post(
        "/predict", content=oversized, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert "detail" in response.json()
    _assert_security_headers(response)


def test_body_at_limit_accepted(client: TestClient) -> None:
    """A body of exactly 64 KiB is NOT rejected by the limit (boundary)."""
    raw = json.dumps(MINIMAL_PAYLOAD).encode()
    at_limit = raw + b" " * (MAX_BODY_BYTES - len(raw))
    assert len(at_limit) == MAX_BODY_BYTES
    response = client.post(
        "/predict", content=at_limit, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# Generic 500 — no internals leaked
# ---------------------------------------------------------------------------


def test_unhandled_exception_500_shape(tmp_path: Path) -> None:
    """A forced exception yields a generic 500: no stack trace, no internals.

    The failing route exists only in this test app instance — never in the
    shipped application.
    """
    app = create_app(Settings(prediction_log_path=str(tmp_path / "predictions.jsonl")))

    @app.get("/_test_boom", include_in_schema=False)
    def _test_boom() -> None:  # pragma: no cover — always raises by design
        raise RuntimeError(LEAK_SENTINEL)

    with TestClient(app, raise_server_exceptions=False) as test_client:
        response = test_client.get("/_test_boom")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert LEAK_SENTINEL not in response.text
    assert "Traceback" not in response.text
    _assert_security_headers(response)


def test_malformed_json_no_internals(client: TestClient) -> None:
    """Unparseable JSON body → 422 with no stack trace / internals."""
    response = client.post(
        "/predict", content=b"{not valid json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert "Traceback" not in response.text
    assert ".py" not in response.text


# ---------------------------------------------------------------------------
# Abuse payloads — PropertyInput strictness (extra=forbid, enums, ranges)
# ---------------------------------------------------------------------------


def test_abuse_huge_numbers_rejected(client: TestClient) -> None:
    """Astronomical numeric values are rejected by range constraints (422)."""
    for field in ("bedrooms", "gr_liv_area", "lot_area", "overall_qual"):
        payload = {**MINIMAL_PAYLOAD, field: 10**15}
        response = client.post("/predict", json=payload)
        assert response.status_code == 422, field
        assert field in response.text


def test_abuse_type_confusion_rejected(client: TestClient) -> None:
    """Wrong types (string for int, fractional float, non-bool) → 422."""
    cases = [
        {"bedrooms": "three"},
        {"gr_liv_area": 1500.5},  # fractional float is not a valid int
        {"central_air": "not-a-bool"},
        {"year_built": [1995]},
        {"neighborhood": 42},
    ]
    for override in cases:
        payload = {**MINIMAL_PAYLOAD, **override}
        response = client.post("/predict", json=payload)
        assert response.status_code == 422, override


def test_abuse_unicode_and_long_strings_rejected(client: TestClient) -> None:
    """Unicode bombs / control chars in string fields → 422; a ~100 KiB string
    is stopped even earlier — by the 64 KiB body limit (413). Both reject."""
    for value in ("💣" * 500, "NAmes" + "\x00" * 100):
        payload = {**MINIMAL_PAYLOAD, "neighborhood": value}
        response = client.post("/predict", json=payload)
        assert response.status_code == 422
        assert "neighborhood" in response.text

    huge = {**MINIMAL_PAYLOAD, "neighborhood": "A" * 100_000}
    response = client.post("/predict", json=huge)
    assert response.status_code == 413  # body limit fires before validation


def test_abuse_nested_and_unknown_structures_rejected(client: TestClient) -> None:
    """Deeply nested extras and container-typed extras → 422 (extra=forbid)."""
    nested = {"a": {"b": {"c": {"d": list(range(1000))}}}}
    payload = {**MINIMAL_PAYLOAD, "nested": nested, "another": [1, 2, 3]}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422
