"""Unit tests for ml.clustering artifacts and the serving lookup (SPEC §11, ADR-9).

Covers the persisted artifacts under ``models/clustering/`` produced by
``python -m ml.clustering.train``, the neighborhood feature-matrix builder, and
``MicroMarketLookup`` (direct hits, noise fallback, unknown-neighborhood
fallback).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import pandas as pd
import pytest
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler

from ml.clustering.dataset import FEATURE_COLUMNS, build_neighborhood_matrix
from ml.clustering.serve import MicroMarketLookup
from ml.paths import EXTERNAL_DIR, FIGURES_DIR, MODELS_DIR

CLUSTER_DIR = MODELS_DIR / "clustering"
ARTIFACT_NAMES = (
    "dbscan.joblib",
    "dbscan_scaler.joblib",
    "cluster_stats.json",
    "cluster_assignments.csv",
)
FIGURE_NAMES = ("cluster_map.png", "cluster_price_distribution.png", "cluster_kdistance.png")
GLOBAL_KEYS = {"n_clusters", "eps", "min_samples", "feature_names"}
CLUSTER_KEYS = {
    "label",
    "neighborhoods",
    "n_sales",
    "median_price",
    "median_price_per_sqft",
    "sale_velocity_30d",
    "centroid_lat",
    "centroid_long",
    "note",
}
LOOKUP_KEYS = CLUSTER_KEYS | {"cluster_id", "n_neighborhoods", "fallback"}


@pytest.fixture(scope="module")
def assignments() -> pd.DataFrame:
    """The persisted cluster_assignments.csv frame."""
    path = CLUSTER_DIR / "cluster_assignments.csv"
    assert path.exists(), f"missing {path} — run `python -m ml.clustering.train` first"
    return pd.read_csv(path)


@pytest.fixture(scope="module")
def cluster_stats() -> dict:
    """The persisted cluster_stats.json payload."""
    path = CLUSTER_DIR / "cluster_stats.json"
    assert path.exists(), f"missing {path} — run `python -m ml.clustering.train` first"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def lookup() -> MicroMarketLookup:
    """A serving lookup backed by the persisted artifacts."""
    return MicroMarketLookup()


def test_artifacts_exist() -> None:
    """All four clustering artifacts and three figures exist and are non-empty."""
    for name in ARTIFACT_NAMES:
        path = CLUSTER_DIR / name
        assert path.exists(), f"missing artifact {path}"
        assert path.stat().st_size > 0
    for name in FIGURE_NAMES:
        path = FIGURES_DIR / name
        assert path.exists(), f"missing figure {path}"
        assert path.stat().st_size > 0


def test_neighborhood_matrix_shape_and_columns() -> None:
    """The clustering feature matrix has 25 rows and the ADR-9 feature columns."""
    frame = build_neighborhood_matrix()
    assert len(frame) == 25
    assert list(FEATURE_COLUMNS) == ["lat", "long", "median_price_per_sqft", "monthly_sale_velocity"]
    assert not frame[list(FEATURE_COLUMNS)].isna().any().any()
    assert frame["Neighborhood"].is_unique


def test_assignments_cover_all_25_neighborhoods(assignments: pd.DataFrame) -> None:
    """Assignments cover exactly the 25 geo-coded neighborhoods, once each."""
    geo = pd.read_csv(EXTERNAL_DIR / "neighborhood_geo.csv")
    assert list(assignments.columns) == ["Neighborhood", "cluster_id"]
    assert len(assignments) == 25
    assert set(assignments["Neighborhood"]) == set(geo["Neighborhood"])
    assert assignments["cluster_id"].notna().all()


def test_cluster_stats_consistent_with_assignments(
    assignments: pd.DataFrame, cluster_stats: dict
) -> None:
    """cluster_stats keys match assignment labels and honor the ADR-9 contract."""
    clustered_ids = {int(c) for c in assignments["cluster_id"].unique()} - {-1}
    stat_ids = {int(k) for k in cluster_stats if k not in GLOBAL_KEYS}
    assert stat_ids == clustered_ids
    assert GLOBAL_KEYS.issubset(cluster_stats)
    assert cluster_stats["n_clusters"] == len(clustered_ids)
    assert 3 <= cluster_stats["n_clusters"] <= 10
    assert cluster_stats["min_samples"] in (2, 3)
    assert cluster_stats["eps"] > 0
    assert cluster_stats["feature_names"] == list(FEATURE_COLUMNS)
    for cid in stat_ids:
        entry = cluster_stats[str(cid)]
        assert CLUSTER_KEYS.issubset(entry), f"cluster {cid} missing fields"
        assert entry["n_sales"] > 0
        assert entry["median_price"] > 0
        assert 0.0 <= entry["sale_velocity_30d"] <= 1.0
        assert "SIMULATED" in entry["note"]
        # Every member neighborhood really carries this cluster id.
        for hood in entry["neighborhoods"]:
            row = assignments.loc[assignments["Neighborhood"] == hood, "cluster_id"]
            assert int(row.iloc[0]) == cid


def test_persisted_model_reproduces_assignments(assignments: pd.DataFrame) -> None:
    """The joblib DBSCAN + scaler reproduce cluster_assignments.csv exactly."""
    model = joblib.load(CLUSTER_DIR / "dbscan.joblib")
    scaler = joblib.load(CLUSTER_DIR / "dbscan_scaler.joblib")
    assert isinstance(model, DBSCAN)
    assert isinstance(scaler, StandardScaler)
    frame = build_neighborhood_matrix()
    labels = DBSCAN(eps=model.eps, min_samples=model.min_samples).fit_predict(
        scaler.transform(frame[list(FEATURE_COLUMNS)].to_numpy(dtype=float))
    )
    expected = (
        frame[["Neighborhood"]].assign(cluster_id=labels).sort_values("Neighborhood").reset_index(drop=True)
    )
    pd.testing.assert_frame_equal(
        expected, assignments.reset_index(drop=True), check_dtype=False
    )


def test_lookup_known_neighborhood(lookup: MicroMarketLookup) -> None:
    """lookup('CollgCr') returns a valid cluster payload with all fields."""
    result = lookup.lookup("CollgCr")
    assert LOOKUP_KEYS.issubset(result)
    assert result["cluster_id"] >= 0
    assert isinstance(result["label"], str) and result["label"]
    assert result["median_price"] > 0
    assert 0.0 <= result["sale_velocity_30d"] <= 1.0
    assert result["n_neighborhoods"] == len(result["neighborhoods"])
    assert math.isfinite(result["median_price_per_sqft"])


def test_lookup_noise_neighborhood_falls_back(
    lookup: MicroMarketLookup, assignments: pd.DataFrame
) -> None:
    """Noise-labeled neighborhoods resolve via nearest-centroid fallback."""
    noise = assignments.loc[assignments["cluster_id"] == -1, "Neighborhood"].tolist()
    assert noise, "expected at least one noise neighborhood for this test"
    for hood in noise:
        result = lookup.lookup(hood)
        assert result["fallback"] is True
        assert result["cluster_id"] >= 0


def test_lookup_unknown_neighborhood_falls_back(lookup: MicroMarketLookup) -> None:
    """lookup('NoSuchPlace') returns fallback=true with a valid cluster."""
    result = lookup.lookup("NoSuchPlace")
    assert result["fallback"] is True
    assert LOOKUP_KEYS.issubset(result)
    assert result["cluster_id"] >= 0


def test_lookup_clustered_neighborhood_is_direct(lookup: MicroMarketLookup) -> None:
    """A clustered neighborhood returns its own cluster with fallback=false."""
    result = lookup.lookup("StoneBr")
    assert result["fallback"] is False
    assert result["cluster_id"] == 0
    assert "StoneBr" in result["neighborhoods"]
