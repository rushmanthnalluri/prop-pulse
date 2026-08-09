"""Build the monitoring reference distribution from the TRAIN split (SPEC §10).

Produces ``models/monitoring/reference_stats.json`` — the baseline every
drift check compares the live prediction window against:

- every **numeric** model feature: PSI quantile bin edges + expected
  (train) proportions per bin; heavy-tie features whose quantile bins
  collapse below two bins get fallback midpoint-cut bins and a
  ``"degenerate": true`` marker (fewer effective bins → reduced PSI
  sensitivity);
- key **categorical** model features (``Neighborhood``, ``HouseStyle``,
  ``MSZoning``, ``CentralAir``): category frequency proportions.

Everything is fit on the train split only (same leakage rules as training).
Regenerate after retraining or re-splitting::

    python -m ml.monitoring.reference
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from ml.features.pipeline import build_feature_frame
from ml.features.stats import fit_neighborhood_stats
from ml.monitoring.psi import (
    DEFAULT_N_BINS,
    bin_proportions,
    degenerate_binning,
    psi_bins_from_train,
)
from ml.paths import DATASET_VERSION, FEATURE_LIST_PATH, MODELS_DIR
from ml.tracking import feature_version
from ml.training.common import load_split, write_json

logger = logging.getLogger(__name__)

#: Directory for monitoring artifacts (models/monitoring/).
MONITORING_DIR = MODELS_DIR / "monitoring"
#: Drift reference built by this module.
REFERENCE_STATS_PATH = MONITORING_DIR / "reference_stats.json"
#: Prediction-distribution reference, produced by the training/evaluation
#: agent — drift_check reads it defensively if present.
PREDICTION_REFERENCE_PATH = MONITORING_DIR / "prediction_reference.json"

#: Key categorical model features whose train frequencies are tracked.
KEY_CATEGORICAL_FEATURES: tuple[str, ...] = (
    "Neighborhood",
    "HouseStyle",
    "MSZoning",
    "CentralAir",
)

__all__ = [
    "MONITORING_DIR",
    "REFERENCE_STATS_PATH",
    "PREDICTION_REFERENCE_PATH",
    "KEY_CATEGORICAL_FEATURES",
    "load_model_features",
    "build_reference_stats",
    "load_reference_stats",
    "main",
]


def load_model_features(path: Path = FEATURE_LIST_PATH) -> list[str]:
    """Read ``MODEL_FEATURES`` from ``models/feature_list.json`` (SPEC §14)."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return [str(feature) for feature in payload["features"]]


def build_reference_stats(
    output_path: Path = REFERENCE_STATS_PATH,
    n_bins: int = DEFAULT_N_BINS,
    feature_list_path: Path = FEATURE_LIST_PATH,
) -> dict[str, Any]:
    """Build (and persist) the drift reference from the train split.

    Args:
        output_path: Where to write the JSON artifact.
        n_bins: Target quantile bins per numeric feature (may shrink on ties).
        feature_list_path: ``models/feature_list.json`` defining MODEL_FEATURES.

    Returns:
        The payload written to ``output_path``.
    """
    train = load_split("train")
    stats = fit_neighborhood_stats(train)
    frame = build_feature_frame(train, stats)

    model_features = load_model_features(feature_list_path)
    missing = [f for f in model_features if f not in frame.columns]
    if missing:
        raise ValueError(
            f"MODEL_FEATURES missing from built feature frame: {missing}; "
            "regenerate models/feature_list.json via `python -m ml.features.pipeline`"
        )
    frame = frame[model_features]

    numeric: dict[str, dict[str, Any]] = {}
    for feature in model_features:
        if not pd.api.types.is_numeric_dtype(frame[feature]):
            continue
        edges = psi_bins_from_train(frame[feature], n_bins=n_bins)
        expected = bin_proportions(frame[feature], edges)
        numeric[feature] = {
            "bin_edges": edges,
            "expected_proportions": [float(p) for p in expected.tolist()],
            # AUD-06: quantile binning collapsed below two bins → fallback
            # midpoint-cut bins; fewer effective bins, reduced PSI sensitivity.
            "degenerate": degenerate_binning(frame[feature], n_bins=n_bins),
        }

    categorical: dict[str, dict[str, Any]] = {}
    for feature in KEY_CATEGORICAL_FEATURES:
        if feature not in frame.columns:
            logger.warning("key categorical feature %r not in frame; skipped", feature)
            continue
        proportions = frame[feature].astype(str).value_counts(normalize=True)
        categorical[feature] = {
            "proportions": {str(cat): float(p) for cat, p in proportions.items()},
        }

    payload: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset_version": DATASET_VERSION,
        "feature_version": feature_version(feature_list_path),
        "split": "train",
        "n_rows": int(len(frame)),
        "n_bins": n_bins,
        "numeric_features": sorted(numeric),
        "categorical_features": sorted(categorical),
        "numeric": numeric,
        "categorical": categorical,
    }
    write_json(output_path, payload)
    logger.info(
        "wrote drift reference: %d numeric + %d categorical features, %d train rows -> %s",
        len(numeric),
        len(categorical),
        len(frame),
        output_path,
    )
    return payload


def _is_number(value: Any) -> bool:
    """True for real JSON numbers (bools excluded)."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_numeric_spec(path: Path, feature: str, spec: Any) -> None:
    """Fail fast on a malformed numeric reference entry (AUD-25)."""
    if not isinstance(spec, dict):
        raise ValueError(
            f"corrupt drift reference {path}: feature {feature!r} is not an object"
        )
    edges = spec.get("bin_edges")
    if (
        not isinstance(edges, list)
        or len(edges) < 2
        or not all(_is_number(edge) and math.isfinite(float(edge)) for edge in edges)
        or any(b <= a for a, b in zip(edges, edges[1:]))
    ):
        raise ValueError(
            f"corrupt drift reference {path}: feature {feature!r} bin_edges must be "
            "a list of >= 2 finite, strictly increasing numbers"
        )
    expected = spec.get("expected_proportions")
    if (
        not isinstance(expected, list)
        or len(expected) != len(edges) - 1
        or not all(_is_number(p) and float(p) >= 0.0 for p in expected)
        or sum(float(p) for p in expected) <= 0.0
    ):
        raise ValueError(
            f"corrupt drift reference {path}: feature {feature!r} "
            "expected_proportions must be len(bin_edges) - 1 non-negative "
            "numbers with positive mass"
        )


def load_reference_stats(path: Path = REFERENCE_STATS_PATH) -> dict[str, Any]:
    """Load and validate the drift reference artifact.

    Raises:
        FileNotFoundError: If the artifact does not exist (run
            ``python -m ml.monitoring.reference`` first).
        ValueError: If the artifact is corrupt — unreadable/non-object JSON
            or a malformed numeric spec; the message names the feature and
            the problem so callers (e.g. the drift_check CLI) can fail with a
            clean error instead of crashing mid-run (AUD-25).
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"Drift reference not found: {path}. "
            "Run `python -m ml.monitoring.reference` first."
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"corrupt drift reference {path}: invalid JSON ({exc})") from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"corrupt drift reference {path}: top-level payload is not an object"
        )
    numeric = payload.get("numeric", {})
    if not isinstance(numeric, dict):
        raise ValueError(
            f"corrupt drift reference {path}: 'numeric' is not an object"
        )
    for feature, spec in numeric.items():
        _validate_numeric_spec(path, feature, spec)
    return payload


def main() -> None:
    """CLI entry point: regenerate ``models/monitoring/reference_stats.json``."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    build_reference_stats()


if __name__ == "__main__":
    main()
