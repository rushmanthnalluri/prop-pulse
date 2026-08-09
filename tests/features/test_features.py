"""Unit tests for ml.features (SPEC §5, §8, §11).

Covers: build_feature_frame on train/val/test (columns == MODEL_FEATURES, zero
NaNs, identical across splits), train-only neighborhood stats with an
unseen-neighborhood fallback, and the serving payload round-trip.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json

import pandas as pd
import pytest

from ml.features.defaults import load_feature_defaults
from ml.features.pipeline import (
    ENGINEERED_FEATURES,
    FEATURE_DEFAULTS,
    MODEL_FEATURES,
    NEIGHBORHOOD_STAT_FEATURES,
    RAW_INPUT_COLUMNS,
    build_feature_frame,
    neighborhood_coordinates,
)
from ml.features.serving import API_TO_RAW, serving_payload_to_raw
from ml.features.stats import fit_neighborhood_stats, load_neighborhood_stats
from ml.paths import (
    FEATURE_DEFAULTS_PATH,
    FEATURE_LIST_PATH,
    NEIGHBORHOOD_STATS_PATH,
    PROCESSED_DIR,
)


@pytest.fixture(scope="module")
def splits() -> dict[str, pd.DataFrame]:
    """Processed splits read with the SPEC §14 convention (keep_default_na=False)."""
    return {
        name: pd.read_csv(PROCESSED_DIR / f"{name}.csv", keep_default_na=False)
        for name in ("train", "val", "test")
    }


@pytest.fixture(scope="module")
def stats(splits):
    """Neighborhood stats fit on the train split only."""
    return fit_neighborhood_stats(splits["train"])


# ---------------------------------------------------------------------------
# RAW_INPUT_COLUMNS / MODEL_FEATURES contract
# ---------------------------------------------------------------------------


def test_raw_input_columns_exclude_leakage(splits):
    forbidden = {
        "Id",
        "SalePrice",
        "days_on_market",
        "sells_within_30_days",
        "SaleType",
        "SaleCondition",
    }
    assert forbidden.isdisjoint(RAW_INPUT_COLUMNS)
    # Every declared raw column must exist in the processed CSVs.
    assert set(RAW_INPUT_COLUMNS) <= set(splits["train"].columns)


def test_model_features_composition():
    assert len(MODEL_FEATURES) == len(set(MODEL_FEATURES))
    assert MODEL_FEATURES == (
        RAW_INPUT_COLUMNS + ENGINEERED_FEATURES + NEIGHBORHOOD_STAT_FEATURES
    )


# ---------------------------------------------------------------------------
# build_feature_frame across splits
# ---------------------------------------------------------------------------


def test_build_feature_frame_all_splits(splits, stats):
    frames = {}
    for name, df in splits.items():
        ff = build_feature_frame(df, stats)
        frames[name] = ff
        assert list(ff.columns) == MODEL_FEATURES, name
        assert len(ff) == len(df), name
        assert not ff.isna().any().any(), f"{name} produced NaNs"
    # Identical column sets/order across splits.
    assert list(frames["train"].columns) == list(frames["val"].columns)
    assert list(frames["val"].columns) == list(frames["test"].columns)


def test_build_feature_frame_engineered_values(splits, stats):
    ff = build_feature_frame(splits["train"].head(5), stats)
    tr = splits["train"].head(5)
    expected_total_bath = (
        tr["FullBath"] + 0.5 * tr["HalfBath"] + tr["BsmtFullBath"] + 0.5 * tr["BsmtHalfBath"]
    )
    pd.testing.assert_series_equal(
        ff["total_bath"], expected_total_bath.astype(float), check_names=False
    )
    assert (ff["property_age"] == tr["YrSold"] - tr["YearBuilt"]).all()
    assert (ff["total_sf"] == tr["GrLivArea"] + tr["TotalBsmtSF"]).all()
    assert (ff["sale_quarter"] == (tr["MoSold"] - 1) // 3 + 1).all()
    # Haversine sanity: Ames neighborhoods are all within ~15 km of downtown.
    assert ff["distance_to_city_center_km"].between(0, 15).all()


def test_build_feature_frame_zero_bedroom_guard(splits, stats):
    zero_bed = splits["train"][splits["train"]["BedroomAbvGr"] == 0]
    assert not zero_bed.empty, "expected bedroom-less rows in train"
    ff = build_feature_frame(zero_bed, stats)
    assert not ff[["living_area_per_bedroom", "bathroom_bedroom_ratio"]].isna().any().any()
    assert (ff["living_area_per_bedroom"] == zero_bed["GrLivArea"].astype(float)).all()


def test_build_feature_frame_loads_artifact_when_stats_none(splits):
    # stats=None must load models/neighborhood_stats.json (generated artifact).
    ff = build_feature_frame(splits["val"].head(3), None)
    assert list(ff.columns) == MODEL_FEATURES
    assert not ff.isna().any().any()


# ---------------------------------------------------------------------------
# Neighborhood stats: train-only fit + fallback
# ---------------------------------------------------------------------------


def test_neighborhood_stats_train_only(splits, stats):
    train, val, test = splits["train"], splits["val"], splits["test"]
    full = pd.concat([train, val, test], ignore_index=True)

    # The persisted value equals the train-only median for every neighborhood...
    for name, values in stats.neighborhoods.items():
        expected = float(train.loc[train["Neighborhood"] == name, "SalePrice"].median())
        assert values["median_price"] == expected, name

    # ...and differs from a full-data (train+val+test) computation for at
    # least one neighborhood — proving the stats are NOT fit on all data.
    differing = [
        name
        for name in stats.neighborhoods
        if stats.neighborhoods[name]["median_price"]
        != float(full.loc[full["Neighborhood"] == name, "SalePrice"].median())
    ]
    assert differing, "no neighborhood median differs between train-only and full data"
    showcase = differing[0]
    assert stats.neighborhoods[showcase]["median_price"] == float(
        train.loc[train["Neighborhood"] == showcase, "SalePrice"].median()
    )
    assert stats.neighborhoods[showcase]["median_price"] != float(
        full.loc[full["Neighborhood"] == showcase, "SalePrice"].median()
    )


def test_neighborhood_stats_velocity(splits, stats):
    n_months = splits["train"][["YrSold", "MoSold"]].drop_duplicates().shape[0]
    assert stats.n_months == n_months
    name = "NAmes"
    expected = float((splits["train"]["Neighborhood"] == name).sum()) / n_months
    assert stats.neighborhoods[name]["monthly_sale_velocity"] == pytest.approx(expected)


def test_unseen_neighborhood_fallback(stats):
    row = {
        col: FEATURE_DEFAULTS[col]
        for col in RAW_INPUT_COLUMNS
        if col not in {"lat", "long"}
    }
    row["Neighborhood"] = "NoSuchNeighborhood"
    ff = build_feature_frame(pd.DataFrame([row]), stats)
    assert not ff.isna().any().any()
    for feature, field_name in zip(
        NEIGHBORHOOD_STAT_FEATURES,
        ("median_price", "mean_price", "median_price_per_sqft", "monthly_sale_velocity"),
        strict=True,
    ):
        assert ff.iloc[0][feature] == stats.global_fallback[field_name]
    # The geo lookup leaves lat/long at the defaults; frame still complete.
    assert "distance_to_city_center_km" in ff.columns


# ---------------------------------------------------------------------------
# Serving payload mapping (SPEC §8)
# ---------------------------------------------------------------------------


MINIMAL_PAYLOAD = {
    "neighborhood": "NAmes",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 1,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1500,
    "lot_area": 8000,
    "total_bsmt_sf": 900,
    "year_built": 1995,
    "overall_qual": 6,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}


def test_serving_payload_roundtrip(stats):
    raw = serving_payload_to_raw(MINIMAL_PAYLOAD)

    # Full raw row: every RAW_INPUT_COLUMNS key populated.
    assert set(raw) == set(RAW_INPUT_COLUMNS)
    assert all(v is not None for v in raw.values())

    # Direct renames land on the right raw columns.
    assert raw["Neighborhood"] == "NAmes"
    assert raw["GrLivArea"] == 1500
    assert raw["BedroomAbvGr"] == 3
    assert raw["OverallQual"] == 6
    # Special handling: bool -> token, year_remod_add defaults to year_built.
    assert raw["CentralAir"] == "Y"
    assert raw["YearRemodAdd"] == 1995
    # Coordinates come from the neighborhood centroid lookup, not the defaults.
    assert (raw["lat"], raw["long"]) == neighborhood_coordinates("NAmes")
    assert raw["lat"] != FEATURE_DEFAULTS["lat"] or raw["Neighborhood"] == FEATURE_DEFAULTS["Neighborhood"]
    # Unspecified fields fall back to FEATURE_DEFAULTS.
    assert raw["MSZoning"] == FEATURE_DEFAULTS["MSZoning"]
    assert raw["LotFrontage"] == FEATURE_DEFAULTS["LotFrontage"]

    # The raw row flows through the feature pipeline with zero NaNs.
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    assert list(ff.columns) == MODEL_FEATURES
    assert not ff.isna().any().any()
    # Joined stats are the real NAmes values, not the fallback.
    assert ff.iloc[0]["neighborhood_median_price"] == stats.neighborhoods["NAmes"]["median_price"]


def test_serving_payload_sale_date_and_overrides(train_sale_boundary):
    """Out-of-window sale dates clamp to the train boundary; in-window passes through."""
    max_year, max_month = train_sale_boundary
    assert (max_year, max_month) < (2009, 6), (
        "test assumes 2009-06 lies beyond the training window"
    )
    raw = serving_payload_to_raw({**MINIMAL_PAYLOAD, "sale_date": "2009-06-15"})
    assert (raw["YrSold"], raw["MoSold"]) == (max_year, max_month)
    # Explicit advanced overrides beat sale_date and stay unclamped in-window.
    raw2 = serving_payload_to_raw(
        {**MINIMAL_PAYLOAD, "sale_date": "2009-06-15", "mo_sold": 3, "yr_sold": max_year}
    )
    assert (raw2["YrSold"], raw2["MoSold"]) == (max_year, 3)
    # date objects also parse (and clamp the same way).
    raw3 = serving_payload_to_raw({**MINIMAL_PAYLOAD, "sale_date": dt.date(2010, 1, 20)})
    assert (raw3["YrSold"], raw3["MoSold"]) == (max_year, max_month)


def test_serving_payload_rejects_unknown_fields():
    with pytest.raises(ValueError, match="unknown PropertyInput fields"):
        serving_payload_to_raw({**MINIMAL_PAYLOAD, "not_a_field": 1})


def test_api_to_raw_covers_spec_section_8_fields():
    spec_fields = {
        "neighborhood", "house_style", "bldg_type", "ms_zoning", "bedrooms",
        "full_bath", "half_bath", "bsmt_full_bath", "bsmt_half_bath",
        "gr_liv_area", "lot_area", "lot_frontage", "total_bsmt_sf",
        "year_built", "year_remod_add", "overall_qual", "overall_cond",
        "garage_cars", "garage_area", "fireplaces", "pool_area",
        "wood_deck_sf", "open_porch_sf", "screen_porch",
        "bsmt_qual", "kitchen_qual", "exter_qual", "heating_qc",
        "garage_type", "garage_finish", "foundation", "electrical",
        "functional", "fireplace_qu", "lot_shape", "lot_config", "land_slope",
        "condition1", "roof_style", "exterior1st", "mas_vnr_area",
        "kitchen_abv_gr", "tot_rms_abvgrd", "bsmt_fin_sf1", "bsmt_unf_sf",
        "first_flr_sf", "second_flr_sf", "enclosed_porch", "misc_val",
        "paved_drive", "street", "mo_sold", "yr_sold",
    }
    assert spec_fields <= set(API_TO_RAW) | {"central_air", "sale_date"}
    assert set(API_TO_RAW.values()) <= set(RAW_INPUT_COLUMNS)


# ---------------------------------------------------------------------------
# Sale-date calendar clamp: serving pins scoring to the train-support window
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def train_sale_boundary(splits) -> tuple[int, int]:
    """Latest sale (year, month) in the TRAIN support, derived from the split."""
    train = splits["train"]
    max_year = int(train["YrSold"].max())
    max_month = int(train.loc[train["YrSold"] == max_year, "MoSold"].max())
    return max_year, max_month


def test_serving_payload_omitted_sale_date_defaults_to_train_boundary(
    stats, train_sale_boundary
):
    """No sale_date/yr_sold → sale date defaults to the latest TRAIN date."""
    max_year, max_month = train_sale_boundary
    raw = serving_payload_to_raw(dict(MINIMAL_PAYLOAD))
    assert (raw["YrSold"], raw["MoSold"]) == (max_year, max_month)

    # Derived calendar/age features are scored at the same boundary.
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    row = ff.iloc[0]
    assert row["sale_year"] == max_year
    assert row["sale_month"] == max_month
    assert row["property_age"] == max_year - MINIMAL_PAYLOAD["year_built"]
    # No year_remod_add in MINIMAL_PAYLOAD → YearRemodAdd == year_built.
    assert row["years_since_remod"] == max_year - MINIMAL_PAYLOAD["year_built"]


def test_serving_payload_future_sale_date_clamped_to_train_boundary(
    stats, train_sale_boundary
):
    """Sale dates beyond the training window are clamped to its boundary."""
    max_year, max_month = train_sale_boundary
    assert max_year < 2026, "test assumes 2026 lies beyond the training window"
    # An explicit yr_sold override clamps exactly like a sale_date.
    for payload in (
        {**MINIMAL_PAYLOAD, "yr_sold": 2026},
        {**MINIMAL_PAYLOAD, "sale_date": "2026-03-15"},
        {**MINIMAL_PAYLOAD, "sale_date": dt.date(2026, 3, 15)},
    ):
        raw = serving_payload_to_raw(payload)
        assert (raw["YrSold"], raw["MoSold"]) == (max_year, max_month)
        ff = build_feature_frame(pd.DataFrame([raw]), stats)
        row = ff.iloc[0]
        assert row["sale_year"] == max_year
        assert row["sale_month"] == max_month
        assert row["property_age"] == max_year - MINIMAL_PAYLOAD["year_built"]
        assert row["years_since_remod"] == max_year - MINIMAL_PAYLOAD["year_built"]


def test_serving_payload_sale_date_inside_window_unchanged(stats, train_sale_boundary):
    """Sale dates at/inside the training window pass through untouched."""
    max_year, max_month = train_sale_boundary
    cases = [
        # Exactly at the boundary.
        ({**MINIMAL_PAYLOAD, "sale_date": f"{max_year}-{max_month:02d}-15"}, (max_year, max_month)),
        # Inside the window (train covers max_year - 1 as well).
        ({**MINIMAL_PAYLOAD, "sale_date": dt.date(max_year - 1, 1, 20)}, (max_year - 1, 1)),
        # Advanced overrides still beat sale_date and stay unclamped in-window.
        (
            {**MINIMAL_PAYLOAD, "sale_date": "2026-03-15", "mo_sold": 1, "yr_sold": max_year - 1},
            (max_year - 1, 1),
        ),
    ]
    for payload, expected in cases:
        raw = serving_payload_to_raw(payload)
        assert (raw["YrSold"], raw["MoSold"]) == expected

    # Frame-level derived features keep tracking the passed-through date.
    raw = serving_payload_to_raw({**MINIMAL_PAYLOAD, "sale_date": dt.date(max_year - 1, 1, 20)})
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    assert ff.iloc[0]["sale_year"] == max_year - 1
    assert ff.iloc[0]["property_age"] == (max_year - 1) - MINIMAL_PAYLOAD["year_built"]


def test_serving_payload_remod_year_clamped_to_sale_year(stats, train_sale_boundary):
    """year_remod_add beyond the (clamped) sale year can no longer derive a
    negative years_since_remod: YearRemodAdd pins to the clamped sale year."""
    max_year, _max_month = train_sale_boundary
    assert max_year < 2026, "test assumes 2026 lies beyond the training window"

    # Beyond the sale boundary (omitted sale date → 2008-12): remodel year
    # clamps exactly to the boundary and years_since_remod bottoms out at 0.
    raw = serving_payload_to_raw({**MINIMAL_PAYLOAD, "year_remod_add": 2026})
    assert raw["YearRemodAdd"] == max_year
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    assert ff.iloc[0]["years_since_remod"] == 0

    # The clamp tracks the CLAMPED sale year, not the global boundary: an
    # in-window 2007 sale pins a 2026 remodel to 2007.
    raw = serving_payload_to_raw(
        {**MINIMAL_PAYLOAD, "yr_sold": max_year - 1, "year_remod_add": 2026}
    )
    assert raw["YearRemodAdd"] == max_year - 1
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    assert ff.iloc[0]["years_since_remod"] == 0

    # Control: an in-window remodel year passes through unchanged.
    raw = serving_payload_to_raw({**MINIMAL_PAYLOAD, "year_remod_add": max_year - 3})
    assert raw["YearRemodAdd"] == max_year - 3
    ff = build_feature_frame(pd.DataFrame([raw]), stats)
    assert ff.iloc[0]["years_since_remod"] == 3


# ---------------------------------------------------------------------------
# Generated artifacts
# ---------------------------------------------------------------------------


def test_artifacts_exist_and_are_consistent():
    assert NEIGHBORHOOD_STATS_PATH.exists()
    assert FEATURE_DEFAULTS_PATH.exists()
    assert FEATURE_LIST_PATH.exists()

    feature_list = json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))
    assert feature_list["features"] == MODEL_FEATURES
    assert feature_list["generated_from"] == "ml.features.pipeline"
    expected_sha1 = hashlib.sha1(json.dumps(MODEL_FEATURES).encode("utf-8")).hexdigest()
    assert feature_list["sha1"] == expected_sha1

    defaults = load_feature_defaults()
    assert set(RAW_INPUT_COLUMNS) <= set(defaults)

    stats = load_neighborhood_stats()
    assert len(stats.neighborhoods) == 25
    assert set(stats.global_fallback) == {
        "median_price",
        "mean_price",
        "median_price_per_sqft",
        "monthly_sale_velocity",
    }
