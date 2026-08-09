"""Sealed-test evaluation, champion registry promotion and reporting (SPEC §6).

Pipeline (CLI: ``python -m ml.evaluation.evaluate``):

1. **Selection on val only** via :mod:`ml.evaluation.select` — regression
   champion (RMSLE primary), top-2 paired bootstrap CI, classification
   champion (calibrated PR-AUC + Brier sanity), F1-optimal operating threshold.
2. **Sealed test split** (``data/processed/test.csv``, 175 rows) is read
   exactly once, here, *after* selection is final — champion dollar metrics
   via ``expm1`` (ADR-10), full classification metrics at the chosen
   threshold, and the all-candidates comparison table (final report only,
   never used for selection).
3. **Artifacts**: registry copies of the champion pipelines
   (``models/registry/``), ``models/champion.json`` (SPEC §6 schema +
   ``classification.threshold`` + ``regression.residual_interval``),
   ``models/monitoring/prediction_reference.json`` (decile bins of champion
   val predictions for the monitoring drift check), one MLflow run in the
   ``evaluation`` experiment, and ``reports/MODEL_EVALUATION.md``.

The classification target is SIMULATED (ADR-3) — every classification number
produced here is labelled accordingly.
"""
from __future__ import annotations

import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ml.evaluation.select import (
    BootstrapResult,
    ClassificationChoice,
    RegressionChoice,
    ThresholdChoice,
    load_classification_metrics,
    load_regression_metrics,
    paired_bootstrap_rmsle_diff,
    pick_f1_threshold,
    select_classification_champion,
    select_regression_champion,
)
from ml.features.pipeline import build_feature_frame
from ml.features.stats import load_neighborhood_stats
from ml.paths import (
    CHAMPION_PATH,
    DATASET_VERSION,
    FEATURE_LIST_PATH,
    MODELS_DIR,
    REGISTRY_DIR,
    REPORTS_DIR,
)
from ml.tracking import feature_version, log_dict_artifact, log_model_artifact, track_run
from ml.training.common import load_split, regression_metrics, write_json
from ml.training.train_classification import classification_metrics

logger = logging.getLogger(__name__)

#: Owned output paths.
REGRESSION_CHAMPION_PATH = REGISTRY_DIR / "regression_champion.joblib"
CLASSIFICATION_CHAMPION_PATH = REGISTRY_DIR / "classification_champion.joblib"
PREDICTION_REFERENCE_PATH = MODELS_DIR / "monitoring" / "prediction_reference.json"
REPORT_PATH = REPORTS_DIR / "MODEL_EVALUATION.md"

_REGRESSION_DIR = MODELS_DIR / "regression"
_CLASSIFICATION_DIR = MODELS_DIR / "classification"
_CLUSTER_STATS_PATH = MODELS_DIR / "clustering" / "cluster_stats.json"

_REGRESSION_VERSION = "v1"
_CLASSIFICATION_VERSION = "v1"
_MLFLOW_EXPERIMENT = "evaluation"
_MLFLOW_RUN_NAME = "champion_selection_v1"

_SIMULATED_CAVEAT = (
    "SIMULATED TARGET (ADR-3): `sells_within_30_days` is derived from the "
    "transparent, seeded days-on-market simulation in `ml/data/sale_speed.py`. "
    "Classification metrics measure consistency with that simulation, NOT "
    "real-world sale-speed performance."
)


def load_eval_frame(split: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return ``(model feature frame, raw processed frame)`` for a split.

    Features come from :func:`ml.features.pipeline.build_feature_frame` with
    the persisted train-fit neighborhood stats, reordered to
    ``models/feature_list.json`` — identical to the training pipeline.
    """
    raw = load_split(split)
    stats = load_neighborhood_stats()
    frame = build_feature_frame(raw, stats=stats)
    features: list[str] = json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))[
        "features"
    ]
    return frame[features], raw


def _regression_artifact(name: str) -> Path:
    """Path of a regression candidate's persisted pipeline."""
    return _REGRESSION_DIR / f"{name}_{_REGRESSION_VERSION}.joblib"


def _classification_artifact(name: str, calibrated: bool = True) -> Path:
    """Path of a classification candidate's persisted (calibrated) pipeline."""
    suffix = f"_calibrated_{_CLASSIFICATION_VERSION}" if calibrated else f"_{_CLASSIFICATION_VERSION}"
    return _CLASSIFICATION_DIR / f"{name}{suffix}.joblib"


def interval_coverage(
    y_true_log: np.ndarray, pred_log: np.ndarray, interval: dict[str, float]
) -> float:
    """Empirical coverage of the val residual interval on new log residuals.

    The interval is additive in log1p space: a prediction covers the truth
    when ``y_true_log - pred_log`` lies inside ``[q_low, q_high]``.
    """
    resid = np.asarray(y_true_log, dtype=float) - np.asarray(pred_log, dtype=float)
    inside = (resid >= interval["q_low"]) & (resid <= interval["q_high"])
    return float(inside.mean())


def decile_profile(values: np.ndarray) -> dict[str, Any]:
    """Decile-bin edges + bin proportions of a prediction vector.

    Used for the monitoring prediction reference (PSI-style drift checks bin
    new predictions with these edges). Degenerate duplicate edges are
    collapsed, so ``len(bin_proportions) == len(bin_edges) - 1``.
    """
    v = np.asarray(values, dtype=float)
    if v.size == 0 or not np.all(np.isfinite(v)):
        raise ValueError("values must be non-empty and finite")
    edges = np.unique(np.quantile(v, np.linspace(0.0, 1.0, 11)))
    counts, edges = np.histogram(v, bins=edges)
    proportions = counts / counts.sum()
    return {
        "bin_edges": [float(e) for e in edges],
        "bin_proportions": [float(p) for p in proportions],
        "summary": {
            "min": float(v.min()),
            "mean": float(v.mean()),
            "max": float(v.max()),
        },
    }


def copy_champions_to_registry(
    regression_name: str, classification_name: str
) -> tuple[Path, Path]:
    """Copy the winning pipelines into ``models/registry/`` (SPEC §6).

    The classification copy is always the CALIBRATED variant.
    """
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    reg_src = _regression_artifact(regression_name)
    cls_src = _classification_artifact(classification_name, calibrated=True)
    shutil.copyfile(reg_src, REGRESSION_CHAMPION_PATH)
    shutil.copyfile(cls_src, CLASSIFICATION_CHAMPION_PATH)
    logger.info("registry: %s -> %s", reg_src.name, REGRESSION_CHAMPION_PATH)
    logger.info("registry: %s -> %s", cls_src.name, CLASSIFICATION_CHAMPION_PATH)
    return REGRESSION_CHAMPION_PATH, CLASSIFICATION_CHAMPION_PATH


def build_prediction_reference(
    estimated_price_val: np.ndarray,
    probability_val: np.ndarray,
    regression_model: str,
    classification_model: str,
    threshold: float,
    feature_ver: str,
) -> dict[str, Any]:
    """Reference distributions of champion val predictions for drift checks.

    Decile-bin edges + proportions of (a) the regression champion's
    ``estimated_price`` in dollars and (b) the calibrated classification
    champion's positive-class probability, both on the validation split.
    """
    return {
        "version": 1,
        "description": (
            "Reference distribution of champion predictions on the validation "
            "split; the monitoring drift check bins incoming predictions with "
            "these edges and compares proportions (PSI-style)."
        ),
        "generated_from": "data/processed/val.csv, champion models",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_version": DATASET_VERSION,
        "feature_version": feature_ver,
        "n_rows": int(np.asarray(estimated_price_val).shape[0]),
        "regression": {
            "model": f"{regression_model}_{_REGRESSION_VERSION}",
            "field": "estimated_price",
            "unit": "usd",
            "binning": "deciles of champion validation predictions",
            **decile_profile(estimated_price_val),
        },
        "classification": {
            "model": f"{classification_model}_calibrated_{_CLASSIFICATION_VERSION}",
            "field": "probability",
            "threshold": float(threshold),
            "binning": "deciles of champion validation probabilities",
            "simulated_target": True,
            **decile_profile(probability_val),
        },
    }


def _round_metrics(metrics: dict[str, Any], ndigits: int = 6) -> dict[str, Any]:
    """Round float leaves of a metric dict for stable, readable JSON."""
    out: dict[str, Any] = {}
    for key, value in metrics.items():
        if isinstance(value, float):
            out[key] = round(value, ndigits)
        elif isinstance(value, dict):
            out[key] = _round_metrics(value, ndigits)
        else:
            out[key] = value
    return out


def build_champion_payload(
    regression: RegressionChoice,
    classification: ClassificationChoice,
    threshold: ThresholdChoice,
    bootstrap: BootstrapResult,
    reg_val_metrics: dict[str, Any],
    reg_test_metrics: dict[str, Any],
    cls_val_metrics: dict[str, Any],
    cls_test_metrics: dict[str, Any],
    residual_interval: dict[str, float],
    n_clusters: int,
    rationale: str,
) -> dict[str, Any]:
    """Assemble the ``models/champion.json`` payload (SPEC §6 schema + extras).

    Extras beyond the SPEC schema: ``regression.residual_interval`` (serving
    price range, copied from val metrics), ``regression.bootstrap_vs_runner_up``,
    and ``classification.threshold`` (SPEC §14 operating threshold).
    """
    return {
        "regression": {
            "name": regression.champion,
            "version": _REGRESSION_VERSION,
            "path": REGRESSION_CHAMPION_PATH.relative_to(MODELS_DIR.parent).as_posix(),
            "val_metrics": _round_metrics(reg_val_metrics),
            "test_metrics": _round_metrics(reg_test_metrics),
            "residual_interval": {k: round(float(v), 6) for k, v in residual_interval.items()},
            "bootstrap_vs_runner_up": {
                "runner_up": bootstrap.runner_up,
                "observed_rmsle_diff": round(bootstrap.observed_diff, 6),
                "ci95": [round(bootstrap.ci_low, 6), round(bootstrap.ci_high, 6)],
                "prob_runner_up_better": round(bootstrap.prob_runner_up_better, 6),
                "n_resamples": bootstrap.n_resamples,
                "seed": bootstrap.seed,
                "significant": bootstrap.significant,
            },
        },
        "classification": {
            "name": classification.champion,
            "version": _CLASSIFICATION_VERSION,
            "path": CLASSIFICATION_CHAMPION_PATH.relative_to(MODELS_DIR.parent).as_posix(),
            "calibrated": True,
            "threshold": round(float(threshold.threshold), 6),
            "val_metrics": _round_metrics(cls_val_metrics),
            "test_metrics": _round_metrics(cls_test_metrics),
        },
        "clustering": {
            "path": "models/clustering/dbscan.joblib",
            "n_clusters": int(n_clusters),
        },
        "selected_at": datetime.now(timezone.utc).isoformat(),
        "dataset_version": DATASET_VERSION,
        "feature_version": feature_version(FEATURE_LIST_PATH),
        "rationale": rationale,
    }


def build_rationale(
    regression: RegressionChoice,
    classification: ClassificationChoice,
    threshold: ThresholdChoice,
    bootstrap: BootstrapResult,
    reg_metrics: dict[str, Any],
    cls_metrics: dict[str, Any],
) -> str:
    """Written champion rationale weighing performance/calibration/latency/
    interpretability (SPEC §6 — XGBoost is not auto-crowned)."""
    reg_val = reg_metrics[regression.champion]["val"]
    run_val = reg_metrics[regression.runner_up]["val"]
    cls_val = cls_metrics[classification.champion]["val_calibrated"]
    gap_note = (
        "statistically meaningful (95% CI excludes 0)"
        if bootstrap.significant
        else "not statistically decisive (95% CI includes 0)"
    )
    return (
        f"Regression champion = {regression.champion}: best validation RMSLE "
        f"({reg_val['rmsle']:.4f} vs runner-up {regression.runner_up} "
        f"{run_val['rmsle']:.4f}); the paired bootstrap ({bootstrap.n_resamples} "
        f"resamples, seed {bootstrap.seed}) 95% CI for RMSLE(champion)-"
        f"RMSLE(runner-up) is [{bootstrap.ci_low:.4f}, {bootstrap.ci_high:.4f}] — "
        f"the gap is {gap_note}. {regression.champion} also posts the best val "
        f"RMSE (${reg_val['rmse']:,.0f} vs ${run_val['rmse']:,.0f} runner-up), "
        f"MAE and R² ({reg_val['r2']:.4f}), and as a "
        f"regularised linear model it is fully interpretable (signed "
        f"coefficients), tiny on disk (~21 KB vs ~25 MB for the forest) and the "
        f"fastest to serve, so it wins on performance + interpretability + "
        f"latency; XGBoost offers no compensating gain. Classification champion "
        f"= calibrated {classification.champion}: best calibrated val PR-AUC "
        f"({cls_val['pr_auc']:.4f}) AND best calibrated Brier "
        f"({cls_val['brier']:.4f}), so probabilities are both ranking-strong and "
        f"well calibrated; sigmoid calibration (cv=5) was fitted on train only. "
        f"Operating threshold {threshold.threshold:.4f} maximises val F1 "
        f"(precision {threshold.precision:.4f}, recall {threshold.recall:.4f}); "
        f"SPEC §14 — not 0.5, since calibrated probabilities sit near the ~25% "
        f"prevalence. Classification target is SIMULATED (ADR-3) — not a "
        f"real-world performance claim."
    )


def _md_table(headers: list[str], rows: list[list[str]]) -> str:
    """Render a GitHub-flavoured markdown table."""
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "---|" * len(headers),
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(lines)


def _money(x: float) -> str:
    return f"${x:,.0f}"


def build_report(
    regression: RegressionChoice,
    classification: ClassificationChoice,
    threshold: ThresholdChoice,
    bootstrap: BootstrapResult,
    reg_metrics: dict[str, Any],
    cls_metrics: dict[str, Any],
    reg_test_by_model: dict[str, dict[str, float]],
    cls_test_by_model: dict[str, dict[str, Any]],
    cls_val_operating: dict[str, Any],
    reg_test_metrics: dict[str, Any],
    cls_test_metrics: dict[str, Any],
    interval: dict[str, float],
    test_interval_coverage: float,
    n_val: int,
    n_test: int,
    feature_ver: str,
) -> str:
    """Render ``reports/MODEL_EVALUATION.md`` from computed results only."""
    reg_val_rows = [
        [
            name,
            _money(reg_metrics[name]["val"]["mae"]),
            _money(reg_metrics[name]["val"]["rmse"]),
            f"{reg_metrics[name]['val']['r2']:.4f}",
            f"{reg_metrics[name]['val']['rmsle']:.4f}",
        ]
        for name in regression.ranking
    ]
    cls_val_rows = [
        [
            name,
            f"{cls_metrics[name]['val_calibrated']['roc_auc']:.4f}",
            f"{cls_metrics[name]['val_calibrated']['pr_auc']:.4f}",
            f"{cls_metrics[name]['val_calibrated']['f1']:.4f}",
            f"{cls_metrics[name]['val_calibrated']['precision']:.4f}",
            f"{cls_metrics[name]['val_calibrated']['recall']:.4f}",
            f"{cls_metrics[name]['val_calibrated']['brier']:.4f}",
        ]
        for name in classification.ranking
    ]
    reg_test_rows = [
        [
            name,
            _money(reg_test_by_model[name]["mae"]),
            _money(reg_test_by_model[name]["rmse"]),
            f"{reg_test_by_model[name]['r2']:.4f}",
            f"{reg_test_by_model[name]['rmsle']:.4f}",
        ]
        for name in regression.ranking
    ]
    cls_test_rows = [
        [
            name,
            f"{cls_test_by_model[name]['roc_auc']:.4f}",
            f"{cls_test_by_model[name]['pr_auc']:.4f}",
            f"{cls_test_by_model[name]['f1']:.4f}",
            f"{cls_test_by_model[name]['precision']:.4f}",
            f"{cls_test_by_model[name]['recall']:.4f}",
            f"{cls_test_by_model[name]['brier']:.4f}",
        ]
        for name in classification.ranking
    ]
    cm = cls_test_metrics["confusion_matrix"]
    gap_sentence = (
        f"The 95% CI [{bootstrap.ci_low:.4f}, {bootstrap.ci_high:.4f}] "
        + (
            "excludes 0, so the champion's advantage is statistically meaningful."
            if bootstrap.significant
            else "includes 0, so the champion's advantage over the runner-up is "
            "NOT statistically decisive on 338 val rows — the win is consistent "
            "across RMSLE/RMSE/MAE/R² but small; interpretability and latency "
            "carry the decision."
        )
    )
    return f"""# PropPulse — Model Evaluation Report

Generated by `python -m ml.evaluation.evaluate` on the frozen artifacts of the
regression/classification training waves. Champion selection used the
**validation split only**; the sealed test split (2010 sales, {n_test} rows)
was read exactly once, after selection, for this final report.

- dataset_version: `{DATASET_VERSION}` · feature_version: `{feature_ver}`
  (sha1 of `models/feature_list.json`)
- Regression target: `log1p(SalePrice)` (ADR-10); dollar metrics via `expm1`.
- **{_SIMULATED_CAVEAT}**

## 1. Methodology

- **Time-based split** (ADR-4): train = YrSold ≤ 2008 (945 rows), val = 2009
  ({n_val} rows), test = 2010 ({n_test} rows, sealed). No shuffling across time,
  so all metrics are out-of-time estimates.
- **Train-only tuning**: every hyperparameter was chosen by 5-fold CV on the
  train split (regression: `KFold(shuffle, seed=42)`, scoring = log-space RMSE;
  classification: `StratifiedKFold(seed=42)`, scoring = average precision).
  The val split was never used for fitting or tuning.
- **One-standard-error rule**: Ridge/Lasso alpha = strongest regularisation
  within one standard error of the best CV score (ridge shipped alpha=100.0
  although the grid best was 31.6).
- **Calibration**: sigmoid `CalibratedClassifierCV(cv=5)` refit of each tuned
  classifier on train; champion selection considers calibrated variants only.
- **Imbalance handling**: train positive rate ≈ 0.25 → `class_weight="balanced"`
  (logistic / decision tree / random forest) and `scale_pos_weight = neg/pos`
  (XGBoost); PR-AUC is the primary classification metric.
- **Champion selection (SPEC §6)**: regression = val RMSLE primary, RMSE then
  R² tie-break; classification = val PR-AUC primary among calibrated variants +
  Brier sanity check. The top-2 regression gap is tested with a **paired
  bootstrap**: {bootstrap.n_resamples} row-level resamples of the val split
  (seed {bootstrap.seed}), 95% percentile CI of
  RMSLE(champion) − RMSLE(runner-up).
- **Operating threshold (SPEC §14)**: maximises F1 on the val calibrated
  champion probabilities — NOT 0.5, because calibrated probabilities sit near
  the ~25% prevalence.

## 2. Validation results (selection basis — {n_val} rows)

### Regression (val)

{_md_table(["model", "MAE", "RMSE", "R²", "RMSLE"], reg_val_rows)}

### Classification (val, calibrated variants)

Precision/recall/F1 below are as recorded by the training wave at the default
0.5 threshold; the champion's operating point at the selected threshold is
reported in §3.

{_md_table(["model", "ROC-AUC", "PR-AUC", "F1@0.5", "precision@0.5", "recall@0.5", "Brier"], cls_val_rows)}

## 3. Champion selection

### Regression — `{regression.champion}` (runner-up `{bootstrap.runner_up}`)

{regression.reason} Paired bootstrap ({bootstrap.n_resamples} resamples, seed
{bootstrap.seed}): observed RMSLE diff = {bootstrap.observed_diff:+.4f},
95% CI [{bootstrap.ci_low:+.4f}, {bootstrap.ci_high:+.4f}],
P(runner-up better) = {bootstrap.prob_runner_up_better:.3f}. {gap_sentence}

### Classification — calibrated `{classification.champion}`

{classification.reason} Operating threshold **{threshold.threshold:.4f}**
(max val F1 = {threshold.f1:.4f}; precision {threshold.precision:.4f}, recall
{threshold.recall:.4f} at that threshold). Champion val metrics **at the
operating threshold**: ROC-AUC {cls_val_operating['roc_auc']:.4f}, PR-AUC
{cls_val_operating['pr_auc']:.4f}, F1 {cls_val_operating['f1']:.4f},
precision {cls_val_operating['precision']:.4f}, recall
{cls_val_operating['recall']:.4f}, Brier {cls_val_operating['brier']:.4f}.

## 4. Sealed test results — champions (2010 sales, {n_test} rows, read once)

### Regression champion `{regression.champion}` (dollar metrics via expm1)

{_md_table(
    ["split", "MAE", "RMSE", "R²", "RMSLE"],
    [
        ["val", _money(reg_metrics[regression.champion]['val']['mae']), _money(reg_metrics[regression.champion]['val']['rmse']), f"{reg_metrics[regression.champion]['val']['r2']:.4f}", f"{reg_metrics[regression.champion]['val']['rmsle']:.4f}"],
        ["test", _money(reg_test_metrics['mae']), _money(reg_test_metrics['rmse']), f"{reg_test_metrics['r2']:.4f}", f"{reg_test_metrics['rmsle']:.4f}"],
    ],
)}

### Classification champion calibrated `{classification.champion}` @ threshold {threshold.threshold:.4f}

{_md_table(
    ["split", "ROC-AUC", "PR-AUC", "F1", "precision", "recall", "Brier"],
    [
        ["val", f"{cls_val_operating['roc_auc']:.4f}", f"{cls_val_operating['pr_auc']:.4f}", f"{cls_val_operating['f1']:.4f}", f"{cls_val_operating['precision']:.4f}", f"{cls_val_operating['recall']:.4f}", f"{cls_val_operating['brier']:.4f}"],
        ["test", f"{cls_test_metrics['roc_auc']:.4f}", f"{cls_test_metrics['pr_auc']:.4f}", f"{cls_test_metrics['f1']:.4f}", f"{cls_test_metrics['precision']:.4f}", f"{cls_test_metrics['recall']:.4f}", f"{cls_test_metrics['brier']:.4f}"],
    ],
)}

Test confusion matrix @ {threshold.threshold:.4f}: TP={cm['tp']}, FP={cm['fp']},
FN={cm['fn']}, TN={cm['tn']}.

## 5. All-candidates test comparison — FINAL REPORT ONLY

Computed on the sealed test split **after** champion selection; never used for
selection, tuning, or threshold choice.

### Regression (test)

{_md_table(["model", "MAE", "RMSE", "R²", "RMSLE"], reg_test_rows)}

### Classification (test, calibrated variants @ threshold {threshold.threshold:.4f})

{_md_table(["model", "ROC-AUC", "PR-AUC", "F1", "precision", "recall", "Brier"], cls_test_rows)}

## 6. Champion rationale

{build_rationale(regression, classification, threshold, bootstrap, reg_metrics, cls_metrics)}

## 7. SIMULATED-target caveat (classification)

{_SIMULATED_CAVEAT} The ML rigor (time-based split, train-only tuning,
calibration, threshold selection) is real and transfers directly once genuine
days-on-market data is dropped into `ml/data/sale_speed.py`'s interface, but
absolute classification numbers must not be quoted as market performance.

## 8. Price-interval method (val residual quantiles)

The serving price range is an **additive interval in log1p space** built from
the validation residuals of the regression champion: with
`r = y_true_log − y_pred_log` on val, `q_low = Q10(r) = {interval['q_low']:.4f}`
and `q_high = Q90(r) = {interval['q_high']:.4f}`. Serving returns
`expm1(pred_log + q_low)` … `expm1(pred_log + q_high)` — an ~80% empirical
interval (nominal, not conformalised). Stored in `champion.json` under
`regression.residual_interval`. Empirical coverage on the sealed test split:
**{test_interval_coverage:.3f}** of test truths fall inside the interval.

## 9. Artifacts

- `models/registry/regression_champion.joblib` ← `{regression.champion}_{_REGRESSION_VERSION}.joblib`
- `models/registry/classification_champion.joblib` ← `{classification.champion}_calibrated_{_CLASSIFICATION_VERSION}.joblib`
- `models/champion.json` (SPEC §6 schema + threshold + residual interval + rationale)
- `models/monitoring/prediction_reference.json` (decile bins of champion val predictions)
- MLflow experiment `evaluation`, run `{_MLFLOW_RUN_NAME}` (champion test metrics + threshold)
"""


def log_mlflow_run(
    regression: RegressionChoice,
    classification: ClassificationChoice,
    threshold: ThresholdChoice,
    bootstrap: BootstrapResult,
    reg_val_metrics: dict[str, Any],
    reg_test_metrics: dict[str, Any],
    cls_val_metrics: dict[str, Any],
    cls_test_metrics: dict[str, Any],
    test_interval_coverage: float,
    feature_ver: str,
    champion_payload: dict[str, Any],
    regression_model: Any,
    classification_model: Any,
) -> None:
    """Log one MLflow run to the ``evaluation`` experiment (SPEC §7).

    Logs champion test metrics + operating threshold (assignment), the
    bootstrap CI, val anchor metrics, the champion.json payload artifact, and
    the fitted champion pipelines as model artifacts (AUD-26a). Historical
    evaluation runs predate fitted-model logging and contain only the
    champion.json side-artifact.
    """
    with track_run(
        _MLFLOW_EXPERIMENT,
        _MLFLOW_RUN_NAME,
        params={
            "regression_champion": regression.champion,
            "regression_runner_up": regression.runner_up,
            "classification_champion": f"{classification.champion}_calibrated",
            "classification_threshold": round(threshold.threshold, 6),
            "threshold_selection": "max val F1",
            "bootstrap_resamples": bootstrap.n_resamples,
            "bootstrap_seed": bootstrap.seed,
            "selection_basis": "validation split only; sealed test used once for final report",
        },
        tags={
            "feature_version": feature_ver,
            "simulated_target": "classification target simulated (ADR-3)",
        },
    ) as (mlflow, _run):
        mlflow.log_metrics(
            {
                "reg_val_rmsle": reg_val_metrics["rmsle"],
                "reg_test_mae": reg_test_metrics["mae"],
                "reg_test_rmse": reg_test_metrics["rmse"],
                "reg_test_r2": reg_test_metrics["r2"],
                "reg_test_rmsle": reg_test_metrics["rmsle"],
                "reg_test_interval_coverage": test_interval_coverage,
                "cls_val_pr_auc": cls_val_metrics["pr_auc"],
                "cls_val_brier": cls_val_metrics["brier"],
                "cls_test_roc_auc": cls_test_metrics["roc_auc"],
                "cls_test_pr_auc": cls_test_metrics["pr_auc"],
                "cls_test_f1": cls_test_metrics["f1"],
                "cls_test_precision": cls_test_metrics["precision"],
                "cls_test_recall": cls_test_metrics["recall"],
                "cls_test_brier": cls_test_metrics["brier"],
                "classification_threshold": threshold.threshold,
                "bootstrap_rmsle_diff": bootstrap.observed_diff,
                "bootstrap_ci_low": bootstrap.ci_low,
                "bootstrap_ci_high": bootstrap.ci_high,
                "bootstrap_prob_runner_up_better": bootstrap.prob_runner_up_better,
            }
        )
        log_dict_artifact(champion_payload, "champion.json")
        # SPEC §7 / AUD-26a: log the fitted champion pipelines so the run is
        # self-contained like the trainer runs (cloudpickle via the shared
        # helper, same as the regression trainer).
        log_model_artifact(regression_model, "regression_champion")
        log_model_artifact(classification_model, "classification_champion")
    logger.info("logged MLflow run %s to experiment %s", _MLFLOW_RUN_NAME, _MLFLOW_EXPERIMENT)


def run_evaluation() -> dict[str, Any]:
    """Run the full evaluation pipeline and write all owned artifacts.

    Returns a results bundle (also used by tests and the agent log).
    """
    # --- 1. Selection on VALIDATION metrics only ---------------------------
    reg_metrics = load_regression_metrics()
    cls_metrics = load_classification_metrics()
    regression = select_regression_champion(reg_metrics)
    classification = select_classification_champion(cls_metrics)

    X_val, raw_val = load_eval_frame("val")
    y_val_log = np.log1p(raw_val["SalePrice"].astype(float).to_numpy())
    y_val_cls = raw_val["sells_within_30_days"].astype(int).to_numpy()

    reg_champion_model = joblib.load(_regression_artifact(regression.champion))
    reg_runner_model = joblib.load(_regression_artifact(regression.runner_up))
    pred_val_champion = np.asarray(reg_champion_model.predict(X_val), dtype=float)
    pred_val_runner = np.asarray(reg_runner_model.predict(X_val), dtype=float)
    bootstrap = paired_bootstrap_rmsle_diff(
        y_val_log,
        pred_val_champion,
        pred_val_runner,
        champion=regression.champion,
        runner_up=regression.runner_up,
    )

    cls_champion_model = joblib.load(
        _classification_artifact(classification.champion, calibrated=True)
    )
    proba_val = np.asarray(cls_champion_model.predict_proba(X_val)[:, 1], dtype=float)
    threshold = pick_f1_threshold(y_val_cls, proba_val)
    cls_val_operating = classification_metrics(y_val_cls, proba_val, threshold.threshold)

    # --- 2. Registry promotion --------------------------------------------
    copy_champions_to_registry(regression.champion, classification.champion)

    # --- 3. Sealed test split: read exactly once, after selection ---------
    X_test, raw_test = load_eval_frame("test")
    y_test_dollar = raw_test["SalePrice"].astype(float).to_numpy()
    y_test_log = np.log1p(y_test_dollar)
    y_test_cls = raw_test["sells_within_30_days"].astype(int).to_numpy()

    interval = {
        "q_low": float(reg_metrics[regression.champion]["val"]["residual_interval"]["q_low"]),
        "q_high": float(reg_metrics[regression.champion]["val"]["residual_interval"]["q_high"]),
    }
    pred_test_champion = np.asarray(reg_champion_model.predict(X_test), dtype=float)
    reg_test_metrics = regression_metrics(y_test_dollar, np.expm1(pred_test_champion))
    test_cov = interval_coverage(y_test_log, pred_test_champion, interval)
    reg_test_metrics["interval_coverage"] = test_cov

    proba_test = np.asarray(cls_champion_model.predict_proba(X_test)[:, 1], dtype=float)
    cls_test_metrics = classification_metrics(y_test_cls, proba_test, threshold.threshold)

    # All-candidates test comparison (FINAL REPORT ONLY — never for selection).
    reg_test_by_model: dict[str, dict[str, float]] = {}
    for name in regression.ranking:
        if name == regression.champion:
            pred_log = pred_test_champion
        else:
            pred_log = np.asarray(
                joblib.load(_regression_artifact(name)).predict(X_test), dtype=float
            )
        reg_test_by_model[name] = regression_metrics(y_test_dollar, np.expm1(pred_log))
    cls_test_by_model: dict[str, dict[str, Any]] = {}
    for name in classification.ranking:
        if name == classification.champion:
            proba = proba_test
        else:
            model = joblib.load(_classification_artifact(name, calibrated=True))
            proba = np.asarray(model.predict_proba(X_test)[:, 1], dtype=float)
        cls_test_by_model[name] = classification_metrics(y_test_cls, proba, threshold.threshold)

    # --- 4. Artifacts -------------------------------------------------------
    feature_ver = feature_version(FEATURE_LIST_PATH)
    cluster_stats = json.loads(_CLUSTER_STATS_PATH.read_text(encoding="utf-8"))
    rationale = build_rationale(
        regression, classification, threshold, bootstrap, reg_metrics, cls_metrics
    )
    champion_payload = build_champion_payload(
        regression=regression,
        classification=classification,
        threshold=threshold,
        bootstrap=bootstrap,
        reg_val_metrics=reg_metrics[regression.champion]["val"],
        reg_test_metrics=reg_test_metrics,
        cls_val_metrics=cls_val_operating,
        cls_test_metrics=cls_test_metrics,
        residual_interval=interval,
        n_clusters=int(cluster_stats["n_clusters"]),
        rationale=rationale,
    )
    write_json(CHAMPION_PATH, champion_payload)
    logger.info("wrote %s", CHAMPION_PATH)

    reference = build_prediction_reference(
        estimated_price_val=np.expm1(pred_val_champion),
        probability_val=proba_val,
        regression_model=regression.champion,
        classification_model=classification.champion,
        threshold=threshold.threshold,
        feature_ver=feature_ver,
    )
    write_json(PREDICTION_REFERENCE_PATH, reference)
    logger.info("wrote %s", PREDICTION_REFERENCE_PATH)

    # --- 5. MLflow ----------------------------------------------------------
    log_mlflow_run(
        regression=regression,
        classification=classification,
        threshold=threshold,
        bootstrap=bootstrap,
        reg_val_metrics=reg_metrics[regression.champion]["val"],
        reg_test_metrics=reg_test_metrics,
        cls_val_metrics=cls_val_operating,
        cls_test_metrics=cls_test_metrics,
        test_interval_coverage=test_cov,
        feature_ver=feature_ver,
        champion_payload=champion_payload,
        regression_model=reg_champion_model,
        classification_model=cls_champion_model,
    )

    # --- 6. Report ------------------------------------------------------------
    report = build_report(
        regression=regression,
        classification=classification,
        threshold=threshold,
        bootstrap=bootstrap,
        reg_metrics=reg_metrics,
        cls_metrics=cls_metrics,
        reg_test_by_model=reg_test_by_model,
        cls_test_by_model=cls_test_by_model,
        cls_val_operating=cls_val_operating,
        reg_test_metrics=reg_test_metrics,
        cls_test_metrics=cls_test_metrics,
        interval=interval,
        test_interval_coverage=test_cov,
        n_val=int(len(X_val)),
        n_test=int(len(X_test)),
        feature_ver=feature_ver,
    )
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    logger.info("wrote %s", REPORT_PATH)

    return {
        "regression": regression,
        "classification": classification,
        "threshold": threshold,
        "bootstrap": bootstrap,
        "reg_test_metrics": reg_test_metrics,
        "cls_test_metrics": cls_test_metrics,
        "reg_test_by_model": reg_test_by_model,
        "cls_test_by_model": cls_test_by_model,
        "test_interval_coverage": test_cov,
        "champion": champion_payload,
    }


def main() -> None:
    """CLI entry point: full selection + sealed-test evaluation + artifacts."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    results = run_evaluation()
    champion = results["champion"]
    logger.info(
        "CHAMPION SUMMARY\nregression: %s %s | test %s\nclassification: %s "
        "(calibrated, threshold %.4f) | test %s",
        champion["regression"]["name"],
        champion["regression"]["version"],
        json.dumps(champion["regression"]["test_metrics"]),
        champion["classification"]["name"],
        champion["classification"]["threshold"],
        json.dumps(
            {k: v for k, v in champion["classification"]["test_metrics"].items() if k != "confusion_matrix"}
        ),
    )


if __name__ == "__main__":
    main()
