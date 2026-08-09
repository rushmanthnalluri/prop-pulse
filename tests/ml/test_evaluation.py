"""Unit tests for the evaluation wave artifacts and selection logic (SPEC §11).

Covers ``ml/evaluation/select.py`` (ranking, bootstrap, threshold) and the
persisted outputs of ``python -m ml.evaluation.evaluate``:
``models/champion.json``, ``models/registry/*.joblib``,
``models/monitoring/prediction_reference.json`` and
``reports/MODEL_EVALUATION.md``.
"""
from __future__ import annotations

import contextlib
import json
import math
import types
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler

import ml.clustering.train as clustering_train
import ml.evaluation.evaluate as evaluate_mod
from ml.evaluation import select
from ml.evaluation.evaluate import (
    CLASSIFICATION_CHAMPION_PATH,
    PREDICTION_REFERENCE_PATH,
    REGRESSION_CHAMPION_PATH,
    REPORT_PATH,
    load_eval_frame,
)
from ml.paths import CHAMPION_PATH, MODELS_DIR

_REG_METRICS_PATH = MODELS_DIR / "regression" / "metrics.json"
_CLS_METRICS_PATH = MODELS_DIR / "classification" / "metrics.json"

_REG_METRIC_KEYS = {"mae", "rmse", "r2", "rmsle"}
_CLS_METRIC_KEYS = {
    "roc_auc",
    "pr_auc",
    "precision",
    "recall",
    "f1",
    "brier",
    "threshold",
    "confusion_matrix",
}


@pytest.fixture(scope="module")
def champion() -> dict:
    """The persisted models/champion.json payload."""
    assert CHAMPION_PATH.exists(), f"missing {CHAMPION_PATH} — run ml.evaluation.evaluate first"
    return json.loads(CHAMPION_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def registry_models() -> tuple:
    """The two registry champion joblibs, loaded once for the module."""
    reg = joblib.load(REGRESSION_CHAMPION_PATH)
    cls = joblib.load(CLASSIFICATION_CHAMPION_PATH)
    return reg, cls


# ---------------------------------------------------------------------------
# select.py — pure selection logic on synthetic inputs
# ---------------------------------------------------------------------------


def test_rank_regression_candidates_orders_by_rmsle() -> None:
    """RMSLE is primary; RMSE breaks exact RMSLE ties."""
    metrics = {
        "a": {"val": {"rmsle": 0.14, "rmse": 100.0, "r2": 0.9}},
        "b": {"val": {"rmsle": 0.13, "rmse": 200.0, "r2": 0.8}},
        "c": {"val": {"rmsle": 0.14, "rmse": 50.0, "r2": 0.95}},
    }
    assert select.rank_regression_candidates(metrics) == ["b", "c", "a"]
    choice = select.select_regression_champion(metrics)
    assert choice.champion == "b" and choice.runner_up == "c"


def test_select_classification_champion_calibrated_pr_auc() -> None:
    """Only calibrated variants participate; PR-AUC primary, Brier sanity."""
    metrics = {
        "raw_only": {"val": {"pr_auc": 0.99}},
        "m1": {"val": {}, "val_calibrated": {"pr_auc": 0.50, "brier": 0.19}},
        "m2": {"val": {}, "val_calibrated": {"pr_auc": 0.52, "brier": 0.18}},
    }
    choice = select.select_classification_champion(metrics)
    assert choice.champion == "m2"
    assert choice.brier_sane and choice.brier_gap_to_best == pytest.approx(0.0)
    assert "raw_only" not in choice.ranking


def test_pick_f1_threshold_synthetic() -> None:
    """On separable toy data the threshold lands in (0,1) with perfect F1."""
    y = np.array([0] * 50 + [1] * 50)
    proba = np.concatenate(
        [np.linspace(0.01, 0.4, 50), np.linspace(0.6, 0.99, 50)]
    )
    choice = select.pick_f1_threshold(y, proba)
    assert 0.0 < choice.threshold < 1.0
    assert choice.f1 == pytest.approx(1.0)
    assert choice.precision == pytest.approx(1.0)
    assert choice.recall == pytest.approx(1.0)


def test_paired_bootstrap_reproducible_and_signed() -> None:
    """Same seed → same CI; a clearly better model yields a negative diff."""
    rng = np.random.default_rng(0)
    y = np.full(200, 12.0)
    pred_good = y + rng.normal(0.0, 0.05, 200)
    pred_bad = y + rng.normal(0.0, 0.30, 200)
    res1 = select.paired_bootstrap_rmsle_diff(y, pred_good, pred_bad, "good", "bad")
    res2 = select.paired_bootstrap_rmsle_diff(y, pred_good, pred_bad, "good", "bad")
    assert res1.ci_low == pytest.approx(res2.ci_low)
    assert res1.observed_diff < 0.0
    assert res1.ci_high < 0.0 and res1.significant
    assert res1.n_resamples == 2000 and res1.seed == 42


# ---------------------------------------------------------------------------
# champion.json — SPEC §6 schema
# ---------------------------------------------------------------------------


def test_champion_json_schema(champion: dict) -> None:
    """Top-level keys, types, nested metric blocks per SPEC §6."""
    assert set(champion) >= {
        "regression",
        "classification",
        "clustering",
        "selected_at",
        "dataset_version",
        "feature_version",
        "rationale",
    }
    assert champion["dataset_version"] == "ames-1.0"
    assert isinstance(champion["feature_version"], str)
    assert len(champion["feature_version"]) == 12
    int(champion["feature_version"], 16)  # hex
    datetime.fromisoformat(champion["selected_at"])  # parses as ISO8601
    assert isinstance(champion["rationale"], str) and len(champion["rationale"]) > 50

    reg = champion["regression"]
    assert {"name", "version", "path", "val_metrics", "test_metrics"} <= set(reg)
    assert reg["version"] == "v1" and isinstance(reg["name"], str)
    assert _REG_METRIC_KEYS <= set(reg["val_metrics"])
    assert _REG_METRIC_KEYS <= set(reg["test_metrics"])
    interval = reg["residual_interval"]
    assert interval["q_low"] < 0.0 < interval["q_high"]

    cls = champion["classification"]
    assert {"name", "version", "path", "calibrated", "val_metrics", "test_metrics"} <= set(cls)
    assert cls["calibrated"] is True
    assert _CLS_METRIC_KEYS <= set(cls["val_metrics"])
    assert _CLS_METRIC_KEYS <= set(cls["test_metrics"])

    clustering = champion["clustering"]
    assert clustering["path"] == "models/clustering/dbscan.joblib"
    assert isinstance(clustering["n_clusters"], int) and clustering["n_clusters"] >= 1


def test_champion_json_paths_and_threshold(champion: dict) -> None:
    """Artifact paths exist on disk; classification threshold in (0,1)."""
    root = CHAMPION_PATH.parent.parent
    for section in ("regression", "classification"):
        path = champion[section]["path"]
        assert not Path(path).is_absolute()
        assert (root / path).exists(), f"missing {path}"
    threshold = champion["classification"]["threshold"]
    assert isinstance(threshold, float)
    assert 0.0 < threshold < 1.0


def test_champion_matches_val_metrics(champion: dict) -> None:
    """Champions equal the val-metric argmin/argmax — selection was val-based."""
    reg_metrics = json.loads(_REG_METRICS_PATH.read_text(encoding="utf-8"))
    best_reg = min(reg_metrics, key=lambda n: reg_metrics[n]["val"]["rmsle"])
    assert champion["regression"]["name"] == best_reg

    cls_metrics = json.loads(_CLS_METRICS_PATH.read_text(encoding="utf-8"))
    best_cls = max(
        cls_metrics, key=lambda n: cls_metrics[n]["val_calibrated"]["pr_auc"]
    )
    assert champion["classification"]["name"] == best_cls


def test_bootstrap_block(champion: dict) -> None:
    """Bootstrap record: 2000 resamples, seed 42, ordered CI, champion ≤ runner-up."""
    boot = champion["regression"]["bootstrap_vs_runner_up"]
    assert boot["n_resamples"] == 2000 and boot["seed"] == 42
    assert boot["ci95"][0] <= boot["observed_rmsle_diff"] <= boot["ci95"][1]
    # Champion is never worse than the runner-up on val RMSLE.
    assert boot["observed_rmsle_diff"] <= 0.0
    assert 0.0 <= boot["prob_runner_up_better"] <= 1.0


def test_no_absolute_paths_leak(champion: dict) -> None:
    """champion.json must not leak absolute paths (SPEC §12)."""
    blob = json.dumps(champion)
    assert "C:\\" not in blob and str(MODELS_DIR) not in blob


# ---------------------------------------------------------------------------
# Registry artifacts — load + predict
# ---------------------------------------------------------------------------


def test_registry_models_load_and_predict(registry_models: tuple) -> None:
    """Both champions predict on a 5-row feature frame with sane outputs."""
    reg_model, cls_model = registry_models
    X_val, _ = load_eval_frame("val")
    sample = X_val.head(5)

    pred_log = np.asarray(reg_model.predict(sample), dtype=float)
    assert pred_log.shape == (5,) and np.all(np.isfinite(pred_log))
    # log1p(SalePrice) space: sane predictions sit roughly in [8, 16].
    assert np.all((pred_log > 8.0) & (pred_log < 16.0))

    proba = np.asarray(cls_model.predict_proba(sample), dtype=float)
    assert proba.shape == (5, 2)
    assert np.all((proba >= 0.0) & (proba <= 1.0))
    assert np.allclose(proba.sum(axis=1), 1.0)


def test_threshold_recomputed_on_val_matches(
    champion: dict, registry_models: tuple
) -> None:
    """The stored threshold reproduces from the registry champion on val."""
    _, cls_model = registry_models
    X_val, raw_val = load_eval_frame("val")
    y_val = raw_val["sells_within_30_days"].astype(int).to_numpy()
    proba = np.asarray(cls_model.predict_proba(X_val)[:, 1], dtype=float)
    recomputed = select.pick_f1_threshold(y_val, proba)
    assert champion["classification"]["threshold"] == pytest.approx(
        recomputed.threshold, abs=1e-6
    )
    # Val precision/recall at the operating threshold are the stored ones.
    val_metrics = champion["classification"]["val_metrics"]
    assert val_metrics["f1"] == pytest.approx(recomputed.f1, abs=1e-6)
    assert val_metrics["precision"] == pytest.approx(recomputed.precision, abs=1e-6)
    assert val_metrics["recall"] == pytest.approx(recomputed.recall, abs=1e-6)


# ---------------------------------------------------------------------------
# Sealed-test metrics sanity (per assignment bars)
# ---------------------------------------------------------------------------


def test_test_metrics_present_and_sane(champion: dict) -> None:
    """Champion test metrics exist and clear the regression bars (AUD-12).

    Bars are pinned just inside the current champion metrics (R² 0.9305,
    RMSLE 0.1187, ROC-AUC 0.7666, Brier 0.1710): tight enough to catch a real
    quality regression, loose enough for ulp-level numerical jitter.
    """
    reg = champion["regression"]["test_metrics"]
    for key in _REG_METRIC_KEYS:
        assert math.isfinite(reg[key]), f"regression test {key} not finite"
    assert reg["r2"] >= 0.90, f"regression test R² {reg['r2']} below 0.90"
    assert 0.0 < reg["rmsle"] <= 0.13, f"regression test RMSLE {reg['rmsle']} above 0.13"
    assert reg["mae"] > 0.0

    cls = champion["classification"]["test_metrics"]
    for key in _CLS_METRIC_KEYS - {"confusion_matrix"}:
        assert math.isfinite(cls[key]), f"classification test {key} not finite"
    assert cls["roc_auc"] >= 0.72, f"classification test ROC-AUC {cls['roc_auc']} below 0.72"
    assert 0.0 <= cls["pr_auc"] <= 1.0
    assert 0.0 <= cls["f1"] <= 1.0
    assert 0.0 <= cls["brier"] <= 0.19, f"classification test Brier {cls['brier']} above 0.19"
    cm = cls["confusion_matrix"]
    assert set(cm) == {"tn", "fp", "fn", "tp"}
    assert sum(cm.values()) == 175  # sealed test split size


# ---------------------------------------------------------------------------
# prediction_reference.json + report
# ---------------------------------------------------------------------------


def test_prediction_reference_structure(champion: dict) -> None:
    """Decile bins: increasing edges, proportions in [0,1] summing to 1."""
    assert PREDICTION_REFERENCE_PATH.exists()
    ref = json.loads(PREDICTION_REFERENCE_PATH.read_text(encoding="utf-8"))
    assert ref["n_rows"] == 338  # validation split size
    for section, lo, hi in (("regression", 1e3, 1e7), ("classification", 0.0, 1.0)):
        block = ref[section]
        edges = block["bin_edges"]
        proportions = block["bin_proportions"]
        assert len(edges) == len(proportions) + 1
        assert all(b > a for a, b in zip(edges, edges[1:])), "edges not increasing"
        assert all(lo <= e <= hi for e in edges)
        assert all(0.0 <= p <= 1.0 for p in proportions)
        assert sum(proportions) == pytest.approx(1.0)
    assert ref["classification"]["threshold"] == pytest.approx(
        champion["classification"]["threshold"], abs=1e-6  # champion.json rounds to 6dp
    )


def test_report_exists_with_key_sections() -> None:
    """reports/MODEL_EVALUATION.md exists and carries the mandated sections."""
    assert REPORT_PATH.exists()
    text = REPORT_PATH.read_text(encoding="utf-8")
    for marker in (
        "Methodology",
        "SIMULATED",
        "FINAL REPORT ONLY",
        "paired",
        "Price-interval",
        "Champion rationale",
        "threshold",
    ):
        assert marker.lower() in text.lower(), f"report missing section: {marker}"


# ---------------------------------------------------------------------------
# AUD-26a — clustering/evaluation MLflow runs log fitted model artifacts
# ---------------------------------------------------------------------------


class _FakeMlflow:
    """Minimal stand-in for the mlflow module inside a tracked run."""

    def __init__(self) -> None:
        self.metrics: list[dict] = []

    def log_metrics(self, metrics: dict) -> None:
        self.metrics.append(metrics)


@contextlib.contextmanager
def _fake_track_run(*args, **kwargs):
    """Yield a fake (mlflow, run) pair without touching the MLflow store."""
    yield _FakeMlflow(), types.SimpleNamespace()


def test_clustering_mlflow_run_logs_model_artifacts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AUD-26a: the clustering run logs the fitted DBSCAN + scaler (SPEC §7)."""
    logged_models: list[tuple[str, object]] = []
    monkeypatch.setattr(clustering_train, "track_run", _fake_track_run)
    monkeypatch.setattr(clustering_train, "log_dict_artifact", lambda payload, filename: None)
    monkeypatch.setattr(
        clustering_train,
        "log_model_artifact",
        lambda model, artifact_name="model": logged_models.append((artifact_name, model)),
    )

    X = np.array(
        [[0.0, 0.0], [0.1, 0.0], [0.0, 0.1], [5.0, 5.0], [5.1, 5.0], [5.0, 5.1]]
    )
    scaler = StandardScaler().fit(X)
    model = DBSCAN(eps=0.6, min_samples=2).fit(scaler.transform(X))
    result = clustering_train.ClusteringResult(
        eps=0.6,
        min_samples=2,
        n_clusters=2,
        n_noise=0,
        noise_neighborhoods=[],
        labels=model.labels_,
        cluster_stats={"0": {}, "1": {}},
        assignments=pd.DataFrame({"Neighborhood": [], "cluster_id": []}),
        frame=pd.DataFrame(),
        trace=[],
        selection_rationale="synthetic test double",
    )

    clustering_train._log_mlflow_run(result, (1.0, 2.0), model=model, scaler=scaler)

    assert [name for name, _ in logged_models] == ["model", "scaler"]
    assert logged_models[0][1] is model
    assert logged_models[1][1] is scaler


def test_evaluation_mlflow_run_logs_champion_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AUD-26a: the evaluation run logs both fitted champions (SPEC §7)."""
    logged_models: list[tuple[str, object]] = []
    monkeypatch.setattr(evaluate_mod, "track_run", _fake_track_run)
    monkeypatch.setattr(evaluate_mod, "log_dict_artifact", lambda payload, filename: None)
    monkeypatch.setattr(
        evaluate_mod,
        "log_model_artifact",
        lambda model, artifact_name="model": logged_models.append((artifact_name, model)),
    )

    regression = types.SimpleNamespace(champion="ridge", runner_up="xgboost")
    classification = types.SimpleNamespace(champion="random_forest")
    threshold = types.SimpleNamespace(threshold=0.203292)
    bootstrap = types.SimpleNamespace(
        n_resamples=2000,
        seed=42,
        observed_diff=-0.004341,
        ci_low=-0.013336,
        ci_high=0.005985,
        prob_runner_up_better=0.1925,
    )
    reg_model, cls_model = object(), object()

    evaluate_mod.log_mlflow_run(
        regression=regression,
        classification=classification,
        threshold=threshold,
        bootstrap=bootstrap,
        reg_val_metrics={"rmsle": 0.135437},
        reg_test_metrics={"mae": 15075.47, "rmse": 21151.54, "r2": 0.93048, "rmsle": 0.118689},
        cls_val_metrics={"pr_auc": 0.525013, "brier": 0.18555},
        cls_test_metrics={
            "roc_auc": 0.766602,
            "pr_auc": 0.567363,
            "f1": 0.506329,
            "precision": 0.366972,
            "recall": 0.816327,
            "brier": 0.171026,
        },
        test_interval_coverage=0.782857,
        feature_ver="9b0f8ba4201c",
        champion_payload={"regression": {"name": "ridge"}},
        regression_model=reg_model,
        classification_model=cls_model,
    )

    assert [name for name, _ in logged_models] == [
        "regression_champion",
        "classification_champion",
    ]
    assert logged_models[0][1] is reg_model
    assert logged_models[1][1] is cls_model
