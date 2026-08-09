"""End-to-end integration tests (SPEC §11 — all marked ``integration``).

These exercise the REAL persisted artifacts (registry champions, clustering,
SHAP importance, monitoring reference) through the REAL serving path:

- (a) full serving chain: ``POST /predict`` matches a direct in-process
  computation (``serving_payload_to_raw`` → ``build_feature_frame`` → registry
  champions) for both price and probability;
- (b) consistency: ``champion.json`` names/paths match the registry joblibs
  the app actually serves;
- (c) ``GET /market/clusters`` covers all 25 neighborhoods across cluster
  memberships (+ fallback points);
- (d) drift pipeline end-to-end: synthetic SPEC §10 log lines →
  ``ml.monitoring.drift_check.run_drift_check`` → ``latest.json`` structure
  and drift-flag behavior;
- (e) feature determinism: ``build_feature_frame`` twice on the same raw
  frame → identical output;
- (f) prediction logging: a TestClient ``/predict`` appends one line with the
  exact SPEC §10 top-level keys to ``logs/predictions.jsonl`` (the real log
  is backed up and restored around the test).

Run from the repo root::

    .venv/Scripts/python.exe -m pytest tests/integration -q
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from ml.features.pipeline import MODEL_FEATURES, build_feature_frame
from ml.features.serving import serving_payload_to_raw
from ml.features.stats import fit_neighborhood_stats, load_neighborhood_stats
from ml.monitoring.drift_check import MIN_SAMPLE_FOR_RETRAINING, run_drift_check
from ml.monitoring.psi import PSI_DRIFT_THRESHOLD
from ml.monitoring.reference import PREDICTION_REFERENCE_PATH
from ml.paths import CHAMPION_PATH, EXTERNAL_DIR, LOGS_DIR, REGISTRY_DIR, REPO_ROOT
from ml.training.common import load_split

pytestmark = pytest.mark.integration

#: Realistic payload with an explicit sale_date so both the HTTP path and the
#: in-process path derive the same MoSold/YrSold deterministically.
PAYLOAD: dict[str, Any] = {
    "neighborhood": "NridgHt",
    "house_style": "2Story",
    "bldg_type": "1Fam",
    "ms_zoning": "RL",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 1,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1800,
    "lot_area": 10000,
    "lot_frontage": 80.0,
    "total_bsmt_sf": 950,
    "year_built": 2003,
    "year_remod_add": 2010,
    "overall_qual": 7,
    "overall_cond": 5,
    "garage_cars": 2,
    "garage_area": 560.0,
    "fireplaces": 1,
    "central_air": True,
    "pool_area": 0,
    "wood_deck_sf": 150,
    "open_porch_sf": 30,
    "screen_porch": 0,
    "sale_date": "2009-06-15",
}

#: SPEC §10 binding log-line top-level keys.
LOG_TOP_LEVEL_KEYS = {"timestamp", "payload", "features", "prediction", "model_version"}


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> Iterator[TestClient]:
    """TestClient over the real champions; prediction log redirected to tmp."""
    log_path = tmp_path_factory.mktemp("integration-predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as test_client:
        yield test_client


def _champion() -> dict[str, Any]:
    """Parsed ``models/champion.json``."""
    return json.loads(CHAMPION_PATH.read_text(encoding="utf-8"))


def _direct_feature_frame(payload: dict[str, Any]) -> pd.DataFrame:
    """In-process serving path: payload → raw row → MODEL_FEATURES frame."""
    raw = serving_payload_to_raw(dict(payload))
    return build_feature_frame(pd.DataFrame([raw]), stats=load_neighborhood_stats())


# ---------------------------------------------------------------------------
# (a) Full serving chain: HTTP /predict == direct in-process computation
# ---------------------------------------------------------------------------


def test_predict_matches_direct_pipeline(client: TestClient) -> None:
    """HTTP price/probability equal the direct pipeline result (float tolerance)."""
    response = client.post("/predict", json=PAYLOAD)
    assert response.status_code == 200, response.text
    body = response.json()

    features = _direct_feature_frame(PAYLOAD)
    assert list(features.columns) == MODEL_FEATURES
    assert features.shape == (1, len(MODEL_FEATURES))

    champion = _champion()
    regression = joblib.load(REPO_ROOT / champion["regression"]["path"])
    expected_price = float(np.expm1(regression.predict(features)[0]))
    # The API rounds to 2 decimals — tolerance covers the rounding only.
    assert body["estimated_price"] == pytest.approx(expected_price, abs=0.01)

    classification = joblib.load(REPO_ROOT / champion["classification"]["path"])
    proba = classification.predict_proba(features)[0]
    classes = list(classification.classes_)
    expected_probability = float(proba[classes.index(1)])
    # The API rounds to 6 decimals.
    assert body["sale_probability"]["probability"] == pytest.approx(
        expected_probability, abs=1e-6
    )
    assert body["sale_probability"]["sells_within_30_days"] == (
        expected_probability >= champion["classification"]["threshold"]
    )


# ---------------------------------------------------------------------------
# (b) champion.json names/paths match the registry joblibs actually served
# ---------------------------------------------------------------------------


def test_champion_json_matches_served_registry(client: TestClient) -> None:
    """The app serves exactly the artifacts ``champion.json`` points at."""
    champion = _champion()
    app: FastAPI = client.app

    # The app loaded the same champion.json that lives on disk.
    assert app.state.champion == champion

    for task in ("regression", "classification"):
        entry = champion[task]
        # Paths point into models/registry/ and exist.
        assert entry["path"].startswith("models/registry/")
        artifact = REPO_ROOT / entry["path"]
        assert artifact.is_file(), f"missing champion artifact: {artifact}"
        assert artifact.parent == REGISTRY_DIR
        # Names/versions match what the app reports as served.
        assert (
            app.state.model_version[task] == f"{entry['name']}_{entry['version']}"
        ), f"{task}: champion.json name/version != served model_version"

    # The joblibs at those paths produce the same numbers the app serves.
    features = _direct_feature_frame(PAYLOAD)
    bundle = app.state.prediction_service.predict(dict(PAYLOAD))

    regression = joblib.load(REPO_ROOT / champion["regression"]["path"])
    assert bundle.estimated_price == pytest.approx(
        float(np.expm1(regression.predict(features)[0])), abs=0.01
    )
    classification = joblib.load(REPO_ROOT / champion["classification"]["path"])
    proba = classification.predict_proba(features)[0]
    classes = list(classification.classes_)
    assert bundle.probability == pytest.approx(
        float(proba[classes.index(1)]), abs=1e-6
    )


# ---------------------------------------------------------------------------
# (c) /market/clusters covers all 25 neighborhoods
# ---------------------------------------------------------------------------


def test_market_clusters_covers_all_25_neighborhoods(client: TestClient) -> None:
    """Every Ames neighborhood appears exactly once on the map and resolves to a cluster."""
    geo = pd.read_csv(EXTERNAL_DIR / "neighborhood_geo.csv", keep_default_na=False)
    expected = {str(value) for value in geo["Neighborhood"]}
    assert len(expected) == 25  # SPEC §2: the 25 Ames neighborhoods

    response = client.get("/market/clusters")
    assert response.status_code == 200
    body = response.json()

    points = body["neighborhoods"]
    assert {point["neighborhood"] for point in points} == expected
    assert len(points) == 25

    served_ids = {cluster["cluster_id"] for cluster in body["clusters"]}
    for point in points:
        assert point["cluster_id"] in served_ids

    # Cluster memberships cover the clustered neighborhoods; the remaining
    # (DBSCAN noise) neighborhoods are served via the nearest-centroid
    # fallback. Memberships ∪ fallback points == all 25 (ADR-9).
    members = {
        neighborhood
        for cluster in body["clusters"]
        for neighborhood in cluster["neighborhoods"]
    }
    fallbacks = {point["neighborhood"] for point in points if point["fallback"]}
    assert members <= expected
    assert members.isdisjoint(fallbacks)
    assert members | fallbacks == expected


# ---------------------------------------------------------------------------
# (d) Drift pipeline end-to-end
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def train_feature_frame() -> pd.DataFrame:
    """Built TRAIN feature frame (945 real rows) for synthetic log lines."""
    train = load_split("train")
    return build_feature_frame(train, fit_neighborhood_stats(train))


def _jsonable(value: Any) -> Any:
    """Convert numpy scalars to plain Python types for ``json.dumps``."""
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def _write_synthetic_log(path: Path, rows: pd.DataFrame) -> Path:
    """Write SPEC §10 log lines for feature ``rows`` (realistic predictions).

    Prediction values cycle through the decile midpoints of
    ``models/monitoring/prediction_reference.json`` so the in-distribution
    window is clean on the prediction side too.
    """
    reference = json.loads(PREDICTION_REFERENCE_PATH.read_text(encoding="utf-8"))

    def midpoints(section: str) -> list[float]:
        edges = reference[section]["bin_edges"]
        return [(edges[i] + edges[i + 1]) / 2.0 for i in range(len(edges) - 1)]

    prices = midpoints("regression")
    probabilities = midpoints("classification")

    lines = []
    for index, (_, row) in enumerate(rows.iterrows()):
        lines.append(
            json.dumps(
                {
                    "timestamp": "2026-08-07T00:00:00+00:00",
                    "payload": dict(PAYLOAD),
                    "features": {key: _jsonable(value) for key, value in row.items()},
                    "prediction": {
                        "estimated_price": prices[index % len(prices)],
                        "probability": probabilities[index % len(probabilities)],
                        "cluster_id": 0,
                    },
                    "model_version": "ridge_v1+random_forest_v1",
                }
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_drift_pipeline_clean_window_no_drift(
    tmp_path: Path, train_feature_frame: pd.DataFrame
) -> None:
    """Train-like window → ok report, no drift, no retraining recommendation.

    A systematic every-5th-row sample (189 rows) keeps the neighborhood mix of
    the train split — a small random sample skews the neighborhood-level
    features and drifts for real.
    """
    sample = train_feature_frame.iloc[::5]
    log = _write_synthetic_log(tmp_path / "predictions.jsonl", sample)
    output = tmp_path / "drift" / "latest.json"
    report = run_drift_check(log_path=log, window=500, output_path=output)

    # latest.json structure (SPEC §10 report contract).
    assert set(report) == {
        "timestamp",
        "window",
        "log_path",
        "psi_threshold",
        "warn_threshold",
        "min_sample_for_retraining",
        "reference_feature_version",
        "n_invalid_lines",
        "status",
        "n_predictions",
        "low_sample",
        "drift_detected",
        "drifted_features",
        "calendar_drift_features",
        "warn_features",
        "per_feature_psi",
        "max_psi",
        "prediction_psi",
        "retraining_recommended",
        "recommendation_text",
    }
    assert report["status"] == "ok"
    assert report["n_predictions"] == len(sample)
    assert report["drift_detected"] is False
    assert report["drifted_features"] == []
    assert report["max_psi"] < PSI_DRIFT_THRESHOLD
    assert report["retraining_recommended"] is False
    assert report["recommendation_text"]
    # Real prediction reference is present → prediction PSI was computed.
    assert isinstance(report["prediction_psi"], dict)
    assert set(report["prediction_psi"]) == {"estimated_price", "probability"}

    # The report was persisted verbatim to the requested latest.json.
    on_disk = json.loads(output.read_text(encoding="utf-8"))
    assert on_disk == report


def test_drift_pipeline_shifted_window_flags_drift(
    tmp_path: Path, train_feature_frame: pd.DataFrame
) -> None:
    """GrLivArea ×3 window → ONLY GrLivArea drifts; n < 200 blocks retraining."""
    sample = train_feature_frame.iloc[::5].copy()
    sample["GrLivArea"] = sample["GrLivArea"] * 3.0
    log = _write_synthetic_log(tmp_path / "predictions.jsonl", sample)
    output = tmp_path / "drift" / "latest.json"
    report = run_drift_check(log_path=log, window=500, output_path=output)

    assert report["status"] == "ok"
    assert report["n_predictions"] == len(sample)
    assert report["drift_detected"] is True
    assert report["drifted_features"] == ["GrLivArea"]
    assert report["per_feature_psi"]["GrLivArea"] >= PSI_DRIFT_THRESHOLD
    # SPEC §10: retraining only on drift AND >= 200 samples — 189 < 200.
    assert report["n_predictions"] < MIN_SAMPLE_FOR_RETRAINING
    assert report["retraining_recommended"] is False
    assert json.loads(output.read_text(encoding="utf-8"))["drift_detected"] is True


def test_drift_pipeline_missing_log_is_no_data(tmp_path: Path) -> None:
    """Missing log → ``no_data`` report (exit-safe scheduled run, SPEC §10)."""
    output = tmp_path / "drift" / "latest.json"
    report = run_drift_check(
        log_path=tmp_path / "absent.jsonl", window=500, output_path=output
    )
    assert report["status"] == "no_data"
    assert report["n_predictions"] == 0
    assert report["drift_detected"] is False
    assert report["retraining_recommended"] is False
    assert output.is_file()


# ---------------------------------------------------------------------------
# (e) Feature determinism
# ---------------------------------------------------------------------------


def test_build_feature_frame_deterministic() -> None:
    """build_feature_frame twice on the same raw frame → identical output."""
    stats = load_neighborhood_stats()

    # Single serving row (payload → raw → frame).
    raw = serving_payload_to_raw(dict(PAYLOAD))
    first = build_feature_frame(pd.DataFrame([raw]), stats=stats)
    second = build_feature_frame(pd.DataFrame([dict(raw)]), stats=stats)
    pd.testing.assert_frame_equal(first, second)

    # Multi-row real data (vectorized path, processed val split).
    val = load_split("val").head(50)
    first_val = build_feature_frame(val, stats=stats)
    second_val = build_feature_frame(val.copy(), stats=stats)
    pd.testing.assert_frame_equal(first_val, second_val)
    assert list(first_val.columns) == MODEL_FEATURES


# ---------------------------------------------------------------------------
# (f) Prediction logging to the REAL logs/predictions.jsonl (backup + restore)
# ---------------------------------------------------------------------------


def test_predict_appends_spec10_line_to_real_log(tmp_path: Path) -> None:
    """A /predict call appends exactly one §10-schema line to the real log.

    The real ``logs/predictions.jsonl`` is backed up before the app runs and
    restored afterwards (even on failure), so the test leaves no trace.
    """
    log_path = LOGS_DIR / "predictions.jsonl"
    backup = tmp_path / "predictions.backup.jsonl"
    existed_before = log_path.exists()
    if existed_before:
        backup.write_bytes(log_path.read_bytes())
        n_lines_before = sum(
            1 for line in log_path.read_text(encoding="utf-8").splitlines() if line.strip()
        )
    else:
        n_lines_before = 0

    try:
        app = create_app(Settings())  # default PREDICTION_LOG_PATH = the real log
        with TestClient(app) as test_client:
            response = test_client.post("/predict", json=PAYLOAD)
        assert response.status_code == 200, response.text

        lines = [
            line
            for line in log_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        assert len(lines) == n_lines_before + 1, "expected exactly one new log line"

        record = json.loads(lines[-1])
        # Exact SPEC §10 top-level keys — no more, no less.
        assert set(record) == LOG_TOP_LEVEL_KEYS
        assert record["payload"]["neighborhood"] == PAYLOAD["neighborhood"]
        assert set(record["prediction"]) == {
            "estimated_price",
            "probability",
            "cluster_id",
        }
        # Full built feature row: exactly the MODEL_FEATURES keys.
        assert set(record["features"]) == set(MODEL_FEATURES)
        assert record["model_version"] == "ridge_v1+random_forest_v1"
    finally:
        if existed_before:
            log_path.write_bytes(backup.read_bytes())
        else:
            log_path.unlink(missing_ok=True)
