"""Tests for the real days-on-market adapter (ADR-3 real-data path).

Covers ``RealDomProvider`` strict validation (dtype, range, duplicate Ids,
coverage), the env-var provider selection in ``ml/data/pipeline.py``, and
end-to-end pipeline runs with both providers into a TEMPORARY output
directory — the committed ``data/processed/`` files are never overwritten.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import pandas as pd
import pytest

from ml.data.pipeline import run_pipeline, select_dom_provider
from ml.data.sale_speed import (
    FAST_SALE_THRESHOLD_DAYS,
    RealDomProvider,
    SaleSpeedSimulator,
    attach_sale_speed,
)
from ml.paths import PROCESSED_DIR, RAW_AMES_DIR

EXPECTED_COUNTS = {"train": 945, "val": 338, "test": 175}


def _write_dom_csv(path: Path, rows: list[tuple[int, float]]) -> Path:
    """Write a DOM fixture CSV with columns ``Id,days_on_market``."""
    pd.DataFrame(rows, columns=["Id", "days_on_market"]).to_csv(path, index=False)
    return path


@pytest.fixture()
def id_frame() -> pd.DataFrame:
    """Minimal frame with the one column ``RealDomProvider.transform`` needs."""
    return pd.DataFrame({"Id": list(range(1, 11))})


@pytest.fixture()
def mini_train() -> pd.DataFrame:
    """Minimal cleaned-train-like frame for fitting the simulator."""
    return pd.DataFrame(
        {
            "Id": [1, 2, 3, 4],
            "Neighborhood": ["NAmes", "NAmes", "CollgCr", "CollgCr"],
            "SalePrice": [100_000, 120_000, 200_000, 220_000],
        }
    )


# ---------------------------------------------------------------------------
# RealDomProvider — strict validation at construction
# ---------------------------------------------------------------------------


def test_real_provider_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="Real DOM CSV not found"):
        RealDomProvider(tmp_path / "nope.csv")


def test_real_provider_rejects_missing_columns(tmp_path: Path) -> None:
    path = tmp_path / "dom.csv"
    pd.DataFrame({"Id": [1], "dom": [10]}).to_csv(path, index=False)
    with pytest.raises(ValueError, match="missing required columns"):
        RealDomProvider(path)


def test_real_provider_rejects_non_integer_days(tmp_path: Path) -> None:
    path = _write_dom_csv(tmp_path / "dom.csv", [(1, 10), (2, 10.5), (3, 20)])
    with pytest.raises(ValueError, match="must contain integer days"):
        RealDomProvider(path)


def test_real_provider_rejects_non_integer_ids(tmp_path: Path) -> None:
    path = tmp_path / "dom.csv"
    pd.DataFrame({"Id": ["a", "b"], "days_on_market": [10, 20]}).to_csv(path, index=False)
    with pytest.raises(ValueError, match="'Id' must be an integer column"):
        RealDomProvider(path)


def test_real_provider_rejects_out_of_range_days(tmp_path: Path) -> None:
    path = _write_dom_csv(tmp_path / "dom.csv", [(1, 0), (2, 30), (3, 400)])
    with pytest.raises(ValueError, match=r"outside \[1, 365\]"):
        RealDomProvider(path)


def test_real_provider_rejects_duplicate_ids(tmp_path: Path) -> None:
    path = _write_dom_csv(tmp_path / "dom.csv", [(1, 10), (2, 20), (2, 25)])
    with pytest.raises(ValueError, match="duplicated Id"):
        RealDomProvider(path)


def test_real_provider_rejects_invalid_min_coverage(tmp_path: Path) -> None:
    path = _write_dom_csv(tmp_path / "dom.csv", [(1, 10)])
    with pytest.raises(ValueError, match="min_coverage"):
        RealDomProvider(path, min_coverage=1.5)


# ---------------------------------------------------------------------------
# RealDomProvider — transform behavior
# ---------------------------------------------------------------------------


def test_real_provider_exact_match_passes_and_aligns(tmp_path: Path) -> None:
    """Full coverage: values come from the CSV, aligned by Id not row order."""
    rows = [(i, i * 10) for i in range(1, 11)]  # Id k -> 10k days
    provider = RealDomProvider(_write_dom_csv(tmp_path / "dom.csv", rows))

    df = pd.DataFrame({"Id": [10, 3, 7, 1]})  # deliberately shuffled subset
    days = provider.transform(df)

    assert days.name == "days_on_market"
    assert days.tolist() == [100, 30, 70, 10]
    assert list(days.index) == list(df.index)


def test_real_provider_attach_derives_fast_sale_flag(tmp_path: Path) -> None:
    rows = [(1, 5), (2, FAST_SALE_THRESHOLD_DAYS), (3, 200)]
    provider = RealDomProvider(_write_dom_csv(tmp_path / "dom.csv", rows))

    out = attach_sale_speed(pd.DataFrame({"Id": [1, 2, 3]}), provider)

    assert out["days_on_market"].tolist() == [5, 30, 200]
    assert out["sells_within_30_days"].tolist() == [1, 1, 0]


def _empty_split_frame() -> pd.DataFrame:
    """Empty frame carrying the columns both DOM providers touch."""
    return pd.DataFrame(
        {
            "Id": pd.Series(dtype="int64"),
            "Neighborhood": pd.Series(dtype=object),
            "SalePrice": pd.Series(dtype="int64"),
            "OverallQual": pd.Series(dtype="int64"),
            "OverallCond": pd.Series(dtype="int64"),
            "MoSold": pd.Series(dtype="int64"),
        }
    )


def test_attach_sale_speed_empty_frame_real_provider(tmp_path: Path) -> None:
    """AUD-09 regression: an empty frame must not crash the median log line."""
    provider = RealDomProvider(_write_dom_csv(tmp_path / "dom.csv", [(1, 10), (2, 20)]))

    out = attach_sale_speed(_empty_split_frame(), provider)

    assert len(out) == 0
    assert {"days_on_market", "sells_within_30_days"} <= set(out.columns)


def test_attach_sale_speed_empty_frame_simulator(mini_train: pd.DataFrame) -> None:
    """AUD-09 regression: same empty-frame guard with the simulator."""
    provider = SaleSpeedSimulator().fit(mini_train)

    out = attach_sale_speed(_empty_split_frame(), provider)

    assert len(out) == 0
    assert {"days_on_market", "sells_within_30_days"} <= set(out.columns)


def test_real_provider_low_coverage_raises_with_counts(
    tmp_path: Path, id_frame: pd.DataFrame
) -> None:
    rows = [(i, 30) for i in range(1, 6)]  # covers Ids 1-5 of 1-10
    provider = RealDomProvider(_write_dom_csv(tmp_path / "dom.csv", rows))

    with pytest.raises(ValueError) as excinfo:
        provider.transform(id_frame)

    message = str(excinfo.value)
    assert "5/10" in message
    assert "min_coverage" in message
    assert "5 property Ids have no observation" in message


def test_real_provider_partial_coverage_fills_median_and_warns(
    tmp_path: Path, id_frame: pd.DataFrame, caplog: pytest.LogCaptureFixture
) -> None:
    rows = [(i, 10 * i) for i in range(1, 10)]  # covers 9 of 10 Ids; median = 50
    provider = RealDomProvider(_write_dom_csv(tmp_path / "dom.csv", rows), min_coverage=0.9)

    with caplog.at_level(logging.WARNING, logger="ml.data.sale_speed"):
        days = provider.transform(id_frame)

    assert days.tolist() == [10, 20, 30, 40, 50, 60, 70, 80, 90, provider.median_days]
    assert provider.median_days == 50
    assert not days.isna().any()
    assert any("1 of 10 property Ids" in rec.message for rec in caplog.records)


def test_real_provider_is_deterministic(tmp_path: Path, id_frame: pd.DataFrame) -> None:
    path = _write_dom_csv(tmp_path / "dom.csv", [(i, 40) for i in range(1, 11)])
    first = RealDomProvider(path).transform(id_frame)
    second = RealDomProvider(path).transform(id_frame)
    pd.testing.assert_series_equal(first, second)


# ---------------------------------------------------------------------------
# Provider selection in ml/data/pipeline.py
# ---------------------------------------------------------------------------


def test_select_dom_provider_defaults_to_simulator(
    mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("DOM_PROVIDER", raising=False)
    monkeypatch.delenv("DOM_CSV_PATH", raising=False)
    provider, note = select_dom_provider(mini_train)
    assert isinstance(provider, SaleSpeedSimulator)
    assert "SIMULATED" in note


def test_select_dom_provider_csv(tmp_path: Path, mini_train: pd.DataFrame,
                                 monkeypatch: pytest.MonkeyPatch) -> None:
    csv_path = _write_dom_csv(tmp_path / "dom.csv", [(1, 10), (2, 20)])
    monkeypatch.setenv("DOM_PROVIDER", "csv")
    monkeypatch.setenv("DOM_CSV_PATH", str(csv_path))
    provider, note = select_dom_provider(mini_train)
    assert isinstance(provider, RealDomProvider)
    assert "OBSERVED" in note


def test_select_dom_provider_csv_missing_file_fails_fast(
    tmp_path: Path, mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DOM_PROVIDER", "csv")
    monkeypatch.setenv("DOM_CSV_PATH", str(tmp_path / "missing.csv"))
    with pytest.raises(FileNotFoundError, match="DOM_PROVIDER=csv but no DOM file"):
        select_dom_provider(mini_train)


def test_select_dom_provider_unknown_kind(
    mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DOM_PROVIDER", "bogus")
    with pytest.raises(ValueError, match="Unknown DOM_PROVIDER"):
        select_dom_provider(mini_train)


def test_select_dom_provider_empty_value_means_unset(
    mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AUD-23 regression: DOM_PROVIDER='' (set-but-empty) -> simulated default."""
    monkeypatch.setenv("DOM_PROVIDER", "")
    monkeypatch.delenv("DOM_CSV_PATH", raising=False)
    provider, note = select_dom_provider(mini_train)
    assert isinstance(provider, SaleSpeedSimulator)
    assert "SIMULATED" in note


def test_select_dom_provider_whitespace_value_means_unset(
    mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AUD-23 regression: whitespace-only DOM_PROVIDER -> simulated default."""
    monkeypatch.setenv("DOM_PROVIDER", "   ")
    monkeypatch.delenv("DOM_CSV_PATH", raising=False)
    provider, note = select_dom_provider(mini_train)
    assert isinstance(provider, SaleSpeedSimulator)
    assert "SIMULATED" in note


def test_select_dom_provider_relative_csv_path_anchors_repo_root(
    tmp_path: Path, mini_train: pd.DataFrame, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AUD-23 regression: a relative DOM_CSV_PATH resolves against the repo
    root, not the process CWD.

    ``data/external/neighborhood_geo.csv`` exists under the repo root but not
    under ``tmp_path``; with CWD moved to ``tmp_path`` the file must still be
    found (anchored), and validation must then fail on its missing DOM columns
    — not with FileNotFoundError as the pre-fix CWD-relative lookup did.
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DOM_PROVIDER", "csv")
    monkeypatch.setenv("DOM_CSV_PATH", "data/external/neighborhood_geo.csv")
    with pytest.raises(ValueError, match="missing required columns"):
        select_dom_provider(mini_train)



# ---------------------------------------------------------------------------
# End-to-end: full pipeline with each provider into a TEMP output dir
# ---------------------------------------------------------------------------


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def dom_fixture_csv(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Observed-DOM CSV covering every raw Ames Id: ``days = Id % 365 + 1``."""
    ids = pd.read_csv(RAW_AMES_DIR / "train.csv", usecols=["Id"])["Id"]
    dom = pd.DataFrame({"Id": ids, "days_on_market": ids % 365 + 1})
    path = tmp_path_factory.mktemp("dom_fixture") / "days_on_market.csv"
    dom.to_csv(path, index=False)
    return path


@pytest.fixture(scope="module")
def csv_pipeline_output(
    tmp_path_factory: pytest.TempPathFactory, dom_fixture_csv: Path
) -> Path:
    """Run the real pipeline with DOM_PROVIDER=csv into a temp dir."""
    out = tmp_path_factory.mktemp("csv_pipeline")
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("DOM_PROVIDER", "csv")
        mp.setenv("DOM_CSV_PATH", str(dom_fixture_csv))
        counts = run_pipeline(out)
    assert counts == EXPECTED_COUNTS
    return out


def test_csv_pipeline_targets_come_from_csv(csv_pipeline_output: Path) -> None:
    """Every split's target columns must equal the fixture CSV values."""
    for name in ("train", "val", "test"):
        df = pd.read_csv(csv_pipeline_output / f"{name}.csv", keep_default_na=False)
        expected_days = df["Id"] % 365 + 1
        assert (df["days_on_market"] == expected_days).all(), name
        expected_flag = (expected_days <= FAST_SALE_THRESHOLD_DAYS).astype(int)
        assert (df["sells_within_30_days"] == expected_flag).all(), name


def test_csv_pipeline_schema_note_records_observed_target(csv_pipeline_output: Path) -> None:
    schema = json.loads((csv_pipeline_output / "schema.json").read_text())
    assert "OBSERVED" in schema["notes"][0]


@pytest.fixture(scope="module")
def default_pipeline_output(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Run the real pipeline with the default (simulated) provider, temp dir."""
    out = tmp_path_factory.mktemp("default_pipeline")
    with pytest.MonkeyPatch.context() as mp:
        mp.delenv("DOM_PROVIDER", raising=False)
        mp.delenv("DOM_CSV_PATH", raising=False)
        counts = run_pipeline(out)
    assert counts == EXPECTED_COUNTS
    return out


def test_default_pipeline_keeps_simulation_behavior(default_pipeline_output: Path) -> None:
    """Default run must reproduce the committed simulated targets exactly."""
    for name in ("train", "val", "test"):
        fresh = pd.read_csv(default_pipeline_output / f"{name}.csv", keep_default_na=False)
        committed = pd.read_csv(PROCESSED_DIR / f"{name}.csv", keep_default_na=False)
        assert fresh["days_on_market"].tolist() == committed["days_on_market"].tolist(), name
        assert (
            fresh["sells_within_30_days"].tolist()
            == committed["sells_within_30_days"].tolist()
        ), name


def test_default_pipeline_csv_bytes_match_committed(default_pipeline_output: Path) -> None:
    """Regression guard: the whole processed CSVs must be byte-identical."""
    for name in ("train", "val", "test"):
        fresh_md5 = _md5(default_pipeline_output / f"{name}.csv")
        committed_md5 = _md5(PROCESSED_DIR / f"{name}.csv")
        assert fresh_md5 == committed_md5, f"{name}.csv differs from committed bytes"
