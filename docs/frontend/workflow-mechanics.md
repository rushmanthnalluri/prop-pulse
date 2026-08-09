# PlacementPredict — Backend / Workflow Mechanics

Reverse-engineered from `C:\Machine_Learning\Placement-predict\flask_project`. Companion to
`docs/frontend/placementpredict-ui-inventory.md` (which covers templates/UI); this document covers
**how the guided 9-stage pipeline actually works behind the routes** — state, training, evaluation,
preprocessing, validation — and what PropPulse should copy, adapt, or avoid. Every claim cites
`file:line`. Line numbers refer to the reference checkout as of 2026-08-08.

**Sources read in full:** `app.py` (976 lines), `model.py` (697), `eda.py` (526),
`train_artifact.py` (25), `export_pages.py` (89); skimmed for backend calls: `templates/train.html`,
`evaluate.html`, `preprocess.html`, `upload.html`, `static/js/script.js`, `static/js/charts.js`.

---

## 1. Route-by-route API mechanics

All page routes are synchronous Flask + Jinja. **There is no job queue, no task id, and no polling
endpoint anywhere in the app** — the "async" behaviours are (a) a boot-time warm-up thread and
(b) client-side `fetch` that simply *awaits* a long-running synchronous POST. Details below.

### 1.1 Page routes (HTML)

| Method & path | View | Computes / stores | Renders |
|---|---|---|---|
| `GET /` | `home` (`app.py:360-380`) | EDA bundle via `_active_bundle()`; model bundle **only if already warm** (`_model_bundle_if_warm`, `app.py:296-306`) so home never pays a cold train | `index.html` with overview, top drivers, auto-generated `_dataset_insights` (`app.py:309-357`) |
| `GET/POST /upload` | `upload_dataset` (`app.py:383-451`) | POST: multipart field `dataset` (`upload.html:22-30`). Validates → saves to `data/uploads/{uuid8}_{secure_filename}` (`app.py:401-403`) → sets `session["dataset_file"]`, `session["dataset_name"]` (`app.py:419-420`). GET: re-previews stored upload, else bundled dataset (`app.py:425-438`) | `upload.html` with `error` and/or `preview` dict (rows, cols, missing total, head-8, dtypes — `_build_preview`, `app.py:277-289`) |
| `POST /upload/clear` | `clear_dataset` (`app.py:454-461`) | Pops both session keys, deletes the file, redirects to `/upload` | 302 redirect |
| `GET /features` `/descriptive` `/missing` `/visualize` | `_eda_stage_view` (`app.py:464-498`) | `eda.get_bundle(path)` — cached; builds the full EDA bundle on first touch (§2.2) | Corresponding template with `bundle` |
| `GET /preprocess` | `preprocess_data` → `_model_stage_view` (`app.py:501-527`) | **Side effect: calls `model.get_model_bundle(path)` — a GET that trains on cold cache** (or loads the on-disk artifact). Renders split sizes, impute means, scaler stats from the bundle (`preprocess.html:37-102`) | `preprocess.html` with `mb` (model bundle) |
| `GET /train` `GET /train?model=<key>` | `train_model` (`app.py:530-566`) | Same bundle as preprocess. Optional drill-down: query param resolved via `model.resolve_model_key` (`app.py:545-552`); the picker is a plain GET form (`train.html:45`). Unknown key → notice, not 404 | `train.html` with `mb`, `selected`; embeds `window.MODEL_PAGE` JSON (`train.html:239-247`) |
| `GET /evaluate` | `evaluate_model` → `_model_stage_view` (`app.py:569-571`) | Same cached bundle; nothing computed at render time | `evaluate.html`; embeds `window.EDA = {models, importance}` (`evaluate.html:153-156`) |
| `GET/POST /predict` | `predict_placement` (`app.py:607-684`) | POST form fields: `model` (registry key or `best`) + the 12 feature inputs. Validates each against bundle `form_meta` (blank → dataset median default; non-numeric → error; outside observed `[min,max]` → error — `app.py:633-650`). Calls `model.predict(path, values, chosen)` (`app.py:652`) | `predict.html` with `result` (placed, probability %, model, champion flag, ROC-AUC, banded explanation from `_prediction_note`, `app.py:589-604`), `errors`, `invalid_fields` |

Every stage page also gets `pipeline_steps`, `active_dataset_name` via a context processor
(`app.py:215-222`) and prev/next pager data via `_step_pager` (`app.py:207-212`). The 9-stage list
`PIPELINE_STEPS` (`app.py:109-200`) is the single source driving sidebar, roadmap, and routing;
`_make_stage_view` (`app.py:896-922`) would render stubs for non-live stages, but all nine are live
(`LIVE_STAGES`, `app.py:687-690`), so the factory currently registers nothing.

### 1.2 JSON API (`/api/*`)

CORS: `Access-Control-Allow-Origin: *` **without credentials** on `/api/*` (`app.py:73-81`) — a
cross-origin caller never carries the session cookie, so the API always serves the *bundled*
dataset to anonymous cross-origin traffic.

| Method & path | Payload | Behaviour | Responses |
|---|---|---|---|
| `GET /api/health` (`app.py:698-703`) | — | `model.warm_status(path)` only — **never triggers training** (`model.py:302-322`). Reports `trained`, `artifact_available`, and (if warm) champion + ROC-AUC | 200 `{status, dataset, is_default_dataset, trained, ...}` |
| `GET /api/dataset` (`app.py:706-738`) | — | Returns the cached EDA bundle numbers + `_dataset_insights` | 200 `{summary, insights, distributions, rate_by_feature, correlation}`; **503** if schema mismatch |
| `POST /api/predict` (`app.py:741-815`) | JSON object: 12 features (any may be absent → median default) + optional `"model"` (key, display name, or `"best"`) | Same validation + `form_meta` loop as the HTML form (`app.py:785-801`), then `model.predict` | 200 `{placed, probability, threshold: 0.5, model, model_key, roc_auc, dataset}`; **415** non-JSON; **400** unknown model (with `valid_models`) or field validation (`details` list); **503** schema mismatch or no trained model |
| `POST /api/benchmark` (`app.py:818-893`) | JSON (optional): `{"models": ["logistic_regression", ...], "fresh": false}`. Empty body = all three. `fresh` parsing is strict-boolean — `"false"` string must not retrain (`app.py:879-884`) | **Fully synchronous**: calls `model.benchmark(path, keys, fresh)` (`model.py:627-680`). First call on a cold dataset trains all three models inline (~40 s); cached path filters the existing evaluation instantly; `fresh: true` genuinely re-fits the subset on the identical split | 200 `{ok, source: "cached_evaluation"|"fresh_run", seed, cv_folds, cv_rows, split, selection_rule, models[], best, overall_best, dataset}`; **400** bad body / unknown models / empty selection; **415** non-JSON; **503** training failed |

**Benchmark client protocol (the closest thing to "async"):** `train.html` checkboxes →
`script.js:345-385`: one `fetch("/api/benchmark", {method: POST, json: {models, fresh}})` whose
promise the click handler simply `await`s while a status line reads "Training & evaluating …
(~40 s on the free host …); cached runs answer instantly" (`script.js:353-356`). Response re-renders
the banner/table via `benchmarkHtml()` (`script.js:92-…`) and re-draws the grouped bar chart via
`window.PPCharts.buildBenchmark` (`charts.js:352`). No polling, no progress — a single hung request.
On the static GitHub Pages export the same handler falls back to filtering the `window.MODEL_PAGE`
payload embedded in the page (`script.js:331-343, 375-376`).

### 1.3 Error routes

`@app.errorhandler` for 404, 413 (10 MB cap), 500, and a catch-all `HTTPException` — all render a
branded `error.html` (`app.py:925-971`). Stage views wrap `get_model_bundle` in try/except so a
model failure degrades to an in-page alert instead of a 500 (`app.py:508-511, 539-541, 616-619`);
`_train_all` converts training exceptions into `{ok: False, error}` bundles (`model.py:333-340`).

---

## 2. Workflow state model

### 2.1 What carries state between stages

Three layers, none of them a database:

1. **Session cookie (client-side, signed)** — holds exactly two strings: `dataset_file` (stored
   basename) and `dataset_name` (display name) (`app.py:419-420`). `_dataset_path`
   (`app.py:229-242`) re-resolves the basename inside `data/uploads/`, rejecting anything that
   escapes the dir. Secret key comes from `SECRET_KEY` env or an ephemeral random one at boot
   (`app.py:20-28`) — sessions do not survive restarts by design.
2. **Files on disk** — uploads at `flask_project/data/uploads/`; the bundled default at
   `flask_project/data/placement_predict_50k.csv` (`app.py:33-40`). `_clean_uploads()` deletes all
   leftovers at every startup (`app.py:45-56`). Model artifacts (`model_artifact.joblib` +
   `model_artifact_{key}.joblib`) sit **next to the dataset file** (`model.py:134-139`).
3. **Module-global in-process LRU caches** — the real "pipeline state":
   - `eda.py:98-103`: `_df_cache` + `_bundle_cache`, `OrderedDict`, max 2 entries, keyed by
     `(abspath, mtime, size)` (`eda.py:106-109`), guarded by an `RLock`; builds happen under the
     lock → single-flight on cold bursts.
   - `model.py:111-117`: `_bundle_cache` (JSON-safe evaluation bundle) + `_fitted_cache`
     (`{champion, models: {name: (clf, scaler)}, impute_means}`), same keying (`model.py:217-219`),
     max 2, `threading.Lock`, single-flight inside `get_model_bundle` (`model.py:222-249`).

### 2.2 How stage N knows stage N−1 happened

**It doesn't — and doesn't need to.** There is no stage gating, no "completed steps" ledger, no
per-session pipeline object. Every stage route independently resolves *the active dataset*
(`_active_dataset`, `app.py:245-250`: session upload if present and on disk, else the bundled CSV)
and then pulls from the caches keyed by that file's content stat:

- EDA stages 02–05 read `eda.get_bundle(path)` — computed once per dataset, then cached
  (`eda.py:132-145`).
- Stages 06–09 read `model.get_model_bundle(path)` — which **trains on first touch** or loads a
  validated artifact (`model.py:222-249`).

Consequences:

- **Jumping ahead is legal and self-healing.** Hitting `/evaluate` before `/preprocess` just
  triggers the same training the preprocess page would have. The "guided" order exists only in the
  UI chrome (sidebar, pager); the backend is a pure function of the active dataset file.
- **Cache warmth is the only cross-request memory.** Switching uploads changes the cache key; with
  `_CACHE_MAX = 2` the bundled dataset plus one upload stay warm (`eda.py:103`, `model.py:111`).
- **An unreadable uploaded file silently falls back to the bundled dataset** in `_active_bundle`
  (`app.py:253-260`); a schema-mismatching file instead yields a bare `{"schema_ok": False}` bundle
  and every stage renders a notice (`eda.py:282-286`).

### 2.3 Train/test split persistence

**The split is never stored — it is deterministically recomputed.** `_prepare_split`
(`model.py:397-416`) runs `train_test_split(test_size=0.2, stratify=y, random_state=42)` on every
full evaluation, every single-model retrain (`_train_single`, `model.py:508-526`), and every fresh
benchmark (`model.py:654-658`), guaranteeing byte-identical data by construction. What persists is
the *output*: the evaluation bundle + fitted pipelines, in the caches and in joblib artifacts
validated by **recipe version (`ARTIFACT_VERSION = 3`, `model.py:123`) and SHA-256 of the dataset
file** (`_dataset_sha`, `model.py:126-131`; `_load_validated`, `model.py:189-203`) — a stale
artifact can never silently serve the wrong model. `train_artifact.py` builds these at deploy time
(`train_artifact.py:19-25`); boot warm-up is opt-in via `WARM_MODEL=1` (`app.py:84-101`).

---

## 3. Training mechanics

Trigger: **implicit** — the first call to `model.get_model_bundle(path)` with no valid artifact
(`_train_all`, `model.py:333-340`). In practice that's the first visit to `/preprocess`, `/train`,
`/evaluate`, `/predict`, or a cold `/api/benchmark`. There is no explicit "Train" button wired to a
train endpoint; the train page's button is the *benchmark* console (§1.2).

**Algorithms** — exactly three, hardcoded in `MODEL_REGISTRY` (`model.py:56-81`), one ordered dict
as the single source of truth (key, display name, factory, `needs_scaling`, settings string, note):

| Key | Estimator (sklearn) | Hyperparameters | Scaling |
|---|---|---|---|
| `logistic_regression` | `LogisticRegression` | `max_iter=2000`, lbfgs default | yes — `StandardScaler` |
| `random_forest` | `RandomForestClassifier` | `n_estimators=150, n_jobs=2, random_state=42` (bounded workers for memory-capped hosts) | no |
| `gradient_boosting` | `HistGradientBoostingClassifier` | defaults (`lr 0.1`), `random_state=42` | no |

**Procedure** (`_fit_and_evaluate`, `model.py:529-624`, per model `_evaluate_model`,
`model.py:442-505`):

1. Load + guard (§6). Features = 12 numeric columns (`model.py:40-44`), target `PlacementStatus`.
2. `_prepare_split`: stratified 80/20, seed 42; impute train means; fit `StandardScaler` on train
   (`model.py:397-416`).
3. **Champion-selection CV**: `StratifiedKFold(n_splits=3, shuffle=True, random_state=42)`
   (`model.py:438`) over a stratified subsample capped at `CV_ROWS = 12_000` training rows
   (`model.py:429-439`, constants `model.py:50-51`); `cross_val_score(scoring="roc_auc")`; the
   linear model is wrapped `make_pipeline(StandardScaler(), clone(raw))` so CV folds scale per-fold
   (`model.py:455-456`).
4. **Served model**: `CalibratedClassifierCV(factory(), method="sigmoid", cv=3, ensemble=False)`
   fit on the full training split — Platt calibration on 3-fold out-of-fold predictions, base
   refit on all of it (`model.py:458-464`). Champion = max `cv_auc_mean`; test metrics are
   "reported, never used for selection" (`model.py:544-547`).
5. Per-model artifacts: train time (`time.time()` around fit, `model.py:463-465`), 7 test metrics,
   confusion @0.5, ROC subsampled to ~80 points (`_subsample_curve`, `model.py:325-330`),
   10-bin uniform reliability curve (`model.py:475-477`).
6. Bundle extras: RF feature importances from the first calibrated fold's inner estimator
   (`model.py:551-552`); `lr_export` (coefficients + scaler stats + Platt `a_/b_`) so the static
   Pages build can predict in-browser (`model.py:554-569`; consumed by `script.js:179-212` via
   `window.LR_MODEL`); `form_meta` per feature — observed `min/max`, `step` (1 for all-integer
   columns else 0.1), `default` = median (`model.py:571-583`).
7. Fitted candidates cached for per-model prediction (`model.py:617-623`); artifact written only by
   `save_artifact` / `train_artifact.py`, never by request handling.

**Timing clues:** train.html:42 — "the first run after an upload trains (~40 s on the free host,
calibration included), afterwards every selection reads the shared run"; script.js:355-356 repeats
this and "tens of seconds" for a fresh benchmark; per-model artifact load ≈ 1 s vs retrain
(`model.py:121-123, 262-264`); artifact bundle load ≈ ms (`model.py:230-231`).

**Progress/completion signalling to the UI:** none, structurally. A cold `/train` GET simply blocks
until the page renders with results; the benchmark button shows a busy label + status text while
the awaited fetch hangs (`script.js:353-356, 381-384`). The single-flight lock means a concurrent
cold burst queues behind the first training run rather than duplicating it (`model.py:224-246`).

---

## 4. Evaluation mechanics

- **Metrics are 100% precomputed artifacts of the training pass** — nothing is computed at page
  render. `/evaluate` reads `mb["models"][].metrics` (accuracy, precision, recall, f1, roc_auc,
  brier, log_loss — `model.py:488-496`), `mb["confusion"]`, `mb["importance"]` from the cached
  bundle (`app.py:569-571`).
- **Server-rendered:** the metrics table (`evaluate.html:61-67`), the **confusion matrix** — a pure
  Jinja HTML grid of the champion's tn/fp/fn/tp (`evaluate.html:115-126`; per-model matrices also
  stored on each candidate, `model.py:471-473, 497`), and the EDA **correlation heatmaps** — cell
  colors computed server-side (`_heat_color`/`_heat_matrix`, `eda.py:208-234`) and emitted as
  colored HTML cells.
- **Client-rendered (Chart.js 4.4.3 from CDN):** ROC curves, reliability/calibration curves,
  feature-importance bars, benchmark grouped bars. Data reaches the browser as embedded JSON —
  `window.EDA = {models, importance}` (`evaluate.html:153-156`), `window.MODEL_PAGE` on the train
  page (`train.html:239-247`) — hydrated by `charts.js` into `<canvas data-chart="roc|calibration|
  importance|benchmark|rocsel">` (`charts.js:492-518`). After an interactive benchmark,
  `script.js` re-renders table + chart from the fetch response (`script.js:314-317`).
- ROC payloads are pre-thinned to ~80 points to keep the embedded JSON small (`model.py:325-330`);
  reliability curves carry `bin_mid`/`frac_pos` per model (`model.py:500-503`).

---

## 5. Preprocessing mechanics

**Order, and leakage discipline — split first, everything fit on train only** (`model.py:397-416`):

```python
# split first — every transform below is fit on the training rows only,
# so the sealed test set can never leak into them
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, stratify=y, random_state=SEED,
)
impute_means = X_train.mean()
X_train = X_train.fillna(impute_means)
X_test = X_test.fillna(impute_means)
scaler = StandardScaler().fit(X_train)
```

1. Stratified 80/20 split, seed 42 — "sealed before anything is fit" (preprocess.html:37-40).
2. Mean imputation for the 5 gappy columns (Workshops, AptitudeTestScore, SoftSkillsRating,
   CodingTestScore, MockInterviewScore — `eda.py:43-46`), means from **train only**, applied to both.
3. `StandardScaler` fit on train; scaled copies used **only by logistic regression**; trees read raw
   imputed values (`model.py:461-462`; preprocess.html:71-72).
4. No encoding step: target is already 0/1; the 12 model features are all numeric
   (preprocess.html:69-70). Categoricals (Gender, Stream, …) are used for EDA rates only, never
   modelled (`eda.py:53-56`).
5. At inference, the same frozen transforms apply: missing feature → train impute mean, then
   scaler if the model needs it (`model.predict`, `model.py:691-696`).

**Verdict: leakage-safe against the test set.** The one caveat is *within* the training split (see
§7): impute means and the scaler are fit on the whole training split and then reused inside the
3-fold calibration and, for imputation, inside the champion-selection CV — so calibration/CV folds
share transform statistics. The sealed test set never participates, so headline metrics are honest;
calibration is marginally optimistic.

Note also the **EDA bundle imputes with full-dataset means** for visualization (`eda.py:419-422`) —
display-only, never fed to the model, but it contradicts the "training-split mean imputation"
wording the UI shows (`app.py:344-348`).

---

## 6. Validation & error mechanics

**Upload validation** (`app.py:389-421`), in order — each failure deletes the stored file and
re-renders with a specific message:

1. No file / empty filename → "Choose a CSV or Excel file…"
2. Extension whitelist `.csv`/`.xlsx` (`_allowed_file`, `app.py:267-268`; also `accept` attr
   client-side, upload.html:27).
3. 10 MB cap via `MAX_CONTENT_LENGTH` (`app.py:59`) → branded 413 page (`app.py:937-946`).
4. Parse by pandas (`_read_dataset`, `app.py:271-274`); any exception → reject + delete.
5. Schema: `REQUIRED_COLS` = 12 numerics + `PlacementStatus` (`eda.py:61`); missing columns named
   in the error (`app.py:413-417`).
6. Stored as `{uuid4().hex[:8]}_{secure_filename(...)}` (`app.py:401`) — concurrent sessions can't
   clobber each other; session cookie carries only the basename; `_dataset_path` enforces
   containment via `commonpath` (`app.py:229-242`).

**Training-time guards** (`_train_all_inner`, `model.py:343-394`) — each returns
`{ok: False, error: <friendly reason>}` instead of raising: schema mismatch; zero rows after
dropping the corrupt sentinel row (`StudentID == 0`, `model.py:349-351`); NaN in target; text typed
feature columns; single-class target (message names the class); fewer than 50 usable rows. The EDA
side independently treats zero-rows/text-columns as `schema_ok: False` (`eda.py:296-302`).

**Predict validation** (shared shape in HTML and JSON paths, `app.py:633-650` / `785-801`): blank
field → dataset median default; non-numeric → per-field error naming the value; value outside the
dataset's observed `[min, max]` → per-field error naming the range. Unknown model selector → 400
with `valid_models` list (API) or inline error (form); `"best"` alias family resolved by
`is_best_alias`/`_resolve_requested_model` (`model.py:86-108`, `app.py:574-586`).

**Deliberate edge-case handling worth noting:** benchmark `fresh` strict-boolean parsing
(`app.py:879-884`); `/api/predict` requires `Content-Type: application/json` (415) and an object
body (400) (`app.py:743-747, 767-769`); error text echoed into the DOM via `textContent`, never
`innerHTML` — the API echoes request values, so this is an explicit XSS guard (`script.js:319-323`);
all training failures surface as pages, not 500s (`model.py:333-340`; view-level try/except
`app.py:508-511`); security headers on every response (`app.py:68-81`).

---

## 7. Design lessons for PropPulse (FastAPI + React)

### Replicate — the mechanics are sound

1. **Registry as single source of truth** (`model.py:56-81`). One ordered structure carrying key,
   name, factory, `needs_scaling`, human settings/note per candidate drives training, benchmark,
   prediction, and UI copy. PropPulse should do the same for its regression roster — templates/UI
   never hardcode per-model facts.
2. **Deterministic sealed split, recomputed not stored** (`model.py:397-416`). Fixed seed +
   stratification means any route can rebuild the identical split on demand; persist only
   *results* and *fitted pipelines*. This eliminates a whole class of state-sync bugs.
3. **Artifact validation by content hash + recipe version** (`model.py:123-131, 189-203`). A
   stale artifact silently retraining instead of silently serving the wrong model is exactly right.
4. **Split-first preprocessing with train-only fits** (`model.py:397-416`). Keep, verbatim in
   spirit. In PropPulse use an sklearn `Pipeline`/`ColumnTransformer` so the discipline is
   structural rather than comment-enforced.
5. **Champion by CV on train, test touched once** (`model.py:544-547`), and per-model bundles that
   each carry their own metrics/confusion/ROC (`model.py:478-504`) so any selection is inspectable
   without retraining.
6. **`form_meta` derived from data** (min/max/step/default, `model.py:571-583`) driving both the
   form and a single shared validation routine for HTML + JSON paths (`app.py:633-650, 785-801`).
   In PropPulse: one Pydantic schema generated from the same metadata.
7. **Graceful degradation taxonomy**: schema mismatch → notice, training failure → `{ok: False,
   error}` page, unknown model → 400 with valid options, never a bare 500 (§6). Copy this.
8. **Cheap health/warm endpoint that cannot trigger training** (`model.py:302-322`,
   `app.py:698-703`) and a home page that never cold-trains (`app.py:296-306`).
9. **Upload hygiene**: uuid-namespaced filenames, `secure_filename`, extension whitelist, size cap,
   path-containment check (§6). All directly portable (python-multipart + `Path.resolve()`).

### Adapt — same ideas, different machinery for FastAPI + React

- **Training must become an explicit, backgrounded action.** PlacementPredict trains implicitly
  inside GET page views and blocks a request for ~40 s (§3). In PropPulse: `POST /api/train` →
  `202 {job_id}` with `BackgroundTasks`/worker, `GET /api/train/{job_id}` polled by React (or
  SSE/WebSocket) with real progress; React Query fits the polling. This is the single biggest
  mechanical delta — PlacementPredict has **no polling protocol to copy**, only a hung fetch.
- **Session cookie → dataset-id resource.** Return `dataset_id` from `POST /api/datasets`, keep it
  in React state/URL, key all stage endpoints off it (`/api/datasets/{id}/eda`, `/train`,
  `/evaluate`, `/predict`). This replaces `_active_dataset()`'s cookie indirection and fixes the
  cross-origin-sees-default-dataset quirk (`app.py:73-81`).
- **`window.EDA`/`window.MODEL_PAGE` embedded payloads → plain JSON GET endpoints.** The bundle
  shapes themselves (histograms, heat cells, per-model metrics) are well-designed — reuse them as
  response models.
- **In-process LRU caches**: fine for one worker, but uvicorn multi-worker breaks single-flight
  and each worker would retrain. Either run the training cache in one worker, or make artifacts on
  disk the shared state and keep per-process caches thin.

### Discard / do NOT copy — Flask-isms and correctness smells

1. **Side-effectful GETs.** `/preprocess`, `/train`, `/evaluate`, `/predict` all train on first
   view (`app.py:501-541`). Violates HTTP semantics, makes cold-start latency invisible and
   uncontrollable, and couples page rendering to a 40 s computation.
2. **Synchronous ~40 s request** for cold benchmark/train (§3). Proxy/browser timeouts make this
   fragile; it survived only because the host tolerated it.
3. **Module-global mutable caches as the only pipeline memory** (`eda.py:98-103`,
   `model.py:111-117`). With `_CACHE_MAX = 2`, two users with different uploads evict each other's
   models → retrain storms; the global lock serializes *all* training behind one user's cold run.
   PropPulse needs per-dataset keyed storage with explicit capacity.
4. **Ephemeral secret key + startup `_clean_uploads()`** (`app.py:20-28, 45-56`): sessions and
   uploads die on every restart — acceptable for a demo, wrong for a product.
5. **Within-train transform sharing (minor leakage):** scaler fit on the full training split is
   reused inside `CalibratedClassifierCV`'s folds for the served LR (`model.py:458-464`), and
   train-wide impute means precede the champion-selection CV (`model.py:406-407` vs `455-456`).
   Test set stays sealed so headline metrics hold, but calibration/CV estimates are slightly
   optimistic. In PropPulse put imputer+scaler *inside* the CV/calibration pipeline.
6. **Feature importance from `calibrated_classifiers_[0]`** (`model.py:551`) — an arbitrary single
   fold's forest trained on 2/3 of train. Average importances across folds or refit a dedicated
   forest.
7. **EDA imputation inconsistency** (`eda.py:419-422`): charts use full-dataset means while the UI
   copy claims training-split means. Harmless but confusing — keep display and model pipelines
   visibly separate.
8. **Fragile confusion-matrix unwrap** (`model.py:473`): `.ravel()` assumes both classes present in
   test predictions; guarded only indirectly by the <50-rows/single-class checks. Use
   `confusion_matrix(..., labels=[0,1])`.
9. **Static-export machinery** (`export_pages.py`, in-browser `lr_export` logistic model,
   `script.js:166-260`): exists only to make a Jinja app work on GitHub Pages. A React SPA needs
   none of it — drop the whole concept.
