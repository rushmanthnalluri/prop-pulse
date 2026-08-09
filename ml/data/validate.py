"""Schema validation for raw and processed Ames Housing data.

Reused by the pipeline and by ``tests/data``. All validators raise
:class:`SchemaError` with a clear, actionable message on the first violation.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)


class SchemaError(ValueError):
    """Raised when a dataframe violates the Ames schema contract."""


# ---------------------------------------------------------------------------
# Schema definition (from data_description.txt — authoritative)
# ---------------------------------------------------------------------------

#: All 81 columns expected in raw train.csv (80 predictors + SalePrice).
RAW_COLUMNS: list[str] = [
    "Id", "MSSubClass", "MSZoning", "LotFrontage", "LotArea", "Street", "Alley",
    "LotShape", "LandContour", "Utilities", "LotConfig", "LandSlope", "Neighborhood",
    "Condition1", "Condition2", "BldgType", "HouseStyle", "OverallQual",
    "OverallCond", "YearBuilt", "YearRemodAdd", "RoofStyle", "RoofMatl",
    "Exterior1st", "Exterior2nd", "MasVnrType", "MasVnrArea", "ExterQual",
    "ExterCond", "Foundation", "BsmtQual", "BsmtCond", "BsmtExposure",
    "BsmtFinType1", "BsmtFinSF1", "BsmtFinType2", "BsmtFinSF2", "BsmtUnfSF",
    "TotalBsmtSF", "Heating", "HeatingQC", "CentralAir", "Electrical", "1stFlrSF",
    "2ndFlrSF", "LowQualFinSF", "GrLivArea", "BsmtFullBath", "BsmtHalfBath",
    "FullBath", "HalfBath", "BedroomAbvGr", "KitchenAbvGr", "KitchenQual",
    "TotRmsAbvGrd", "Functional", "Fireplaces", "FireplaceQu", "GarageType",
    "GarageYrBlt", "GarageFinish", "GarageCars", "GarageArea", "GarageQual",
    "GarageCond", "PavedDrive", "WoodDeckSF", "OpenPorchSF", "EnclosedPorch",
    "3SsnPorch", "ScreenPorch", "PoolArea", "PoolQC", "Fence", "MiscFeature",
    "MiscVal", "MoSold", "YrSold", "SaleType", "SaleCondition", "SalePrice",
]

#: Allowed category sets for validated categorical columns (cleaned values,
#: i.e. after NA -> "None" for the absent-feature columns).
EXPECTED_CATEGORIES: dict[str, set[str]] = {
    # Note: the raw data uses the literal value "C (all)" for Commercial,
    # not the "C" shown in data_description.txt.
    "MSZoning": {"A", "C (all)", "FV", "I", "RH", "RL", "RP", "RM"},
    "Street": {"Grvl", "Pave"},
    "Alley": {"Grvl", "Pave", "None"},
    "LotShape": {"Reg", "IR1", "IR2", "IR3"},
    "LandContour": {"Lvl", "Bnk", "HLS", "Low"},
    "Utilities": {"AllPub", "NoSewr", "NoSeWa", "ELO"},
    "LotConfig": {"Inside", "Corner", "CulDSac", "FR2", "FR3"},
    "LandSlope": {"Gtl", "Mod", "Sev"},
    "Neighborhood": {
        "Blmngtn", "Blueste", "BrDale", "BrkSide", "ClearCr", "CollgCr",
        "Crawfor", "Edwards", "Gilbert", "IDOTRR", "MeadowV", "Mitchel",
        "NAmes", "NoRidge", "NPkVill", "NridgHt", "NWAmes", "OldTown",
        "SWISU", "Sawyer", "SawyerW", "Somerst", "StoneBr", "Timber", "Veenker",
    },
    "Condition1": {"Artery", "Feedr", "Norm", "RRNn", "RRAn", "PosN", "PosA", "RRNe", "RRAe"},
    "Condition2": {"Artery", "Feedr", "Norm", "RRNn", "RRAn", "PosN", "PosA", "RRNe", "RRAe"},
    # Raw data uses "2fmCon"/"Duplex"/"Twnhs" spellings alongside the
    # documented "2FmCon"/"Duplx"/"TwnhsI"; both variants are allowed.
    "BldgType": {"1Fam", "2FmCon", "2fmCon", "Duplx", "Duplex", "TwnhsE", "TwnhsI", "Twnhs"},
    "HouseStyle": {"1Story", "1.5Fin", "1.5Unf", "2Story", "2.5Fin", "2.5Unf", "SFoyer", "SLvl"},
    "RoofStyle": {"Flat", "Gable", "Gambrel", "Hip", "Mansard", "Shed"},
    "RoofMatl": {"ClyTile", "CompShg", "Membran", "Metal", "Roll", "Tar&Grv", "WdShake", "WdShngl"},
    "ExterQual": {"Ex", "Gd", "TA", "Fa", "Po"},
    "ExterCond": {"Ex", "Gd", "TA", "Fa", "Po"},
    "Foundation": {"BrkTil", "CBlock", "PConc", "Slab", "Stone", "Wood"},
    "BsmtQual": {"Ex", "Gd", "TA", "Fa", "Po", "None"},
    "BsmtCond": {"Ex", "Gd", "TA", "Fa", "Po", "None"},
    "BsmtExposure": {"Gd", "Av", "Mn", "No", "None"},
    "BsmtFinType1": {"GLQ", "ALQ", "BLQ", "Rec", "LwQ", "Unf", "None"},
    "BsmtFinType2": {"GLQ", "ALQ", "BLQ", "Rec", "LwQ", "Unf", "None"},
    "Heating": {"Floor", "GasA", "GasW", "Grav", "OthW", "Wall"},
    "HeatingQC": {"Ex", "Gd", "TA", "Fa", "Po"},
    "CentralAir": {"N", "Y"},
    "Electrical": {"SBrkr", "FuseA", "FuseF", "FuseP", "Mix"},
    "KitchenQual": {"Ex", "Gd", "TA", "Fa", "Po"},
    "Functional": {"Typ", "Min1", "Min2", "Mod", "Maj1", "Maj2", "Sev", "Sal"},
    "FireplaceQu": {"Ex", "Gd", "TA", "Fa", "Po", "None"},
    "GarageType": {"2Types", "Attchd", "Basment", "BuiltIn", "CarPort", "Detchd", "None"},
    "GarageFinish": {"Fin", "RFn", "Unf", "None"},
    "GarageQual": {"Ex", "Gd", "TA", "Fa", "Po", "None"},
    "GarageCond": {"Ex", "Gd", "TA", "Fa", "Po", "None"},
    "PavedDrive": {"Y", "P", "N"},
    "PoolQC": {"Ex", "Gd", "TA", "Fa", "None"},
    "Fence": {"GdPrv", "MnPrv", "GdWo", "MnWw", "None"},
    "MiscFeature": {"Elev", "Gar2", "Othr", "Shed", "TenC", "None"},
    "SaleType": {"WD", "CWD", "VWD", "New", "COD", "Con", "ConLw", "ConLI", "ConLD", "Oth"},
    "SaleCondition": {"Normal", "Abnorml", "AdjLand", "Alloca", "Family", "Partial"},
}

#: (min, max) inclusive ranges for validated numeric columns.
NUMERIC_RANGES: dict[str, tuple[float, float]] = {
    "Id": (1, 10_000),
    "LotFrontage": (1, 500),
    "LotArea": (1, 1_000_000),
    "OverallQual": (1, 10),
    "OverallCond": (1, 10),
    "YearBuilt": (1870, 2010),
    "YearRemodAdd": (1950, 2010),
    "GrLivArea": (1, 10_000),
    "TotalBsmtSF": (0, 10_000),
    "1stFlrSF": (0, 10_000),
    "2ndFlrSF": (0, 10_000),
    "FullBath": (0, 5),
    "HalfBath": (0, 3),
    "BedroomAbvGr": (0, 10),
    "GarageCars": (0, 6),
    "GarageArea": (0, 2000),
    "MoSold": (1, 12),
    "YrSold": (2006, 2010),
    "SalePrice": (10_000, 1_000_000),
}

#: Ames, IA bounding box for neighborhood centroids (ADR-2).
LAT_RANGE: tuple[float, float] = (41.98, 42.09)
LONG_RANGE: tuple[float, float] = (-93.72, -93.55)

#: Extra columns the processed pipeline output must carry.
PROCESSED_EXTRA_COLUMNS: list[str] = [
    "lat", "long", "days_on_market", "sells_within_30_days",
]

DOM_MAX = 365


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def _check_columns(df: pd.DataFrame, expected: list[str], context: str) -> None:
    missing = [c for c in expected if c not in df.columns]
    if missing:
        raise SchemaError(f"{context}: missing required columns: {missing}")


def _check_unique_ids(df: pd.DataFrame, context: str) -> None:
    dupes = df[df["Id"].duplicated(keep=False)]["Id"].tolist()
    if dupes:
        raise SchemaError(f"{context}: duplicate Id values found: {sorted(set(dupes))[:10]}")


def _check_categories(df: pd.DataFrame, context: str) -> None:
    for col, allowed in EXPECTED_CATEGORIES.items():
        if col not in df.columns:
            continue
        observed = set(df[col].dropna().unique())
        unexpected = observed - allowed
        if unexpected:
            raise SchemaError(
                f"{context}: column '{col}' has unexpected categories: {sorted(unexpected)} "
                f"(allowed: {sorted(allowed)})"
            )


def _check_ranges(df: pd.DataFrame, ranges: dict[str, tuple[float, float]], context: str) -> None:
    for col, (lo, hi) in ranges.items():
        if col not in df.columns:
            continue
        values = df[col].dropna()
        bad = values[(values < lo) | (values > hi)]
        if len(bad):
            raise SchemaError(
                f"{context}: column '{col}' has {len(bad)} values outside [{lo}, {hi}] "
                f"(e.g. {bad.iloc[0]})"
            )


def _check_no_missing(df: pd.DataFrame, columns: list[str], context: str) -> None:
    missing = {c: int(df[c].isna().sum()) for c in columns if df[c].isna().any()}
    if missing:
        raise SchemaError(f"{context}: unexpected missing values: {missing}")


def validate_raw(df: pd.DataFrame) -> pd.DataFrame:
    """Validate the raw train.csv frame (pre-cleaning).

    Checks: expected 81 columns present, unique ``Id``, raw value ranges and
    raw category sets (absent-feature NAs are still NaN here, so category
    checks ignore NaN). Returns ``df`` for chaining.
    """
    _check_columns(df, RAW_COLUMNS, "raw")
    _check_unique_ids(df, "raw")
    _check_categories(df, "raw")
    _check_ranges(df, NUMERIC_RANGES, "raw")
    logger.info("Raw schema validation passed: %d rows", len(df))
    return df


def validate_processed(df: pd.DataFrame, split_name: str) -> pd.DataFrame:
    """Validate a processed split (post clean/geo-join/sale-speed).

    Checks, in addition to the raw rules: no missing values anywhere, the
    processed extra columns exist, coordinates inside the Ames bounding box,
    simulated-target columns are consistent, and (for val/test) no leakage of
    unknown categories. ``split_name`` is only used in error messages.
    """
    context = f"processed[{split_name}]"
    _check_columns(df, RAW_COLUMNS, context)
    _check_columns(df, PROCESSED_EXTRA_COLUMNS, context)
    _check_unique_ids(df, context)
    _check_categories(df, context)
    _check_ranges(df, NUMERIC_RANGES, context)
    _check_no_missing(df, list(df.columns), context)

    # Coordinate validity (Ames bounding box, ADR-2).
    _check_ranges(df, {"lat": LAT_RANGE, "long": LONG_RANGE}, context)

    # Simulated-target integrity.
    dom = df["days_on_market"]
    if (dom < 1).any() or (dom > DOM_MAX).any():
        raise SchemaError(f"{context}: days_on_market outside [1, {DOM_MAX}]")
    expected_flag = (dom <= 30).astype(int)
    if not df["sells_within_30_days"].astype(int).equals(expected_flag):
        raise SchemaError(
            f"{context}: sells_within_30_days is not consistent with days_on_market <= 30"
        )

    logger.info("Processed schema validation passed for %s: %d rows", split_name, len(df))
    return df


def build_schema_report(
    splits: dict[str, pd.DataFrame],
    dataset_version: str,
    notes: list[str],
) -> dict[str, Any]:
    """Build the JSON-serialisable schema description for ``schema.json``."""
    train = splits["train"]
    columns = {c: str(train[c].dtype) for c in train.columns}
    # clean.py casts MSSubClass to str in memory (categorical code, not a
    # magnitude), but the CSV round-trip re-infers int64 and every consumer
    # (training, features, backend) reads it as int64. Declare the on-disk
    # reality so the schema matches what readers actually get (AUD-13).
    columns["MSSubClass"] = "int64"
    return {
        "dataset_version": dataset_version,
        "source": "Kaggle House Prices: Advanced Regression Techniques (Ames, IA)",
        "columns": columns,
        "categories": {c: sorted(v) for c, v in EXPECTED_CATEGORIES.items()},
        "numeric_ranges": {c: [lo, hi] for c, (lo, hi) in NUMERIC_RANGES.items()},
        "lat_range": list(LAT_RANGE),
        "long_range": list(LONG_RANGE),
        "splits": {
            "train": {"rows": int(len(splits["train"])), "yr_sold": "2006-2008"},
            "val": {"rows": int(len(splits["val"])), "yr_sold": "2009"},
            "test": {"rows": int(len(splits["test"])), "yr_sold": "2010 (sealed)"},
        },
        "simulated_target": "SIMULATED TARGET - NOT FOR MODEL PERFORMANCE CLAIMS",
        "notes": notes,
    }


def write_schema_json(splits: dict[str, pd.DataFrame], path: Path, dataset_version: str,
                      notes: list[str]) -> Path:
    """Write ``data/processed/schema.json`` describing the processed outputs."""
    report = build_schema_report(splits, dataset_version, notes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2))
    logger.info("Wrote schema report to %s", path)
    return path
