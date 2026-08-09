# Workflow Red Team Report — PropPulse Guided ML Workbench (`/workflow/*`)

**Date:** 2026-08-09 · **Role:** independent adversarial review of the 12-stage guided ML workbench
**Scope:** read-only on source; live attacks against the running stack. Initial targets :8200/:5300
(mission-provided); the :8200 backend died mid-review (cause not attributable — a concurrent agent
session shares this workspace), so the documented fallback pair was used for the remainder:
backend :8540 (`CORS_ORIGINS=http://localhost:5540`), frontend :5540 (`VITE_API_URL=http://localhost:8540`),
both stopped after the review.
**Docs read:** `workflow-architecture.md` (binding spec, cited ARCH), `ml-capability-inventory.md`
(INV), `workflow-mechanics.md` (MECH). **Code read in full:** `ml/workflow/*.py` (9 files),
`backend/app/{api/workflow_*, services/workflow/*, schemas/workflow}.py`,
`frontend/src/{pages,components}/workflow/*`, `frontend/src/api/workflow.js`.

---

## 1. The 10 mandated questions — verdicts

### Q1. Are we copying PlacementPredict instead of designing PropPulse? — **SOUND (designed, not copied)**

The workbench is a genuine redesign that keeps PlacementPredict's good mechanics and fixes its
smells, exactly per MECH §7's copy/adapt/discard analysis:

- **Discarded smells, verified absent:** no side-effectful GETs (training is `POST
  /workflow/datasets/{id}/jobs` → 202 → subprocess → polled `status.json`, never a 40 s hung
  request — MECH §7 Adapt #1); no session-cookie state (dataset-id resources keyed in the URL);
  no ephemeral uploads (uploads survive restarts — verified: uploads and job history were intact
  across the backend restart I witnessed); no startup `_clean_uploads`; confusion matrices use
  labelled `{tn,fp,fn,tp}` via `classification_metrics` (the MECH §7 discard-#8 `.ravel()` bug is
  not reproduced); feature importance is aggregated native importance, not "arbitrary first fold"
  (MECH discard #6); the EDA-vs-model imputation inconsistency (MECH discard #7) is absent — EDA
  stages report raw missingness only.
- **Kept patterns, honestly attributed:** uuid8 ids, ordered validation with per-failure file
  deletion, registry-as-single-source, deterministic recomputed splits, curve thinning ≤ 80 points
  (all cited to MECH in code docstrings).
- **PropPulse-specific design:** sandbox-vs-champion isolation (`models/workflow/` root, champion
  never touched), 12 stages with bridge stages 10–12, the honesty-label system (§7), one-job-at-a-
  time guard, subprocess isolation with pinned `n_jobs`.

### Q2. Are the EDA stages actually useful for housing data? — **SOUND**

Stages 01–05 are thin, honest pandas over the raw frame, but the Ames-specific metadata is what
makes them useful rather than generic: stage 04 names the *actual pipeline policy* per column
(PoolQC 1,453 → `fill_absent_token` "NA means 'no pool'"; LotFrontage 259 →
`impute_neighborhood_median`, train-split only) and lands policy-less columns in `blocking` with
"apply_cleaner will raise" (`ml/workflow/profile.py:387-434`). Stage 02 reports target availability
with the SIMULATED classification caveat and recommends the time split from real `YrSold`
cardinality (5 sale years → time, ADR-4). Stage 03 carries the log1p skew note on SalePrice.
Limitation (by declared design, ARCH §7): only the Ames schema is explorable — no arbitrary CSVs.

### Q3. Are all charts meaningful? — **SOUND**

Every chart encodes a real, checkable aggregation; nothing decorative found. Stage 05: histogram
bins sum to the row count (1,460 verified), scatter is seeded-downsampled with an honest
`sampled` flag (`max_points=100` → exactly 100 points, `sampled: true, n_total: 1460`), box groups
sorted by median (NridgHt $315,000 top), correlation selects top-|corr| with the target
(OverallQual first — correct for Ames). Stage 08: actual-vs-predicted carries a 45° reference,
the PR curve carries the positive-rate baseline (0.293), calibration carries the perfect line,
ROC the chance diagonal. Every chart has a `ChartA11yTable` of the exact plotted values and a
caption naming split + n.

### Q4. Are we showing metrics we cannot justify? — **SOUND**

- **No silhouette anywhere:** the clustering evaluation payload contains no silhouette key
  (grep-verified on the live payload) and the UI says so explicitly ("No cluster-quality score is
  shown — the pipeline does not compute one", `EvaluationWorkspace.jsx:616-620`).
- **No ROC-for-regression category errors:** the regression evaluation payload has no `roc`/`pr`
  keys (verified live) and renders metric cards + scatter + residual histogram only.
- **No classification "accuracy" column:** absent from `classification_metrics` output, from the
  comparison-table column set (`ComparisonTable.jsx:30-35` — PR-AUC/ROC-AUC/F1/Brier), and a
  frontend-wide grep for `Accuracy` finds nothing.
- **No classification bootstrap** (machinery doesn't exist → key omitted, verified live),
  **no SHAP for sandbox models** (native importance only, labelled "not SHAP"; `null` importance
  renders an empty state, `EvaluationWorkspace.jsx:86-93`).
- All evaluation numbers derive from persisted `val_predictions.csv` — recomputation from the
  arrays matches served metrics to 6 decimals (traces §2).

### Q5. Are we allowing invalid workflow states? — **WEAK (one P1, two P2)**

Strong where probed; one real integrity gap found:

- Stage 08/09 lock on server truth (`can_evaluate`/`can_predict_sandbox`); deep-linking
  `/workflow/08-evaluate` on a fresh upload renders the designed locked state naming stage 07
  (screenshot `a-locked-08.png`); the locked stepper item is a `<button>`, not a link — URL
  manipulation cannot reach unavailable content. The API independently enforces 404/409 server-
  side (defense in depth).
- Single-job guard: immediate second POST → 409 naming the running job. Delete-with-running-job →
  409 naming it. Unknown slug → redirect; invalid dataset id → dropped; unknown-but-valid id →
  falls back to `ames` with a toast.
- **Orphan sweep verified live:** the :8200 backend died mid-wave leaving `job_ceb2c57b` at
  `running` forever; my :8540 server's first workflow request swept it to `failed` ("server
  restarted before the job finished").
- **P1 — split-drift stale merge (reproduced, see §3):** re-preparing an upload with a different
  config does not invalidate or segregate prior job results. The comparison table kept showing
  ridge RMSLE 0.12703 (old 219-row val split) while its own provenance block updated to the new
  split (`n_train 874, n_val 292`), and the bootstrap block kept describing the old val vectors.
  Jobs are not bound to the prepare `fingerprint` they trained on. Sandbox predict also silently
  combines *new* sandbox stats with *old* pipelines after a re-prepare (the `(path,mtime)` cache
  reloads stats; nothing checks the job's fingerprint).
- **P2 — candidate-select desync on job switch** (`SandboxPredictPanel.jsx:123-136`): switching
  from a regression job (candidate `ridge`) to the classification job leaves React state at
  `ridge` while the `<select>` displays `logistic`; the first submit POSTs `/predict/ridge` → a
  loud 404. Self-heals after the roster reload; never serves a silently-wrong model.
- **P2 — `can_train` estimate vs actual:** unprepared datasets use the 70/15/15 row estimate; the
  outlier rule can then push the real train split below 150 at prepare time (a ~214-row upload
  passes `can_train` but 400s at prepare). Each message is locally honest; they can contradict.
- Note (accepted design, ARCH §2.3/CONTRACT §5.13): the single-job guard is per-process; two API
  processes can each spawn a job. Nothing enforces single-worker deployment.

### Q6. Is the preprocessing actually leakage-safe? — **SOUND**

Verified in code and live: split first (`ml/workflow/prepare.py:324-339`), outlier rule on train
only (2 rows removed on Ames; `removed_ids` listed), `fit_cleaner` on train → `apply_cleaner` per
split, `SaleSpeedSimulator.fit(train)` → attach per split, neighborhood stats + feature defaults
refit on the CSV-round-tripped train split into the sandbox root (never champion paths), sklearn
`ColumnTransformer` fitted inside each pipeline/CV fold. Val-only metrics; the sandbox test split
is never served (no endpoint reads it). The leakage note renders verbatim on stage 06
(G1 check). One documented deviation: classification upload splits are not stratified (impossible
in the pinned split-before-attach order — documented in `ml/workflow/split.py:14-21`; CV stays
stratified internally).

### Q7. Does the uploaded dataset really support the requested target? — **SOUND**

The upload gate requires the full 81-column Ames raw schema including `SalePrice` (dropped-column
upload → 422 `schema_mismatch` naming it), category sets, and numeric ranges — so the regression
target is always present and in-range, and `Neighborhood` is always one of the 25 geo-mappable
codes. The classification target is always computable because it is *simulated from schema
columns* — and is labelled SIMULATED at every surface. Training-window honesty: 120-row valid
upload → `can_train: false` with the MIN_TRAIN_ROWS=150 reason; POST job → 400 with the same
reason; preprocess → 400. Extra columns are tolerated (82-column upload accepted and prepares
cleanly) — the pipeline ignores them rather than rejecting or fabricating.

### Q8. Are regression and classification being evaluated correctly? — **SOUND**

- Regression: val-only MAE/RMSE/R²/RMSLE on the dollar scale + `rmse_log` + residual interval via
  the champion's own `regression_metrics`/`residual_interval`. Recomputed from persisted
  predictions: ridge RMSLE 0.135437 == served == `metrics.json` (trace T2). Sandbox ridge on the
  bundled data reproduces the champion ridge exactly (same split/seed/one-SE rule) — expected,
  and provenance blocks distinguish them.
- Classification: calibrated probabilities, F1-optimal threshold via the champion's
  `pick_f1_threshold` (0.1882 served — **not** 0.5; both operating points shown), confusion matrix
  `labels=[0,1]` (sums to 338; trace T3), real sklearn ROC/PR/calibration curves thinned to ≤ 80.
  Sandbox logistic on Ames reproduces the offline logistic candidate's published val-cal numbers
  exactly (PR-AUC 0.5089, Brier 0.1913 — INV §2). Selection: regression by min val RMSLE;
  classification by max val PR-AUC (imbalance-appropriate), with the paired bootstrap (2000
  resamples, seed 42) on regression only.
- A failed/pending candidate cannot be evaluated (409 both paths, verified live) or predicted
  from (409, verified live); clustering jobs cannot serve row predictions (422, verified live).

### Q9. Does clustering add useful information? — **SOUND**

Sandbox DBSCAN on Ames reproduces the champion segmentation exactly (eps 1.317, min_samples 2,
4 clusters + 3 noise, 25 assignments, 3 nearest-centroid fallbacks — INV §2). Payloads carry the
verbatim k-distance-knee rationale, per-cluster label/members/n_sales/median price, and fallback
flags. It is genuinely recomputed on the upload's refit stats (not the champion artifact), and
degenerate cases fail honestly (a failed candidate never fails the wave). Usefulness is bounded
by the 25-neighborhood granularity — inherent to the machinery, not oversold.

### Q10. Are the UI results backed by actual API calls? — **SOUND**

Every screen number checked binds to a captured network response (Playwright `waitForResponse`):
the 7,829 missing-cell count, SalePrice mean $180,921, ridge RMSLE 0.135 (3dp) in the comparison
table and 0.1354 (4dp) in the evaluation cards, confusion-matrix cells 127/112/23/76, the sandbox
price, the verbatim provenance and interval notes. 29/30 Playwright assertions passed; the one
initial failure was my own script's assertion error (3dp vs 4dp display), not an app defect.
Frontend lint clean; production build passes (8.8 s).

---

## 2. Number traces (screen → network → `ml/` computation)

- **T1 — 7,829 missing cells.** Stage 01/04 screen "7,829" → `GET
  /workflow/datasets/ames/profile` `total_missing_cells: 7829` →
  `ml/workflow/profile.py:158` `df.isna().sum().sum()` over `load_dataset_frame("ames")`.
  Independent pandas ground truth on `data/raw/ames/train.csv`: **7,829**. (ARCH §3.6's example
  figure 13,965 and the `datasets.py:358` docstring's "13,965" are stale doc text — see F2.)
- **T2 — ridge RMSLE 0.1354.** Stage 08 metric card "0.1354" → `GET
  /workflow/jobs/job_3b66b834/evaluation/ridge` `metrics.rmsle = 0.13543666916035035` →
  recomputed with sklearn from `models/workflow/ames/jobs/job_3b66b834/candidates/ridge/
  val_predictions.csv` (338 rows): `sqrt(mean_squared_log_error) = 0.135437` — identical to 6 dp;
  equals the candidate `metrics.json`; n_train 945 / n_val 338.
- **T3 — confusion cell tn=127.** Stage 08 confusion matrix → `GET
  /workflow/jobs/job_f0953b03/evaluation/logistic` `metrics_at_f1.confusion_matrix
  {tn:127, fp:112, fn:23, tp:76}` (sum 338) → recomputed from `val_predictions.csv` with the real
  machinery: `pick_f1_threshold` → 0.18820556146557, `classification_metrics` → identical cells.
  (Manual thresholding at a truncated 0.188228 flips one row — the served threshold is exact.)

## 3. Probe log (all live)

| Probe | Result |
|---|---|
| Non-Ames CSV (`a,b,c`) | 422 `schema_mismatch`, all missing columns named; no directory left behind |
| Ames copy minus `SalePrice` | 422 `schema_mismatch` naming `['SalePrice']` |
| Corrupt body (NUL bytes) | 422 `corrupt_csv` |
| Header-only CSV | 422 `empty_file` |
| First-10-rows duplicated | 422 `duplicate_ids`, `n_duplicate_ids: 10` + sample |
| `.xlsx` filename | 422 `unsupported_format` (openpyxl-absence note verbatim) |
| Wrong content type / empty body / 11 MiB body | 415 / 400 / 413 ("limit is 10485760 bytes") |
| Valid 120-row Ames slice | 201; `state.can_train: false` with the ≥150 reason; job → 400; prepare → 400 |
| 82-column superset | 201; prepares cleanly (extras ignored) |
| Train before preprocessing (fresh upload) | auto-prepares; status shows explicit `preparing` phase |
| Second job while one runs | 409 naming the running `job_id` |
| Delete dataset with running job | 409 naming the job |
| Delete bundled `ames` | 400 "The bundled dataset cannot be deleted" |
| Evaluate pending candidate / unknown candidate / unknown job | 409 / 404 / 404 |
| Predict on running job / clustering job | 409 / 422 "does not serve per-row predictions" |
| Unknown objective / candidate | 422 listing valid sets (pydantic literal error for objective) |
| Backend crash mid-wave | orphan sweep marks it `failed` ("server restarted") on next server |
| Sandbox predicts ×3 | `logs/predictions.jsonl` untouched (246 → 247 only from the champion parity call) |
| **Re-prepare with new config after training** | **P1: comparison table + provenance go stale-mixed (§1 Q5)** |
| Champion parity | sandbox ridge price == champion price to the penny on bundled data (deterministic reproduction; provenance blocks differ — C13's alternative holds) |

**Isolation (C15-style), after 4 training jobs + 2 prepares + all probes:** `models/registry/*`,
`models/champion.json`, `models/regression/*`, `models/classification/*`, top-level
`feature_defaults.json`/`neighborhood_stats.json`/`feature_list.json` sha256-identical to
pre-review baseline; `mlruns/` experiment set unchanged; `GET /health` and `GET /model/info`
byte-identical.

**Test suites:** `tests/ml/workflow/` 128/128 pass; `backend/tests/test_workflow_{errors,
isolation,jobs}.py` 42/43 pass — the single failure (`test_no_repo_residue`) asserts
`data/uploads`/`models/workflow` absent and was caused by *this review's own live-probe residue*
(concurrent QA-agent residue also exists), not a code defect.

## 4. Findings

**P0 — none.**

**P1**
- **F1 — Comparison/provenance split-drift after re-prepare.** `models_payload`
  (`backend/app/services/workflow/jobs.py:384-454`) merges the latest done result per candidate
  with no binding to the prepare `fingerprint` they were trained on; `provenance` is read from
  the *current* prepare report. Reproduced: after `POST …/preprocess/preview` with
  `{seed:7, val_frac:0.2, test_frac:0.2}` on `ds_bfd6e9d4`, the table still served ridge RMSLE
  0.12703 (old 219-row val) under `n_train 874 / n_val 292` provenance, with a bootstrap computed
  on the old vectors. New jobs after the re-prepare would be compared against old-split numbers
  as if comparable. Same root cause lets sandbox predict combine new sandbox stats with old
  pipelines (`ml/workflow/predict.py` reloads stats by mtime; no fingerprint check). *Fix:
  persist the prepare fingerprint in `status.json`, and filter/flag mismatched results in
  `models_payload`; block or loudly warn sandbox predict on fingerprint mismatch.*

**P2**
- **F2 — Stale "13,965 missing cells" in docs/docstrings.** ARCH §3.6 example and
  `ml/workflow/datasets.py:358` claim 13,965; the true (and actually served) value is 7,829. Docs
  only — no served number is wrong.
- **F3 — Candidate-select desync on job switch** (`SandboxPredictPanel.jsx:123-136`; the
  re-sync effect depends on `[roster]`, which doesn't change on selection): first submit after
  switching to a job lacking the selected candidate hits a loud 404 while the select displays a
  valid option. Self-heals on roster reload; never silently mispredicts. *Fix: re-sync on
  `selection.jobId` change.*
- **F4 — `can_train` estimate can contradict prepare** (`services/workflow/datasets.py:190-207`):
  the 70/15/15 pre-prepare estimate ignores outlier removal, so a ~214-row upload shows
  `can_train: true` then 400s at prepare. Both messages are honest; the sequence confuses.
- **F5 — Single-job guard is per-process only.** Two API processes (observed live: :8200 and
  :8540 coexisting) can each run a training job; on-disk scan only guards within one process's
  POST path. Documented single-worker assumption — enforce it in deployment docs or add a lock
  file.

**P3**
- **F6 — Classification upload splits unstratified** (documented deviation from ARCH §4.6 in
  `ml/workflow/split.py:14-21`; CV remains stratified).
- **F7 — Partial results of a failed job are excluded from the comparison table** (job-level
  atomicity, `jobs.py:404`) — defensible, but a 4/5ths-complete wave that dies on the last
  candidate contributes nothing.

## 5. Score and release verdict

**Workflow integrity: 8/10.** The honesty system is structural (badges/banners are components,
not remembered copy), every mandated number traced to real computation, isolation and the
rejection matrix held under every probe I ran, and the one crash I witnessed was cleaned up by
the designed orphan sweep. It loses a point for the F1 stale-provenance gap (numbers stay real
but their labelling can mislead after a re-prepare) and a fraction for the P2 cluster.

**Release verdict: SHIP with F1 fixed first** (small, localized change: fingerprint binding in
`status.json` + `models_payload` filter), or ship now only if re-preparing an already-trained
upload is documented as resetting prior results. Everything else is P2/P3 polish.

## 6. Housekeeping

My three probe uploads (`ds_d339be01`, `ds_bfd6e9d4`, `ds_915e6480`) were deleted via the API
(204s; sandbox dirs removed with them). Temp Playwright scripts under `e2e/` were deleted. The
:8540/:5540 pair was stopped. Remaining residue: `models/workflow/ames/` (my 3 job dirs + prepare
artifacts — regenerable runtime sandbox data; the QA suite's own teardown scrubs
`models/workflow` wholesale) and the concurrent QA agent's uploads, which are not mine to delete.
Evidence screenshots: `a-locked-08.png`, `d-train-*.png`, `e-eval-*.png`, `f-predict.png`,
`g-*.png`, `h-*.png` (captured during the run; temp dir).
