"""Operational observability regression tests."""
from __future__ import annotations

import pytest

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.monitoring.middleware import REQUEST_ID_HEADER


@pytest.fixture()
def app(tmp_path):
    return create_app(Settings(prediction_log_path=str(tmp_path / 'predictions.jsonl')))


def test_ready_requires_all_models(app) -> None:
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get('/ready')
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['ready'] is True
        assert all(body['models_loaded'].values())


def test_request_id_is_echoed_and_generated(app) -> None:
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get('/health', headers={REQUEST_ID_HEADER: 'trace-123'})
        assert response.status_code == 200
        assert response.headers[REQUEST_ID_HEADER] == 'trace-123'
        fresh = client.get('/health')
        assert fresh.status_code == 200
        assert 1 <= len(fresh.headers[REQUEST_ID_HEADER]) <= 128


def test_metrics_exposes_in_flight_and_last_request(app) -> None:
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        client.get('/health')
        response = client.get('/metrics')
        assert response.status_code == 200
        body = response.json()
        assert body['requests_in_flight'] == 0
        assert body['requests_total'] >= 2
        assert body['last_request_at'] is not None
