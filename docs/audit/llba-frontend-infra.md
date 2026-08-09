# Forensic Audit — llba-frontend-infra

**Date:** 2026-08-07 · **Agent:** llba-frontend-infra · **Mode:** report-only (no project files modified)
**Scope:** `frontend/src/**`, `scripts/load_test.py`, `scripts/audit_reproducibility.py`, `e2e/playwright.config.js`, `e2e/tests/dashboard.spec.js`, `docker/*`, `docker-compose*.yml`, `.github/workflows/ci.yml`, `pytest.ini`, `conftest.py`, `.env.example`, `requirements.txt`, `backend/requirements.txt`, `frontend/package.json`, `frontend/vite.config.js`, `frontend/index.html` (plus `.dockerignore`, `e2e/package.json` as context).

**Verdict: no P0/P1 defects found.** Previous QA's PASS is substantially confirmed by independent execution. One P2 consistency defect (shipped compose override vs documented ports / CI claim) and ten P3 hardening/cosmetic findings.

Evidence files (all commands run from repo root unless noted):

| File | Contents |
|---|---|
| `docs/audit/evidence/llba-frontend-infra-01-frontend-checks.txt` | eslint clean (exit 0); `npm ci --dry-run` OK (lockfile↔package.json in sync) |
| `docs/audit/evidence/llba-frontend-infra-02-build.txt` | `vite build` to temp dir: exit 0, 763 modules, lazy chunks `MarketMap-*.js`/`ModelInsights-*.js`/`useApi-*.js` emitted (code-splitting works), fingerprinted `assets/` names |
| `docs/audit/evidence/llba-frontend-infra-03-format.txt` | `format.js` edge-case battery executed in node 24 (null/undefined/NaN/Infinity/strings/negatives) |
| `docs/audit/evidence/llba-frontend-infra-04-load-test.txt` | `percentile()` == numpy linear method at p0/1/25/50/90/95/99/100; zero-request summary has no div-by-zero; payload resolution; Git Bash path guard exits 2 |
| `docs/audit/evidence/llba-frontend-infra-05-repro-audit.txt` | `audit_reproducibility.py` read-only steps executed: seed_audit PASS (19 anchored, 0 exceptions), dependency_pins PASS (21+14 pinned, `pip check` clean); non-cp1252 source scan |
| `docs/audit/evidence/llba-frontend-infra-06-infra.txt` | `docker compose config -q` exit 0; merged ports 18000/18080 vs base-only 8000/8080 (override auto-merges); override NOT in `.gitignore`; live `nginx:alpine` 1.31.3 mime.types check; 21/21 requirement pins match `.venv` |
| `docs/audit/evidence/llba-frontend-infra-07-ci-and-scans.txt` | PyPI `requires_python` + cp312 wheel counts for all binary pins (CI 3.12 installability); XSS-pattern scan of `frontend/src` (clean); dead-CSS-class check |

---

## 1. Per-file review table

| File | Lines | Reviewed | Status |
|---|---:|---:|---|
| `frontend/src/App.jsx` | 30 | 30/30 | PASS — statically verified |
| `frontend/src/api/client.js` | 75 | 75/75 | PASS — statically verified |
| `frontend/src/api/useApi.js` | 30 | 30/30 | PASS — statically verified |
| `frontend/src/components/FactorBars.jsx` | 37 | 37/37 | PASS — statically verified |
| `frontend/src/components/Layout.jsx` | 113 | 113/113 | PASS — statically verified |
| `frontend/src/components/PriceBand.jsx` | 26 | 26/26 | PASS — statically verified |
| `frontend/src/components/ProbabilityGauge.jsx` | 43 | 43/43 | PASS — statically verified |
| `frontend/src/components/StatCard.jsx` | 10 | 10/10 | PASS — statically verified |
| `frontend/src/components/StateView.jsx` | 34 | 34/34 | PASS — statically verified |
| `frontend/src/constants.js` | 132 | 132/132 | PASS — verified by execution (cross-checked vs backend schema + geo CSV) |
| `frontend/src/format.js` | 73 | 73/73 | PASS WITH CONCERN — verified by execution (F6) |
| `frontend/src/main.jsx` | 11 | 11/11 | PASS — statically verified |
| `frontend/src/pages/MarketMap.jsx` | 148 | 148/148 | PASS — statically verified |
| `frontend/src/pages/ModelInsights.jsx` | 267 | 267/267 | PASS WITH CONCERN — dead 404 branch (F2) |
| `frontend/src/pages/Valuation.jsx` | 304 | 304/304 | PASS WITH CONCERN — missing `step` on float fields (F7) |
| `frontend/src/styles.css` | 938 | key layout/responsive blocks line-level; remainder rule-by-rule scan | PASS WITH CONCERN — dead classes (F8) |
| `scripts/load_test.py` | 349 | 349/349 | PASS WITH CONCERN — verified by execution (F5) |
| `scripts/audit_reproducibility.py` | 483 | 483/483 | PASS WITH CONCERN — steps 4+6 verified by execution; steps 1–3 NOT EXECUTABLE here (mutating retrain; prior full-run evidence in `reports/REPRODUCIBILITY.md`); F3/F4 |
| `e2e/playwright.config.js` | 25 | 25/25 | PASS — statically verified |
| `e2e/tests/dashboard.spec.js` | 189 | 189/189 | PASS — statically verified (runtime re-verified by wave-B blackbox agent) |
| `docker/backend.Dockerfile` | 75 | 75/75 | PASS — statically verified; build+smoke evidence `reports/DOCKER_SMOKE.md` |
| `docker/frontend.Dockerfile` | 41 | 41/41 | PASS WITH CONCERN — nginx runs as root (F10) |
| `docker/nginx.conf` | 26 | 26/26 | PASS WITH CONCERN — index.html caching (F9); gzip verified by execution |
| `docker-compose.yml` | 81 | 81/81 | PASS — `docker compose config` verified by execution |
| `docker-compose.override.yml` | 37 | 37/37 | **FAIL (consistency)** — F2/P2: shipped file auto-merges, contradicts docs |
| `.github/workflows/ci.yml` | 68 | 68/68 | PASS WITH CONCERN — validates merged compose only (part of F1); 3.12 installability verified via PyPI metadata |
| `pytest.ini` | 5 | 5/5 | PASS — statically verified |
| `conftest.py` | 15 | 15/15 | PASS — statically verified |
| `.env.example` | 36 | 36/36 | PASS — statically verified (no secrets; keys map to `Settings` fields) |
| `requirements.txt` | 36 | 36/36 | PASS — verified by execution (21/21 pins == `.venv`; cp312 wheels exist) |
| `backend/requirements.txt` | 17 | 17/17 | PASS — statically verified (subset of root pins; mlflow correctly absent — `ml/tracking.py:51,71,81` import mlflow lazily) |
| `frontend/package.json` | 30 | 30/30 | PASS — verified by execution (`npm ci --dry-run`, build) |
| `frontend/vite.config.js` | 14 | 14/14 | PASS — statically verified (dev :5173 / preview :4173 match CORS defaults) |
| `frontend/index.html` | 17 | 17/17 | PASS — statically verified (`#root` present, `favicon.svg` exists in `public/`) |
| `.dockerignore` (context) | 50 | 50/50 | PASS — `!data/processed/train.csv` re-inclusion verified end-to-end by `reports/DOCKER_SMOKE.md` §2 |

---

## 2. Function matrix — frontend JS/JSX

| Function (file:line) | Inputs | Validation | Side effects | Branches / error handling | Returns | Edge cases | Status |
|---|---|---|---|---|---|---|---|
| `withSuspense` (App.jsx:13) | element | n/a | none | Suspense fallback `<Loading/>` | JSX | lazy chunk failure has no error boundary — browser-level error | PASS |
| `App` (App.jsx:28) | — | — | RouterProvider | catch-all `*` → ValuationPage | JSX | deep links need SPA fallback → present in nginx.conf:18 | PASS |
| `ApiError` (client.js:14) | message, status | — | — | carries HTTP status; network failure = 0 | Error | — | PASS |
| `extractDetail` (client.js:23) | payload, fallback | null-guard, typeof/Array checks | none | string detail / 422 detail list / fallback | string | `loc` minus `'body'`; non-string items degrade to `item.msg` possibly undefined → "undefined" in message (cosmetic only; FastAPI always sends msg) | PASS |
| `request` (client.js:37) | path, options | — | `fetch` | transport catch → ApiError(0); **unguarded JSON.parse is guarded** (50–58); !ok → ApiError(status) | parsed payload or null | 204/empty body → null (callers tolerate: health checks `body && body.status`) | PASS |
| `api.*` (client.js:68) | — | — | — | root-level routes match backend routers (verified health/predict/model/market/metrics files) | Promises | — | PASS |
| `useApi` (useApi.js:9) | fetcher (memoized) | JSDoc warns to memoize | setState | cancelled-flag cleanup prevents stale setState (14,23–25); reload bumps key | `{data,loading,error,reload}` | all 4 callers wrap fetcher in `useCallback` (MarketMap.jsx:29, ModelInsights.jsx:216–218) ✓; keeps stale data while reloading (deliberate) | PASS |
| `FactorBars` (FactorBars.jsx:8) | factors[] | null/empty → null render | none | `max` floor 1e-9 (10); width floor 4% (15) | JSX/null | magnitude share 0–1 (verified vs `ml/explainability/service.py:20,112`) → `formatPct` semantically right; NaN magnitude → NaN% width (API guarantees float) | PASS |
| `BrandMark` (Layout.jsx:12) | — | — | — | — | SVG | aria-hidden ✓ | PASS |
| `ApiStatus` (Layout.jsx:45) | — | — | polls `/health` + 30 s interval | cancelled flag + `clearInterval` cleanup ✓; non-'ok' body → 'down' | JSX | matches backend `{"status":"ok"}` (health.py:19) ✓; StrictMode double-mount safe (cleanup runs) | PASS |
| `Layout` (Layout.jsx:76) | — | — | — | NavLink `end` only on `/` ✓ | JSX | footer carries ADR-3 simulation disclaimer ✓ | PASS |
| `PriceBand` (PriceBand.jsx:7) | low, high, estimate | span ≤ 0 → marker 50% | none | marker clamped 0–100 (9) | JSX | "~80% prediction interval" caption consistent with champion test coverage 0.7829 (champion.json:22) ✓ | PASS |
| `ProbabilityGauge` (ProbabilityGauge.jsx:7) | probability, threshold, flag | both clamped 0–100 (8–9) | none | `role="meter"` + aria-valuemin/max/now ✓ | JSX | threshold marker position = threshold×100 — correct; label can overflow at extremes (cosmetic) | PASS |
| `StatCard` (StatCard.jsx:2) | label, value, hint, tone | hint conditional | none | tone → modifier class | JSX | only good/bad tones styled; callers use only good/bad/undefined ✓ | PASS |
| `Loading` / `ErrorState` / `EmptyState` (StateView.jsx:3,12,26) | label / error,onRetry / title,detail | `error?.message` fallback | none | role=status / role=alert ✓; retry button conditional | JSX | `role="alert"` is what e2e test 2/5 locate ✓ | PASS |
| `buildColorMap` (MarketMap.jsx:19) | clusters[] | Set-dedupe | none | numeric sort → stable colors; palette modulo | map | cluster_ids from backend are ints (cluster_service.py:56) ✓ | PASS |
| `MarketMapPage` (MarketMap.jsx:28) | — | loading/error/empty states all rendered | fetch via useApi | marker color fallback `#334155` (74); `cluster &&` guard (87); `data.neighborhoods.length===0` empty state (59) | JSX | key=neighborhood (unique ✓); AMES_CENTER = ADR-2 city center ✓; map height set (styles.css:764) ✓; popup dl stats guarded | PASS |
| `Section` (ModelInsights.jsx:23) | title, sub | sub conditional | none | — | JSX | — | PASS |
| `ChampionCards` (ModelInsights.jsx:35) | info | `\|\| {}` fallbacks on every section | none | rationale `<details>` conditional | JSX | keys verified vs `build_model_info_payload` (model.py:32–58) + champion.json (name/version/val_metrics/threshold/n_clusters/selected_at/dataset_version/feature_version all present) ✓ | PASS |
| `ImportanceChart` (ModelInsights.jsx:90) | payload | `payload?.importance \|\| {}`; empty → EmptyState | none | desc → top-20 slice → reverse for recharts bottom-up | JSX | height `max(360, n*28)`; Cell key=prettyFeature — collision possible in theory, not across top-20 in practice | PASS |
| `DriftPanel` (ModelInsights.jsx:140) | metrics | `metrics?.drift \|\| {}`; thresholds `?? 0.1/0.2` | none | no_data → EmptyState; ok → PSI bars; tone good/bad | JSX | keys verified vs live `reports/drift/latest.json` (status, drift_detected, per_feature_psi, warn_threshold, psi_threshold, n_predictions, drifted_features, retraining_recommended, timestamp) ✓; PSI width clamps at 100 ✓ | PASS |
| `ModelInsightsPage` (ModelInsights.jsx:215) | — | per-section loading/error/data states | 3× useApi | **404 special-case is dead — see F2** | JSX | — | PASS WITH CONCERN (F2) |
| `Field` (Valuation.jsx:36) | label, hint | — | none | implicit label-wrapping → Playwright getByLabel works ✓ | JSX | — | PASS |
| `ValuationForm` (Valuation.jsx:46) | onSubmit, submitting | HTML5 required+min/max; submit disabled in flight | local state | advanced ''/null/undefined omitted from payload (68) | JSX | core numbers `Number(...)`-cast (63); **advanced number inputs lack `step` — F7**; disabled submit button also blocks Enter-key implicit submission (HTML spec) → no double-submit path | PASS WITH CONCERN (F7) |
| `MicroMarketCard` (Valuation.jsx:176) | microMarket | `neighborhoods?.join` optional chain | none | fallback badge conditional | JSX | keys match MicroMarket schema (responses.py:31–45) ✓ | PASS |
| `PredictResult` (Valuation.jsx:212) | result | destructure | none | — | JSX | keys match PredictResponse (responses.py:64–72) ✓; exactly-5-factors asserted by e2e | PASS |
| `ValuationPage` `submit`/`reset` (Valuation.jsx:257,267) | payload | — | setState; fetch | loading→result/error; reset = retry path (form values persist) | — | no AbortController — setState after unmount is a harmless no-op in React 19; last-response-wins race unreachable via UI | PASS |
| `formatUsd`/`formatPct`/`formatNumber` (format.js:10,16,22) | value, digits | null/undefined/NaN → '—' | none | — | string | executed battery: strings coerce, Infinity → "$∞"/"Infinity%" (cosmetic), negatives OK | PASS |
| `formatUptime` (format.js:28) | seconds | null/undefined only | none | h/m/s tiers | string | **NaN → "NaNs", -5 → "-5s" — F6** | PASS WITH CONCERN (F6) |
| `prettyFeature` (format.js:64) | name | falsy → '—' | none | KNOWN_LABELS → snake/Camel split | string | regex at :71 is an identity no-op (harmless dead code); number input → "42" (executed) | PASS |

`constants.js` (data module): all 13 categorical sets + 25 neighborhoods verified **identical** to backend Literals (`backend/app/schemas/property.py:26–49`) and `data/external/neighborhood_geo.csv` (25 codes, executed `cut`/`wc` comparison). All min/max in `CORE_FIELDS` + `ADVANCED_FIELDS` match the pydantic `Field(ge=, le=)` constraints one-for-one. `DEFAULT_FORM` = documented form defaults, not prediction data. PASS.

---

## 3. Function matrix — scripts

| Function (file:line) | Inputs | Validation | Side effects | Branches / error handling | Returns | Edge cases | Status |
|---|---|---|---|---|---|---|---|
| `percentile` (load_test.py:68) | sorted list, pct | empty → nan | none | low==high exact hit | float | **executed**: matches numpy linear at 8 percentiles; single-element OK | PASS — verified by execution |
| `RunStats.n/errors` (load_test.py:89,93) | — | — | — | HTTP ≥400 + transport = errors | int | 3xx counts as success (httpx default no-follow) — F5 note | PASS WITH CONCERN (F5) |
| `RunStats.summary` (load_test.py:99) | — | `if self.n`, `if wall_seconds`, `if ordered` guards | none | — | dict | **executed**: zero-request run → no ZeroDivisionError, nan percentiles | PASS — verified by execution |
| `_worker` (load_test.py:122) | client, method, url, payload, remaining, stats | — | mutates stats | transport error → counted, latency still appended — **F5** (failed-request timings pollute percentiles) | None | shared-counter pattern race-safe (single event loop) | PASS WITH CONCERN (F5) |
| `run_load` (load_test.py:146) | base_url, … | `max(1, min(c, requests))` workers | network | warmup sequential, unmeasured ✓ | RunStats | requests=0 → 1 worker exits immediately, clean summary (traced) | PASS |
| `_load_payload_arg` (load_test.py:178) | raw, endpoint | file-exists → file, else inline JSON | reads file | JSONDecodeError propagates (acceptable CLI failure) | dict/None | **executed**: None→default only for `/predict*`; inline OK; bad JSON raises | PASS — verified by execution |
| `_print_report` (load_test.py:188) | … | — | stdout | — | None | nan prints as "nan" | PASS |
| `run_profile` (load_test.py:202) | iterations, payload | `max(1, …)` | loads real artifacts; in-process predicts | cold call measured separately ✓ | dict | writes nothing (logging lives in the API layer, not PredictionService) | PASS — statically verified (heavy path not re-run; artifacts exercised by smoke reports) |
| `main` (load_test.py:271) | argv | argparse + **Git Bash path-rewrite guard (299)** executed → exit 2 | runs load/profile | method default POST iff payload ✓ | None | Ctrl-C: asyncio.run cancels workers, exits non-zero (standard) | PASS — verified by execution |
| `_md5`/`_sha1` (audit_repro:87,90) | path | — | reads | — | hex | — | PASS |
| `_run_module` (audit_repro:95) | module, timeout | timeout | subprocess | `text=True` **without encoding/errors — F4** (locale cp1252 round-trip; safe today: 0 non-cp1252 chars in log lines, evidence 05) | CompletedProcess | — | PASS WITH CONCERN (F4) |
| `_check_proc` (audit_repro:107) | proc, module | returncode | — | tails last 15 lines into RuntimeError | None | — | PASS |
| `step_data_determinism` (audit_repro:113) | — | — | **re-runs data pipeline (mutating)** | md5 before/after | StepResult | NOT EXECUTABLE here (report-only); prior PASS evidence `reports/REPRODUCIBILITY.md` | NOT EXECUTABLE (prior evidence OK) |
| `step_feature_artifacts` (audit_repro:134) | — | — | re-runs feature pipeline | sha1 + feature_version vs champion.json | StepResult | NOT EXECUTABLE here; prior PASS evidence | NOT EXECUTABLE (prior evidence OK) |
| `_val_slice` (audit_repro:165) | — | — | reads | keep_default_na=False ✓ (SPEC §14) | DataFrame | fixed 50-row file-order slice | PASS — statically verified |
| `_diff_metrics` (audit_repro:180) | old, new | type-aware | none | float isclose 1e-9/1e-12; structure strict | yields diffs | `old != new` on floats within tol → soft diff flagged correctly | PASS — statically verified |
| `_backup_tree`/`_restore_tree` (audit_repro:210,216) | paths | — | copy2 | — | None | — | PASS |
| `step_model_reproducibility` (audit_repro:221) | — | — | backs up, **retrains both families**, restores | `except Exception` restores backups — **F3: KeyboardInterrupt/SystemExit bypass restore**; pass-path restores changed bytes ✓; scratch mlruns outside `artifacts/` (mlflow ZDI defense, correct per comment) | StepResult | `_predict` dispatch on "calibrated"/"classification" in path works for both champs; slice built outside try (read-only, fine) | PASS WITH CONCERN (F3) — logic statically verified, full retrain not re-run |
| `step_seed_audit` (audit_repro:367) | — | — | reads ml/** | regex suites for random_state/seed/np.random/.sample/stdlib random | StepResult | **executed → PASS, 19 anchored, 0 exceptions** (evidence 05) | PASS — verified by execution |
| `_requirement_lines`/`step_dependency_pins` (audit_repro:410,418) | — | — | reads; `pip check` subprocess | unpinned → problems; pip rc | StepResult | **executed → PASS: 21+14 pinned, pip check clean** (evidence 05) | PASS — verified by execution |
| `main` (audit_repro:447) | — | — | prints table | step crash → FAIL row (not abort) ✓; exit 0/1 ✓ | int | — | PASS |

---

## 4. Infra directive-level review (key directives)

**`docker/backend.Dockerfile`** — layer order correct (requirements → `pip install` (28–29) *before* source COPYs (36–49) → cache-friendly ✓); non-root `appuser` created + `chown` + `USER` (54–57) ✓; runtime dirs `logs`, `reports/drift` created (55) ✓; no mlflow in backend requirements — safe because `ml/tracking.py` imports mlflow lazily (verified: only local imports at tracking.py:51,71,81; training modules also local-import) ✓; `data/processed/train.csv` COPY (49) + `.dockerignore:32` re-inclusion — verified working end-to-end by DOCKER_SMOKE §2 (first smoke run failed without it, fix verified) ✓; healthcheck comes from compose (none in Dockerfile — acceptable); CMD binds 0.0.0.0 ✓; stale header note "statically validated only" (13–14) — superseded by ADR-7 update/DOCKER_SMOKE (cosmetic, F10-adjacent).

**`docker/frontend.Dockerfile`** — `ARG VITE_API_URL` before use (23–24) ✓; `package*.json` wildcard + `npm ci`-if-lock (29–30) ✓; sources copied after install (33) ✓; `.dockerignore` excludes node_modules/dist ✓; stage 2 nginx runs **as root** (no non-root) — F10; no HEALTHCHECK — F10.

**`docker/nginx.conf`** — SPA fallback `try_files $uri $uri/ /index.html` (18) ✓ correct for client routing incl. catch-all; `/assets/` immutable 1y (22–25) ✓ correct because Vite fingerprints (verified in build output, evidence 02); `gzip_types` includes `application/javascript` — **verified correct against live `nginx:alpine` 1.31.3 mime.types** (evidence 06 §6) — a suspected mismatch was checked and cleared by execution; `index.html` gets no explicit cache header → heuristic caching can serve a stale shell after redeploy — F9.

**`docker-compose.yml`** — `env_file: .env` + `environment: API_HOST=0.0.0.0` precedence comment correct (compose `environment` wins) ✓; healthcheck via urllib (slim has no curl) with 40 s start_period for artifact load ✓; `depends_on: service_healthy` ✓; bind mounts `./logs`, `./reports/drift` — non-root container writes verified working in DOCKER_SMOKE §5 (host log grew) ✓; mlflow service profile-gated ✓ but image tag `:latest` unpinned (69) — F10. `docker compose config -q` exit 0 (evidence 06 §2).

**`docker-compose.override.yml`** — `!override` on all three `ports` lists is the correct Compose v2 mechanism (merge would otherwise append); effective config shows only 18000/18080 published (evidence 06 §3) ✓ mechanically correct. **But the file ships in the repo root, is not `.gitignore`d, and auto-merges on every invocation**, contradicting its own header ("NOT committed defaults"), `DEPLOYMENT.md:72–86` (`up --build` → :8000/:8080), and the base file's comments. Also `CORS_ORIGINS` override (24) drops :8080 — fine locally, part of the same shipping question. → **F1 (P2)**.

**`.github/workflows/ci.yml`** — python job: 3.12 installability **verified via live PyPI metadata**: every binary pin has cp312 wheels; tightest floors are scipy/shap/xgboost `>=3.12` (evidence 07) → install should pass; tests need committed `data/processed` + `models` (present, not gitignored) ✓. **e2e is not installed or run in CI at all** (no e2e job; deps live in `e2e/package.json`) — answering the audit question. frontend job: `npm ci` when lock exists — lock exists and is in sync (`npm ci --dry-run` exit 0, evidence 01) ✓. docker job: `cp .env.example .env` then `docker compose config -q` — valid, **but validates the merged base+override config**, never the base alone, because the override ships (F1; also contradicts DOCKER_SMOKE.md's "base file alone (what CI checks)" remark).

**`pytest.ini` / `conftest.py`** — `pythonpath=.` (pytest ≥7 ✓ 9.1.1 pinned), `testpaths` matches the CI command ✓, `integration` marker declared ✓; conftest sys.path fallback harmless ✓.

**`.env.example`** — no secrets (locations only: file contains placeholders/hosts); all keys map to `Settings` fields (config.py:34–44, case-insensitive) ✓; `MLFLOW_ALLOW_FILE_STORE=true` per SPEC §14 ✓; CORS defaults match dev :5173 + compose :8080 ✓.

**`requirements*.txt`** — 21+14 fully `==`-pinned (verified by execution, evidence 05); installed `.venv` versions match all 21 root pins (evidence 06 §7); backend subset consistent, mlflow correctly excluded.

**`e2e/playwright.config.js` + `dashboard.spec.js`** — workers 1 / retries 0 documented (API-down test kills :8100 itself) ✓; no `webServer` — servers external, documented in `reports/E2E.md` with matching ports 8100/5200 ✓; `killPort` (spec:46) netstat/taskkill is Windows-only (documented) and has a positive control (`expect(killed).toBe(true)`, spec:188) ✓; test 2's `noValidate` trick documented ✓; selectors match implementation (`role="alert"`, `.factor-row` count 5, `API connected/offline` texts) ✓; screenshot style-pin matches `.site-header`/`.valuation-result` classes ✓. Ports 8100/5200 coincide with wave-B blackbox assignment — no conflict.

---

## 5. Findings

### F1 — P2 — `docker-compose.override.yml` ships and auto-merges; docs and CI claim otherwise
- **Where:** `docker-compose.override.yml:1-19` (header "NOT committed defaults"), `docker-compose.yml:8-10`, `docs/DEPLOYMENT.md:72-86`, `.github/workflows/ci.yml:67-68`, `reports/DOCKER_SMOKE.md` ("base file alone (what CI checks)").
- **What:** the override is present in the delivered tree and is **not** excluded by `.gitignore` (evidence 06 §5), so every `docker compose` invocation — including a fresh copy's `docker compose up --build` and CI's `docker compose config -q` — merges it. Verified: merged config publishes **18000/18080**; base-only publishes **8000/8080** (evidence 06 §3–4). DEPLOYMENT.md documents 8000/8080/5000. CI therefore validates the merged config, not the base — DOCKER_SMOKE.md's parenthetical is wrong.
- **Repro:** `docker compose config | grep published` → 18000/18080; `docker compose -f docker-compose.yml --env-file .env config | grep published` → 8000/8080.
- **Impact:** documented quickstart ports silently differ from actual ports on any machine with port conflicts resolved by this file; CI never validates the pure base config. Behavior is self-consistent (VITE_API_URL/CORS remapped correctly), so this is a truth-in-docs/packaging defect, not a runtime bug.
- **Fix direction (wave C):** either commit it deliberately and update DEPLOYMENT.md + compose comments, or add `docker-compose.override.yml` to `.gitignore` and keep it machine-local.

### F2 — P3 — `ModelInsights.jsx:245` special-cases HTTP 404, but the backend contract is 503
- **Where:** `frontend/src/pages/ModelInsights.jsx:244-248` vs `backend/app/api/model.py:101-103`.
- **What:** the friendly "endpoint not available yet" message fires only when `importance.error.status === 404`. The route exists, so FastAPI never 404s it; a missing/malformed importance artifact raises **HTTPException 503**. The branch is dead code; users see the generic ErrorState with the 503 detail instead (still acceptable UX). The header comment ("graceful error state while the endpoint rolls out") is stale — the endpoint is live per SPEC §14.
- **Repro (static):** `model.py:103` → `status_code=503`; no 404 path exists for this route.

### F3 — P3 — `audit_reproducibility.py` restore-on-failure does not cover Ctrl-C
- **Where:** `scripts/audit_reproducibility.py:252` (`try:`) / `:351` (`except Exception`).
- **What:** step 3's guarantee "repo stays byte-stable" relies on `except Exception`. `KeyboardInterrupt`/`SystemExit` are not `Exception` subclasses, so interrupting a 1–2 minute retrain leaves `models/` potentially half-retrained (regression new, classification mid-write). Backups persist under `artifacts/repro_audit_backup/` so manual recovery is possible, and `main()`'s per-step catch has the same blind spot (a step crash is a FAIL row only for `Exception`).
- **Repro (static):** interrupt during `subprocess.run` of a retrain; script exits via traceback without running `_restore_tree`.

### F4 — P3 — `audit_reproducibility.py` subprocess pipes rely on locale encoding (Windows fragility)
- **Where:** `scripts/audit_reproducibility.py:97-104` and `:427-433` (`text=True` without `encoding=`/`errors=`).
- **What:** on this machine the pipe encoding is cp1252 (verified). 16 `ml/`/`backend/` files contain non-cp1252 characters (U+2192, U+2248, U+2264, U+03A3, U+1F4A3…) — all in docstrings/comments today; **zero** occur in print/log lines (evidence 05), so the audit runs clean now. If a pipeline ever logs one of these characters, the child crashes with `UnicodeEncodeError` and the step fails spuriously. Hardening: `encoding="utf-8", errors="replace"` plus `PYTHONIOENCODING=utf-8` in `AUDIT_ENV`.

### F5 — P3 — `load_test.py` latency percentiles include failed requests; 3xx counts as success
- **Where:** `scripts/load_test.py:136-143` (latency appended unconditionally), `:95-97` (errors = status ≥ 400).
- **What:** transport-error and HTTP-error timings are included in p50/p90/p95/p99; fast error responses bias percentiles downward when a run has failures. httpx's default `follow_redirects=False` means a 3xx is counted as a non-error. Verified behavior by execution (evidence 04: mixed 200/500 summary includes all 3 latencies). Document or exclude error latencies; cosmetic for a load tool.

### F6 — P3 — `format.js` `formatUptime` does not guard NaN / negative
- **Where:** `frontend/src/format.js:28-36`.
- **What:** `formatUptime(NaN)` → `"NaNs"`, `formatUptime(-5)` → `"-5s"` (executed, evidence 03), while the sibling formatters all map NaN → "—". Unreachable with the real `/metrics` payload (uptime is a real float), cosmetic.

### F7 — P3 — advanced number inputs omit `step`, blocking decimals the backend accepts
- **Where:** `frontend/src/pages/Valuation.jsx:153-160` (no `step` attr) vs `backend/app/schemas/property.py:80,87,115` (`lot_frontage`, `garage_area`, `mas_vnr_area` are `float`).
- **What:** HTML5 number inputs default to `step=1`, so `50.5` fails native validation and the form won't submit, though the API accepts floats for these three fields. Core fields set `step={1}` explicitly (correct — they are ints). One-line fix (`step="any"` for float fields).

### F8 — P3 — dead CSS classes
- **Where:** `frontend/src/styles.css` has no rules for `.page` (used 10×), `.form-card`, `.result-block`, `.prob-gauge` (executed grep, evidence 07). Harmless wrapper/landmark classes (`.price-band` doubles as an e2e locator). Cosmetic debt only.

### F9 — P3 — nginx serves `index.html` without an explicit no-cache directive
- **Where:** `docker/nginx.conf:17-19`.
- **What:** fingerprinted `/assets/` are correctly immutable, but the shell `index.html` has no `Cache-Control`; browsers may heuristically cache it (≈10% of Last-Modified age), serving a stale shell briefly after redeploy. Standard SPA hardening: `add_header Cache-Control "no-cache"` on the html route. Low risk (fresh container → fresh mtime).

### F10 — P3 — container hardening nits
- `docker/frontend.Dockerfile:37-41`: nginx stage runs as root (no unprivileged user); no healthcheck for the frontend service (backend has one in compose).
- `docker-compose.yml:69`: `ghcr.io/mlflow/mlflow:latest` unpinned (profile-gated, non-critical).
- `docker/backend.Dockerfile:66`: `ENV VITE_API_URL=...` in the backend image is inert (backend never serves the frontend).
- `docker/backend.Dockerfile:13-14` and `docker/frontend.Dockerfile:15`: stale "statically validated only — daemon unavailable" notes, superseded by ADR-7 update + `reports/DOCKER_SMOKE.md`.

### F11 — P3 — `Valuation.submit` has no abort/stale-response guard (analysis note, not a live bug)
- **Where:** `frontend/src/pages/Valuation.jsx:257-263`.
- **What:** double-submit is unreachable through the UI (submit button disabled in flight; a disabled default button also blocks Enter-key implicit submission per the HTML spec), and setState-after-unmount is a no-op in React 19. If the form ever gains a second submission path, responses are last-to-resolve-wins with no cancellation. No user-visible defect today; listed for completeness of the race-condition hunt. `useApi` (cancel flag) and `ApiStatus` (cancel + clearInterval) both handle cleanup correctly.

---

## 6. What was independently re-verified and found TRUE (no finding)

- Frontend↔backend contract: every field the UI reads exists in the response schemas/payload builders (`responses.py`, `model.py:32-58`, `cluster_service.py:52-88`, live `reports/drift/latest.json`, `models/champion.json`, `data/external/neighborhood_geo.csv`).
- All categorical option sets and numeric ranges in `constants.js` == pydantic Literals/constraints, item-for-item.
- `eslint` clean; production `vite build` succeeds with working code-splitting; `npm ci --dry-run` OK.
- No `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`localStorage`/`document.write` anywhere in `frontend/src` (evidence 07) → no XSS surface; all API data rendered as React text.
- Number formatting null/undefined/NaN → "—" (executed, except F6).
- `percentile()` == numpy linear method (executed).
- Zero-request load run cannot divide by zero (executed).
- Repro-audit read-only steps PASS by my own execution; prior full-run (incl. retrains) documented with exit 0 in `reports/REPRODUCIBILITY.md`.
- Compose config valid; healthcheck/CORS/port-remap mechanics correct; bind-mount writes by non-root container user proven in DOCKER_SMOKE §5.
- nginx `gzip_types application/javascript` correct for the live `nginx:alpine` 1.31.3 (executed — a suspected mismatch was checked and cleared).
- CI python job: all pins installable on 3.12 (PyPI metadata: `requires_python` floors + cp312 wheel counts, evidence 07).
- No servers were started; no ports used; no project files modified.

---

## 7. Coverage summary

- **Files assigned: 31** (15 frontend src, 2 scripts, 2 e2e, 3 docker, 2 compose, 1 CI, pytest.ini, conftest.py, .env.example, 2 requirements, package.json, vite.config.js, index.html) — **31/31 read in full**; plus `.dockerignore` + `e2e/package.json` as context.
- **Functions: 45** (27 frontend JS/JSX incl. 3 data modules reviewed as data, 18 script functions) — **45/45 in the matrices above**.
- **Verified by execution:** format.js battery (node), eslint, vite build, npm ci dry-run, load_test percentile/summary/payload/CLI guard, repro-audit steps 4+6, compose config (merged + base-only), nginx mime.types (live container), requirements pins vs .venv, PyPI 3.12 installability, XSS/dead-class greps.
- **NOT EXECUTABLE here (with reason):** `audit_reproducibility.py` steps 1–3 (mutating pipeline re-runs/retrains — report-only wave; prior PASS evidence exists); full docker image builds (wave-B devops territory; prior smoke evidence exists); e2e suite runtime (needs live :8100/:5200 servers — wave-B blackbox, ports not assigned to me).
