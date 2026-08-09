"""Champion selection on VALIDATION metrics (SPEC §6).

This module owns the *decision logic* only — it never touches the sealed test
split. ``ml.evaluation.evaluate`` orchestrates model loading, the one-time
sealed-test evaluation, artifact promotion and reporting; every choice here is
driven exclusively by the validation split:

- **Regression** (SPEC §6): RMSLE primary, RMSE then R² as tie-breakers. The
  top-2 gap is quantified with a **paired bootstrap** (seed 42, 2000 row-level
  resamples of the val split) giving a 95% percentile CI for
  ``RMSLE(champion) - RMSLE(runner-up)`` — RMSLE equals RMSE in log1p space
  (ADR-10), so per-row squared log errors are resampled directly.
- **Classification** (SPEC §6): PR-AUC primary **among calibrated variants
  only**, with a Brier-score sanity check (the PR-AUC winner must be within
  ``BRIER_SANITY_TOLERANCE`` of the best calibrated Brier). The serving
  operating threshold maximises F1 on the val calibrated probabilities
  (SPEC §14: the threshold is not 0.5 — calibrated probabilities sit near the
  ~25% prevalence).

The classification target is SIMULATED (ADR-3): all classification metrics are
labelled accordingly and are not real-world performance claims.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import precision_recall_curve

from ml.paths import MODELS_DIR, RANDOM_SEED

logger = logging.getLogger(__name__)

__all__ = [
    "REGRESSION_METRICS_PATH",
    "CLASSIFICATION_METRICS_PATH",
    "BOOTSTRAP_RESAMPLES",
    "BRIER_SANITY_TOLERANCE",
    "RegressionChoice",
    "ClassificationChoice",
    "BootstrapResult",
    "ThresholdChoice",
    "load_regression_metrics",
    "load_classification_metrics",
    "rank_regression_candidates",
    "select_regression_champion",
    "paired_bootstrap_rmsle_diff",
    "rank_classification_candidates",
    "select_classification_champion",
    "pick_f1_threshold",
]

#: Validation metrics written by the training agents (val split only).
REGRESSION_METRICS_PATH = MODELS_DIR / "regression" / "metrics.json"
CLASSIFICATION_METRICS_PATH = MODELS_DIR / "classification" / "metrics.json"

#: Paired-bootstrap configuration (SPEC §6 / assignment): seed 42, 2000 resamples.
BOOTSTRAP_RESAMPLES = 2000

#: The calibrated PR-AUC winner's Brier may be at most this much worse than the
#: best calibrated Brier before calibration overrides raw ranking (SPEC §6
#: "PR-AUC primary + Brier calibration check").
BRIER_SANITY_TOLERANCE = 0.01


@dataclass(frozen=True)
class RegressionChoice:
    """Regression champion decision (validation metrics only)."""

    champion: str
    runner_up: str
    ranking: list[str]
    reason: str


@dataclass(frozen=True)
class ClassificationChoice:
    """Classification champion decision (calibrated variants, val only)."""

    champion: str
    ranking: list[str]
    brier_sane: bool
    brier_gap_to_best: float
    reason: str


@dataclass(frozen=True)
class BootstrapResult:
    """Paired-bootstrap CI for ``RMSLE(champion) - RMSLE(runner_up)`` on val."""

    champion: str
    runner_up: str
    observed_diff: float
    ci_low: float
    ci_high: float
    prob_runner_up_better: float
    n_resamples: int
    seed: int
    significant: bool
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ThresholdChoice:
    """F1-optimal operating threshold with its precision/recall (val)."""

    threshold: float
    precision: float
    recall: float
    f1: float


def load_regression_metrics(path: Path = REGRESSION_METRICS_PATH) -> dict[str, Any]:
    """Load ``models/regression/metrics.json`` (``{model: {val, ...}}``)."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_classification_metrics(path: Path = CLASSIFICATION_METRICS_PATH) -> dict[str, Any]:
    """Load ``models/classification/metrics.json`` (``{model: {val, val_calibrated, ...}}``)."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def rank_regression_candidates(metrics: dict[str, Any]) -> list[str]:
    """Rank regression candidates: val RMSLE asc, then RMSE asc, then R² desc.

    Args:
        metrics: Payload of ``models/regression/metrics.json``.

    Returns:
        Model names best-first.
    """
    return sorted(
        metrics,
        key=lambda name: (
            metrics[name]["val"]["rmsle"],
            metrics[name]["val"]["rmse"],
            -metrics[name]["val"]["r2"],
        ),
    )


def select_regression_champion(metrics: dict[str, Any]) -> RegressionChoice:
    """Pick the regression champion and runner-up on validation metrics.

    SPEC §6: RMSLE primary, RMSE then R² tie-breakers. Interpretability and
    latency are weighed in the written rationale by the caller — this function
    only applies the metric rule.

    Raises:
        ValueError: If fewer than two candidates are present.
    """
    ranking = rank_regression_candidates(metrics)
    if len(ranking) < 2:
        raise ValueError(f"need >= 2 regression candidates, got {ranking}")
    champion, runner_up = ranking[0], ranking[1]
    reason = (
        f"{champion} has the best validation RMSLE "
        f"({metrics[champion]['val']['rmsle']:.6f}); runner-up is {runner_up} "
        f"({metrics[runner_up]['val']['rmsle']:.6f}) per SPEC §6 "
        "(RMSLE primary, RMSE/R² tie-break)."
    )
    logger.info("regression ranking (val RMSLE): %s", ranking)
    return RegressionChoice(
        champion=champion, runner_up=runner_up, ranking=ranking, reason=reason
    )


def paired_bootstrap_rmsle_diff(
    y_true_log: np.ndarray,
    pred_champion_log: np.ndarray,
    pred_runner_up_log: np.ndarray,
    champion: str,
    runner_up: str,
    n_resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = RANDOM_SEED,
) -> BootstrapResult:
    """Paired bootstrap 95% CI of the val RMSLE gap between the top-2 models.

    Rows of the validation split are resampled with replacement (the same
    resample for both models — paired design, so model correlation cancels).
    RMSLE is computed as RMSE in log1p space (identical by construction, see
    ``ml.training.common.regression_metrics``). A negative difference means the
    champion is better; the gap is "statistically meaningful" when the 95%
    percentile CI excludes 0.

    Args:
        y_true_log: ``log1p(SalePrice)`` val targets, shape ``(n,)``.
        pred_champion_log: Champion log-space predictions, shape ``(n,)``.
        pred_runner_up_log: Runner-up log-space predictions, shape ``(n,)``.
        champion: Champion model name (a in ``RMSLE(a) - RMSLE(b)``).
        runner_up: Runner-up model name (b).
        n_resamples: Number of bootstrap resamples (2000 per assignment).
        seed: RNG seed (42 per SPEC §12).

    Returns:
        A :class:`BootstrapResult` with the observed diff, percentile CI and
        the fraction of resamples where the runner-up beats the champion.
    """
    y = np.asarray(y_true_log, dtype=float)
    err_champion = (np.asarray(pred_champion_log, dtype=float) - y) ** 2
    err_runner = (np.asarray(pred_runner_up_log, dtype=float) - y) ** 2
    n = y.shape[0]
    if err_champion.shape != err_runner.shape or n == 0:
        raise ValueError("prediction arrays must be non-empty and equally shaped")

    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_resamples, n))
    diffs = np.sqrt(err_champion[idx].mean(axis=1)) - np.sqrt(
        err_runner[idx].mean(axis=1)
    )
    observed = float(np.sqrt(err_champion.mean()) - np.sqrt(err_runner.mean()))
    ci_low, ci_high = (float(q) for q in np.quantile(diffs, [0.025, 0.975]))
    prob_runner_better = float((diffs > 0.0).mean())
    significant = bool(ci_low > 0.0 or ci_high < 0.0)
    logger.info(
        "paired bootstrap (%d resamples, seed %d): RMSLE(%s) - RMSLE(%s) = "
        "%.6f, 95%% CI [%.6f, %.6f], P(runner-up better)=%.3f, significant=%s",
        n_resamples,
        seed,
        champion,
        runner_up,
        observed,
        ci_low,
        ci_high,
        prob_runner_better,
        significant,
    )
    return BootstrapResult(
        champion=champion,
        runner_up=runner_up,
        observed_diff=observed,
        ci_low=ci_low,
        ci_high=ci_high,
        prob_runner_up_better=prob_runner_better,
        n_resamples=n_resamples,
        seed=seed,
        significant=significant,
    )


def rank_classification_candidates(metrics: dict[str, Any]) -> list[str]:
    """Rank CALIBRATED classification variants: val PR-AUC desc, Brier asc.

    Only models with a ``val_calibrated`` entry participate (SPEC §6 selects
    among calibrated variants).

    Args:
        metrics: Payload of ``models/classification/metrics.json``.

    Returns:
        Model names best-first.
    """
    calibrated = [name for name, entry in metrics.items() if "val_calibrated" in entry]
    return sorted(
        calibrated,
        key=lambda name: (
            -metrics[name]["val_calibrated"]["pr_auc"],
            metrics[name]["val_calibrated"]["brier"],
        ),
    )


def select_classification_champion(metrics: dict[str, Any]) -> ClassificationChoice:
    """Pick the classification champion among calibrated variants (val only).

    PR-AUC is primary (SPEC §6; the target has a ~25% positive rate, so PR-AUC
    is more informative than ROC-AUC). Brier sanity check: the PR-AUC winner's
    calibrated Brier must lie within ``BRIER_SANITY_TOLERANCE`` of the best
    calibrated Brier, otherwise the best-Brier model within tolerance of the
    best PR-AUC is preferred and the override is recorded in ``reason``.

    Raises:
        ValueError: If no calibrated variants are present.
    """
    ranking = rank_classification_candidates(metrics)
    if not ranking:
        raise ValueError("no calibrated classification candidates found")
    winner = ranking[0]
    winner_brier = float(metrics[winner]["val_calibrated"]["brier"])
    best_brier = min(float(metrics[n]["val_calibrated"]["brier"]) for n in ranking)
    brier_gap = winner_brier - best_brier
    brier_sane = brier_gap <= BRIER_SANITY_TOLERANCE

    if not brier_sane:
        # Brier override: best-calibrated model whose PR-AUC is within
        # tolerance of the winner's (defensive — not triggered by current
        # metrics, where the PR-AUC winner also has the best Brier).
        winner_pr_auc = float(metrics[winner]["val_calibrated"]["pr_auc"])
        for name in ranking:
            entry = metrics[name]["val_calibrated"]
            if (
                float(entry["brier"]) <= best_brier + BRIER_SANITY_TOLERANCE
                and float(entry["pr_auc"]) >= winner_pr_auc - BRIER_SANITY_TOLERANCE
            ):
                logger.warning(
                    "Brier sanity check overrode PR-AUC winner %s -> %s",
                    winner,
                    name,
                )
                winner = name
                break

    reason = (
        f"{winner} (calibrated) has the best validation PR-AUC "
        f"({metrics[winner]['val_calibrated']['pr_auc']:.6f}) among calibrated "
        f"variants with Brier {metrics[winner]['val_calibrated']['brier']:.6f} "
        f"(gap to best Brier {brier_gap:+.6f}, tolerance "
        f"{BRIER_SANITY_TOLERANCE}) per SPEC §6."
    )
    logger.info("classification ranking (calibrated val PR-AUC): %s", ranking)
    return ClassificationChoice(
        champion=winner,
        ranking=ranking,
        brier_sane=brier_sane,
        brier_gap_to_best=brier_gap,
        reason=reason,
    )


def pick_f1_threshold(y_true: np.ndarray, proba: np.ndarray) -> ThresholdChoice:
    """Pick the operating threshold that maximises F1 (SPEC §14).

    Evaluated on the val calibrated champion probabilities; precision/recall at
    the chosen threshold are reported alongside. Ties (within 1e-9 relative)
    are broken toward the highest-precision threshold — fewer false "fast sale"
    alarms at the same F1. SPEC §14: the threshold is not 0.5 because
    calibrated probabilities sit near the ~25% prevalence.

    Args:
        y_true: Binary val targets, shape ``(n,)``.
        proba: Calibrated positive-class probabilities, shape ``(n,)``.

    Returns:
        A :class:`ThresholdChoice` with ``threshold`` guaranteed in ``(0, 1)``.

    Raises:
        ValueError: If no finite threshold in ``(0, 1)`` can be produced.
    """
    y = np.asarray(y_true, dtype=int)
    p = np.asarray(proba, dtype=float)
    if y.shape != p.shape or y.size == 0:
        raise ValueError("y_true and proba must be non-empty and equally shaped")

    precision, recall, thresholds = precision_recall_curve(y, p)
    # precision/recall have one trailing element without a matching threshold.
    p_t, r_t = precision[:-1], recall[:-1]
    denom = p_t + r_t
    f1 = np.where(denom > 0.0, 2.0 * p_t * r_t / np.maximum(denom, 1e-12), 0.0)
    best_f1 = float(f1.max())
    tied = np.flatnonzero(np.isclose(f1, best_f1, rtol=1e-9, atol=1e-12))
    idx = int(tied[np.argmax(p_t[tied])])
    threshold = float(thresholds[idx])
    if not 0.0 < threshold < 1.0:
        raise ValueError(f"degenerate F1-optimal threshold {threshold}")
    logger.info(
        "F1-optimal threshold %.6f (precision %.4f, recall %.4f, F1 %.4f)",
        threshold,
        p_t[idx],
        r_t[idx],
        f1[idx],
    )
    return ThresholdChoice(
        threshold=threshold,
        precision=float(p_t[idx]),
        recall=float(r_t[idx]),
        f1=float(f1[idx]),
    )
