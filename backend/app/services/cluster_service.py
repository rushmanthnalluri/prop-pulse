"""Cluster service — micro-market lookups and the market-map payload."""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from ml.clustering.serve import MicroMarketLookup
from ml.paths import EXTERNAL_DIR

logger = logging.getLogger(__name__)

__all__ = ["ClusterService"]


class ClusterService:
    """Thin serving layer over :class:`MicroMarketLookup` (ADR-9).

    Args:
        lookup: Initialised micro-market lookup (clustering artifacts loaded).
        geo_path: Approximate neighborhood centroid table (for the map).
    """

    def __init__(
        self,
        lookup: MicroMarketLookup,
        geo_path: Any = EXTERNAL_DIR / "neighborhood_geo.csv",
    ) -> None:
        self._lookup = lookup
        geo = pd.read_csv(geo_path, keep_default_na=False)
        self._geo: dict[str, dict[str, Any]] = {
            str(row["Neighborhood"]): {
                "name": str(row["name"]),
                "lat": float(row["lat"]),
                "long": float(row["long"]),
            }
            for _, row in geo.iterrows()
        }

    def lookup(self, neighborhood: str) -> dict[str, Any]:
        """Micro-market cluster payload for one neighborhood."""
        return self._lookup.lookup(neighborhood)

    def market_clusters(self) -> dict[str, Any]:
        """Payload for ``GET /market/clusters``.

        Returns cluster stats plus one map point per known neighborhood.
        Noise-labeled neighborhoods (DBSCAN ``-1``) are resolved through the
        nearest-centroid fallback so every point has a usable ``cluster_id``.
        """
        clusters = []
        for cluster_id, entry in sorted(self._lookup.clusters.items()):
            clusters.append(
                {
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
                    "note": entry["note"],
                }
            )

        points = []
        for neighborhood, geo in sorted(self._geo.items()):
            resolved = self._lookup.lookup(neighborhood)
            points.append(
                {
                    "neighborhood": neighborhood,
                    "name": geo["name"],
                    "lat": geo["lat"],
                    "long": geo["long"],
                    "cluster_id": int(resolved["cluster_id"]),
                    "fallback": bool(resolved["fallback"]),
                }
            )

        return {
            "n_clusters": len(clusters),
            "clusters": clusters,
            "neighborhoods": points,
        }
