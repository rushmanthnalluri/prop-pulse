"""Feature defaults for optional serving fields (SPEC §5, §8).

``FEATURE_DEFAULTS`` holds one default value per raw input column: the **train-split
mode** for categorical columns and the **train-split median** for numeric columns.
The artifact is persisted to ``models/feature_defaults.json`` and loaded by serving
code via :func:`load_feature_defaults`; :func:`compute_feature_defaults` rebuilds it
from the processed train split (train only — never val/test).

This module deliberately does not import :mod:`ml.features.pipeline` (which owns
``RAW_INPUT_COLUMNS``) to avoid a circular import; callers pass the column list.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

import pandas as pd

from ml.paths import DATASET_VERSION, FEATURE_DEFAULTS_PATH, PROCESSED_DIR

logger = logging.getLogger(__name__)

__all__ = [
    "FEATURE_DEFAULTS",
    "compute_feature_defaults",
    "save_feature_defaults",
    "load_feature_defaults",
]


def _default_for_column(series: pd.Series) -> Any:
    """Return the train mode (categorical) or median (numeric) for one column.

    Numeric medians that are integral are returned as ``int`` when the source
    column has an integer dtype, keeping defaults clean (e.g. ``2`` not ``2.0``).
    """
    if pd.api.types.is_numeric_dtype(series):
        median = float(series.median())
        if pd.api.types.is_integer_dtype(series) and median.is_integer():
            return int(median)
        return median
    mode = series.mode(dropna=False)
    if mode.empty:  # defensive: processed data has zero NaNs per SPEC §14
        return "None"
    return str(mode.iloc[0])


def compute_feature_defaults(
    train_df: pd.DataFrame, columns: Sequence[str]
) -> dict[str, Any]:
    """Compute FEATURE_DEFAULTS from the TRAIN split only.

    Args:
        train_df: Processed train frame (read with ``keep_default_na=False``).
        columns: Raw input columns to cover (``RAW_INPUT_COLUMNS``).

    Returns:
        Mapping of column name -> mode (categorical) or median (numeric).

    Raises:
        KeyError: If a requested column is absent from ``train_df``.
    """
    missing = [c for c in columns if c not in train_df.columns]
    if missing:
        raise KeyError(f"columns not present in train_df: {missing}")
    return {col: _default_for_column(train_df[col]) for col in columns}


def save_feature_defaults(
    defaults: dict[str, Any], path: Path = FEATURE_DEFAULTS_PATH
) -> Path:
    """Persist FEATURE_DEFAULTS as JSON (with provenance wrapper)."""
    payload = {
        "version": 1,
        "dataset_version": DATASET_VERSION,
        "computed_from": "data/processed/train.csv (train split only)",
        "semantics": "mode for categorical columns, median for numeric columns",
        "defaults": defaults,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    logger.info("wrote feature defaults for %d columns to %s", len(defaults), path)
    return path


@lru_cache(maxsize=1)
def load_feature_defaults(path: Path = FEATURE_DEFAULTS_PATH) -> dict[str, Any]:
    """Load FEATURE_DEFAULTS from ``models/feature_defaults.json``.

    Supports both the wrapped artifact format written by
    :func:`save_feature_defaults` and a bare ``{column: value}`` mapping.

    The result is cached for the process lifetime (``lru_cache``): regenerating
    the artifact on disk is not picked up by a running process — a restart is
    required (llba-features F1 stale-cache semantics).

    Raises:
        FileNotFoundError: If the artifact does not exist.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "defaults" in payload:
        return dict(payload["defaults"])
    return dict(payload)


def _load_feature_defaults_or_empty() -> dict[str, Any]:
    """Best-effort import-time load; empty dict if the artifact is absent."""
    try:
        return load_feature_defaults()
    except FileNotFoundError:
        logger.warning(
            "%s not found; FEATURE_DEFAULTS is empty until "
            "`python -m ml.features.pipeline` is run.",
            FEATURE_DEFAULTS_PATH,
        )
        return {}


FEATURE_DEFAULTS: dict[str, Any] = _load_feature_defaults_or_empty()
