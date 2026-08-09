# Fix report — fix-ml-misc (wave C)

Agent: **fix-ml-misc** · Date: 2026-08-07 · Branch of work: audit wave C, FINDINGS.md AUD-26a–e + AUD-12.
Owned files only: `ml/clustering/**`, `ml/evaluation/**`, `ml/explainability/service.py`,
`ml/features/**` (docstrings/comments only), `tests/ml/test_evaluation.py`.
No retraining, no re-evaluation, no MLflow runs created; `mlruns/`, `models/`, `logs/` untouched.

## Fixes applied

### AUD-26a — clustering/evaluation MLflow runs log no fitted model artifact (SPEC §7)

Finding (artifacts.md F2): *"SPEC §7 deviation: clustering and evaluation runs log no fitted
model artifact to MLflow — only JSON side-artifacts … the tracking record for clustering is not
self-contained."* Code-only fix (per assignment — historical runs are NOT regenerated; comments
in both modules state that runs predating this change carry only the JSON side-artifacts).

- `ml/clustering/train.py:76` — import `log_model_artifact` from `ml.tracking`.
- `ml/clustering/train.py:473-484` — `_log_mlflow_run` gains `model: DBSCAN, scaler: StandardScaler`
  params; docstring documents SPEC §7 self-containment + the historical-runs note.
- `ml/clustering/train.py:527-530` — inside the tracked run, after the JSON artifacts:
  `log_model_artifact(model, "model")` + `log_model_artifact(scaler, "scaler")`.
- `ml/clustering/train.py:598` — call site passes the fitted `model`/`scaler`.
- `ml/clustering/train.py:38-45` — module docstring step 5 updated to mention the logged model
  artifacts (with the AUD-26a historical-runs caveat).
- `ml/evaluation/evaluate.py:58` — import `log_model_artifact`.
- `ml/evaluation/evaluate.py:568-578` — `log_mlflow_run` gains `regression_model` /
  `classification_model` params; docstring updated (incl. historical-runs note).
- `ml/evaluation/evaluate.py:622-625` — inside the tracked run:
  `log_model_artifact(regression_model, "regression_champion")` +
  `log_model_artifact(classification_model, "classification_champion")` (cloudpickle via the
  shared helper, same as the regression trainer).
- `ml/evaluation/evaluate.py:749-750` — `run_evaluation` passes the already-loaded
  `reg_champion_model` / `cls_champion_model` (no extra disk reads).

Before: `list_artifacts`-visible payload of clustering runs = `cluster_stats.json` +
`eps_selection_trace.json` only; evaluation runs = `champion.json` only (artifacts-T4a). After:
future runs also produce READY LoggedModels under `mlruns/<exp>/models/m-*/`.

### AUD-26b — stale clustering docstring (llba-ml-services F2)

- `ml/clustering/train.py:23-26` — "4 clusters, **4 noise** neighborhoods (BrDale, CollgCr,
  NAmes, Timber…)" → "4 clusters, **3 noise** neighborhoods (CollgCr, NAmes, Timber…)".
  Verified against `models/clustering/cluster_assignments.csv`: `cluster_id = -1` for exactly
  CollgCr, NAmes, Timber; BrDale is in cluster 0. The "k=3 knee degenerates to a single cluster"
  claim was verified true by the auditor and is unchanged.

### AUD-26c — dead `dbscan.joblib` load in serve.py (llba-ml-services F3)

- `ml/clustering/serve.py:73-78` — load kept (it validates artifact presence/integrity at
  startup); added comment: serving answers come entirely from the scaler + scaled-space cluster
  centroids, and the fitted model object is retained for interface completeness with the
  persisted artifact set. No behavior change.

### AUD-26d — SHAP service docstring latency claim (shap.md P3, corroborated by performance.md)

- `ml/explainability/service.py:23-25` — "warm calls are single-digit milliseconds" → "warm
  calls measure ~22–30 ms (p50) for the linear champion (docs/audit/performance.md)". Measured:
  p50 22.5 ms (performance.md §e), 30.2 ms (shap.md §6). Doc-only change.

### AUD-26e — llba-features documentation-only P3s

- F1 stale-cache semantics: notes added to the three `lru_cache`d loaders —
  `ml/features/pipeline.py:219-225` (`_geo_lookup`), `ml/features/pipeline.py:293-307`
  (`_property_geo_lookup`: cache keyed on path only; same-path rewrite/delete needs a restart),
  `ml/features/defaults.py:89-99` (`load_feature_defaults`).
- F2 sha1 docstring mismatch: `ml/features/pipeline.py:498-507` (`write_feature_list`) — the
  internal 40-char `sha1` field is a fingerprint of the JSON-serialized `MODEL_FEATURES`
  (consumed by `tests/features/test_features.py`), NOT `champion.json`'s `feature_version`
  (which is `ml.tracking.feature_version()` = 12-char sha1 of the file bytes, `9b0f8ba4201c`).
- F5 redundant features: `ml/features/pipeline.py:461-463` — comment noting
  `sale_month` ≡ `MoSold` and `sale_year` ≡ `YrSold` are SPEC §5-mandated, harmless exact
  collinearity.
- No behavior, value, or `MODEL_FEATURES` change (docstrings/comments only). F3/F4/F6/F7 of
  llba-features are NOT documentation-only and were intentionally left alone.

### AUD-12 — champion-metric regression guards too loose (test-audit F2)

- `tests/ml/test_evaluation.py:254-274` (`test_test_metrics_present_and_sane`) — bars tightened
  from R²>0.6 / RMSLE<0.3 / ROC-AUC>0.55 / Brier≤0.25 to **R² ≥ 0.90, RMSLE ≤ 0.13,
  ROC-AUC ≥ 0.72, Brier ≤ 0.19**, pinned just inside the current champion test metrics
  (`models/champion.json`: R² 0.93048, RMSLE 0.118689, ROC-AUC 0.766602, Brier 0.171026).
  Margins (0.03 / 0.011 / 0.047 / 0.019) catch any real quality regression while tolerating the
  ulp-level jitter (~1e-15) observed in the reproducibility audit. Finiteness and structural
  checks unchanged.

## Regression tests added

- `tests/ml/test_evaluation.py::test_clustering_mlflow_run_logs_model_artifacts` (AUD-26a) —
  monkeypatches `track_run`/`log_dict_artifact`/`log_model_artifact` in `ml.clustering.train`,
  calls `_log_mlflow_run` with a tiny fitted DBSCAN+StandardScaler, asserts both fitted objects
  are logged (`"model"`, `"scaler"`, identity-checked). No MLflow store touched.
- `tests/ml/test_evaluation.py::test_evaluation_mlflow_run_logs_champion_models` (AUD-26a) —
  same pattern for `ml.evaluation.evaluate.log_mlflow_run` (SimpleNamespace doubles), asserts
  `"regression_champion"` then `"classification_champion"` are logged with the exact model
  objects passed in.

## Test evidence

- `pytest tests/ml/test_evaluation.py -q` → **16 passed** (14 pre-existing + 2 new), 7.22s.
- `pytest tests/ml/test_clustering.py test_evaluation.py test_explainability.py
  test_regression.py test_classification.py -q` → **48 passed**, 8.08s.
- `pytest tests/features -q` → **24 passed**, 0.91s (proves the features edits are doc-only).
- Import/signature probe of all edited modules: OK (`_log_mlflow_run(result, tier_bounds,
  model, scaler)`; `log_mlflow_run(..., regression_model, classification_model)`).
- Full suite `pytest tests backend/tests -q` → **168 passed, 3 failed**, 23.90s (final run
  20:43Z; an earlier run right after my edits: 170 passed / 1 failed, 17.47s).

### The full-suite failures are NOT mine

All three sit in the concurrent monitoring fix agent's (AUD-06/07) in-flight scope — none of my
owned files are involved (I never touched `ml/monitoring/**`, `tests/ml/test_monitoring.py`,
`tests/integration/**`, or `models/monitoring/**`; my features edits are comment/docstring-only
and provably behavior-neutral per the 24 green features tests):

1. `tests/ml/test_monitoring.py::test_psi_bins_from_train_handles_duplicate_edges` —
   `assert 11 < 11` on `psi_bins_from_train` edges; `ml/monitoring/psi.py` was modified at
   20:34:40Z (AUD-06 degenerate-bin handling) while the test is still the 12:42Z baseline.
2. `tests/integration/test_end_to_end.py::test_drift_pipeline_clean_window_no_drift` and
3. `tests/integration/test_end_to_end.py::test_drift_pipeline_shifted_window_flags_drift` —
   the drift report gained new keys `low_sample` / `calendar_drift_features` (AUD-07 calendar
   guard, mid-landing); `models/monitoring/reference_stats.json` was regenerated at 20:39:49Z.

File-mtime trail: `ml/monitoring/{psi,reference,drift_check}.py` 20:34–20:36Z,
`models/monitoring/reference_stats.json` 20:39:49Z — all during my verification window, all
outside my ownership. The suite returns to fully green once that agent lands their matching
test updates. The pre-wave baseline was 162 green; the count movement (162 → 171 collected)
reflects concurrent agents' new tests (mine contribute +2).

## Notes for the orchestrator

- AUD-26a is intentionally code-only: existing `mlruns/` clustering/evaluation runs still lack
  LoggedModels (in-code comments record why). If a future retrain/re-evaluation is ever
  sanctioned, the new logging path will activate; nothing needs regenerating now.
- No server was started (port 8700 unused); no git commands used; `logs/predictions.jsonl`
  untouched.
- llba-features F3/F4/F6/F7 (negative `property_age`, unvalidated direct-call inputs, per-call
  stats reload, `"nan"` default edge) are behavior-adjacent and outside the documentation-only
  mandate — left for a future decision, not fixed here.
