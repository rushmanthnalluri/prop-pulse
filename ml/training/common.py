"""Shared training utilities for PropPulse model trainers.

Contract-level helpers used by both regression and classification training so the
two never diverge on preprocessing or metric definitions.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml.paths import PROCESSED_DIR


def load_split(name: str) -> pd.DataFrame:
    """Load a processed split ('train' | 'val' | 'test').

    Uses keep_default_na=False: processed CSVs encode absent features as the
    literal string "None" (see docs/PROJECT_SPEC.md §14).
    """
    path = PROCESSED_DIR / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Processed split not found: {path}. Run `python -m ml.data.pipeline` first.")
    return pd.read_csv(path, keep_default_na=False)


def build_preprocessor(X: pd.DataFrame) -> ColumnTransformer:
    """Impute + scale numerics, impute + one-hot categoricals (dense output).

    Scaling numerics is harmless for tree models and required for linear ones,
    so a single preprocessing graph is shared by every model family.
    """
    numeric_cols = [c for c in X.columns if pd.api.types.is_numeric_dtype(X[c])]
    categorical_cols = [c for c in X.columns if c not in numeric_cols]
    numeric_pipe = Pipeline(
        steps=[("imputer", SimpleImputer(strategy="median")), ("scaler", StandardScaler())]
    )
    categorical_pipe = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipe, numeric_cols),
            ("cat", categorical_pipe, categorical_cols),
        ],
        sparse_threshold=0.0,  # force dense output — dataset is small
    )


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    """Dollar-scale regression metrics (pass expm1'd values, not logs)."""
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    resid = y_true - y_pred
    mae = float(np.mean(np.abs(resid)))
    rmse = float(np.sqrt(np.mean(resid**2)))
    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y_true - np.mean(y_true)) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    rmsle = float(np.sqrt(np.mean((np.log1p(np.clip(y_pred, 0, None)) - np.log1p(y_true)) ** 2)))
    return {"mae": mae, "rmse": rmse, "r2": r2, "rmsle": rmsle}


def residual_interval(y_true_log: np.ndarray, y_pred_log: np.ndarray, q_low: float = 0.1, q_high: float = 0.9) -> dict[str, float]:
    """Log-space residual quantiles → additive prediction interval for serving.

    Serving applies [pred_log + q_low, pred_log + q_high] then expm1 — an ~80%
    empirical interval computed on validation residuals.
    """
    resid = np.asarray(y_true_log, dtype=float) - np.asarray(y_pred_log, dtype=float)
    return {"q_low": float(np.quantile(resid, q_low)), "q_high": float(np.quantile(resid, q_high))}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    """Write pretty JSON, creating parent dirs."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str))
