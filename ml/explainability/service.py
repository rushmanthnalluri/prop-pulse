"""Backend-facing instance explanation contract (SPEC §8 ``top_price_factors``).

``explain_instance`` is the **only** entry point the backend calls::

    from ml.explainability.service import explain_instance

    factors = explain_instance(feature_row, top_n=5)
    # -> [{"feature": "OverallQual", "impact": "positive", "magnitude": 0.31}, ...]

``feature_row`` is a single-row :class:`pandas.DataFrame` in ``MODEL_FEATURES``
order — i.e. the output of
``build_feature_frame(pd.DataFrame([serving_payload_to_raw(payload)]))``.

Each returned dict has exactly the keys:

- ``feature``: base ``MODEL_FEATURES`` name (one-hot dummies are aggregated —
  ``"Neighborhood"``, never ``"Neighborhood_NridgHt"``);
- ``impact``: ``"positive"`` if the feature pushes the predicted
  ``log1p(SalePrice)`` up, ``"negative"`` otherwise;
- ``magnitude``: ``|shap| / sum(|shap| over ALL base features)`` — a 0–1 share,
  so the returned shares always sum to ≤ 1.

The explainer is a process-wide lazy singleton built on first call (model load
+ train background build, a few seconds once); warm calls measure ~22–30 ms
(p50) for the linear champion (docs/audit/performance.md), well under the
300 ms budget. If the
champion is ever swapped for a tree ensemble, the underlying
:class:`~ml.explainability.explainer.RegressionExplainer` switches to
``shap.TreeExplainer`` automatically. Missing artifacts raise ``RuntimeError``
with an actionable message (surfaced by the backend as a 500).
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import pandas as pd

from ml.explainability.explainer import (
    REGRESSION_CHAMPION_PATH,
    RegressionExplainer,
)

logger = logging.getLogger(__name__)

__all__ = ["explain_instance"]

_explainer: RegressionExplainer | None = None
_explainer_lock = threading.Lock()


def _get_explainer() -> RegressionExplainer:
    """Return the process-wide explainer, building it lazily on first call."""
    global _explainer
    if _explainer is None:
        with _explainer_lock:
            if _explainer is None:  # double-checked locking
                _explainer = RegressionExplainer(REGRESSION_CHAMPION_PATH)
    return _explainer


def explain_instance(
    feature_row: pd.DataFrame,
    top_n: int = 5,
    model_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Explain one property's price prediction as its top SHAP factors.

    Args:
        feature_row: Single-row frame in ``MODEL_FEATURES`` order (output of
            ``ml.features.pipeline.build_feature_frame``).
        top_n: Number of factors to return (highest ``|shap|`` first).
        model_path: Test hook — build a one-off explainer for this champion
            artifact instead of the cached production singleton.

    Returns:
        ``top_n`` dicts ``{"feature", "impact", "magnitude"}`` sorted by
        descending magnitude; see the module docstring for the exact contract.

    Raises:
        ValueError: If ``feature_row`` is not a single-row frame with all
            ``MODEL_FEATURES`` columns, or ``top_n`` < 1.
        RuntimeError: If champion/feature artifacts are missing or unsupported.
    """
    if top_n < 1:
        raise ValueError(f"top_n must be >= 1, got {top_n}")
    if not isinstance(feature_row, pd.DataFrame) or len(feature_row) != 1:
        raise ValueError(
            "feature_row must be a single-row pandas DataFrame in MODEL_FEATURES "
            f"order; got {type(feature_row).__name__} with "
            f"{len(feature_row) if isinstance(feature_row, pd.DataFrame) else 'n/a'} rows"
        )

    explainer = (
        RegressionExplainer(model_path) if model_path is not None else _get_explainer()
    )
    contributions = explainer.explain_one(feature_row)  # {base feature: shap}

    total_abs = float(sum(abs(v) for v in contributions.values()))
    if total_abs <= 0.0:  # degenerate all-zero explanation — keep contract finite
        logger.warning("all-zero SHAP explanation; returning zero magnitudes")
        total_abs = 1.0

    ranked = sorted(
        contributions.items(), key=lambda item: (-abs(item[1]), item[0])
    )[:top_n]
    return [
        {
            "feature": feature,
            "impact": "positive" if value >= 0.0 else "negative",
            "magnitude": round(abs(value) / total_abs, 6),
        }
        for feature, value in ranked
    ]
