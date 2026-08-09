"""Unit tests for the regression training artifacts and pipeline (SPEC §11).

Covers the persisted artifacts under ``models/regression/`` produced by
``python -m ml.training.train_regression`` plus a fast smoke re-train of the
LinearRegression candidate on a 200-row train head.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import numpy as np
import pytest
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import Pipeline

from ml.paths import MODELS_DIR
from ml.training.train_regression import (
    METRICS_PATH,
    REGRESSION_DIR,
    load_model_frame,
    make_pipeline,
)

MODEL_NAMES = ["linear", "ridge", "lasso", "random_forest", "xgboost"]
EXPECTED_METRIC_KEYS = {"mae", "rmse", "r2", "rmsle", "rmse_log", "residual_interval"}


@pytest.fixture(scope="module")
def metrics_payload() -> dict:
    """The persisted models/regression/metrics.json payload."""
    assert METRICS_PATH.exists(), f"missing {METRICS_PATH} — run train_regression first"
    return json.loads(METRICS_PATH.read_text())


def test_artifacts_exist() -> None:
    """All five v1 joblib artifacts plus metrics.json exist."""
    for name in MODEL_NAMES:
        path = REGRESSION_DIR / f"{name}_v1.joblib"
        assert path.exists(), f"missing artifact {path}"
        assert path.stat().st_size > 0
    assert METRICS_PATH.exists()


def test_loaded_pipelines_predict_right_shape() -> None:
    """Each loaded pipeline predicts a 5-element vector on a 5-row feature frame."""
    X_val, _, _ = load_model_frame("val")
    sample = X_val.head(5)
    for name in MODEL_NAMES:
        pipeline = joblib.load(REGRESSION_DIR / f"{name}_v1.joblib")
        assert isinstance(pipeline, Pipeline)
        preds = pipeline.predict(sample)
        assert preds.shape == (5,), f"{name} predicted shape {preds.shape}"
        assert np.all(np.isfinite(preds)), f"{name} produced non-finite predictions"
        # log1p(SalePrice) space: sane predictions sit roughly in [9, 15].
        assert np.all((preds > 8.0) & (preds < 16.0)), f"{name} predictions out of range"


def test_metrics_json_structure(metrics_payload: dict) -> None:
    """metrics.json has all five models with finite metrics incl. rmsle."""
    assert set(metrics_payload) == set(MODEL_NAMES)
    for name, entry in metrics_payload.items():
        val = entry["val"]
        assert EXPECTED_METRIC_KEYS.issubset(val), f"{name} missing metric keys"
        for key in ("mae", "rmse", "r2", "rmsle", "rmse_log"):
            assert math.isfinite(val[key]), f"{name} val.{key} not finite"
        interval = val["residual_interval"]
        assert interval["q_low"] < 0.0 < interval["q_high"]
        assert "best_params" in entry
        if name != "linear":
            assert math.isfinite(entry["cv_best_score"])


def test_smoke_linear_retrain_roundtrip() -> None:
    """LinearRegression re-fits on train head(200) through build_preprocessor."""
    X_train, y_train_log, _ = load_model_frame("train")
    X_small, y_small = X_train.head(200), y_train_log.head(200)
    pipeline = make_pipeline(X_small, LinearRegression())
    pipeline.fit(X_small, y_small)
    preds = pipeline.predict(X_small.head(5))
    assert preds.shape == (5,)
    assert np.all(np.isfinite(preds))


def test_no_absolute_paths_in_metrics(metrics_payload: dict) -> None:
    """The metrics payload must not leak absolute paths (SPEC §12)."""
    assert str(MODELS_DIR) not in json.dumps(metrics_payload)
    assert "C:\\" not in json.dumps(metrics_payload)
