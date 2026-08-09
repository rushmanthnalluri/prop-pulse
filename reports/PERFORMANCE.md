# PropPulse — API Performance Report

**Date:** 2026-08-07 · **Agent:** performance · **Tool:** `scripts/load_test.py` (httpx 0.28.1 + asyncio, stdlib only otherwise)
**Server under test:** `uvicorn backend.app.main:app --host 127.0.0.1 --port 8200` (single worker, `LOG_LEVEL=WARNING`, `PREDICTION_LOG_PATH` redirected to a scratch file so the production `logs/predictions.jsonl` was not polluted — 1,218 load-test records were discarded after the run).

## Summary

- **Zero errors** across all runs: 2,015 measured HTTP requests, 0 HTTP ≥ 400, 0 transport errors; the server-side middleware also recorded `errors_total: 0` over 1,815 requests on the first instance.
- **Warm `POST /predict` is ~0.8–1.0 s per request (c=1 p50 969.9 ms, p95 1256.0 ms) — above the ~50 ms figure quoted in README/SPEC §14.** Root cause identified: the classification champion (`CalibratedClassifierCV`, 5 folds × 300-tree RandomForest, `n_jobs=-1`) spends ~85% of request time in `predict_proba`, most of it in **joblib multiprocessing-pool spawn/terminate churn on Windows**, not inference.
- **Throughput is flat at ~1 req/s regardless of concurrency (1/10/25)** — the single-worker process is CPU-saturated; adding concurrency only queues (c=25 p50 = 32.3 s).
- **Cold start:** 3.13 s process-start → `/health` OK (artifact load); first `/predict` pays an additional one-time **4.7–5.4 s** SHAP singleton build.
- **GET endpoints are fast** (`/model/info` p50 6.7 ms, `/market/clusters` p50 9.7 ms at c=1) and hold up at c=25 (p50 ≤ ~180 ms, 100–135 req/s).
- **Memory is stable:** RSS 234.5 MB → 244.0 MB after 1,815 requests (peak 306.3 MB), +9.5 MB, no leak trend.

## Hardware & environment (measured, not assumed)

| item | value | source |
|---|---|---|
| CPU | Intel Core 7 150U, 12 logical processors | `Get-CimInstance Win32_Processor` |
| RAM | 15.7 GiB total (16,876,888,064 bytes) | `Get-CimInstance Win32_ComputerSystem` |
| OS | Microsoft Windows 11 Home build 26200 | `Get-CimInstance Win32_OperatingSystem` |
| Python | 3.14.5 (`.venv`), FastAPI 0.141.1, scikit-learn 1.9.0 | pinned venv |
| Client | httpx 0.28.1 `AsyncClient`, keep-alive, HTTP/1.1, loopback | `scripts/load_test.py` |

**Contention caveat:** six other hardening agents shared this machine during measurement. Observed ambient CPU load ranged 14–65%. The `/predict` c=1 run and the in-process profile were taken at ~14% load and agree within 5%, so the bottleneck numbers are solid; one run (`/predict/sale-probability` c=10, first pass) coincided with another agent's model retraining and showed an inflated tail — it was re-measured (see below).

## Methodology

`scripts/load_test.py` spawns `concurrency` async workers over a shared request counter against one `httpx.AsyncClient`; per-request latency is timed with `time.perf_counter()` around `client.request`; percentiles use linear interpolation (numpy "linear" method); throughput = successful requests / measured wall time; an error is any HTTP status ≥ 400 or a transport exception. CLI: `--url --endpoint --concurrency --requests --payload --method --warmup --profile --json`.

Representative POST body (all SPEC §8 required fields; served price ≈ $151,148):

```json
{"neighborhood": "NAmes", "house_style": "1Story", "bldg_type": "1Fam", "ms_zoning": "RL",
 "bedrooms": 3, "full_bath": 2, "half_bath": 0, "bsmt_full_bath": 1, "bsmt_half_bath": 0,
 "gr_liv_area": 1500, "lot_area": 8000, "total_bsmt_sf": 1000, "year_built": 1975,
 "overall_qual": 6, "overall_cond": 5, "garage_cars": 2, "fireplaces": 1, "central_air": true}
```

The SHAP singleton was warmed before every steady-state run (`--warmup`); cold start was measured separately on fresh processes. Git Bash rewrites leading-slash arguments (`/predict` → `C:/...`), so all client runs used `MSYS_NO_PATHCONV=1` (the script also guards against a mangled endpoint with a clear error).

## Results

### (a) `POST /predict` — warm steady state, 200 requests per level

| concurrency | errors | mean ms | p50 ms | p90 ms | p95 ms | p99 ms | max ms | req/s |
|---|---|---|---|---|---|---|---|---|
| 1 | 0 | 918.6 | 969.9 | 1157.6 | 1256.0 | 1373.6 | 1522.9 | 1.09 |
| 10 | 0 | 10104.2 | 9985.7 | 11952.1 | 12525.2 | 13560.3 | 14388.2 | 0.98 |
| 25 | 0 | 30773.7 | 32343.0 | 35077.2 | 35457.3 | 36282.1 | 37096.6 | 0.80 |

Raw evidence (c=1 run):

```
POST /predict  concurrency=1
  requests=200 errors=0 (0.00%) statuses={'200': 200}
  latency ms: min=356.4 mean=918.63 p50=969.91 p90=1157.58 p95=1256.01 p99=1373.64 max=1522.93
  wall=183.727s throughput=1.09 req/s
```

Latency grows ~linearly with concurrency while throughput stays ≈ 1 req/s: the single uvicorn worker is CPU-bound and every in-flight request just queues. Mean ≈ c × 1.0–1.25 s per request, exactly the queueing signature of a serialized CPU-bound resource.

### (b) Narrow prediction endpoints — concurrency 10, 200 requests

| endpoint | errors | mean ms | p50 ms | p95 ms | p99 ms | req/s |
|---|---|---|---|---|---|---|
| `/predict/price` | 0 | 7418.3 | 7381.8 | 8952.1 | 9245.5 | 1.34 |
| `/predict/sale-probability` (re-run) | 0 | 8073.3 | 7858.2 | 10006.5 | 10607.8 | 1.23 |
| `/predict/sale-probability` (first pass, contended) | 0 | 11332.5 | 9459.9 | 25132.8 | 30794.4 | 0.87 |

Both narrow endpoints cost the same as full `/predict` because `_run_prediction` (`backend/app/api/predict.py:34`) always runs **both champions + SHAP + cluster lookup + logging** — no work is skipped for a narrower response. The first `/predict/sale-probability` pass overlapped with another agent's CPU-heavy retraining (its p95 of 25.1 s vs 10.0 s on the quieter re-run at 18% ambient load); the re-run is the representative number.

### (c) GET endpoints — concurrency 25, 200 requests (plus c=1 baselines)

| endpoint | c | errors | mean ms | p50 ms | p95 ms | p99 ms | req/s |
|---|---|---|---|---|---|---|---|
| `/market/clusters` | 25 | 0 | 219.5 / 227.6 | 175.2 / 179.3 | 556.2 / 656.2 | 1058.3 / 1114.8 | 108.7 / 102.1 |
| `/model/info` | 25 | 0 | 247.4 / 174.0 | 160.2 / 127.6 | 747.4 / 424.2 | 1117.8 / 1118.0 | 95.3 / 134.5 |
| `/market/clusters` | 1 | 0 | 10.6 | 9.7 | 16.3 | 18.5 | 93.9 |
| `/model/info` | 1 | 0 | 7.1 | 6.7 | 11.3 | 14.6 | 140.3 |

(two c=25 passes shown, run minutes apart; c=1 baselines use 100 requests.) Per-request server cost is single-digit ms; the c=25 inflation is queueing on one worker's event loop + sync threadpool plus ambient CPU, not endpoint work.

### (d) Memory — uvicorn process RSS (Windows `Get-Process WorkingSet64`, PID 23708)

| point | RSS |
|---|---|
| after startup, before any prediction | 234.5 MB |
| after 1,815 requests (full matrix) | 244.0 MB |
| peak working set | 306.3 MB |

+9.5 MB over the whole matrix — stable, no leak trend.

### (e) Error rate

0 client-side errors in every run; server middleware after the main matrix (first instance):

```
"requests_total": 1815, "errors_total": 0
```

## Cold-start analysis (SHAP singleton)

Measured on fresh processes (self-contained launcher, `perf_counter`):

```
startup_to_health_seconds=3.13        # process spawn → /health 200 (lifespan artifact load)
cold_predict_seconds=4.73 status=200 price=151147.74
warm_single_predict_seconds=0.800
```

First-instance cold `/predict` (via the load tool, 1 request): **5449 ms**. In-process profile cold call: **4705 ms**. So the one-time SHAP `RegressionExplainer` build (`ml/explainability/service.py` lazy singleton, model load + 200-row background) costs ≈ **3.9–4.6 s** on top of a ~0.8 s warm request — consistent with SPEC §14's "~4 s" note. It happens on the first prediction, not during lifespan, so `/health` reports ready ~3.1 s after launch while the first user request still stalls ~5 s.

## Bottleneck analysis — where `/predict` time goes

In-process stage profile (`scripts/load_test.py --profile --requests 50`, real champion artifacts, warm, ambient CPU ~14%):

```
cold full predict (SHAP singleton build): 4705.4 ms
  build_features     mean=41.279 ms p50=38.548 ms p95=81.138 ms
  ridge_predict      mean=30.305 ms p50=27.951 ms p95=60.19 ms
  rf_predict_proba   mean=904.4  ms p50=895.365 ms p95=1307.131 ms
  shap_explain       mean=44.371 ms p50=38.422 ms p95=99.964 ms
  full_predict       mean=1068.113 ms p50=992.766 ms p95=1821.975 ms
```

The **calibrated classifier's `predict_proba` is ~85% of the warm request**; feature building, the ridge champion, and warm SHAP are each ~30–45 ms. Drilling into the artifact (`models/registry/classification_champion.joblib`, 14.6 MB):

```
type: CalibratedClassifierCV · n calibrated_classifiers: 5
base estimator: Pipeline ['preprocess', 'model']
  n_estimators=300 max_depth=12 n_jobs=-1 max_features=sqrt min_samples_leaf=5
  n_trees_fitted: 300 · max_depth actual: 12 · mean nodes/tree: 115
one preprocess.transform: 30.4 ms/call  -> shape (1, 290)
one rf.predict_proba (300 trees): 167.1 ms/call   (n_jobs=-1)
  rf.predict_proba n_jobs=1:      125.3 ms/call
one calibrated classifier: 801.0 ms/call
```

cProfile over 5 full `predict_proba` calls (25 single-row forest calls) shows the time is **joblib multiprocessing-pool lifecycle, not tree traversal**:

```
4385915 function calls in 9.354 seconds
  joblib parallel.py _get_outputs                    cum 14.252 s (overlapping)
  multiprocessing pool.py _terminate_and_reset etc.  cum  7.526 s  <- pool spawn/teardown
  threading join of pool workers                     cum  7.492 s
  sklearn _forest.py predict_proba                   cum  7.594 s (incl. above)
```

Each of the 5 calibrated folds runs a **single-row** `predict_proba` with `n_jobs=-1`, which spins up a fresh process pool and tears it down (~300 ms per fold on Windows) to compute a trivial 1×290 inference. Multiprocessing cannot pay off for one row; it only adds spawn/join latency and — under concurrent requests — CPU storms (10 concurrent requests × pool-per-fold is why c=10/c=25 throughput degrades slightly instead of scaling).

**Sanity-check verdict:** the assignment's expectation "warm p95 well under 1 s" fails narrowly at c=1 (p95 = 1256 ms) for the reasons above — the expectation holds for the regression+explanation path (~160 ms combined) but not for the calibrated classifier. The README's "warm predictions are ~50 ms" is not reproducible on this hardware for the full `/predict` bundle; ~50 ms matches only the individual non-classifier stages. Both docs understate the real warm cost.

## Recommendations (recommendations only — no backend/model code was changed)

Ordered by expected impact:

1. **Serve the classifier without process pools.** Re-register/retrain the classification champion with `n_jobs=1` (125 ms vs 167 ms per fold standalone, and none of the ~300 ms/fold pool churn), or wrap serving-time prediction in `joblib.parallel_config(backend="threading")`. Expected effect: warm `/predict` drops from ~0.9–1.0 s toward ~0.4–0.6 s and, more importantly, removes the per-request pool-spawn CPU storms that flatten concurrent throughput.
2. **Run multiple uvicorn workers** (e.g. `--workers 4` on this 12-thread machine) behind the compose/nginx setup. Single-worker throughput is hard-capped at ~1 req/s for `/predict`; the workload is CPU-bound with no shared mutable state, so workers scale near-linearly until cores saturate. (The SHAP singleton warms per worker — acceptable, or combine with #4.)
3. **Let narrow endpoints skip work they don't return.** `/predict/price` currently pays for the classifier + SHAP (~0.9 s of its ~1.0 s); a price-only path would be ~120–160 ms. Same for `/predict/sale-probability` (skip ridge + SHAP).
4. **Warm the SHAP singleton during lifespan startup** (one dummy `explain_instance` call after artifact load) so the first user request doesn't pay 4.7–5.4 s; or document the cold request explicitly for operators.
5. **Cache static GET responses per process.** `/market/clusters` (5,479-byte payload) and `/model/info` only change when artifacts change; build once at startup (or mtime-check the file in `/model/importance`, which re-reads disk every request). Cuts c=1 latency from ~7–10 ms to <1 ms and removes pydantic re-validation per request.
6. **Add `GZipMiddleware`** for the larger JSON responses (`/market/clusters`, `/model/info`); modest gains at 5.5 KB, but free insurance as payloads grow.
7. Keep-alive is already in use by the client and supported by uvicorn — no action needed there.

## Reproduction

```bash
# terminal 1
PREDICTION_LOG_PATH="$PWD/scripts/.load_test_predictions.jsonl" LOG_LEVEL=WARNING \
  .venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8200

# terminal 2 (MSYS_NO_PATHCONV needed on Git Bash)
export MSYS_NO_PATHCONV=1
.venv/Scripts/python.exe scripts/load_test.py --endpoint /predict --concurrency 1  --requests 200 --warmup 3
.venv/Scripts/python.exe scripts/load_test.py --endpoint /predict --concurrency 10 --requests 200 --warmup 3
.venv/Scripts/python.exe scripts/load_test.py --endpoint /predict --concurrency 25 --requests 200 --warmup 3
.venv/Scripts/python.exe scripts/load_test.py --endpoint /predict/price --concurrency 10 --requests 200 --warmup 2
.venv/Scripts/python.exe scripts/load_test.py --endpoint /predict/sale-probability --concurrency 10 --requests 200 --warmup 2
.venv/Scripts/python.exe scripts/load_test.py --endpoint /market/clusters --concurrency 25 --requests 200
.venv/Scripts/python.exe scripts/load_test.py --endpoint /model/info --concurrency 25 --requests 200
.venv/Scripts/python.exe scripts/load_test.py --profile --requests 50   # stage breakdown, no server needed
```

---

## After fix (wave 9b) — 2026-08-07 · Agent: latency-fix

All recommendations that required **no response-shape or prediction-value changes** were
implemented in `backend/` (recommendations 1, 3, 4, 5 of this report; 2 = uvicorn workers and
6 = gzip are deployment concerns, left out of scope):

1. **`n_jobs=1` on the served classification champion** — `force_single_threaded()`
   (`backend/app/services/prediction_service.py:45`) recursively pins every inner estimator
   (Pipeline steps → `CalibratedClassifierCV.calibrated_classifiers_` → fold pipelines → the
   300-tree RandomForests) right after the joblib load in the lifespan
   (`backend/app/main.py:124`). In-memory only — the artifact on disk is untouched.
2. **Narrow endpoints skip work they don't return** — `PredictionService.predict_price()`
   never touches the classifier or SHAP; `predict_sale_probability()` never touches the
   regressor or SHAP; `/predict` is unchanged (`backend/app/api/predict.py`). The SPEC §10
   prediction log still records every call (full feature row); the skipped value is logged
   as `null` (the drift check's `_coerced` drops non-floats — feature PSI unaffected).
3. **SHAP explainer warmed in the lifespan** — one `explain_instance` call on a fixed
   warm-up payload during startup, wrapped in try/except (failure only logs a warning and
   leaves the lazy first-request path intact).
4. **Static GET payloads cached in `app.state` at startup** — `/market/clusters`,
   `/model/info`, and `/model/importance` (file read once; a missing/malformed artifact is
   cached as an error state and still returns 503).

### Prediction values unchanged (proof)

- **5-row feature frame, `predict_proba` before/after `n_jobs=1`:**
  `np.testing.assert_allclose(rtol=1e-12, atol=1e-12)` **PASS**; max abs diff
  **1.11e-16** (one ULP — parallel vote-sum order only). The 6-decimal values the API
  serves are **identical** (`np.round(·, 6)` arrays equal). Locked in by
  `backend/tests/test_latency_fixes.py::test_force_single_threaded_predictions_identical`.
- **End-to-end:** same payload (`scripts/load_test.py` default body) against the pre-fix
  and post-fix servers returned byte-identical JSON values — `estimated_price` 151147.74,
  `price_range`, `probability` 0.216313, `sells_within_30_days`, `micro_market`,
  `top_price_factors`, `model_version` all `SAME`.
- Narrow endpoints return exactly the values `/predict` returns for the same payload
  (test `test_narrow_endpoints_match_full_predict_values`).

### Measured results (same machine, port 8200, 100 requests per run)

**Contention caveat (stronger than the first measurement):** ambient CPU swung 8–94%
*during* runs (other hardening agents share the machine). Each run below is annotated;
"quietest" = lowest ambient load observed. Even the worst post-fix run beats the pre-fix
baseline taken under lighter load.

| endpoint / run | before p50 ms | after p50 ms | before req/s | after req/s |
|---|---|---|---|---|
| `/predict` c=1 (quietest runs) | 798.5 | **197.5** | 1.23 | **4.71** |
| `/predict` c=1 (contended, 65–91% ambient) | — | 425.6 / 485.9 / 621.0 | — | 2.33 / 2.05 / 1.52 |
| `/predict` c=10 (least-contended pair) | 7660.3 | **2406.6** | 1.27 | **4.15** |
| `/predict/price` c=10 | 7747.3 | **242.8** | 1.27 | **37.37** |
| `/predict/sale-probability` c=10 | ~7858 (report §b) | **2059.2** | ~1.23 | **4.89** |
| `GET /market/clusters` c=1 | 10.1 | **4.9** | 75.5 | 125.1 |
| `GET /model/info` c=1 | 5.9 | **5.8** | 105.7 | 105.3 |

Raw evidence — quietest post-fix c=1 run (target: warm p50 < 350 ms — **MET**):

```
POST /predict  concurrency=1
  requests=100 errors=0 (0.00%) statuses={'200': 100}
  latency ms: min=163.04 mean=212.5 p50=197.46 p90=268.78 p95=297.65 p99=387.49 max=424.79
  wall=21.25s throughput=4.71 req/s
```

Raw evidence — pre-fix c=1 run (same machine, ~2 h earlier, lighter ambient load):

```
POST /predict  concurrency=1
  requests=100 errors=0 (0.00%) statuses={'200': 100}
  latency ms: min=729.5 mean=812.09 p50=798.48 p90=894.89 p95=913.79 p99=982.24 max=997.45
  wall=81.21s throughput=1.23 req/s
```

Post-fix `/predict/price` c=10 (was 7747.3 ms pre-fix — same cost as full `/predict`):

```
POST /predict/price  concurrency=10
  requests=100 errors=0 (0.00%) statuses={'200': 100}
  latency ms: min=24.2 mean=260.2 p50=242.83 p90=382.91 p95=619.22 p99=722.59 max=745.38
  wall=2.676s throughput=37.37 req/s
```

### Cold start (fix 3)

First `/predict` on a fresh server process: **514.7 ms** (vs **3838.7 ms** pre-fix — the
one-time SHAP build no longer lands on the first user request). The ~4–5 s explainer build
now happens during lifespan startup, so `/health` reports ready only after the app is truly
warm.

### After-fix stage profile (in-process, champion pinned to `n_jobs=1`, 50 iterations)

NOTE: `scripts/load_test.py --profile` loads the champion itself and does **not** apply the
lifespan's `n_jobs=1` pin, so it still shows the pre-fix path (rf p50 776.7 ms). This
equivalent profile applies the pin exactly like the lifespan does (ambient CPU ~65% during
this run — the absolute numbers are contention-inflated, the *shape* is the point):

```
build_features           mean=  33.843 ms  p50=  31.515 ms
ridge_predict            mean=  27.538 ms  p50=  26.558 ms
rf_predict_proba_n_jobs1 mean= 442.914 ms  p50= 432.308 ms   (pre-fix profile: 895.4 ms p50)
shap_explain             mean=  38.382 ms  p50=  33.376 ms
full_predict             mean= 527.722 ms  p50= 518.363 ms   (pre-fix profile: 992.8 ms p50)
```

The joblib pool spawn/terminate churn (~300 ms × 5 folds, §Bottleneck analysis) is gone;
what remains is genuine single-core tree traversal, which is why the residual latency
tracks ambient CPU so closely. Under a quiet machine the full warm `/predict` is ~200 ms
(~165 ms of it the calibrated classifier) — further gains need uvicorn workers
(recommendation 2) or a leaner classification champion, both out of this wave's scope.

### Errors

0 client-side errors in every post-fix run; server middleware after 1,231 measured requests:
`requests_total: 1233, errors_total: 0` (includes 2 `/health`).

### Tests

`backend/tests/test_latency_fixes.py` (8 tests, new): `n_jobs=1` pin verified on all 5 fold
forests; 5-row probability parity (allclose 1e-12); `/predict/price` returns 200 with the
classifier monkeypatched to explode on any access (and SHAP armed to fail) — proving both
are skipped; same for `/predict/sale-probability` with a broken regressor; `/predict` still
runs both champions (broken classifier surfaces); narrow values == full-bundle values;
SHAP singleton warm after startup; static GETs serve the startup cache (post-startup
mutation of `app.state.champion` does not leak into `/model/info`).
`backend/tests/test_api.py::test_model_importance_missing_artifact_503` updated for the
startup-cached error state. Full suite: **162 passed** (`pytest tests backend/tests -q`).

**Doc note for the docs owner:** `docs/API.md:188-189` still says `/model/importance` reads
the artifact "on every request" — stale since wave 9b (now read once at startup; a restart
is required to pick up a regenerated artifact). *(Superseded — resolved: API.md already
documents the startup cache; noted during the forensic audit, docs-truth F4.)*
