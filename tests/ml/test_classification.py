"""Unit tests for the classification training wave (SPEC §6/§7, ADR-3).

Covers the artifacts produced by ``ml/training/train_classification.py``:

- all eight model joblibs exist and load (raw + sigmoid-calibrated variants);
- calibrated ``predict_proba`` outputs stay in [0, 1] on a 5-row feature frame;
- ``models/classification/metrics.json`` is complete for every model
  (val + val_calibrated + best_params) with a calibrated Brier < 0.25 sanity
  bound and confusion matrices accounting for the whole val split;
- smoke re-fit: LogisticRegression trains on ``train.head(200)`` through
  ``ml.training.common.build_preprocessor`` exactly as the trainer does.

The classification target is SIMULATED (ADR-3) — these tests verify pipeline
correctness, not real-world performance.
"""
from __future__ import annotations

import json

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from ml.features.pipeline import build_feature_frame
from ml.features.stats import load_neighborhood_stats
from ml.paths import FEATURE_LIST_PATH, FIGURES_DIR, MODELS_DIR, PROCESSED_DIR, RANDOM_SEED
from ml.training.common import build_preprocessor

MODEL_DIR = MODELS_DIR / "classification"
METRICS_PATH = MODEL_DIR / "metrics.json"
MODEL_NAMES = ("logistic", "decision_tree", "random_forest", "xgboost")
METRIC_KEYS = {
    "roc_auc",
    "pr_auc",
    "precision",
    "recall",
    "f1",
    "brier",
    "threshold",
    "confusion_matrix",
}
VAL_ROWS = 338  # SPEC §14 processed split sizes


@pytest.fixture(scope="module")
def feature_list() -> list[str]:
    """Feature names from the shared artifact read by the trainer."""
    return list(json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))["features"])


@pytest.fixture(scope="module")
def val_frame(feature_list) -> pd.DataFrame:
    """5-row val feature frame built through the same path as training."""
    val = pd.read_csv(PROCESSED_DIR / "val.csv", keep_default_na=False)
    stats = load_neighborhood_stats()
    return build_feature_frame(val.head(5), stats)[feature_list]


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------


def test_model_artifacts_exist_and_load():
    """All raw + calibrated joblibs exist, load, and expose predict_proba."""
    for name in MODEL_NAMES:
        for suffix in (f"{name}_v1.joblib", f"{name}_calibrated_v1.joblib"):
            path = MODEL_DIR / suffix
            assert path.exists(), f"missing artifact: {path}"
            model = joblib.load(path)
            assert hasattr(model, "predict_proba"), f"{suffix} has no predict_proba"


def test_figures_exist():
    """Both classification figures were rendered."""
    assert (FIGURES_DIR / "classification_calibration.png").stat().st_size > 0
    assert (FIGURES_DIR / "classification_curves.png").stat().st_size > 0


def test_calibrated_predict_proba_in_unit_interval(val_frame):
    """Calibrated probabilities are finite and within [0, 1] on 5 rows."""
    for name in MODEL_NAMES:
        model = joblib.load(MODEL_DIR / f"{name}_calibrated_v1.joblib")
        proba = model.predict_proba(val_frame)
        assert proba.shape == (5, 2)
        pos = proba[:, 1]
        assert np.all(np.isfinite(pos)), f"{name}: non-finite probabilities"
        assert np.all(pos >= 0.0) and np.all(pos <= 1.0), (
            f"{name}: probabilities outside [0, 1]: {pos}"
        )


# ---------------------------------------------------------------------------
# metrics.json
# ---------------------------------------------------------------------------


def test_metrics_json_complete():
    """metrics.json covers every model with val, val_calibrated, best_params."""
    payload = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    assert set(payload) == set(MODEL_NAMES)
    for name in MODEL_NAMES:
        entry = payload[name]
        assert set(entry) == {"val", "val_calibrated", "best_params"}
        assert isinstance(entry["best_params"], dict) and entry["best_params"]
        for variant in ("val", "val_calibrated"):
            metrics = entry[variant]
            assert METRIC_KEYS <= set(metrics), f"{name}.{variant} incomplete"
            for key in ("roc_auc", "pr_auc", "precision", "recall", "f1", "brier"):
                assert 0.0 <= metrics[key] <= 1.0, f"{name}.{variant}.{key} out of range"
            cm = metrics["confusion_matrix"]
            assert set(cm) == {"tn", "fp", "fn", "tp"}
            assert sum(cm.values()) == VAL_ROWS, (
                f"{name}.{variant} confusion matrix does not cover the val split"
            )


def test_metrics_json_calibrated_brier_sanity():
    """Calibrated Brier scores beat the 0.25 coin-flip bound (val prevalence ~0.29)."""
    payload = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    for name in MODEL_NAMES:
        brier = payload[name]["val_calibrated"]["brier"]
        assert brier < 0.25, f"{name}: calibrated brier {brier} >= 0.25"


def test_metrics_json_calibration_does_not_hurt_brier():
    """Sigmoid calibration should not increase the Brier score on val."""
    payload = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    for name in MODEL_NAMES:
        raw = payload[name]["val"]["brier"]
        cal = payload[name]["val_calibrated"]["brier"]
        assert cal <= raw + 0.02, (
            f"{name}: calibrated brier {cal} much worse than raw {raw}"
        )


# ---------------------------------------------------------------------------
# Smoke re-fit
# ---------------------------------------------------------------------------


def test_smoke_refit_logistic_through_preprocessor(feature_list):
    """LogisticRegression fits on train.head(200) via build_preprocessor."""
    train = pd.read_csv(PROCESSED_DIR / "train.csv", keep_default_na=False).head(200)
    stats = load_neighborhood_stats()
    X = build_feature_frame(train, stats)[feature_list]
    y = train["sells_within_30_days"].astype(int).to_numpy()

    pipe = Pipeline(
        steps=[
            ("preprocess", build_preprocessor(X)),
            (
                "model",
                LogisticRegression(
                    max_iter=2000, class_weight="balanced", random_state=RANDOM_SEED
                ),
            ),
        ]
    )
    pipe.fit(X, y)
    proba = pipe.predict_proba(X.head(5))[:, 1]
    assert proba.shape == (5,)
    assert np.all(proba >= 0.0) and np.all(proba <= 1.0)
