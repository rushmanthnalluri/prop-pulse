# PropPulse — Guided ML Workflow Architecture (Binding Spec)

**Status:** binding for implementation agents. Grounded in `docs/frontend/workflow-mechanics.md`
(cited MECH), `docs/frontend/ml-capability-inventory.md` (cited INV), `docs/frontend/proppulse-api-contract.md`
(cited CONTRACT), `docs/frontend/proppulse-ux-architecture.md` (cited UX), and a fresh read of
`backend/app/main.py`, `backend/app/api/deps.py`, `backend/app/security.py`, `backend/app/config.py`,
`ml/training/train_regression.py`, `ml/training/train_classification.py`, `ml/training/common.py`,
`ml/data/clean.py`, `ml/data/sale_speed.py`, `ml/data/validate.py`, `ml/evaluation/evaluate.py`,
`ml/clustering/{dataset,train}.py`, `ml/features/{stats,defaults,serving}.py`, `ml/paths.py`,
`frontend/src/{App.jsx,api/,components/}` on 2026-08-09.

**Environment facts that shape this spec (verified):** `openpyxl` is NOT installed;
`python-multipart` is NOT installed; `backend/requirements.txt` pins fastapi 0.141.1 / sklearn 1.9.0 /
xgboost 3.4.0 / pandas 2.3.3 / shap 0.52.0; frontend deps are frozen (react 19, react-router 8,
recharts 2, react-leaflet 5). **No new Python or npm dependencies anywhere in this design.**

---

## 1. PRODUCT FRAMING (≤30 lines)

PropPulse already ships trained champions (ridge_v1 + calibrated random_forest_v1) behind
`/predict`, `/market/*`, `/model/*` (CONTRACT §1). The guided workflow must NOT gate those pages
behind user training — that would break the product. The resolution:

**The workflow is an exploratory workbench where users train THEIR OWN sandboxed models on the
bundled Ames dataset or their own upload.** Sandbox models live under `models/workflow/` and can
never be promoted to champions (§4). The champion product keeps serving every existing page
unchanged.

The stepper has 12 stages:

```
01 Upload Dataset → 02 Analyse Features → 03 Descriptive Statistics → 04 Missing Values →
05 Visualization → 06 Preprocessing → 07 Model Training → 08 Model Evaluation →
09 Predict Property → 10 Neighbourhood Intelligence → 11 Model Explainability → 12 Model Health
```

Stages 01–08 are real workbench stages with new backend endpoints. Stage 09 has two faces,
shown side by side and labelled: a **sandbox prediction panel** (the user's own trained model —
real, workbench-only) and a **bridge card to the champion Valuation page** (`/valuation`).
Stages 10–12 are PropTech bridge stages: they show sandbox results where the workflow genuinely
produced them (stage 10: sandbox DBSCAN clusters from a clustering job) and bridge to the
existing champion pages otherwise (`/market`, `/model`, `/health`). One unified stepper; later
stages reuse existing pages by linking, not by embedding — zero edits to the five existing pages.

Gating is honest and minimal: stages 01–07 are always available (the bundled dataset means a
dataset is always active); stages 08 and the sandbox half of 09 are **locked until at least one
training job has completed on the active dataset**; 10–12 are always available (their bridge
targets read champion artifacts). Locked states carry copy that names the unblock action
(UX principle 6: nothing dead-ends).

What we deliberately do NOT build: multi-user sessions, auth, server-side saved work, promotion
of sandbox models, arbitrary non-Ames schemas, xlsx support. Rationale in §7.

---

## 2. DATASET MODEL

### 2.1 The two datasets kinds

- **Bundled default — `dataset_id: "ames"`.** Always present, never deletable. Raw frame =
  `data/raw/ames/train.csv` (1460×81); processed splits read **in place** from
  `data/processed/{train,val,test}.csv` (945/338/175, INV §4); neighborhood stats and feature
  defaults read in place from `models/neighborhood_stats.json` / `models/feature_defaults.json`.
  Every workflow stage works out-of-the-box on `ames` — the demo path needs no upload, and every
  number stays real.
- **Uploads — `dataset_id: "ds_" + uuid4().hex[:8]`** (PlacementPredict's uuid8 scheme, MECH §6).

### 2.2 Storage layout (all paths via `ml.paths.REPO_ROOT`, never hardcoded absolutes)

```
data/uploads/<dataset_id>/
  raw.csv                 # the stored upload, verbatim bytes
  dataset.json            # registry record (see below)
  processed/              # written by stage 06 prepare (train.csv / val.csv / test.csv)
models/workflow/<dataset_id>/            # sandbox artifact root (§4 — NEVER models/{registry,regression,classification})
  neighborhood_stats.json # refit on the upload's TRAIN split at prepare time
  feature_defaults.json   # recomputed on the upload's TRAIN split at prepare time
  jobs/<job_id>/
    status.json           # job protocol file (§3.7) — progress + per-candidate results
    artifacts/<candidate>.joblib          # fitted self-contained sklearn Pipeline
    artifacts/<candidate>.val_predictions.csv
    metrics.json          # final merged payload for the comparison table
```

`models/workflow/ames/jobs/...` is used for sandbox jobs on the bundled dataset (its data files
stay in their canonical locations). There is **no central registry file**: `GET
/workflow/datasets` scans `data/uploads/*/dataset.json` and prepends the synthesized `ames`
record. Per-directory records avoid the write-locking a shared JSON registry would need.

`dataset.json`:

```json
{"dataset_id": "ds_a1b2c3d4", "name": "my-houses.csv", "source": "upload",
 "created_at": "ISO-8601", "sha256_12": "first 12 hex chars of sha256(raw.csv)",
 "n_rows": 1460, "n_cols": 81,
 "prepare": null | {"config": {...}, "fingerprint": "sha1 of config+sha256_12", "prepared_at": "..."}}
```

### 2.3 Upload transport, limits, validation

- **Transport: raw request body, NOT multipart.** `python-multipart` is absent and new deps are
  banned. `POST /workflow/datasets?filename=my-houses.csv` with `Content-Type: text/csv` (or
  `application/octet-stream`) and the file bytes as the body. `fetch(url, {method: 'POST',
  body: file})` sends exactly this — the frontend needs nothing else.
- **CSV only.** xlsx is rejected (`openpyxl` absent — verified). Extension/mime whitelist:
  `.csv`, `text/csv`, `application/octet-stream`.
- **Body limit:** the global 64 KiB cap (`MAX_BODY_BYTES`, `backend/app/security.py:34`) stays
  for every existing route. `BodySizeLimitMiddleware` gains a rule table (§5): exact match
  `POST /workflow/datasets` → **10 MiB** (mirrors PlacementPredict's 10 MB cap, MECH §6; ≈30k
  Ames-width rows — headroom for real use without inviting abuse). 413 payload shape unchanged.
- **Row caps:** uploads must have ≥ 1 data row. Training additionally requires ≥ 150 post-split
  train rows and ≤ 20,000 upload rows (larger uploads get full EDA stages 01–05 but `POST
  /jobs` → 400 with the reason; keeps n_jobs-pinned sandbox training inside minutes, §4).
- **Schema acceptance: full Ames raw schema only.** `ml/data/validate.py:182 validate_raw`
  enforces the 81 columns, unique `Id`, category sets, numeric ranges. Non-Ames CSVs are
  rejected 422 with a structured report (§3.2). This is a product decision, not a limitation to
  hide: the feature pipeline (`build_feature_frame`, `ml/features/pipeline.py:410`) needs the
  Ames columns, so accepting arbitrary CSVs would force fabricated features — banned by the
  mission's no-fake-data rule.
- **Validation checks, in order** (each failure deletes the stored file; MECH §6 pattern):
  format/extension → parseable (`pd.read_csv`, `keep_default_na=False`; any exception →
  `corrupt_csv`) → non-empty → ≤ 20,000 rows → unique `Id` (duplicates reported with count) →
  81 required columns (missing named) → `validate_raw` category/range rules (violations
  collected) → **cardinality warnings** (non-fatal: constant columns; free-text columns with
  n_unique == n_rows other than `Id`; reported as warnings so the user learns their data).
- **Lifecycle:** list (scan), get, delete (uploads only; deletes both directories; 409 while a
  job runs on it). Uploads **survive restarts** — no startup cleanup (MECH §7 discard #4:
  ephemeral state is a demo smell, wrong for a product).
- **Concurrency:** single uvicorn worker, as the app already assumes (per-process counters,
  CONTRACT §5.13). At most **one training job running server-wide** (§3.7). EDA/preprocess
  endpoints are stateless reads — no locking needed.

---

## 3. API ENDPOINT CATALOG

Prefix: **`/workflow`** at root level (routes stay prefix-free per CONTRACT §0). All errors
follow CONTRACT §5.11: pydantic 422 `{"detail": [...]}`; service errors `{"detail": "<string>"}`
(400/404/409/413/503). **One documented deviation:** upload-validation 422 carries
`{"detail": {"code", "message", "report"}}` so the UI can render per-check results; the
workflow client module (§6) normalizes it.

New `ml/` functions are marked **NEW** with signatures; everything else cites existing code.
Sync vs job: every GET + the preprocess preview are synchronous (≤ a few seconds at the 20k-row
cap); only training is a background job (MECH §7 Adapt #1: the 40 s hung-request smell ends
here).

### 3.1 `POST /workflow/datasets` — upload + validate (stage 01)

Request: raw CSV body; query `filename` (default `upload.csv`, sanitized with
`werkzeug`-free basename+allowlist — implement `_safe_filename` in 20 lines).
Response **201**:

```json
{"dataset_id": "ds_a1b2c3d4", "name": "my-houses.csv", "source": "upload",
 "n_rows": 1460, "n_cols": 81, "sha256_12": "…", "created_at": "…",
 "validation": {"ok": true,
   "checks": [{"code": "format|parse|empty|row_cap|unique_id|schema|categories|ranges|cardinality",
               "status": "pass|warn", "detail": "…"}]},
 "preview": {"head": [{"Id": 1, …} /* 8 rows */]}}
```

Errors: 400 (no body), 413 (>10 MiB), 415 (wrong content-type), 422 (validation failure;
`detail.report` carries `missing_columns`, `n_duplicate_ids`, `parse_error`, or violated
category/range rules). **NEW ml/ functions** in `ml/workflow/datasets.py`:

```python
def read_csv_bytes(data: bytes) -> pd.DataFrame            # decode utf-8-sig; raises CorruptUpload
def validate_upload(df: pd.DataFrame) -> UploadReport      # the ordered checks above; wraps
                                                           # ml/data/validate.py:182 validate_raw
def save_upload(data: bytes, filename: str) -> DatasetRecord   # uuid8 id, dirs, dataset.json
def load_dataset_frame(dataset_id: str) -> pd.DataFrame    # raw.csv (upload) or raw ames (bundled)
def get_record(dataset_id: str) -> DatasetRecord           # raises UnknownDataset -> 404
def delete_dataset(dataset_id: str) -> None
def list_datasets() -> list[DatasetRecord]                 # scan + synthetic ames record
```

### 3.2 `GET /workflow/datasets` / `GET /workflow/datasets/{id}` / `DELETE` (lifecycle)

List item: `{dataset_id, name, source: "bundled"|"upload", n_rows, n_cols, created_at,
deletable}`. Get adds `state` (the stepper's server truth, §6.2):

```json
"state": {"prepared": true, "prepare_config": {…},
          "jobs": {"total": 3, "running": 0, "done": 2, "failed": 1},
          "objectives_done": ["regression"],
          "can_train": true, "can_evaluate": true, "can_predict_sandbox": true,
          "train_blocked_reason": null}
```

`can_train=false` + `train_blocked_reason` when rows out of the 150–20,000 window. DELETE →
204; bundled → 400 `"The bundled dataset cannot be deleted"`; running job → 409.

### 3.3 `GET /workflow/datasets/{id}/profile` (stage 01 result)

`{dataset_id, name, n_rows, n_cols, n_numeric, n_categorical, n_duplicate_ids,
total_missing_cells, head: [8 rows], columns: [{name, dtype}]}`. **NEW**
`ml/workflow/profile.py::profile_dataset(df) -> dict`. Computed per request (≤ 20k rows ⇒ < 1 s;
no cache in v1 — state the option, don't build it).

### 3.4 `GET /workflow/datasets/{id}/features` (stage 02 — analyse features + target detection)

```json
{"raw_features": [{"name", "dtype": "numeric|categorical", "role", "n_unique", "n_missing",
                   "missing_pct", "min"?, "max"?, "mean"?, "top_values"?: [{"value","count"} ×≤8]}],
 "pipeline_features": [{"name", "role": "engineered|neighborhood_stat",
                        "note": "computed in the pipeline — not a raw column"}],
 "targets": {
   "regression":     {"available": true, "column": "SalePrice",
                      "note": "models train on log1p(SalePrice) (ADR-10)"},
   "classification": {"available": true, "column": "sells_within_30_days", "derived": "simulated",
                      "positive_rate": 0.253,
                      "note": "derived from the seeded days-on-market simulation (ADR-3) — SIMULATED target"},
   "clustering":     {"available": true, "method": "DBSCAN",
                      "note": "neighborhood segmentation on [lat, long, median $/sqft, monthly velocity]"}},
 "recommended_split": {"strategy": "time", "column": "YrSold", "why": "…"} }
```

`role` ∈ `raw_input | engineered | neighborhood_stat | target | identifier | excluded` from
`RAW_INPUT_COLUMNS` / `ENGINEERED_FEATURES` / `NEIGHBORHOOD_STAT_FEATURES`
(`ml/features/pipeline.py:88,172,187`) + the documented exclusions (line 78). `positive_rate` is
computed on the raw frame after a dry-run of the simulator attach (train portion only).
`recommended_split` inspects `YrSold` (≥ 2 distinct years → time). **NEW**
`ml/workflow/profile.py::feature_inventory(df) -> dict`.

### 3.5 `GET /workflow/datasets/{id}/stats` (stage 03 — descriptive statistics)

`{numeric: [{name, count, mean, std, min, p25, p50, p75, max}], categorical: [{name, count,
n_unique, top, top_freq}], target: {name: "SalePrice", <same stats block>, note: "right-skewed —
models use log1p"}}`. **NEW** `ml/workflow/profile.py::descriptive_stats(df) -> dict` (pandas
`describe`/`value_counts` wrapper — INV §5 row 3: trivial, must be built).

### 3.6 `GET /workflow/datasets/{id}/missing` (stage 04 — missing value analysis)

```json
{"total_missing": 13965, "n_columns_with_missing": 19, "n_complete_columns": 62,
 "columns": [{"name": "PoolQC", "n_missing": 1453, "pct_missing": 99.5,
              "treatment": "fill_absent_token",
              "policy": "NA_ABSENT_CATEGORICAL",
              "note": "NA means 'no pool' — filled with the literal \"None\" at cleaning"}],
 "blocking": []}
```

`treatment`/`policy` come from the **real** policy tables `NA_ABSENT_CATEGORICAL` /
`NA_ABSENT_NUMERIC` (`ml/data/clean.py:32,51`) plus the `LotFrontage` neighborhood-median and
`Electrical` mode rules (`clean.py:126-133`). A column with missing values but no policy lands in
`blocking` ("apply_cleaner will raise — cleaning cannot proceed") — that is the honest
"treatment recommendation": it names exactly what the pipeline will do or why it fails. **NEW**
`ml/workflow/profile.py::missing_report(df) -> dict`.

### 3.7 `GET /workflow/datasets/{id}/viz/<kind>` (stage 05 — pre-aggregated payloads)

All kinds validate the column names against the raw frame (422 otherwise) and return payloads
sized for the browser (INV §5 row 5: per-chart payloads must be built; notebook groupby recipes
are the catalog). **NEW** `ml/workflow/profile.py` aggregators:

| Path | Query | Response | Function |
|---|---|---|---|
| `viz/histogram` | `column`, `bins=30` | `{column, bins: [{x0, x1, count}], stats: {min,max,mean,median}}` | `histogram(df, column, bins)` |
| `viz/scatter` | `x`, `y`, `max_points=1500` | `{x, y, points: [[x,y]…], n_total, sampled: bool}` — seeded (`RANDOM_SEED`) downsample | `scatter(df, x, y, max_points)` |
| `viz/box` | `column`, `by` (categorical) | `{column, by, groups: [{value, n, min, q1, median, q3, max}]}` sorted by median desc, ≤ 25 groups | `box_by(df, column, by)` |
| `viz/correlation` | `target=SalePrice`, `top=20` | `{target, features: […], matrix: [[…]]}` — numeric columns, top `top` by \|corr with target\| + target | `correlation(df, target, top)` |
| `viz/category` | `column`, `agg=median\|mean\|count`, `target=SalePrice` | `{column, target, agg, groups: [{value, n, agg_value}]}` | `category_aggregate(df, column, target, agg)` |

### 3.8 Preprocessing (stage 06) — leakage-safe, fit-on-train-only

`GET /workflow/datasets/{id}/preprocess` → `{prepared, config, fingerprint, summary | null}`.

`POST /workflow/datasets/{id}/preprocess/preview` — body:

```json
{"config": {"outlier_rule": true, "split_strategy": "auto|time|random",
            "val_frac": 0.15, "test_frac": 0.15, "seed": 42}}
```

Runs the real chain and **persists** it (so stage 07 trains on exactly what was previewed):

1. split — **NEW** `ml/workflow/split.py::split_dataset(df, strategy, val_frac, test_frac, seed)
   -> {"train","val","test"}`: `auto` = time-based when `YrSold` has ≥ 2 distinct values
   (contiguous blocks sorted by `(YrSold, MoSold)`, honoring ADR-4's spirit; the bundled `ames`
   bypasses this entirely — its canonical `data/processed` splits are used in place) else seeded
   shuffle. `time_split` (`ml/data/split.py:20`) is NOT reused — its thresholds are Ames-hardcoded.
2. outlier rule (train only, if enabled): `apply_outlier_rules` (`ml/data/outliers.py:39`).
3. clean: `fit_cleaner` on train (`clean.py:81`) → `apply_cleaner` per split (`clean.py:106`).
4. target: `SaleSpeedSimulator().fit(train)` (`sale_speed.py:82`) → `attach_sale_speed`
   (`sale_speed.py:264`) per split — SIMULATED, labelled everywhere.
5. geo: `join_neighborhood_geo` (`ml/data/pipeline.py:70`).
6. refit train-only artifacts into the sandbox root: `fit_neighborhood_stats`
   (`ml/features/stats.py:117`) → `models/workflow/<id>/neighborhood_stats.json`;
   `compute_feature_defaults` (`ml/features/defaults.py:51`) → `…/feature_defaults.json`.
7. features: `build_feature_frame(train, stats=…)` (`ml/features/pipeline.py:410`) for the
   before/after column diff.

**NEW** `ml/workflow/prepare.py`:

```python
def prepare_dataset(dataset_id: str, config: PrepareConfig) -> PrepareReport  # steps above
def preview_report(dataset_id: str) -> PrepareReport | None                   # last persisted
class PrepareConfig(BaseModel): outlier_rule: bool; split_strategy: str; val_frac: float; …
```

Response: `{config, fingerprint, splits: {train, val, test, rule: "time(YrSold)|random(42)"},
steps: [{step, detail…}], before: {n_rows, n_cols, total_missing}, after: {n_rows, n_cols,
total_missing: 0}, sample_before: [5 rows × 8 key cols], sample_after: […]}`. Sync (≤ ~5 s at
the row cap; BusyButton state in the UI). Errors: 422 bad config; 400 rows out of window.

### 3.9 Training jobs (stage 07) — backgrounded, real progress

MECH §3: PlacementPredict trains implicitly inside GETs and blocks ~40 s — both smells fixed
here. PropPulse per-candidate costs are 4–52 s measured (INV §6); a full wave is 35 s–3 min.

`POST /workflow/datasets/{id}/jobs` — body `{"objective": "regression|classification|clustering",
"candidates": ["ridge", "xgboost"]}`. Valid candidate sets: regression = the 5 of
`train_regression.train_all` (`train_regression.py:209-238`); classification = `MODEL_NAMES`
(`train_classification.py:97`); clustering = `["dbscan"]`. **202** `{job_id: "job_" + uuid8,
status: "queued", links: {status: "/workflow/jobs/<id>"}}`. Errors: 400 (objective blocked by
row window), 404 (dataset), 409 (**one job at a time server-wide** — body names the running
job_id), 422 (unknown candidates, response lists valid ones — MECH §6 pattern). If the dataset
isn't prepared, the job auto-prepares with default config first (self-healing, but explicit in
`status.json` as a `preparing` phase).

Job mechanics: the API spawns a **subprocess** — `sys.executable -m ml.workflow.train_job
--dataset <id> --job <id> --objective … --candidates …`. Rationale: isolates CPU-heavy fitting
from the serving process (INV §7: a training job with `n_jobs=-1` saturates all cores and
degrades co-located serving — observed in PERFORMANCE.md:71), contains crashes, needs zero new
deps, and makes every `lru_cache` staleness concern moot (fresh interpreter per job; §4).

`GET /workflow/jobs/{job_id}` →

```json
{"job_id", "dataset_id", "objective",
 "status": "queued|preparing|running|done|failed",
 "progress": {"done": 2, "total": 4, "current": "random_forest", "elapsed_s": 41.2},
 "results": {"ridge": {"status": "done", "val_metrics": {…}, "best_params": {…},
                       "cv_best_score": 0.131, "train_seconds": 6.9},
             "xgboost": {"status": "running"}, "…": {"status": "pending"},
             "lasso": {"status": "failed", "error": "…"}},
 "error": null, "created_at", "finished_at": null}
```

The subprocess rewrites `status.json` after every candidate → progress is real, per-candidate,
not animated. `GET /workflow/datasets/{id}/jobs` lists past jobs (scan of `jobs/*/status.json`).
On API startup any `running`/`queued` status file is marked `failed` ("server restarted") —
no orphan ambiguity.

`GET /workflow/datasets/{id}/models?objective=regression` — the comparison table source; merges
the latest successful result per candidate across jobs:

```json
{"objective", "dataset_id",
 "candidates": [{"name", "job_id", "trained_at", "val_metrics": {…}, "best_params": {…},
                 "train_seconds": 6.9, "best": true}],
 "selection": {"metric": "rmsle", "rule": "min",
               "note": "best = lowest validation RMSLE; test split never touched"},
 "bootstrap": {"runner_up": "xgboost", "observed_rmsle_diff": -0.0043,
               "ci95": [-0.013, 0.006], "prob_runner_up_better": 0.19, "significant": false},
 "provenance": {"dataset": "ames|my-houses.csv", "n_train": 945, "n_val": 338,
                "simulated_target": false}}
```

`bootstrap` only when objective=regression with ≥ 2 candidates — `paired_bootstrap_rmsle_diff`
(`ml/evaluation/select.py:172`) over the persisted val prediction vectors (real machinery, ms
to run). Classification: no bootstrap machinery exists → omitted (§7). `simulated_target: true`
for classification always.

### 3.10 Sandbox evaluation (stage 08)

`GET /workflow/jobs/{job_id}/evaluation/{candidate}` — computed from the persisted
`val_predictions.csv` (written at train time: `Id, y_true, y_pred_log, y_pred_dollar` for
regression; `Id, y_true, proba_raw, proba_calibrated` for classification). This is the "computable-
not-persisted" gap from INV §3 closed at the right moment: arrays are captured during the job,
curves are derived on read. **NEW** `ml/workflow/evaluate.py::evaluation_payload(job_dir,
candidate) -> dict`.

- **regression**: `{objective, candidate, split: "val", n, metrics: {mae, rmse, r2, rmsle,
  rmse_log, residual_interval {q_low, q_high}}` (via `regression_metrics` + `residual_interval`,
  `ml/training/common.py:60,74`), `actual_vs_predicted: [[y, pred] ×≤400, seeded-thinned]`,
  `residual_hist: {bins}`, `importance: [{feature, weight}] | null}`.
- **classification**: `metrics_at_f1` (threshold from `pick_f1_threshold`,
  `ml/evaluation/select.py:324`, computed on val calibrated probabilities — same rule as the
  champion), `metrics_at_0_5`, both via `classification_metrics`
  (`train_classification.py:254`, which already emits the labelled confusion dict with
  `labels=[0,1]` — the MECH §7 discard #8 bug is not reproduced), `roc: [{fpr, tpr}]`,
  `pr: [{recall, precision}]`, `calibration: [{bin_mid, frac_pos, mean_pred}]` — curve points
  from `roc_curve` / `precision_recall_curve` / `calibration_curve` (all already imported in
  `train_classification.py:56-66`), thinned to ≤ 80 points (PlacementPredict's subsample
  precedent, MECH §4), `positive_rate`, `importance`.
- **clustering**: `{algorithm: "DBSCAN", eps, min_samples, n_clusters, n_noise, rationale`
  (verbatim from `select_dbscan_params`, `ml/clustering/train.py:212`), `clusters: […]` (from
  `build_cluster_stats`, `train.py:318`), `assignments: [{neighborhood, name, cluster_id,
  fallback}]}`. **No silhouette score** — the machinery never computes one (§7).

`importance`: native model importance computed **at train time** and stored in `metrics.json`:
tree estimators → `feature_importances_`; linear → `|coef|`; xgboost → `gain`; each aggregated
from the one-hot space back to base feature names with `parse_base_name`
(`ml/explainability/explainer.py:61`). `null` where a model exposes neither — the UI renders an
empty state, never a fabricated chart.

### 3.11 Sandbox prediction (stage 09, workbench-only)

`POST /workflow/jobs/{job_id}/predict/{candidate}` — body is the **existing `PropertyInput`
schema** (`backend/app/schemas/property.py:59-155`) reused unchanged. Server side: payload →
`serving_payload_to_raw` (`ml/features/serving.py:257`) → `build_feature_frame` with the
**sandbox** neighborhood stats (never the champion's) → job pipeline. **NEW**
`ml/workflow/predict.py`:

```python
class SandboxModelService:
    def __init__(self, dataset_id: str, job_id: str): …   # loads stats/defaults/pipelines
    def predict_price(self, payload: dict, candidate: str) -> dict
    def predict_proba(self, payload: dict, candidate: str) -> dict
```

Responses carry the champion-free provenance block, always:

```json
{"estimated_price": 181233.5, "price_range": {"low": 157000.1, "high": 209100.9},
 "model": {"candidate": "ridge", "objective": "regression", "job_id": "job_…"},
 "provenance": {"source": "sandbox", "dataset_id": "ds_a1b2c3d4", "dataset_name": "my-houses.csv",
                "trained_at": "…", "n_train_rows": 1010,
                "label": "Sandbox model — trained on your upload; not the PropPulse champion."}}
```

`price_range` = `expm1(pred_log + job residual_interval)` — same construction as the champion
(CONTRACT §2), interval from the job's own val residuals. Classification response:
`{probability, threshold, sells_within_30_days, simulated_target: true, …provenance}`.
Errors: 404 job/candidate; 409 job not done / candidate failed; 422 payload.

**Sandbox predictions are never written to `logs/predictions.jsonl`** — that log feeds the
champion drift reference (`ml/monitoring/drift_check.py`); mixing populations would corrupt PSI.

---

## 4. SAFETY & ISOLATION RULES (binding)

1. **Sandbox root.** Every workflow artifact lives under `models/workflow/<dataset_id>/`.
   `ml/workflow/train_job.py` asserts at start that its output root resolves inside
   `models/workflow/` and contains none of `registry`, `regression`, `classification`,
   `champion.json`, `feature_list.json`, `feature_defaults.json`, `neighborhood_stats.json`
   (the top-level ones). Writes to `models/` outside the sandbox root are a review-blocker.
2. **No MLflow from web-triggered runs.** The sandbox trainer does not import `ml.tracking`.
   Justification: the `./mlruns` file store is shared and lock-prone (INV §7: the clustering
   trainer already retries lock errors); web runs are ephemeral previews, and experiment history
   must stay attributable to the offline pipeline. Job provenance lives in `status.json`.
3. **No champion state mutation.** Workflow code never touches `app.state` champion services,
   `models/registry/`, or `evaluate.run_evaluation` (`ml/evaluation/evaluate.py:629`) — that
   function is a registry-promotion ceremony that reads the sealed test split (INV §7); only its
   side-effect-free helpers (`select.py` ranking/bootstrap/threshold, metric functions) are
   reused. Sandbox evaluation reads the **val** split of the user's dataset only; the sandbox
   test split stays sealed and is never served to the UI (there is no "test" button — test
   reads are the promotion ceremony's job, and sandbox models are never promoted).
4. **lru_cache staleness.** The champion process-global caches (`load_feature_defaults`,
   `ml/features/defaults.py:90`; `_geo_lookup`, `features/pipeline.py:219`; the SHAP singleton)
   are irrelevant to correctness here because (a) training runs in a **fresh subprocess** per
   job, and (b) the API process reads sandbox stats/defaults through `ml/workflow/predict.py`'s
   own tiny cache keyed by `(path, mtime)` — never the module-global loaders.
5. **n_jobs pins for co-located serving.** In the sandbox trainer: all `GridSearchCV` /
   `RandomizedSearchCV` run `n_jobs=1` (the classification trainer's Windows spawn-storm
   precedent, `train_classification.py:220`); forest/xgboost estimators get `n_jobs=2`
   (`candidate_grids` results are walked and re-pinned). Expected wall-times on the bundled
   dataset (extrapolated from INV §6 with the pins): single regression candidate ~10–30 s,
   full regression wave ~1–2 min, classification wave ~3–5 min, clustering < 1 s. The training
   UI shows these as honest per-candidate cost hints.
6. **Split protocol for uploads.** `auto` strategy = contiguous time blocks on `(YrSold,
   MoSold)` when ≥ 2 sale years exist, else seeded shuffle; classification additionally
   stratifies shuffled splits on the attached target. Fixed seed 42 everywhere
   (`ml/paths.py:RANDOM_SEED`). The split is **recomputed deterministically** from
   (config, sha256_12) — persist results, not row assignments (MECH §7 replicate #2).
7. **Leakage rule, restated.** Every fitted statistic — cleaner, outlier rule, DOM simulator,
   neighborhood stats, feature defaults, and the sklearn `ColumnTransformer` inside each
   pipeline — is fit on the sandbox **train** split only; val/test are transformed with frozen
   statistics. This mirrors the verified offline pipeline (INV §7 leakage section) because the
   sandbox reuses the same functions with the same call discipline (§3.8 order).
8. **One job at a time** (server-wide, in-memory guard + startup orphan sweep, §3.9); uploads
   survive restarts; sandbox predictions never enter the prediction log (§3.11).
9. **Validation containment.** Stored filenames are server-generated (`raw.csv`); user filenames
   live only in `dataset.json.name` after sanitization; dataset ids are regex-validated
   (`^(ames|ds_[0-9a-f]{8})$`) and path-resolved with a containment check before any file touch
   (MECH §6 `commonpath` pattern).

---

## 5. BACKEND MODULE PLAN

### 5.1 New `ml/` modules (package `ml/workflow/`)

| File | Contents (signatures in §3) | Reuses verbatim |
|---|---|---|
| `ml/workflow/__init__.py` | package docstring | — |
| `ml/workflow/datasets.py` | `read_csv_bytes`, `validate_upload`, `save_upload`, `load_dataset_frame`, `get_record`, `delete_dataset`, `list_datasets`, `DatasetRecord`, `UploadReport`, `CorruptUpload`, `UnknownDataset` | `validate_raw` (`ml/data/validate.py:182`), `load_raw_train` path arg (`ml/data/ingest.py:22`) for the bundled frame |
| `ml/workflow/split.py` | `split_dataset` | `RANDOM_SEED` (`ml/paths.py`) |
| `ml/workflow/prepare.py` | `PrepareConfig`, `PrepareReport`, `prepare_dataset`, `preview_report`, `load_prepared_splits(dataset_id)` | `apply_outlier_rules`, `fit_cleaner`/`apply_cleaner`, `SaleSpeedSimulator`/`attach_sale_speed`, `join_neighborhood_geo`, `fit_neighborhood_stats`, `compute_feature_defaults`, `build_feature_frame` (all cited §3.8) |
| `ml/workflow/profile.py` | `profile_dataset`, `feature_inventory`, `descriptive_stats`, `missing_report`, `histogram`, `scatter`, `box_by`, `correlation`, `category_aggregate` | role lists (`features/pipeline.py:88,172,187`), policy tables (`clean.py:32,51`) |
| `ml/workflow/train.py` | `train_objective(dataset_id, job_dir, objective, candidates, progress_cb)`; sandbox search wrappers `_fit_alpha_model` / `_fit_randomized` (the `train_regression.py:144,176` shapes with `n_jobs=1`); importance aggregation | grids & constants (`RIDGE_ALPHA_GRID`, `LASSO_ALPHA_GRID`, `RF_PARAM_DIST`, `XGB_PARAM_DIST`, `N_ITER_TREE_SEARCH`, `CV`, `SCORING`), `one_se_alpha` (line 107), `make_pipeline` (line 100), `_train_linear` (line 135), `candidate_grids`/`tune_on_train`/`fit_calibrated`/`classification_metrics` (classification lines 144,200,243,254), `build_neighborhood_matrix` (`clustering/dataset.py:68`), `select_dbscan_params`/`build_cluster_stats` (`clustering/train.py:212,318`), `regression_metrics`/`residual_interval` (`common.py:60,74`), `parse_base_name` (`explainer.py:61`) |
| `ml/workflow/evaluate.py` | `evaluation_payload`, `_thin_curve` (≤ 80 pts) | `pick_f1_threshold` (`select.py:324`), `paired_bootstrap_rmsle_diff` (`select.py:172`), `classification_metrics`, sklearn `roc_curve`/`precision_recall_curve`/`calibration_curve` |
| `ml/workflow/predict.py` | `SandboxModelService` (+ `(path, mtime)`-keyed cache) | `serving_payload_to_raw` (`serving.py:257`), `build_feature_frame` |
| `ml/workflow/train_job.py` | CLI entry (`python -m ml.workflow.train_job …`): sandbox-root assertion (§4.1), prepare-if-needed, `train_objective` with status-file callback, exception → `failed` | `write_json` (`common.py:84`) |

The existing trainers keep **zero edits** — their monolithic `train_all()` (fixed paths + MLflow,
INV §7) is bypassed; their pure parts are imported. If a future maintainer prefers public names,
add aliases in the trainers — not required now.

### 5.2 New backend files

| File | Contents |
|---|---|
| `backend/app/schemas/workflow.py` | pydantic models: `PreprocessConfig`, `JobRequest`, and response models mirroring §3 (`DatasetRecordOut`, `StateOut`, `ProfileOut`, `FeaturesOut`, `StatsOut`, `MissingOut`, `VizOut` (per kind), `PreprocessOut`, `JobOut`, `ModelsOut`, `EvaluationOut`, `SandboxPredictOut`). |
| `backend/app/services/workflow/__init__.py` | — |
| `backend/app/services/workflow/datasets.py` | thin service over `ml/workflow/datasets.py`: exception → HTTP mapping, state assembly (`can_evaluate` etc. from a job-dir scan). |
| `backend/app/services/workflow/eda.py` | profile/features/stats/missing/viz dispatch + column validation. |
| `backend/app/services/workflow/jobs.py` | the single-job guard (module-level `running_job_id` + startup orphan sweep), subprocess spawn (`sys.executable -m ml.workflow.train_job`, `cwd=REPO_ROOT`), status-file reads, models-merge reader, evaluation reader. |
| `backend/app/services/workflow/predict.py` | request-scoped accessor over `ml/workflow/predict.py::SandboxModelService` instances cached on the service by `(dataset_id, job_id)`. |
| `backend/app/api/workflow_datasets.py` | `POST /workflow/datasets` (raw body reader), `GET /workflow/datasets`, `GET /workflow/datasets/{id}` (+state), `DELETE`. |
| `backend/app/api/workflow_eda.py` | profile / features / stats / missing / `viz/{kind}` routes. |
| `backend/app/api/workflow_preprocess.py` | preprocess GET + preview POST. |
| `backend/app/api/workflow_jobs.py` | jobs POST/GET/list, models GET, evaluation GET, sandbox predict POST. |

### 5.3 Edits to existing backend files (minimal, enumerated)

- `backend/app/security.py` — `BodySizeLimitMiddleware` gains
  `BODY_LIMIT_RULES: tuple[tuple[str, str, int], ...] = (("POST", "/workflow/datasets",
  10 * 1024 * 1024),)`; `dispatch` picks the rule matching `(method, exact path)` else
  `MAX_BODY_BYTES`. Both enforcement paths (declared + streamed) use the resolved limit. The
  413 message names the resolved limit.
- `backend/app/main.py` — `include_router` for the four workflow routers (next to line 271-275);
  nothing else changes (lifespan untouched — workflow state is not app state).
- `backend/app/api/deps.py` — add `get_workflow_job_service(request)` / `get_workflow_data_dir`
  accessors following the existing pattern (services instantiated once in lifespan? **No** —
  workflow services are constructed lazily per request from `settings.resolved_data_dir` /
  `REPO_ROOT`; they hold no champion state, so lifespan stays exactly as is).
- `backend/README.md` — one section documenting the `/workflow` prefix + the 10 MiB upload
  exception (keeps the routing-choice note current).

### 5.4 Reused verbatim from `ml/` (checklist for reviewers)

`validate_raw` · `apply_outlier_rules` · `fit_cleaner`/`apply_cleaner` + policy tables ·
`SaleSpeedSimulator`/`attach_sale_speed` · `join_neighborhood_geo` · `fit_neighborhood_stats` /
`load_neighborhood_stats(path)` (path-parameterized, `stats.py:170`) · `compute_feature_defaults`
/ `load_feature_defaults(path)` (`defaults.py:51,90`) · `build_feature_frame` ·
`build_preprocessor` (`common.py:34`) · regression grids/`one_se_alpha`/`make_pipeline`/
`_train_linear` · classification `candidate_grids`/`tune_on_train`/`fit_calibrated`/
`classification_metrics` · `regression_metrics`/`residual_interval`/`write_json` ·
`pick_f1_threshold`/`paired_bootstrap_rmsle_diff` · `build_neighborhood_matrix`/
`select_dbscan_params`/`build_cluster_stats` · `parse_base_name` · `serving_payload_to_raw`.
NOT used: `run_evaluation`, `copy_champions_to_registry`, `ml.tracking.*`, `load_split`
(fixed `PROCESSED_DIR` — sandbox loads per-dataset CSVs), `MicroMarketLookup` (champion
artifact-bound; the clustering evaluation computes nearest-centroid fallback inline from the
job's own scaler+centroids).

---

## 6. FRONTEND IA

### 6.1 Routes & nav integration

- New lazy route: **`/workflow/*`** in `App.jsx` (one entry beside the existing five), rendering
  `pages/workflow/WorkflowShell.jsx`, which owns the stepper and switches on a stage slug:
  `01-upload · 02-features · 03-stats · 04-missing · 05-viz · 06-preprocess · 07-train ·
  08-evaluate · 09-predict · 10-market · 11-explain · 12-health` (`/workflow` redirects to the
  furthest available stage). Deep-linkable per-stage URLs: `/workflow/07-train?dataset=ds_a1b2c3d4`.
- Nav: `Layout.jsx` `NAV_GROUPS` (lines 12-28) gains a third caption **WORKBENCH** with one item
  `ML Workbench → /workflow`. The five existing pages and their routes are untouched; bridge
  stages link out (`/valuation`, `/market`, `/model`, `/health`) — no reverse links, no edits
  to those pages (keeps WP ownership exclusive, §8).
- Stepper placement: inside the workflow pages only, horizontal across the top of the content
  column (the global sidebar stays). ≤ 900 px it becomes a horizontally scrollable strip —
  the existing topbar-strip pattern (UX §8).

### 6.2 The stepper component — `components/workflow/Stepper.jsx`

States per stage: **done** (teal check SVG), **current** (accent ring), **available** (link),
**locked** (greyed + lock SVG + `title` naming the unblock action; click → toast with the same
message). Truth model: **server truth first** — `GET /workflow/datasets/{id}/state` (§3.2)
drives 08/09 locks and job-derived dots; **client optimistic layer** — `localStorage
proppulse:workflow = {dataset_id, last_stage, visited: [slugs]}` marks 01–07 done-on-visit and
restores the last position on return. Server state wins every conflict. Active dataset is
carried in the URL (`?dataset=`) + mirrored to localStorage; the `DatasetPicker` chip on every
stage shows name/rows and opens the switcher (list endpoint) or jumps to 01.

### 6.3 Per-stage page specs

Global: every stage follows UX §5 chrome (`.page-head` kicker/H1/description/mono meta line),
per-section skeleton → error+retry → content, `ChartA11yTable` under every chart, disclosures
≥ 11 px. New components live under `frontend/src/components/workflow/`; page modules under
`frontend/src/pages/workflow/`; one new stylesheet `frontend/src/styles/workflow.css` (single
owner per package, §8). Reused as-is: `StateView`, `Skeleton`, `BusyButton`, `Toast`,
`useSortable`+`SortHeader`, `ChartA11yTable`, `useApi`, `usePolling`, `useLocalStorage`,
`ConfusionMatrix`, format helpers. New client module **`src/api/workflow.js`** wrapping every
§3 endpoint (upload uses `fetch` with the `File` as body; polls via `usePolling`).

**01 Upload — `UploadStage.jsx` + `workflow/UploadDropzone.jsx`, `workflow/ValidationReport.jsx`,
`workflow/DatasetPicker.jsx`.** Sections: active-dataset card (`profile` endpoint for `ames` by
default — real 1460×81 numbers, head-8 table); dropzone (drag/click, `.csv` only, client-side
10 MiB pre-check); validation checklist (per-check pass/warn/fail rows from the 201/422
payload); dataset list with delete buttons (confirm inline, never window.confirm).
States: uploading (progress copy "Uploading…" — fetch gives no byte progress; honest
indeterminate), invalid (checklist of failures, file rejected), success (toast + auto-set active
+ "Continue to Analyse features →"). Responsive: single column; table scrolls.

**02 Analyse Features — `FeaturesStage.jsx` + `workflow/FeatureTable.jsx`,
`workflow/TargetCards.jsx`.** Sections: target-objective cards (three cards from
`features.targets` — regression / classification-with-SIMULATED-badge / clustering; each states
availability + the note verbatim; this is the "target detection" UX — detection is reported,
objective is chosen at stage 07); sortable `FeatureTable` (name, dtype, role, n_unique,
missing %, mean or top value) over `raw_features`; collapsible "pipeline-derived features"
list (`pipeline_features`, flagged as computed-not-raw). Data: `GET …/features`. Empty state
can't happen (a validated dataset always has 81 columns) but is specced anyway per UX §7.

**03 Descriptive Statistics — `StatsStage.jsx` + `workflow/StatsTables.jsx`.** Two sortable
tables (numeric: count/mean/std/min/p25/p50/p75/max; categorical: count/unique/top/freq) + the
SalePrice callout card (mono stats + the log1p note). Data: `GET …/stats`. Numbers right-aligned
tabular-nums (UX §2).

**04 Missing Values — `MissingStage.jsx` + `workflow/MissingTable.jsx`.** Summary strip
(total missing, columns affected, complete columns); sortable table of affected columns with
n, %, and the **treatment** column naming the real policy (badge per policy source); `blocking`
entries render as an error alert — cleaning cannot proceed until resolved; a closing note
explains NA="absent" semantics with the PoolQC example. Data: `GET …/missing`. Empty state:
"no missing values" success panel when `total_missing === 0`.

**05 Visualization — `VizStage.jsx` + `workflow/VizExplorer.jsx`.** Controls row (chart type
select: histogram/scatter/box/correlation/category; column pickers filtered by dtype; bins
slider; agg select) → fetch on change (debounced) → recharts render (BarChart for histograms &
category aggregates, ScatterChart, horizontal box-and-whisker via composed bars, correlation as
a labelled heat grid — pure CSS cells colored from the matrix, the PlacementPredict server-side
heat pattern translated to inline styles) + `ChartA11yTable` + a mono caption naming n and
sampling ("1,500 of 1,460 rows" / "seeded sample"). Data: §3.7 endpoints only — no client-side
aggregation. Defaults on entry: SalePrice histogram; scatter GrLivArea×SalePrice; correlation
top-20.

**06 Preprocessing — `PreprocessStage.jsx` + `workflow/PreprocessConfig.jsx`,
`workflow/BeforeAfterPanel.jsx`.** Progressive disclosure: the primary card shows two toggles
(outlier rule on/off with the rule stated in words; split strategy auto/time/random) + seed and
fractions under an "Advanced" `<details>` (collapsed by default). "Run preprocessing" BusyButton
→ `POST …/preprocess/preview` → results: split sizes strip (train/val/test with the rule used),
per-step accordion (each `steps[]` entry with its real numbers — rows removed, NAs filled per
column, positive rate with SIMULATED badge, geo join mapping, 85→94 columns), before/after
panels (rows/cols/missing + 5-row samples side by side), and the leakage guarantee line:
"Every statistic was fit on the training rows only — validation and test rows are transformed
with frozen values." Re-run with new config overwrites; `fingerprint` shown in the meta line.
Locked: never. Error: 400 row-window → inline alert linking back to 01.

**07 Model Training — `TrainStage.jsx` + `workflow/TrainPanel.jsx`, `workflow/JobStatus.jsx`,
`workflow/JobsList.jsx`.** Objective tabs (Regression / Classification / Clustering) — the
classification tab carries the SIMULATED-target warn badge in the tab itself. Candidate
checkboxes with real cost hints ("~10–30 s each" regression, "~30–60 s each + calibration"
classification, "< 1 s" DBSCAN) and one-line "what it is" per model. "Start training" → 202 →
`JobStatus` polls `GET /workflow/jobs/{id}` every 1.5 s via `usePolling` while
queued/running (pauses when tab hidden — existing hook behavior): per-candidate status rows
(pending/running/done/failed with seconds and val headline metric as each lands), overall
progress bar (done/total — real counts, not animated). 409 → inline notice naming the running
job with a "view it" link. Below: `JobsList` (past runs, newest first, status chips) and the
**comparison table** (`workflow/ComparisonTable.jsx`, sortable via `useSortable`) from
`GET …/models?objective=…`: one row per candidate — val metrics (regression: RMSLE, RMSE, MAE,
R²; classification: PR-AUC, ROC-AUC, F1@t, Brier), best params (mono, truncated), train seconds;
best row highlighted `--accent-wash` + "best" chip with the selection note; the regression
bootstrap honesty banner when present ("not statistically decisive vs …" — same pattern as
`BootstrapNote`, UX §5.4-5). Provenance line: dataset name, n_train/n_val, simulated badge.

**08 Model Evaluation — `EvaluateStage.jsx` + `workflow/EvaluationWorkspace.jsx`.** Locked until
`state.can_evaluate` — locked copy: "Train at least one model in stage 07 to unlock evaluation."
Workspace: job + candidate selectors (grouped by objective); then per objective —
regression: metric cards (MAE/RMSE/R²/RMSLE + interval q_low/q_high), actual-vs-predicted
scatter with a 45° reference line, residual histogram, importance bar chart when non-null;
classification: threshold card (F1-optimal threshold + P/R/F1 — never hardcode 0.5), ROC curve,
PR curve, calibration curve (perfect-line dashed), confusion matrix (`ConfusionMatrix.jsx`
reused) at the F1 threshold, importance; clustering: eps/min_samples/rationale panel, cluster
stat cards (label, members, n_sales, median price — the `cluster_stats` shape), assignments
table with fallback flags. Every chart: `ChartA11yTable` + caption naming split and n ("val,
338 rows"). Data: §3.10 endpoint only.

**09 Predict — `PredictStage.jsx` + `workflow/SandboxPredictPanel.jsx`.** Two panels, visually
separated by a hairline. Left: **sandbox prediction** (locked until `can_predict_sandbox`):
candidate selector (successful regression or classification candidates of the active dataset),
the existing schema-driven form — reuse `components/shared/PropertyForm.jsx` wholesale (it
already produces a valid `PropertyInput`; extracted from `components/valuation/` so both the
champion page and this panel use it) → `POST
/workflow/jobs/{job}/predict/{candidate}` → result card showing price+range (or probability +
threshold + SIMULATED badge) with the **sandbox provenance banner** (`--warn-dim` wash):
"Sandbox model — trained on your upload `<name>` (`n` rows). Not the PropPulse champion."
Right: **bridge card** — "Champion valuation" summary (test RMSLE etc. from `/model/info`,
already session-cached by `client.js`) + "Open the Valuation page →".

**10 Neighbourhood Intelligence — `MarketStage.jsx`.** If the active dataset has a completed
clustering job: cluster cards + assignments table from the evaluation payload (§3.10 clustering)
— real sandbox output. Otherwise an empty state explaining that a clustering run (stage 07,
Clustering tab) populates this. Below, always: bridge card to `/market` ("champion micro-markets
— DBSCAN on the full Ames train split").

**11 Model Explainability — `ExplainStage.jsx`.** Sandbox native importances of a selected
completed candidate (bar chart from the job's `importance`; caption: "native model importance —
aggregated to base features; not SHAP") with an explicit note that per-prediction SHAP exists
for the champion only; bridge card to `/model` (champion global SHAP + rationale).

**12 Model Health — `HealthStage.jsx`.** Sandbox panel: per-dataset facts (jobs run, artifacts
on disk, last trained_at — from the state/jobs endpoints) and an honesty note that sandbox
models are not monitored (drift monitoring covers the champion only). Bridge card to `/health`
(live traffic + drift report).

### 6.4 States rules specific to the workflow

Job polling uses busy/progress feedback per UX §7.1 (no full-page spinners after first paint);
a failed candidate never fails the stage — the comparison table shows its `failed` row with the
error on expand. Every sandbox number carries its provenance; every classification number the
SIMULATED badge. Both are components (`workflow/ProvenanceBanner.jsx`,
`workflow/SimulatedBadge.jsx`) so the rule is structural, not remembered.

---

## 7. HONESTY RULES (binding labels + explicit omissions)

**Labels that must ship (component-enforced where noted):**

1. **SIMULATED target** — every classification number in the workbench (features card, training
   tab, comparison table, evaluation, sandbox predict) carries the ADR-3 badge + one-liner.
   `simulated_target: true` is in the API payloads for this purpose.
2. **Sandbox vs champion** — every sandbox result carries the `ProvenanceBanner` (dataset name,
   row count, trained_at, "not the champion"); champion pages are never annotated as sandbox.
3. **"Trained on your upload / bundled Ames"** — the `provenance` block on comparison tables and
   predictions states which dataset, n_train, n_val.
4. **Val-only metrics** — comparison/evaluation copy states the sandbox test split stays sealed;
   no test numbers exist in the workbench.
5. **Interval semantics** — sandbox price ranges labelled "~80% range — validation residual
   quantiles", mirroring CONTRACT §5.5.
6. **Approximate centroids / train-window** — stage 10 carries the same geo + 2006–2008 caveats
   the champion pages carry (UX §5.3-5).

**Mission-asked items explicitly OMITTED (machinery does not justify them; do not fake):**

- **xlsx upload** — `openpyxl` not installed (verified 2026-08-09); CSV only.
- **Arbitrary non-Ames CSV schemas / free-text target detection** — the feature pipeline requires
  the 81 Ames columns; "target detection" is implemented as objective reporting over the known
  schema (§3.4), not schema guessing.
- **Silhouette / cluster-quality scores for sandbox clustering** — no such computation exists in
  `ml/clustering/` (parameter selection is the k-distance knee heuristic); the UI shows eps,
  min_samples, cluster counts, noise list, rationale — all real.
- **ROC/PR/calibration for regression** (n/a by construction), **SHAP for sandbox models**
  (the explainer machinery is champion-bound, `ml/explainability/explainer.py:116` — sandbox
  gets native importances only), **bootstrap for classification** (only the RMSLE paired
  bootstrap exists, `select.py:172`), **real days-on-market for uploads** (the
  `RealDomProvider` path stays offline-only; uploads get the simulator, labelled),
- **Promotion of sandbox models to champions** — forbidden by design (§4); **no test-split
  reads in the workbench**; **no auth/multi-user/saved-server-state** (CONTRACT §0: none
  exists); **no per-upload comps/micro-market serving** (comps artifact + `MicroMarketLookup`
  are champion-train-bound); **no chunked/resumable upload** (raw-body single shot ≤ 10 MiB).

---

## 8. IMPLEMENTATION SEQUENCING (work packages, exclusive ownership)

Sequence: **WF-B1 → (WF-B2 ∥ WF-B3) → WF-B4 → WF-F1 → (WF-F2 ∥ WF-F3 ∥ WF-F4) → WF-F5**.
WF-B3 may start once WF-B1 lands because the job-file protocol (§3.9) is pinned by this doc —
it does not need WF-B2's internals, only the CLI contract (`python -m ml.workflow.train_job
--dataset --job --objective --candidates` + `status.json` schema).

| WP | Scope | Owns exclusively | Depends on / contract consumed |
|---|---|---|---|
| **WF-B1** Workflow data core | `ml/workflow/{__init__,datasets,split,prepare,profile}.py`; tests `tests/ml/workflow/test_datasets.py`, `test_prepare.py`, `test_profile.py` (upload validation matrix: corrupt/empty/dup-ids/schema/cardinality; split determinism; prepare leakage invariants — stats fit on train only; profile/missing numbers vs pandas ground truth) | those files only | this doc §2, §3.1–3.8 |
| **WF-B2** Workflow training | `ml/workflow/{train,evaluate,predict,train_job}.py`; tests `tests/ml/workflow/test_train.py`, `test_evaluate.py`, `test_predict.py` (tiny synthetic Ames-schema frame; assert sandbox-root containment, no-MLflow (import guard), val_predictions schema, curve thinning ≤ 80, confusion `labels=[0,1]`) | those files only | WF-B1 (prepare outputs); §3.9–3.11, §4 |
| **WF-B3** Backend HTTP layer | `backend/app/schemas/workflow.py`, `backend/app/services/workflow/*`, `backend/app/api/workflow_*.py`, edits to `backend/app/security.py` (limit rules), `backend/app/main.py` (routers), `backend/app/api/deps.py`, `backend/README.md` | those files + the three edited ones | WF-B1; §3 (response shapes), §4.1/4.8, §5.3 |
| **WF-B4** Backend integration tests | `backend/tests/test_workflow_*.py` (upload→profile→prepare→job(patched subprocess or tiny real run)→evaluation→predict; 413/415/422 shapes; single-job 409; bundled-delete 400; champion paths untouched — assert `models/registry` mtimes unchanged across a full journey) | `backend/tests/test_workflow_*` | WF-B2, WF-B3 |
| **WF-F1** Frontend shell | `src/api/workflow.js`, `src/pages/workflow/WorkflowShell.jsx`, `components/workflow/{Stepper,DatasetPicker,ProvenanceBanner,SimulatedBadge}.jsx`, `src/styles/workflow.css`, edits to `src/App.jsx` (one lazy route) + `src/components/Layout.jsx` (WORKBENCH nav group) + TITLES map | those files only | WF-B3 (endpoint shapes); §6.1–6.2 |
| **WF-F2** Stages 01–05 | `pages/workflow/{UploadStage,FeaturesStage,StatsStage,MissingStage,VizStage}.jsx`, `components/workflow/{UploadDropzone,ValidationReport,FeatureTable,TargetCards,StatsTables,MissingTable,VizExplorer}.jsx` | those files only | WF-F1; §3.1–3.7, §6.3 |
| **WF-F3** Stages 06–08 | `pages/workflow/{PreprocessStage,TrainStage,EvaluateStage}.jsx`, `components/workflow/{PreprocessConfig,BeforeAfterPanel,TrainPanel,JobStatus,JobsList,ComparisonTable,EvaluationWorkspace}.jsx` | those files only | WF-F1; §3.8–3.10, §6.3 |
| **WF-F4** Stages 09–12 | `pages/workflow/{PredictStage,MarketStage,ExplainStage,HealthStage}.jsx`, `components/workflow/SandboxPredictPanel.jsx` (form reuse per §6.3-09; if the shared form extraction is needed it happens HERE, moving `PropertyForm` to `components/shared/` and updating its one importer) | those files + (conditionally) `components/valuation/PropertyForm.jsx` move | WF-F1; §3.11, §6.3 |
| **WF-F5** E2E + docs | `e2e/tests/workflow.spec.js` (§9 checks); update `docs/frontend/AGENT_STATUS.md`-style index + cross-link this doc from `docs/frontend/proppulse-ux-architecture.md`'s family | `e2e/tests/workflow.spec.js`, doc cross-links | all above; §9 |

Definition of done per package: tests/lint/build pass; every payload traceable to a real
endpoint response; no writes outside the sandbox root; existing e2e suite still green.

---

## 9. ACCEPTANCE MAP — the mission's full-journey test as automatable checks

The QA agent drives API checks with `curl`/httpx against a live server (E2E ports per
`e2e/playwright.config.js`: backend 8200, frontend 5300) and UI checks in Playwright
(`e2e/tests/workflow.spec.js`). "API:" checks are plain HTTP assertions; "UI:" checks are
browser assertions.

- **C1 (01, upload path).** API: `POST /workflow/datasets` with a **copy of
  `data/raw/ames/train.csv` renamed** → 201, `validation.ok === true`, `n_rows === 1460`;
  record appears in `GET /workflow/datasets` with `source: "upload"`.
- **C2 (01, rejection matrix).** API: (a) a 1-row-but-empty file → 422 `code: "empty_file"`;
  (b) `b"not,a,csv\x00\x01"` → 422 `corrupt_csv`; (c) Ames copy with `SalePrice` column dropped
  → 422 `schema_mismatch` naming the column; (d) copy with the first 10 rows duplicated (Ids
  collide) → 422 naming `n_duplicate_ids`; (e) a `.xlsx`-named body → 415/422 format rejection;
  (f) 11 MiB body → 413. Every failure leaves no directory behind (`GET /workflow/datasets`
  count unchanged).
- **C3 (01–05, bundled out of the box).** API: with no upload, `GET
  /workflow/datasets/ames/{profile,features,stats,missing}` all 200; profile `n_rows === 1460`;
  missing `columns` contains `PoolQC` with `treatment: "fill_absent_token"`; features
  `targets.classification.derived === "simulated"`.
- **C4 (02).** UI: `/workflow/02-features` — three target cards render, classification card
  shows the SIMULATED badge; the sortable feature table has 81 rows; clicking the `missing_pct`
  header re-orders (aria-sort flips).
- **C5 (03–04).** UI: stats table's SalePrice row mean = 180,921 (±1) — the raw
  `train.csv` frame mean served by `/stats` (the 182,125 figure in earlier drafts was the
  train-split-only mean from `neighborhood_stats.json` — stale); missing table's `LotFrontage`
  row names the neighborhood-median treatment.
- **C6 (05).** UI: histogram renders bars for `SalePrice` (and its a11y table sums to 1460);
  switch to scatter `GrLivArea × SalePrice` → `sampled === false`, point count 1460;
  correlation grid lists `OverallQual` in the top row. API: `viz/scatter` with
  `max_points=100` → exactly 100 points, `sampled: true`, `n_total: 1460`.
- **C7 (06).** API: `POST /workflow/datasets/ames/preprocess/preview` default config → 200,
  `splits: {train: 945, val: 338, test: 175}` (bundled uses canonical splits),
  `after.total_missing === 0`, `steps` includes `sale_speed_target` with provider `simulated`.
  UI: split strip + per-step accordion render; the leakage line is visible.
- **C8 (07, job lifecycle).** API: `POST /workflow/datasets/ames/jobs {"objective":
  "regression", "candidates": ["linear", "ridge"]}` → 202; immediate second POST → 409 naming
  the job; poll `GET /workflow/jobs/{id}` → `status` transitions to `done` within 120 s;
  `results.ridge.val_metrics.rmsle` ∈ [0.10, 0.18] (real trained number, order-of-magnitude
  assertion — not a hardcoded equality); a `status.json` exists under
  `models/workflow/ames/jobs/{id}/`. **No new runs appear in `mlruns/`** (diff experiment count
  before/after).
- **C9 (07, comparison).** API: `GET /workflow/datasets/ames/models?objective=regression` →
  ≥ 2 candidates, exactly one `best: true`, `bootstrap.significant` present; `provenance.n_train
  === 945`. UI: comparison table renders, sort by RMSLE works, best row carries the chip.
- **C10 (08, regression).** API: `GET /workflow/jobs/{id}/evaluation/ridge` → `split ===
  "val"`, `n === 338`, `actual_vs_predicted` non-empty, `metrics.rmsle` equals the job's
  stored value. UI: metric cards + scatter + residual histogram + a11y tables render; caption
  reads "val, 338 rows".
- **C11 (08, classification).** API: classification job (logistic only) → done; evaluation →
  `roc`/`pr`/`calibration` each ≤ 80 points and ≥ 2, `confusion_matrix` sums to 338,
  `metrics_at_f1.threshold` ∈ (0, 1) (not defaulted to 0.5), `simulated_target` surfaced. UI:
  three curves + confusion matrix render; SIMULATED badge visible.
- **C12 (08, clustering).** API: `{"objective": "clustering", "candidates": ["dbscan"]}` →
  done in seconds; evaluation → `n_clusters` ≥ 2, `assignments` length 25, every entry has
  `cluster_id` + `fallback`; **no silhouette key anywhere** (grep the payload).
- **C13 (09, sandbox predict).** API: `POST /workflow/jobs/{reg-id}/predict/ridge` with the
  CONTRACT §1.11 sample payload → 200, `estimated_price` ∈ [50k, 500k], `provenance.source ===
  "sandbox"`, `provenance.n_train_rows === 945`. **`logs/predictions.jsonl` line count
  unchanged.** Champion parity check: `POST /predict` with the same payload still returns the
  champion's number — the two prices differ (or at minimum the responses carry different
  version/provenance blocks), proving the sandbox never replaced the champion.
- **C14 (gating).** UI: on a **fresh upload with no jobs**, stage 08 and the sandbox panel of
  09 render locked states whose copy names stage 07; after C8 completes on that dataset, the
  same routes are reachable. Stepper dots reflect `GET …/state` after a reload (server truth,
  not localStorage).
- **C15 (isolation).** API/fs: after the full journey (C1–C14), `models/registry/`,
  `models/champion.json`, `models/regression/`, `models/classification/` mtimes/content are
  unchanged; every new file is under `data/uploads/` or `models/workflow/`; `GET /health` and
  `GET /model/info` responses are byte-identical to pre-journey captures.
- **C16 (deletion).** API: `DELETE /workflow/datasets/ames` → 400; delete the C1 upload → 204,
  both its directories gone, `GET /workflow/datasets` no longer lists it; its jobs' endpoints
  404.

---

*Where this doc and instinct disagree, this doc wins; where this doc and the code disagree, the
code wins — file an issue, don't fake data. Companion docs: `workflow-mechanics.md` (what we
copied/adapted/discarded), `ml-capability-inventory.md` (reuse citations), `proppulse-api-contract.md`
(existing endpoints — untouched), `proppulse-ux-architecture.md` (design system).*
