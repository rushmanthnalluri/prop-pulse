# PropPulse — Runtime Performance & Reliability Audit (mission §20)

**Date:** 2026-08-07 · **Agent:** performance (wave B) · **Port used:** 8500 only (killed afterwards, verified free)
**Server under test:** `uvicorn backend.app.main:app --host 127.0.0.1 --port 8500`, single worker, `LOG_LEVEL=WARNING`, `PREDICTION_LOG_PATH` redirected to a scratch file (production `logs/predictions.jsonl` never touched by my server — see §Cleanup).
**Tool:** `scripts/load_test.py` (httpx 0.28.1 + asyncio) for all load runs; psutil 7.2.2 for RSS/handle watching.

## Environment (measured)

| item | value |
|---|---|
| CPU | Intel Core 7 150U, 12 logical processors |
| RAM | 15.7 GiB (16,876,888,064 bytes) |
| OS | Windows 11 Home build 26200 |
| Python | 3.14.5 (`.venv`), scikit-learn 1.9.0, FastAPI 0.141.1, shap 0.52.0 |

**AMBIENT LOAD CAVEAT (strong).** Five other wave-B auditors shared this machine (api :8300, contract :8400/:5400, devops docker builds, blackbox-e2e, monitoring recomputes). Sampled ambient CPU swung 8–100 % during my session; a quiet window below 15 % was never held for long. All latency numbers below are annotated; per-run ambient samples are in the evidence files. This mirrors wave-9b's own caveat — their absolute numbers were "quietest run" figures and they documented contended runs 2–3× higher. My audit is the first to re-measure under sustained multi-agent load.

## Per-claim verdict summary

| # | Claim (wave-9b / docs) | My measurement | Verdict |
|---|---|---|---|
| 1 | Warm `/predict` c=1 p50 ≈ **197.46 ms**, 4.71 rps | Quiet-patch block: **p50 208.97 ms, min 167.3 ms**, 3.83 rps, 0 errors. Contended runs (ambient 20–85 %): p50 468.7 / 505.6 / 554.1 ms | **PASS — verified by execution** (quiet-window reproduction within 6 %; contended band matches wave-9b's own 425–621 ms contended figures) |
| 2 | `/predict` c=10: p50 **2406.6 ms**, 4.15 rps | p50 3792.4 ms / 2.65 rps (ambient mean 25.8 %); retry 5619.1 ms / 1.77 rps (ambient 36–65 %). 0 errors both | **PASS WITH CONTENTION CAVEAT** — absolute figure not reachable under current load; shape (queueing, 0 errors) consistent |
| 3 | `/predict/price` c=10: p50 **242.83 ms**, **37.37 rps** | p50 607.3–880.6 ms, 11.3–15.9 rps (ambient 20–90 %); min 87.6 ms. Narrow-vs-full speedup at c=10: ~5–6× latency, ~6× throughput | **PASS WITH CONTENTION CAVEAT** — the wave-9b optimization (skip classifier+SHAP) is clearly in effect; absolute claim is a quiet-machine number |
| 4 | Cold-start first `/predict` ≈ **514.7 ms** (~0.5 s) | **386.7 ms** and **419.4 ms** on two fresh boots; cold ≈ warm (431.4 ms) → SHAP build no longer lands on first request | **PASS — verified by execution** |
| 5 | SHAP warm ≈ **50 ms** | In-process stage profile: **p50 22.5 ms**, mean 23.3, p95 40.3 (ambient ~19 %) | **PASS — verified by execution** (reconciles with shap.md's 30.2 ms — see §Reconciliation) |
| 6 | No memory leak | 300 sequential `/predict`: RSS **270.7 → 270.6 MB**, peak unchanged 323.2 MB. Server2: 320.5 → 340.9 MB over ~1,900 requests, flat after a one-time +20 MB step at first high-concurrency phase | **PASS — verified by execution** |
| 7 | 20 rapid bursts ×25: any 500s? | **500/500 → HTTP 200, 0 errors**, process alive and healthy afterwards (both server instances) | **PASS — verified by execution** (but see F1: warning flood during bursts) |
| 8 | 100 invalid requests → fast 422s, stable memory | 100/100 → **422** across 5 invalidity classes; p50 63–159 ms at c=10 under load; RSS 342.7 → 343.2 MB | **PASS — verified by execution** |
| 9 | Large payloads → 413 | Boundary exact: 65,536 B passes size check (→ 422 validation), 65,537 B → **413 in 4.0 ms**; 1 MiB ×10 → all 413, p50 5.1 ms; RSS stable | **PASS — verified by execution** |
| 10 | Repeated model loading ×10: no caching pathology | Fresh subprocess per load: child RSS 217.2–219.1 MB every iteration; load time 2.1–8.5 s (ambient-sensitive, no upward trend) | **PASS — verified by execution** |
| 11 | `/market/clusters` + `/model/importance` cached, no per-request file I/O | c=50 ×200 each: 0 errors, 47–73 rps. c=1: p50 9.2 / 6.1 ms. psutil `open_files()` watcher during 400 requests at c=25: **0 artifact opens** | **PASS — verified by execution + statically** (`market.py:20`, `model.py:101-104`, cache built at `main.py:137-139`) |

## Measurement tables

### (a) Warm `POST /predict` c=1 ×100 (claim: p50 ≈197 ms)

| run | ambient | p50 ms | p95 ms | min ms | rps | errors |
|---|---|---|---|---|---|---|
| attempt 1 | 22 % before → 72.7 % after | 554.09 | 682.53 | 482.57 | 1.76 | 0 |
| attempt 2 | 11.9 % at start, spiked | 468.71 | 636.29 | **182.01** | 2.15 | 0 |
| attempt 3 (instrumented) | during-run samples 8–82 % | 505.60 | 709.91 | 314.71 | 1.97 | 0 |
| reliability block A (quiet patch) | low (p50 evidence) | **208.97** | 466.92 | **167.30** | 3.83 | 0 |
| reliability block B | rising | 347.75 | 499.11 | 186.34 | 2.97 | 0 |
| reliability block C | higher | 416.36 | 601.20 | 203.91 | 2.46 | 0 |

Block A ran when the machine momentarily quieted and **reproduces the wave-9b claim (197.46 ms) within 6 %** on the current code; the served price was byte-identical to wave-9b's (151147.74). Wave-9b's own contended runs: 425.6/485.9/621.0 ms — my contended band (416–554 ms) sits inside theirs. Conclusion: no code regression; the claim is a quiet-machine number.

### (b) `POST /predict` c=10 (claim: p50 2406.6 ms / 4.15 rps)

| run | requests | ambient during | p50 ms | rps | errors |
|---|---|---|---|---|---|
| main | 200 | mean 25.8 %, max 53.4 % | 3792.39 | 2.65 | 0 |
| final retry | 100 | 36–65 % | 5619.12 | 1.77 | 0 |

### (c) `POST /predict/price` c=10 (claim: p50 242.83 ms / 37.37 rps)

| run | requests | ambient during | p50 ms | rps | min ms | errors |
|---|---|---|---|---|---|---|
| first (storm) | 200 | mean 82.4 %, max 100 % | 721.12 | 12.98 | 112.22 | 0 |
| retry | 200 | mean 35.7 % | 607.27 | 15.85 | 87.56 | 0 |
| final | 200 | 36–65 % | 880.64 | 11.25 | 188.45 | 0 |

The narrow endpoint is consistently ~5–6× faster than full `/predict` at c=10 on the same ambient (cf. table b) — the wave-9b "skip classifier+SHAP" fix is live. The 243 ms/37 rps absolute figure needs a quiet machine; not reachable in this session.

### (d) Cold start (claim: first `/predict` ≈0.5 s; SHAP warm moved to lifespan)

| boot | spawn→`/health` 200 | first `/predict` | second `/predict` | price |
|---|---|---|---|---|
| server1 | not cleanly measurable (poller started late) | **386.7 ms** | 406.2 ms | 151147.74 |
| server2 | **21.5 s** (ambient-loaded; includes artifact load + in-lifespan SHAP build) | **419.4 ms** | 431.4 ms | 151147.74 |

First-request ≈ warm-request on both boots → the one-time SHAP `RegressionExplainer` build no longer lands on the first user request (pre-fix: 3838.7 ms). Note for operators: `/health` readiness now waits for the full warm path — 21.5 s under audit load (likely ~6–8 s quiet; pre-fix startup-to-health was 3.13 s *without* SHAP warm). No claim existed for startup time; recorded for the deployment docs owner.

### (e) SHAP warm latency (claim ≈50 ms; shap.md measured 30.2 ms)

In-process stage profile (`scripts/load_test.py --profile --requests 50`, ambient ~19 %):

```
cold full predict (SHAP singleton build): 3067.0 ms
  build_features     mean=21.713 ms p50=22.608 ms
  ridge_predict      mean=14.971 ms p50=14.173 ms
  rf_predict_proba   mean=586.981 ms p50=552.211 ms   (unpinned profile path — expected, see note)
  shap_explain       mean=23.293 ms p50=22.488 ms p95=40.318 ms
  full_predict       mean=632.159 ms p50=608.317 ms
```

`--profile` loads the champion itself and does **not** apply the lifespan's `force_single_threaded` pin, so the rf stage shows the pre-fix path (known caveat, wave-9b documented the same). The SHAP stage is unaffected by the pin.

**Reconciliation:** "SHAP warm ≈50 ms" (README/SPEC-derived audit baseline) is a loose upper bound. Measured: 22.5 ms p50 here (ambient ~19 %), 30.2 ms p50 by shap.md, wave-9b stage profile 33–38 ms. All comfortably ≤50 ms. shap.md's P3 that `ml/explainability/service.py:24-25`'s "single-digit milliseconds" docstring is wrong is **corroborated** (22–45 ms is not single-digit).

### (f) Reliability — 300 consecutive `/predict` (c=1), RSS of the uvicorn process

| point | RSS MB | peak MB |
|---|---|---|
| before (after ~700 prior requests) | 270.7 | 323.2 |
| after 300 more | **270.6** | **323.2** |

0 errors; block p50s 209 → 348 → 416 ms track ambient load, **not** server state (block A was the 800th+ request of the process and the fastest; RSS flat). Server2 (fresh): 320.5 MB at boot → 342.5 MB after 500 burst requests (one-time step: anyio threadpool/connection state) → **340.9 MB after ~1,900 total requests** — flat after the step. **No leak trend on either process.**

### (g) Burst — 20 rapid bursts of 25 concurrent `/predict` (500 requests)

Server2: 20/20 bursts, **500/500 HTTP 200, 0 errors, 0 HTTP 500**; per-burst p50 6.1–16.5 s (single worker, CPU-saturated queueing + ambient), max 16.8 s — no client timeout at 120 s. Process alive and healthy afterwards. Server1 survived 15/15 bursts (375/375 → 200) before being killed by my own harness output cap (see F1 — **not** a server crash).

### (h) Abuse — 100 invalid requests (422 battery)

5 invalidity classes ×20 at c=10: missing required fields; wrong type (`bedrooms:"three"`); out of range (`bedrooms:99`); invalid literal (`house_style:"Castle"`); unknown neighborhood + forbidden extra field. **100/100 → 422**, p50 63–159 ms under ambient load, RSS 342.7 → 343.2 MB. Error path does no model work and stays fast and flat.

### (i) Large payloads (413)

| body | status | time |
|---|---|---|
| 65,536 B (exactly 64 KiB) | 422 (passes size check, fails validation) | 40.2 ms |
| 65,537 B | **413** | 4.0 ms |
| 200 KiB | 413 | 4.0 ms |
| 1 MiB | 413 | 4.9 ms |
| 1 MiB ×10 rapid | 10/10 413 | p50 5.1 ms, max 27.8 ms |

Boundary exact; rejection happens on `Content-Length` before parsing (`security.py:57-74`). RSS stable. (The known `Transfer-Encoding: chunked` bypass is security.md F2's finding — not re-tested here.)

### (j) Repeated model loading — 10 fresh subprocesses

| metric | min | p50 | max |
|---|---|---|---|
| ridge `joblib.load` | 1.82 s | 2.83 s | 6.23 s |
| classifier `joblib.load` | 0.33 s | 1.07 s | 2.65 s |
| child RSS after load | 217.2 MB | 217.5 MB | 217.8 MB |
| child peak working set | 218.5 MB | 218.8 MB | 219.1 MB |

No growth trend, no caching pathology; time variance tracks ambient CPU. First-iteration ridge load (6.2 s) is cold file-cache; steady-state ~2–3 s.

### (k) Cached GET endpoints under c=50 (×200 each)

| endpoint | errors | p50 ms | rps | c=1 p50 ms |
|---|---|---|---|---|
| `/market/clusters` | 0 | 518.3 | 47.7 | 9.2 |
| `/model/importance` | 0 | 391.4 | 69.5 | 6.1 |
| `/model/info` (bonus) | 0 | 528.7 | 73.2 | — |

c=50 latencies are queueing on the single worker under ambient load; per-request server cost is single-digit ms (c=1). **No file I/O per request:** a psutil `open_files()` watcher sampled the server during 400 requests at c=25 and saw **0 opens** of `feature_importance.json`, cluster artifacts, `champion.json`, or `feature_list.json` (`performance-16b-no-file-io.txt`); statically, both endpoints return startup-cached `app.state` payloads (`market.py:20`, `model.py:101-104`, built at `main.py:137-139`). Wave-9b caching claim **confirmed both ways**.

## Findings

| # | Severity | Location | Finding | Evidence |
|---|---|---|---|---|
| F1 | **P2** | serving stack: `sklearn/utils/parallel.py:143-152` triggered via `/predict` under c=25 concurrency; app-side: no warning filter configured in `backend/app/main.py` | **sklearn UserWarning flood under concurrent `/predict` load (Python 3.14).** Two independent server processes: 0 warnings across ~1,217 requests at c≤10, then a continuous flood during c=25 bursts — 53,111 warnings (16.7 MiB stderr, ~140/request) on server1, 65,592 (20.7 MiB) on server2. Mechanism reproduced in-process: with an emptied context-local warning-filter list (Python 3.14 ContextVar warnings), ONE warm predict emits **1,514** copies of "`sklearn.utils.parallel.delayed` should be used with `sklearn.utils.parallel.Parallel`…" (`parallel.py:143`: warns when `warning_filters` captured at dispatch is empty; capture via `warnings._get_filters()` at `parallel.py:78-81`). With default filters: 0 warnings (sequential, 8 threads, 25 threads, anyio — all clean). The exact agent emptying the filters inside uvicorn request contexts only at high concurrency is **unidentified** (no `resetwarnings`/`catch_warnings` in project code, joblib runtime, or anyio). Functional impact: none (500/500 → 200, no latency blowup attributable to it). Operational impact: ~40 KB stderr per burst-phase request — would fill container logs/disk in production, drowns real log lines, and adds formatting CPU under exactly the high-load moments that matter. Suggested fix direction: pin an explicit ignore filter for this message at app startup (or set `PYTHONWARNINGS`), and/or root-cause the filter-emptying path with sklearn/joblib on 3.14. | `evidence/performance-08b-warning-flood-log-analysis.txt`, `performance-09-warning-repro.txt`, `performance-09b…09e`, `performance-11-burst2.txt` |
| F2 | **P3** | `backend/app/main.py:82-85` vs uvicorn's own loggers | `LOG_LEVEL=WARNING` does not silence uvicorn's access log — `INFO: … "POST /predict HTTP/1.1" 200 OK` lines continued throughout (uvicorn configures `uvicorn.access` independently of the app's `logging.basicConfig`). Ops noise only; deployments expecting WARNING-quiet logs still get one line per request. | server1/2 logs (counts in `performance-08b-warning-flood-log-analysis.txt`) |
| F3 | **P3** | `reports/PERFORMANCE.md` after-fix table; README.md:31,316-319; docs/API.md:24-26; docs/DEPLOYMENT.md:57 | Absolute latency figures (197 ms c=1, 2407 ms c=10, 243 ms/37 rps price, 0.5 s cold) are **quiet-machine numbers with no load qualifier**. Measured 2–3× inflation under concurrent load (my session) — consistent with wave-9b's own contended band, so not a contradiction, but a reader of the docs alone would not learn the load sensitivity. Suggest adding "measured on an otherwise idle machine; single uvicorn worker" to the docs. | tables (a)–(c) above; `docs/audit/docs-truth.md` A12 |

## Contradictions / notes for the orchestrator

1. **None with wave-9b's qualitative claims** — every fix they claimed is verifiably live on the current code (n_jobs=1 pin effect, narrow-endpoint skip, lifespan SHAP warm, cached GETs). Served price byte-identical (151147.74). Absolute latencies differ only under ambient load, exactly as wave-9b documented for their own contended runs. No code regression detected.
2. **SHAP:** claim "~50 ms" vs shap.md 30.2 ms vs mine 22.5 ms — all mutually consistent (upper-bound claim). shap.md's P3 on the "single-digit milliseconds" docstring is corroborated by my measurement.
3. **docs-truth A12** marked the 197 ms / 0.5 s doc quotes "MATCH — statically verified against report's pasted output". My runtime audit: the 0.5 s cold-start claim **reproduces at runtime** (386.7/419.4 ms); the 197 ms warm claim reproduces only in quiet windows (208.97 ms block A) and inflates 2–3× under load — suggest the final audit state the load-conditional nature explicitly.
4. **`logs/predictions.jsonl` churned during the audit without any write from my server** (three hash/size states observed: 48,266 B → 64,532 B → 50,956 B). Other wave-B auditors append to (and restore backups of) the production log. My server's 2,398 prediction records went only to my redirected scratch file (deleted after verification). The production log's current content is an audit-activity mixture — the monitoring/drift auditors should not treat it as clean.
5. **Server1's death was my harness's 16 MiB output cap, not a server crash** — the process was healthy when killed (it was mid-burst-16, all prior 375 burst requests 200). Recorded so nobody reads bursts 16–20's transport errors in `performance-08-burst.txt` as a server failure; the clean redo is `performance-11-burst2.txt`.

## Cleanup verification

- Port 8500: **free** (`netstat` — no LISTENING), no leftover uvicorn processes (`performance-19-cleanup.txt`).
- `logs/predictions.jsonl`: never written by my server (`PREDICTION_LOG_PATH` redirect; 2,398 records landed in the scratch file). Byte-restore not applicable — the file's changes during my session predate/concur with other auditors' servers, not mine (baselines recorded in `performance-01-env.txt` / `performance-19-cleanup.txt`).
- Transient artifacts deleted: server2 output log (20.7 MB), scratch prediction log (6.4 MB), t0 marker, raw ambient-sample files (summaries kept inline in the run evidence files).
- No project source/config/docs modified. Writes: this report + `docs/audit/evidence/performance-*.txt` only.

## Evidence index (`docs/audit/evidence/`)

| file | content |
|---|---|
| `performance-01-env.txt` | hardware/OS/versions, ambient sample, port check, predictions.jsonl baseline |
| `performance-02-coldstart.txt` / `performance-10-coldstart2.txt` | two fresh-boot cold-start measurements |
| `performance-03*.txt` | `/predict` c=1 ×3 attempts (03c instrumented with during-run ambient samples) |
| `performance-04-predict-c10.txt` | `/predict` c=10 ×200 + ambient summary |
| `performance-05*.txt`, `performance-17-final-latency-retry.txt` | `/predict/price` c=10 ×3 attempts + final c=10 retry |
| `performance-06-shap-profile.txt` | in-process stage profile (SHAP warm p50 22.5 ms) |
| `performance-07-reliability-300.txt` | RSS before/after + three 100-request blocks |
| `performance-08-burst.txt`, `performance-11-burst2.txt` | burst attempt 1 (harness-killed) + clean 20/20 redo |
| `performance-08b-warning-flood-log-analysis.txt` | F1 log forensics (counts, line correlation, bucket distribution) |
| `performance-09*.txt` | F1 mechanism repros (0-warning controls; 1,514-warning trigger) |
| `performance-12-abuse-422.txt` | 422 battery ×100 + RSS |
| `performance-13-payload-413.txt` | 413 boundary + 1 MiB rejects + RSS |
| `performance-14-model-reload.txt` | 10× fresh-subprocess champion loads |
| `performance-15-gets-c50.txt`, `performance-16-gets-c1.txt`, `performance-16b-no-file-io.txt` | cached GET load + open-files watcher |
| `performance-18-rss-final.txt` | server2 final RSS/peak + lifetime warning/request counts |
| `performance-19-cleanup.txt` | port free, no leftover processes, log-hash provenance |
