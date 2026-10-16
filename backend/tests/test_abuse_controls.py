"""Regression tests for public API abuse controls."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.abuse_controls import AbuseControlMiddleware


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(AbuseControlMiddleware)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/model/info")
    def model_info() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/predict")
    def predict() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/workflow/datasets/ds_12345678/jobs")
    def train() -> dict[str, str]:
        return {"status": "queued"}

    return TestClient(app)


def test_prediction_rate_limit_returns_429_and_retry_after(monkeypatch) -> None:
    monkeypatch.setenv("PROPULSE_RATE_LIMIT_PREDICTION", "2")
    with _client() as client:
        assert client.post("/predict").status_code == 200
        assert client.post("/predict").status_code == 200
        response = client.post("/predict")
        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) >= 1


def test_training_limit_is_separate_and_tighter(monkeypatch) -> None:
    monkeypatch.setenv("PROPULSE_RATE_LIMIT_TRAINING", "1")
    with _client() as client:
        assert client.post("/workflow/datasets/ds_12345678/jobs").status_code == 200
        assert client.post("/workflow/datasets/ds_12345678/jobs").status_code == 429
        # A training limit does not consume the prediction bucket.
        assert client.post("/predict").status_code == 200


def test_health_is_not_limited_and_forwarded_header_cannot_rotate_identity(monkeypatch) -> None:
    monkeypatch.setenv("PROPULSE_RATE_LIMIT_PREDICTION", "1")
    with _client() as client:
        assert client.get("/health").status_code == 200
        assert client.get("/health").status_code == 200
        assert client.post("/predict", headers={"x-forwarded-for": "198.51.100.1"}).status_code == 200
        # Spoofing a different X-Forwarded-For value does not evade the bucket:
        # the middleware keys on the TestClient's actual ASGI peer address.
        response = client.post("/predict", headers={"x-forwarded-for": "203.0.113.9"})
        assert response.status_code == 429


def test_general_routes_have_a_separate_bucket(monkeypatch) -> None:
    monkeypatch.setenv("PROPULSE_RATE_LIMIT_GENERAL", "1")
    with _client() as client:
        assert client.get("/model/info").status_code == 200
        assert client.get("/model/info").status_code == 429
        assert client.post("/predict").status_code == 200
