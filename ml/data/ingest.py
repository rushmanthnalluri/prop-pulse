"""Raw data ingestion for the Ames Housing dataset.

Reads the raw Kaggle files from ``data/raw/ames/`` and the static neighborhood
geo lookup from ``data/external/neighborhood_geo.csv``. No transformation is
applied here — cleaning lives in :mod:`ml.data.clean`.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd

from ml.paths import EXTERNAL_DIR, RAW_AMES_DIR

logger = logging.getLogger(__name__)

RAW_TRAIN_CSV = RAW_AMES_DIR / "train.csv"
NEIGHBORHOOD_GEO_CSV = EXTERNAL_DIR / "neighborhood_geo.csv"


def load_raw_train(path: Path | None = None) -> pd.DataFrame:
    """Load the labeled raw training data (``train.csv``, 1460 rows x 81 cols).

    ``Id`` is loaded as int64; all other columns use pandas type inference.
    ``test.csv`` is intentionally not loaded anywhere: it has no ``SalePrice``
    and must never be used for evaluation (see PROJECT_SPEC §2).
    """
    csv_path = path or RAW_TRAIN_CSV
    if not csv_path.exists():
        raise FileNotFoundError(
            f"Raw training file not found at {csv_path}. "
            "Extract house-prices-advanced-regression-techniques1.zip into data/raw/ames/."
        )
    df = pd.read_csv(csv_path, dtype={"Id": "int64"})
    logger.info("Loaded raw train data: %d rows x %d cols from %s", len(df), df.shape[1], csv_path)
    return df


def load_neighborhood_geo(path: Path | None = None) -> pd.DataFrame:
    """Load the static approximate neighborhood centroid lookup (ADR-2).

    Expected columns: ``Neighborhood``, ``lat``, ``long``, ``note``.
    Centroids are approximate real-world locations in Ames, IA — see
    ``data/README.md`` for the approximation disclaimer.
    """
    csv_path = path or NEIGHBORHOOD_GEO_CSV
    if not csv_path.exists():
        raise FileNotFoundError(f"Neighborhood geo lookup not found at {csv_path}.")
    geo = pd.read_csv(csv_path)
    required = {"Neighborhood", "lat", "long", "note"}
    missing = required - set(geo.columns)
    if missing:
        raise ValueError(f"neighborhood_geo.csv is missing columns: {sorted(missing)}")
    logger.info("Loaded neighborhood geo lookup: %d neighborhoods", len(geo))
    return geo
