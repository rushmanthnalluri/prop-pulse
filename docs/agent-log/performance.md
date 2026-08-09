# Agent Log — performance

**Scope:** `scripts/load_test.py` (new), `reports/PERFORMANCE.md` (new),
`docs/agent-log/performance.md` (this file). No backend/model/test files touched.
Status: **complete**.

## What was built

- `scripts/load_test.py` — async load generator (httpx 0.28.1 + asyncio + stdlib
  only, no new packages). CLI: `--url --endpoint --concurrency --requests
  --payload --method --warmup --profile --json`. Semaphore-free worker pool over
  a shared counter on one `httpx.AsyncClient` (keep-alive); per-request
  `perf_counter` latency; p50/p90/p95/p99/mean/min/max via linear-interpolation
  percentiles; throughput = ok/wall; errors = HTTP ≥ 400 + transport exceptions.
  `--payload` takes inline JSON or a file; a built-in representative
  `PropertyInput` body (NAmes 3-bed 1975 house) is the default for `/predict*`.
  `--profile` runs an **in-process stage breakdown** of the prediction path on
  the real champion artifacts (no server needed): feature build / ridge predict /
  calibrated-RF predict_proba / SHAP explain / full predict, with the cold
  singleton-build call timed separately. Guards against Git Bash mangling
  leading-slash args (`/predict` → `C:/...`) with a clear error; measurements
  used `MSYS_NO_PATHCONV=1`.

## How it was verified / key results (full evidence in reports/PERFORMANCE.md)

- Server: own uvicorn instance on **port 8200 only** (`PREDICTION_LOG_PATH`
  redirected to a scratch file — 1,218 test records never touched
  `logs/predictions.jsonl`; scratch file deleted after).
- **Errors: 0** across 2,015 measured requests; middleware `errors_total: 0`.
- Warm `/predict` c=1/10/25 × 200 req: p50 969.9 / 9985.7 / 32343.0 ms;
  throughput flat ≈ 1 req/s at all levels → single-worker CPU saturation,
  concurrency only queues.
- `/predict/price` + `/predict/sale-probability` at c=10 ≈ same cost as
  `/predict` (`_run_prediction` always runs both champions + SHAP + logging).
  First sale-probability pass showed an inflated tail (p95 25.1 s) while another
  agent was retraining; re-run at 18% ambient CPU: p95 10.0 s — re-run reported.
- GETs fast: `/market/clusters` p50 9.7 ms, `/model/info` p50 6.7 ms at c=1;
  c=25 p50 ≤ ~180 ms at ~100–135 req/s.
- RSS 234.5 → 244.0 MB over 1,815 requests (peak 306.3 MB) — no leak.
- Cold start: process → `/health` OK = 3.13 s; first `/predict` = 4.73–5.45 s
  (one-time SHAP singleton build ≈ 3.9–4.6 s over the ~0.8 s warm request).

## Root-cause finding (bottleneck)

Warm `/predict` ≈ 0.9–1.0 s is **~85% the classification champion's
`predict_proba`**: `CalibratedClassifierCV` = 5 folds × Pipeline(preprocess →
RandomForest 300 trees/depth 12, `n_jobs=-1`). cProfile shows the time is joblib
**multiprocessing pool spawn/terminate per single-row fold call** (~300 ms × 5
folds on Windows), not inference (forest itself: 125–167 ms; preprocess 30 ms;
ridge 30 ms; warm SHAP 44 ms; build_features 41 ms). Sanity expectation
"p95 well under 1 s" fails narrowly at c=1 (1256 ms) for this reason; the
README's "warm ~50 ms" matches only the non-classifier stages. Recommendations
in the report (n_jobs=1/threading for serving, uvicorn workers, narrow-endpoint
work skipping, SHAP warm-up in lifespan, GET response caching, gzip) are
**recommendations only — no code changed**.

## Caveats for the orchestrator

- Machine was shared with five other agents; ambient CPU 14–65% during
  measurement. Bottleneck conclusions rest on the in-process profile taken at
  ~14% load, which agrees with the c=1 server run within 5%.
- `logs/predictions.jsonl` untouched by load tests (env override); the drift
  report visible via `/metrics` during the run was another agent's artifact.
- Port 8200 freed and verified (`Get-NetTCPConnection` — no listener) after
  every server instance; all three instances killed.
