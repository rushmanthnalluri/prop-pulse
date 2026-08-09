# Forensic Audit — llba-backend (`backend/app/**`)

- **Agent:** llba-backend (wave A, line-by-line)
- **Date:** 2026-08-07 · **Method:** full read of every line + independent execution (in-process `TestClient`, **no ports bound**, no project files written; all apps used tmp prediction logs)
- **Scope:** all 20 files under `backend/app/` — 1,504 substantive lines (15 code files + 5 one-line `__init__.py`)
- **Environment notes:** ambient CPU load from concurrent auditors observed; no timing assertions made. Another auditor's live server appended to `logs/predictions.jsonl` during my window (13:02–13:11 UTC); verified my runs did **not** write there (my tmp-log record timestamp `13:09:32.922294` has 0 occurrences in the project log).
- **Existing suite re-run:** `.venv/Scripts/python.exe -m pytest backend/tests -q` → **35 passed in 35.00s** (evidence: `llba-backend-pytest.txt`). Previous QA "PASS" confirmed for what the suite covers — but the suite does not cover findings F1–F3 below.

## Verdict

Core serving logic is solid: lifespan ordering, threshold sourcing, feature-order, thread-safety, `force_single_threaded`, error shapes, and header coverage all **verified by execution**. Three real defects the previous QA missed: **F1** (NaN/Inf JSON → 500 instead of 422), **F2** (`/metrics` never counts unhandled 500s), **F3** (unbounded `requests_by_path`).

## Findings

| # | Severity | Location | Description | Evidence |
|---|----------|----------|-------------|----------|
| F1 | **P2** (top of class; re-rate candidate) | `backend/app/main.py:194` (no `RequestValidationError` handler registered); trigger via any constrained numeric field, e.g. `schemas/property.py:80` | **NaN/Inf in incoming JSON → 500, not 422.** Python's `json.loads` accepts `NaN`/`Infinity`/`1e400`; pydantic correctly rejects them, but the error dict echoes `input: nan/inf` and FastAPI's default 422 handler crashes serializing it (`ValueError: Out of range float values are not JSON compliant` — Starlette renders with `allow_nan=False`). Result: generic 500 + full ERROR traceback server-side, for *trivially reproducible bad input*; violates SPEC §8 "422 with field details for bad input"; also invisible to `/metrics` (compounds F2). 7/7 variants reproduced (NaN/±Inf/overflow in `lot_frontage`, `gr_liv_area`, `garage_area`, `mas_vnr_area`). No internals leaked in the response body. Fix: register a `RequestValidationError` handler that sanitizes non-finite `input` values. | `llba-backend-api-runtime.txt` (search "NaN lot_frontage: -> 500" + the ValueError chain) |
| F2 | **P2** | `monitoring/middleware.py:20-33` + `main.py:174-187` | **`/metrics` never counts unhandled-exception 500s.** Starlette's `ServerErrorMiddleware` sits outside the user middleware stack, so the exception propagates through `MetricsMiddleware.dispatch` (`call_next` raises) and `record_request` is never reached: `requests_total` unchanged, `errors_total` stays 0. Verified: before/after a forced 500, `errors_total` 0→0 and `/_llba_boom2` absent from `requests_by_path`; the +1 delta is only the `/metrics` self-count. Meanwhile HTTPException 503s (handled by the inner `ExceptionMiddleware`) **are** counted (errors_total 0→1) — inconsistent semantics, and `docs/API.md:116` ("errors_total counts only responses with status ≥ 500") is misleading: the most severe errors never register. | `llba-backend-api-runtime.txt`, `llba-backend-services.txt` |
| F3 | **P2** | `monitoring/middleware.py:29`, `services/monitoring_service.py:42` | **Unbounded `requests_by_path` cardinality.** The raw `request.url.path` is recorded for *every* request including 404 probes; the dict grows without bound for the process lifetime — unauthenticated, trivially fuzzable slow memory growth. Verified: one GET of `/no-such-route-llba` created a permanent entry. | `llba-backend-api-runtime.txt` ("404 path recorded …: True") |
| F4 | **P3** | `security.py:57-74` | **Chunked-transfer bypass of the 64 KiB body limit — confirmed live.** A >64 KiB JSON body sent chunked (no `Content-Length`) was accepted and served 200. This is a *documented* residual risk (`security.py:51-54`, `reports/SECURITY.md:261-262`) — but the prescribed mitigation is absent from the project's own proxy: `docker/nginx.conf` has **no `client_max_body_size`** (grep, 2026-08-07). Reconcile with llba-frontend-infra. | `llba-backend-api-runtime.txt` ("chunked >64KiB … BYPASS (accepted)") |
| F5 | **P3** | `main.py:174-187` (middleware add-order) | **500 responses carry no CORS headers** (`Access-Control-Allow-Origin: None` verified) because `CORSMiddleware` is inside `ServerErrorMiddleware`; a cross-origin browser client cannot even read the 500 status. Security headers *are* present (attached explicitly at `main.py:206`). | `llba-backend-api-runtime.txt` |
| F6 | **P3** | `schemas/property.py:94-96` vs `:127` | **`sale_date` is unbounded** while the equivalent `yr_sold` override is constrained to 2006–2026: `sale_date` 1800-01-01 and 2030-12-31 both validate and silently set `YrSold`/`MoSold` far outside the 2006–2010 training range (silent extrapolation). | `llba-backend-misc.txt` |
| F7 | **P3** | `monitoring/middleware.py:31-32` | **The only silent exception swallow in the backend:** metrics-recording failure is `except Exception: pass` with no log, inconsistent with the other two best-effort paths which warn (`api/predict.py:55`, `monitoring/prediction_log.py:69` — both verified emitting warnings). | `llba-backend-static-grep.txt` |
| F8 | **P3** | `api/predict.py:45` | Logged `payload` is `model_dump(mode="json", exclude_none=True)` — **includes server defaults the client never sent** (e.g. `house_style`, `pool_area`), unlike `to_serving_payload()` which uses `exclude_unset=True`. Harmless for drift (PSI runs over `features`), but SPEC §10's "payload: {<PropertyInput fields>}" reading should be pinned down. | `llba-backend-api-runtime.txt` ("log payload keys") |
| F9 | **P3** | `api/model.py:86,92` | `/model/info` and `/model/importance` have **no `response_model`** — payloads served unvalidated; `load_model_importance` checks only that `importance` is a non-empty dict, not that values are numeric. | static |
| F10 | **P3** | `services/monitoring_service.py:66-75` | `snapshot()` holds `_lock` while `latest_drift_summary()` does **disk I/O inside the critical section** — a stalled filesystem blocks `record_request` for all in-flight requests. Minor in practice. | static |
| F11 | **P3** | `services/prediction_service.py:197` | Latent: if `classes_` ever lacked `1`, `_probability` silently serves `proba[-1]` instead of failing. Current champion verified `predict_proba` shape (n,2) with class 1 present — fallback unreachable today. | `llba-backend-force-single-threaded.txt` |
| F12 | **P3** | `config.py:28` | `env_file=".env"` is **CWD-relative** — starting uvicorn from anywhere but the repo root silently skips `.env` (defaults/env vars still apply; artifact paths still resolve via `REPO_ROOT`). | static |

**Notes, not defects:** `/docs` + `/openapi.json` exposed — documented and accepted (`reports/SECURITY.md:266`). `central_air` accepts pydantic-lax bools (`"yes"`→True, verified) — standard coercion. Missing `champion.json` at startup raises raw `FileNotFoundError` (vs. the curated `RuntimeError` for missing model files) — fail-fast either way; verified. Narrow endpoints log `null` for the skipped value — documented in `_log_prediction` docstring; **orchestrator:** confirm `ml/monitoring/drift_check` tolerates null `estimated_price`/`probability` (llba-ml-services/monitoring scope).

## Verified claims (hunt list)

| Claim | Verdict | Evidence |
|---|---|---|
| Lifespan ordering (nothing used before loaded) | PASS — statically verified: all `app.state` writes (`main.py:107-132`) precede the cached-payload builds (`:137-139`) and SHAP warm (`:145-153`); fail-fast `RuntimeError` on missing artifacts verified by execution; missing `champion.json` → `FileNotFoundError` at startup | `llba-backend-misc.txt` |
| `app.state` cache staleness/consistency | PASS — caches built once from the same startup load; `/model/info` deep-copies champion (`api/model.py:29`); restart-required semantics documented (`api/model.py:2-5`, `main.py:134-136`); suite proves cache immunity to post-startup tampering | `backend/tests/test_latency_fixes.py:200-215` (re-run green) |
| `force_single_threaded` reaches RFs inside `CalibratedClassifierCV` fold pipelines | **PASS — verified by execution**: my independent walker found all 13 reachable `n_jobs` objects (5 fold RFs + unfitted template RF + ColumnTransformers + the `CalibratedClassifierCV` itself) pinned `-1/None → 1`; served in-app instance confirmed `[1,1,1,1,1]` + template 1; predictions identical at served precision (max diff 3.3e-16 = 1 ULP); cycle-guard and `'drop'`-string edge cases pass | `llba-backend-force-single-threaded.txt`, `llba-backend-services.txt` |
| `_explain` try/except → `[]` — is failure logged? | PASS — verified by execution: forced `explain_instance` failure → 200, `top_price_factors == []`, **and** WARNING emitted (`prediction_service.py:218`) | `llba-backend-services.txt` |
| Prediction-log write failures | PASS — verified: unwritable path → `log()` returns `False`, no raise, WARNING with path emitted (`prediction_log.py:69`); endpoint still 200; wrapper catch at `api/predict.py:54-55` also warns | `llba-backend-services.txt` |
| JSONL writer thread-safety | PASS — verified: 8 threads × 25 writes → 200/200 valid JSON lines, 0 exceptions, lock held around mkdir+open+write (`prediction_log.py:63-66`) | `llba-backend-services.txt` |
| Config env parsing | PASS — verified: CORS split trims/drops empties, `""`→`[]`, env var overrides default, `_resolve` relative→`REPO_ROOT` / absolute passthrough | `llba-backend-services.txt` |
| Response-model validation gaps | PASS WITH CONCERN — all predict/health/metrics/market endpoints validated (runtime shapes verified); `/model/info`+`/model/importance` unvalidated (F9) | `llba-backend-api-runtime.txt` |
| Status codes & error shapes (no stack traces) | PASS WITH CONCERN — 422/404/413/503/500 all `{"detail": …}`, no tracebacks, no fs-path leaks, verified live; **except F1** (NaN/Inf → 500) | `llba-backend-api-runtime.txt` |
| Narrow-endpoint skip (`/predict/price` skips classifier AND SHAP) | PASS — verified by independent call-count spies: price → classifier 0 / SHAP 0 / regressor 1; sale-probability → 1/0/0; full → 1/1/1; values match full `/predict` exactly | `llba-backend-services.txt` |
| Middleware ordering (security headers on error responses too) | PASS — verified on 200/404/413/422/503/500 (500 via explicit attach, `main.py:206`); CORS missing on 500 only (F5) | `llba-backend-api-runtime.txt` |
| Body-size limit (chunked bypass) | Documented residual risk — bypass confirmed live (F4) | `llba-backend-api-runtime.txt` |
| NaN/Inf in incoming JSON | **FAIL → F1** (rejected, but as 500 not 422) | `llba-backend-api-runtime.txt` |
| Threshold from `champion.json`, not hardcoded | PASS — grep: no `0.203292` literal anywhere in `backend/app`; sourced at `main.py:126`; runtime equality 0.203292 verified; boundary comparison `>=` correct (`0.219263 >= 0.203292 → true`) | `llba-backend-static-grep.txt`, `llba-backend-api-runtime.txt` |
| Feature-row construction order == MODEL_FEATURES | PASS — verified: logged `features` key order == `feature_list.json` (94 features); `build_feature_frame` returns `out[MODEL_FEATURES]` (`ml/features/pipeline.py:486`) | `llba-backend-api-runtime.txt` |
| SHAP explainer warmed at startup | PASS — `ml.explainability.service._explainer is not None` immediately after lifespan; warm-up failure path logs warning and never blocks startup (`main.py:152-153`, static) | `llba-backend-services.txt` |
| No `print()` in library code | PASS — grep clean | `llba-backend-static-grep.txt` |
| `MicroMarket` response keys all provided by cluster lookup | PASS — `_payload` (`ml/clustering/serve.py:151-167`) supplies all 12 required keys; `/predict` 200 validated by response_model | `llba-backend-api-runtime.txt` |

## Per-file reviewed-line table

| File | Lines | Read | Verdict |
|---|---|---|---|
| `main.py` | 212/212 | every line | PASS WITH CONCERN (F1, F5) |
| `config.py` | 83/83 | every line | PASS WITH CONCERN (F12) |
| `security.py` | 74/74 | every line | PASS WITH CONCERN (F4 documented) |
| `api/deps.py` | 49/49 | every line | PASS |
| `api/health.py` | 29/29 | every line | PASS |
| `api/market.py` | 20/20 | every line | PASS |
| `api/model.py` | 104/104 | every line | PASS WITH CONCERN (F9) |
| `api/predict.py` | 169/169 | every line | PASS WITH CONCERN (F8) |
| `schemas/property.py` | 147/147 | every line | PASS WITH CONCERN (F1 trigger surface, F6) |
| `schemas/responses.py` | 119/119 | every line | PASS |
| `services/cluster_service.py` | 88/88 | every line | PASS |
| `services/monitoring_service.py` | 76/76 | every line | PASS WITH CONCERN (F3 sink, F10) |
| `services/prediction_service.py` | 231/231 | every line | PASS WITH CONCERN (F11 latent) |
| `monitoring/middleware.py` | 33/33 | every line | **FAIL** (F2, F3 source, F7) |
| `monitoring/prediction_log.py` | 70/70 | every line | PASS |
| 5 × `__init__.py` | 1 each | docstring only | PASS |

## Per-function matrix

| Function (file:lines) | Inputs / validation | Side effects | Error handling | Test coverage | Status |
|---|---|---|---|---|---|
| `_load_champion` (main.py:67-70) | `Settings`; path from config | reads `champion.json` | raw `FileNotFoundError`/`JSONDecodeError` at startup (fail-fast) | indirect via suite | PASS — exec (missing-file case in `llba-backend-misc.txt`) |
| `_resolve_artifact` (main.py:73-76) | repo-relative str → `Path|None` | none | `None` on missing → curated `RuntimeError` | indirect | PASS — exec |
| `create_app`/`lifespan` (main.py:79-209) | optional `Settings` injection | loads all artifacts into `app.state`; warms SHAP; `logging.basicConfig` at import | missing artifacts → `RuntimeError`; SHAP warm best-effort + warning | 35/35 suite green | PASS — exec (ordering, warm, fail-fast) |
| `unhandled_exception_handler` (main.py:194-207) | any `Exception` | logs `logger.exception`; 500 JSON + explicit `SECURITY_HEADERS` | n/a | `test_unhandled_exception_500_shape` | PASS — exec (no leak, headers on; CORS absent = F5) |
| `Settings._resolve`/4 `resolved_*` props (config.py:46-70) | str paths | none | n/a | — | PASS — exec |
| `cors_origin_list` (config.py:72-77) | comma-str | none | empties dropped | — | PASS — exec |
| `get_settings` (config.py:80-83) | env + CWD-relative `.env` (F12) | `lru_cache(1)` | n/a | — | PASS WITH CONCERN |
| `deps.*` 6 accessors (deps.py:22-49) | `Request` | none; `model_version_payload` copies dict | `AttributeError` if lifespan skipped (prod-impossible) | indirect | PASS — static |
| `health` (health.py:15-21) | — | none | n/a | `test_health` | PASS — exec |
| `metrics` (health.py:24-29) | DI service | none | n/a | `test_metrics` | PASS — exec (but see F2/F3 on the sink) |
| `market_clusters` (market.py:13-20) | — | serves startup cache | n/a | `test_market_clusters` | PASS — exec |
| `build_model_info_payload` (model.py:19-58) | state | deep-copies champion | `.get` defaults throughout | `test_model_info` | PASS — exec |
| `load_model_importance` (model.py:61-83) | dir path | reads JSON once | OSError/JSONDecodeError → error-state dict; class name only, no path leak | `test_model_importance_missing_artifact_503` | PASS — exec (503 replay verified w/ headers) |
| `model_info` / `model_importance` (model.py:86-104) | — | serve cache | 503 on cached error state | yes | PASS WITH CONCERN (F9) |
| `_log_prediction` (predict.py:29-55) | payload+row+results | JSONL append via logger | broad except → **warning** (verified); F8 dump semantics | `test_prediction_log_schema` | PASS — exec |
| `_run_prediction` (predict.py:58-83) | validated `PropertyInput` | predict + cluster + log | `ValueError`→422; other exceptions → generic 500 | suite | PASS — exec |
| `predict` / `predict_price` / `predict_sale_probability` (predict.py:86-169) | schema-validated body | log | 422 mapping verified; skip-logic spy-verified | 35/35 | PASS — exec |
| `known_neighborhoods` (property.py:52-56) | — | reads geo CSV once (`keep_default_na=False`, cached) | raw raise at import-time of first validation | via suite | PASS — exec (25 hoods; case-sensitive reject) |
| `_neighborhood_must_be_known` (property.py:129-138) | str (whitespace-stripped) | none | `ValueError` → 422, lists valid set, no fs leak | yes | PASS — exec |
| `to_serving_payload` (property.py:140-147) | — | none | n/a | — | PASS — exec (unset/None excluded; `sale_date` stays `date`, handled by serving layer) |
| 11 response models (responses.py) | — | — | pydantic validation | via suite | PASS |
| `SecurityHeadersMiddleware.dispatch` (security.py:40-45) | — | `setdefault` headers | n/a | `test_security_headers_*` | PASS — exec on 200/404/413/422/503 |
| `BodySizeLimitMiddleware.dispatch` (security.py:57-74) | `Content-Length` int parse | 413 short-circuit | malformed header → treated 0 (commented); chunked bypass documented (F4) | `test_oversized_body_rejected_413`, boundary test | PASS — exec (413 + boundary + bypass confirmed) |
| `ClusterService.__init__/lookup/market_clusters` (cluster_service.py:25-88) | lookup + geo CSV | none after init | raw raise on bad CSV at startup | via suite | PASS — exec (`/market/clusters` 200, 25 points) |
| `MonitoringService.record_request` (monitoring_service.py:38-45) | path/status/latency | locked counter updates (F3 unbounded keys) | none needed | `test_metrics` | PASS WITH CONCERN |
| `latest_drift_summary` (monitoring_service.py:47-62) | — | disk read per call | missing/malformed/non-dict → `no_data`; exception **not** echoed (path-leak conscious) | — | PASS — exec (all 4 branches) |
| `snapshot` (monitoring_service.py:64-76) | — | locked read + disk I/O in lock (F10) | n/a | `test_metrics` | PASS WITH CONCERN |
| `force_single_threaded` (prediction_service.py:45-76) | any estimator graph | mutates in-memory model | frozen-estimator pin failure → `logger.debug` (acceptable) | 2 dedicated tests | PASS — exec (deep verification) |
| `PredictionService.__init__` (prediction_service.py:123-136) | models/stats/threshold/interval | stores; floats coerced | `KeyError` on malformed interval (startup-time) | via suite | PASS |
| `build_features` (prediction_service.py:138-146) | serving dict | none | `ValueError` propagates → 422 | via suite | PASS — exec |
| `predict`/`predict_price`/`predict_sale_probability` (prediction_service.py:148-183) | payload dict | rounding (2/6 dp) | via `_explain` guard | via suite | PASS — exec |
| `_price` (prediction_service.py:185-191) | feature frame | none | theoretical `expm1` overflow → inf → response-validation 500 (inputs bounded by schema; not reproduced) | via suite | PASS |
| `_probability` (prediction_service.py:193-197) | feature frame | none | F11 latent fallback | via suite | PASS WITH CONCERN |
| `_explain` (prediction_service.py:199-219) | feature frame | lazy import | broad except → `[]` **+ warning** (verified) | — | PASS — exec |
| `_json_safe_row` (prediction_service.py:222-231) | 1-row frame | none | numpy→python; non-finite → `None` (log-safe) | `test_prediction_log_schema` | PASS — exec (order == feature_list) |
| `MetricsMiddleware.dispatch` (middleware.py:20-33) | — | counter update post-response | **F2**: exception in `call_next` skips recording; **F7**: silent `except: pass` | — | **FAIL** |
| `PredictionLogger.__init__/log_path/log` (prediction_log.py:36-70) | record dicts | locked append, mkdir on demand | all failures → `False` + **warning** (verified) | via suite + my thread test | PASS — exec |

## Items the orchestrator must reconcile

1. **F1 severity/ownership** — fix belongs in `main.py` (register a `RequestValidationError` handler); I rate it top-of-P2, arguable P1 under rubrics that count "unauthenticated remote 500 + log spam + metrics evasion" as major.
2. **F2 vs `docs/API.md:116`** ("errors_total counts only responses with status ≥ 500") — docs-truth agent should note the doc is misleading; fix options: move metrics recording into the 500 handler or document "completed requests only".
3. **F4 vs `docker/nginx.conf`** — the documented proxy-side mitigation (`client_max_body_size`) is absent; llba-frontend-infra/devops scope.
4. **F8** — SPEC §10 log `payload` semantics (verbatim client fields vs. post-default dump) needs a ruling; drift impact nil.
5. **Narrow-endpoint nulls** — `_log_prediction` logs `null` for the skipped value; confirm `ml/monitoring/drift_check` null-tolerance (claimed in `predict.py:41` docstring).
6. **Ambient write activity** — `logs/predictions.jsonl` received 8 appends (13:02–13:11 UTC) from another auditor's live server while wave A was running; not mine (verified). If wave A assumed a static file, re-check those conclusions.

## Evidence files (`docs/audit/evidence/`)

- `llba-backend-force-single-threaded.txt` — script + output: n_jobs inventory before/after, prediction identity, walker edge cases
- `llba-backend-api-runtime.txt` — script 2 output: endpoints, error shapes, headers, chunked, NaN/Inf 500s, CORS, metrics blind spot, 503 (full tracebacks included)
- `llba-backend-services.txt` — script 3 output: spies, swallow paths, thread-safety, config, schema units
- `llba-backend-misc.txt` — script 4 output: lifespan fail-fast, sale_date bounds, drift branches
- `llba-backend-static-grep.txt` — threshold/print/except greps, `__init__` contents
- `llba-backend-pytest.txt` — `pytest backend/tests -q` → 35 passed
- `llba-backend-script{2,3,4}.py.txt` — exact repro scripts
