# Audit: artifacts — MLflow / model-artifact verification (mission §12)

Agent: **artifacts** · Date: 2026-08-07 · Mode: report-only (no project source/config/doc writes;
only `docs/audit/artifacts.md` + `docs/audit/evidence/artifacts-*`). No servers started, no ports used.
Python: `.venv/Scripts/python.exe` (3.14.5; pandas 2.3.3, sklearn 1.9.0, xgboost 3.4.0, mlflow 3.15.1).

All executions ran with ambient load from concurrent audit agents (noted where timing matters; no
timing-sensitive claims in this audit).

## Verdict summary

| # | Mission item | Verdict | Evidence |
|---|---|---|---|
| 1 | Clean-process load: every serving artifact in a FRESH subprocess, fixed feature frame, predictions recorded | **PASS — verified by execution** (15/15 joblib artifacts + DBSCAN pair; identical fixed frame, sha256-pinned) | `evidence/artifacts-T1-load-predict.txt`, `artifacts-T1b-clustering.txt` |
| 1b | Champions match API-served values | **PASS — verified by execution**, with one P2 cross-layer finding (serving feature drift, see F1) | `evidence/artifacts-T1c-replay.txt` |
| 2 | Versioning consistency: champion.json vs files (byte-compare), feature_version, metrics.json vs champion.json | **PASS — verified by execution** (31/31 checks consistent after champion.json's documented 6-dp rounding) | `evidence/artifacts-T2-consistency.txt`, `artifacts-T2b-round6.txt` |
| 3 | Absolute paths in models/*.json, joblib internals, ml/ + backend/ source | **PASS — statically verified + byte-scan** (no structured absolute paths; only coincidental float bytes) | `evidence/artifacts-T3-abspaths.txt` |
| 4 | MLflow inventory + 'artifacts'-path gotcha | **PASS WITH CONCERN — verified by execution** (gotcha CONFIRMED; clustering/evaluation runs log no fitted model — P3; 3 failed-run leftovers — P3) | `evidence/artifacts-T4a-mlflow-inventory.txt`, `artifacts-T4b-logged-models.txt`, `artifacts-T4c-gotcha.txt`, `artifacts-T4d-run-dedup.txt` |
| 5 | Feature-schema compatibility: fitted ColumnTransformer columns == feature_list.json MODEL_FEATURES (names+order) | **PASS — verified by execution** (15/15 artifacts, exact, at Pipeline AND fitted-ColumnTransformer level) | `evidence/artifacts-T5-schema.txt` |
| 6 | Reproducibility spot-check: run `scripts/audit_reproducibility.py` | **PASS — verified by execution** (script: 5/5 PASS; my independent hash fence: 1170 files byte-stable) | `evidence/artifacts-T6-reproducibility.txt`, `artifacts-T6-pre-hashes.txt`, `artifacts-T6-post-hashes.txt` |

## 1. Clean-process load + predict (T1)

Method: one fresh `.venv/Scripts/python.exe` subprocess per artifact (`artifacts-T1-runner.py.txt`).
Fixed frame = first 8 rows of `data/processed/val.csv` (`keep_default_na=False`) through the exact
serving path `ml.features.pipeline.build_feature_frame` → 94 columns; frame sha256
`9736b012…a399` identical in all 15 subprocesses, so every artifact saw provably identical input.

- 15/15 joblib artifacts load and predict with **zero errors/warnings**: both registry champions,
  5 regression, 8 classification (incl. calibrated variants).
- `models/registry/regression_champion.joblib` sha256 `d087a3a1…63bf` == `models/regression/ridge_v1.joblib`
  (byte-identical); `models/registry/classification_champion.joblib` sha256 `d9004a2f…811e7` ==
  `models/classification/random_forest_calibrated_v1.joblib` (byte-identical).
- Champion ridge log-predictions on the fixed frame (full precision in evidence):
  `[12.051764157772308, 12.346192347656187, …]`; champion calibrated-RF class-1 probabilities recorded.
- Clustering (fresh subprocess, `artifacts-T1b-clustering.txt`): DBSCAN loads (eps=1.317004520305001,
  min_samples=2, 22 core samples, labels = 4 clusters + 3 noise == `cluster_assignments.csv` ==
  `cluster_stats.json.n_clusters` == `champion.json.clustering.n_clusters=4`); scaler transforms core
  vectors; serving path `MicroMarketLookup` returns cluster 0 (fallback=False) for NridgHt, and
  nearest-centroid fallback=True for noise (CollgCr) and unknown (NotARealPlace) neighborhoods.

**Champions vs API-served values.** `logs/predictions.jsonl` (real values served by the API;
11 lines at replay time — the file is LIVE, wave-B agents append to it; it grew 9→11 lines during
this audit) was replayed two ways in a fresh subprocess:

- Replay A — payload → current serving path → champions: **0/11 price, 0/11 probability match**
  (e.g. served 236950.33 vs replayed 233933.43; prob 0.31783 vs 0.312543).
- Replay B (decisive) — the *logged feature rows* fed directly into the current champion bytes:
  **11/11 price and 11/11 probability reproduce exactly** (rounded to the served 2dp/6dp).

Conclusion: the champion artifacts on disk are exactly what the API served; the mismatch is entirely
in the feature-building layer → finding F1 (P2).

## 2. Versioning consistency (T2)

`artifacts-T2-consistency.txt` + `artifacts-T2b-round6.txt` (fresh subprocess, project metric
functions on an independent data path):

- champion.json regression name/version/path → `models/regression/ridge_v1.joblib` exists and is
  byte-identical to the registry copy; classification → `random_forest_calibrated_v1.joblib` likewise;
  clustering path exists.
- `feature_version` `9b0f8ba4201c` == `ml.tracking.feature_version(models/feature_list.json)`
  (sha1 of file bytes, 12 chars) — CONSISTENT. `feature_list.json`'s internal `sha1`
  (`7601f2f6…`) == recomputed `sha1(json.dumps(MODEL_FEATURES))`; 94 features, order-equal to
  `ml.features.pipeline.MODEL_FEATURES`.
- Recomputed from artifacts: regression val mae/rmse/r²/rmsle, residual-interval q10/q90, test
  mae/rmse/r²/rmsle/interval_coverage (0.782857 = 137/175), classification F1-optimal threshold
  (re-derived 0.203292 via `pick_f1_threshold`), val/test roc_auc/pr_auc/precision/recall/f1/brier
  and both confusion matrices — **31/31 equal to champion.json after round-6 normalization**
  (champion.json stores round(x, 6) per `ml/evaluation/evaluate.py:_round_metrics`; raw recomputed
  values match to ~1e-8 before rounding).
- metrics.json cross-check: `ridge.val` == champion val (round-6); `random_forest.val_calibrated`
  roc_auc/pr_auc/brier == champion val. The threshold-dependent block differs **by design**:
  metrics.json stores threshold=0.5 operating metrics (tn238/fp1/fn91/tp8) while champion.json
  stores metrics at the tuned threshold 0.203292 (tn122/fp117/fn18/tp81, reproduced exactly).
  `champion.json` == the artifact logged by the latest evaluation run `df99aa9d` (byte-identical;
  the earlier run `79a90e77` differs only in timestamps).

## 3. Absolute paths (T3)

`artifacts-T3-abspaths.txt`:

- 10/10 `models/**/*.json`: no `C:/`, `C:\`, `/Users/`, `/home/`, user-name, or repo-dir-name hits.
- 17/17 joblib raw-byte scan: three byte-level `C:/`-ish hits, all inside binary float64 arrays
  (xgboost `split_conditions`, RF tree arrays) — coincidental bytes, not strings. Refined
  printable-string scan for drive-letter/home patterns: zero real hits (one 6-char `N:/'@dg` float
  artifact). NPZ + assignments CSV clean.
- Source scan of `ml/`, `backend/`, plus repo-wide `*.py` for `Machine_Learning|RUSHMANTH|C:[\\/]|AppData`:
  zero hardcoded absolute paths. Only hits are *guard assertions* in `tests/ml/test_regression.py:90`
  and `tests/ml/test_evaluation.py:198` (`assert "C:\\" not in …`) — tests that enforce the rule.
- Side observation: all 4 `mlruns/*/meta.yaml` embed absolute `file:///C:/Machine_Learning/…`
  `artifact_location` (mlflow file-store default) — portability note only, see F4.

## 4. MLflow inventory + gotcha (T4)

`artifacts-T4a-mlflow-inventory.txt` (via `MlflowClient` with `MLFLOW_ALLOW_FILE_STORE=true`,
tracking URI `./mlruns` — store loads cleanly through the sanctioned API):

| Experiment | Runs (API) | Run dirs on disk | Notes |
|---|---|---|---|
| evaluation (`289403811797199859`) | 2 | 2 | both FINISHED `champion_selection_v1`, metrics identical |
| regression (`313078409984191284`) | 9 | 9 + `models/` | 8 FINISHED + 1 FAILED (`linear_v1` 1ce16e7a) |
| classification (`473755598599804231`) | 5 | 7 + `models/` | 5 FINISHED active + 2 FAILED deleted (`logistic_v1` ×2) |
| clustering (`493522534186201585`) | 3 | 3 | all FINISHED `dbscan_v1`, metrics identical |
| `.trash` | — | 2 | deleted probe experiments `classification_probe{,2}` |

- Params/metrics/tags present on every run (params 0–8, metrics 4–19, tags 7–9 incl.
  `dataset_version`, `feature_version=9b0f8ba4201c`, `trained_at`); 3 runs dumped in full in evidence.
  Evaluation-run metrics match champion.json exactly (e.g. `classification_threshold=0.20329224173900778`,
  `reg_val_rmsle=0.13543666916035035`).
- **Model artifacts ARE logged** for regression + classification — as mlflow-3.x LoggedModel entities
  under `mlruns/<exp>/models/m-*/` (they do NOT appear in `list_artifacts(run_id)`; that only shows
  the JSON side-artifacts). Regression: 9 LoggedModels, 8 READY with `model.pkl` (cloudpickle),
  1 PENDING from the failed run. Classification: 13 LoggedModels, 11 READY with `model.skops`
  (skops + explicit trusted-types list), 2 PENDING from the deleted failed runs — 2 per active run
  (`model` + `model_calibrated`). Loadability verified (`artifacts-T4b-logged-models.txt`): the ridge
  LoggedModel predicts **bit-identically** to `ridge_v1.joblib` (max diff 0.0); the calibrated-RF
  LoggedModel matches `random_forest_calibrated_v1.joblib` to 5.6e-17 (ulp). See F3 for the gaps.
- Duplicate runs (re-runs during build waves) have **identical metrics** per name group
  (`artifacts-T4d-run-dedup.txt`) — independent determinism evidence.
- **'artifacts'-path gotcha: CONFIRMED** (`artifacts-T4c-gotcha.txt`, throwaway dirs under system
  temp, deleted afterwards). `FileStore._is_valid_run_directory`
  (`.venv/Lib/site-packages/mlflow/store/tracking/file_store.py:687-699`) rejects a run dir whose
  path contains a component **exactly equal to** `artifacts` (ZDI-CAN-26649 defense):
  store at `<tmp>/artifacts/mlruns` → `start_run` fails with
  `MlflowException: Run '<uuid>' not found`; prefix-only `<tmp>/artifacts_gotcha/mlruns` and the
  control store succeed. This matches the workaround comment in `scripts/audit_reproducibility.py:50-54`
  (scratch store must not live under a component named `artifacts`) — wording "path part" is precise;
  a component merely *containing* the substring is fine.

## 5. Feature-schema compatibility (T5)

`artifacts-T5-schema.txt`: for all 15 pipelines (5 regression, 8 classification, 2 registry
champions) the expected input columns equal `feature_list.json` MODEL_FEATURES **exactly (94 names,
in order)** — both at `Pipeline.feature_names_in_` and at the fitted `ColumnTransformer.feature_names_in_`
level (for calibrated models the CT was reached via `calibrated_classifiers_[i].estimator`; an
unfitted `.estimator` attr on `CalibratedClassifierCV` can shadow it — walker detail, not a defect).

## 6. Reproducibility spot-check (T6)

Ran `.venv/Scripts/python.exe scripts/audit_reproducibility.py` (background; ~25 min under ambient
load). Result **OVERALL: PASS** — all 5 steps (`artifacts-T6-reproducibility.txt`):

1. data_determinism PASS (5 processed outputs byte-identical);
2. feature_artifacts PASS (byte-identical; feature_version stays `9b0f8ba4201c`);
3. model_reproducibility PASS (full retrain of both families; 50-row val slice max|dlog|=0.0,
   max|dprob|=2.2e-16; metrics.json equal within float tolerance; only ulp-level RF drift ~1e-15
   from thread-order accumulation; 3 non-byte-identical files restored from backup);
4. seed_audit PASS (19 usages anchored to 42, 0 exceptions);
6. dependency_pins PASS (21+14 requirements `==`-pinned; `pip check` clean).

Because the script deliberately mutates `data/processed/`, `models/`, `figures/` mid-run, I fenced it
with my own md5 snapshot of 1170 files (`data/processed`, `models`, `figures`, `mlruns`, `logs`)
taken before launch: after completion **zero files missing/added/changed**
(`artifacts-T6-post-hashes.txt`) — the repo is byte-stable, `mlruns/` provably untouched by the
retrain (scratch store `mlruns_repro_audit/` and `artifacts/repro_audit_backup/` both removed).

## Findings

| ID | Severity | Location | Description | Evidence |
|---|---|---|---|---|
| F1 | **P2** | `ml/features/serving.py:181` (+`models/feature_defaults.json`) vs `logs/predictions.jsonl` | **Serving feature drift vs historical API predictions.** All 11 logged API predictions were served from features with `OpenPorchSF=27, amenity_count=5` for payloads explicitly carrying `open_porch_sf: 0`; the current serving path builds `0/4` for the same payloads, so an identical request today yields a different price (e.g. 236950.33 → 233933.43, −1.27%) and probability (0.31783 → 0.312543). Champion bytes are proven innocent (reproduce logged values from logged features 11/11). Facts: `serving.py` mtime 06:15Z predates the logs (11:06Z–13:02Z); `feature_defaults.json` was regenerated mid-logging at 11:31Z (current default `OpenPorchSF=None`); all lines incl. post-11:31Z ones show 27 → the serving process held stale code/defaults in memory (dev server never restarted across the 06:07–06:15Z edits). Impact: historical prediction logs are not replayable through the current pipeline, and drift monitoring compares those logged features against the reference. Cross-agent: backend/monitoring/features. | `evidence/artifacts-T1c-replay.txt` |
| F2 | **P3** | `ml/clustering/train.py` (via mlruns inventory) | **SPEC §7 deviation: clustering and evaluation runs log no fitted model artifact to MLflow** — only JSON side-artifacts (`cluster_stats.json`, `eps_selection_trace.json`, `champion.json`). Regression/classification runs do log READY, loadable LoggedModels (verified). Serving is unaffected (`models/clustering/*.joblib` on disk), but the tracking record for clustering is not self-contained. | `evidence/artifacts-T4a-mlflow-inventory.txt` |
| F3 | **P3** | `mlruns/` (run 1ce16e7a; runs 445a0d46, ff1129c9) | **Store housekeeping:** 3 FAILED runs retained (1 active-lifecycle `linear_v1`, 2 deleted `logistic_v1`) with incomplete PENDING LoggedModels (`m-00d2b25f…`, `m-7d1ad55…`, `m-b1147f5…` — no flavor/artifact payload), plus 2 deleted probe experiments in `.trash`. Harmless (search_runs excludes deleted; FAILED run metrics match their FINISHED siblings) but noise for anyone auditing the store. | `evidence/artifacts-T4a-mlflow-inventory.txt`, `artifacts-T4d-run-dedup.txt` |
| F4 | **P3** | `mlruns/*/meta.yaml` (4/4) | Absolute `artifact_location: file:///C:/Machine_Learning/Prop-pulse/mlruns/…` baked into experiment metadata (mlflow file-store default). Moving the repo breaks artifact resolution for these experiments; no impact while the repo stays put. | `evidence/artifacts-T3-abspaths.txt` §4 |
| F5 | **P3** | `models/clustering/cluster_stats.json:73` vs `models/clustering/dbscan.joblib` | Recorded `eps=1.3170045189879962` (JSON + mlflow metric) ≠ fitted `dbscan.eps=1.317004520305001` (Δ≈1.3e-9). Metadata-only; serving never reads eps for inference. | `evidence/artifacts-T1b-clustering.txt` |
| F6 | **P3** (info) | `ml/training/train_classification.py:127-141` vs `ml/training/train_regression.py:283` | Inconsistent MLflow serialization between families: classification logs skops (with explicit trusted-types list; loading requires `skops.io.get_untrusted_types` + `trusted=[...]`, CVE-2024-37065 API), regression logs cloudpickle. Both verified loadable and prediction-identical to disk artifacts; noted for operators pulling models from the store. | `evidence/artifacts-T4b-logged-models.txt` |

## Coverage

Artifacts verified by execution: 17/17 joblib (2 registry champions, 5 regression, 8 classification,
DBSCAN + scaler), 10/10 models/**/*.json, cluster_assignments.csv, shap_values_sample.npz (path scan),
`models/champion.json` (all 31 metric/path/version checks), `logs/predictions.jsonl` (11 served
predictions replayed two ways). MLflow: 4 experiments + .trash, 21 run dirs, 22 LoggedModel dirs,
3 runs dumped in full, 2 LoggedModels loaded and prediction-compared, gotcha reproduced with positive
+ two negative controls. `scripts/audit_reproducibility.py` executed end-to-end with an independent
1170-file md5 fence. Source read for method verification: `ml/tracking.py`, `ml/paths.py`,
`ml/evaluation/evaluate.py` (run_evaluation flow), `ml/evaluation/select.py` (threshold/selection),
`ml/training/common.py`, `ml/training/train_classification.py` (metrics + model logging),
`ml/training/train_regression.py` (model logging), `ml/features/pipeline.py` (build_feature_frame,
write_feature_list), `ml/features/serving.py` (serving_payload_to_raw), `ml/clustering/serve.py`,
`backend/app/services/prediction_service.py`.

Not covered (out of scope / other agents): SHAP artifact correctness (§11), cluster quality (§10),
API runtime behavior (§13), Docker image artifact freshness (§19).

## Notes for the orchestrator

- F1 is the only cross-agent contradiction: the API's own logged predictions do not reproduce through
  the current serving path, while the artifacts are byte-consistent with everything else. The
  backend agent (llba-backend) and monitoring agent (§16) should confirm whether the current
  defaults file (`OpenPorchSF=None`) and the stale-server explanation match their observations; the
  drift-check inputs (logged features) embed the stale mapping.
- The mlflow "model artifacts logged" check is easy to false-fail: `list_artifacts(run_id)` shows
  only JSON files in mlflow 3.x; logged models live under `mlruns/<exp>/models/m-*/`. Any other
  agent verifying §7 should use the LoggedModel inventory in `artifacts-T4a-mlflow-inventory.txt`.
- `logs/predictions.jsonl` is being appended to by concurrent wave-B agents; any hash-based check
  over `logs/` must treat it as live.
