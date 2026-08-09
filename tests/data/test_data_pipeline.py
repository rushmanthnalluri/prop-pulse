"""Tests for the data pipeline contract (SPEC §4 / §11).

Covers: processed schema validation, split years with no overlap, duplicate
Id rejection, coordinate validity, and simulated-target consistency.
"""
from __future__ import annotations

import json

import pandas as pd
import pytest

from ml.data.validate import (
    LAT_RANGE,
    LONG_RANGE,
    SchemaError,
    build_schema_report,
    validate_processed,
)
from ml.paths import PROCESSED_DIR, RAW_AMES_DIR

SPLIT_YEARS = {
    "train": {2006, 2007, 2008},
    "val": {2009},
    "test": {2010},
}

REQUIRED_TARGET_COLUMNS = {"days_on_market", "sells_within_30_days", "SalePrice", "lat", "long"}


@pytest.fixture(scope="module")
def splits() -> dict[str, pd.DataFrame]:
    """Load the processed splits written by ``python -m ml.data.pipeline``."""
    frames: dict[str, pd.DataFrame] = {}
    for name in ("train", "val", "test"):
        path = PROCESSED_DIR / f"{name}.csv"
        if not path.exists():
            pytest.fail(
                f"{path} not found — run `.venv/Scripts/python.exe -m ml.data.pipeline` first"
            )
        # keep_default_na=False: processed files store the literal string
        # "None" for absent features; default NA parsing would turn it into NaN.
        frames[name] = pd.read_csv(path, dtype={"MSSubClass": str}, keep_default_na=False)
    return frames


def test_processed_files_nonempty(splits: dict[str, pd.DataFrame]) -> None:
    for name, df in splits.items():
        assert len(df) > 0, f"{name} split is empty"
        assert REQUIRED_TARGET_COLUMNS <= set(df.columns), (
            f"{name} is missing columns: {REQUIRED_TARGET_COLUMNS - set(df.columns)}"
        )


def test_schema_validation_passes_on_processed_splits(splits: dict[str, pd.DataFrame]) -> None:
    for name, df in splits.items():
        validate_processed(df, name)  # raises SchemaError on any violation


def test_split_years_correct(splits: dict[str, pd.DataFrame]) -> None:
    for name, expected_years in SPLIT_YEARS.items():
        assert set(splits[name]["YrSold"].unique()) == expected_years, name


def test_no_overlap_between_splits(splits: dict[str, pd.DataFrame]) -> None:
    ids = {name: set(df["Id"]) for name, df in splits.items()}
    assert not ids["train"] & ids["val"]
    assert not ids["train"] & ids["test"]
    assert not ids["val"] & ids["test"]


def test_no_duplicate_ids(splits: dict[str, pd.DataFrame]) -> None:
    for name, df in splits.items():
        assert not df["Id"].duplicated().any(), f"duplicate Id in {name}"


def test_validate_rejects_duplicate_ids(splits: dict[str, pd.DataFrame]) -> None:
    duped = pd.concat([splits["val"], splits["val"].head(1)], ignore_index=True)
    with pytest.raises(SchemaError, match="duplicate Id"):
        validate_processed(duped, "val-duped")


def test_coordinates_valid(splits: dict[str, pd.DataFrame]) -> None:
    for name, df in splits.items():
        assert df["lat"].between(*LAT_RANGE).all(), f"lat out of range in {name}"
        assert df["long"].between(*LONG_RANGE).all(), f"long out of range in {name}"
        assert not df[["lat", "long"]].isna().any().any(), f"missing coords in {name}"


def test_simulated_target_columns_present_and_consistent(
    splits: dict[str, pd.DataFrame],
) -> None:
    for name, df in splits.items():
        assert {"days_on_market", "sells_within_30_days"} <= set(df.columns), name
        assert df["days_on_market"].between(1, 365).all(), name
        expected = (df["days_on_market"] <= 30).astype(int)
        assert (df["sells_within_30_days"].astype(int) == expected).all(), name
        assert set(df["sells_within_30_days"].unique()) <= {0, 1}, name


def test_sale_price_present_and_plausible(splits: dict[str, pd.DataFrame]) -> None:
    for name, df in splits.items():
        assert df["SalePrice"].between(10_000, 1_000_000).all(), name


def test_split_row_counts_match_raw(splits: dict[str, pd.DataFrame]) -> None:
    """All 1460 labeled rows are accounted for except documented train outlier trims."""
    raw = pd.read_csv(RAW_AMES_DIR / "train.csv")
    n_trimmed = int(((raw["GrLivArea"] > 4000) & (raw["SalePrice"] < 300_000)).sum())
    total = sum(len(df) for df in splits.values())
    assert total == len(raw) - n_trimmed, f"unexpected total {total}"


def test_schema_json_mssubclass_declares_on_disk_dtype() -> None:
    """AUD-13 regression: schema.json must declare the CSV round-trip dtype.

    clean.py casts MSSubClass to str in memory, but the committed CSVs
    re-infer int64 and every consumer reads int64 — the schema must match
    that on-disk reality.
    """
    schema = json.loads((PROCESSED_DIR / "schema.json").read_text())
    declared = schema["columns"]["MSSubClass"]
    assert declared == "int64"
    for name in ("train", "val", "test"):
        on_disk = pd.read_csv(PROCESSED_DIR / f"{name}.csv", keep_default_na=False)
        assert str(on_disk["MSSubClass"].dtype) == declared, name


def test_build_schema_report_declares_mssubclass_int64() -> None:
    """AUD-13 regression: the report emits int64 even for an in-memory str column."""
    train = pd.DataFrame({"Id": [1], "MSSubClass": pd.Series(["20"], dtype=object)})
    report = build_schema_report(
        {"train": train, "val": train, "test": train}, "test-version", []
    )
    assert report["columns"]["MSSubClass"] == "int64"
    assert report["columns"]["Id"] == "int64"
