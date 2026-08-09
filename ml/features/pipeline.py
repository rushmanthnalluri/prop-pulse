"""Feature pipeline — single source of truth for model inputs (SPEC §5).

Used by training, evaluation, clustering AND the API; no feature logic may be
re-implemented elsewhere. ``build_feature_frame`` turns a raw processed frame
(the columns of ``data/processed/*.csv``) into the model-ready frame defined by
``MODEL_FEATURES``.

Leakage rules enforced here (SPEC §5):

- ``Id``, ``SalePrice``, ``days_on_market``, ``sells_within_30_days``,
  ``SaleType`` and ``SaleCondition`` are excluded from ``RAW_INPUT_COLUMNS``
  (not knowable pre-listing, or target/target-derived).
- All aggregate statistics are fit on the train split only
  (:mod:`ml.features.stats`); unseen neighborhoods use the global fallback.

Missing optional columns are filled from ``FEATURE_DEFAULTS`` (train
mode/median, :mod:`ml.features.defaults`), so a serving row built by
:func:`ml.features.serving.serving_payload_to_raw` flows through unchanged.

Geography is neighborhood-grain by default (ADR-2): ``lat``/``long`` are
approximate centroids from ``data/external/neighborhood_geo.csv``. An
optional upgrade path exists — when ``data/external/property_geo.csv``
(schema ``Id,lat,long``) is present, rows carry per-property coordinates
instead (Id join, centroid fallback for unmatched rows, Ames bounding-box
validation; see ``docs/GEOGRAPHY.md``). Absence of that file keeps the
current behavior exactly.

Run ``python -m ml.features.pipeline`` to (re)generate the three artifacts:
``models/neighborhood_stats.json``, ``models/feature_defaults.json`` and
``models/feature_list.json``.
"""
from __future__ import annotations

import hashlib
import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ml.features.defaults import (
    FEATURE_DEFAULTS,
    compute_feature_defaults,
    save_feature_defaults,
)
from ml.features.stats import (
    NeighborhoodStats,
    fit_neighborhood_stats,
    load_neighborhood_stats,
    save_neighborhood_stats,
)
from ml.paths import (
    EXTERNAL_DIR,
    FEATURE_LIST_PATH,
    PROCESSED_DIR,
)

logger = logging.getLogger(__name__)

__all__ = [
    "RAW_INPUT_COLUMNS",
    "ENGINEERED_FEATURES",
    "NEIGHBORHOOD_STAT_FEATURES",
    "MODEL_FEATURES",
    "FEATURE_DEFAULTS",
    "CITY_CENTER_LAT",
    "CITY_CENTER_LONG",
    "build_feature_frame",
    "neighborhood_coordinates",
    "write_feature_list",
]

#: Columns never consumed by models: identifier, target, per-row target
#: derivations / simulated targets, and fields not knowable pre-listing.
EXCLUDED_RAW_COLUMNS: tuple[str, ...] = (
    "Id",
    "SalePrice",
    "days_on_market",
    "sells_within_30_days",
    "SaleType",
    "SaleCondition",
)

#: Fixed raw processed-CSV columns the models may consume (all others ignored).
RAW_INPUT_COLUMNS: list[str] = [
    "MSSubClass",
    "MSZoning",
    "LotFrontage",
    "LotArea",
    "Street",
    "Alley",
    "LotShape",
    "LandContour",
    "Utilities",
    "LotConfig",
    "LandSlope",
    "Neighborhood",
    "Condition1",
    "Condition2",
    "BldgType",
    "HouseStyle",
    "OverallQual",
    "OverallCond",
    "YearBuilt",
    "YearRemodAdd",
    "RoofStyle",
    "RoofMatl",
    "Exterior1st",
    "Exterior2nd",
    "MasVnrType",
    "MasVnrArea",
    "ExterQual",
    "ExterCond",
    "Foundation",
    "BsmtQual",
    "BsmtCond",
    "BsmtExposure",
    "BsmtFinType1",
    "BsmtFinSF1",
    "BsmtFinType2",
    "BsmtFinSF2",
    "BsmtUnfSF",
    "TotalBsmtSF",
    "Heating",
    "HeatingQC",
    "CentralAir",
    "Electrical",
    "1stFlrSF",
    "2ndFlrSF",
    "LowQualFinSF",
    "GrLivArea",
    "BsmtFullBath",
    "BsmtHalfBath",
    "FullBath",
    "HalfBath",
    "BedroomAbvGr",
    "KitchenAbvGr",
    "KitchenQual",
    "TotRmsAbvGrd",
    "Functional",
    "Fireplaces",
    "FireplaceQu",
    "GarageType",
    "GarageYrBlt",
    "GarageFinish",
    "GarageCars",
    "GarageArea",
    "GarageQual",
    "GarageCond",
    "PavedDrive",
    "WoodDeckSF",
    "OpenPorchSF",
    "EnclosedPorch",
    "3SsnPorch",
    "ScreenPorch",
    "PoolArea",
    "PoolQC",
    "Fence",
    "MiscFeature",
    "MiscVal",
    "MoSold",
    "YrSold",
    "lat",
    "long",
]

#: Engineered features added on top of the raw inputs (SPEC §5). ``lat`` and
#: ``long`` are already part of ``RAW_INPUT_COLUMNS`` (passthrough / lookup).
ENGINEERED_FEATURES: list[str] = [
    "property_age",
    "years_since_remod",
    "total_bath",
    "living_area_per_bedroom",
    "bathroom_bedroom_ratio",
    "total_sf",
    "sale_month",
    "sale_quarter",
    "sale_year",
    "distance_to_city_center_km",
    "amenity_count",
]

#: Train-only neighborhood aggregates joined on ``Neighborhood``.
NEIGHBORHOOD_STAT_FEATURES: list[str] = [
    "neighborhood_median_price",
    "neighborhood_mean_price",
    "neighborhood_median_price_per_sqft",
    "neighborhood_monthly_sale_velocity",
]

#: Final model feature list — column order of every model-ready frame.
MODEL_FEATURES: list[str] = (
    RAW_INPUT_COLUMNS + ENGINEERED_FEATURES + NEIGHBORHOOD_STAT_FEATURES
)
assert len(MODEL_FEATURES) == len(set(MODEL_FEATURES)), "duplicate model features"

#: Downtown Ames reference point (SPEC §2 / ADR-2).
CITY_CENTER_LAT = 42.0347
CITY_CENTER_LONG = -93.6199

_GEO_PATH = EXTERNAL_DIR / "neighborhood_geo.csv"
_EARTH_RADIUS_KM = 6371.0

#: Optional per-property geo override (docs/GEOGRAPHY.md). When this file
#: exists with schema ``Id,lat,long``, matching rows get those coordinates
#: instead of the neighborhood centroids. Not committed — the centroid-only
#: behavior is the default.
_PROPERTY_GEO_PATH = EXTERNAL_DIR / "property_geo.csv"

#: Ames, IA bounding box used to reject garbage override coordinates
#: (same bounds as ``data/README.md`` documents for the centroids).
_AMES_LAT_RANGE = (41.98, 42.09)
_AMES_LONG_RANGE = (-93.72, -93.55)


@lru_cache(maxsize=1)
def _geo_lookup() -> dict[str, tuple[float, float]]:
    """Neighborhood -> (lat, long) approximate centroid (ADR-2).

    Cached for the process lifetime (``lru_cache``): in-place edits of
    ``neighborhood_geo.csv`` are picked up only after a process restart
    (llba-features F1 stale-cache semantics).
    """
    geo = pd.read_csv(_GEO_PATH, keep_default_na=False)
    return {
        str(row["Neighborhood"]): (float(row["lat"]), float(row["long"]))
        for _, row in geo.iterrows()
    }


def neighborhood_coordinates(neighborhood: str) -> tuple[float, float]:
    """Return the approximate ``(lat, long)`` centroid of ``neighborhood``.

    Used by :mod:`ml.features.serving` so payload-built rows carry the real
    neighborhood centroid rather than a global default. Unseen neighborhoods
    fall back to the ``FEATURE_DEFAULTS`` coordinates (consistent with the
    neighborhood-stats global fallback).
    """
    coords = _geo_lookup().get(str(neighborhood))
    if coords is None:
        logger.debug(
            "neighborhood %r not in geo lookup; using FEATURE_DEFAULTS lat/long",
            neighborhood,
        )
        coords = (float(FEATURE_DEFAULTS["lat"]), float(FEATURE_DEFAULTS["long"]))
    return coords


def _num(frame: pd.DataFrame, column: str) -> pd.Series:
    """Return ``frame[column]`` coerced to float (defensive for serving rows)."""
    return pd.to_numeric(frame[column], errors="coerce").astype(float)


def _haversine_km(
    lat1: pd.Series, long1: pd.Series, lat2: float, long2: float
) -> pd.Series:
    """Vectorized haversine distance in kilometres to a fixed point."""
    lat1_r = np.radians(lat1.astype(float))
    long1_r = np.radians(long1.astype(float))
    lat2_r = np.radians(lat2)
    long2_r = np.radians(long2)
    dlat = lat2_r - lat1_r
    dlong = long2_r - long1_r
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1_r) * np.cos(lat2_r) * np.sin(
        dlong / 2.0
    ) ** 2
    return pd.Series(
        2.0 * _EARTH_RADIUS_KM * np.arcsin(np.sqrt(a)), index=lat1.index
    )


def _fill_geo_from_neighborhood(frame: pd.DataFrame) -> pd.DataFrame:
    """Join ``lat``/``long`` from the neighborhood centroid lookup when absent.

    The processed CSVs already carry ``lat``/``long`` (joined by ``ml.data``);
    this path covers serving rows that only know their ``Neighborhood``.
    Neighborhoods missing from the geo lookup (unseen) fall back to the
    ``FEATURE_DEFAULTS`` coordinates so the frame stays NaN-free.
    """
    if {"lat", "long"}.issubset(frame.columns) or "Neighborhood" not in frame.columns:
        return frame
    lookup = _geo_lookup()
    joined = frame.copy()
    for column, idx in (("lat", 0), ("long", 1)):
        if column not in joined.columns:
            mapped = joined["Neighborhood"].astype(str).map(
                lambda name, i=idx: lookup[name][i] if name in lookup else np.nan
            )
            if column in FEATURE_DEFAULTS:
                mapped = mapped.fillna(float(FEATURE_DEFAULTS[column]))
            joined[column] = mapped
    return joined


@lru_cache(maxsize=4)
def _property_geo_lookup(path: Path) -> dict[int, tuple[float, float]] | None:
    """Load the optional per-property ``Id -> (lat, long)`` override.

    Returns ``None`` when ``path`` does not exist — the default, keeping the
    neighborhood-centroid behavior. The result is cached per path (keyed on
    the path only), so the "which geo source" log line is emitted once per
    file — and a same-path rewrite or delete of the CSV is NOT picked up by a
    running process; a restart (or fresh process) is required (llba-features
    F1 stale-cache semantics). Tests sidestep this via unique tmp paths.

    Raises:
        ValueError: If the file exists but is garbage: missing columns, no
            rows, non-numeric or non-integer ``Id``, duplicate ``Id``, or
            coordinates outside the Ames bounding box
            (:data:`_AMES_LAT_RANGE` / :data:`_AMES_LONG_RANGE`).
    """
    path = Path(path)
    if not path.exists():
        logger.debug(
            "no property geo override at %s; using neighborhood centroids", path
        )
        return None
    geo = pd.read_csv(path, keep_default_na=False)
    missing = {"Id", "lat", "long"} - set(geo.columns)
    if missing:
        raise ValueError(f"property_geo.csv is missing columns: {sorted(missing)}")
    if geo.empty:
        raise ValueError("property_geo.csv has no rows")
    ids = pd.to_numeric(geo["Id"], errors="coerce")
    lat = pd.to_numeric(geo["lat"], errors="coerce")
    long = pd.to_numeric(geo["long"], errors="coerce")
    if ids.isna().any() or lat.isna().any() or long.isna().any():
        raise ValueError("property_geo.csv has non-numeric Id/lat/long values")
    if (ids % 1 != 0).any():
        raise ValueError("property_geo.csv Id values must be integers")
    if ids.duplicated().any():
        dups = ids[ids.duplicated()].astype(int).head(5).tolist()
        raise ValueError(f"property_geo.csv has duplicate Id values: {dups}")
    in_bbox = lat.between(*_AMES_LAT_RANGE) & long.between(*_AMES_LONG_RANGE)
    if not in_bbox.all():
        bad = ids[~in_bbox].astype(int).head(5).tolist()
        raise ValueError(
            "property_geo.csv coordinates outside the Ames bounding box "
            f"(lat {_AMES_LAT_RANGE[0]}..{_AMES_LAT_RANGE[1]}, "
            f"long {_AMES_LONG_RANGE[0]}..{_AMES_LONG_RANGE[1]}) for Ids: {bad}"
        )
    lookup = {
        int(i): (float(la), float(lo)) for i, la, lo in zip(ids, lat, long)
    }
    logger.info(
        "geo source: %d per-property coordinates from %s "
        "(unmatched rows keep neighborhood centroids)",
        len(lookup),
        path,
    )
    return lookup


def _apply_property_geo_override(frame: pd.DataFrame) -> pd.DataFrame:
    """Replace ``lat``/``long`` with per-property coordinates where available.

    Rows whose ``Id`` appears in ``data/external/property_geo.csv`` get those
    coordinates; every other row keeps its current values (centroid
    passthrough, neighborhood lookup, or defaults). When the override file is
    absent — or the frame carries no ``Id`` (serving rows) — this is a no-op.
    ``Id`` itself is never a model feature (it is excluded from
    ``RAW_INPUT_COLUMNS`` and dropped with the projection downstream).
    """
    lookup = _property_geo_lookup(_PROPERTY_GEO_PATH)
    if lookup is None or "Id" not in frame.columns:
        return frame
    out = frame.copy()
    ids = pd.to_numeric(out["Id"], errors="coerce")
    lat_override = ids.map({key: value[0] for key, value in lookup.items()})
    long_override = ids.map({key: value[1] for key, value in lookup.items()})
    matched = lat_override.notna() & long_override.notna()
    out.loc[matched, "lat"] = lat_override[matched].astype(float)
    out.loc[matched, "long"] = long_override[matched].astype(float)
    logger.debug(
        "property geo override: %d/%d rows use per-property coordinates, "
        "%d keep neighborhood centroids",
        int(matched.sum()),
        len(out),
        int((~matched).sum()),
    )
    return out


def _apply_defaults(frame: pd.DataFrame) -> pd.DataFrame:
    """Ensure every RAW_INPUT_COLUMNS column exists, filling from FEATURE_DEFAULTS.

    Raises:
        ValueError: If a column is missing and no default is available.
    """
    missing = [c for c in RAW_INPUT_COLUMNS if c not in frame.columns]
    if not missing:
        return frame
    no_default = [c for c in missing if c not in FEATURE_DEFAULTS]
    if no_default:
        raise ValueError(
            f"missing columns with no entry in FEATURE_DEFAULTS: {no_default}; "
            "regenerate models/feature_defaults.json via "
            "`python -m ml.features.pipeline`"
        )
    out = frame.copy()
    for column in missing:
        out[column] = FEATURE_DEFAULTS[column]
        logger.debug("filled missing column %r from FEATURE_DEFAULTS", column)
    return out


def build_feature_frame(
    df: pd.DataFrame, stats: NeighborhoodStats | None = None
) -> pd.DataFrame:
    """Build the model-ready feature frame defined by ``MODEL_FEATURES``.

    Args:
        df: Raw frame with (a subset of) the processed-CSV columns. Columns
            outside ``RAW_INPUT_COLUMNS`` are ignored; missing optional columns
            are filled from ``FEATURE_DEFAULTS``. If ``lat``/``long`` are absent
            they are looked up from ``Neighborhood`` via
            ``data/external/neighborhood_geo.csv``. When the optional
            ``data/external/property_geo.csv`` (schema ``Id,lat,long``) exists
            and the frame carries ``Id``, matching rows get per-property
            coordinates instead of the centroids (docs/GEOGRAPHY.md).
        stats: Train-fit :class:`NeighborhoodStats`. When ``None``, the
            persisted artifact ``models/neighborhood_stats.json`` is loaded
            (serving path).

    Returns:
        A frame with exactly ``MODEL_FEATURES`` columns, in that order, with
        no NaNs for well-formed input. Unseen neighborhoods receive the global
        train fallback for the four ``neighborhood_*`` columns.
    """
    if stats is None:
        stats = load_neighborhood_stats()

    work = _fill_geo_from_neighborhood(df)
    work = _apply_defaults(work)
    work = _apply_property_geo_override(work)
    out = work[RAW_INPUT_COLUMNS].copy()

    year_sold = _num(out, "YrSold")
    mo_sold = _num(out, "MoSold")
    gr_liv_area = _num(out, "GrLivArea")
    # Zero-division guard: bedroom-less sales (studios/lofts, BedroomAbvGr == 0
    # exists in the data) are treated as one bedroom for the ratios.
    bedrooms = _num(out, "BedroomAbvGr").clip(lower=1.0)

    total_bath = (
        _num(out, "FullBath")
        + 0.5 * _num(out, "HalfBath")
        + _num(out, "BsmtFullBath")
        + 0.5 * _num(out, "BsmtHalfBath")
    )

    out["property_age"] = year_sold - _num(out, "YearBuilt")
    out["years_since_remod"] = year_sold - _num(out, "YearRemodAdd")
    out["total_bath"] = total_bath
    out["living_area_per_bedroom"] = gr_liv_area / bedrooms
    out["bathroom_bedroom_ratio"] = total_bath / bedrooms
    out["total_sf"] = gr_liv_area + _num(out, "TotalBsmtSF")
    # sale_month / sale_year duplicate MoSold / YrSold exactly — mandated by
    # SPEC §5, kept as harmless exact collinearity (llba-features F5).
    out["sale_month"] = mo_sold
    out["sale_quarter"] = ((mo_sold - 1.0) // 3.0) + 1.0
    out["sale_year"] = year_sold
    out["distance_to_city_center_km"] = _haversine_km(
        _num(out, "lat"), _num(out, "long"), CITY_CENTER_LAT, CITY_CENTER_LONG
    )

    central_air_yes = out["CentralAir"].astype(str) == "Y"
    paved_drive_yes = out["PavedDrive"].astype(str) == "Y"
    out["amenity_count"] = (
        (_num(out, "Fireplaces") > 0).astype(int)
        + (_num(out, "PoolArea") > 0).astype(int)
        + (_num(out, "WoodDeckSF") > 0).astype(int)
        + (_num(out, "OpenPorchSF") > 0).astype(int)
        + (_num(out, "ScreenPorch") > 0).astype(int)
        + (_num(out, "GarageCars") > 0).astype(int)
        + central_air_yes.astype(int)
        + paved_drive_yes.astype(int)
    )

    neighborhoods = out["Neighborhood"].astype(str)
    joined = neighborhoods.map(
        {name: values for name, values in stats.neighborhoods.items()}
    )
    fallback = stats.global_fallback
    for feature, field_name in zip(
        NEIGHBORHOOD_STAT_FEATURES,
        ("median_price", "mean_price", "median_price_per_sqft", "monthly_sale_velocity"),
        strict=True,
    ):
        per_row = joined.map(lambda v, f=field_name: v[f] if isinstance(v, dict) else np.nan)
        out[feature] = per_row.fillna(fallback[field_name]).astype(float)

    return out[MODEL_FEATURES]


def write_feature_list(path: Path = FEATURE_LIST_PATH) -> Path:
    """Write ``models/feature_list.json`` for the training agents (SPEC §14).

    The internal ``sha1`` field is computed over the JSON-serialized
    ``MODEL_FEATURES`` list — a content fingerprint of the feature list,
    consumed by ``tests/features/test_features.py``. It is NOT the
    ``feature_version`` referenced by ``champion.json``: that is
    ``ml.tracking.feature_version()``, the 12-character sha1 of this file's
    bytes (llba-features F2).
    """
    features_json = json.dumps(MODEL_FEATURES)
    payload: dict[str, Any] = {
        "features": MODEL_FEATURES,
        "generated_from": "ml.features.pipeline",
        "sha1": hashlib.sha1(features_json.encode("utf-8")).hexdigest(),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    logger.info("wrote %d model features to %s", len(MODEL_FEATURES), path)
    return path


def main() -> None:
    """Regenerate all three feature artifacts from the train split only."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    train = pd.read_csv(PROCESSED_DIR / "train.csv", keep_default_na=False)

    stats = fit_neighborhood_stats(train)
    save_neighborhood_stats(stats)

    defaults = compute_feature_defaults(train, RAW_INPUT_COLUMNS)
    save_feature_defaults(defaults)

    write_feature_list()

    logger.info(
        "artifacts regenerated: %d neighborhoods, %d defaults, %d model features",
        len(stats.neighborhoods),
        len(defaults),
        len(MODEL_FEATURES),
    )


if __name__ == "__main__":
    main()
