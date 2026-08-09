"""Production monitoring for PropPulse (SPEC §10).

PSI-based drift detection: a train-fit reference distribution
(:mod:`ml.monitoring.reference`), the PSI math itself
(:mod:`ml.monitoring.psi`), and the scheduled drift check over the backend's
JSONL prediction log (:mod:`ml.monitoring.drift_check`). The backend's
``/metrics`` endpoint surfaces ``reports/drift/latest.json``; retraining is
only ever *recommended*, never triggered from here.

Exports are resolved lazily (PEP 562) so ``python -m ml.monitoring.drift_check``
does not import the submodule before runpy executes it (runpy RuntimeWarning).
"""
from __future__ import annotations

from typing import Any

__all__ = [
    # psi
    "PSI_WARN_THRESHOLD",
    "PSI_DRIFT_THRESHOLD",
    "DEFAULT_N_BINS",
    "population_stability_index",
    "psi_bins_from_train",
    "degenerate_binning",
    "bin_proportions",
    # reference
    "MONITORING_DIR",
    "REFERENCE_STATS_PATH",
    "PREDICTION_REFERENCE_PATH",
    "KEY_CATEGORICAL_FEATURES",
    "load_model_features",
    "build_reference_stats",
    "load_reference_stats",
    # drift check
    "DEFAULT_WINDOW",
    "MIN_SAMPLE_FOR_RETRAINING",
    "LOW_SAMPLE_THRESHOLD",
    "CALENDAR_FEATURES",
    "DEFAULT_LOG_PATH",
    "DRIFT_REPORT_PATH",
    "read_prediction_window",
    "compute_feature_psi",
    "compute_prediction_psi",
    "run_drift_check",
]

_PSI_EXPORTS = {
    "PSI_WARN_THRESHOLD",
    "PSI_DRIFT_THRESHOLD",
    "DEFAULT_N_BINS",
    "population_stability_index",
    "psi_bins_from_train",
    "degenerate_binning",
    "bin_proportions",
}
_REFERENCE_EXPORTS = {
    "MONITORING_DIR",
    "REFERENCE_STATS_PATH",
    "PREDICTION_REFERENCE_PATH",
    "KEY_CATEGORICAL_FEATURES",
    "load_model_features",
    "build_reference_stats",
    "load_reference_stats",
}
_DRIFT_CHECK_EXPORTS = {
    "DEFAULT_WINDOW",
    "MIN_SAMPLE_FOR_RETRAINING",
    "LOW_SAMPLE_THRESHOLD",
    "CALENDAR_FEATURES",
    "DEFAULT_LOG_PATH",
    "DRIFT_REPORT_PATH",
    "read_prediction_window",
    "compute_feature_psi",
    "compute_prediction_psi",
    "run_drift_check",
}


def __getattr__(name: str) -> Any:
    if name in _PSI_EXPORTS:
        from ml.monitoring import psi

        return getattr(psi, name)
    if name in _REFERENCE_EXPORTS:
        from ml.monitoring import reference

        return getattr(reference, name)
    if name in _DRIFT_CHECK_EXPORTS:
        from ml.monitoring import drift_check

        return getattr(drift_check, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
