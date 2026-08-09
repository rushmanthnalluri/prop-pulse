"""Sandbox evaluation tests (§3.10, §8 WF-B2 matrix).

Self-contained (no conftest in this directory — ownership boundary). The
module fixture trains a real tiny wave (regression ``linear`` + ``ridge``,
classification ``logistic``, clustering ``dbscan``) on a 240-row Ames-schema
upload inside ``tmp_path``; every payload number below is derived from the
persisted ``val_predictions.csv`` arrays.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pandas as pd
import pytest

from ml.data.ingest import RAW_TRAIN_CSV
from ml.workflow import datasets
from ml.workflow.datasets import save_upload, sandbox_dir
from ml.workflow.evaluate import (
    CURVE_MAX_POINTS,
    UnknownCandidateArtifactError,
    _thin_points,
    evaluation_payload,
    paired_bootstrap_payload,
)
from ml.workflow.prepare import PrepareConfig, prepare_dataset
from ml.workflow.train import train_objective

_UPLOAD_ROWS = 240


@pytest.fixture(scope="module")
def trained(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    tmp = tmp_path_factory.mktemp("wf_eval")
    monkey = pytest.MonkeyPatch()
    monkey.setattr(datasets, "UPLOADS_ROOT", tmp / "uploads")
    monkey.setattr(datasets, "WORKFLOW_MODELS_ROOT", tmp / "workflow_models")

    data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode()
    dataset_id = save_upload(data, "slice.csv").dataset_id
    prepare_dataset(dataset_id, PrepareConfig())
    job_dir = sandbox_dir(dataset_id) / "jobs" / "job_00000001"
    train_objective(dataset_id, job_dir, "regression", ["linear", "ridge"])
    train_objective(dataset_id, job_dir, "classification", ["logistic"])
    train_objective(dataset_id, job_dir, "clustering", ["dbscan"])

    ns = SimpleNamespace(tmp=tmp, dataset_id=dataset_id, job_dir=job_dir)
    yield ns
    monkey.undo()


def _keys(obj: Any) -> set[str]:
    """Every dict key in a nested payload (for omission greps, §7)."""
    found: set[str] = set()
    if isinstance(obj, dict):
        for key, value in obj.items():
            found.add(str(key))
            found |= _keys(value)
    elif isinstance(obj, list):
        for value in obj:
            found |= _keys(value)
    return found


# ---------------------------------------------------------------------------
# Curve thinning (§3.10: <= 80 points, endpoints kept)
# ---------------------------------------------------------------------------

class TestThinning:
    def test_short_curve_untouched(self) -> None:
        points = [{"x": i} for i in range(10)]
        assert _thin_points(points) == points

    def test_long_curve_thinned_with_endpoints(self) -> None:
        points = [{"x": i} for i in range(500)]
        thinned = _thin_points(points)
        assert len(thinned) <= CURVE_MAX_POINTS
        assert thinned[0] == points[0]
        assert thinned[-1] == points[-1]
        xs = [p["x"] for p in thinned]
        assert xs == sorted(set(xs))  # strictly increasing, deduplicated


# ---------------------------------------------------------------------------
# Regression payload
# ---------------------------------------------------------------------------

class TestRegressionPayload:
    def test_metrics_match_stored_values(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "ridge")
        stored = json.loads(
            (trained.job_dir / "candidates" / "ridge" / "metrics.json").read_text()
        )
        assert payload["objective"] == "regression"
        assert payload["split"] == "val"
        assert payload["n"] == 36
        assert payload["metrics"]["rmsle"] == pytest.approx(
            stored["val_metrics"]["rmsle"]
        )
        assert payload["metrics"]["residual_interval"] == pytest.approx(
            stored["val_metrics"]["residual_interval"]
        )

    def test_actual_vs_predicted_matches_csv(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "ridge")
        points = payload["actual_vs_predicted"]
        assert 0 < len(points) <= 400
        preds = pd.read_csv(trained.job_dir / "candidates" / "ridge" / "val_predictions.csv")
        first_y, first_pred = points[0]
        row = preds.iloc[0]  # n=36 < 400 — no thinning, order preserved
        assert first_y == pytest.approx(row["y_true"])
        assert first_pred == pytest.approx(row["y_pred_dollar"])

    def test_residual_hist_sums_to_n(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "ridge")
        bins = payload["residual_hist"]["bins"]
        assert sum(b["count"] for b in bins) == payload["n"]
        assert all(b["x0"] < b["x1"] for b in bins)

    def test_importance_passthrough(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "linear")
        assert payload["importance"]
        assert {"feature", "weight"} == set(payload["importance"][0])

    def test_unknown_candidate(self, trained: SimpleNamespace) -> None:
        with pytest.raises(UnknownCandidateArtifactError):
            evaluation_payload(trained.job_dir, "catboost")


class TestPairedBootstrap:
    def test_payload_shape(self, trained: SimpleNamespace) -> None:
        champion = pd.read_csv(
            trained.job_dir / "candidates" / "ridge" / "val_predictions.csv"
        )
        runner_up = pd.read_csv(
            trained.job_dir / "candidates" / "linear" / "val_predictions.csv"
        )
        block = paired_bootstrap_payload(champion, runner_up, "ridge", "linear")
        assert set(block) == {
            "runner_up", "observed_rmsle_diff", "ci95",
            "prob_runner_up_better", "significant",
        }
        assert block["runner_up"] == "linear"
        assert block["ci95"][0] <= block["observed_rmsle_diff"] <= block["ci95"][1]
        assert 0.0 <= block["prob_runner_up_better"] <= 1.0
        assert isinstance(block["significant"], bool)

    def test_misaligned_ids_rejected(self, trained: SimpleNamespace) -> None:
        champion = pd.read_csv(
            trained.job_dir / "candidates" / "ridge" / "val_predictions.csv"
        )
        runner_up = champion.iloc[:-1]  # one Id short
        with pytest.raises(ValueError, match="same Ids"):
            paired_bootstrap_payload(champion, runner_up, "ridge", "linear")


# ---------------------------------------------------------------------------
# Classification payload (SIMULATED target — ADR-3)
# ---------------------------------------------------------------------------

class TestClassificationPayload:
    def test_curves_and_threshold(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "logistic")
        assert payload["objective"] == "classification"
        assert payload["split"] == "val"
        assert payload["n"] == 36
        assert payload["simulated_target"] is True
        for curve in ("roc", "pr", "calibration"):
            assert 2 <= len(payload[curve]) <= CURVE_MAX_POINTS, curve
        assert set(payload["roc"][0]) == {"fpr", "tpr"}
        assert set(payload["pr"][0]) == {"recall", "precision"}
        assert set(payload["calibration"][0]) == {"bin_mid", "frac_pos", "mean_pred"}

        threshold = payload["metrics_at_f1"]["threshold"]
        assert 0.0 < threshold < 1.0  # F1-optimal — never a defaulted 0.5
        assert payload["metrics_at_0_5"]["threshold"] == 0.5
        assert 0.0 < payload["positive_rate"] < 1.0

    def test_confusion_labels_0_1_and_sums_to_n(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "logistic")
        confusion = payload["metrics_at_f1"]["confusion_matrix"]
        assert set(confusion) == {"tn", "fp", "fn", "tp"}  # labels=[0, 1]
        assert sum(confusion.values()) == payload["n"] == 36

    def test_threshold_matches_train_time(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "logistic")
        stored = json.loads(
            (trained.job_dir / "candidates" / "logistic" / "metrics.json").read_text()
        )
        assert payload["metrics_at_f1"]["threshold"] == pytest.approx(
            stored["val_metrics"]["threshold"]
        )


# ---------------------------------------------------------------------------
# Clustering payload (no silhouette score exists — §7 omission)
# ---------------------------------------------------------------------------

class TestClusteringPayload:
    def test_shape_and_fallbacks(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "dbscan")
        assert payload["algorithm"] == "DBSCAN"
        assert payload["n_clusters"] >= 2
        assert payload["min_samples"] in (2, 3)
        assert payload["eps"] > 0
        assert payload["rationale"]
        assert len(payload["assignments"]) == 25
        for row in payload["assignments"]:
            assert set(row) == {"neighborhood", "name", "cluster_id", "fallback"}
            assert isinstance(row["fallback"], bool)
            if row["fallback"]:
                assert row["cluster_id"] >= 0  # resolved to nearest centroid
        assert payload["clusters"]
        assert {"cluster_id", "label", "n_sales", "median_price"} <= set(
            payload["clusters"][0]
        )

    def test_no_silhouette_anywhere(self, trained: SimpleNamespace) -> None:
        payload = evaluation_payload(trained.job_dir, "dbscan")
        assert not any("silhouette" in key for key in _keys(payload))
