"""Lightweight allowlist for workflow objectives and model candidates.

This module deliberately imports no pandas, NumPy, scikit-learn, or XGBoost.
The API needs these names to validate a training request, but must not import
the full training stack in the request-serving process just to inspect them.
"""
from __future__ import annotations

REGRESSION_CANDIDATES: tuple[str, ...] = (
    "linear",
    "ridge",
    "lasso",
    "random_forest",
    "xgboost",
)
CLASSIFICATION_CANDIDATES: tuple[str, ...] = (
    "logistic",
    "decision_tree",
    "random_forest",
    "xgboost",
)
CLUSTERING_CANDIDATES: tuple[str, ...] = ("dbscan",)

OBJECTIVE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "regression": REGRESSION_CANDIDATES,
    "classification": CLASSIFICATION_CANDIDATES,
    "clustering": CLUSTERING_CANDIDATES,
}
