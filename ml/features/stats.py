"""Neighborhood market statistics (SPEC §5) — fit on the TRAIN split only.

Per-``Neighborhood`` aggregates used both as joined model features and by the
API's micro-market responses:

- ``median_price`` / ``mean_price``: SalePrice statistics.
- ``median_price_per_sqft``: median of ``SalePrice / GrLivArea``.
- ``monthly_sale_velocity``: train sales count divided by the number of
  distinct calendar months (``YrSold`` x ``MoSold``) covered by the train
  split — comparable across neighborhoods.

Unseen neighborhoods at serving time fall back to the global train aggregates
(:attr:`NeighborhoodStats.global_fallback`). The artifact lives at
``models/neighborhood_stats.json``.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from ml.paths import DATASET_VERSION, NEIGHBORHOOD_STATS_PATH

logger = logging.getLogger(__name__)

__all__ = [
    "STAT_FIELDS",
    "NeighborhoodStats",
    "fit_neighborhood_stats",
    "save_neighborhood_stats",
    "load_neighborhood_stats",
]

#: Statistic keys stored per neighborhood (and in the global fallback).
STAT_FIELDS: tuple[str, ...] = (
    "median_price",
    "mean_price",
    "median_price_per_sqft",
    "monthly_sale_velocity",
)

_REQUIRED_COLUMNS = ("Neighborhood", "SalePrice", "GrLivArea", "YrSold", "MoSold")


@dataclass(frozen=True)
class NeighborhoodStats:
    """Train-only per-neighborhood market aggregates with a global fallback.

    Attributes:
        neighborhoods: ``{Neighborhood: {stat_field: value}}`` for every
            neighborhood seen in the train split.
        global_fallback: Same statistic fields computed over the whole train
            split; used for neighborhoods unseen during training.
        n_train_rows: Number of train rows the stats were fit on.
        n_months: Distinct (YrSold, MoSold) months covered by the train split;
            denominator of ``monthly_sale_velocity``.
        dataset_version: Dataset version tag from ``ml.paths``.
    """

    neighborhoods: dict[str, dict[str, float]]
    global_fallback: dict[str, float]
    n_train_rows: int
    n_months: int
    dataset_version: str = DATASET_VERSION

    def for_neighborhood(self, neighborhood: str) -> dict[str, float]:
        """Return stats for ``neighborhood``, or the global fallback if unseen."""
        return self.neighborhoods.get(neighborhood, self.global_fallback)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the JSON artifact format."""
        return {
            "version": 1,
            "dataset_version": self.dataset_version,
            "computed_from": "data/processed/train.csv (train split only)",
            "stat_fields": list(STAT_FIELDS),
            "n_train_rows": self.n_train_rows,
            "n_months": self.n_months,
            "global_fallback": self.global_fallback,
            "neighborhoods": self.neighborhoods,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "NeighborhoodStats":
        """Deserialize from the JSON artifact format."""
        return cls(
            neighborhoods={
                k: {f: float(v[f]) for f in STAT_FIELDS}
                for k, v in payload["neighborhoods"].items()
            },
            global_fallback={
                f: float(payload["global_fallback"][f]) for f in STAT_FIELDS
            },
            n_train_rows=int(payload["n_train_rows"]),
            n_months=int(payload["n_months"]),
            dataset_version=str(payload.get("dataset_version", DATASET_VERSION)),
        )


def _aggregate(frame: pd.DataFrame, n_months: int) -> dict[str, float]:
    """Compute the four STAT_FIELDS aggregates over ``frame``."""
    price = frame["SalePrice"].astype(float)
    gr_liv_area = frame["GrLivArea"].astype(float).clip(lower=1.0)
    price_per_sqft = price / gr_liv_area
    return {
        "median_price": float(price.median()),
        "mean_price": float(price.mean()),
        "median_price_per_sqft": float(price_per_sqft.median()),
        "monthly_sale_velocity": float(len(frame)) / float(n_months),
    }


def fit_neighborhood_stats(train_df: pd.DataFrame) -> NeighborhoodStats:
    """Fit neighborhood statistics on the TRAIN split only.

    Args:
        train_df: Processed train frame with at least ``Neighborhood``,
            ``SalePrice``, ``GrLivArea``, ``YrSold``, ``MoSold``.

    Returns:
        A :class:`NeighborhoodStats` with per-neighborhood aggregates and a
        global train fallback for unseen neighborhoods.

    Raises:
        KeyError: If a required column is missing.
        ValueError: If ``train_df`` is empty.
    """
    missing = [c for c in _REQUIRED_COLUMNS if c not in train_df.columns]
    if missing:
        raise KeyError(f"columns required to fit stats not present: {missing}")
    if train_df.empty:
        raise ValueError("train_df is empty; cannot fit neighborhood stats")

    n_months = int(train_df[["YrSold", "MoSold"]].drop_duplicates().shape[0])
    neighborhoods = {
        str(name): _aggregate(group, n_months)
        for name, group in train_df.groupby("Neighborhood", sort=True)
    }
    stats = NeighborhoodStats(
        neighborhoods=neighborhoods,
        global_fallback=_aggregate(train_df, n_months),
        n_train_rows=int(len(train_df)),
        n_months=n_months,
    )
    logger.info(
        "fit neighborhood stats on %d train rows: %d neighborhoods, %d months",
        stats.n_train_rows,
        len(neighborhoods),
        n_months,
    )
    return stats


def save_neighborhood_stats(
    stats: NeighborhoodStats, path: Path = NEIGHBORHOOD_STATS_PATH
) -> Path:
    """Persist stats to ``models/neighborhood_stats.json``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(stats.to_dict(), indent=2) + "\n", encoding="utf-8"
    )
    logger.info("wrote neighborhood stats to %s", path)
    return path


def load_neighborhood_stats(path: Path = NEIGHBORHOOD_STATS_PATH) -> NeighborhoodStats:
    """Load stats from ``models/neighborhood_stats.json``.

    Raises:
        FileNotFoundError: If the artifact does not exist (run
            ``python -m ml.features.pipeline`` to generate it).
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return NeighborhoodStats.from_dict(payload)
