# Forensic Audit — llba-training

**Scope (line-by-line):** `ml/training/common.py` (88 lines), `ml/training/train_regression.py` (308), `ml/training/train_classification.py` (493), `ml/evaluation/select.py` (371), `ml/evaluation/evaluate.py` (798), `ml/tracking.py` (88). Total 2,146 lines, every line read.
**Context read:** `docs/audit/AUDIT_PLAN.md`, `docs/PROJECT_SPEC.md` §6/§7/§14, `docs/DECISIONS.md` (ADR-3/4/8/10), `ml/paths.py`.
**Method:** full static read + independent recomputation from persisted artifacts (splits, joblibs, metrics.json, champion.json, mlruns store). No project files modified. No servers started; no ports used.
**Evidence:** `docs/audit/evidence/llba-training-recompute.txt` (sections 0–6), `docs/audit/evidence/llba-training-test-recompute.txt` (sections 7–9), `docs/audit/evidence/llba-training-artifacts-mlflow.txt` (md5, mlruns store, serialization formats, mtimes).

---

## 1. Verdict summary

All substantive hunt items **PASS with evidence**. No P0/P1/P2 defects found. Ten P3 findings (spec-text deviations, brittleness, doc nits) — none affects the correctness of trained artifacts, selection, or reported metrics.

| Hunt item | Result |
|---|---|
| CV on train only (reg + cls) | PASS — statically verified (`train_regression.py:160,193` fit `X_train`; `train_classification.py:229,250` fit train only) |
| Scoring strings & sign conventions | PASS — verified by execution (GridSearchCV rerun; `neg_root_mean_squared_error` argmax/1-SE arithmetic on negative scores correct) |
| 1-SE rule | PASS — verified by execution (ridge: grid best 31.62 → one-SE 100.0; lasso: 4.64e-4 → 4.64e-3; both match metrics.json) |
| RandomizedSearch distributions | PASS — statically verified (discrete lists, n_iter=8 ≤ 10, seed 42, refit on full train) |
| Calibration wiring | PASS — statically verified (`train_classification.py:243-251`: clone of tuned pipeline, sigmoid, StratifiedKFold(5, seed 42), fit on train only) |
| Threshold selection (val only, ties) | PASS — verified by execution (recomputed 0.203292242 on val calibrated champion probas; tie-break = highest precision among F1-ties, `select.py:354-355`) |
| Champion selection vs SPEC (RMSLE primary; calibrated PR-AUC + Brier sanity) | PASS — verified by execution (ranking ridge > xgboost > lasso > linear > RF; calibrated RF PR-AUC 0.52501 best, Brier gap 0.0 ≤ 0.01) |
| Bootstrap CI (paired, percentile, seed) | PASS — verified by execution (rerun seed 42 / 2000 resamples reproduces diff −0.004341, CI [−0.013336, 0.005985], P=0.1925 exactly) |
| Registry copy correctness (calibrated variant) | PASS — verified by execution (md5: registry/classification_champion == random_forest_**calibrated**_v1; registry/regression_champion == ridge_v1) |
| champion.json schema completeness | PASS — verified by execution (all SPEC §6 keys present + documented extras; all referenced paths exist) |
| MLflow logging (params/metrics/tags/artifacts; cloudpickle; env var) | PASS WITH CONCERN — store inspection: all current runs FINISHED with params/metrics/tags/models; regression = cloudpickle per SPEC §14, classification = **skops** (deviation, F-1); env var set before any FileStore creation |
| Metrics recomputed by hand | PASS — verified by execution (independent RMSLE formula on val for all 5 models and on test; F1/precision/recall re-derived from confusion counts) |
| expm1/log1p consistency | PASS — verified by execution (`rmse_log == rmsle` to 1e-12 for all models; test metrics recomputed via expm1 match) |
| Residual interval math | PASS — verified by execution (log-space coverage == dollar-space `expm1(pred+q)` coverage = 0.782857 on test) |
| Test read only after selection | PASS — statically verified (`evaluate.py:624-651` selection on val; `load_eval_frame("test")` first at `evaluate.py:657`; no other test access in any assigned file) |

---

## 2. Execution evidence highlights

- Splits: train 945 / val 338 / test 175 rows × 85 cols — matches SPEC §14.
- All 5 regression models: val MAE/RMSE/R²/RMSLE/rmse_log/residual_interval recomputed from saved joblibs == `models/regression/metrics.json` (≤1e-9). Hand RMSLE matches (e.g., ridge hand=0.1354366692).
- All 4 classification models × (raw, calibrated): ROC-AUC/PR-AUC/P/R/F1/Brier/threshold/confusion-matrix recomputed == `models/classification/metrics.json` exactly (including degenerate calibrated-DT row: P=R=F1=0, tn=239/fp=0/fn=99/tp=0).
- champion.json test metrics recomputed from registry champions on sealed test: MAE 15,075.47 / R² 0.93048 / RMSLE 0.118689 / interval_coverage 0.782857; cls ROC-AUC 0.766602 / PR-AUC 0.567363 / Brier 0.171026 / CM {57,69,9,40} — all match. Hand-derived P/R/F1 from the recorded confusion counts match to 6dp (the recorded values are 6dp-rounded).
- Threshold 6dp rounding in champion.json reproduces **identical** hard test metrics vs the full-precision threshold (no boundary flips).
- `feature_version(FEATURE_LIST_PATH)` = `9b0f8ba4201c` == champion.json.
- `models/monitoring/prediction_reference.json` decile edges/proportions/summary recomputed via `decile_profile` on champion val predictions — exact match (reg + cls); proportions sum to 1.0; n_rows=338.
- mlruns store: experiments regression/classification/evaluation/clustering exist; FINISHED runs carry params (e.g. ridge `alpha=100.0`), val metrics, `dataset_version`/`feature_version`/`trained_at` tags, and LoggedModel artifacts (`serialization_format: cloudpickle` for regression; `skops` + trust list for classification, both `model` and `model_calibrated`); evaluation run logs champion test metrics + threshold + bootstrap CI + champion.json artifact.

---

## 3. Per-file reviewed-line table

| File | Lines | Reviewed | How |
|---|---|---|---|
| ml/training/common.py | 1–88 | 88/88 | static + execution |
| ml/training/train_regression.py | 1–308 | 308/308 | static + execution (GridSearchCV rerun) |
| ml/training/train_classification.py | 1–493 | 493/493 | static + execution (metrics recompute) |
| ml/evaluation/select.py | 1–371 | 371/371 | static + execution (selection/bootstrap/threshold rerun) |
| ml/evaluation/evaluate.py | 1–798 | 798/798 | static + execution (artifact recompute; MLflow via store inspection) |
| ml/tracking.py | 1–88 | 88/88 | static + store inspection (not re-run: report-only) |

## 4. Per-function matrix

Status: **PASS** = static + (where executable without writes) execution. Functions whose execution would write artifacts (train_all, log_mlflow_run, copy_champions_to_registry, plotters, track_run) were verified by recomputing/inspecting their persisted outputs instead.

### ml/training/common.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| load_split | 22–31 | PASS | `keep_default_na=False` per §14; FileNotFoundError with remediation hint. Executed (945/338/175). |
| build_preprocessor | 34–57 | PASS | median+scale numerics, most_frequent+OHE(ignore) cats, dense output; dtype-driven column split. Used inside every CV fold → no leakage. |
| regression_metrics | 60–71 | PASS | Dollar-scale; RMSLE with `clip(y_pred,0)` guard; R² NaN-guard for constant y. Executed — matches sklearn-independent hand formula. |
| residual_interval | 74–81 | PASS | Q10/Q90 of log residuals; additive-in-log contract matches `interval_coverage` in evaluate.py. Executed. |
| write_json | 84–88 | PASS | mkdir parents, `default=str` for numpy scalars. |

### ml/training/train_regression.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| load_model_frame | 81–97 | PASS | persisted train-fit stats; column order from feature_list.json; log1p target. No feature-list/MODEL_FEATURES sync check (F-4). |
| make_pipeline | 100–104 | PASS | preprocess+model Pipeline. |
| one_se_alpha | 107–119 | PASS | Executed: rerun GridSearchCV reproduces alpha 100.0 (ridge) / 0.0046416 (lasso). SE = std/√5 at best; pick strongest eligible alpha. n_folds from module-global CV (F-8). Grid-order zip assumption verified (`cv_results_["params"]` order == grid order). |
| _val_report | 122–132 | PASS | expm1 both sides; rmse_log == rmsle (1e-12). |
| _train_linear | 135–141 | PASS | no tuning; `cv_best_score=None` handled at 279. |
| _train_alpha_model | 144–173 | PASS | train-only GridSearchCV; refits one-SE alpha on full train; cv_best_score = positive log-RMSE of the **shipped** alpha (verified 0.1106122819). Refit constructor drops non-alpha params (F-10). |
| _train_randomized | 176–197 | PASS | train-only RandomizedSearchCV, n_iter=8, seed 42; ships `best_estimator_` (refit on full train). |
| train_all | 200–287 | PASS (via outputs) | train/val only; per-model joblib + metrics.json + MLflow run (cloudpickle). Outputs fully recomputed — consistent. |
| main | 290–304 | PASS | CLI summary only. |

### ml/training/train_classification.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| _log_sklearn_model | 127–141 | PASS WITH CONCERN | skops + explicit trust list — works (verified in store) but deviates from SPEC §14 "must use cloudpickle" (F-1). |
| candidate_grids | 144–197 | PASS | imbalance-aware (class_weight / scale_pos_weight=neg/pos); small grids. |
| tune_on_train | 200–240 | PASS | StratifiedKFold(5, shuffle, 42), `average_precision`, train-only, refit=True. |
| fit_calibrated | 243–251 | PASS | clone(tuned pipeline), sigmoid, cv=5 stratified seed 42, fit on train only; calibrated ensemble refits base per fold (no leakage). |
| classification_metrics | 254–280 | PASS | labels=[0,1] CM → tn/fp/fn/tp; zero_division=0; `proba >= threshold`. Executed — exact match, incl. degenerate DT row. |
| plot_calibration_curves | 283–312 | PASS (via outputs) | val-only probas; figure exists (17:09). |
| plot_best_model_curves | 315–360 | PASS (via outputs) | best-by-calibrated-PR-AUC for figure only — not selection. Figure exists. |
| load_model_feature_list | 363–372 | PASS | hard-fails on feature_list/MODEL_FEATURES drift. |
| train_all | 375–483 | PASS (via outputs) | raw+calibrated joblibs, metrics.json, figures, MLflow runs; no test access. All metrics recomputed — consistent. |
| main | 486–490 | PASS | — |

### ml/evaluation/select.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| load_regression_metrics / load_classification_metrics | 117–124 | PASS | plain JSON loads. |
| rank_regression_candidates | 127–143 | PASS | (rmsle↑, rmse↑, −r2) — RMSLE primary per SPEC §6. Executed. |
| select_regression_champion | 146–169 | PASS | champion=ridge, runner_up=xgboost; ≥2 guard. Executed. |
| paired_bootstrap_rmsle_diff | 172–242 | PASS | paired (same resample idx), percentile 2.5/97.5, seed 42, 2000 resamples; observed/CI/P/significant all reproduced bit-exact. |
| rank_classification_candidates | 245–264 | PASS | calibrated-only, (−pr_auc, brier). Executed. |
| select_classification_champion | 267–321 | PASS | Brier sanity tolerance 0.01; override branch documented defensive (not triggered: gap=0.0). Executed. |
| pick_f1_threshold | 324–371 | PASS | val-only; ties within 1e-9 rel → highest precision (as documented); degenerate-threshold ValueError. Executed: 0.203292242; curve P/R == confusion-based P/R at that threshold (sklearn `>=` semantics align with serving). |

### ml/evaluation/evaluate.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| load_eval_frame | 87–100 | PASS | identical feature path to training. |
| _regression_artifact / _classification_artifact | 103–111 | PASS | calibrated=True default for classification. |
| interval_coverage | 114–124 | PASS | executed: log-space == dollar-space coverage. |
| decile_profile | 127–148 | PASS | executed: reproduces prediction_reference.json; degenerate-edge collapse documented. |
| copy_champions_to_registry | 151–165 | PASS | calibrated variant copied; md5-verified byte-identical. |
| build_prediction_reference | 168–209 | PASS | val-only reference; threshold stored full precision (F-3). |
| _round_metrics | 212–222 | PASS | 6dp rounding of float leaves. |
| build_champion_payload | 225–279 | PASS | all SPEC §6 keys + documented extras; relative paths; executed schema check passes. |
| build_rationale | 282–322 | PASS WITH CONCERN | hardcoded champion-specific prose & sizes (F-2). Currently factually accurate (ridge 21,490 B ≈ 21 KB; regression RF 25.2 MB ≈ 25 MB; RF has best calibrated Brier 0.18555). |
| _md_table / _money | 325–336 | PASS | rendering helpers. |
| build_report | 339–553 | PASS | report exists; numbers traced to computed objects only. |
| log_mlflow_run | 556–616 | PASS (store inspection) | evaluation run contains all 18 metrics + 8 params + champion.json artifact. |
| run_evaluation | 619–775 | PASS | **ordering verified**: selection (627–628) and threshold (650) on val only; registry copy (654); sealed test first read at 657; all-candidates test table is report-only (674–691). No path where test metrics influence selection. |
| main | 778–794 | PASS | — |

### ml/tracking.py
| Function | Lines | Verdict | Notes |
|---|---|---|---|
| (module level) env var | 24–25 | PASS WITH CONCERN | setdefault before any FileStore creation in all in-repo paths; comment "must precede mlflow import" is stricter than reality — enforcement is at FileStore init (verified: `.venv/.../mlflow/store/tracking/file_store.py:224`) (F-6). |
| get_tracking_uri | 28–34 | PASS | env override → else `<repo>/mlruns` file URI. |
| feature_version | 37–40 | PASS | sha1[:12] of file bytes; executed — matches champion.json. |
| track_run | 43–62 | PASS (store inspection) | params stringified; dataset_version + trained_at tags; verified present on runs. |
| log_model_artifact | 65–73 | PASS | cloudpickle per SPEC §14 (used by regression path inline; classification uses F-1 variant). |
| log_dict_artifact | 76–88 | PASS WITH CONCERN | tmp file lands in CWD when TMPDIR unset (Windows) (F-5); finally-cleanup; artifacts verified in store. |

---

## 5. Findings

| ID | Severity | Location | Description | Evidence |
|---|---|---|---|---|
| F-1 | P3 | train_classification.py:117–141, 447–448 vs SPEC §14 | Classification MLflow logging uses skops + custom trust list, deviating from binding §14 ("Model logging must use cloudpickle"). Functioning (skops artifacts verified in store), documented in code, but SPEC/DECISIONS never amended. | artifacts-mlflow.txt (serialization_format: skops) |
| F-2 | P3 | evaluate.py:300–322 | `build_rationale` hardcodes champion-specific prose ("regularised linear model… fully interpretable", "~21 KB vs ~25 MB", "best calibrated Brier"). True today; silently false if a retrain changes champion/Brier ranking. Sizes not computed from artifacts. | static; sizes verified vs `ls -la` |
| F-3 | P3 | evaluate.py:267 vs 205/723 | Operating threshold stored at 6dp in champion.json (0.203292) but full precision in prediction_reference.json (0.20329224173900778). Verified no metric flip; precision inconsistency between artifacts only. | artifacts-mlflow.txt §"prediction_reference threshold precision"; test-recompute §7 rounding_safe |
| F-4 | P3 | train_regression.py:93–94 vs train_classification.py:363–372 | Regression trainer reads feature_list.json without the MODEL_FEATURES sync hard-check the classification trainer has. Drift would KeyError (loud) but error quality/consistency differs. | static |
| F-5 | P3 | tracking.py:83 | `log_dict_artifact` tmp file goes to CWD (TMPDIR unset on Windows) — transient repo-root file, theoretical same-name collision under concurrent runs; cleaned in `finally`. | static |
| F-6 | P3 | tracking.py:24 (comment) | Comment claims MLFLOW_ALLOW_FILE_STORE "must precede mlflow import"; enforcement is actually at FileStore instantiation (verified mlflow/store/tracking/file_store.py:224). Current ordering safe everywhere in-repo; comment inaccurate. Also `setdefault` won't override a user-set false. | artifacts-mlflow.txt §"env enforcement point" |
| F-7 | P3 | SPEC §6 sketch vs train_regression.py:251–255, train_classification.py:420–424 | SPEC §6 metrics.json sketches (`{model: {mae, rmse, r2, rmsle…}}`, flat metric keys) don't match implemented nested shape (`{model: {val, best_params, cv_best_score}}` / `{val, val_calibrated, best_params}`). Internally consistent (select/evaluate/tests consume it); spec text stale. | static + recompute |
| F-8 | P3 | train_regression.py:117 | `one_se_alpha` takes n_folds from module-global `CV` instead of deriving it from `cv_results_` — hidden coupling; correct only while callers reuse the same CV object (they do today). | static |
| F-9 | P3 | mlruns store (historical) | Deleted FAILED runs exist (regression linear_v1 ×1 status=4; classification logistic_v1 ×2 status=4, lifecycle_stage=deleted) — historical logging failures (likely pre-trust-list skops rejects). No error payload stored; all current runs FINISHED and complete. | artifacts-mlflow.txt |
| F-10 | P3 | train_regression.py:169 | Final alpha-model refit reconstructs `type(estimator)(alpha=alpha, max_iter=estimator.max_iter)` — silently drops any other non-default ctor params if grids are reconfigured later. Correct for current Ridge/Lasso usage (verified by rerun). | static + recompute §2 |

## 6. Observations (not findings)

- **Ambient retraining during audit:** classification/regression joblibs were rewritten at 17:01–17:08 while metrics.json files date 12:02/12:15 (and `random_forest_calibrated_v1.joblib` 12:12 was *not* rewritten). Full recomputation of every model's val metrics from the *current* joblibs matches the *older* metrics.json to ≤1e-9 — artifacts are mutually consistent and training is deterministic under seed 42. Registry copies (16:08) md5-match the calibrated/tuned sources they were copied from.
- Val positive rate is 0.2929 (train ≈ 0.25 per SPEC §14); the "~25% prevalence" language in rationale/select.py refers to train — consistent.
- Test coverage exists for the selection layer (tests/ml/test_evaluation.py: ranking, threshold, bootstrap reproducibility, champion schema, registry load, prediction_reference), regression artifacts (test_regression.py) and classification artifacts/calibration sanity (test_classification.py). No dedicated unit test for `ml/tracking.py` (covered indirectly via store state).

## 7. Items for orchestrator reconciliation

1. SPEC §14 says model logging "must use cloudpickle"; classification deliberately uses skops+trust (F-1). Either amend SPEC/DECISIONS (add ADR) or unify on cloudpickle.
2. SPEC §6 metrics.json sketches are stale vs implemented nested schemas (F-7) — docs-truth agent should confirm and SPEC should be updated.
3. `champion.json` threshold precision (6dp) vs `prediction_reference.json` (full) (F-3) — decide a single canonical precision; backend agents should confirm which artifact serving reads.
4. Deleted FAILED mlflow runs (F-9) — if reproducibility agent re-ran training during audit waves, its logs should corroborate the 17:0x artifact mtimes noted in §6.
5. F-2 rationale hardcoding interacts with any Wave C change that could alter champions — if models are retrained, rationale text must be regenerated and re-audited.
