"""clustering package — DBSCAN micro-market discovery over Ames neighborhoods (ADR-9).

Exports are resolved lazily (PEP 562) so importing the package stays cheap and
``python -m ml.clustering.train`` does not import the training module twice.
"""
from __future__ import annotations

from typing import Any

__all__ = [
    "FEATURE_COLUMNS",
    "MicroMarketLookup",
    "build_neighborhood_matrix",
    "train",
]


def __getattr__(name: str) -> Any:
    if name in {"FEATURE_COLUMNS", "build_neighborhood_matrix"}:
        from ml.clustering import dataset

        return getattr(dataset, name)
    if name == "MicroMarketLookup":
        from ml.clustering.serve import MicroMarketLookup

        return MicroMarketLookup
    if name == "train":
        from ml.clustering.train import train

        return train
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
