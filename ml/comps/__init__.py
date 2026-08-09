"""comps package — comparable-sales artifact built from the TRAIN split.

Exports are resolved lazily (PEP 562) so importing the package stays cheap and
``python -m ml.comps.build`` does not import the build module twice.
"""
from __future__ import annotations

from typing import Any

__all__ = ["COMPS_PATH", "SIMILARITY_FEATURES", "build_comps_artifact"]


def __getattr__(name: str) -> Any:
    if name in {"COMPS_PATH", "SIMILARITY_FEATURES", "build_comps_artifact"}:
        from ml.comps import build

        return getattr(build, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
