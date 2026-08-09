# PropPulse — FINAL RELEASE

**Version:** 1.1.0 · **Date:** 2026-08-08 · **Status:** RELEASED (lead-verified)

PropPulse is an end-to-end property valuation and market-intelligence platform:
sale-price regression, 30-day sale-probability classification, and neighbourhood
micro-market discovery, served through FastAPI + a React dashboard, with SHAP
explainability, MLflow experiment tracking, PSI drift monitoring, Docker packaging,
CI, and a full verification record.

---

## v1.1.0 (2026-08-08) — current release

### What changed in v1.1.0 (wave 10)

- **Comparable-sales panel** — new `POST /market/comps`: most similar
  train-split sales (2006-01..2008-12 only; artifact `models/comps/comps.json`,
  945 records, simulated-target columns asserted absent) with the subject's
  price percentile. Deliberately does not write to the prediction log.
- **Market-position strip** — `/predict` now carries `market_position`
  (subject $/sqft vs neighbourhood vs micro-market median, delta %,
  above/below label).
- **What-if scenario explorer** — re-score scenario levers live; remodel-year
  slider capped at the 2008 training-window boundary; reduced confidence
  surfaced per lever.
- **Market-trends chart** — new `GET /market/trends`: startup-cached
  train-split series, periods 2006H1..2008H2, honest nulls.
- **Per-prediction confidence flags** — `confidence` block (typical/reduced +
  reasons) on `/predict` and `/predict/sale-probability`; `calendar_clamped`
  on `/market/comps`.
- **Map → valuation prefill** — `/?neighborhood=X` pre-selects the form.
- **UI honesty fixes** — velocity caveat (`cluster.note`) rendered under every
  30-day-velocity display; gauge badge reads "Fast-sale signal (simulated
  target)"; ModelInsights decluttered; model-version line moved to insights.
- **Statistical-integrity fix — serving calendar clamp.** Serving no longer
  stamps `sale_date=today`: an omitted sale date defaults to the latest train
  month (2008-12, derived from `data/processed/train.csv`); later dates clamp
  to the window boundary and are disclosed; `YearRemodAdd` clamps to the
  clamped sale year (no negative `years_since_remod`). Default `/predict`
  values moved ~+2% vs v1.0.0 (measured pre-fix bias ≈2.2%).
- **Process** — `MODEL_CARD.md` added; CI dependency-audit gate
  (`pip-audit --strict` with one accepted CVE allow-listed;
  `npm audit --audit-level=high`). Endpoints: 8 → **10**.

### Verification record (v1.1.0; all evidence in `reports/` + `docs/agent-log/`)

| Gate | Result | Evidence |
|---|---|---|
| Unit + integration tests | **232 passed**, 0 failed, **0 xfail/xpass** (~51 s) | `pytest tests backend/tests -q` (post-remediation lead run) |
| Frontend build + lint | `npm run build` **zero warnings**; `npm run lint` **clean** | `frontend/` |
| Browser E2E | **27/27 passed** — 3 spec files, Playwright, Chromium headless | `reports/E2E.md` (verbatim output), 5 refreshed screenshots in `docs/screenshots/` |
| Live API smoke (lead) | **PASS** — all **10 endpoints**; `/predict` default → **$261,464.40**, range [$227,089.35–$293,809.78], p=0.2537 @ threshold 0.203292, market_position $104.6 vs $153.0 nbhd vs $119.4 cluster $/sqft (−31.6%, "below"), confidence typical; `yr_sold=2026` → identical price + reduced confidence ("Sale date beyond the 2006-2008 training window; scored at the window boundary."); `/market/comps` → 5 comps, match_scope neighborhood, percentile 21.3, `calendar_clamped` false (true with a 2026 date); DEMO payload → $262,468 | this file, `docs/agent-log/final-release.md` |
| Champions (unchanged) | ridge_v1 test R² 0.9305 / MAE $15,075 / RMSLE 0.1187; calibrated random_forest_v1 test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710 (SIMULATED 30-day target, ADR-3); DBSCAN 4 clusters; 94 features, feature_version 9b0f8ba4201c | `models/champion.json`, `reports/MODEL_EVALUATION.md` |
| Security | `pip-audit --strict` CI gate (1 accepted CVE allow-listed: `PYSEC-2026-3552`) + `npm audit --audit-level=high` | `reports/SECURITY.md` |
| Red-team | 3 objections + 1 wave-10 blocker, all resolved and re-verified; final verdict: sound to ship | `docs/agent-log/wave-10-orchestrator.md`, `docs/agent-log/final-release.md` |
| Docker / performance / reproducibility | last verified at v1.0.0 (historical record below); not re-run in wave 10 | `reports/DOCKER_SMOKE.md`, `reports/PERFORMANCE.md`, `reports/REPRODUCIBILITY.md` |

### Known limitations (v1.1.0)

1. **Simulated 30-day target (ADR-3).** Classification metrics measure
   recovery of a transparent simulation, not real-world sale-speed
   performance. Real-data adapter ready (`DOM_PROVIDER=csv`); retrain to use.
2. **Calendar support ends at the training window — now a designed clamp,
   not silent extrapolation.** Omitted sale dates default to 2008-12; later
   dates are scored at the window boundary with reduced, disclosed
   confidence. Honest caveat: read every estimate as "as if sold within the
   training window" — the models learn nothing about post-2008 market levels.
3. **Neighbourhood-grain geography (ADR-2).** 25 approximate centroids;
   `property_geo.csv` override supported.
4. **Champion margin.** Ridge vs XGBoost val gap is not statistically
   significant (bootstrap CI includes 0; XGBoost posts the lower sealed-test
   RMSLE) — selection locked to validation by design.
5. **Accepted CVE:** `PYSEC-2026-3552` (`cryptography 49.0.0`, mlflow `<50`
   pin; vulnerable path unused) — allow-listed in the CI gate; revisit on
   mlflow upgrade (`reports/SECURITY.md`).
6. **No auth / no rate limiting** — documented deployment-hardening items
   (`docs/DEPLOYMENT.md`).
7. **Docker verified on this machine only; CI never run on a hosted runner;
   E2E covers Chromium only.**
8. **Small dataset** — 1,460 rows, one city, 2006–2010 market.

---

## v1.0.0 (2026-08-07) — historical record

> Superseded by v1.1.0 above. Preserved as the v1.0.0 release record: test
> counts, endpoint counts, and smoke values below are pre-wave-10 /
> pre-calendar-clamp. Current values are in the v1.1.0 section.

**Version:** 1.0.0 · **Date:** 2026-08-07 · **Status:** RELEASED (lead-verified)

### 1. Verification record (all evidence in `reports/` + `docs/agent-log/`)

| Gate | Result | Evidence |
|---|---|---|
| Unit + integration tests | **210 passed** (post-audit; 162 at this release) | `pytest tests backend/tests -q` (final lead run at release: 162 passed, 22.6s; the forensic audit's wave-C fixes added 48 regression tests — `docs/audit/FINAL_AUDIT.md`) |
| Live API smoke (lead) | **PASS** — `/predict` → $248,220.67, range [$215,587–$278,928], p=0.321 @ threshold 0.2033, cluster "mid northwest", 5 SHAP factors, `ridge_v1`+`random_forest_v1` | this file, wave-9b logs |
| Browser E2E | **5/5 passed** (Playwright 1.62.1, Chromium) incl. API-down state | `reports/E2E.md`, `docs/screenshots/` |
| Docker | **Build + in-compose smoke PASS** (backend 1.77 GB, frontend 93.9 MB; default ports 8000/8080 — opt-in alt-ports 18000/18080 via `docker-compose.alt-ports.yml`; mlflow profile 200) | `reports/DOCKER_SMOKE.md` |
| Security audit | **Applied** — headers middleware, 64 KB body limit, `/metrics` leak fix; 1 accepted CVE (`cryptography<50` pinned by mlflow 3.15.1; vulnerable API unused) | `reports/SECURITY.md` |
| Performance | warm `/predict` **p50 ≈ 197 ms** (was ~800–970 ms pre-fix), cold first call ≈ 0.5 s, 0 errors / 2,015 requests — quiet-machine figures; contended runs measure 2–3× higher | `reports/PERFORMANCE.md` |
| Reproducibility | **PASS** — data/feature artifacts byte-identical across re-runs; model retrain diff ≤ 2.22e-16; seeds=42 everywhere; pins + `pip check` clean | `reports/REPRODUCIBILITY.md`, `scripts/audit_reproducibility.py` |
| ML evaluation | ridge test R² 0.9305 / MAE $15,075 / RMSLE 0.1187; calibrated RF test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710 (simulated target — see §4) | `reports/MODEL_EVALUATION.md` |

### 2. Quickstart

```bash
# Local (Windows, Git Bash)
python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8000
cd frontend && npm install && npm run dev        # http://localhost:5173

# Docker (daemon required)
docker compose up --build                        # default ports 8000/8080; for 18000/18080 add: -f docker-compose.yml -f docker-compose.alt-ports.yml
```

5-minute guided demo: `docs/DEMO.md`. API reference: `docs/API.md`.

### 3. What was hardened in wave 9

- **Real-data DOM adapter** — `DOM_PROVIDER=csv` + `DOM_CSV_PATH` swaps the simulated
  days-on-market target for observed data with strict validation; default behaviour
  byte-identical (`ml/data/sale_speed.py`, `data/README.md` retrain checklist).
- **Property-level geo override** — optional `data/external/property_geo.csv`
  (`Id,lat,long`) replaces neighbourhood centroids with validation + fallback
  (`docs/GEOGRAPHY.md`).
- **Docker verified** — real builds + full in-compose smoke; one real defect fixed
  (SHAP background data excluded by `.dockerignore`).
- **Latency fix** — `n_jobs=1` serving pin for the calibrated classifier, narrow
  endpoints skip unused models, SHAP warmed at startup, static GETs cached;
  predictions byte-identical before/after.
- **Security** — security headers, request-size limit, error-path leak fix,
  dependency audit (pip-audit + npm audit).
- **E2E + screenshots + reproducibility audit** — repeatable, scripted, in-repo.

### 4. Known limitations (honest list)

1. **Simulated 30-day target (ADR-3).** The Ames dataset has no days-on-market;
  classification metrics measure recovery of a transparent simulation, not
  real-world performance. Swap in real data via `DOM_PROVIDER=csv` and retrain.
2. **Neighbourhood-grain geography (ADR-2).** 25 approximate centroids, not
  per-property coordinates; `property_geo.csv` override now supported.
3. **Champion margin.** Ridge vs XGBoost val gap is not statistically significant
  (bootstrap CI includes 0; XGBoost edges ridge on sealed test RMSLE) — selection
  was locked to validation by design.
4. **Accepted CVE:** `cryptography 49.0.0` (CVE-2026-69247) — fix blocked by
  mlflow's `<50` pin; vulnerable code path not exercised. Revisit on mlflow upgrade.
5. **No auth / no rate limiting** — documented deployment-hardening items
  (`docs/DEPLOYMENT.md` checklist). (Post-audit note: the 64 KiB body limit now
  also covers chunked bodies without a declared Content-Length — a streaming
  byte counter returns 413; see `docs/audit/fix-backend.md`.)
6. Docker images verified on this machine only; CI workflow has not run on a
  hosted runner. E2E covers Chromium only. Backend image is 1.77 GB (xgboost/numba
  deps) — slimming is a documented future item.
7. Small dataset (1,460 rows, one city, 2006–2010 market).

### 5. Release contents map

- ML pipeline: `ml/` (data, features, training, evaluation, clustering,
  explainability, monitoring) · artifacts: `models/` · tracking: `mlruns/`
- Service: `backend/` (FastAPI) · dashboard: `frontend/` (Vite + React)
- Packaging: `docker/`, `docker-compose.yml`, `.github/workflows/ci.yml`
- Verification: `reports/`, `e2e/`, `scripts/`, `tests/`, `backend/tests/`
- Docs: `README.md`, `docs/` (ARCHITECTURE, METHODOLOGY, API, DEPLOYMENT,
  GEOGRAPHY, DEMO, DECISIONS, PROJECT_SPEC, AGENT_STATUS, agent-log/)
