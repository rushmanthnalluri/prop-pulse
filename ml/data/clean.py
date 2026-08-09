"""Cleaning for the Ames Housing data, strictly per ``data_description.txt``.

NA semantics (authoritative source: ``data/raw/ames/data_description.txt``):

- For ``Alley``, ``Bsmt*`` (Qual/Cond/Exposure/FinType1/FinType2), ``FireplaceQu``,
  ``Garage*`` (Type/Finish/Qual/Cond), ``PoolQC``, ``Fence``, ``MiscFeature``,
  NA means the feature is **absent** -> filled with the literal string ``"None"``.
- Numeric companions of absent features are filled with 0
  (``MasVnrArea``, ``BsmtFinSF1/2``, ``BsmtUnfSF``, ``TotalBsmtSF``,
  ``GarageCars``, ``GarageArea``). ``GarageYrBlt`` NA (no garage) -> 0.
- ``MasVnrType`` NA -> ``"None"`` (consistent with its documented ``None`` level).
- ``LotFrontage`` NA is a *true* missing value -> imputed with the median
  within ``Neighborhood`` **fit on the train split only** (leakage guard,
  PROJECT_SPEC §4). Unseen neighborhoods fall back to the global train median.
- ``Electrical`` NA (1 row in train) is a true missing value -> imputed with
  the train-split mode.
- ``MSSubClass`` is a categorical code stored as an integer -> cast to ``str``.

Fitting (:class:`Cleaner`) happens on the train split only; val/test reuse the
fitted statistics so no information crosses split boundaries.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

logger = logging.getLogger(__name__)

#: Categorical columns where NA means "feature absent" per data_description.txt.
NA_ABSENT_CATEGORICAL: list[str] = [
    "Alley",
    "BsmtQual",
    "BsmtCond",
    "BsmtExposure",
    "BsmtFinType1",
    "BsmtFinType2",
    "FireplaceQu",
    "GarageType",
    "GarageFinish",
    "GarageQual",
    "GarageCond",
    "PoolQC",
    "Fence",
    "MiscFeature",
    "MasVnrType",
]

#: Numeric columns whose NA means the companion feature is absent -> 0.
NA_ABSENT_NUMERIC: list[str] = [
    "MasVnrArea",
    "BsmtFinSF1",
    "BsmtFinSF2",
    "BsmtUnfSF",
    "TotalBsmtSF",
    "GarageCars",
    "GarageArea",
    "GarageYrBlt",
]

ABSENT_TOKEN = "None"


@dataclass
class Cleaner:
    """Train-fitted cleaning statistics (leakage-safe).

    Attributes:
        lot_frontage_medians: median ``LotFrontage`` per ``Neighborhood`` (train).
        lot_frontage_global: global train ``LotFrontage`` median (fallback for
            neighborhoods unseen at fit time).
        electrical_mode: train mode of ``Electrical`` for the single true NA.
    """

    lot_frontage_medians: dict[str, float] = field(default_factory=dict)
    lot_frontage_global: float = 0.0
    electrical_mode: str = "SBrkr"


def fit_cleaner(train_df: pd.DataFrame) -> Cleaner:
    """Fit cleaning statistics on the TRAIN split only.

    Args:
        train_df: raw train split (must include ``LotFrontage``,
            ``Neighborhood`` and ``Electrical``).

    Returns:
        A :class:`Cleaner` holding only train-derived statistics.
    """
    medians = train_df.groupby("Neighborhood")["LotFrontage"].median().dropna()
    cleaner = Cleaner(
        lot_frontage_medians={str(k): float(v) for k, v in medians.items()},
        lot_frontage_global=float(train_df["LotFrontage"].median()),
        electrical_mode=str(train_df["Electrical"].mode(dropna=True).iloc[0]),
    )
    logger.info(
        "Fitted cleaner on %d train rows (%d neighborhood LotFrontage medians, global=%.1f)",
        len(train_df),
        len(cleaner.lot_frontage_medians),
        cleaner.lot_frontage_global,
    )
    return cleaner


def apply_cleaner(df: pd.DataFrame, cleaner: Cleaner) -> pd.DataFrame:
    """Apply documented NA semantics + train-fitted imputations to a split.

    Args:
        df: a raw split (train, val or test).
        cleaner: statistics fitted by :func:`fit_cleaner` on the train split.

    Returns:
        A cleaned copy of ``df`` (input is not mutated).
    """
    out = df.copy()

    # 1) NA = "absent feature" for documented categoricals.
    for col in NA_ABSENT_CATEGORICAL:
        out[col] = out[col].fillna(ABSENT_TOKEN)

    # 2) Numeric companions of absent features -> 0.
    for col in NA_ABSENT_NUMERIC:
        out[col] = out[col].fillna(0)

    # 3) LotFrontage: neighborhood median fitted on train; global fallback for
    #    neighborhoods unseen at fit time.
    neighborhood_median = out["Neighborhood"].map(cleaner.lot_frontage_medians)
    out["LotFrontage"] = out["LotFrontage"].fillna(neighborhood_median)
    out["LotFrontage"] = out["LotFrontage"].fillna(cleaner.lot_frontage_global)

    # 4) Electrical: true missing -> train mode.
    out["Electrical"] = out["Electrical"].fillna(cleaner.electrical_mode)

    # 5) MSSubClass is a categorical code, not a magnitude.
    #    Note: the CSV round-trip re-infers int64 for this column (the values
    #    are all digits), so every downstream consumer (training, features,
    #    backend) reads it back as int64 and the shared preprocessor treats it
    #    as a scaled numeric; schema.json declares that on-disk reality
    #    (AUD-13). True one-hot treatment is a documented future improvement —
    #    changing the feature space would invalidate the verified champions.
    out["MSSubClass"] = out["MSSubClass"].astype(str)

    remaining_na = int(out.isna().sum().sum())
    if remaining_na:
        cols = out.columns[out.isna().any()].tolist()
        raise ValueError(f"Cleaning left {remaining_na} unexpected NAs in columns: {cols}")

    logger.info("Cleaned split: %d rows, no remaining NAs", len(out))
    return out
