"""Unit tests for the monitoring package (SPEC §10/§11).

Covers the PSI math (``ml.monitoring.psi``), the train-fit reference builder
(``ml.monitoring.reference``), and the drift-check CLI logic
(``ml.monitoring.drift_check``) against synthetic prediction logs in tmp_path.
The reference builder tests use the real processed train split (945 rows).
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ml.features.pipeline import build_feature_frame
from ml.features.stats import fit_neighborhood_stats
from ml.monitoring.drift_check import (
    CALENDAR_FEATURES,
    DRIFT_THRESHOLD_ENV_VAR,
    LOW_SAMPLE_THRESHOLD,
    MIN_SAMPLE_FOR_RETRAINING,
    run_drift_check,
)
from ml.monitoring.psi import (
    PSI_DRIFT_THRESHOLD,
    PSI_WARN_THRESHOLD,
    bin_proportions,
    degenerate_binning,
    population_stability_index,
    psi_bins_from_train,
)
from ml.monitoring.reference import (
    KEY_CATEGORICAL_FEATURES,
    build_reference_stats,
    load_model_features,
    load_reference_stats,
)
from ml.paths import REPO_ROOT
from ml.training.common import load_split

# ---------------------------------------------------------------------------
# psi.py — numeric proofs
# ---------------------------------------------------------------------------


def test_psi_identical_proportions_is_zero() -> None:
    """PSI of a distribution against itself is exactly 0."""
    proportions = [0.1, 0.2, 0.4, 0.2, 0.1]
    assert population_stability_index(proportions, proportions) == 0.0


def test_psi_matches_hand_computed_value() -> None:
    """PSI equals the closed form Σ (a−e)·ln(a/e) on a two-bin example."""
    expected = [0.5, 0.5]
    actual = [0.9, 0.1]
    hand = (0.9 - 0.5) * math.log(0.9 / 0.5) + (0.1 - 0.5) * math.log(0.1 / 0.5)
    psi = population_stability_index(expected, actual)
    assert psi == pytest.approx(hand, abs=1e-12)
    assert psi == pytest.approx(0.8789, abs=1e-3)
    assert psi > PSI_DRIFT_THRESHOLD


def test_psi_same_distribution_samples_is_small() -> None:
    """Two large samples from the same distribution yield PSI well below warn."""
    rng = np.random.default_rng(42)
    reference = rng.normal(0.0, 1.0, size=5000)
    live = rng.normal(0.0, 1.0, size=5000)
    edges = psi_bins_from_train(reference)
    psi = population_stability_index(
        bin_proportions(reference, edges), bin_proportions(live, edges)
    )
    assert 0.0 <= psi < PSI_WARN_THRESHOLD


def test_psi_shifted_distribution_is_large() -> None:
    """A mean shift of +1.5σ pushes PSI far beyond the drift threshold."""
    rng = np.random.default_rng(42)
    reference = rng.normal(0.0, 1.0, size=5000)
    shifted = rng.normal(1.5, 1.0, size=5000)
    edges = psi_bins_from_train(reference)
    psi = population_stability_index(
        bin_proportions(reference, edges), bin_proportions(shifted, edges)
    )
    assert psi > PSI_DRIFT_THRESHOLD


def test_psi_accepts_counts_and_clips_empty_bins() -> None:
    """Unnormalized counts work; empty bins yield a large-but-finite PSI."""
    psi = population_stability_index([100, 100, 0], [50, 50, 200])
    assert math.isfinite(psi)
    assert psi > PSI_DRIFT_THRESHOLD


def test_psi_rejects_mismatched_or_degenerate_input() -> None:
    """Mismatched lengths, empty vectors and zero-mass vectors raise."""
    with pytest.raises(ValueError):
        population_stability_index([0.5, 0.5], [1.0])
    with pytest.raises(ValueError):
        population_stability_index([], [])
    with pytest.raises(ValueError):
        population_stability_index([0.0, 0.0], [0.5, 0.5])


# ---------------------------------------------------------------------------
# psi.py — bin helpers
# ---------------------------------------------------------------------------


def test_psi_bins_from_train_quantiles() -> None:
    """Quantile edges span [min, max], are strictly increasing, ~n_bins+1 long."""
    rng = np.random.default_rng(42)
    values = rng.normal(100.0, 15.0, size=1000)
    edges = psi_bins_from_train(values, n_bins=10)
    assert len(edges) == 11
    assert edges[0] == pytest.approx(float(np.min(values)))
    assert edges[-1] == pytest.approx(float(np.max(values)))
    assert all(b > a for a, b in zip(edges, edges[1:]))


def test_psi_bins_from_train_handles_duplicate_edges() -> None:
    """Heavy ties (zero-inflated feature) get fallback bins, not a blind 1-bin collapse.

    AUD-06 regression: before the fix this sample collapsed to edges
    ``[0.0, 50.0]`` → a single ``[-inf, +inf]`` bin → PSI ≡ 0 for *any*
    production value. The fallback midpoint cuts must keep the feature
    drift-sensitive, including for out-of-range values (open outer bins).
    """
    values = [0.0] * 950 + [float(v) for v in range(1, 51)]
    edges = psi_bins_from_train(values, n_bins=10)
    assert len(edges) >= 3  # fallback: at least two usable bins
    assert all(b > a for a, b in zip(edges, edges[1:]))
    proportions = bin_proportions(values, edges)
    assert proportions.sum() == pytest.approx(1.0)
    # The first cut separates the dominant zero mass from the tail.
    assert proportions[0] == pytest.approx(0.95)
    # In-range and out-of-range production shifts both clear the drift bar.
    for production in ([500.0] * 50, [9999999.0] * 50):
        psi = population_stability_index(
            proportions, bin_proportions(production, edges)
        )
        assert psi > PSI_DRIFT_THRESHOLD


def test_degenerate_binning_flags_collapsed_quantiles() -> None:
    """``degenerate_binning`` marks exactly the features whose quantiles collapse."""
    zero_inflated = [0.0] * 950 + [float(v) for v in range(1, 51)]
    assert degenerate_binning(zero_inflated) is True
    assert degenerate_binning([7.0] * 100) is True  # constant → 1 unique edge
    rng = np.random.default_rng(42)
    assert degenerate_binning(rng.normal(0.0, 1.0, size=1000)) is False
    with pytest.raises(ValueError):
        degenerate_binning([])


def test_psi_bins_from_train_constant_feature() -> None:
    """A constant reference degenerates to a cut at the constant; drift is seen."""
    edges = psi_bins_from_train([7.0] * 100)
    assert edges == [6.5, 7.0, 7.5]
    assert bin_proportions([7.0] * 10, edges).tolist() == [0.0, 1.0]
    shifted_psi = population_stability_index(
        bin_proportions([7.0] * 10, edges), bin_proportions([3.0] * 10, edges)
    )
    assert shifted_psi > PSI_DRIFT_THRESHOLD


def test_bin_proportions_out_of_range_values_land_in_edge_bins() -> None:
    """Values beyond the train range count in the outer bins, never dropped."""
    edges = [0.0, 1.0, 2.0, 3.0]
    proportions = bin_proportions([-5.0, 0.5, 100.0], edges)
    assert proportions.tolist() == pytest.approx([2 / 3, 0.0, 1 / 3])


def test_bin_proportions_drops_non_numeric_and_empty_input() -> None:
    """NaN/non-numeric entries are dropped; empty input → zero vector."""
    proportions = bin_proportions([1.0, "junk", None, 2.0], [0.0, 1.5, 3.0])
    assert proportions.tolist() == pytest.approx([0.5, 0.5])
    assert bin_proportions([], [0.0, 1.0]).tolist() == [0.0]


def test_bin_proportions_rejects_bad_edges() -> None:
    """Fewer than two edges or non-increasing edges raise."""
    with pytest.raises(ValueError):
        bin_proportions([1.0], [1.0])
    with pytest.raises(ValueError):
        bin_proportions([1.0], [2.0, 1.0])


# ---------------------------------------------------------------------------
# reference.py — real train-split artifact
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def train_frame() -> pd.DataFrame:
    """The built TRAIN feature frame (real processed data, 945 rows)."""
    train = load_split("train")
    stats = fit_neighborhood_stats(train)
    return build_feature_frame(train, stats)


@pytest.fixture(scope="module")
def reference_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """reference_stats.json built into a tmp dir from the real train split."""
    output = tmp_path_factory.mktemp("monitoring") / "reference_stats.json"
    build_reference_stats(output_path=output)
    return output


def test_reference_builder_covers_all_numeric_model_features(
    reference_path: Path, train_frame: pd.DataFrame
) -> None:
    """Every numeric MODEL_FEATURES column has bin edges + proportions."""
    payload = json.loads(reference_path.read_text())
    model_features = load_model_features()
    expected_numeric = {
        feature
        for feature in model_features
        if pd.api.types.is_numeric_dtype(train_frame[feature])
    }
    assert set(payload["numeric"].keys()) == expected_numeric
    assert payload["n_rows"] == len(train_frame) == 945
    for feature, spec in payload["numeric"].items():
        edges = spec["bin_edges"]
        # AUD-06: every feature must keep at least two usable bins (3 edges).
        assert len(edges) >= 3
        assert all(b > a for a, b in zip(edges, edges[1:]))
        assert len(spec["expected_proportions"]) == len(edges) - 1
        assert sum(spec["expected_proportions"]) == pytest.approx(1.0)
        assert spec["degenerate"] in (True, False)


def test_reference_builder_marks_degenerate_features(reference_path: Path) -> None:
    """AUD-06: the six zero-inflated features carry ``degenerate: true``.

    These are the features whose quantile binning collapsed to a single bin
    in the pre-fix artifact (PSI blind spot); the fallback binning restores
    sensitivity but with fewer effective bins, so the marker stays as the
    reduced-sensitivity disclosure.
    """
    payload = json.loads(reference_path.read_text())
    degenerate = {
        feature
        for feature, spec in payload["numeric"].items()
        if spec["degenerate"]
    }
    assert degenerate == {
        "3SsnPorch",
        "BsmtHalfBath",
        "LowQualFinSF",
        "MiscVal",
        "PoolArea",
        "ScreenPorch",
    }
    pool = payload["numeric"]["PoolArea"]
    assert len(pool["bin_edges"]) >= 3
    # The blind spot is closed: an extreme out-of-range production sample
    # (all 9,999,999 — train max is 738) now yields PSI > 0.2 (was 0.0).
    actual = bin_proportions([9999999.0] * 50, pool["bin_edges"])
    psi = population_stability_index(pool["expected_proportions"], actual)
    assert psi > PSI_DRIFT_THRESHOLD
    # A healthy feature is not marked.
    assert payload["numeric"]["GrLivArea"]["degenerate"] is False


def test_reference_builder_tracks_key_categoricals(reference_path: Path) -> None:
    """The four key categorical features carry train frequency proportions."""
    payload = json.loads(reference_path.read_text())
    assert set(payload["categorical"].keys()) == set(KEY_CATEGORICAL_FEATURES)
    for feature in KEY_CATEGORICAL_FEATURES:
        proportions = payload["categorical"][feature]["proportions"]
        assert proportions, f"{feature} has no categories"
        assert sum(proportions.values()) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# reference.py — corrupt artifact handling (AUD-25)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param("not json at all {", id="invalid-json"),
        pytest.param("[1, 2, 3]", id="non-dict-payload"),
        pytest.param('{"numeric": [1, 2]}', id="numeric-not-dict"),
        pytest.param(
            '{"numeric": {"PoolArea": {"bin_edges": [738.0, 0.0], '
            '"expected_proportions": [1.0]}}}',
            id="non-increasing-edges",
        ),
        pytest.param(
            '{"numeric": {"PoolArea": {"bin_edges": [0.0], '
            '"expected_proportions": [1.0]}}}',
            id="single-edge",
        ),
        pytest.param(
            '{"numeric": {"PoolArea": {"bin_edges": [0.0, 738.0], '
            '"expected_proportions": [0.5, 0.5]}}}',
            id="proportions-length-mismatch",
        ),
        pytest.param(
            '{"numeric": {"PoolArea": {"bin_edges": [0.0, 738.0], '
            '"expected_proportions": [0.0]}}}',
            id="zero-mass-proportions",
        ),
    ],
)
def test_load_reference_stats_corrupt_raises_structured_error(
    tmp_path: Path, payload: str
) -> None:
    """AUD-25: corrupt reference → clean ValueError naming the problem."""
    path = tmp_path / "reference_stats.json"
    path.write_text(payload)
    with pytest.raises(ValueError, match="corrupt drift reference"):
        load_reference_stats(path)


def test_drift_check_corrupt_reference_is_clean_error_not_traceback(
    tmp_path: Path,
) -> None:
    """AUD-25: run_drift_check surfaces the structured ValueError, and the
    CLI exits 2 with a logged error instead of an uncaught traceback."""
    corrupt = tmp_path / "reference_stats.json"
    corrupt.write_text(
        '{"numeric": {"GrLivArea": {"bin_edges": [3000.0, 1000.0], '
        '"expected_proportions": [1.0]}}}'
    )
    log = _write_log(tmp_path / "predictions.jsonl", [_log_line({"GrLivArea": 1500.0})])
    with pytest.raises(ValueError, match="corrupt drift reference"):
        run_drift_check(
            log_path=log,
            reference_path=corrupt,
            prediction_reference_path=tmp_path / "absent.json",
            output_path=tmp_path / "latest.json",
        )
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "ml.monitoring.drift_check",
            "--log",
            str(log),
            "--reference",
            str(corrupt),
            "--output",
            str(tmp_path / "cli-latest.json"),
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 2
    assert "corrupt drift reference" in result.stderr
    assert "Traceback" not in result.stderr


# ---------------------------------------------------------------------------
# drift_check.py — synthetic prediction logs in tmp_path
# ---------------------------------------------------------------------------


def _jsonable(value: object) -> object:
    """Convert numpy scalars to plain Python types for json.dumps."""
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    return value


def _log_line(features: dict, estimated_price: float = 200000.0) -> dict:
    """One SPEC §10 log line: full built feature row + prediction bundle."""
    return {
        "timestamp": "2026-08-07T00:00:00+00:00",
        "payload": {},
        "features": {key: _jsonable(value) for key, value in features.items()},
        "prediction": {
            "estimated_price": estimated_price,
            "probability": 0.25,
            "cluster_id": 1,
        },
        "model_version": "test_v1",
    }


def _write_log(path: Path, lines: list[dict]) -> Path:
    content = "\n".join(json.dumps(line) for line in lines)
    path.write_text(content + "\n" if content else "")
    return path


def test_drift_check_in_distribution_no_drift(
    tmp_path: Path,
    reference_path: Path,
    train_frame: pd.DataFrame,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The train rows themselves as log lines → PSI 0 everywhere, no drift."""
    monkeypatch.delenv(DRIFT_THRESHOLD_ENV_VAR, raising=False)
    lines = [_log_line(row) for _, row in train_frame.iterrows()]
    log = _write_log(tmp_path / "predictions.jsonl", lines)
    report = run_drift_check(
        log_path=log,
        window=len(lines),
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent_prediction_reference.json",
        output_path=tmp_path / "drift" / "latest.json",
    )
    assert report["status"] == "ok"
    assert report["n_predictions"] == len(lines)
    assert report["low_sample"] is False
    assert report["drift_detected"] is False
    assert report["drifted_features"] == []
    assert report["calendar_drift_features"] == []
    assert report["max_psi"] == 0.0
    assert all(psi == 0.0 for psi in report["per_feature_psi"].values())
    assert len(report["per_feature_psi"]) == len(
        json.loads(reference_path.read_text())["numeric"]
    )
    assert report["prediction_psi"] is None
    assert report["retraining_recommended"] is False
    # Report was persisted with the same payload.
    on_disk = json.loads((tmp_path / "drift" / "latest.json").read_text())
    assert on_disk["status"] == "ok"
    assert on_disk["psi_threshold"] == PSI_DRIFT_THRESHOLD
    assert on_disk["warn_threshold"] == PSI_WARN_THRESHOLD


def test_drift_check_shifted_gr_liv_area_detects_drift_but_no_retrain_below_200(
    tmp_path: Path, reference_path: Path, train_frame: pd.DataFrame
) -> None:
    """GrLivArea ×3 (beyond train range) → drift flagged; n<200 blocks retraining."""
    sample = train_frame.sample(n=50, random_state=42).copy()
    sample["GrLivArea"] = sample["GrLivArea"] * 3.0
    lines = [_log_line(row) for _, row in sample.iterrows()]
    log = _write_log(tmp_path / "predictions.jsonl", lines)
    report = run_drift_check(
        log_path=log,
        window=500,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent_prediction_reference.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["status"] == "ok"
    assert report["n_predictions"] == 50
    assert report["low_sample"] is False  # 50 is not < LOW_SAMPLE_THRESHOLD
    assert LOW_SAMPLE_THRESHOLD == 50
    assert report["drift_detected"] is True
    assert "GrLivArea" in report["drifted_features"]
    assert report["per_feature_psi"]["GrLivArea"] >= PSI_DRIFT_THRESHOLD
    assert report["retraining_recommended"] is False  # 50 < 200 minimum
    assert report["recommendation_text"]


def test_drift_check_missing_log_is_no_data(tmp_path: Path, reference_path: Path) -> None:
    """Missing log → status no_data, no drift, no retraining, report written."""
    output = tmp_path / "drift" / "latest.json"
    report = run_drift_check(
        log_path=tmp_path / "does_not_exist.jsonl",
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=output,
    )
    assert report["status"] == "no_data"
    assert report["n_predictions"] == 0
    assert report["low_sample"] is True
    assert report["calendar_drift_features"] == []
    assert report["drift_detected"] is False
    assert report["retraining_recommended"] is False
    assert json.loads(output.read_text())["status"] == "no_data"


def test_drift_check_empty_and_invalid_lines(
    tmp_path: Path, reference_path: Path
) -> None:
    """Empty log → no_data; invalid JSON lines are skipped and counted.

    AUD-25: blank lines are also counted in ``n_invalid_lines``, matching the
    ``read_prediction_window`` docstring ("skipped and counted").
    """
    empty_log = _write_log(tmp_path / "empty.jsonl", [])
    report = run_drift_check(
        log_path=empty_log,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=tmp_path / "latest_empty.json",
    )
    assert report["status"] == "no_data"

    mixed = tmp_path / "mixed.jsonl"
    valid = _log_line({"GrLivArea": 1500.0})
    mixed.write_text(
        "not json at all\n"
        + json.dumps({"no_features": True})
        + "\n\n"  # blank line: skipped and counted like any malformed line
        + json.dumps(valid)
        + "\n{broken\n"
        + json.dumps(valid)
        + "\n"
    )
    report = run_drift_check(
        log_path=mixed,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=tmp_path / "latest_mixed.json",
    )
    assert report["status"] == "ok"
    assert report["n_predictions"] == 2
    # 3 malformed/non-conforming lines + 1 blank line, all counted.
    assert report["n_invalid_lines"] == 4
    assert report["low_sample"] is True
    # Only GrLivArea was present in the log lines → only it is scored.
    assert set(report["per_feature_psi"].keys()) == {"GrLivArea"}


def test_drift_check_prediction_psi_when_reference_present(
    tmp_path: Path, reference_path: Path
) -> None:
    """Prediction-distribution PSI is computed when the reference file exists.

    Uses the real producer's sectioned schema (``{"regression": {"field":
    "estimated_price", "bin_edges": ..., "bin_proportions": ...}}``).
    """
    prediction_reference = tmp_path / "prediction_reference.json"
    prediction_reference.write_text(
        json.dumps(
            {
                "version": 1,
                "regression": {
                    "model": "test_v1",
                    "field": "estimated_price",
                    "bin_edges": [100000.0, 150000.0, 200000.0, 300000.0],
                    "bin_proportions": [0.25, 0.5, 0.25],
                },
            }
        )
    )
    # All predictions far above the reference range → last bin only.
    lines = [
        _log_line({"GrLivArea": 1500.0}, estimated_price=900000.0) for _ in range(20)
    ]
    log = _write_log(tmp_path / "predictions.jsonl", lines)
    report = run_drift_check(
        log_path=log,
        reference_path=reference_path,
        prediction_reference_path=prediction_reference,
        output_path=tmp_path / "latest.json",
    )
    assert report["prediction_psi"] is not None
    assert report["prediction_psi"]["estimated_price"] > PSI_DRIFT_THRESHOLD


# ---------------------------------------------------------------------------
# drift_check.py — calendar-drift guard (AUD-07)
# ---------------------------------------------------------------------------


def _today_dated_sample(train_frame: pd.DataFrame, n: int = 250) -> pd.DataFrame:
    """In-distribution rows with calendar fields stamped as 2026-08 (today)."""
    sample = train_frame.sample(n=n, random_state=42).copy()
    sample["YrSold"] = 2026
    sample["MoSold"] = 8
    sample["sale_year"] = 2026
    sample["sale_month"] = 8
    sample["sale_quarter"] = 3
    sample["property_age"] = 2026 - sample["YearBuilt"]
    sample["years_since_remod"] = 2026 - sample["YearRemodAdd"]
    return sample


def test_drift_check_calendar_only_drift_never_recommends_retraining(
    tmp_path: Path, reference_path: Path, train_frame: pd.DataFrame
) -> None:
    """AUD-07: n=250 today-dated in-distribution rows → calendar drift noted,
    ``retraining_recommended`` stays False (was True before the guard)."""
    sample = _today_dated_sample(train_frame)
    lines = [_log_line(row) for _, row in sample.iterrows()]
    log = _write_log(tmp_path / "predictions.jsonl", lines)
    report = run_drift_check(
        log_path=log,
        window=500,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent_prediction_reference.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["status"] == "ok"
    assert report["n_predictions"] == 250 >= MIN_SAMPLE_FOR_RETRAINING
    assert report["low_sample"] is False
    # Drift is real and stays visible — but only on calendar-derived features.
    assert report["drift_detected"] is True
    assert set(report["calendar_drift_features"]) == set(report["drifted_features"])
    assert set(report["drifted_features"]) <= set(CALENDAR_FEATURES)
    assert {"YrSold", "sale_year", "property_age", "years_since_remod"} <= set(
        report["drifted_features"]
    )
    assert report["retraining_recommended"] is False
    assert "calendar" in report["recommendation_text"]


def test_drift_check_non_calendar_drift_at_min_sample_still_recommends(
    tmp_path: Path, reference_path: Path, train_frame: pd.DataFrame
) -> None:
    """Guard is calendar-specific: real drift at n>=200 still recommends."""
    sample = train_frame.sample(n=250, random_state=42).copy()
    sample["GrLivArea"] = sample["GrLivArea"] * 3.0
    lines = [_log_line(row) for _, row in sample.iterrows()]
    log = _write_log(tmp_path / "predictions.jsonl", lines)
    report = run_drift_check(
        log_path=log,
        window=500,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent_prediction_reference.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["n_predictions"] == 250 >= MIN_SAMPLE_FOR_RETRAINING
    assert "GrLivArea" in report["drifted_features"]
    assert "GrLivArea" not in report["calendar_drift_features"]
    assert report["retraining_recommended"] is True


# ---------------------------------------------------------------------------
# drift_check.py — DRIFT_PSI_THRESHOLD env var (AUD-08)
# ---------------------------------------------------------------------------


def _shifted_gr_liv_area_log(
    tmp_path: Path, train_frame: pd.DataFrame, n: int = 50
) -> Path:
    """Log lines with GrLivArea ×3 (PSI ≈ 10, far above any sane threshold)."""
    sample = train_frame.sample(n=n, random_state=42).copy()
    sample["GrLivArea"] = sample["GrLivArea"] * 3.0
    lines = [_log_line(row) for _, row in sample.iterrows()]
    return _write_log(tmp_path / "predictions.jsonl", lines)


def test_drift_threshold_env_override_raises_bar(
    tmp_path: Path,
    reference_path: Path,
    train_frame: pd.DataFrame,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DRIFT_PSI_THRESHOLD=50 → PSI≈10 no longer counts as drift."""
    monkeypatch.setenv(DRIFT_THRESHOLD_ENV_VAR, "50.0")
    log = _shifted_gr_liv_area_log(tmp_path, train_frame)
    report = run_drift_check(
        log_path=log,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["psi_threshold"] == 50.0
    assert report["drift_detected"] is False
    assert report["drifted_features"] == []
    assert "GrLivArea" in report["warn_features"]  # warn zone is [0.1, 50)
    assert report["retraining_recommended"] is False


def test_drift_threshold_env_override_lowers_bar(
    tmp_path: Path,
    reference_path: Path,
    train_frame: pd.DataFrame,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DRIFT_PSI_THRESHOLD=0.05 → the shift is reported against 0.05."""
    monkeypatch.setenv(DRIFT_THRESHOLD_ENV_VAR, "0.05")
    log = _shifted_gr_liv_area_log(tmp_path, train_frame)
    report = run_drift_check(
        log_path=log,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["psi_threshold"] == 0.05
    assert "GrLivArea" in report["drifted_features"]


@pytest.mark.parametrize("raw", ["not-a-number", "-1", "0", "nan", "inf", ""])
def test_drift_threshold_env_invalid_falls_back_to_default(
    tmp_path: Path,
    reference_path: Path,
    train_frame: pd.DataFrame,
    monkeypatch: pytest.MonkeyPatch,
    raw: str,
) -> None:
    """Unparsable or non-positive values are ignored (default 0.2 used)."""
    monkeypatch.setenv(DRIFT_THRESHOLD_ENV_VAR, raw)
    log = _shifted_gr_liv_area_log(tmp_path, train_frame)
    report = run_drift_check(
        log_path=log,
        reference_path=reference_path,
        prediction_reference_path=tmp_path / "absent.json",
        output_path=tmp_path / "latest.json",
    )
    assert report["psi_threshold"] == PSI_DRIFT_THRESHOLD
    assert "GrLivArea" in report["drifted_features"]


# ---------------------------------------------------------------------------
# drift_check.py — CLI smoke (AUD-25 runpy warning)
# ---------------------------------------------------------------------------


def test_cli_no_runpy_warning_and_exit_zero_on_no_data(tmp_path: Path) -> None:
    """``python -m ml.monitoring.drift_check`` emits no runpy RuntimeWarning."""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "ml.monitoring.drift_check",
            "--log",
            str(tmp_path / "absent.jsonl"),
            "--output",
            str(tmp_path / "latest.json"),
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0
    assert "RuntimeWarning" not in result.stderr
    report = json.loads((tmp_path / "latest.json").read_text())
    assert report["status"] == "no_data"
