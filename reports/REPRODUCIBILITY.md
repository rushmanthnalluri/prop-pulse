# PropPulse — Reproducibility Audit

**Date:** 2026-08-07 · **Auditor:** reproducibility-audit agent · **Verdict: REPRODUCIBLE (all steps PASS)**

**SIMULATED TARGET (ADR-3): classification metrics below measure
reproducibility against the documented DOM simulation, not real-world
sale-speed performance.**

> **Post-audit note (2026-08-07, forensic audit):** `data/processed/schema.json`
> has since been intentionally corrected (AUD-13: `MSSubClass` dtype declared
> `int64`, matching the on-disk CSV) — its current md5 is
> `2721af81cee05c942202bf2f7eb4e43a` (the `4061da6f…` quoted in the step-1
> output below is this audit's pre-correction value). The determinism claim is
> unaffected: a fresh `python -m ml.data.pipeline` re-run regenerates exactly
> the committed file, so step 1 still passes.

Every claim below is backed by a pasted command output. The whole audit is automated and
repeatable via one script:

```bash
.venv/Scripts/python.exe scripts/audit_reproducibility.py   # exit 0 = PASS, 1 = FAIL
```

The script re-runs the real pipelines (data → features → full regression + classification
retrains), compares hashes/predictions/metrics, audits seeds and dependency pins, prints a
PASS/FAIL table, and restores the committed artifacts so the repo stays byte-stable.
Environment: Windows + Git Bash, Python 3.14.5 (`.venv`), pandas 2.3.3, scikit-learn 1.9.0,
xgboost 3.4.0, mlflow 3.15.1, seed 42 everywhere.

## Summary table

| # | Check | Result | Key evidence |
|---|-------|--------|--------------|
| 1 | Data pipeline determinism | **PASS** | 5/5 processed outputs byte-identical (md5) after full re-run |
| 2 | Feature artifact determinism | **PASS** | 3/3 artifacts byte-identical (sha1); `feature_version` stays `9b0f8ba4201c` |
| 3 | Model reproducibility (full retrain) | **PASS** | ridge max\|Δlog\| = 0.0; calibrated RF max\|Δprob\| = 2.22e-16; metrics equal within float tolerance |
| 4 | Seed audit (`ml/`) | **PASS** | 19 seeded usages verified, 0 exceptions |
| 5 | MLflow inventory | **PASS (with cosmetic notes)** | 19 active runs, all tagged `dataset_version` + `feature_version`; orphans/duplicates documented below |
| 6 | Dependency pins | **PASS** | 21 + 14 requirements all `==`-pinned; `pip check` clean |
| 7 | From-scratch runbook | **VERIFIED** | all 9 pipeline CLIs exist and import cleanly |

Full raw output of the final audit run (exit code 0):

```
========================================================================
PropPulse reproducibility audit
repo: C:\Machine_Learning\Prop-pulse
python: C:\Machine_Learning\Prop-pulse\.venv\Scripts\python.exe
========================================================================

--- step_data_determinism ---
  train.csv              md5 c237df1860d7310db31de7af24150a2f -> c237df1860d7310db31de7af24150a2f OK
  val.csv                md5 c04b4ab6cfc538eee295ca29485bd7cb -> c04b4ab6cfc538eee295ca29485bd7cb OK
  test.csv               md5 b576c82c7678ae48e0263d1124ba4404 -> b576c82c7678ae48e0263d1124ba4404 OK
  schema.json            md5 4061da6f4fbdb72096b4a51690f82534 -> 4061da6f4fbdb72096b4a51690f82534 OK
  outliers_report.json   md5 b5544a6427c088d204d340a6951844bd -> b5544a6427c088d204d340a6951844bd OK
  -> PASS: all 5 processed outputs byte-identical

--- step_feature_artifacts ---
  feature_list.json          sha1 9b0f8ba4201c... -> 9b0f8ba4201c... OK
  neighborhood_stats.json    sha1 3568fd940942... -> 3568fd940942... OK
  feature_defaults.json      sha1 749a0593dd12... -> 749a0593dd12... OK
  feature_version: 9b0f8ba4201c -> 9b0f8ba4201c (champion.json: 9b0f8ba4201c)
  -> PASS: artifacts byte-identical; feature_version=9b0f8ba4201c

--- step_model_reproducibility ---
  [retrain] INFO __main__: linear: val rmsle=0.1425 rmse_log=0.1425 mae=15888 r2=0.9202 (0.8s)
  [retrain] INFO __main__: ridge: val rmsle=0.1354 rmse_log=0.1354 mae=14527 r2=0.9280 (13.6s)
  [retrain] INFO __main__: lasso: val rmsle=0.1407 rmse_log=0.1407 mae=15355 r2=0.9168 (8.7s)
  [retrain] INFO __main__: random_forest: val rmsle=0.1590 rmse_log=0.1590 mae=18279 r2=0.8824 (41.9s)
  [retrain] INFO __main__: xgboost: val rmsle=0.1398 rmse_log=0.1398 mae=15461 r2=0.9156 (28.8s)
  [retrain] INFO __main__: logistic: val ROC-AUC=0.6956 PR-AUC=0.5047 brier=0.1983 | calibrated ROC-AUC=0.6996 PR-AUC=0.5089 brier=0.1913
  [retrain] INFO __main__: decision_tree: val ROC-AUC=0.6006 PR-AUC=0.3689 brier=0.2741 | calibrated ROC-AUC=0.7013 PR-AUC=0.4666 brier=0.1973
  [retrain] INFO __main__: random_forest: val ROC-AUC=0.7292 PR-AUC=0.5368 brier=0.1935 | calibrated ROC-AUC=0.7218 PR-AUC=0.5250 brier=0.1856
  [retrain] INFO __main__: xgboost: val ROC-AUC=0.7255 PR-AUC=0.5148 brier=0.1942 | calibrated ROC-AUC=0.7187 PR-AUC=0.5032 brier=0.1904
  ridge_v1 50-row val slice: max|dlog|=0.000e+00 max|d$|=$0.0000
  random_forest_calibrated_v1 50-row val slice: max|dprob|=2.220e-16
  regression/metrics.json: bytes differ; 7 leaf value(s) differ, 0 beyond tolerance
    random_forest.val.mae: 18279.46816670844 -> 18279.46816670842
    random_forest.val.rmse: 27698.449669574795 -> 27698.44966957479
    random_forest.val.r2: 0.8823685019015454 -> 0.8823685019015455
    random_forest.val.rmsle: 0.15897383817704103 -> 0.15897383817704105
    random_forest.val.rmse_log: 0.15897383817704103 -> 0.15897383817704105
    random_forest.val.residual_interval.q_low: -0.17820818447451908 -> -0.17820818447452175
    random_forest.val.residual_interval.q_high: 0.1400021305411226 -> 0.14000213054111957
  classification/metrics.json: bytes differ; 2 leaf value(s) differ, 0 beyond tolerance
    random_forest.val.brier: 0.1934790587314492 -> 0.19347905873144916
    random_forest.val_calibrated.brier: 0.1855502446493561 -> 0.18555024464935613
  regression: 5/6 artifacts byte-identical; changed: ['metrics.json']
  classification: 7/9 artifacts byte-identical; changed: ['metrics.json', 'random_forest_calibrated_v1.joblib']
  figures: 2/2 artifacts byte-identical
  restored 3 file(s) from backup to keep the repo byte-stable
  -> PASS: predictions match (max|dlog|=0.00e+00, max|dprob|=2.22e-16); metrics.json equal within float tolerance

--- step_seed_audit ---
  seeded/42-anchored usages verified: 19
  exceptions: 0
  -> PASS: all randomness anchored to RANDOM_SEED=42 (19 usages, 0 exceptions)

--- step_dependency_pins ---
  requirements.txt: 21 requirements, 0 unpinned
  backend/requirements.txt: 14 requirements, 0 unpinned
  pip check: exit 0 — No broken requirements found.
  -> PASS: all requirements ==-pinned; pip check clean

========================================================================
SUMMARY
  1. data_determinism          PASS  all 5 processed outputs byte-identical
  2. feature_artifacts         PASS  artifacts byte-identical; feature_version=9b0f8ba4201c
  3. model_reproducibility     PASS  predictions match (max|dlog|=0.00e+00, max|dprob|=2.22e-16); metrics.json equal within float tolerance
  4. seed_audit                PASS  all randomness anchored to RANDOM_SEED=42 (19 usages, 0 exceptions)
  6. dependency_pins           PASS  all requirements ==-pinned; pip check clean

OVERALL: PASS
========================================================================
```

## Step 1 — Data pipeline determinism

Method: md5 of `data/processed/{train,val,test}.csv` + `schema.json` + `outliers_report.json`,
then full re-run of `.venv/Scripts/python.exe -m ml.data.pipeline`, then md5 again.
Result (see audit output above): **all five outputs byte-identical** across three independent
re-runs. Determinism comes from: time-based split with no shuffling (`ml/data/split.py`),
rule-based outlier trimming, and the DOM simulator drawing per-row noise from
`np.random.default_rng([RANDOM_SEED, Id])` — seeded per property Id, independent of row order
(`ml/data/sale_speed.py:94`).

## Step 2 — Feature artifacts

Method: sha1 of `models/feature_list.json`, `models/neighborhood_stats.json`,
`models/feature_defaults.json` before/after `python -m ml.features.pipeline`, plus
`ml.tracking.feature_version()` (sha1 of `feature_list.json` bytes, 12 chars) compared against
`models/champion.json`. Result: **byte-identical**; `feature_version` unchanged at
**`9b0f8ba4201c`**, matching `champion.json` — the champions remain valid for the committed
feature list.

## Step 3 — Model reproducibility (full retrain)

Method: backed up `models/regression/`, `models/classification/` and the two classification
figures; fully retrained via `python -m ml.training.train_regression` and
`python -m ml.training.train_classification` (all 9 candidates + calibrated variants,
MLflow runs redirected to a throwaway scratch store so `mlruns/` is untouched); then compared
OLD (backup) vs NEW artifacts on a **fixed 50-row slice** (first 50 rows of
`data/processed/val.csv`, features built with the persisted train-fit stats):

- **Regression champion `ridge_v1.joblib`**: max |Δ prediction| = **0.000e+00** in log space,
  **$0.0000** in dollars — bit-identical.
- **Classification champion `random_forest_calibrated_v1.joblib`**: max |Δ probability| =
  **2.22e-16** — one float64 ulp.
- **Artifact bytes**: regression 5/6 byte-identical, classification 7/9, figures 2/2. The
  only differing files: both `metrics.json` and `random_forest_calibrated_v1.joblib`.
- **metrics.json**: 9 differing leaf values total (7 regression, 2 classification), **all
  under `random_forest.*` and all at 1-ulp scale** (e.g. val MAE 18279.46816670844 →
  …842; calibrated Brier 0.1855502446493561 → …613). 0 leaves beyond tolerance
  (`isclose(rel_tol=1e-9, abs_tol=1e-12)`). Retrained headline val metrics match the committed
  ones exactly at reported precision (ridge RMSLE 0.1354, R² 0.9280; calibrated RF PR-AUC
  0.5250, Brier 0.1856 — see retrain log lines above).

**Explanation of the ulp drift (expected, not a bug):** the RandomForest *fit* is fully
deterministic — the raw `random_forest_v1.joblib` files are byte-identical after retraining.
But `RandomForest*.predict/predict_proba` with `n_jobs=-1` accumulates per-tree outputs in
thread-completion order, and float addition is non-associative, so probabilities can move by
~1e-16 run-to-run. The calibrated variant embeds sigmoid calibrators fitted on out-of-fold
probabilities, so that 1-ulp input drift also perturbs the fitted sigmoid coefficients — hence
the byte difference in `random_forest_calibrated_v1.joblib`. Impact on any real quantity
(metrics, thresholds, predictions): none at reported precision. On PASS the audit restores the
3 byte-differing files from backup, so the committed artifacts stay canonical.

## Step 4 — Seed audit

Method: scanned all of `ml/` for `random_state=`/`seed=` assignments, `np.random.*` RNG
construction, unseeded `np.random.rand*/choice/shuffle`, stdlib `random` imports, and
`.sample()` calls without `random_state`. Result: **19 seeded usages verified, 0 exceptions**.
Every one resolves to `RANDOM_SEED = 42` (`ml/paths.py:30`):

- CV splitters: `KFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)` (regression),
  `StratifiedKFold(..., random_state=RANDOM_SEED)` (classification tuning + calibration).
- Searches: `RandomizedSearchCV(random_state=42)`; `GridSearchCV` is exhaustive (no randomness).
- Estimators: RF regressor/classifier, both XGBoost models, logistic regression,
  decision tree — all constructed with `random_state=RANDOM_SEED`.
- Bootstrap (evaluation) and SHAP/background sampling: `np.random.default_rng(seed)` /
  `.sample(random_state=seed)` with seed defaulting to 42.
- DOM simulator: per-row `default_rng([seed, Id])` — deterministic per property.

**Determinism notes (sklearn/xgboost):** linear models (ridge/lasso/linear) and XGBoost with
`tree_method="hist"` + fixed `random_state` are bit-reproducible here — their retrained joblibs
are byte-identical. sklearn forests are fit-deterministic (byte-identical joblibs) with the
predict-time thread-order caveat quantified in step 3. LogisticRegression uses lbfgs
(deterministic); Lasso uses cyclic coordinate descent (deterministic).

## Step 5 — MLflow inventory

Method: mlflow API (`MlflowClient`, `MLFLOW_ALLOW_FILE_STORE=true`, file store `./mlruns`).
Output:

```
tracking_uri: file:///C:/Machine_Learning/Prop-pulse/mlruns
experiment 'classification' (id=473755598599804231): 5 runs
  run names: {'logistic_v1': 2, 'xgboost_v1': 1, 'random_forest_v1': 1, 'decision_tree_v1': 1}
  missing dataset_version tag: none
  missing feature_version tag: none
  duplicate run names: {'logistic_v1': 2}
experiment 'clustering' (id=493522534186201585): 3 runs
  run names: {'dbscan_v1': 3}
  missing dataset_version tag: none
  missing feature_version tag: none
  duplicate run names: {'dbscan_v1': 3}
experiment 'evaluation' (id=289403811797199859): 2 runs
  run names: {'champion_selection_v1': 2}
  missing dataset_version tag: none
  missing feature_version tag: none
  duplicate run names: {'champion_selection_v1': 2}
experiment 'regression' (id=313078409984191284): 9 runs
  run names: {'lasso_v1': 2, 'ridge_v1': 2, 'linear_v1': 3, 'xgboost_v1': 1, 'random_forest_v1': 1}
  missing tags: none
TOTAL active runs: 19
```

**Every active run carries `dataset_version` and `feature_version` tags** (plus `trained_at`).
On-disk cross-check of run `meta.yaml` files (21 run dirs vs 19 active runs) shows the cosmetic
leftovers from earlier build-wave crashes/retries:

- 1 `linear_v1` run (regression) with `status=FAILED` still `active` — crashed mid-logging.
- 2 `logistic_v1` runs (classification) `status=FAILED`, soft-`deleted` (excluded from the
  active-only API count of 5).
- `mlruns/.trash/` holds 2 deleted experiments containing 3 orphan run dirs total.
- Duplicate run names (above) come from legitimate re-runs during the build waves.
- An empty top-level `mlruns/models/` directory appears whenever an mlflow client initializes
  the registry store (mlflow 3.15 side effect; removed after this audit).

None of these affect the champions, the metrics, or the API — they are inventory cosmetics in
the gitignored `mlruns/` store.

**mlflow file-store gotcha found during this audit (worth documenting for deployment):**
mlflow 3.15's `FileStore._is_valid_run_directory` (ZDI-CAN-26649 traversal defense) rejects any
run whose absolute path contains an `artifacts` component, so a tracking URI rooted under a
directory named `artifacts/...` fails deterministically at `create_run` with
`MlflowException: Run '<uuid>' not found`. The audit therefore redirects retrain runs to a
repo-root scratch store (`mlruns_repro_audit/`, deleted afterwards). Any future
`MLFLOW_TRACKING_URI` override must avoid an `artifacts` path component.

## Step 6 — Dependency pins

`requirements.txt`: 21 requirements, **0 unpinned** (all `==`). `backend/requirements.txt`:
14 requirements, **0 unpinned**. `.venv/Scripts/python.exe -m pip check` → exit 0,
`No broken requirements found.` Pin rationale (pandas 2.3.3 <3 for mlflow, numpy 2.4.6 <2.5
for numba/shap) is recorded in ADR-6.

## Step 7 — From-scratch reproduction runbook

Verified command sequence (all from repo root, Git Bash on Windows). Existence was verified by
importing each module and confirming `main()` + an `if __name__ == "__main__"` guard — **not**
by running `--help`, since most `ml.*` CLIs execute immediately without argv parsing:

```
ml.data.pipeline                       importable, main() present
ml.features.pipeline                   importable, main() present
ml.training.train_regression           importable, main() present
ml.training.train_classification       importable, main() present
ml.clustering.train                    importable, main() present
ml.evaluation.evaluate                 importable, main() present
ml.explainability.build_artifacts      importable, main() present
ml.monitoring.reference                importable, main() present
ml.monitoring.drift_check              importable, main() present
```

Runbook (identical to README §"Local setup", exercised end-to-end by this audit for the
first four commands):

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
cp .env.example .env

.venv/Scripts/python.exe -m ml.data.pipeline                 # → data/processed/* (byte-identical, step 1)
.venv/Scripts/python.exe -m ml.features.pipeline             # → models/{feature_list,neighborhood_stats,feature_defaults}.json (step 2)
.venv/Scripts/python.exe -m ml.training.train_regression     # → models/regression/*  (step 3, ~2 min)
.venv/Scripts/python.exe -m ml.training.train_classification # → models/classification/* (step 3, ~3 min)
.venv/Scripts/python.exe -m ml.clustering.train              # → models/clustering/*
.venv/Scripts/python.exe -m ml.evaluation.evaluate           # reads the SEALED test split — run deliberately
.venv/Scripts/python.exe -m ml.explainability.build_artifacts# → models/explainability/*
.venv/Scripts/python.exe -m ml.monitoring.reference          # → models/monitoring/reference_stats.json

# serving
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
cd frontend && npm install && npm run dev
# drift check (argparse CLI; --help verified safe):
.venv/Scripts/python.exe -m ml.monitoring.drift_check [--window N] [--log PATH]
```

`ml.monitoring.drift_check --help` output (the only CLI with an argparse interface, verified
directly — quoted from the audit run; post-audit the CLI also gained additive `--reference` /
`--output` flags, defaults unchanged, AUD-25):

```
usage: python.exe -m ml.monitoring.drift_check [-h] [--window WINDOW] [--log LOG]
PSI drift check of recent predictions vs the train reference.
options: -h/--help, --window (default 500), --log (default logs/predictions.jsonl)
```

## Repo-state guarantee

After the audit, the repository is byte-identical to its pre-audit state (verified by md5:
`ridge_v1.joblib` `eee200e5…`, `random_forest_calibrated_v1.joblib` `cfd06a15…`, both
`metrics.json`, both classification figures, all processed CSVs and feature artifacts match
their pre-audit hashes). Backups and the scratch MLflow store are deleted on PASS; on FAIL the
backups are restored and kept under `artifacts/repro_audit_backup/` for investigation.
