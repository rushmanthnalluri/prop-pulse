"""Build the comparable-sales artifact from the TRAIN split (SPEC §5 leakage rules).

Produces ``models/comps/comps.json`` — the slim serving payload behind
``POST /market/comps`` and ``GET /market/trends``:

- one slim record per train sale carrying ONLY the columns the comps
  similarity ranking, the comps response, and the half-year trends need
  (``days_on_market`` / ``sells_within_30_days`` are NEVER exported — they
  are simulated-target columns (ADR-3) and must not leak into a market
  artifact);
- the train standard deviation ("scale") of each similarity feature, used by
  the serving-side normalized euclidean ranking;
- the train sale window (min/max ``(YrSold, MoSold)``), from which the
  half-year trend periods are derived at serving time.

Each sale also stores its micro-market cluster id, resolved through
:class:`ml.clustering.serve.MicroMarketLookup` so DBSCAN noise neighborhoods
get their nearest-centroid fallback cluster — the same resolution the API
applies to the subject property at serving time.

Regenerate after retraining or re-splitting::

    python -m ml.comps.build
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ml.clustering.serve import MicroMarketLookup
from ml.paths import DATASET_VERSION, MODELS_DIR
from ml.training.common import load_split, write_json

logger = logging.getLogger(__name__)

__all__ = [
    "COMPS_DIR",
    "COMPS_PATH",
    "SIMILARITY_FEATURES",
    "build_comps_artifact",
    "main",
]

#: Directory for comps artifacts (models/comps/).
COMPS_DIR: Path = MODELS_DIR / "comps"
#: Comparable-sales artifact built by this module.
COMPS_PATH: Path = COMPS_DIR / "comps.json"

#: Similarity features (artifact field names) for the normalized euclidean
#: ranking: ``baths`` is the above-grade total (FullBath + 0.5 * HalfBath).
SIMILARITY_FEATURES: tuple[str, ...] = (
    "gr_liv_area",
    "overall_qual",
    "year_built",
    "bedrooms",
    "baths",
)

#: Raw Ames column -> artifact field name for the passthrough columns.
_RAW_TO_FIELD: dict[str, str] = {
    "Neighborhood": "neighborhood",
    "SalePrice": "sale_price",
    "GrLivArea": "gr_liv_area",
    "OverallQual": "overall_qual",
    "OverallCond": "overall_cond",
    "YearBuilt": "year_built",
    "BedroomAbvGr": "bedrooms",
    "GarageCars": "garage_cars",
    "HouseStyle": "house_style",
    "MoSold": "mo_sold",
    "YrSold": "yr_sold",
}

#: Simulated-target / target-derived columns that must NEVER reach the
#: artifact (SPEC §5 / ADR-3); asserted on every emitted record.
_FORBIDDEN_FIELDS: frozenset[str] = frozenset({"days_on_market", "sells_within_30_days"})

#: Raw columns backing the similarity features (``baths`` is derived).
_SCALE_SOURCE: dict[str, str] = {
    "gr_liv_area": "GrLivArea",
    "overall_qual": "OverallQual",
    "year_built": "YearBuilt",
    "bedrooms": "BedroomAbvGr",
}


#: Artifact fields coerced to ``int`` (train numerics arrive as numpy int64).
_INT_FIELDS: frozenset[str] = frozenset(
    {
        "sale_price",
        "gr_liv_area",
        "overall_qual",
        "overall_cond",
        "year_built",
        "bedrooms",
        "garage_cars",
        "mo_sold",
        "yr_sold",
    }
)


def build_comps_artifact(output_path: Path = COMPS_PATH) -> dict[str, Any]:
    """Build (and persist) the comps artifact from the train split only.

    Args:
        output_path: Where to write the JSON artifact.

    Returns:
        The payload written to ``output_path``.
    """
    train = load_split("train")
    lookup = MicroMarketLookup()
    # Resolve each neighborhood's cluster once (nearest-centroid fallback for
    # DBSCAN noise neighborhoods) instead of per row.
    cluster_by_neighborhood = {
        str(neighborhood): int(lookup.lookup(str(neighborhood))["cluster_id"])
        for neighborhood in sorted(train["Neighborhood"].unique())
    }

    baths = train["FullBath"].astype(float) + 0.5 * train["HalfBath"].astype(float)

    sales: list[dict[str, Any]] = []
    for i, row in enumerate(train.itertuples(index=False)):
        record: dict[str, Any] = {}
        for raw, field in _RAW_TO_FIELD.items():
            value = getattr(row, raw)
            record[field] = int(value) if field in _INT_FIELDS else str(value)
        record["baths"] = float(baths.iloc[i])
        record["cluster"] = cluster_by_neighborhood[record["neighborhood"]]
        assert not (_FORBIDDEN_FIELDS & set(record)), f"forbidden fields in comps record: {record}"
        sales.append(record)

    # Train std per similarity feature; a degenerate (zero-variance) feature
    # gets scale 1.0 so the normalized distance never divides by zero.
    scales: dict[str, float] = {}
    for feature in SIMILARITY_FEATURES:
        series = baths if feature == "baths" else train[_SCALE_SOURCE[feature]].astype(float)
        std = float(series.std())
        scales[feature] = std if std > 0.0 else 1.0

    periods = sorted({(int(y), int(m)) for y, m in zip(train["YrSold"], train["MoSold"])})
    min_year, min_month = periods[0]
    max_year, max_month = periods[-1]

    payload: dict[str, Any] = {
        "version": 1,
        "dataset_version": DATASET_VERSION,
        "computed_from": "data/processed/train.csv (train split only)",
        "n_rows": int(len(train)),
        "sale_window": {
            "min_year": min_year,
            "min_month": min_month,
            "max_year": max_year,
            "max_month": max_month,
        },
        "similarity": {"features": list(SIMILARITY_FEATURES), "scales": scales},
        "sales": sales,
    }
    write_json(output_path, payload)
    logger.info(
        "wrote comps artifact: %d sales, %d neighborhoods, window %d-%02d..%d-%02d -> %s",
        len(sales),
        len(cluster_by_neighborhood),
        min_year,
        min_month,
        max_year,
        max_month,
        output_path,
    )
    return payload


def main() -> None:
    """CLI entry point: regenerate ``models/comps/comps.json``."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    build_comps_artifact()


if __name__ == "__main__":
    main()
