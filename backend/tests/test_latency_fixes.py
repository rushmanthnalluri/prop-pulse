"""Latency-fix tests (reports/PERFORMANCE.md — wave 9b).

Covers the four serving optimizations, without changing any response shape
or prediction value:

1. The classification champion is pinned to ``n_jobs=1`` at load
   (``force_single_threaded``) — predictions proven identical on a 5-row
   feature frame.
2. ``/predict/price`` never touches the classifier or SHAP;
   ``/predict/sale-probability`` never touches the regressor or SHAP.
3. The SHAP explainer singleton is warmed during lifespan startup.
4. Static GET payloads are built once at startup and served from
   ``app.state``.

Run from the repo root: ``.venv/Scripts/python.exe -m pytest backend/tests -q``.
"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.services.prediction_service import (
    PredictionService,
    force_single_threaded,
)
from backend.tests.test_api import FULL_PAYLOAD, MINIMAL_PAYLOAD
from ml.features.pipeline import build_feature_frame
from ml.features.serving import serving_payload_to_raw
from ml.features.stats import load_neighborhood_stats
from ml.paths import REPO_ROOT


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """Real-champion app with a tmp prediction log (mirrors test_api)."""
    log_path = tmp_path_factory.mktemp("predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as test_client:
        yield test_client


def _five_row_frame() -> pd.DataFrame:
    """Five distinct serving payloads → one 5-row MODEL_FEATURES frame."""
    variants = [
        MINIMAL_PAYLOAD,
        {**MINIMAL_PAYLOAD, "neighborhood": "NridgHt", "overall_qual": 9, "gr_liv_area": 2500},
        {**MINIMAL_PAYLOAD, "neighborhood": "OldTown", "overall_qual": 4, "gr_liv_area": 900},
        {**FULL_PAYLOAD},
        {**MINIMAL_PAYLOAD, "neighborhood": "Somerst", "year_built": 2010, "garage_cars": 3},
    ]
    stats = load_neighborhood_stats()
    rows = [
        build_feature_frame(pd.DataFrame([serving_payload_to_raw(p)]), stats=stats)
        for p in variants
    ]
    return pd.concat(rows).reset_index(drop=True)


def _fold_forests(model) -> list:
    """RandomForest inside each calibrated fold pipeline of the champion."""
    return [cc.estimator.steps[-1][1] for cc in model.calibrated_classifiers_]


# ---------------------------------------------------------------------------
# Fix 1 — n_jobs=1 on the loaded classification champion
# ---------------------------------------------------------------------------


def test_champion_loaded_single_threaded(client: TestClient) -> None:
    """The served classification champion has n_jobs=1 on every fold forest."""
    service: PredictionService = client.app.state.prediction_service
    n_jobs = [rf.n_jobs for rf in _fold_forests(service._classification)]
    assert n_jobs == [1, 1, 1, 1, 1]


def test_force_single_threaded_predictions_identical() -> None:
    """n_jobs=1 vs n_jobs=-1: same 5-row frame → allclose probabilities.

    The only difference is one-ULP float noise (<=1e-15) from the vote-sum
    order in the parallel reduction; the 6-decimal values the API serves are
    identical.
    """
    champion = json.loads((REPO_ROOT / "models" / "champion.json").read_text("utf-8"))
    model = joblib.load(REPO_ROOT / champion["classification"]["path"])
    frame = _five_row_frame()
    assert frame.shape[0] == 5

    proba_before = model.predict_proba(frame)
    assert [rf.n_jobs for rf in _fold_forests(model)] == [-1] * 5

    force_single_threaded(model)
    assert [rf.n_jobs for rf in _fold_forests(model)] == [1] * 5

    proba_after = model.predict_proba(frame)
    np.testing.assert_allclose(proba_before, proba_after, rtol=1e-12, atol=1e-12)
    assert np.array_equal(np.round(proba_before, 6), np.round(proba_after, 6))


# ---------------------------------------------------------------------------
# Fix 2 — narrow endpoints skip the stages they do not return
# ---------------------------------------------------------------------------


class _Exploding:
    """Any attribute access or call raises — proves the component is unused."""

    def __getattr__(self, name: str):  # noqa: ANN202
        raise AssertionError(f"touched skipped component attribute: {name}")


def _explode_explain(self, features, top_n: int = 5):  # noqa: ANN001, ANN201, ARG001
    raise AssertionError("SHAP explanation must not run for narrow endpoints")


def test_predict_price_skips_classifier_and_shap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """/predict/price returns 200 with the classifier broken and SHAP armed to fail."""
    service: PredictionService = client.app.state.prediction_service
    monkeypatch.setattr(service, "_classification", _Exploding())
    monkeypatch.setattr(PredictionService, "_explain", _explode_explain)

    response = client.post("/predict/price", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert 20_000 <= body["estimated_price"] <= 2_000_000
    assert body["price_range"]["low"] <= body["estimated_price"] <= body["price_range"]["high"]


def test_predict_sale_probability_skips_regressor_and_shap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """/predict/sale-probability returns 200 with the regressor broken and SHAP armed."""
    service: PredictionService = client.app.state.prediction_service
    monkeypatch.setattr(service, "_regression", _Exploding())
    monkeypatch.setattr(PredictionService, "_explain", _explode_explain)

    response = client.post("/predict/sale-probability", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert 0.0 <= body["probability"] <= 1.0
    assert isinstance(body["sells_within_30_days"], bool)


def test_full_predict_still_uses_both_champions(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Broken classifier breaks /predict — the full bundle keeps every stage.

    (Starlette re-raises after the 500 response, so the TestClient surfaces
    the original error — that propagation IS the proof the classifier ran.)
    """
    service: PredictionService = client.app.state.prediction_service
    monkeypatch.setattr(service, "_classification", _Exploding())
    with pytest.raises(AssertionError, match="predict_proba"):
        client.post("/predict", json=MINIMAL_PAYLOAD)


def test_narrow_endpoints_match_full_predict_values(client: TestClient) -> None:
    """Same payload → narrow endpoints return the exact /predict values."""
    full = client.post("/predict", json=MINIMAL_PAYLOAD).json()
    price = client.post("/predict/price", json=MINIMAL_PAYLOAD).json()
    probability = client.post("/predict/sale-probability", json=MINIMAL_PAYLOAD).json()

    assert price["estimated_price"] == full["estimated_price"]
    assert price["price_range"] == full["price_range"]
    assert price["model_version"] == full["model_version"]
    assert probability["probability"] == full["sale_probability"]["probability"]
    assert probability["sells_within_30_days"] == (
        full["sale_probability"]["sells_within_30_days"]
    )
    assert probability["threshold"] == full["sale_probability"]["threshold"]
    assert probability["model_version"] == full["model_version"]


# ---------------------------------------------------------------------------
# Fix 3 — SHAP explainer warmed at startup
# ---------------------------------------------------------------------------


def test_shap_explainer_warmed_during_startup(client: TestClient) -> None:
    """The process-wide SHAP singleton exists right after lifespan startup."""
    import ml.explainability.service as shap_service

    assert shap_service._explainer is not None


# ---------------------------------------------------------------------------
# Fix 4 — static GET payloads cached at startup
# ---------------------------------------------------------------------------


def test_static_gets_serve_startup_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """/model/info + /market/clusters return the app.state cache verbatim."""
    assert client.get("/model/info").json() == client.app.state.model_info_payload
    assert client.get("/market/clusters").json() == (
        client.app.state.market_clusters_payload
    )

    # Tampering with the source data after startup must not leak into the
    # cached response (proves no per-request rebuild).
    original = client.app.state.champion["regression"]["name"]
    monkeypatch.setitem(client.app.state.champion["regression"], "name", "tampered")
    body = client.get("/model/info").json()
    assert body["regression"]["name"] == original
