"""API tests — FastAPI TestClient against the real champion artifacts (SPEC §11).

Run from the repo root: ``.venv/Scripts/python.exe -m pytest backend/tests -q``.
The app fixture loads the real registry champions once per module and points
the prediction log at a tmp file so tests never touch ``logs/predictions.jsonl``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app

#: Required fields only (SPEC §8 — everything else falls back to defaults).
MINIMAL_PAYLOAD = {
    "neighborhood": "NAmes",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 1,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1500,
    "lot_area": 9000,
    "total_bsmt_sf": 900,
    "year_built": 1995,
    "overall_qual": 6,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}

#: Everything the schema accepts, including the advanced overrides.
FULL_PAYLOAD = {
    **MINIMAL_PAYLOAD,
    "neighborhood": "NridgHt",
    "house_style": "2Story",
    "bldg_type": "1Fam",
    "ms_zoning": "RL",
    "lot_frontage": 85.0,
    "year_remod_add": 2005,
    "garage_area": 550.0,
    "pool_area": 0,
    "wood_deck_sf": 200,
    "open_porch_sf": 40,
    "screen_porch": 0,
    "sale_date": "2009-06-15",
    "bsmt_qual": "Ex",
    "kitchen_qual": "Gd",
    "exter_qual": "TA",
    "heating_qc": "Ex",
    "garage_type": "Attchd",
    "garage_finish": "Fin",
    "foundation": "PConc",
    "electrical": "SBrkr",
    "functional": "Typ",
    "fireplace_qu": "Gd",
    "lot_shape": "Reg",
    "lot_config": "Inside",
    "land_slope": "Gtl",
    "condition1": "Norm",
    "roof_style": "Gable",
    "exterior1st": "VinylSd",
    "mas_vnr_area": 150.0,
    "kitchen_abv_gr": 1,
    "tot_rms_abvgrd": 7,
    "bsmt_fin_sf1": 700,
    "bsmt_unf_sf": 200,
    "first_flr_sf": 1200,
    "second_flr_sf": 800,
    "enclosed_porch": 0,
    "misc_val": 0,
    "paved_drive": "Y",
    "street": "Pave",
    "mo_sold": 6,
    "yr_sold": 2009,
}


@pytest.fixture(scope="module")
def log_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Tmp JSONL prediction log for the module's app instance."""
    return tmp_path_factory.mktemp("predlog") / "predictions.jsonl"


@pytest.fixture(scope="module")
def client(log_path: Path) -> TestClient:
    """TestClient with the real champions loaded and a tmp prediction log."""
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    """GET /health → 200 with models_loaded true for both champions."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["models_loaded"] == {"regression": True, "classification": True}


def test_predict_minimal_payload(client: TestClient) -> None:
    """POST /predict with required fields only → full bundle, sane ranges."""
    response = client.post("/predict", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()

    assert 20_000 <= body["estimated_price"] <= 2_000_000
    price_range = body["price_range"]
    assert 0 < price_range["low"] <= body["estimated_price"] <= price_range["high"]

    sale = body["sale_probability"]
    assert 0.0 <= sale["probability"] <= 1.0
    assert isinstance(sale["sells_within_30_days"], bool)
    assert 0.0 < sale["threshold"] < 1.0

    micro = body["micro_market"]
    assert isinstance(micro["cluster_id"], int)
    assert micro["label"]
    assert micro["median_price"] > 0
    assert isinstance(micro["fallback"], bool)

    assert isinstance(body["top_price_factors"], list)
    for factor in body["top_price_factors"]:
        assert factor["impact"] in {"positive", "negative"}
        assert isinstance(factor["magnitude"], (int, float))

    version = body["model_version"]
    assert version["regression"] == "ridge_v1"
    assert version["classification"] == "random_forest_v1"
    assert len(version["feature_version"]) == 12


def test_predict_full_payload(client: TestClient) -> None:
    """POST /predict with every field incl. advanced overrides → 200."""
    response = client.post("/predict", json=FULL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert 20_000 <= body["estimated_price"] <= 2_000_000
    assert 0.0 <= body["sale_probability"]["probability"] <= 1.0
    assert body["micro_market"]["fallback"] is False  # NridgHt is a clustered member


def test_predict_bad_enum_rejected(client: TestClient) -> None:
    """Invalid enum value → 422 with field detail."""
    payload = {**MINIMAL_PAYLOAD, "kitchen_qual": "Excellent"}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422
    assert "kitchen_qual" in response.text


def test_predict_negative_area_rejected(client: TestClient) -> None:
    """Negative living area → 422."""
    payload = {**MINIMAL_PAYLOAD, "gr_liv_area": -100}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422
    assert "gr_liv_area" in response.text


def test_predict_out_of_range_quality_rejected(client: TestClient) -> None:
    """overall_qual outside 1–10 → 422."""
    payload = {**MINIMAL_PAYLOAD, "overall_qual": 99}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_unknown_neighborhood_rejected(client: TestClient) -> None:
    """Neighborhood outside the 25 train neighborhoods → 422 with detail."""
    payload = {**MINIMAL_PAYLOAD, "neighborhood": "Gotham"}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422
    assert "neighborhood" in response.text


def test_predict_unknown_field_rejected(client: TestClient) -> None:
    """Unknown serving keys → 422 (schema forbids extras)."""
    payload = {**MINIMAL_PAYLOAD, "jacuzzi_count": 2}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_missing_required_rejected(client: TestClient) -> None:
    """Missing required field → 422."""
    payload = {key: value for key, value in MINIMAL_PAYLOAD.items() if key != "year_built"}
    response = client.post("/predict", json=payload)
    assert response.status_code == 422


def test_predict_price(client: TestClient) -> None:
    """POST /predict/price → price + range only."""
    response = client.post("/predict/price", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert 20_000 <= body["estimated_price"] <= 2_000_000
    assert body["price_range"]["low"] <= body["estimated_price"] <= body["price_range"]["high"]
    assert body["model_version"]["regression"] == "ridge_v1"


def test_predict_sale_probability(client: TestClient) -> None:
    """POST /predict/sale-probability → calibrated probability only."""
    response = client.post("/predict/sale-probability", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert 0.0 <= body["probability"] <= 1.0
    assert isinstance(body["sells_within_30_days"], bool)
    assert body["threshold"] == pytest.approx(0.203292, abs=1e-4)
    assert body["model_version"]["classification"] == "random_forest_v1"


def test_model_info(client: TestClient) -> None:
    """GET /model/info → champion names + headline metrics."""
    response = client.get("/model/info")
    assert response.status_code == 200
    body = response.json()
    assert body["regression"]["name"] == "ridge"
    assert body["classification"]["name"] == "random_forest"
    assert body["classification"]["calibrated"] is True
    assert body["classification"]["threshold"] == pytest.approx(0.203292, abs=1e-4)
    assert body["headline_metrics"]["regression"]["val_rmsle"] > 0
    assert body["headline_metrics"]["classification"]["val_pr_auc"] > 0
    assert body["n_features"] > 0
    assert len(body["feature_version"]) == 12


def test_market_clusters(client: TestClient) -> None:
    """GET /market/clusters → >=3 clusters with label/price/centroid + map points."""
    response = client.get("/market/clusters")
    assert response.status_code == 200
    body = response.json()
    clusters = body["clusters"]
    assert len(clusters) >= 3
    for cluster in clusters:
        assert cluster["label"]
        assert cluster["median_price"] > 0
        assert -90 <= cluster["centroid_lat"] <= 90
        assert -180 <= cluster["centroid_long"] <= 180
        assert cluster["n_neighborhoods"] == len(cluster["neighborhoods"])
    points = body["neighborhoods"]
    assert len(points) == 25
    for point in points:
        assert point["lat"] and point["long"]
        assert isinstance(point["cluster_id"], int)


def test_metrics(client: TestClient) -> None:
    """GET /metrics → counters, latency, drift summary (ok or no_data)."""
    response = client.get("/metrics")
    assert response.status_code == 200
    body = response.json()
    assert body["requests_total"] >= 1  # earlier tests already hit the app
    assert body["avg_latency_ms"] >= 0.0
    assert "drift" in body
    assert body["drift"].get("status") in {"ok", "no_data"}


def test_prediction_log_schema(client: TestClient, log_path: Path) -> None:
    """A /predict call appends one SPEC §10 record to the JSONL log."""
    response = client.post("/predict", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200
    assert log_path.exists()
    lines = [line for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines, "prediction log is empty after /predict"
    record = json.loads(lines[-1])
    assert set(record) >= {"timestamp", "payload", "features", "prediction", "model_version"}
    assert record["payload"]["neighborhood"] == MINIMAL_PAYLOAD["neighborhood"]
    prediction = record["prediction"]
    assert 20_000 <= prediction["estimated_price"] <= 2_000_000
    assert 0.0 <= prediction["probability"] <= 1.0
    assert isinstance(prediction["cluster_id"], int)
    features = record["features"]
    # Full built feature row: raw + engineered + neighborhood stats (SPEC §10).
    for key in ("GrLivArea", "Neighborhood", "total_sf", "property_age", "neighborhood_median_price"):
        assert key in features
    assert record["model_version"] == "ridge_v1+random_forest_v1"


def test_model_importance(client: TestClient) -> None:
    """GET /model/importance → metadata + non-empty mean-|SHAP| importance (SPEC §14)."""
    response = client.get("/model/importance")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"metadata", "importance"}
    assert body["metadata"]["model"] == "Ridge"
    importance = body["importance"]
    assert isinstance(importance, dict) and importance
    for feature, value in importance.items():
        assert isinstance(feature, str)
        assert isinstance(value, (int, float)) and value >= 0.0
    # Top driver per models/explainability/feature_importance.json.
    assert max(importance, key=lambda f: importance[f]) == "OverallQual"


def test_model_importance_missing_artifact_503(tmp_path: Path) -> None:
    """Missing feature_importance.json → cached error state → clean 503 (no stack trace)."""
    from backend.app.api.model import load_model_importance

    # The artifact is read once at startup; an unreadable/missing file is
    # cached as an error state that the endpoint replays as a 503.
    error_state = load_model_importance(tmp_path)  # empty dir → unavailable
    assert "error" in error_state
    app = create_app(Settings())
    with TestClient(app) as test_client:
        test_client.app.state.model_importance = error_state
        response = test_client.get("/model/importance")
    assert response.status_code == 503
    assert "detail" in response.json()
