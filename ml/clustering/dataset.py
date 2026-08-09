"""Neighborhood-level feature matrix for micro-market discovery (ADR-9).

One row per Ames ``Neighborhood`` (25 total), joining:

- ``data/external/neighborhood_geo.csv`` — documented *approximate* real
  centroids (ADR-2); and
- ``models/neighborhood_stats.json`` — train-split-only market aggregates
  (``median_price_per_sqft``, ``monthly_sale_velocity``) produced by
  ``ml.features.stats``.

The resulting matrix columns are exactly :data:`FEATURE_COLUMNS`, the four
features DBSCAN clusters over. Every market aggregate comes from the TRAIN
split only (leakage rules, SPEC §5); ``price_per_sqft``-derived values are
clustering/EDA-only and never feed the regression/classification models.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from ml.features.stats import NeighborhoodStats, load_neighborhood_stats
from ml.paths import EXTERNAL_DIR, NEIGHBORHOOD_STATS_PATH

logger = logging.getLogger(__name__)

__all__ = [
    "CITY_CENTER",
    "FEATURE_COLUMNS",
    "GEO_PATH",
    "build_neighborhood_matrix",
    "load_neighborhood_geo",
]

#: Downtown Ames reference point (SPEC §2) — neutral default for unknown areas.
CITY_CENTER: tuple[float, float] = (42.0347, -93.6199)

#: DBSCAN input features, in column order (ADR-9).
FEATURE_COLUMNS: tuple[str, ...] = (
    "lat",
    "long",
    "median_price_per_sqft",
    "monthly_sale_velocity",
)

GEO_PATH: Path = EXTERNAL_DIR / "neighborhood_geo.csv"


def load_neighborhood_geo(path: Path = GEO_PATH) -> pd.DataFrame:
    """Load the approximate neighborhood centroids (25 rows).

    Raises:
        FileNotFoundError: If the geo CSV is missing.
        ValueError: If expected columns are absent.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"neighborhood geo file not found: {path}")
    geo = pd.read_csv(path)
    required = {"Neighborhood", "name", "lat", "long"}
    missing = required - set(geo.columns)
    if missing:
        raise ValueError(f"{path} is missing columns: {sorted(missing)}")
    return geo


def build_neighborhood_matrix(
    stats: NeighborhoodStats | None = None,
    geo_path: Path = GEO_PATH,
) -> pd.DataFrame:
    """Build the 25-row neighborhood feature matrix used for clustering.

    Args:
        stats: Train-fit neighborhood stats; loaded from
            ``models/neighborhood_stats.json`` when ``None``.
        geo_path: Path to the approximate-centroid CSV.

    Returns:
        DataFrame with columns ``Neighborhood``, ``name`` and
        :data:`FEATURE_COLUMNS`; one row per geo-coded neighborhood. Any
        neighborhood absent from the stats artifact falls back to the global
        train aggregates (with a logged warning), mirroring serving behavior.
    """
    if stats is None:
        stats = load_neighborhood_stats(NEIGHBORHOOD_STATS_PATH)
    geo = load_neighborhood_geo(geo_path)

    rows: list[dict[str, float | str]] = []
    for record in geo.itertuples(index=False):
        neighborhood = str(record.Neighborhood)
        market = stats.for_neighborhood(neighborhood)
        if neighborhood not in stats.neighborhoods:
            logger.warning(
                "neighborhood %s missing from train stats — using global fallback",
                neighborhood,
            )
        rows.append(
            {
                "Neighborhood": neighborhood,
                "name": str(record.name),
                "lat": float(record.lat),
                "long": float(record.long),
                "median_price_per_sqft": float(market["median_price_per_sqft"]),
                "monthly_sale_velocity": float(market["monthly_sale_velocity"]),
            }
        )

    frame = pd.DataFrame(rows)
    logger.info(
        "built neighborhood matrix: %d rows x %d features",
        len(frame),
        len(FEATURE_COLUMNS),
    )
    return frame
