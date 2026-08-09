"""Tests for the optional per-property geo override (docs/GEOGRAPHY.md).

``data/external/property_geo.csv`` (schema ``Id,lat,long``) is an opt-in
upgrade over the ADR-2 neighborhood centroids. The file is not committed, so
the default behavior must be exactly the centroid behavior. The loader cache
(``_property_geo_lookup``) is keyed on the file path, so each ``tmp_path``
fixture below loads fresh with no cache clearing needed.
"""
from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import pytest

from ml.features import pipeline
from ml.features.pipeline import (
    MODEL_FEATURES,
    build_feature_frame,
)
from ml.features.stats import fit_neighborhood_stats
from ml.paths import PROCESSED_DIR


@pytest.fixture(scope="module")
def train() -> pd.DataFrame:
    """Train split read with the SPEC §14 convention."""
    return pd.read_csv(PROCESSED_DIR / "train.csv", keep_default_na=False)


@pytest.fixture(scope="module")
def stats(train):
    """Neighborhood stats fit on the train split only."""
    return fit_neighborhood_stats(train)


def _write_property_geo(directory: Path, rows: list[tuple[int, float, float]]) -> Path:
    """Write a property_geo.csv with the canonical schema into ``directory``."""
    csv_path = directory / "property_geo.csv"
    csv_path.write_text(
        "Id,lat,long\n" + "".join(f"{i},{la},{lo}\n" for i, la, lo in rows),
        encoding="utf-8",
    )
    return csv_path


# Two in-bbox coordinates that match no neighborhood centroid exactly.
OVERRIDE_A = (42.0305, -93.6123)
OVERRIDE_B = (42.0412, -93.5987)


def test_override_applied_for_matching_ids(tmp_path, monkeypatch, train, stats, caplog):
    sample = train.head(5)
    ids = sample["Id"].tolist()
    baseline = build_feature_frame(sample, stats)  # committed state: no override file

    csv_path = _write_property_geo(tmp_path, [(ids[0], *OVERRIDE_A), (ids[1], *OVERRIDE_B)])
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", csv_path)

    with caplog.at_level(logging.INFO, logger="ml.features.pipeline"):
        out = build_feature_frame(sample, stats)

    assert list(out.columns) == MODEL_FEATURES
    assert not out.isna().any().any()
    # Matched rows carry the per-property coordinates...
    assert (out.iloc[0]["lat"], out.iloc[0]["long"]) == OVERRIDE_A
    assert (out.iloc[1]["lat"], out.iloc[1]["long"]) == OVERRIDE_B
    # ...and distance_to_city_center_km is recomputed from them.
    assert out.iloc[0]["distance_to_city_center_km"] != baseline.iloc[0][
        "distance_to_city_center_km"
    ]
    # The geo source is logged.
    assert any(
        "per-property coordinates" in record.message for record in caplog.records
    )

    # Overriding must be equivalent to the processed frame carrying the real
    # coordinates directly (same engineered values, not just passthrough).
    patched_input = sample.copy()
    patched_input.loc[patched_input.index[0], ["lat", "long"]] = list(OVERRIDE_A)
    patched_input.loc[patched_input.index[1], ["lat", "long"]] = list(OVERRIDE_B)
    expected = build_feature_frame(patched_input, stats)
    pd.testing.assert_frame_equal(out, expected)


def test_centroid_fallback_for_unmatched_ids(tmp_path, monkeypatch, train, stats):
    sample = train.head(5)
    ids = sample["Id"].tolist()
    baseline = build_feature_frame(sample, stats)

    # The override file covers only the middle row.
    csv_path = _write_property_geo(tmp_path, [(ids[2], *OVERRIDE_A)])
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", csv_path)
    out = build_feature_frame(sample, stats)

    assert (out.iloc[2]["lat"], out.iloc[2]["long"]) == OVERRIDE_A
    # Rows missing from the file keep the neighborhood centroids untouched.
    unmatched = [0, 1, 3, 4]
    pd.testing.assert_frame_equal(
        out.iloc[unmatched].reset_index(drop=True),
        baseline.iloc[unmatched].reset_index(drop=True),
    )
    for pos in unmatched:
        assert out.iloc[pos]["lat"] == sample.iloc[pos]["lat"]
        assert out.iloc[pos]["long"] == sample.iloc[pos]["long"]


def test_frame_without_id_column_ignores_override(tmp_path, monkeypatch, train, stats):
    """Serving rows carry no Id -> centroid behavior even when the file exists."""
    sample = train.head(3).drop(columns=["Id"])
    baseline = build_feature_frame(sample, stats)

    csv_path = _write_property_geo(tmp_path, [(int(train["Id"].iloc[0]), *OVERRIDE_A)])
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", csv_path)
    out = build_feature_frame(sample, stats)

    pd.testing.assert_frame_equal(out, baseline)


@pytest.mark.parametrize(
    ("lines", "match"),
    [
        (["1,47.5,-93.6"], "bounding box"),  # lat out of Ames bbox
        (["1,42.0,-90.0"], "bounding box"),  # long out of Ames bbox
        (["1,abc,-93.6"], "non-numeric"),
        (["1,42.0,-93.6", "1,42.1,-93.5"], "duplicate Id"),
        (["1.5,42.0,-93.6"], "integers"),
    ],
)
def test_invalid_override_file_rejected(
    tmp_path, monkeypatch, train, stats, lines, match
):
    csv_path = tmp_path / "property_geo.csv"
    csv_path.write_text("Id,lat,long\n" + "\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", csv_path)
    with pytest.raises(ValueError, match=match):
        build_feature_frame(train.head(2), stats)


def test_override_file_missing_columns_rejected(tmp_path, monkeypatch, train, stats):
    csv_path = tmp_path / "property_geo.csv"
    csv_path.write_text("Id,lat\n1,42.03\n", encoding="utf-8")
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", csv_path)
    with pytest.raises(ValueError, match="missing columns"):
        build_feature_frame(train.head(2), stats)


def test_absent_file_output_byte_identical(tmp_path, monkeypatch, train, stats):
    """No property_geo.csv anywhere -> current behavior, zero change."""
    assert not pipeline._PROPERTY_GEO_PATH.exists(), (
        "data/external/property_geo.csv must not be committed; "
        "the centroid behavior is the committed default"
    )
    baseline = build_feature_frame(train, stats)

    # Point the loader at a path that does not exist either: same result.
    monkeypatch.setattr(pipeline, "_PROPERTY_GEO_PATH", tmp_path / "property_geo.csv")
    assert not (tmp_path / "property_geo.csv").exists()
    rerun = build_feature_frame(train, stats)

    pd.testing.assert_frame_equal(baseline, rerun)
    assert baseline.to_csv(index=False).encode("utf-8") == rerun.to_csv(
        index=False
    ).encode("utf-8")
