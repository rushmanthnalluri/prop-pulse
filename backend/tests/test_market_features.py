"""Tests for the wave-D market features + the calendar clamp.

Covers:

- ``POST /market/comps`` — neighborhood vs cluster-fallback scope, percentile
  sanity, artifact hygiene (no simulated-target columns), 422s, and the
  additive ``calendar_clamped`` disclosure.
- ``GET /market/trends`` — periods x cluster shape, null medians on empty
  windows.
- ``/predict`` + ``/predict/price`` ``market_position`` — correctness on the
  known MINIMAL_PAYLOAD case (expected values recomputed from the artifacts).
- ``confidence`` — out-of-range flags (incl. the client-stated remodel year,
  which scoring clamps) and the sale-date clamp reason, on ``/predict``,
  ``/predict/price`` and ``/predict/sale-probability``.
- Calendar clamp (serving): an omitted sale date scores at the latest train
  month (2008-12), and an explicit 2026 date clamps to the same boundary.

Run from the repo root: ``.venv/Scripts/python.exe -m pytest backend/tests -q``.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.tests.test_api import MINIMAL_PAYLOAD
from ml.comps.build import COMPS_PATH
from ml.paths import MODELS_DIR

#: Comp keys of the exact response contract (frontend builds against these).
COMP_KEYS = {
    "sale_price",
    "price_per_sqft",
    "gr_liv_area",
    "overall_qual",
    "overall_cond",
    "year_built",
    "bedrooms",
    "baths",
    "garage_cars",
    "house_style",
    "sold",
    "match_scope",
}


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """Real-champion app with a tmp prediction log (mirrors test_api)."""
    log_path = tmp_path_factory.mktemp("predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# POST /market/comps
# ---------------------------------------------------------------------------


def test_comps_neighborhood_scope(client: TestClient) -> None:
    """NAmes (147 train sales) → neighborhood scope, 5 comps, contract keys."""
    response = client.post("/market/comps", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["match_scope"] == "neighborhood"
    assert len(body["comps"]) == 5
    for comp in body["comps"]:
        assert set(comp) == COMP_KEYS
        assert comp["match_scope"] == "neighborhood"
        assert re.fullmatch(r"\d{2}/\d{4}", comp["sold"]), comp["sold"]
        assert comp["sale_price"] > 0
        assert comp["gr_liv_area"] > 0
        # price_per_sqft is consistent with price / area (1-decimal rounding).
        assert comp["price_per_sqft"] == pytest.approx(
            comp["sale_price"] / comp["gr_liv_area"], abs=0.1
        )
    assert 0.0 <= body["percentile"] <= 100.0
    assert "training data" in body["note"]


def test_comps_cluster_fallback_scope(client: TestClient) -> None:
    """Blueste (1 train sale) → cluster-scope fallback (affordable southwest)."""
    response = client.post("/market/comps", json={**MINIMAL_PAYLOAD, "neighborhood": "Blueste"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["match_scope"] == "cluster"
    assert len(body["comps"]) == 5
    assert all(comp["match_scope"] == "cluster" for comp in body["comps"])
    assert 0.0 <= body["percentile"] <= 100.0


def test_comps_percentile_monotonic_sanity(client: TestClient) -> None:
    """A larger/higher-quality subject lands at a higher price percentile."""
    cheap = {
        **MINIMAL_PAYLOAD,
        "gr_liv_area": 700,
        "total_bsmt_sf": 500,
        "overall_qual": 3,
        "year_built": 1920,
        "full_bath": 1,
        "half_bath": 0,
        "bedrooms": 2,
        "garage_cars": 0,
    }
    expensive = {
        **MINIMAL_PAYLOAD,
        "gr_liv_area": 3500,
        "total_bsmt_sf": 2500,
        "overall_qual": 9,
        "year_built": 2005,
        "full_bath": 3,
        "half_bath": 1,
        "bedrooms": 4,
        "garage_cars": 3,
    }
    low = client.post("/market/comps", json=cheap).json()["percentile"]
    high = client.post("/market/comps", json=expensive).json()["percentile"]
    assert 0.0 <= low < high <= 100.0


def test_comps_similarity_prefers_close_living_area(client: TestClient) -> None:
    """The nearest comps track the subject's living area (normalized distance)."""
    response = client.post("/market/comps", json=MINIMAL_PAYLOAD)  # 1500 sqft
    areas = [comp["gr_liv_area"] for comp in response.json()["comps"]]
    assert all(abs(area - 1500) < 600 for area in areas), areas


def test_comps_artifact_has_no_simulated_target_columns() -> None:
    """The artifact never carries days_on_market / sells_within_30_days (ADR-3)."""
    payload = json.loads(COMPS_PATH.read_text(encoding="utf-8"))
    assert payload["n_rows"] == 945 == len(payload["sales"])
    assert payload["sale_window"] == {
        "min_year": 2006,
        "min_month": 1,
        "max_year": 2008,
        "max_month": 12,
    }
    for sale in payload["sales"]:
        assert "days_on_market" not in sale
        assert "sells_within_30_days" not in sale
    assert set(payload["similarity"]["scales"]) == set(
        payload["similarity"]["features"]
    )


def test_comps_rejects_invalid_input_422(client: TestClient) -> None:
    """Unknown neighborhood / out-of-range area → 422 (schema validation)."""
    response = client.post("/market/comps", json={**MINIMAL_PAYLOAD, "neighborhood": "Gotham"})
    assert response.status_code == 422
    assert "neighborhood" in response.text

    response = client.post("/market/comps", json={**MINIMAL_PAYLOAD, "gr_liv_area": -100})
    assert response.status_code == 422
    assert "gr_liv_area" in response.text


# ---------------------------------------------------------------------------
# GET /market/trends
# ---------------------------------------------------------------------------


def test_market_trends_shape(client: TestClient) -> None:
    """6 half-year periods (2006H1..2008H2) x 4 clusters; nulls on empty windows."""
    response = client.get("/market/trends")
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["periods"] == [
        "2006H1",
        "2006H2",
        "2007H1",
        "2007H2",
        "2008H1",
        "2008H2",
    ]
    assert "training data" in body["note"]

    clusters = client.get("/market/clusters").json()["clusters"]
    assert len(body["series"]) == len(clusters) >= 3
    for series in body["series"]:
        assert series["label"]
        assert len(series["median_price"]) == len(body["periods"])
        assert len(series["sales_count"]) == len(body["periods"])
        for median, count in zip(series["median_price"], series["sales_count"]):
            if count == 0:
                assert median is None
            else:
                assert isinstance(median, (int, float)) and median > 0


# ---------------------------------------------------------------------------
# /predict market_position + confidence
# ---------------------------------------------------------------------------


def test_market_position_known_case(client: TestClient) -> None:
    """market_position recomputes exactly from the artifacts (NAmes case)."""
    response = client.post("/predict", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    position = body["market_position"]

    expected_subject = round(body["estimated_price"] / MINIMAL_PAYLOAD["gr_liv_area"], 1)
    stats = json.loads((MODELS_DIR / "neighborhood_stats.json").read_text(encoding="utf-8"))
    expected_neighborhood = round(
        stats["neighborhoods"]["NAmes"]["median_price_per_sqft"], 1
    )
    expected_cluster = round(body["micro_market"]["median_price_per_sqft"], 1)

    assert position["subject_price_per_sqft"] == pytest.approx(expected_subject, abs=0.1)
    assert position["neighborhood_median_price_per_sqft"] == pytest.approx(
        expected_neighborhood, abs=0.05
    )
    assert position["cluster_median_price_per_sqft"] == pytest.approx(
        expected_cluster, abs=0.05
    )
    expected_vs = round(
        (expected_subject - expected_neighborhood) / expected_neighborhood * 100.0, 1
    )
    assert position["vs_neighborhood_pct"] == pytest.approx(expected_vs, abs=0.2)
    expected_label = (
        "near" if abs(expected_vs) <= 5.0 else ("above" if expected_vs > 0 else "below")
    )
    assert position["label"] == expected_label


def test_market_position_present_on_price_endpoint(client: TestClient) -> None:
    """/predict/price also carries market_position + confidence (cheap path)."""
    response = client.post("/predict/price", json=MINIMAL_PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body["market_position"]) == {
        "subject_price_per_sqft",
        "neighborhood_median_price_per_sqft",
        "cluster_median_price_per_sqft",
        "vs_neighborhood_pct",
        "label",
    }
    assert set(body["confidence"]) == {"level", "reasons"}


def test_confidence_typical_for_in_range_input(client: TestClient) -> None:
    """MINIMAL_PAYLOAD is inside every train range → typical, no reasons."""
    body = client.post("/predict", json=MINIMAL_PAYLOAD).json()
    assert body["confidence"] == {"level": "typical", "reasons": []}


def test_confidence_flags_out_of_range_inputs(client: TestClient) -> None:
    """gr_liv_area/lot_area beyond the train extremes → reduced + reasons."""
    payload = {**MINIMAL_PAYLOAD, "gr_liv_area": 6000, "lot_area": 200000}
    body = client.post("/predict", json=payload).json()
    confidence = body["confidence"]
    assert confidence["level"] == "reduced"
    assert any("Living area above the training range" in r for r in confidence["reasons"])
    assert any("Lot area above the training range" in r for r in confidence["reasons"])


# ---------------------------------------------------------------------------
# Calendar clamp (Task 4)
# ---------------------------------------------------------------------------


def test_omitted_sale_date_defaults_to_train_window(client: TestClient) -> None:
    """No sale date == explicit 2008-12 (latest train month), not 'today'.

    Regression guard for the red-team finding: the old default stamped
    YrSold=<current year>, 16+ years beyond the 2006-2008 train support.
    """
    default = client.post("/predict/price", json=MINIMAL_PAYLOAD).json()
    boundary = client.post(
        "/predict/price", json={**MINIMAL_PAYLOAD, "sale_date": "2008-12-15"}
    ).json()
    assert default["estimated_price"] == boundary["estimated_price"]
    assert default["confidence"] == {"level": "typical", "reasons": []}


def test_future_sale_date_clamps_with_reason(client: TestClient) -> None:
    """yr_sold=2026 clamps to the 2008-12 boundary and says so in confidence."""
    clamped = client.post("/predict", json={**MINIMAL_PAYLOAD, "yr_sold": 2026}).json()
    boundary = client.post(
        "/predict", json={**MINIMAL_PAYLOAD, "sale_date": "2008-12-15"}
    ).json()
    # Clamped scoring is identical to scoring at the window boundary.
    assert clamped["estimated_price"] == boundary["estimated_price"]
    confidence = clamped["confidence"]
    assert confidence["level"] == "reduced"
    assert any(
        "Sale date beyond the 2006-2008 training window" in reason
        for reason in confidence["reasons"]
    )


def test_in_window_sale_date_not_clamped(client: TestClient) -> None:
    """A 2007 sale date is inside the train window: no clamp reason."""
    body = client.post(
        "/predict/price", json={**MINIMAL_PAYLOAD, "sale_date": "2007-03-10"}
    ).json()
    assert body["confidence"] == {"level": "typical", "reasons": []}


def test_confidence_flags_out_of_window_remod_year(client: TestClient) -> None:
    """year_remod_add=2026 is clamped to the sale year for SCORING, but the
    confidence block still flags the client-stated remodel year (reduced)."""
    body = client.post(
        "/predict/price", json={**MINIMAL_PAYLOAD, "year_remod_add": 2026}
    ).json()
    confidence = body["confidence"]
    assert confidence["level"] == "reduced"
    assert any(
        "Remodel year above the training range" in reason
        for reason in confidence["reasons"]
    )
    # In-window control: the stated remodel year alone never flags.
    body = client.post(
        "/predict/price", json={**MINIMAL_PAYLOAD, "year_remod_add": 2005}
    ).json()
    assert body["confidence"] == {"level": "typical", "reasons": []}


# ---------------------------------------------------------------------------
# Clamp disclosure on /predict/sale-probability + /market/comps
# ---------------------------------------------------------------------------


def test_sale_probability_carries_confidence_block(client: TestClient) -> None:
    """/predict/sale-probability returns the same confidence block as /predict."""
    body = client.post("/predict/sale-probability", json=MINIMAL_PAYLOAD).json()
    assert body["confidence"] == {"level": "typical", "reasons": []}


def test_sale_probability_confidence_flags_clamped_sale_date(client: TestClient) -> None:
    """yr_sold=2026 → reduced with the calendar-clamp reason."""
    body = client.post(
        "/predict/sale-probability", json={**MINIMAL_PAYLOAD, "yr_sold": 2026}
    ).json()
    confidence = body["confidence"]
    assert confidence["level"] == "reduced"
    assert any(
        "Sale date beyond the 2006-2008 training window" in reason
        for reason in confidence["reasons"]
    )


def test_comps_calendar_clamped_flag(client: TestClient) -> None:
    """/market/comps discloses the sale-date calendar clamp additively."""
    clamped = client.post(
        "/market/comps", json={**MINIMAL_PAYLOAD, "sale_date": "2026-03-15"}
    ).json()
    assert clamped["calendar_clamped"] is True

    default = client.post("/market/comps", json=MINIMAL_PAYLOAD).json()
    assert default["calendar_clamped"] is False

    in_window = client.post(
        "/market/comps", json={**MINIMAL_PAYLOAD, "sale_date": "2007-03-10"}
    ).json()
    assert in_window["calendar_clamped"] is False
