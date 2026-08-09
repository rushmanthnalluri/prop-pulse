"""features package — single source of truth for model inputs (SPEC §5).

Exports are resolved lazily (PEP 562) so ``python -m ml.features.pipeline``
does not import the pipeline module twice.
"""
from __future__ import annotations

from typing import Any

__all__ = [
    "FEATURE_DEFAULTS",
    "MODEL_FEATURES",
    "RAW_INPUT_COLUMNS",
    "NeighborhoodStats",
    "build_feature_frame",
    "fit_neighborhood_stats",
    "load_neighborhood_stats",
]


def __getattr__(name: str) -> Any:
    if name in {"FEATURE_DEFAULTS", "MODEL_FEATURES", "RAW_INPUT_COLUMNS", "build_feature_frame"}:
        from ml.features import pipeline

        return getattr(pipeline, name)
    if name in {"NeighborhoodStats", "fit_neighborhood_stats", "load_neighborhood_stats"}:
        from ml.features import stats

        return getattr(stats, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
