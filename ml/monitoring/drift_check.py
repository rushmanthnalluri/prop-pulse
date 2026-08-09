"""Drift check — compare the recent prediction-log window vs the train reference.

Reads ``logs/predictions.jsonl`` (binding log-line schema, SPEC §10)::

    {"timestamp": iso8601, "payload": {...}, "features": {<MODEL_FEATURES>: value},
     "prediction": {"estimated_price": float, "probability": float, "cluster_id": int},
     "model_version": str}

computes per-numeric-feature PSI against
``models/monitoring/reference_stats.json`` and writes
``reports/drift/latest.json``. CLI::

    python -m ml.monitoring.drift_check [--window N] [--log PATH]

Exit code is 0 even when the log is missing/empty (report status
``"no_data"``) so the check is safe to run on a schedule before the backend
has logged anything. ``retraining_recommended`` is a *recommendation flag
only* — this module never triggers retraining (SPEC §10). It requires at
least one **non-calendar** drifted feature: calendar-derived features
(:data:`CALENDAR_FEATURES`) drift structurally under sustained live traffic
because the time-based split ends in 2010 while serving stamps today's date;
their drift stays visible via ``calendar_drift_features``. The PSI drift
threshold defaults to :data:`PSI_DRIFT_THRESHOLD` and can be overridden with
the ``DRIFT_PSI_THRESHOLD`` environment variable.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from ml.monitoring.psi import (
    PSI_DRIFT_THRESHOLD,
    PSI_WARN_THRESHOLD,
    bin_proportions,
    population_stability_index,
)
from ml.monitoring.reference import (
    PREDICTION_REFERENCE_PATH,
    REFERENCE_STATS_PATH,
    load_reference_stats,
)
from ml.paths import LOGS_DIR, REPORTS_DIR
from ml.training.common import write_json

logger = logging.getLogger(__name__)

#: Default number of most-recent log lines analyzed per run (SPEC §10).
DEFAULT_WINDOW: int = 500
#: Minimum valid predictions before drift may trigger a retraining
#: recommendation — small windows are too noisy to act on.
MIN_SAMPLE_FOR_RETRAINING: int = 200
#: Below this many valid predictions the report carries ``low_sample: true``
#: (small-window PSI is noisy; the frontend surfaces a low-sample note).
LOW_SAMPLE_THRESHOLD: int = 50
#: Environment variable overriding the PSI drift threshold (AUD-08).
DRIFT_THRESHOLD_ENV_VAR: str = "DRIFT_PSI_THRESHOLD"
#: Calendar-derived features (AUD-07). They drift structurally on sustained
#: live traffic — the time-based train/val/test split ends in 2010 while
#: serving stamps the sale date as today — so drift limited to these features
#: must never trigger a retraining recommendation.
CALENDAR_FEATURES: frozenset[str] = frozenset(
    {
        "YrSold",
        "MoSold",
        "sale_year",
        "sale_month",
        "sale_quarter",
        "property_age",
        "years_since_remod",
    }
)

DEFAULT_LOG_PATH = LOGS_DIR / "predictions.jsonl"
DRIFT_REPORT_PATH = REPORTS_DIR / "drift" / "latest.json"

__all__ = [
    "DEFAULT_WINDOW",
    "MIN_SAMPLE_FOR_RETRAINING",
    "LOW_SAMPLE_THRESHOLD",
    "CALENDAR_FEATURES",
    "DRIFT_THRESHOLD_ENV_VAR",
    "DEFAULT_LOG_PATH",
    "DRIFT_REPORT_PATH",
    "psi_drift_threshold",
    "read_prediction_window",
    "compute_feature_psi",
    "compute_prediction_psi",
    "run_drift_check",
    "main",
]


def psi_drift_threshold() -> float:
    """Effective PSI drift threshold (AUD-08).

    The ``DRIFT_PSI_THRESHOLD`` environment variable overrides the SPEC §10
    default (:data:`PSI_DRIFT_THRESHOLD`); an unset, empty, non-numeric or
    non-positive/non-finite value falls back to the default with a warning.
    """
    raw = os.environ.get(DRIFT_THRESHOLD_ENV_VAR)
    if raw is None or not raw.strip():
        return PSI_DRIFT_THRESHOLD
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "invalid %s=%r (not a number); using default %s",
            DRIFT_THRESHOLD_ENV_VAR,
            raw,
            PSI_DRIFT_THRESHOLD,
        )
        return PSI_DRIFT_THRESHOLD
    if not math.isfinite(value) or value <= 0.0:
        logger.warning(
            "invalid %s=%r (must be a positive finite number); using default %s",
            DRIFT_THRESHOLD_ENV_VAR,
            raw,
            PSI_DRIFT_THRESHOLD,
        )
        return PSI_DRIFT_THRESHOLD
    return value


def read_prediction_window(
    log_path: Path, window: int = DEFAULT_WINDOW
) -> tuple[list[dict[str, Any]], int]:
    """Read the last ``window`` lines of a JSONL prediction log.

    Returns:
        ``(valid_records, n_invalid)`` where valid records are dicts carrying
        a ``features`` dict; malformed JSON lines or records without a
        ``features`` mapping are skipped and counted in ``n_invalid``.
    """
    log_path = Path(log_path)
    tail: deque[str] = deque(maxlen=max(1, int(window)))
    with log_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            tail.append(line)
    valid: list[dict[str, Any]] = []
    n_invalid = 0
    for line in tail:
        line = line.strip()
        if not line:
            # Blank lines are malformed log lines: skipped and counted,
            # matching this function's docstring contract (AUD-25).
            n_invalid += 1
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            n_invalid += 1
            continue
        if not isinstance(record, dict) or not isinstance(record.get("features"), dict):
            n_invalid += 1
            continue
        valid.append(record)
    return valid, n_invalid


def _coerced(values: Iterable[Any]) -> list[float]:
    """Keep only values that coerce to a finite float."""
    out: list[float] = []
    for value in values:
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if number == number and number not in (float("inf"), float("-inf")):
            out.append(number)
    return out


def compute_feature_psi(
    records: list[dict[str, Any]], reference: dict[str, Any]
) -> dict[str, float]:
    """Per-numeric-feature PSI of the log window vs the train reference.

    Features absent from every record (or with no numeric values) are skipped.
    """
    per_feature: dict[str, float] = {}
    for feature, spec in reference.get("numeric", {}).items():
        values = _coerced(record["features"].get(feature) for record in records)
        if not values:
            continue
        actual = bin_proportions(values, spec["bin_edges"])
        if actual.sum() <= 0.0:
            continue
        per_feature[feature] = population_stability_index(
            spec["expected_proportions"], actual
        )
    return per_feature


def _iter_prediction_specs(payload: dict[str, Any]) -> list[tuple[str, list, list]]:
    """Extract ``(prediction_field, bin_edges, expected_proportions)`` triples.

    Supported shapes (the file is produced by another agent, so both are
    accepted defensively):

    1. Sectioned — the current producer's schema::

           {"regression":     {"field": "estimated_price", "bin_edges": [...],
                               "bin_proportions": [...], ...},
            "classification": {"field": "probability", ...}, ...}

    2. Flat per-field, optionally nested under a ``"predictions"`` key::

           {"estimated_price": {"bin_edges": [...], "expected_proportions": [...]}}

    ``"bin_proportions"`` and ``"expected_proportions"`` are treated as
    aliases.
    """
    specs = payload.get("predictions", payload)
    if not isinstance(specs, dict):
        return []
    out: list[tuple[str, list, list]] = []
    for key, spec in specs.items():
        if not isinstance(spec, dict):
            continue
        edges = spec.get("bin_edges")
        expected = spec.get("expected_proportions", spec.get("bin_proportions"))
        if not edges or not expected:
            continue
        field = spec.get("field")
        if not isinstance(field, str) or not field:
            field = str(key)
        out.append((field, edges, expected))
    return out


def compute_prediction_psi(
    records: list[dict[str, Any]],
    prediction_reference_path: Path = PREDICTION_REFERENCE_PATH,
) -> dict[str, float] | None:
    """PSI of the prediction distributions vs the prediction reference, if any.

    ``models/monitoring/prediction_reference.json`` is produced by another
    agent; see :func:`_iter_prediction_specs` for the accepted schemas.

    Returns:
        ``{prediction_field: psi}`` or ``None`` when the file is missing or
        unusable — prediction drift never blocks the feature-drift report.
    """
    path = Path(prediction_reference_path)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("unusable prediction reference %s: %s", path, exc)
        return None
    if not isinstance(payload, dict):
        return None

    result: dict[str, float] = {}
    for field, edges, expected in _iter_prediction_specs(payload):
        values = _coerced(
            record["prediction"].get(field)
            for record in records
            if isinstance(record.get("prediction"), dict)
        )
        if not values:
            continue
        try:
            actual = bin_proportions(values, edges)
            result[field] = population_stability_index(expected, actual)
        except ValueError as exc:
            logger.warning("skipping prediction PSI for %r: %s", field, exc)
    return result or None


def _no_data_report(base: dict[str, Any], reason: str) -> dict[str, Any]:
    """Build a ``no_data`` report (missing/empty/fully-invalid log)."""
    return {
        **base,
        "status": "no_data",
        "n_predictions": 0,
        "low_sample": True,
        "drift_detected": False,
        "drifted_features": [],
        "calendar_drift_features": [],
        "warn_features": [],
        "per_feature_psi": {},
        "max_psi": None,
        "prediction_psi": None,
        "retraining_recommended": False,
        "recommendation_text": (
            f"No usable prediction data ({reason}); drift check skipped. "
            "The backend starts populating logs/predictions.jsonl once it serves traffic."
        ),
    }


def run_drift_check(
    log_path: Path = DEFAULT_LOG_PATH,
    window: int = DEFAULT_WINDOW,
    reference_path: Path = REFERENCE_STATS_PATH,
    prediction_reference_path: Path = PREDICTION_REFERENCE_PATH,
    output_path: Path = DRIFT_REPORT_PATH,
) -> dict[str, Any]:
    """Run the drift check and write ``reports/drift/latest.json``.

    Args:
        log_path: JSONL prediction log (last ``window`` lines are analyzed).
        window: Number of most-recent log lines to analyze.
        reference_path: Train reference from ``ml.monitoring.reference``.
        prediction_reference_path: Optional prediction-distribution reference.
        output_path: Where to write the report.

    Returns:
        The report payload (also written to ``output_path``).

    Raises:
        FileNotFoundError: If ``reference_path`` does not exist.
        ValueError: If the reference artifact is corrupt (clean structured
            error from ``load_reference_stats``, never a mid-run crash).
    """
    log_path = Path(log_path)
    reference = load_reference_stats(reference_path)
    drift_threshold = psi_drift_threshold()
    base: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "window": int(window),
        "log_path": str(log_path),
        "psi_threshold": drift_threshold,
        "warn_threshold": PSI_WARN_THRESHOLD,
        "min_sample_for_retraining": MIN_SAMPLE_FOR_RETRAINING,
        "reference_feature_version": reference.get("feature_version"),
        "n_invalid_lines": 0,
    }

    if not log_path.exists():
        report = _no_data_report(base, f"log not found: {log_path}")
    elif log_path.stat().st_size == 0:
        report = _no_data_report(base, f"log is empty: {log_path}")
    else:
        records, n_invalid = read_prediction_window(log_path, window)
        base["n_invalid_lines"] = n_invalid
        if not records:
            report = _no_data_report(
                base, f"no valid prediction lines in last {window} line(s)"
            )
        else:
            report = _ok_report(
                base, records, reference, prediction_reference_path, drift_threshold
            )

    write_json(output_path, report)
    logger.info(
        "drift check: status=%s n=%d drift=%s drifted=%s -> %s",
        report["status"],
        report["n_predictions"],
        report["drift_detected"],
        report["drifted_features"],
        output_path,
    )
    return report


def _ok_report(
    base: dict[str, Any],
    records: list[dict[str, Any]],
    reference: dict[str, Any],
    prediction_reference_path: Path,
    drift_threshold: float,
) -> dict[str, Any]:
    """Build the ``ok`` report from valid prediction records."""
    per_feature = compute_feature_psi(records, reference)
    drifted = sorted(
        feature for feature, psi in per_feature.items() if psi >= drift_threshold
    )
    warn = sorted(
        feature
        for feature, psi in per_feature.items()
        if PSI_WARN_THRESHOLD <= psi < drift_threshold
    )
    max_psi = max(per_feature.values()) if per_feature else None
    prediction_psi = compute_prediction_psi(records, prediction_reference_path)
    n = len(records)
    drift_detected = bool(drifted)
    # AUD-07: calendar-derived features drift structurally (time-based split
    # ends 2010; serving stamps today's date) — they stay visible in
    # ``calendar_drift_features`` but never alone recommend retraining.
    calendar_drifted = [feature for feature in drifted if feature in CALENDAR_FEATURES]
    non_calendar_drifted = [
        feature for feature in drifted if feature not in CALENDAR_FEATURES
    ]
    retraining_recommended = (
        bool(non_calendar_drifted) and n >= MIN_SAMPLE_FOR_RETRAINING
    )
    return {
        **base,
        "status": "ok",
        "n_predictions": n,
        "low_sample": n < LOW_SAMPLE_THRESHOLD,
        "drift_detected": drift_detected,
        "drifted_features": drifted,
        "calendar_drift_features": calendar_drifted,
        "warn_features": warn,
        "per_feature_psi": {
            feature: round(psi, 6) for feature, psi in sorted(per_feature.items())
        },
        "max_psi": round(max_psi, 6) if max_psi is not None else None,
        "prediction_psi": (
            {field: round(psi, 6) for field, psi in sorted(prediction_psi.items())}
            if prediction_psi is not None
            else None
        ),
        "retraining_recommended": retraining_recommended,
        "recommendation_text": _recommendation_text(
            drifted, warn, n, max_psi, drift_threshold
        ),
    }


def _recommendation_text(
    drifted: list[str],
    warn: list[str],
    n: int,
    max_psi: float | None,
    drift_threshold: float,
) -> str:
    """Human-readable recommendation. Flag only — never auto-retrain."""
    if max_psi is None:
        return (
            "Log window contains no usable numeric feature values; PSI could "
            "not be computed. Check that the backend logs the full built "
            "feature row under the `features` key (SPEC §10)."
        )
    non_calendar = [feature for feature in drifted if feature not in CALENDAR_FEATURES]
    if non_calendar and n >= MIN_SAMPLE_FOR_RETRAINING:
        return (
            f"Drift detected in {len(non_calendar)} non-calendar feature(s) "
            f"({', '.join(non_calendar)}) with PSI >= {drift_threshold} across "
            f"{n} predictions. Retraining is RECOMMENDED — this is a "
            "recommendation flag only; a human must review and trigger any "
            "retraining run."
        )
    if non_calendar:
        return (
            f"Drift detected in {len(non_calendar)} non-calendar feature(s) "
            f"({', '.join(non_calendar)}) with PSI >= {drift_threshold}, but only "
            f"{n} valid prediction(s) in window (< {MIN_SAMPLE_FOR_RETRAINING} "
            "minimum). Collect more data before acting; no retraining "
            "recommended yet."
        )
    if drifted:
        return (
            f"Drift detected only in calendar-derived feature(s) "
            f"({', '.join(drifted)}) with PSI >= {drift_threshold} across {n} "
            "predictions. This is expected structural drift from the time-based "
            "split (train sales end in 2010; live predictions are stamped with "
            "the current date) and on its own does NOT recommend retraining — "
            "keep watching the non-calendar features."
        )
    if warn:
        return (
            f"No drift (PSI >= {drift_threshold}), but {len(warn)} feature(s) "
            f"({', '.join(warn)}) in the warn zone (PSI >= {PSI_WARN_THRESHOLD}, "
            f"max {max_psi:.3f}). Keep watching; no action needed."
        )
    return (
        f"No significant drift across monitored features (max PSI "
        f"{max_psi:.3f} < {PSI_WARN_THRESHOLD}). No action needed."
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Always exits 0 on missing/empty/invalid logs."""
    parser = argparse.ArgumentParser(
        description="PSI drift check of recent predictions vs the train reference."
    )
    parser.add_argument(
        "--window",
        type=int,
        default=DEFAULT_WINDOW,
        help=f"number of most-recent log lines to analyze (default {DEFAULT_WINDOW})",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=DEFAULT_LOG_PATH,
        help=f"path to the JSONL prediction log (default {DEFAULT_LOG_PATH})",
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=REFERENCE_STATS_PATH,
        help=f"train reference stats (default {REFERENCE_STATS_PATH})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DRIFT_REPORT_PATH,
        help=f"where to write the drift report (default {DRIFT_REPORT_PATH})",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        run_drift_check(
            log_path=args.log,
            window=args.window,
            reference_path=args.reference,
            output_path=args.output,
        )
    except FileNotFoundError as exc:
        logger.error("%s", exc)
        return 2
    except ValueError as exc:
        # Corrupt reference artifact: clean structured error, no traceback.
        logger.error("%s", exc)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
