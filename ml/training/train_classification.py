"""Train sells-within-30-days classifiers (SPEC §6/§7).

TARGET IS SIMULATED (ADR-3): ``sells_within_30_days`` is derived from the
transparent, seeded days-on-market simulation in ``ml/data/sale_speed.py``.
Every metric/figure produced here is labelled accordingly — these are NOT
real-world performance claims, though the ML rigor (time-based split,
train-only tuning, calibration) is fully real.

Pipeline per candidate model:

1. Features: ``build_feature_frame`` (train-fit neighborhood stats artifact)
   subset to the ``models/feature_list.json`` feature list (SPEC §14).
2. Preprocessing: ``ml.training.common.build_preprocessor`` inside each
   sklearn ``Pipeline`` so saved joblibs are self-contained.
3. Tuning: 5-fold stratified CV on the TRAIN split only,
   ``scoring="average_precision"`` (PR-AUC — primary metric for the
   ~25% positive-rate target). Imbalance-aware: ``class_weight="balanced"``
   for logistic/decision-tree/random-forest, ``scale_pos_weight`` for XGBoost.
4. Calibration: a sigmoid ``CalibratedClassifierCV(cv=5)`` refit of the tuned
   pipeline on train. Both ``{name}_v1.joblib`` and
   ``{name}_calibrated_v1.joblib`` are saved under ``models/classification/``.
5. Evaluation on the VAL split only (test stays sealed): ROC-AUC, PR-AUC,
   precision/recall/F1 at threshold 0.5, Brier score, confusion matrix —
   for raw and calibrated variants — into ``models/classification/metrics.json``.
   No champion selection happens here (owned by a later agent).

Run: ``.venv/Scripts/python.exe -m ml.training.train_classification``
"""
from __future__ import annotations

import json
import logging
import os
import time

# MLflow 3.15 raises on the filesystem tracking backend unless this opt-out is
# set; SPEC §7/ADR-8 mandate the local ./mlruns file store via ml.tracking.
# Set here (before mlflow is lazily imported by ml.tracking.track_run) so the
# trainer works regardless of the caller's environment.
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
from pathlib import Path
from typing import Any

import joblib
import matplotlib

matplotlib.use("Agg")  # headless rendering — no display on this machine

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

from ml.features.pipeline import MODEL_FEATURES, build_feature_frame
from ml.features.stats import load_neighborhood_stats
from ml.paths import FEATURE_LIST_PATH, FIGURES_DIR, MODELS_DIR, RANDOM_SEED
from ml.tracking import (
    feature_version,
    log_dict_artifact,
    track_run,
)
from ml.training.common import build_preprocessor, load_split, write_json

logger = logging.getLogger(__name__)

#: Classification target (SIMULATED — ADR-3, see module docstring).
TARGET = "sells_within_30_days"

#: MLflow experiment name (per-agent, SPEC §7).
EXPERIMENT = "classification"

#: Artifact directory owned by this agent.
MODEL_DIR = MODELS_DIR / "classification"

#: Decision threshold for precision/recall/F1 and the confusion matrix.
THRESHOLD = 0.5

#: Model names, matching the SPEC §6 artifact contract.
MODEL_NAMES = ("logistic", "decision_tree", "random_forest", "xgboost")

#: Metric keys stored per variant (val / val_calibrated) in metrics.json.
METRIC_KEYS = (
    "roc_auc",
    "pr_auc",
    "precision",
    "recall",
    "f1",
    "brier",
    "threshold",
    "confusion_matrix",
)

_CALIBRATION_FIG = "classification_calibration.png"
_CURVES_FIG = "classification_curves.png"

#: skops trust list for mlflow 3.15 model logging — covers every fitted
#: object graph this trainer logs (verified against all four model families,
#: raw + calibrated). First-party types only; our own locally trained models.
_SKOPS_TRUSTED_TYPES = [
    "numpy.dtype",
    "sklearn.calibration._CalibratedClassifier",
    "sklearn.calibration._SigmoidCalibration",
    "sklearn.model_selection._split.StratifiedKFold",
    "xgboost.sklearn.XGBClassifier",
    "xgboost.core.Booster",
]


def _log_sklearn_model(model: Any, artifact_name: str) -> None:
    """Log a fitted pipeline to MLflow with an explicit skops trust list.

    ``ml.tracking.log_model_artifact`` (lead-provided) has no
    ``skops_trusted_types`` passthrough, and mlflow 3.15's skops-based sklearn
    flavor otherwise rejects every fitted sklearn pipeline over
    ``numpy.dtype`` (plus private calibration/xgboost types). These are
    locally trained first-party models, so trusting them is safe. Must be
    called inside an active run.
    """
    import mlflow.sklearn

    mlflow.sklearn.log_model(
        model, artifact_name, skops_trusted_types=_SKOPS_TRUSTED_TYPES
    )


def candidate_grids(neg_pos_ratio: float) -> dict[str, tuple[Any, dict[str, list[Any]]]]:
    """Return ``{name: (estimator, param_grid)}`` for the four candidates.

    All estimators are imbalance-aware (train positive rate ~0.25):
    ``class_weight="balanced"`` for the sklearn models and
    ``scale_pos_weight = neg/pos`` for XGBoost. Grids are deliberately small —
    the train split has only 945 rows.

    Args:
        neg_pos_ratio: ``n_negative / n_positive`` on the train split, used as
            XGBoost's ``scale_pos_weight``.
    """
    return {
        "logistic": (
            LogisticRegression(
                max_iter=2000, class_weight="balanced", random_state=RANDOM_SEED
            ),
            {"model__C": [0.1, 1.0, 10.0]},
        ),
        "decision_tree": (
            DecisionTreeClassifier(
                class_weight="balanced", random_state=RANDOM_SEED
            ),
            {
                "model__max_depth": [3, 5, 8, 12, None],
                "model__min_samples_leaf": [1, 5, 10, 20],
            },
        ),
        "random_forest": (
            RandomForestClassifier(
                n_estimators=300,
                n_jobs=-1,
                class_weight="balanced",
                random_state=RANDOM_SEED,
            ),
            {
                "model__max_depth": [None, 12],
                "model__min_samples_leaf": [1, 5],
            },
        ),
        "xgboost": (
            XGBClassifier(
                tree_method="hist",
                scale_pos_weight=neg_pos_ratio,
                eval_metric="aucpr",
                random_state=RANDOM_SEED,
            ),
            {
                "model__n_estimators": [200, 400],
                "model__max_depth": [3, 5],
                "model__learning_rate": [0.05, 0.1],
            },
        ),
    }


def tune_on_train(
    name: str,
    estimator: Any,
    param_grid: dict[str, list[Any]],
    X_train: pd.DataFrame,
    y_train: np.ndarray,
) -> tuple[Pipeline, dict[str, Any], float]:
    """Grid-search ``estimator`` inside a preprocessing pipeline on TRAIN only.

    Uses 5-fold stratified CV with ``scoring="average_precision"`` and
    refits the winner on the full train split. ``GridSearchCV`` runs single-
    threaded: tree estimators already parallelise internally (``n_jobs``),
    which avoids nested joblib spawn storms on Windows.

    Returns:
        ``(best_pipeline, best_params_without_prefix, best_cv_score)``.
    """
    pipeline = Pipeline(
        steps=[("preprocess", build_preprocessor(X_train)), ("model", estimator)]
    )
    search = GridSearchCV(
        pipeline,
        param_grid,
        scoring="average_precision",
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED),
        n_jobs=1,
        refit=True,
    )
    started = time.perf_counter()
    search.fit(X_train, y_train)
    best_params = {
        key.replace("model__", ""): value for key, value in search.best_params_.items()
    }
    logger.info(
        "%s: CV done in %.1fs — best average_precision=%.4f, params=%s",
        name,
        time.perf_counter() - started,
        search.best_score_,
        best_params,
    )
    return search.best_estimator_, best_params, float(search.best_score_)


def fit_calibrated(pipeline: Pipeline, X_train: pd.DataFrame, y_train: np.ndarray) -> CalibratedClassifierCV:
    """Fit a sigmoid ``CalibratedClassifierCV(cv=5)`` copy of ``pipeline`` on train."""
    calibrated = CalibratedClassifierCV(
        estimator=clone(pipeline),
        method="sigmoid",
        cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED),
    )
    calibrated.fit(X_train, y_train)
    return calibrated


def classification_metrics(
    y_true: np.ndarray, proba: np.ndarray, threshold: float = THRESHOLD
) -> dict[str, Any]:
    """Full val metric bundle for one probability vector.

    ROC-AUC, PR-AUC (average precision), precision/recall/F1 at ``threshold``,
    Brier score, and the confusion matrix as a labelled count dict.
    """
    y_true = np.asarray(y_true, dtype=int)
    proba = np.asarray(proba, dtype=float)
    pred = (proba >= threshold).astype(int)
    cm = confusion_matrix(y_true, pred, labels=[0, 1])
    return {
        "roc_auc": float(roc_auc_score(y_true, proba)),
        "pr_auc": float(average_precision_score(y_true, proba)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "brier": float(brier_score_loss(y_true, proba)),
        "threshold": float(threshold),
        "confusion_matrix": {
            "tn": int(cm[0, 0]),
            "fp": int(cm[0, 1]),
            "fn": int(cm[1, 0]),
            "tp": int(cm[1, 1]),
        },
    }


def plot_calibration_curves(
    calibrated_models: dict[str, CalibratedClassifierCV],
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    path: Path,
) -> Path:
    """Reliability diagram for every calibrated model + the perfect line."""
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot([0, 1], [0, 1], "k--", linewidth=1.0, label="perfectly calibrated")
    for name, model in calibrated_models.items():
        proba = model.predict_proba(X_val)[:, 1]
        frac_pos, mean_pred = calibration_curve(
            y_val, proba, n_bins=10, strategy="quantile"
        )
        ax.plot(mean_pred, frac_pos, marker="o", markersize=4, label=name)
    ax.set_xlabel("mean predicted probability (val)")
    ax.set_ylabel("fraction of positives (val)")
    ax.set_title(
        "Calibration curves — sells_within_30_days\n"
        "SIMULATED target (ADR-3), val split, sigmoid-calibrated models"
    )
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", fontsize=9)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("wrote calibration figure to %s", path)
    return path


def plot_best_model_curves(
    model: CalibratedClassifierCV,
    name: str,
    X_val: pd.DataFrame,
    y_val: np.ndarray,
    path: Path,
) -> Path:
    """ROC + precision/recall curves for the best-by-PR-AUC calibrated model."""
    proba = model.predict_proba(X_val)[:, 1]
    fpr, tpr, _ = roc_curve(y_val, proba)
    prec, rec, _ = precision_recall_curve(y_val, proba)
    roc_auc = roc_auc_score(y_val, proba)
    pr_auc = average_precision_score(y_val, proba)
    pos_rate = float(np.mean(y_val))

    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].plot(fpr, tpr, label=f"{name} (AUC = {roc_auc:.3f})")
    axes[0].plot([0, 1], [0, 1], "k--", linewidth=1.0, label="chance")
    axes[0].set_xlabel("false positive rate")
    axes[0].set_ylabel("true positive rate")
    axes[0].set_title("ROC curve (val)")
    axes[0].legend(loc="lower right", fontsize=9)

    axes[1].plot(rec, prec, label=f"{name} (AP = {pr_auc:.3f})")
    axes[1].axhline(
        pos_rate,
        color="k",
        linestyle="--",
        linewidth=1.0,
        label=f"prevalence = {pos_rate:.3f}",
    )
    axes[1].set_xlabel("recall")
    axes[1].set_ylabel("precision")
    axes[1].set_title("Precision–recall curve (val)")
    axes[1].legend(loc="upper right", fontsize=9)

    fig.suptitle(
        f"Best calibrated model by val PR-AUC: {name} — "
        "SIMULATED target (ADR-3)"
    )
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("wrote ROC/PR figure to %s", path)
    return path


def load_model_feature_list() -> list[str]:
    """Read the feature list artifact (SPEC §14: training agents read it)."""
    payload = json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))
    features = list(payload["features"])
    if features != MODEL_FEATURES:
        raise ValueError(
            "models/feature_list.json is out of sync with ml.features.pipeline "
            "MODEL_FEATURES — regenerate via `python -m ml.features.pipeline`"
        )
    return features


def train_all() -> dict[str, Any]:
    """Train, calibrate, evaluate, and persist all four candidates.

    Returns the ``metrics.json`` payload: ``{model: {val, val_calibrated,
    best_params}}``. The test split is never touched.
    """
    train = load_split("train")
    val = load_split("val")
    stats = load_neighborhood_stats()
    features = load_model_feature_list()

    X_train = build_feature_frame(train, stats)[features]
    y_train = train[TARGET].astype(int).to_numpy()
    X_val = build_feature_frame(val, stats)[features]
    y_val = val[TARGET].astype(int).to_numpy()

    pos_rate = float(y_train.mean())
    neg_pos_ratio = float((len(y_train) - y_train.sum()) / y_train.sum())
    fv = feature_version(FEATURE_LIST_PATH)
    logger.info(
        "train=%d rows (positive rate %.4f, neg/pos %.3f), val=%d rows, "
        "%d features, feature_version=%s — TARGET IS SIMULATED (ADR-3)",
        len(X_train),
        pos_rate,
        neg_pos_ratio,
        len(X_val),
        len(features),
        fv,
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, Any] = {}
    calibrated_models: dict[str, CalibratedClassifierCV] = {}

    for name, (estimator, grid) in candidate_grids(neg_pos_ratio).items():
        best_pipeline, best_params, best_cv = tune_on_train(
            name, estimator, grid, X_train, y_train
        )
        calibrated = fit_calibrated(best_pipeline, X_train, y_train)

        joblib.dump(best_pipeline, MODEL_DIR / f"{name}_v1.joblib")
        joblib.dump(calibrated, MODEL_DIR / f"{name}_calibrated_v1.joblib")

        val_raw = classification_metrics(y_val, best_pipeline.predict_proba(X_val)[:, 1])
        val_cal = classification_metrics(y_val, calibrated.predict_proba(X_val)[:, 1])
        results[name] = {
            "val": val_raw,
            "val_calibrated": val_cal,
            "best_params": best_params,
        }
        calibrated_models[name] = calibrated

        with track_run(
            EXPERIMENT,
            f"{name}_v1",
            params={
                "model": name,
                "cv_scoring": "average_precision",
                "cv_best_average_precision": round(best_cv, 6),
                "calibration": "sigmoid_cv5",
                **{f"best_{k}": v for k, v in best_params.items()},
            },
            tags={
                "feature_version": fv,
                "target": TARGET,
                "simulated_target": "true (ADR-3 — not a real-world performance claim)",
            },
        ) as (mlflow, _run):
            mlflow.log_metrics({f"val_{k}": v for k, v in val_raw.items() if k != "confusion_matrix"})
            mlflow.log_metrics(
                {f"val_calibrated_{k}": v for k, v in val_cal.items() if k != "confusion_matrix"}
            )
            _log_sklearn_model(best_pipeline, "model")
            _log_sklearn_model(calibrated, "model_calibrated")
            log_dict_artifact(
                results[name], f"{name}_classification_metrics.json"
            )

        logger.info(
            "%s: val ROC-AUC=%.4f PR-AUC=%.4f brier=%.4f | calibrated "
            "ROC-AUC=%.4f PR-AUC=%.4f brier=%.4f",
            name,
            val_raw["roc_auc"],
            val_raw["pr_auc"],
            val_raw["brier"],
            val_cal["roc_auc"],
            val_cal["pr_auc"],
            val_cal["brier"],
        )

    write_json(MODEL_DIR / "metrics.json", results)

    plot_calibration_curves(
        calibrated_models, X_val, y_val, FIGURES_DIR / _CALIBRATION_FIG
    )
    best_name = max(results, key=lambda n: results[n]["val_calibrated"]["pr_auc"])
    plot_best_model_curves(
        calibrated_models[best_name],
        best_name,
        X_val,
        y_val,
        FIGURES_DIR / _CURVES_FIG,
    )
    logger.info(
        "done. best calibrated PR-AUC model: %s (champion selection is NOT "
        "done here — owned by the evaluation wave)",
        best_name,
    )
    return results


def main() -> None:
    """CLI entry point."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    train_all()


if __name__ == "__main__":
    main()
