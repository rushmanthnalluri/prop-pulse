"""Comparable-sales service — similarity search over the train-split comps artifact.

Serves ``POST /market/comps`` and ``GET /market/trends`` from
``models/comps/comps.json`` (built by ``python -m ml.comps.build``):

- comps ranking: normalized euclidean distance over (gr_liv_area,
  overall_qual, year_built, bedrooms, baths) using the train-derived scales
  stored in the artifact; same-neighborhood sales are preferred, with a
  fallback to the subject's whole micro-market cluster when the neighborhood
  has fewer than ``top_n`` train sales;
- price percentile: the share of the matched scope's train sale prices at or
  below the subject's estimated price;
- market trends: median sale price + sales count per half-year period x
  cluster, with ``None`` for periods where a cluster has no sales.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

from ml.comps.build import COMPS_PATH, SIMILARITY_FEATURES

logger = logging.getLogger(__name__)

__all__ = ["CompsService"]

#: Response honesty notes (the train split covers 2006-2008; the exact years
#: come from the artifact's sale window at load time).
_COMPS_NOTE = "Historical sales {window} (training data), not current listings."
_TRENDS_NOTE = (
    "Median sale prices from training data ({window}); "
    "cluster windows with few sales are noisy."
)


class CompsService:
    """Nearest-neighbor comparable sales + half-year trends over the artifact.

    Args:
        artifact_path: ``models/comps/comps.json`` (train-split sales, slim).

    Raises:
        FileNotFoundError: If the artifact does not exist (run
            ``python -m ml.comps.build``).
        ValueError: If the artifact is missing required sections.
    """

    def __init__(self, artifact_path: Path = COMPS_PATH) -> None:
        path = Path(artifact_path)
        if not path.exists():
            raise FileNotFoundError(
                f"comps artifact not found: {path} — run `python -m ml.comps.build`"
            )
        payload = json.loads(path.read_text(encoding="utf-8"))
        try:
            self._sales: list[dict[str, Any]] = payload["sales"]
            scales: dict[str, float] = payload["similarity"]["scales"]
            self._window: dict[str, int] = payload["sale_window"]
        except KeyError as exc:
            raise ValueError(f"malformed comps artifact {path}: missing {exc}") from exc

        window = f"{self._window['min_year']}-{self._window['max_year']}"
        self._comps_note = _COMPS_NOTE.format(window=window)
        self._trends_note = _TRENDS_NOTE.format(window=window)

        # Vectorized view of the sales for distance ranking / scope filters.
        self._matrix = np.array(
            [[float(sale[feature]) for feature in SIMILARITY_FEATURES] for sale in self._sales]
        )
        self._scale_vec = np.array(
            [max(float(scales[feature]), 1e-9) for feature in SIMILARITY_FEATURES]
        )
        self._neighborhoods = np.array([str(sale["neighborhood"]) for sale in self._sales])
        self._clusters = np.array([int(sale["cluster"]) for sale in self._sales])
        self._prices = np.array([float(sale["sale_price"]) for sale in self._sales])
        self._year_month = np.array(
            [[int(sale["yr_sold"]), int(sale["mo_sold"])] for sale in self._sales]
        )
        logger.info(
            "CompsService ready: %d train sales, window %s", len(self._sales), window
        )

    def _scope(self, neighborhood: str, cluster_id: int, top_n: int) -> tuple[np.ndarray, str]:
        """Sales indices + scope name: neighborhood, else cluster fallback."""
        mask = self._neighborhoods == neighborhood
        if int(mask.sum()) >= top_n:
            return mask, "neighborhood"
        return self._clusters == cluster_id, "cluster"

    @staticmethod
    def _public_comp(sale: dict[str, Any], scope: str) -> dict[str, Any]:
        """One sale record → the API comp shape (SPEC contract keys only)."""
        return {
            "sale_price": int(sale["sale_price"]),
            "price_per_sqft": round(
                float(sale["sale_price"]) / max(float(sale["gr_liv_area"]), 1.0), 1
            ),
            "gr_liv_area": int(sale["gr_liv_area"]),
            "overall_qual": int(sale["overall_qual"]),
            "overall_cond": int(sale["overall_cond"]),
            "year_built": int(sale["year_built"]),
            "bedrooms": int(sale["bedrooms"]),
            "baths": float(sale["baths"]),
            "garage_cars": int(sale["garage_cars"]),
            "house_style": str(sale["house_style"]),
            "sold": f"{int(sale['mo_sold']):02d}/{int(sale['yr_sold'])}",
            "match_scope": scope,
        }

    def comps_response(
        self,
        *,
        subject: dict[str, float],
        neighborhood: str,
        cluster_id: int,
        estimated_price: float,
        top_n: int = 5,
    ) -> dict[str, Any]:
        """Full ``POST /market/comps`` payload for one subject property.

        Args:
            subject: Similarity features (gr_liv_area, overall_qual,
                year_built, bedrooms, baths) of the subject property.
            neighborhood: Subject neighborhood (preferred match scope).
            cluster_id: Subject micro-market cluster (fallback scope).
            estimated_price: Subject estimated price (percentile position).
            top_n: Number of comps to return.
        """
        mask, scope = self._scope(neighborhood, cluster_id, top_n)
        indices = np.flatnonzero(mask)

        subject_vec = np.array([float(subject[f]) for f in SIMILARITY_FEATURES])
        distances = np.sqrt(
            (((self._matrix[indices] - subject_vec) / self._scale_vec) ** 2).sum(axis=1)
        )
        nearest = indices[np.argsort(distances, kind="stable")[:top_n]]
        comps = [self._public_comp(self._sales[int(i)], scope) for i in nearest]

        scope_prices = self._prices[indices]
        percentile = round(
            float((scope_prices <= estimated_price).sum()) / float(len(scope_prices)) * 100.0,
            1,
        )
        return {
            "comps": comps,
            "match_scope": scope,
            "percentile": percentile,
            "note": self._comps_note,
        }

    def _half_year_periods(self) -> list[tuple[int, int]]:
        """``(year, half)`` periods covering the artifact sale window."""
        min_half = 1 if self._window["min_month"] <= 6 else 2
        max_half = 1 if self._window["max_month"] <= 6 else 2
        return [
            (year, half)
            for year in range(self._window["min_year"], self._window["max_year"] + 1)
            for half in (1, 2)
            if (year, half) >= (self._window["min_year"], min_half)
            and (year, half) <= (self._window["max_year"], max_half)
        ]

    def market_trends(self, cluster_labels: dict[int, str]) -> dict[str, Any]:
        """Full ``GET /market/trends`` payload: median price + count per half-year x cluster.

        Periods with no sales in a cluster get ``None`` median (a gap in the
        series) and a real ``0`` count (zero sales were observed).
        """
        periods = self._half_year_periods()
        sale_half = np.where(self._year_month[:, 1] <= 6, 1, 2)

        series = []
        for cluster_id in sorted(cluster_labels):
            in_cluster = self._clusters == cluster_id
            median_price: list[float | None] = []
            sales_count: list[int] = []
            for year, half in periods:
                mask = in_cluster & (self._year_month[:, 0] == year) & (sale_half == half)
                count = int(mask.sum())
                sales_count.append(count)
                median_price.append(
                    round(float(np.median(self._prices[mask])), 1) if count else None
                )
            series.append(
                {
                    "cluster": int(cluster_id),
                    "label": str(cluster_labels[cluster_id]),
                    "median_price": median_price,
                    "sales_count": sales_count,
                }
            )

        return {
            "periods": [f"{year}H{half}" for year, half in periods],
            "series": series,
            "note": self._trends_note,
        }
