"""Sandbox candidate training (workflow-architecture §3.9, work package WF-B2).

Trains the real PropPulse candidate zoo on a *prepared* workflow dataset —
regression (``linear``, ``ridge``, ``lasso``, ``random_forest``, ``xgboost``;
the five of ``ml.training.train_regression.train_all``), classification
(``logistic``, ``decision_tree``, ``random_forest``, ``xgboost``;
``ml.training.train_classification.MODEL_NAMES`` — SIMULATED target, ADR-3)
and clustering (``dbscan``) — and persists every artifact under the per-job
sandbox directory ``models/workflow/<dataset_id>/jobs/<job_id>/`` only (§4.1)::

    <job_dir>/candidates/<name>/model.joblib        # fitted pipeline (classification: calibrated)
    <job_dir>/candidates/<name>/model_raw.joblib    # classification only: pre-calibration pipeline
    <job_dir>/candidates/<name>/scaler.joblib       # clustering only (StandardScaler)
    <job_dir>/candidates/<name>/metrics.json        # val metrics + params + importance + provenance
    <job_dir>/candidates/<name>/val_predictions.csv # regression/classification only (§3.10 schema)
    <job_dir>/candidates/<name>/cluster_stats.json  # clustering only
    <job_dir>/candidates/<name>/cluster_assignments.csv

Reuse discipline (§5.4 checklist): grids, constants and the pure trainer
helpers are imported from the champion trainers (``one_se_alpha``,
``make_pipeline``, ``_train_linear``, ``candidate_grids``, ``tune_on_train``,
``fit_calibrated``, ``classification_metrics``, ``select_dbscan_params``,
``build_cluster_stats``, …). The two regression search wrappers
(:func:`_fit_alpha_model` / :func:`_fit_randomized`) are deliberately small
n_jobs-pinned copies of ``train_regression.py:144,176`` — the champions pin
``n_jobs=-1``, which saturates co-located serving (§4.5; the classification
trainer's Windows spawn-storm precedent). All searches run ``n_jobs=1`` and
forest/xgboost estimators are re-pinned to ``n_jobs <= 2``.

Safety (§4): no MLflow — this module never touches ``mlflow`` and never calls
``ml.tracking`` (job provenance lives in the job's ``status.json``); the
sandbox *test* split is never read (metrics are val-only, §4.3); splits come
only from :func:`ml.workflow.prepare.load_prepared_splits` (never
``ml.training.common.load_split``); and the *sandbox* neighborhood-stats
artifact is passed explicitly to ``build_feature_frame`` — ``stats=None``
would silently load the champion artifact via the module-global loader.
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.model_selection import GridSearchCV, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from ml.clustering.dataset import FEATURE_COLUMNS, build_neighborhood_matrix
from ml.clustering.train import (
    _fit_dbscan,
    build_cluster_stats,
    count_clusters,
    select_dbscan_params,
)
from ml.evaluation.select import pick_f1_threshold
from ml.explainability.explainer import parse_base_name
from ml.features.pipeline import build_feature_frame
from ml.features.stats import NeighborhoodStats, load_neighborhood_stats
from ml.paths import RANDOM_SEED
from ml.training.common import regression_metrics, residual_interval
from ml.training.train_classification import (
    MODEL_NAMES,
    candidate_grids,
    classification_metrics,
    fit_calibrated,
    tune_on_train,
)
from ml.training.train_regression import (
    CV,
    LASSO_ALPHA_GRID,
    N_ITER_TREE_SEARCH,
    RF_PARAM_DIST,
    RIDGE_ALPHA_GRID,
    SCORING,
    XGB_PARAM_DIST,
    _train_linear,
    make_pipeline,
    one_se_alpha,
)
from ml.workflow.datasets import sandbox_dir
from ml.workflow.prepare import load_prepared_splits

logger = logging.getLogger(__name__)

__all__ = [
    "CLASSIFICATION_CANDIDATES",
    "CLUSTERING_CANDIDATES",
    "ESTIMATOR_N_JOBS",
    "OBJECTIVE_CANDIDATES",
    "REGRESSION_CANDIDATES",
    "SEARCH_N_JOBS",
    "UnknownCandidateError",
    "UnknownObjectiveError",
    "train_objective",
    "valid_candidates",
]

#: The valid candidate sets per objective (§3.9; unknown candidates -> 422
#: with this list named, MECH §6 pattern).
REGRESSION_CANDIDATES: tuple[str, ...] = (
    "linear",
    "ridge",
    "lasso",
    "random_forest",
    "xgboost",
)
CLASSIFICATION_CANDIDATES: tuple[str, ...] = tuple(MODEL_NAMES)
CLUSTERING_CANDIDATES: tuple[str, ...] = ("dbscan",)
OBJECTIVE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "regression": REGRESSION_CANDIDATES,
    "classification": CLASSIFICATION_CANDIDATES,
    "clustering": CLUSTERING_CANDIDATES,
}

#: n_jobs pins (§4.5): searches single-threaded; parallel estimators capped.
SEARCH_N_JOBS = 1
ESTIMATOR_N_JOBS = 2

_REGRESSION_TARGET = "SalePrice"
_CLASSIFICATION_TARGET = "sells_within_30_days"

#: Progress callback event kinds emitted by :func:`train_objective`.
EVENT_CANDIDATE_STARTED = "candidate_started"
EVENT_CANDIDATE_DONE = "candidate_done"
EVENT_CANDIDATE_FAILED = "candidate_failed"

ProgressCallback = Callable[[dict[str, Any]], None]


class UnknownObjectiveError(ValueError):
    """Objective outside :data:`OBJECTIVE_CANDIDATES` (-> HTTP 422)."""


class UnknownCandidateError(ValueError):
    """Candidate outside the objective's valid set (-> HTTP 422)."""


def valid_candidates(objective: str) -> tuple[str, ...]:
    """Return the valid candidate names for ``objective``.

    Raises:
        UnknownObjectiveError: unknown objective (message lists valid ones).
    """
    try:
        return OBJECTIVE_CANDIDATES[objective]
    except KeyError:
        raise UnknownObjectiveError(
            f"unknown objective {objective!r}; valid objectives: {sorted(OBJECTIVE_CANDIDATES)}"
        ) from None


def _check_candidates(objective: str, candidates: list[str]) -> list[str]:
    """Validate ``candidates`` against the objective's set (order preserved)."""
    valid = valid_candidates(objective)
    unknown = [c for c in candidates if c not in valid]
    if unknown:
        raise UnknownCandidateError(
            f"unknown candidates for objective {objective!r}: {unknown}; "
            f"valid candidates: {list(valid)}"
        )
    if not candidates:
        raise UnknownCandidateError(
            f"no candidates requested for objective {objective!r}; "
            f"valid candidates: {list(valid)}"
        )
    return list(dict.fromkeys(candidates))  # dedupe, keep request order


def _assert_job_dir_contained(dataset_id: str, job_dir: Path) -> Path:
    """Resolve ``job_dir`` and assert it stays inside the dataset sandbox root."""
    root = sandbox_dir(dataset_id).resolve()
    resolved = Path(job_dir).resolve()
    if os.path.commonpath([str(root), str(resolved)]) != str(root):
        raise ValueError(
            f"job directory escapes the sandbox root {root}: {job_dir} (§4.1)"
        )
    return resolved


def _jsonable(value: Any) -> Any:
    """Recursively convert numpy/pandas scalars to JSON-safe builtins."""
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return [_jsonable(v) for v in value.tolist()]
    return value


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_candidate_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(_jsonable(payload), indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Regression search wrappers — n_jobs-pinned copies of train_regression.py:144,176
# ---------------------------------------------------------------------------

def _fit_alpha_model(
    name: str,
    X_train: pd.DataFrame,
    y_train_log: pd.Series,
    estimator: Any,
    alphas: list[float],
) -> tuple[Pipeline, dict[str, Any], float]:
    """``train_regression._train_alpha_model`` with the search pinned to n_jobs=1."""
    pipeline = make_pipeline(X_train, estimator)
    search = GridSearchCV(
        pipeline,
        param_grid={"model__alpha": alphas},
        scoring=SCORING,
        cv=CV,
        n_jobs=SEARCH_N_JOBS,
    )
    search.fit(X_train, y_train_log)
    alpha, best_score = one_se_alpha(search.cv_results_, alphas)
    logger.info(
        "%s: grid best alpha=%g (score %.4f) -> one-SE alpha=%g",
        name,
        search.best_params_["model__alpha"],
        best_score,
        alpha,
    )
    final = make_pipeline(X_train, type(estimator)(alpha=alpha, max_iter=estimator.max_iter))
    final.fit(X_train, y_train_log)
    chosen_mean = float(search.cv_results_["mean_test_score"][alphas.index(alpha)])
    return final, {"alpha": alpha}, -chosen_mean


def _fit_randomized(
    X_train: pd.DataFrame,
    y_train_log: pd.Series,
    estimator: Any,
    param_dist: dict[str, list[Any]],
) -> tuple[Pipeline, dict[str, Any], float]:
    """``train_regression._train_randomized`` with the search pinned to n_jobs=1."""
    pipeline = make_pipeline(X_train, estimator)
    search = RandomizedSearchCV(
        pipeline,
        param_distributions=param_dist,
        n_iter=N_ITER_TREE_SEARCH,
        scoring=SCORING,
        cv=CV,
        random_state=RANDOM_SEED,
        n_jobs=SEARCH_N_JOBS,
    )
    search.fit(X_train, y_train_log)
    best_params = {k.removeprefix("model__"): v for k, v in search.best_params_.items()}
    return search.best_estimator_, best_params, float(-search.best_score_)


def _pin_estimator_n_jobs(estimator: Any) -> None:
    """Re-pin an estimator's ``n_jobs`` to at most :data:`ESTIMATOR_N_JOBS` (§4.5).

    ``candidate_grids`` ships ``RandomForestClassifier(n_jobs=-1)``; walked and
    re-pinned here rather than editing the champion trainer (§5.4).
    """
    params = estimator.get_params(deep=False)
    if "n_jobs" in params:
        current = params["n_jobs"]
        if current is not None and (current < 0 or current > ESTIMATOR_N_JOBS):
            estimator.set_params(n_jobs=ESTIMATOR_N_JOBS)


# ---------------------------------------------------------------------------
# Native importance (computed at train time, stored in metrics.json — §3.10)
# ---------------------------------------------------------------------------

def _native_importance(pipeline: Pipeline) -> list[dict[str, Any]] | None:
    """Aggregate native model importance from one-hot space to base features.

    Tree estimators -> ``feature_importances_`` (xgboost's is gain by default);
    linear -> ``|coef|``; each one-hot dummy is mapped back to its base
    ``MODEL_FEATURES`` name via :func:`parse_base_name` and summed. ``None``
    where the estimator exposes neither — the UI renders an empty state,
    never a fabricated chart (§3.10).
    """
    model = pipeline.named_steps["model"]
    preprocess = pipeline.named_steps["preprocess"]
    if hasattr(model, "feature_importances_"):
        weights = np.asarray(model.feature_importances_, dtype=float)
    elif hasattr(model, "coef_"):
        weights = np.abs(np.asarray(model.coef_, dtype=float)).ravel()
    else:
        return None
    names = [parse_base_name(str(n)) for n in preprocess.get_feature_names_out()]
    aggregated: dict[str, float] = {}
    for base, weight in zip(names, weights, strict=True):
        aggregated[base] = aggregated.get(base, 0.0) + float(weight)
    return [
        {"feature": feature, "weight": weight}
        for feature, weight in sorted(aggregated.items(), key=lambda kv: -kv[1])
    ]


# ---------------------------------------------------------------------------
# Per-objective candidate trainers
# ---------------------------------------------------------------------------

def _regression_trainer(name: str) -> Callable[[pd.DataFrame, pd.Series], tuple[Pipeline, dict, float | None]]:
    """Return the n_jobs-pinned trainer for one regression candidate."""
    if name == "linear":
        return lambda X, y: _train_linear(X, y)
    if name == "ridge":
        return lambda X, y: _fit_alpha_model(
            name, X, y, Ridge(max_iter=10000), RIDGE_ALPHA_GRID
        )
    if name == "lasso":
        return lambda X, y: _fit_alpha_model(
            name, X, y, Lasso(max_iter=10000), LASSO_ALPHA_GRID
        )
    if name == "random_forest":
        return lambda X, y: _fit_randomized(
            X,
            y,
            RandomForestRegressor(
                n_estimators=300, n_jobs=ESTIMATOR_N_JOBS, random_state=RANDOM_SEED
            ),
            RF_PARAM_DIST,
        )
    if name == "xgboost":
        return lambda X, y: _fit_randomized(
            X,
            y,
            XGBRegressor(
                n_estimators=500,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                tree_method="hist",
                random_state=RANDOM_SEED,
                n_jobs=ESTIMATOR_N_JOBS,
            ),
            XGB_PARAM_DIST,
        )
    raise UnknownCandidateError(
        f"unknown regression candidate {name!r}; valid: {list(REGRESSION_CANDIDATES)}"
    )


def _train_regression_candidate(
    name: str,
    splits: dict[str, pd.DataFrame],
    stats: NeighborhoodStats,
    out_dir: Path,
) -> dict[str, Any]:
    """Train one regression candidate on log1p(SalePrice); persist artifacts."""
    started = time.perf_counter()
    train, val = splits["train"], splits["val"]
    X_train = build_feature_frame(train, stats=stats)
    y_train_log = pd.Series(
        np.log1p(train[_REGRESSION_TARGET].astype(float)), name="log1p_SalePrice"
    )
    X_val = build_feature_frame(val, stats=stats)
    y_val_log = np.log1p(val[_REGRESSION_TARGET].astype(float).to_numpy())

    pipeline, best_params, cv_best_score = _regression_trainer(name)(X_train, y_train_log)

    pred_log = np.asarray(pipeline.predict(X_val), dtype=float)
    pred_dollar = np.expm1(pred_log)
    val_metrics = regression_metrics(
        val[_REGRESSION_TARGET].astype(float).to_numpy(), pred_dollar
    )
    val_metrics["rmse_log"] = float(np.sqrt(np.mean((y_val_log - pred_log) ** 2)))
    val_metrics["residual_interval"] = residual_interval(y_val_log, pred_log)

    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, out_dir / "model.joblib")
    pd.DataFrame(
        {
            "Id": val["Id"].to_numpy(),
            "y_true": val[_REGRESSION_TARGET].astype(float).to_numpy(),
            "y_pred_log": pred_log,
            "y_pred_dollar": pred_dollar,
        }
    ).to_csv(out_dir / "val_predictions.csv", index=False)

    train_seconds = time.perf_counter() - started
    metrics_payload = {
        "candidate": name,
        "objective": "regression",
        "status": "done",
        "trained_at": _utc_now_iso(),
        "train_seconds": round(train_seconds, 3),
        "n_train": int(len(train)),
        "n_val": int(len(val)),
        "target": "log1p(SalePrice) (ADR-10)",
        "val_metrics": val_metrics,
        "best_params": best_params,
        "cv_best_score": cv_best_score,
        "importance": _native_importance(pipeline),
    }
    _write_candidate_json(out_dir / "metrics.json", metrics_payload)
    return {
        "status": "done",
        "val_metrics": val_metrics,
        "best_params": best_params,
        "cv_best_score": cv_best_score,
        "train_seconds": round(train_seconds, 3),
    }


def _train_classification_candidate(
    name: str,
    estimator: Any,
    param_grid: dict[str, list[Any]],
    splits: dict[str, pd.DataFrame],
    stats: NeighborhoodStats,
    out_dir: Path,
) -> dict[str, Any]:
    """Tune, calibrate and persist one classification candidate (SIMULATED target)."""
    started = time.perf_counter()
    train, val = splits["train"], splits["val"]
    X_train = build_feature_frame(train, stats=stats)
    y_train = train[_CLASSIFICATION_TARGET].astype(int).to_numpy()
    X_val = build_feature_frame(val, stats=stats)
    y_val = val[_CLASSIFICATION_TARGET].astype(int).to_numpy()

    _pin_estimator_n_jobs(estimator)  # §4.5: candidate_grids ships n_jobs=-1
    best_pipeline, best_params, best_cv = tune_on_train(
        name, estimator, param_grid, X_train, y_train
    )
    calibrated = fit_calibrated(best_pipeline, X_train, y_train)

    proba_raw = best_pipeline.predict_proba(X_val)[:, 1]
    proba_calibrated = calibrated.predict_proba(X_val)[:, 1]
    threshold = pick_f1_threshold(y_val, proba_calibrated).threshold
    val_metrics = classification_metrics(y_val, proba_calibrated, threshold)

    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(calibrated, out_dir / "model.joblib")
    joblib.dump(best_pipeline, out_dir / "model_raw.joblib")
    pd.DataFrame(
        {
            "Id": val["Id"].to_numpy(),
            "y_true": y_val,
            "proba_raw": proba_raw,
            "proba_calibrated": proba_calibrated,
        }
    ).to_csv(out_dir / "val_predictions.csv", index=False)

    train_seconds = time.perf_counter() - started
    metrics_payload = {
        "candidate": name,
        "objective": "classification",
        "status": "done",
        "trained_at": _utc_now_iso(),
        "train_seconds": round(train_seconds, 3),
        "n_train": int(len(train)),
        "n_val": int(len(val)),
        "target": _CLASSIFICATION_TARGET,
        "simulated_target": True,
        "threshold_rule": "f1_optimal_on_val_calibrated",
        "val_metrics": val_metrics,
        "best_params": best_params,
        "cv_best_score": best_cv,
        "importance": _native_importance(best_pipeline),
    }
    _write_candidate_json(out_dir / "metrics.json", metrics_payload)
    return {
        "status": "done",
        "val_metrics": val_metrics,
        "best_params": best_params,
        "cv_best_score": best_cv,
        "train_seconds": round(train_seconds, 3),
    }


def _train_clustering_candidate(
    splits: dict[str, pd.DataFrame],
    stats: NeighborhoodStats,
    out_dir: Path,
) -> dict[str, Any]:
    """Run DBSCAN micro-market clustering on the sandbox neighborhood matrix."""
    started = time.perf_counter()
    frame = build_neighborhood_matrix(stats=stats)
    X = frame[list(FEATURE_COLUMNS)].to_numpy(dtype=float)
    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)

    min_samples, eps, _labels, _trace, rationale = select_dbscan_params(X_scaled)
    model = _fit_dbscan(X_scaled, eps, min_samples)
    labels = model.labels_
    n_clusters, n_noise = count_clusters(labels)

    cluster_stats, assignments = build_cluster_stats(frame, labels, splits["train"])
    cluster_stats.update(
        {
            "n_clusters": n_clusters,
            "eps": float(eps),
            "min_samples": int(min_samples),
            "feature_names": list(FEATURE_COLUMNS),
        }
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, out_dir / "model.joblib")
    joblib.dump(scaler, out_dir / "scaler.joblib")
    _write_candidate_json(out_dir / "cluster_stats.json", cluster_stats)
    assignments.to_csv(out_dir / "cluster_assignments.csv", index=False)
    # The 25-row matrix powers the evaluation payload's nearest-centroid
    # fallback (computed from the job's own scaler + matrix, §5.4).
    matrix = frame.copy()
    matrix["cluster_id"] = labels.astype(int)
    matrix.to_csv(out_dir / "neighborhood_matrix.csv", index=False)

    train_seconds = time.perf_counter() - started
    noise_neighborhoods = sorted(
        frame.loc[labels == -1, "Neighborhood"].astype(str).tolist()
    )
    val_metrics = {
        "n_clusters": int(n_clusters),
        "n_noise": int(n_noise),
        "eps": float(eps),
        "min_samples": int(min_samples),
    }
    metrics_payload = {
        "candidate": "dbscan",
        "objective": "clustering",
        "status": "done",
        "trained_at": _utc_now_iso(),
        "train_seconds": round(train_seconds, 3),
        "n_train": int(len(splits["train"])),
        "n_val": None,  # clustering is unsupervised — no val scoring exists (§7)
        "val_metrics": val_metrics,
        "best_params": {"eps": float(eps), "min_samples": int(min_samples)},
        "cv_best_score": None,
        "noise_neighborhoods": noise_neighborhoods,
        "rationale": rationale,
        "importance": None,
    }
    _write_candidate_json(out_dir / "metrics.json", metrics_payload)
    return {
        "status": "done",
        "val_metrics": val_metrics,
        "best_params": {"eps": float(eps), "min_samples": int(min_samples)},
        "cv_best_score": None,
        "train_seconds": round(train_seconds, 3),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def train_objective(
    dataset_id: str,
    job_dir: Path,
    objective: str,
    candidates: list[str],
    progress_cb: ProgressCallback | None = None,
) -> dict[str, dict[str, Any]]:
    """Train ``candidates`` for ``objective`` on the prepared dataset's splits.

    Every candidate is trained independently: a failure is recorded as
    ``{"status": "failed", "error": ...}`` and the wave continues (a failed
    candidate never fails the stage, §6.4). Artifacts go to
    ``<job_dir>/candidates/<name>/``; ``job_dir`` must resolve inside the
    dataset's sandbox root (asserted, §4.1).

    Args:
        dataset_id: prepared workflow dataset (``ames`` or ``ds_…``).
        job_dir: per-job directory under ``models/workflow/<dataset_id>/jobs/``.
        objective: ``"regression" | "classification" | "clustering"``.
        candidates: subset of :func:`valid_candidates` for the objective.
        progress_cb: optional callback invoked with ``{"event", "candidate", …}``
            dicts (:data:`EVENT_CANDIDATE_STARTED` / ``_DONE` / ``_FAILED``) so
            the job runner can rewrite ``status.json`` after every candidate.

    Returns:
        ``{candidate: result}`` — done entries carry ``val_metrics``,
        ``best_params``, ``cv_best_score``, ``train_seconds``; failed entries
        carry ``error``.

    Raises:
        UnknownObjectiveError / UnknownCandidateError: invalid request (422).
        UnknownDataset: unknown dataset id (404).
        FileNotFoundError: dataset not prepared — the job runner auto-prepares
            with the default config first (§3.9).
    """
    candidates = _check_candidates(objective, list(candidates))
    job_dir = _assert_job_dir_contained(dataset_id, job_dir)

    def _emit(event: dict[str, Any]) -> None:
        if progress_cb is not None:
            progress_cb(event)

    splits = load_prepared_splits(dataset_id)  # FileNotFoundError -> auto-prepare
    stats = load_neighborhood_stats(sandbox_dir(dataset_id) / "neighborhood_stats.json")

    grids: dict[str, tuple[Any, dict[str, list[Any]]]] = {}
    if objective == "classification":
        y_train_all = splits["train"][_CLASSIFICATION_TARGET].astype(int).to_numpy()
        n_pos = int(y_train_all.sum())
        neg_pos_ratio = float((len(y_train_all) - n_pos) / max(n_pos, 1))
        grids = candidate_grids(neg_pos_ratio)

    results: dict[str, dict[str, Any]] = {}
    for name in candidates:
        out_dir = job_dir / "candidates" / name
        _emit({"event": EVENT_CANDIDATE_STARTED, "candidate": name})
        try:
            if objective == "regression":
                result = _train_regression_candidate(name, splits, stats, out_dir)
            elif objective == "classification":
                estimator, grid = grids[name]
                result = _train_classification_candidate(
                    name, estimator, grid, splits, stats, out_dir
                )
            else:  # clustering
                result = _train_clustering_candidate(splits, stats, out_dir)
        except Exception as exc:  # noqa: BLE001 — a failed candidate never fails the wave
            logger.exception("candidate %s failed", name)
            result = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
            _emit({"event": EVENT_CANDIDATE_FAILED, "candidate": name, "error": result["error"]})
        else:
            _emit(
                {"event": EVENT_CANDIDATE_DONE, "candidate": name, "result": _jsonable(result)}
            )
        results[name] = _jsonable(result)
    logger.info(
        "job wave complete: %s %s -> %s",
        dataset_id,
        objective,
        {name: r["status"] for name, r in results.items()},
    )
    return results
