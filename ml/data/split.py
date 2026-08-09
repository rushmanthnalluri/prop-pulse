"""Time-based train/val/test split (ADR-4).

No shuffling: train = ``YrSold <= 2008``, val = ``YrSold == 2009``,
test = ``YrSold == 2010``. The test split is sealed until final evaluation.
"""
from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)

TRAIN_MAX_YEAR = 2008
VAL_YEAR = 2009
TEST_YEAR = 2010
EXPECTED_YEARS = {2006, 2007, 2008, 2009, 2010}


def time_split(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Split a cleaned frame into train/val/test by sale year.

    Args:
        df: dataframe with an integer ``YrSold`` column covering 2006-2010.

    Returns:
        ``{"train": ..., "val": ..., "test": ...}`` with disjoint Id sets.

    Raises:
        ValueError: if unexpected years appear or splits would overlap.
    """
    years = set(df["YrSold"].unique())
    unexpected = years - EXPECTED_YEARS
    if unexpected:
        raise ValueError(f"Unexpected YrSold values: {sorted(unexpected)}")

    train = df[df["YrSold"] <= TRAIN_MAX_YEAR].copy()
    val = df[df["YrSold"] == VAL_YEAR].copy()
    test = df[df["YrSold"] == TEST_YEAR].copy()

    id_sets = {"train": set(train["Id"]), "val": set(val["Id"]), "test": set(test["Id"])}
    for a in id_sets:
        for b in id_sets:
            if a < b and id_sets[a] & id_sets[b]:
                raise ValueError(f"Split overlap between {a} and {b}")

    if len(train) + len(val) + len(test) != len(df):
        raise ValueError("Split lost or duplicated rows")

    logger.info(
        "Time split: train=%d (YrSold<=2008), val=%d (2009), test=%d (2010)",
        len(train), len(val), len(test),
    )
    return {"train": train, "val": val, "test": test}
