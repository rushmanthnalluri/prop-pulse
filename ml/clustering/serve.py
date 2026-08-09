"""Serving-side lookup from a neighborhood to its micro-market cluster (ADR-9).

``MicroMarketLookup`` loads the persisted clustering artifacts
(``models/clustering/``) plus the train-fit neighborhood stats and the
approximate-centroid geo table, then answers:

- **Known, clustered neighborhood** → its DBSCAN cluster with the train-split
  descriptive stats (``fallback: false``).
- **Noise-labeled or unknown neighborhood** → nearest cluster centroid in the
  *scaled* 4-feature space. The feature vector uses the neighborhood's own
  approximate centroid plus ``models/neighborhood_stats.json`` aggregates, or
  downtown Ames (42.0347, -93.6199) + the global train fallback stats for
  never-seen neighborhoods. The returned dict keeps the nearest cluster's
  ``label`` unchanged and adds ``fallback: true``.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.clustering.dataset import (
    CITY_CENTER,
    FEATURE_COLUMNS,
    GEO_PATH,
    build_neighborhood_matrix,
)
from ml.features.stats import NeighborhoodStats, load_neighborhood_stats
from ml.paths import MODELS_DIR, NEIGHBORHOOD_STATS_PATH

logger = logging.getLogger(__name__)

__all__ = ["DEFAULT_MODEL_DIR", "MicroMarketLookup"]

DEFAULT_MODEL_DIR: Path = MODELS_DIR / "clustering"

_NOISE_LABEL = -1


class MicroMarketLookup:
    """Map an Ames neighborhood code to its micro-market cluster + stats.

    Args:
        model_dir: Directory holding ``dbscan.joblib``, ``dbscan_scaler.joblib``,
            ``cluster_stats.json`` and ``cluster_assignments.csv``.
        stats_path: Train-fit neighborhood stats artifact.
        geo_path: Approximate neighborhood centroid CSV.

    Raises:
        FileNotFoundError: If any clustering artifact is missing.
        ValueError: If artifacts are mutually inconsistent.
    """

    def __init__(
        self,
        model_dir: Path = DEFAULT_MODEL_DIR,
        stats_path: Path = NEIGHBORHOOD_STATS_PATH,
        geo_path: Path = GEO_PATH,
    ) -> None:
        model_dir = Path(model_dir)
        required = ("dbscan.joblib", "dbscan_scaler.joblib", "cluster_stats.json", "cluster_assignments.csv")
        missing = [name for name in required if not (model_dir / name).exists()]
        if missing:
            raise FileNotFoundError(
                f"clustering artifacts missing in {model_dir}: {missing} — run `python -m ml.clustering.train`"
            )

        # dbscan.joblib is loaded here so a missing/corrupt artifact fails at
        # startup, but the fitted model is never queried afterwards: serving
        # answers come entirely from the scaler + scaled-space cluster
        # centroids built below. The object is retained for interface
        # completeness with the persisted artifact set (AUD-26c).
        self._dbscan = joblib.load(model_dir / "dbscan.joblib")
        self._scaler = joblib.load(model_dir / "dbscan_scaler.joblib")
        payload = json.loads((model_dir / "cluster_stats.json").read_text(encoding="utf-8"))
        self._clusters: dict[int, dict[str, Any]] = {
            int(key): value for key, value in payload.items() if key.lstrip("-").isdigit()
        }
        self.meta: dict[str, Any] = {
            key: payload[key] for key in ("n_clusters", "eps", "min_samples", "feature_names") if key in payload
        }

        assignments = pd.read_csv(model_dir / "cluster_assignments.csv")
        self._assignments: dict[str, int] = {
            str(row.Neighborhood): int(row.cluster_id) for row in assignments.itertuples(index=False)
        }

        self._stats: NeighborhoodStats = load_neighborhood_stats(stats_path)
        self._frame = build_neighborhood_matrix(self._stats, geo_path)
        self._feature_by_neighborhood: dict[str, np.ndarray] = {
            str(row["Neighborhood"]): row[list(FEATURE_COLUMNS)].to_numpy(dtype=float)
            for _, row in self._frame.iterrows()
        }

        if set(self._clusters) != (set(self._assignments.values()) - {_NOISE_LABEL}):
            raise ValueError("cluster_stats.json keys do not match cluster_assignments.csv labels")

        # Cluster centroids in SCALED feature space (mean of member vectors).
        self._centroids: dict[int, np.ndarray] = {}
        for cluster_id in self._clusters:
            members = [
                self._feature_by_neighborhood[n]
                for n, cid in self._assignments.items()
                if cid == cluster_id and n in self._feature_by_neighborhood
            ]
            if not members:
                raise ValueError(f"cluster {cluster_id} has no geo-coded members")
            self._centroids[cluster_id] = self._scaler.transform(np.vstack(members)).mean(axis=0)
        logger.info(
            "MicroMarketLookup ready: %d clusters, %d assignments, eps=%.4f, min_samples=%d",
            len(self._clusters), len(self._assignments),
            float(self.meta.get("eps", float("nan"))), int(self.meta.get("min_samples", 0)),
        )

    @property
    def assignments(self) -> dict[str, int]:
        """``{Neighborhood: cluster_id}`` for all 25 neighborhoods (-1 = noise)."""
        return dict(self._assignments)

    @property
    def clusters(self) -> dict[int, dict[str, Any]]:
        """Per-cluster stats payload keyed by cluster id."""
        return {cid: dict(entry) for cid, entry in self._clusters.items()}

    def _feature_vector(self, neighborhood: str) -> np.ndarray:
        """Unscaled 4-feature vector; downtown + global fallback when unknown."""
        known = self._feature_by_neighborhood.get(neighborhood)
        if known is not None:
            return known
        fallback = self._stats.global_fallback
        return np.array(
            [
                CITY_CENTER[0],
                CITY_CENTER[1],
                float(fallback["median_price_per_sqft"]),
                float(fallback["monthly_sale_velocity"]),
            ]
        )

    def _nearest_cluster(self, neighborhood: str) -> int:
        """Cluster id whose scaled-space centroid is nearest to the neighborhood."""
        scaled = self._scaler.transform(self._feature_vector(neighborhood).reshape(1, -1))[0]
        distances = {
            cid: float(np.linalg.norm(scaled - centroid)) for cid, centroid in self._centroids.items()
        }
        nearest = min(distances, key=lambda cid: (distances[cid], cid))
        logger.debug("nearest cluster for %r: %d (distance %.3f)", neighborhood, nearest, distances[nearest])
        return nearest

    def _payload(self, cluster_id: int, fallback: bool) -> dict[str, Any]:
        """Assemble the public lookup response for a cluster."""
        entry = self._clusters[cluster_id]
        return {
            "cluster_id": int(cluster_id),
            "label": entry["label"],
            "neighborhoods": list(entry["neighborhoods"]),
            "n_neighborhoods": len(entry["neighborhoods"]),
            "n_sales": int(entry["n_sales"]),
            "median_price": float(entry["median_price"]),
            "median_price_per_sqft": float(entry["median_price_per_sqft"]),
            "sale_velocity_30d": float(entry["sale_velocity_30d"]),
            "centroid_lat": float(entry["centroid_lat"]),
            "centroid_long": float(entry["centroid_long"]),
            "fallback": bool(fallback),
            "note": entry["note"],
        }

    def lookup(self, neighborhood: str) -> dict[str, Any]:
        """Return the micro-market cluster for ``neighborhood``.

        Known, clustered neighborhoods return their own cluster with
        ``fallback: false``. Noise-labeled or never-seen neighborhoods are
        assigned to the nearest cluster centroid in scaled feature space with
        ``fallback: true`` (label left unchanged, per ADR-9).
        """
        key = str(neighborhood).strip()
        cluster_id = self._assignments.get(key)
        if cluster_id is not None and cluster_id != _NOISE_LABEL:
            return self._payload(cluster_id, fallback=False)
        nearest = self._nearest_cluster(key)
        if cluster_id == _NOISE_LABEL:
            logger.info("neighborhood %r is DBSCAN noise; nearest-centroid fallback -> %d", key, nearest)
        else:
            logger.info("unknown neighborhood %r; nearest-centroid fallback -> %d", key, nearest)
        return self._payload(nearest, fallback=True)
