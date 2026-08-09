"""Sandbox evaluation payloads (workflow-architecture §3.10, work package WF-B2).

Every number is derived on read from the arrays captured at train time —
``val_predictions.csv`` (regression: ``Id, y_true, y_pred_log, y_pred_dollar``;
classification: ``Id, y_true, proba_raw, proba_calibrated``) — plus the
candidate's ``metrics.json`` (importance, clustering params). Nothing is
fabricated: curves come from sklearn's ``roc_curve`` /
``precision_recall_curve`` / ``calibration_curve`` thinned to ≤ 80 points
(the PlacementPredict subsample precedent, MECH §4), the confusion matrix is
``labels=[0, 1]``-labelled via ``classification_metrics`` at the F1-optimal
threshold (:func:`ml.evaluation.select.pick_f1_threshold` — the champion's
rule, never a hardcoded 0.5), and the regression top-2 gap uses the real
paired bootstrap (:func:`ml.evaluation.select.paired_bootstrap_rmsle_diff`).

This module never calls ``ml.evaluation.evaluate.run_evaluation`` (a
registry-promotion ceremony that reads the sealed test split, §4.3), never
touches ``models/registry/``, and never reads the sandbox test split —
sandbox models are never promoted, so no test numbers exist in the workbench
(§7 honesty rules). Clustering payloads carry no silhouette score: the
machinery never computes one (§7 explicit omission).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.metrics import precision_recall_curve, roc_curve

from ml.evaluation.select import paired_bootstrap_rmsle_diff, pick_f1_threshold
from ml.clustering.dataset import FEATURE_COLUMNS
from ml.paths import RANDOM_SEED
from ml.training.common import regression_metrics, residual_interval
from ml.training.train_classification import classification_metrics

logger = logging.getLogger(__name__)

__all__ = [
    "CURVE_MAX_POINTS",
    "SCATTER_MAX_POINTS",
    "UnknownCandidateArtifactError",
    "evaluation_payload",
    "paired_bootstrap_payload",
]

#: Curve payloads are thinned to at most this many points (§3.10, MECH §4).
CURVE_MAX_POINTS = 80

#: Regression actual-vs-predicted scatters are seeded-thinned to this many rows.
SCATTER_MAX_POINTS = 400

#: Residual histogram bin count (matches the stage-05 histogram default).
_RESIDUAL_BINS = 30


class UnknownCandidateArtifactError(Exception):
    """No trained candidate artifacts under the job directory (-> HTTP 404)."""


def _candidate_dir(job_dir: Path, candidate: str) -> Path:
    out = Path(job_dir) / "candidates" / candidate
    if not (out / "metrics.json").exists():
        raise UnknownCandidateArtifactError(
            f"no trained candidate {candidate!r} under {job_dir} "
            "(train it in stage 07 first)"
        )
    return out


def _read_metrics(candidate_dir: Path) -> dict[str, Any]:
    return json.loads((candidate_dir / "metrics.json").read_text(encoding="utf-8"))


def _thin_points(points: list[dict[str, Any]], max_points: int = CURVE_MAX_POINTS) -> list[dict[str, Any]]:
    """Thin a curve to ``<= max_points`` keeping both endpoints (§3.10).

    Evenly-spaced indices (deduplicated) — deterministic, no RNG involved.
    """
    if len(points) <= max_points:
        return points
    idx = np.unique(np.linspace(0, len(points) - 1, max_points).round().astype(int))
    return [points[int(i)] for i in idx]


def _seeded_thin_indices(n: int, max_points: int) -> np.ndarray:
    """Sorted seeded row indices for scatter thinning (deterministic, seed 42)."""
    if n <= max_points:
        return np.arange(n)
    rng = np.random.default_rng(RANDOM_SEED)
    return np.sort(rng.choice(n, size=max_points, replace=False))


# ---------------------------------------------------------------------------
# Regression
# ---------------------------------------------------------------------------

def _regression_payload(candidate_dir: Path, candidate: str, metrics: dict[str, Any]) -> dict[str, Any]:
    preds = pd.read_csv(candidate_dir / "val_predictions.csv")
    y_true = preds["y_true"].to_numpy(dtype=float)
    pred_log = preds["y_pred_log"].to_numpy(dtype=float)
    pred_dollar = preds["y_pred_dollar"].to_numpy(dtype=float)
    y_true_log = np.log1p(y_true)

    # Recomputed from the persisted arrays — identical by construction to the
    # values stored at train time (acceptance C10 asserts the equality).
    val_metrics = regression_metrics(y_true, pred_dollar)
    val_metrics["rmse_log"] = float(np.sqrt(np.mean((y_true_log - pred_log) ** 2)))
    val_metrics["residual_interval"] = residual_interval(y_true_log, pred_log)

    idx = _seeded_thin_indices(len(preds), SCATTER_MAX_POINTS)
    actual_vs_predicted = [
        [float(y_true[i]), float(pred_dollar[i])] for i in idx
    ]
    residuals = y_true - pred_dollar
    counts, edges = np.histogram(residuals, bins=_RESIDUAL_BINS)
    residual_hist = {
        "bins": [
            {"x0": float(edges[i]), "x1": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(len(counts))
        ]
    }
    return {
        "objective": "regression",
        "candidate": candidate,
        "split": "val",
        "n": int(len(preds)),
        "metrics": val_metrics,
        "actual_vs_predicted": actual_vs_predicted,
        "residual_hist": residual_hist,
        "importance": metrics.get("importance"),
        "trained_at": metrics.get("trained_at"),
    }


# ---------------------------------------------------------------------------
# Classification (SIMULATED target — ADR-3, labelled everywhere, §7.1)
# ---------------------------------------------------------------------------

def _classification_payload(candidate_dir: Path, candidate: str, metrics: dict[str, Any]) -> dict[str, Any]:
    preds = pd.read_csv(candidate_dir / "val_predictions.csv")
    y_true = preds["y_true"].to_numpy(dtype=int)
    proba = preds["proba_calibrated"].to_numpy(dtype=float)

    choice = pick_f1_threshold(y_true, proba)  # the champion's threshold rule
    metrics_at_f1 = classification_metrics(y_true, proba, choice.threshold)
    metrics_at_0_5 = classification_metrics(y_true, proba, 0.5)

    fpr, tpr, _ = roc_curve(y_true, proba)
    roc = _thin_points([{"fpr": float(f), "tpr": float(t)} for f, t in zip(fpr, tpr, strict=True)])
    precision, recall, _ = precision_recall_curve(y_true, proba)
    pr = _thin_points(
        [{"recall": float(r), "precision": float(p)} for r, p in zip(recall, precision, strict=True)]
    )
    frac_pos, mean_pred = calibration_curve(y_true, proba, n_bins=10, strategy="quantile")
    calibration = _thin_points(
        [
            {"bin_mid": float(m), "frac_pos": float(f), "mean_pred": float(m)}
            for f, m in zip(frac_pos, mean_pred, strict=True)
        ]
    )
    return {
        "objective": "classification",
        "candidate": candidate,
        "split": "val",
        "n": int(len(preds)),
        "simulated_target": True,
        "metrics_at_f1": metrics_at_f1,
        "metrics_at_0_5": metrics_at_0_5,
        "roc": roc,
        "pr": pr,
        "calibration": calibration,
        "positive_rate": float(np.mean(y_true)),
        "importance": metrics.get("importance"),
        "trained_at": metrics.get("trained_at"),
    }


# ---------------------------------------------------------------------------
# Clustering — no silhouette score exists in the machinery (§7 omission)
# ---------------------------------------------------------------------------

def _nearest_centroid_fallback(
    candidate_dir: Path, matrix: pd.DataFrame
) -> dict[str, int]:
    """Resolve noise neighborhoods to their nearest scaled cluster centroid.

    Mirrors the champion's serving fallback (``ml.clustering.serve``) computed
    inline from the job's own scaler + persisted neighborhood matrix (§5.4:
    ``MicroMarketLookup`` is champion-artifact-bound and not reused).
    """
    import joblib

    scaler = joblib.load(candidate_dir / "scaler.joblib")
    labels = matrix["cluster_id"].to_numpy(dtype=int)
    X = scaler.transform(matrix[list(FEATURE_COLUMNS)].to_numpy(dtype=float))
    centroids: dict[int, np.ndarray] = {}
    for cluster_id in sorted(set(labels.tolist()) - {-1}):
        centroids[int(cluster_id)] = X[labels == cluster_id].mean(axis=0)
    fallback: dict[str, int] = {}
    for i, neighborhood in enumerate(matrix["Neighborhood"].astype(str)):
        if labels[i] == -1:
            nearest = min(
                centroids, key=lambda cid: float(np.linalg.norm(X[i] - centroids[cid]))
            )
            fallback[neighborhood] = int(nearest)
    return fallback


def _clustering_payload(candidate_dir: Path, candidate: str, metrics: dict[str, Any]) -> dict[str, Any]:
    cluster_stats = json.loads((candidate_dir / "cluster_stats.json").read_text(encoding="utf-8"))
    matrix = pd.read_csv(candidate_dir / "neighborhood_matrix.csv")
    fallback = _nearest_centroid_fallback(candidate_dir, matrix)

    clusters = [
        {"cluster_id": int(cid), **cluster_stats[cid]}
        for cid in sorted((k for k in cluster_stats if str(k).isdigit()), key=int)
    ]
    assignment_rows = [
        {
            "neighborhood": str(row.Neighborhood),
            "name": str(row.name),
            "cluster_id": int(fallback.get(str(row.Neighborhood), row.cluster_id)),
            "fallback": str(row.Neighborhood) in fallback,
        }
        for row in matrix.sort_values("Neighborhood").itertuples(index=False)
    ]
    return {
        "objective": "clustering",
        "candidate": candidate,
        "algorithm": "DBSCAN",
        "eps": metrics["val_metrics"]["eps"],
        "min_samples": metrics["val_metrics"]["min_samples"],
        "n_clusters": metrics["val_metrics"]["n_clusters"],
        "n_noise": metrics["val_metrics"]["n_noise"],
        "rationale": metrics.get("rationale", ""),
        "clusters": clusters,
        "assignments": assignment_rows,
        "trained_at": metrics.get("trained_at"),
    }


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def evaluation_payload(job_dir: Path, candidate: str) -> dict[str, Any]:
    """Build the §3.10 evaluation payload for one trained candidate.

    Args:
        job_dir: ``models/workflow/<dataset_id>/jobs/<job_id>/``.
        candidate: a candidate with persisted artifacts under
            ``<job_dir>/candidates/<candidate>/``.

    Raises:
        UnknownCandidateArtifactError: no artifacts for the candidate (404).
    """
    candidate_dir = _candidate_dir(job_dir, candidate)
    metrics = _read_metrics(candidate_dir)
    objective = metrics.get("objective")
    if objective == "regression":
        return _regression_payload(candidate_dir, candidate, metrics)
    if objective == "classification":
        return _classification_payload(candidate_dir, candidate, metrics)
    if objective == "clustering":
        return _clustering_payload(candidate_dir, candidate, metrics)
    raise UnknownCandidateArtifactError(
        f"candidate {candidate!r} under {job_dir} has unknown objective {objective!r}"
    )


def paired_bootstrap_payload(
    champion_preds: pd.DataFrame,
    runner_up_preds: pd.DataFrame,
    champion: str,
    runner_up: str,
) -> dict[str, Any]:
    """§3.9 regression bootstrap block from two persisted ``val_predictions.csv`` frames.

    Rows are aligned on ``Id`` (paired design) and the real
    :func:`paired_bootstrap_rmsle_diff` runs over the log-space vectors
    (RMSLE == RMSE in log1p space, ADR-10). Regression-only — no bootstrap
    machinery exists for classification (§7).

    Returns:
        ``{"runner_up", "observed_rmsle_diff", "ci95", "prob_runner_up_better",
        "significant"}`` (the champion is the comparison table's best row).
    """
    merged = champion_preds[["Id", "y_true", "y_pred_log"]].merge(
        runner_up_preds[["Id", "y_pred_log"]], on="Id", suffixes=("_champion", "_runner_up")
    )
    if len(merged) != len(champion_preds) or len(merged) == 0:
        raise ValueError("val prediction frames do not cover the same Ids")
    result = paired_bootstrap_rmsle_diff(
        np.log1p(merged["y_true"].to_numpy(dtype=float)),
        merged["y_pred_log_champion"].to_numpy(dtype=float),
        merged["y_pred_log_runner_up"].to_numpy(dtype=float),
        champion,
        runner_up,
    )
    return {
        "runner_up": runner_up,
        "observed_rmsle_diff": result.observed_diff,
        "ci95": [result.ci_low, result.ci_high],
        "prob_runner_up_better": result.prob_runner_up_better,
        "significant": result.significant,
    }
