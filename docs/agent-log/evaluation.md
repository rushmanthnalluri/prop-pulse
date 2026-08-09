# Agent Log — evaluation

**Scope owned:** `ml/evaluation/`, `models/champion.json`, `models/registry/`,
`models/monitoring/prediction_reference.json`, `reports/MODEL_EVALUATION.md`,
`tests/ml/test_evaluation.py`.

## What was built

- `ml/evaluation/select.py` — champion-selection decision logic (val split only):
  - `select_regression_champion` — val RMSLE primary, RMSE then R² tie-break
    (SPEC §6).
  - `paired_bootstrap_rmsle_diff` — paired bootstrap of the top-2 regression gap:
    2000 row-level val resamples, seed 42, 95% percentile CI of
    RMSLE(champion) − RMSLE(runner-up) (RMSLE = RMSE in log1p space).
  - `select_classification_champion` — PR-AUC primary among **calibrated**
    variants only + Brier sanity check (winner's Brier must be within 0.01 of
    the best calibrated Brier; override path implemented, not triggered).
  - `pick_f1_threshold` — F1-maximising operating threshold on val calibrated
    probabilities, ties broken toward higher precision; guaranteed in (0,1).
- `ml/evaluation/evaluate.py` (CLI: `python -m ml.evaluation.evaluate`) —
  orchestration: selection → registry promotion → **sealed test read exactly
  once, after selection** → artifacts → MLflow → report.
  - `models/registry/regression_champion.joblib` = byte-identical copy of
    `ridge_v1.joblib`; `classification_champion.joblib` = copy of
    `random_forest_calibrated_v1.joblib` (verified with `cmp`).
  - `models/champion.json` — SPEC §6 schema + `classification.threshold` +
    `regression.residual_interval` (copied from val metrics) +
    `regression.bootstrap_vs_runner_up` + rationale; `feature_version` =
    `ml.tracking.feature_version(FEATURE_LIST_PATH)` = `9b0f8ba4201c`.
  - `models/monitoring/prediction_reference.json` — decile bin edges +
    proportions of champion val predictions (`estimated_price` dollars and
    calibrated probability), for the monitoring drift check.
  - MLflow experiment `evaluation`, run `champion_selection_v1` — champion test
    metrics + threshold + bootstrap CI + champion.json artifact.
  - `reports/MODEL_EVALUATION.md` — generated programmatically from computed
    values (methodology, val/test tables, rationale, ADR-3 caveat, interval
    method).

## Champion summary (selection on VAL only, 338 rows)

- **Regression: ridge v1** — val RMSLE 0.1354 / RMSE $21,673 / MAE $14,527 /
  R² 0.9280 (best on every metric). Runner-up xgboost RMSLE 0.1398.
  **Paired bootstrap (2000, seed 42): diff −0.0043, 95% CI [−0.0133, +0.0060],
  P(xgboost better) = 0.193 → gap NOT statistically decisive**; ridge wins on
  interpretability (linear coefficients), latency and size (~21 KB vs ~25 MB).
  XGBoost explicitly not auto-crowned.
- **Classification: calibrated random_forest v1** — best calibrated val PR-AUC
  0.5250 AND best Brier 0.1856 (sanity check passed, no override).
  **Operating threshold 0.203292** (max val F1 0.5455; precision 0.4091,
  recall 0.8182) — not 0.5 per SPEC §14.

## Sealed test results (175 rows, read once, after selection)

- Ridge: **MAE $15,075 / RMSE $21,152 / R² 0.9305 / RMSLE 0.1187**; 80% val
  residual interval empirical test coverage 0.783.
- Calibrated RF @ 0.2033: **ROC-AUC 0.7666 / PR-AUC 0.5674 / F1 0.5063 /
  precision 0.3670 / recall 0.8163 / Brier 0.1710**; confusion TP=40 FP=69
  FN=9 TN=57.
- All-candidates test table is in the report, labelled FINAL REPORT ONLY and
  never used for selection. Honest note: on test, xgboost regression (RMSLE
  0.1051) and calibrated logistic (PR-AUC 0.6101) edge out the champions —
  expected val↔test jitter on small splits; selection correctly used val only.

## Verification (all real runs)

- `python -m ml.evaluation.evaluate` — exit 0; selection log lines, registry
  copies, champion.json, prediction_reference.json, MLflow run, report written.
- `pytest tests/ml/test_evaluation.py -q` → **14 passed** (schema, paths,
  threshold ∈ (0,1), registry load+predict on 5-row frame, test-metric sanity
  bars R²>0.6 / ROC-AUC>0.55, threshold reproduction from registry champion on
  val, bootstrap record, reference-bin integrity, no absolute-path leaks).
- `pytest tests/ -q` → **78 passed** (no interference with other agents).
- MLflow run inspected via `mlflow.search_runs` — all 19 metrics + params
  present in experiment `evaluation` (id 289403811797199859).

## Notes for the orchestrator

- Backend must read `classification.threshold` (0.203292) from champion.json —
  predicting at 0.5 would give recall 0.08 instead of 0.82.
- `regression.residual_interval` in champion.json is the serving price range:
  `expm1(pred_log + q_low/q_high)`, q10/q90 val residual quantiles.
- Classification metrics are consistency-with-simulation numbers (ADR-3
  SIMULATED target) — never quote as real-world performance.
- Re-running `ml.evaluation.evaluate` re-reads the sealed test split; it is
  idempotent but should only be re-run deliberately.
