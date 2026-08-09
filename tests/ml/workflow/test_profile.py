"""Profiling-core tests (workflow-architecture §3.3–§3.7, §8 matrix).

Numbers are asserted against independent pandas ground truth on tiny synthetic
frames; the real raw Ames frame (read-only) anchors the schema-level facts
(19 missing columns, PoolQC 99.5%, role inventory, OverallQual top correlate).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from ml.data.ingest import RAW_TRAIN_CSV
from ml.workflow.profile import (
    box_by,
    category_aggregate,
    correlation,
    descriptive_stats,
    feature_inventory,
    histogram,
    missing_report,
    profile_dataset,
    scatter,
)

_AMES: pd.DataFrame | None = None


def ames() -> pd.DataFrame:
    """Module-cached read of the real raw frame (keeps the suite fast)."""
    global _AMES
    if _AMES is None:
        _AMES = pd.read_csv(RAW_TRAIN_CSV)
    return _AMES


# ---------------------------------------------------------------------------
# §3.3 profile_dataset
# ---------------------------------------------------------------------------

class TestProfileDataset:
    def test_numbers_vs_pandas(self) -> None:
        df = pd.DataFrame(
            {
                "Id": [1, 2, 2, 3],
                "num": [1.0, 2.0, np.nan, 4.0],
                "cat": ["a", "b", "a", None],
            }
        )
        payload = profile_dataset(df)
        assert payload["n_rows"] == 4
        assert payload["n_cols"] == 3
        assert payload["n_numeric"] == 2
        assert payload["n_categorical"] == 1
        assert payload["n_duplicate_ids"] == 1
        assert payload["total_missing_cells"] == int(df.isna().sum().sum())
        assert payload["columns"] == [
            {"name": "Id", "dtype": "int64"},
            {"name": "num", "dtype": "float64"},
            {"name": "cat", "dtype": "object"},
        ]
        assert len(payload["head"]) == 4
        assert payload["head"][2]["num"] is None  # NaN -> None (JSON-safe)
        assert payload["head"][3]["cat"] is None
        json.dumps(payload)

    def test_head_capped_at_8_rows(self) -> None:
        df = pd.DataFrame({"Id": range(20), "x": range(20)})
        assert len(profile_dataset(df)["head"]) == 8


# ---------------------------------------------------------------------------
# §3.4 feature_inventory
# ---------------------------------------------------------------------------

class TestFeatureInventory:
    def test_role_inventory_on_ames(self) -> None:
        payload = feature_inventory(ames())
        roles: dict[str, int] = {}
        for feature in payload["raw_features"]:
            roles[feature["role"]] = roles.get(feature["role"], 0) + 1
        assert roles == {"identifier": 1, "target": 1, "excluded": 2, "raw_input": 77}
        assert len(payload["raw_features"]) == 81
        pipeline_roles = {f["role"] for f in payload["pipeline_features"]}
        assert pipeline_roles == {"engineered", "neighborhood_stat"}
        assert len(payload["pipeline_features"]) == 15
        json.dumps(payload)

    def test_feature_entry_fields(self) -> None:
        payload = feature_inventory(ames())
        by_name = {f["name"]: f for f in payload["raw_features"]}
        qual = by_name["OverallQual"]
        assert qual["dtype"] == "numeric" and qual["role"] == "raw_input"
        assert qual["min"] == 1 and qual["max"] == 10
        assert qual["mean"] == pytest.approx(ames()["OverallQual"].mean())
        assert qual["n_missing"] == 0 and qual["missing_pct"] == 0.0
        pool = by_name["PoolQC"]
        assert pool["dtype"] == "categorical"
        assert pool["n_missing"] == 1453 and pool["missing_pct"] == 99.5
        assert pool["top_values"][0] == {"value": "Gd", "count": 3}
        assert by_name["Id"]["role"] == "identifier"
        assert by_name["SalePrice"]["role"] == "target"
        assert by_name["SaleType"]["role"] == "excluded"

    def test_targets_block(self) -> None:
        targets = feature_inventory(ames())["targets"]
        assert targets["regression"]["available"] is True
        assert targets["regression"]["column"] == "SalePrice"
        classification = targets["classification"]
        assert classification["derived"] == "simulated"
        assert 0.0 < classification["positive_rate"] < 1.0
        # deterministic dry-run: same frame -> same rate
        assert feature_inventory(ames())["targets"]["classification"]["positive_rate"] == (
            classification["positive_rate"]
        )
        assert targets["clustering"]["method"] == "DBSCAN"

    def test_recommended_split(self) -> None:
        assert feature_inventory(ames())["recommended_split"]["strategy"] == "time"
        single_year = ames()[ames()["YrSold"] == 2008]
        rec = feature_inventory(single_year)["recommended_split"]
        assert rec["strategy"] == "random" and rec["column"] is None


# ---------------------------------------------------------------------------
# §3.5 descriptive_stats
# ---------------------------------------------------------------------------

class TestDescriptiveStats:
    def test_numeric_block_vs_pandas(self) -> None:
        df = pd.DataFrame(
            {
                "SalePrice": [100_000, 200_000, 300_000, 400_000],
                "cat": ["x", "y", "x", "x"],
            }
        )
        payload = descriptive_stats(df)
        series = df["SalePrice"]
        target = payload["target"]
        assert target["name"] == "SalePrice"
        assert target["note"] == "right-skewed — models use log1p"
        assert target["count"] == int(series.count())
        assert target["mean"] == pytest.approx(series.mean())
        assert target["std"] == pytest.approx(series.std())
        assert target["min"] == pytest.approx(series.min())
        assert target["p25"] == pytest.approx(series.quantile(0.25))
        assert target["p50"] == pytest.approx(series.quantile(0.50))
        assert target["p75"] == pytest.approx(series.quantile(0.75))
        assert target["max"] == pytest.approx(series.max())
        numeric = payload["numeric"][0]
        assert numeric == {k: v for k, v in target.items() if k not in {"note"}}

    def test_categorical_block_vs_pandas(self) -> None:
        df = pd.DataFrame({"cat": ["b", "a", "b", None, "b"]})
        [entry] = descriptive_stats(df)["categorical"]
        assert entry == {"name": "cat", "count": 4, "n_unique": 2, "top": "b", "top_freq": 3}

    def test_ames_saleprice_mean_is_full_frame_truth(self) -> None:
        # Full raw frame (1460 rows) — note this is NOT the train-only
        # 182,125.13 of models/neighborhood_stats.json (see WF-B1 report).
        payload = descriptive_stats(ames())
        assert payload["target"]["mean"] == pytest.approx(180921.20, abs=0.01)
        assert len(payload["numeric"]) + len(payload["categorical"]) == 81
        json.dumps(payload)


# ---------------------------------------------------------------------------
# §3.6 missing_report
# ---------------------------------------------------------------------------

class TestMissingReport:
    def test_policy_mapping_and_blocking(self) -> None:
        df = pd.DataFrame(
            {
                "PoolQC": [None, "Ex", None],          # absent-token policy
                "LotFrontage": [80.0, None, 70.0],     # train neighborhood median
                "Electrical": ["SBrkr", None, "SBrkr"],  # train mode
                "GarageArea": [100.0, None, 200.0],    # absent -> 0
                "SalePrice": [200_000.0, None, 150_000.0],  # NO policy -> blocking
                "OkCol": [1, 2, 3],
            }
        )
        payload = missing_report(df)
        by_name = {c["name"]: c for c in payload["columns"]}
        assert by_name["PoolQC"]["treatment"] == "fill_absent_token"
        assert by_name["PoolQC"]["policy"] == "NA_ABSENT_CATEGORICAL"
        assert "no pool" in by_name["PoolQC"]["note"]
        assert by_name["LotFrontage"]["treatment"] == "impute_neighborhood_median"
        assert by_name["Electrical"]["treatment"] == "impute_train_mode"
        assert by_name["GarageArea"]["treatment"] == "fill_zero"
        assert by_name["GarageArea"]["policy"] == "NA_ABSENT_NUMERIC"
        [blocked] = payload["blocking"]
        assert blocked["name"] == "SalePrice"
        assert "apply_cleaner will raise" in blocked["reason"]
        assert payload["total_missing"] == 6
        assert payload["n_columns_with_missing"] == 5
        assert payload["n_complete_columns"] == 1
        json.dumps(payload)

    def test_ames_ground_truth(self) -> None:
        payload = missing_report(ames())
        assert payload["total_missing"] == 7_829
        assert payload["n_columns_with_missing"] == 19
        assert payload["n_complete_columns"] == 62
        first = payload["columns"][0]  # sorted by pct_missing desc
        assert first["name"] == "PoolQC"
        assert first["n_missing"] == 1453 and first["pct_missing"] == 99.5
        assert first["treatment"] == "fill_absent_token"
        assert payload["blocking"] == []

    def test_no_missing(self) -> None:
        payload = missing_report(pd.DataFrame({"a": [1, 2], "b": ["x", "y"]}))
        assert payload["total_missing"] == 0
        assert payload["columns"] == [] and payload["blocking"] == []


# ---------------------------------------------------------------------------
# §3.7 viz aggregations
# ---------------------------------------------------------------------------

class TestViz:
    def test_histogram_vs_numpy(self) -> None:
        df = pd.DataFrame({"x": [float(i) for i in range(10)] + [np.nan]})
        payload = histogram(df, "x", bins=5)
        counts, edges = np.histogram(np.arange(10, dtype=float), bins=5)
        assert [b["count"] for b in payload["bins"]] == counts.tolist()
        assert [b["x0"] for b in payload["bins"]] == pytest.approx(edges[:-1].tolist())
        assert payload["stats"] == {
            "min": 0.0, "max": 9.0, "mean": 4.5, "median": 4.5,
        }
        assert sum(b["count"] for b in payload["bins"]) == 10  # NaN excluded

    def test_histogram_rejects_bad_columns(self) -> None:
        df = pd.DataFrame({"cat": ["a", "b"], "num": [1, 2]})
        with pytest.raises(ValueError, match="unknown column"):
            histogram(df, "nope")
        with pytest.raises(ValueError, match="categorical"):
            histogram(df, "cat")

    def test_scatter_downsample_seeded(self) -> None:
        df = pd.DataFrame({"x": np.arange(2000.0), "y": np.arange(2000.0) * 2})
        payload = scatter(df, "x", "y", max_points=1500)
        assert payload["n_total"] == 2000
        assert payload["sampled"] is True
        assert len(payload["points"]) == 1500
        again = scatter(df, "x", "y", max_points=1500)
        assert payload["points"] == again["points"]  # deterministic (RANDOM_SEED)

    def test_scatter_no_sampling_below_cap_and_nan_dropped(self) -> None:
        df = pd.DataFrame({"x": [1.0, 2.0, np.nan], "y": [3.0, 4.0, 5.0]})
        payload = scatter(df, "x", "y")
        assert payload["sampled"] is False
        assert payload["n_total"] == 2
        assert payload["points"] == [[1.0, 3.0], [2.0, 4.0]]

    def test_box_by_sorted_by_median_desc(self) -> None:
        df = pd.DataFrame(
            {
                "price": [1.0, 2.0, 3.0, 10.0, 20.0, 30.0, 100.0, 200.0, 300.0],
                "grp": ["a", "a", "a", "b", "b", "b", "c", "c", "c"],
            }
        )
        payload = box_by(df, "price", "grp")
        assert [g["value"] for g in payload["groups"]] == ["c", "b", "a"]
        b = payload["groups"][1]
        series = df[df["grp"] == "b"]["price"]
        assert b["n"] == 3
        assert b["min"] == pytest.approx(series.min())
        assert b["q1"] == pytest.approx(series.quantile(0.25))
        assert b["median"] == pytest.approx(series.median())
        assert b["q3"] == pytest.approx(series.quantile(0.75))
        assert b["max"] == pytest.approx(series.max())

    def test_box_by_caps_at_25_groups(self) -> None:
        df = pd.DataFrame(
            {
                "x": np.arange(60.0),
                "grp": [f"g{i:02d}" for i in range(30) for _ in range(2)],
            }
        )
        assert len(box_by(df, "x", "grp")["groups"]) == 25

    def test_correlation_ground_truth(self) -> None:
        rng = np.random.default_rng(0)
        a = rng.normal(size=500)
        df = pd.DataFrame(
            {
                "SalePrice": a,
                "strong": a * 2 + rng.normal(scale=0.01, size=500),
                "weak": rng.normal(size=500),
            }
        )
        payload = correlation(df, "SalePrice", top=1)
        assert payload["features"] == ["strong", "SalePrice"]  # by |corr|, target last
        matrix = payload["matrix"]
        assert matrix[0][0] == pytest.approx(1.0)  # self-correlation
        assert matrix[0][1] == pytest.approx(matrix[1][0])  # symmetric
        assert matrix[0][1] == pytest.approx(1.0, abs=1e-2)
        json.dumps(payload)

    def test_correlation_ames_top_feature(self) -> None:
        payload = correlation(ames(), "SalePrice", 20)
        assert payload["features"][0] == "OverallQual"
        assert payload["features"][-1] == "SalePrice"
        assert len(payload["matrix"]) == 21 and len(payload["matrix"][0]) == 21

    def test_category_aggregate_vs_pandas(self) -> None:
        df = pd.DataFrame(
            {
                "grp": ["a", "a", "b", "b", "b"],
                "SalePrice": [100.0, 300.0, 10.0, 20.0, 60.0],
            }
        )
        payload = category_aggregate(df, "grp", "SalePrice", "median")
        assert payload["groups"] == [
            {"value": "a", "n": 2, "agg_value": 200.0},
            {"value": "b", "n": 3, "agg_value": 20.0},
        ]
        counted = category_aggregate(df, "grp", "SalePrice", "count")
        assert counted["groups"][0] == {"value": "b", "n": 3, "agg_value": 3.0}

    def test_category_aggregate_rejects_bad_agg(self) -> None:
        df = pd.DataFrame({"grp": ["a"], "SalePrice": [1.0]})
        with pytest.raises(ValueError, match="unknown agg"):
            category_aggregate(df, "grp", "SalePrice", "std")
        with pytest.raises(ValueError, match="unknown column"):
            category_aggregate(df, "nope", "SalePrice", "median")

    def test_ames_histogram_sums_to_row_count(self) -> None:
        payload = histogram(ames(), "SalePrice", bins=30)
        assert sum(b["count"] for b in payload["bins"]) == 1460
