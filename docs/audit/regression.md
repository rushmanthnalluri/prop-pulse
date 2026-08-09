# Forensic Audit — REGRESSION (agent: `regression`, mission §8)

Date: 2026-08-07 · Auditor: regression subagent · Mode: report-only (no project files modified)
Method: independent recomputation from the shipped artifacts (`models/registry/regression_champion.joblib`,
`models/regression/*_v1.joblib`) using the project's own feature pipeline (`ml.features.pipeline.build_feature_frame`
+ train-fit `models/neighborhood_stats.json` + `models/feature_list.json` column order) and metric code
(`ml.training.common.regression_metrics`). Previous QA reports were not consulted.

Evidence files (full command + output):
- `docs/audit/evidence/regression-champion-recompute.txt` — champion val+test recompute, sanity, intervals, hashes
- `docs/audit/evidence/regression-candidates-recompute.txt` — linear + xgboost val/test recompute, bootstrap CI, ranking
- `docs/audit/evidence/regression-cv-protocol.txt` — full GridSearchCV rerun (ridge + lasso), 1-SE re-derivation, refit-vs-artifact
- `docs/audit/evidence/regression-serialization.txt` — clean-subprocess load + bit-identical predictions
- `docs/audit/evidence/regression-lasso-rf-recompute.txt` — lasso + random_forest recompute (table completeness), xgb params

---

## 1. Champion metric recomputation (registry artifact vs claims) — PASS

`models/registry/regression_champion.joblib` is **byte-identical** to `models/regression/ridge_v1.joblib`
(md5 `eee200e5d969dbc83c9e5a86869a5999` both); estimator is `Ridge(alpha=100.0, max_iter=10000)` — matches
`metrics.json` `best_params`. **PASS — verified by execution** (evidence: regression-champion-recompute.txt).

| Metric | Claimed (champion.json / MODEL_EVALUATION.md) | Recomputed | Verdict |
|---|---|---|---|
| val MAE | 14526.572418 / $14,527 | 14526.572418438847 | PASS |
| val RMSE | 21672.72103 / $21,673 | 21672.721030394012 | PASS |
| val R² | 0.927982 / 0.9280 | 0.9279822437448195 | PASS |
| val RMSLE | 0.135437 / 0.1354 | 0.13543666916035035 | PASS |
| val rmse_log | 0.135437 | 0.13543666916035035 | PASS |
| val interval q10 | -0.140954 / -0.1410 | -0.14095417729722773 | PASS |
| val interval q90 | 0.116634 / 0.1166 | 0.11663421200817777 | PASS |
| test MAE | 15075.473458 / $15,075 | 15075.473458046345 | PASS |
| test RMSE | 21151.541687 / $21,152 | 21151.541687388686 | PASS |
| test R² | 0.93048 / 0.9305 | 0.9304804522464808 | PASS |
| test RMSLE | 0.118689 / 0.1187 | 0.11868860145100557 | PASS |
| test interval coverage | 0.782857 / 0.783 | 0.7828571428571428 (137/175) | PASS |

All recomputed values match the recorded values to every recorded digit (champion.json stores 6-dp
roundings of the exact recomputed values). `feature_version` sha1(feature_list.json)[:12] = `9b0f8ba4201c`
= champion.json value. Split sizes confirmed: val n=338, test n=175 (train n=945 seen in CV rerun).

## 2. Other candidates (metrics.json) — PASS

Recomputed from joblibs (assignment required linear + xgboost; lasso + random_forest also done for completeness):

| Model | Split | Recomputed vs `models/regression/metrics.json` | Verdict |
|---|---|---|---|
| linear | val | MAE 15888.103770966400, RMSE 22809.020458964962, R² 0.9202325, RMSLE 0.1424625 — all `np.isclose` at rtol 1e-9 | PASS — verified by execution |
| xgboost | val | MAE 15461.464138067997, RMSE 23459.536571493518, R² 0.9156177, RMSLE 0.1397772 — all match | PASS — verified by execution |
| lasso | val | MAE 15354.721969452747, RMSE 23297.755241759762, R² 0.9167775, RMSLE 0.1407245 — all match | PASS — verified by execution |
| random_forest | val | MAE 18279.468166708455, RMSE 27698.449669574846, R² 0.8823685, RMSLE 0.1589738 — all match | PASS — verified by execution |

Test-split all-candidate table (MODEL_EVALUATION.md §5) also recomputed and matches: xgboost
MAE $12,929 / RMSE $18,880 / R² 0.9446 / RMSLE 0.1051; linear $15,623 / $22,518 / 0.9212 / 0.1223;
lasso $15,697 / $23,675 / 0.9129 / 0.1247; random_forest $15,402 / $24,763 / 0.9047 / 0.1224.

Champion-selection logic re-run: `rank_regression_candidates` → [ridge, xgboost, lasso, linear, random_forest];
champion ridge, runner-up xgboost. Paired bootstrap re-derived (2000 resamples, seed 42):
observed diff **-0.0043405** (claimed -0.004341), 95% CI **[-0.0133360, 0.0059853]** (claimed [-0.013336, 0.005985]),
P(runner-up better) **0.1925** (claimed 0.1925), significant=False. **PASS — verified by execution**
(evidence: regression-candidates-recompute.txt).

## 3. CV protocol + 1-SE rule — PASS

Static (train_regression.py):
- `CV = KFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED=42)` — train_regression.py:58, seed ml/paths.py:30. **PASS — statically verified**
- `SCORING = "neg_root_mean_squared_error"` applied to the `log1p(SalePrice)` target ⇒ log-space RMSE — train_regression.py:60, 96. **PASS — statically verified**
- All searches fit on `X_train` only (`search.fit(X_train, y_train_log)` — train_regression.py:160, 193); `train_all` loads only train + val (train_regression.py:205-206); the test split is first read in `ml/evaluation/evaluate.py:657` after selection. **PASS — statically verified**
- Tree searches: `RandomizedSearchCV(n_iter=8 ≤ 10, random_state=42)` — train_regression.py:78, 184-192. **PASS — statically verified**

By execution — full GridSearchCV rerun of the exact training code path (evidence: regression-cv-protocol.txt):
- **ridge**: grid best alpha = 31.6228 (log-RMSE 0.10950413) — confirms the report's "grid best was 31.6";
  1-SE threshold -0.11438685; `one_se_alpha` re-derives **alpha = 100** (matches shipped `best_params.alpha=100.0`);
  `-mean_test_score[alpha=100]` = 0.11061228193506771 = recorded `cv_best_score` to all 17 digits.
- **lasso**: grid best alpha = 0.000464159; `one_se_alpha` re-derives **0.004641588833612777** (matches);
  cv_best_score 0.11478372444017348 matches exactly.
- 1-SE implementation read at train_regression.py:107-119: threshold = best_mean − SE(best),
  picks the largest alpha with mean ≥ threshold — the standard 1-SE rule; re-derivation confirms behavior.
- Fresh refit `Ridge(alpha=100, max_iter=10000)` on train reproduces the shipped `ridge_v1.joblib`
  **bit-exactly** (coef max abs diff 0.0, val prediction max abs diff 0.0) — the artifact is reproducible
  from current source + data + seed.

## 4. Prediction sanity — PASS (verified by execution, evidence: regression-champion-recompute.txt)

- Test predictions (dollars): min $66,618 / max $531,895 / mean $175,505 / median $154,835 vs actual
  SalePrice min $55,000 / max $611,657 / mean $177,394 — plausible, no wild extrapolation.
- `expm1` negatives: **0** of 175 (min pred_log = 11.107).
- Interval ordering: low < price < high holds for the 10 sampled rows **and all 175** test rows
  (additive log-space interval with q_low < 0 < q_high guarantees ordering by monotonicity of expm1).

## 5. Serialization — PASS (verified by execution, evidence: regression-serialization.txt)

Champion joblib loaded in a **clean python subprocess** (fresh interpreter, cwd=repo root): loads without
error, estimator `Ridge(alpha=100.0, max_iter=10000)`, and 338 val predictions are **bit-identical**
(sha256 of float64 buffer `afd568ec…642239` in both parent and child). File is 21,490 bytes, pure
sklearn Pipeline (ColumnTransformer → Ridge) — no project-local classes needed at unpickle time.

---

## Findings

| # | Severity | Location | Description | Evidence |
|---|---|---|---|---|
| R-1 | P3 | `models/regression/xgboost_v1.joblib` (estimator params) vs `ml/training/train_regression.py:228-235` | Shipped XGBRegressor has `enable_categorical=True`, a parameter set **nowhere** in current source — the artifact was trained from a slightly different estimator config than the committed code. Numerically inert here (pipeline feeds a dense numeric ndarray; all metrics + predictions reproduce exactly), but the artifact is not reproducible from current source in the strictest sense and the flag would raise if categorical-dtype frames were ever passed. | regression-lasso-rf-recompute.txt; Grep `enable_categorical` over `ml/` → no matches |
| R-2 | P3 | `ml/training/train_regression.py:169` | Latent fragility: final alpha-model refit reconstructs the estimator as `type(estimator)(alpha=alpha, max_iter=estimator.max_iter)`, silently dropping any other non-default constructor params. Harmless today (Ridge/Lasso carry only `max_iter`), but a future param addition would be silently lost between search and shipped model. | static read; regression-cv-protocol.txt (refit matches today) |
| R-3 | P3 (informational — for orchestrator consistency) | `reports/MODEL_EVALUATION.md:108-116` | On the **sealed test** split, xgboost beats the champion ridge on every metric (RMSLE 0.1051 vs 0.1187, R² 0.9446 vs 0.9305, MAE $12,929 vs $15,075). Selection was validation-only per SPEC §6 (methodologically correct, and the bootstrap CI [-0.0133, 0.0060] correctly shows the val gap is not decisive), and the report discloses the test table — but any document that calls ridge "the best model" without the qualifier "on validation" would be inaccurate. Verified true by execution. | regression-candidates-recompute.txt, regression-champion-recompute.txt |

No P0/P1/P2 findings. Every quantitative claim in scope reproduced exactly.

## Coverage summary

- **Read fully**: `ml/training/train_regression.py` (308/308 lines), `ml/training/common.py` (88/88),
  `ml/evaluation/select.py` (371/371), `ml/evaluation/evaluate.py` (interval_coverage:114-124,
  copy_champions_to_registry:151-165, run_evaluation test block:630-775), `ml/features/pipeline.py`
  (build_feature_frame:402-486), `ml/features/stats.py` (head), `ml/tracking.py`, `ml/paths.py`.
- **Verified by execution**: `load_model_frame`, `make_pipeline`, `one_se_alpha`, `_train_alpha_model`
  (via exact GridSearchCV rerun ×2), `regression_metrics`, `residual_interval`, `interval_coverage`,
  `paired_bootstrap_rmsle_diff`, `rank_regression_candidates`, `select_regression_champion`,
  all 5 persisted regression pipelines (val metrics), champion + 4 candidates on test,
  registry-promotion identity (md5), feature_version hash, clean-subprocess unpickle + predict.
- **Verified statically**: CV object/scoring/seed, train-only tuning paths, sealed-test discipline
  (test first read post-selection), 1-SE rule code, randomized-search config (n_iter=8, seed 42).

## Contradictions / notes for the orchestrator

1. **R-3 cross-agent**: docs-truth should check README/FINAL-RELEASE phrasing about the regression
   champion — "ridge is best" is true on validation, false on test (xgboost wins test outright).
2. **R-1 cross-agent** (artifacts agent): xgboost joblib config drift (`enable_categorical=True`) —
   artifact provenance does not exactly match committed training source.
3. Ambient CPU load during CV reruns was noted (other auditors running); rerun timings (7.5s ridge,
   3.3s lasso) are not performance claims.
4. No servers were started; no ports used. No project files were modified — only
   `docs/audit/regression.md` and `docs/audit/evidence/regression-*.txt` were written.
