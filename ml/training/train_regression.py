"""Sale-price regression training (SPEC §6/§7, ADR-10).

Trains five candidates — LinearRegression, Ridge, Lasso, RandomForestRegressor,
XGBRegressor — on ``log1p(SalePrice)`` using train-split-only hyperparameter
search (5-fold KFold, seed 42, log-space RMSE scoring, one-standard-error rule
for the Ridge/Lasso alpha). Every model is a self-contained sklearn Pipeline
(:func:`ml.training.common.build_preprocessor` + estimator) persisted as one
joblib under ``models/regression/``.

Outputs (all evaluated on the VAL split only — ``test.csv`` stays sealed):

- ``models/regression/{linear,ridge,lasso,random_forest,xgboost}_v1.joblib``
- ``models/regression/metrics.json`` =
  ``{model: {"val": {...metrics, "residual_interval": {...}},
  "best_params": {...}, "cv_best_score": float}}``

One MLflow run per model is logged to the ``regression`` experiment with the
best params, val metrics and the fitted pipeline artifact. No champion is
selected here — the evaluation agent owns that.

Run: ``python -m ml.training.train_regression``
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.model_selection import GridSearchCV, KFold, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor

from ml.features.pipeline import build_feature_frame
from ml.features.stats import load_neighborhood_stats
from ml.paths import FEATURE_LIST_PATH, MODELS_DIR, RANDOM_SEED
from ml.tracking import feature_version, track_run
from ml.training.common import (
    build_preprocessor,
    load_split,
    regression_metrics,
    residual_interval,
    write_json,
)

logger = logging.getLogger(__name__)

REGRESSION_DIR = MODELS_DIR / "regression"
METRICS_PATH = REGRESSION_DIR / "metrics.json"
TARGET_COLUMN = "SalePrice"

CV = KFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
#: GridSearchCV/RandomizedSearchCV scoring on the log1p target = log-space RMSE.
SCORING = "neg_root_mean_squared_error"

# Ridge/Lasso alpha grids (log-spaced; one-SE rule picks the strongest
# regularisation within one standard error of the best CV score).
RIDGE_ALPHA_GRID = np.logspace(-3, 3, 13).tolist()
LASSO_ALPHA_GRID = np.logspace(-4, 0, 13).tolist()

# Randomized search spaces for the tree models (n_iter <= 10 per SPEC §7).
RF_PARAM_DIST: dict[str, list[Any]] = {
    "model__max_depth": [None, 10, 20, 30],
    "model__min_samples_leaf": [1, 2, 4],
    "model__max_features": [0.3, 0.5, 1.0],
}
XGB_PARAM_DIST: dict[str, list[Any]] = {
    "model__max_depth": [3, 5, 7],
    "model__min_child_weight": [1, 3, 5],
    "model__reg_lambda": [1.0, 5.0, 10.0],
}
N_ITER_TREE_SEARCH = 8


def load_model_frame(
    split: str,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """Return (feature frame, log1p target, dollar target) for a processed split.

    Features come from :func:`ml.features.pipeline.build_feature_frame` with
    train-fit neighborhood stats passed explicitly; columns are reordered to
    the persisted ``models/feature_list.json`` MODEL_FEATURES list.
    """
    raw = load_split(split)
    stats = load_neighborhood_stats()
    frame = build_feature_frame(raw, stats=stats)
    features: list[str] = json.loads(FEATURE_LIST_PATH.read_text())["features"]
    X = frame[features]
    y_dollar = raw[TARGET_COLUMN].astype(float)
    y_log = pd.Series(np.log1p(y_dollar), name=f"log1p_{TARGET_COLUMN}")
    return X, y_log, y_dollar


def make_pipeline(X: pd.DataFrame, estimator: Any) -> Pipeline:
    """Build a self-contained preprocessing + estimator pipeline."""
    return Pipeline(
        steps=[("preprocess", build_preprocessor(X)), ("model", estimator)]
    )


def one_se_alpha(cv_results: dict[str, Any], alphas: list[float]) -> tuple[float, float]:
    """One-standard-error rule over a GridSearchCV alpha grid.

    Picks the largest alpha (strongest regularisation) whose mean CV score is
    within one standard error (std of fold scores / sqrt(n_folds)) of the best
    mean score. Returns ``(chosen_alpha, best_mean_score)``.
    """
    means = np.asarray(cv_results["mean_test_score"], dtype=float)
    stds = np.asarray(cv_results["std_test_score"], dtype=float)
    best_idx = int(np.argmax(means))
    threshold = means[best_idx] - stds[best_idx] / np.sqrt(CV.get_n_splits())
    eligible = [a for a, m in zip(alphas, means, strict=True) if m >= threshold]
    return float(max(eligible)), float(means[best_idx])


def _val_report(
    pipeline: Pipeline, X_val: pd.DataFrame, y_val_log: pd.Series, y_val_dollar: pd.Series
) -> dict[str, Any]:
    """Dollar-scale metrics + log-space RMSE + residual interval on val."""
    pred_log = np.asarray(pipeline.predict(X_val), dtype=float)
    metrics = regression_metrics(np.expm1(y_val_log.to_numpy()), np.expm1(pred_log))
    metrics["rmse_log"] = float(
        np.sqrt(np.mean((y_val_log.to_numpy() - pred_log) ** 2))
    )
    metrics["residual_interval"] = residual_interval(y_val_log.to_numpy(), pred_log)
    return metrics


def _train_linear(
    X_train: pd.DataFrame, y_train_log: pd.Series
) -> tuple[Pipeline, dict[str, Any], float | None]:
    """Plain LinearRegression — no hyperparameters to tune."""
    pipeline = make_pipeline(X_train, LinearRegression())
    pipeline.fit(X_train, y_train_log)
    return pipeline, {}, None


def _train_alpha_model(
    name: str,
    X_train: pd.DataFrame,
    y_train_log: pd.Series,
    estimator: Any,
    alphas: list[float],
) -> tuple[Pipeline, dict[str, Any], float]:
    """Grid-search alpha on train CV, refit with the one-SE-rule alpha."""
    pipeline = make_pipeline(X_train, estimator)
    search = GridSearchCV(
        pipeline,
        param_grid={"model__alpha": alphas},
        scoring=SCORING,
        cv=CV,
        n_jobs=-1,
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
    # cv_best_score is the score of the alpha actually shipped (log RMSE, positive).
    chosen_mean = float(search.cv_results_["mean_test_score"][alphas.index(alpha)])
    return final, {"alpha": alpha}, -chosen_mean


def _train_randomized(
    X_train: pd.DataFrame,
    y_train_log: pd.Series,
    estimator: Any,
    param_dist: dict[str, list[Any]],
) -> tuple[Pipeline, dict[str, Any], float]:
    """Randomized-search a tree model on train CV and ship the best refit."""
    pipeline = make_pipeline(X_train, estimator)
    search = RandomizedSearchCV(
        pipeline,
        param_distributions=param_dist,
        n_iter=N_ITER_TREE_SEARCH,
        scoring=SCORING,
        cv=CV,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    search.fit(X_train, y_train_log)
    best_params = {
        k.removeprefix("model__"): v for k, v in search.best_params_.items()
    }
    return search.best_estimator_, best_params, float(-search.best_score_)


def train_all() -> dict[str, dict[str, Any]]:
    """Train, tune, evaluate and persist all five regression candidates.

    Returns the metrics payload also written to ``models/regression/metrics.json``.
    """
    X_train, y_train_log, _ = load_model_frame("train")
    X_val, y_val_log, y_val_dollar = load_model_frame("val")
    logger.info("train %s, val %s, %d features", X_train.shape, X_val.shape, X_train.shape[1])

    trainers = {
        "linear": lambda: _train_linear(X_train, y_train_log),
        "ridge": lambda: _train_alpha_model(
            "ridge", X_train, y_train_log, Ridge(max_iter=10000), RIDGE_ALPHA_GRID
        ),
        "lasso": lambda: _train_alpha_model(
            "lasso", X_train, y_train_log, Lasso(max_iter=10000), LASSO_ALPHA_GRID
        ),
        "random_forest": lambda: _train_randomized(
            X_train,
            y_train_log,
            RandomForestRegressor(
                n_estimators=300, n_jobs=-1, random_state=RANDOM_SEED
            ),
            RF_PARAM_DIST,
        ),
        "xgboost": lambda: _train_randomized(
            X_train,
            y_train_log,
            XGBRegressor(
                n_estimators=500,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                tree_method="hist",
                random_state=RANDOM_SEED,
            ),
            XGB_PARAM_DIST,
        ),
    }

    feature_ver = feature_version(FEATURE_LIST_PATH)
    REGRESSION_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict[str, Any]] = {}
    for name, trainer in trainers.items():
        start = time.perf_counter()
        pipeline, best_params, cv_best_score = trainer()
        val_metrics = _val_report(pipeline, X_val, y_val_log, y_val_dollar)
        elapsed = time.perf_counter() - start

        artifact_path = REGRESSION_DIR / f"{name}_v1.joblib"
        joblib.dump(pipeline, artifact_path)
        results[name] = {
            "val": val_metrics,
            "best_params": best_params,
            "cv_best_score": cv_best_score,
        }
        logger.info(
            "%s: val rmsle=%.4f rmse_log=%.4f mae=%.0f r2=%.4f (%.1fs)",
            name,
            val_metrics["rmsle"],
            val_metrics["rmse_log"],
            val_metrics["mae"],
            val_metrics["r2"],
            elapsed,
        )

        with track_run(
            "regression",
            f"{name}_v1",
            params=best_params,
            tags={"feature_version": feature_ver},
        ) as (mlflow, _run):
            import mlflow.sklearn  # local import: keep mlflow out of module import cost

            flat = {k: v for k, v in val_metrics.items() if k != "residual_interval"}
            mlflow.log_metrics({f"val_{k}": v for k, v in flat.items()})
            mlflow.log_metrics(
                {f"val_interval_{k}": v for k, v in val_metrics["residual_interval"].items()}
            )
            if cv_best_score is not None:
                mlflow.log_metric("cv_best_score_log_rmse", cv_best_score)
            # cloudpickle: mlflow 3.15's default 'skops' format rejects
            # numpy.dtype in fitted sklearn pipelines (untrusted type).
            mlflow.sklearn.log_model(pipeline, "model", serialization_format="cloudpickle")

    write_json(METRICS_PATH, results)
    logger.info("wrote %s", METRICS_PATH)
    return results


def main() -> None:
    """CLI entry point: train all regression candidates and report val metrics."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    results = train_all()
    rows = {
        name: {
            "mae": round(r["val"]["mae"], 0),
            "rmse": round(r["val"]["rmse"], 0),
            "r2": round(r["val"]["r2"], 4),
            "rmsle": round(r["val"]["rmsle"], 4),
            "rmse_log": round(r["val"]["rmse_log"], 4),
        }
        for name, r in results.items()
    }
    logger.info("val summary:\n%s", pd.DataFrame(rows).T.to_string())


if __name__ == "__main__":
    main()
