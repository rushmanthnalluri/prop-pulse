# Final release report — v1.1.0 (SPEC §42)

**Date:** 2026-08-08 · **Lead:** Kimi · **Status:** RELEASED (lead-verified)

This is the §42 final audit report for release **v1.1.0** (wave 10). Wave
composition, per-agent outcomes, and the decision rationale are recorded in
`docs/agent-log/wave-10-orchestrator.md` — this report does not duplicate them;
it states the verified end state.

## 1. Project status

v1.1.0 is released and lead-verified on 2026-08-08. Wave 10 consisted of an
independent re-verification of v1.0.0 (claims found real), a PlacementPredict
benchmark mining pass, a red-team + innovation review, a product-hardening
implementation wave, and same-day remediation of the red-team blocker. All 13
wave-10 agents completed; every gate below was re-run after remediation.

## 2. Architecture

The existing PropPulse architecture was **kept unchanged** — wave 10 validated
it rather than revising it: sklearn pipelines shipped as self-contained
joblibs behind a file-based champion registry (`models/registry/` +
`models/champion.json`), one leakage-safe feature pipeline (`ml/features/`)
shared by training and serving, FastAPI backend + React dashboard, SHAP
explainability, MLflow tracking, PSI drift monitoring, Docker packaging.
recon-2 independently re-verified the v1.0.0 claims against this architecture
(210/210 tests, 8/8 endpoints live, no canned responses). Wave-10 additions
extended the existing seams (two new routers, startup-cached payloads, new
committed artifacts under `models/comps/`); no ADR was superseded — the ADR-3
change was a documentation correction, not a design change.

## 3. PlacementPredict benchmark — adopted / declined

**Adopted this wave:**

- **Model card** — `MODEL_CARD.md` added at the repo root.
- **CI dependency-audit gate** — `pip-audit --strict` (one accepted CVE
  allow-listed: `PYSEC-2026-3552`, rationale in `reports/SECURITY.md`) plus
  `npm audit --audit-level=high`.

**Declined, with rationale:**

- **joblib SHA-guard before serving** — pickles are not integrity-protectable
  by hashing; `feature_version` (`9b0f8ba4201c`) already guards schema drift.
- **Build-time training in Docker** — not applicable: PropPulse ships
  pre-built, versioned artifacts; the equivalent cold-start property is
  already verified in `reports/DOCKER_SMOKE.md`.

## 4. New features (wave 10)

- **Comparable-sales panel** — `POST /market/comps` returns the most similar
  historical sales for a subject property (smoke: 5 comps, match_scope
  neighborhood, subject price percentile 21.3). Backed by the new artifact
  `models/comps/comps.json`: **945 train-only records, 2006-01..2008-12**,
  with a build-time assert that the simulated-target columns
  (`days_on_market`, `sells_within_30_days`) are absent. It deliberately does
  **not** write to `logs/predictions.jsonl` (drift-input hygiene);
  `/predict*` logs as before.
- **Market-position strip** — the `/predict` response carries
  `market_position`: subject $/sqft vs neighbourhood median vs micro-market
  median, with delta % and an above/below label.
- **What-if scenario explorer** — re-scores scenario levers against the live
  API; the remodel-year slider is capped at the 2008 training-window boundary
  and reduced confidence is surfaced per lever.
- **Market-trends chart** — `GET /market/trends` serves a startup-cached
  train-split payload (periods 2006H1..2008H2) with honest nulls where a
  period has no sales.
- **Per-prediction confidence flags** — `confidence` block (typical/reduced +
  reasons) on `/predict` and `/predict/sale-probability`; `calendar_clamped`
  on `/market/comps`.
- **Map → valuation prefill** — `/?neighborhood=X` pre-selects the
  neighbourhood in the valuation form.
- **UI honesty fixes** — the `cluster.note` velocity caveat renders under
  every 30-day-velocity display (map popup, cluster cards, valuation
  micro-market card); the probability gauge badge reads "Fast-sale signal
  (simulated target)"; ModelInsights decluttered; the model-version line
  moved to the insights page.

## 5. Statistical-integrity change — serving calendar clamp

Serving no longer stamps `sale_date=today`. An omitted sale date now defaults
to the latest train month (**2008-12**, derived from
`data/processed/train.csv`, not hardcoded); later dates are clamped to the
training-window boundary and disclosed via `confidence.reasons`;
`YearRemodAdd` clamps to the clamped sale year, so `years_since_remod` can
never go negative. Measured pre-fix bias was ≈2.2% on every default
prediction; default `/predict` values therefore moved ~+2% vs v1.0.0. This is
the designed behaviour, not a limitation — see §11.

## 6. Champions and metrics

Unchanged in wave 10 (no retraining):

- **Regression:** `ridge_v1` — test R² **0.9305**, MAE **$15,075**, RMSLE
  **0.1187** (selection locked to validation; the ridge/XGBoost gap is not
  statistically significant — see §11).
- **Classification:** calibrated `random_forest_v1` @ threshold **0.203292** —
  test ROC-AUC **0.7666**, PR-AUC **0.5674**, Brier **0.1710** — on the
  **SIMULATED 30-day target (ADR-3)**: these measure recovery of the
  documented simulation, not real-world sale-speed performance.
- **Clustering:** DBSCAN, **4 micro-markets**; **94 features**,
  `feature_version 9b0f8ba4201c`.

## 7. Dataset

Kaggle "House Prices: Advanced Regression Techniques" (Ames, Iowa; De Cock
2011): 1,460 labeled rows, time-based split train 945 (≤2008) / val 338
(2009) / test 175 (2010). Comps and trends serve the **train split only**
(2006-01..2008-12) — val/test rows are never served as comparables.

## 8. Tests and verification

| Gate | Result | Evidence |
|---|---|---|
| pytest (tests + backend/tests) | **232 passed**, 0 failed, **0 xfail/xpass**, ~51 s | post-remediation run |
| Frontend | `npm run build` **zero warnings**; `npm run lint` **clean** | `frontend/` |
| Playwright E2E | **27/27 passed** — 3 spec files (`dashboard` 7, `audit-blackbox` 11, `frontend-fixes` 9), Chromium headless | `reports/E2E.md` (verbatim output); 5 refreshed screenshots in `docs/screenshots/` |
| Endpoints live | **10**: `/health`, `/metrics`, `/predict`, `/predict/price`, `/predict/sale-probability`, `/model/info`, `/model/importance`, `/market/clusters`, `/market/comps`, `/market/trends` | lead smoke |

**Live smoke (lead, post-clamp):**

- `/predict` standard default payload → estimated price **$261,464.40**,
  range **[$227,089.35–$293,809.78]**, probability **0.2537** @ threshold
  0.203292; market_position **$104.6 vs $153.0 (nbhd) vs $119.4 (cluster)
  $/sqft, −31.6%, "below"**; confidence typical.
- `/predict` with `yr_sold=2026` → **identical price**, confidence reduced:
  "Sale date beyond the 2006-2008 training window; scored at the window
  boundary."
- `/market/comps` → 5 comps, match_scope neighborhood, percentile 21.3,
  `calendar_clamped: false` (`true` when a 2026 date is passed).
- `docs/DEMO.md` payload → **$262,468** (DEMO.md already updated).

## 9. Security

Wave-9 hardening remains in force (security headers middleware, 64 KB body
limit, error-path leak fix). Wave 10 added the CI dependency-audit gate:
`pip-audit --strict` with **one accepted CVE allow-listed** —
`PYSEC-2026-3552` (`cryptography 49.0.0`, transitive via mlflow's `<50` pin;
vulnerable code path not exercised — `reports/SECURITY.md`) — and
`npm audit --audit-level=high`. No authentication or rate limiting; both are
documented deployment-hardening items (`docs/DEPLOYMENT.md`).

## 10. Deployment

Docker packaging and compose topology are unchanged from v1.0.0 (backend +
frontend images, opt-in `docker-compose.alt-ports.yml`, opt-in mlflow
profile); the wave-10 additions are in-process (startup-cached payloads) or
committed artifacts (`models/comps/comps.json`), so no packaging contract
changed. Images were verified on this machine only
(`reports/DOCKER_SMOKE.md`); the CI workflow has never run on a hosted
runner (§11).

## 11. Known limitations (honest list)

1. **Simulated 30-day target (ADR-3).** The Ames dataset has no
   days-on-market; classification metrics measure recovery of a transparent
   simulation. The real-data adapter (`DOM_PROVIDER=csv` + `DOM_CSV_PATH`)
   is ready; retrain to use it.
2. **Calendar support ends at the training window — handled by designed
   clamp, not extrapolation.** Omitted sale dates default to 2008-12; later
   dates are scored at the window boundary with reduced, disclosed
   confidence. Read every estimate as "as if sold within the training
   window" — the models learn nothing about post-2008 market levels.
3. **Neighbourhood-grain geography (ADR-2).** 25 approximate centroids, not
   per-property coordinates; `property_geo.csv` override supported.
4. **Champion margin.** Ridge vs XGBoost val gap is not statistically
   significant (bootstrap CI includes 0; XGBoost posts the lower sealed-test
   RMSLE) — selection was locked to validation by design.
5. **Accepted CVE:** `PYSEC-2026-3552` (see §9). Revisit on mlflow upgrade.
6. **No auth / no rate limiting.**
7. **E2E covers Chromium only**; **CI has never run on a hosted runner**;
   Docker images verified on this machine only.
8. **Small dataset** — 1,460 rows, one city, 2006–2010 market.

## 12. Red-team objections and resolutions

All three wave-10 objections and the follow-up blocker were resolved and
re-verified with file:line evidence (per-agent detail:
`docs/agent-log/wave-10-orchestrator.md`):

- **OBJ-1 — UI dropped the velocity caveat** (30-day velocity figures shown
  without the simulated-target note). **RESOLVED:** `cluster.note` now
  renders under every velocity display and the gauge badge reads "Fast-sale
  signal (simulated target)".
- **OBJ-2 — `sale_date=today` extrapolation** (serving stamped today's date,
  extrapolating calendar features past the training window on every default
  prediction). **RESOLVED:** the serving calendar clamp (§5); measured
  pre-fix bias ≈2.2%; docs re-measured to post-clamp values.
- **OBJ-3 — ADR-3 formula misdescribed in docs.** **RESOLVED:**
  documentation correction (ADR-3 / METHODOLOGY disclosures), no code
  change.
- **Wave-10 blocker — negative `years_since_remod` via the scenario
  remodel-year slider.** **FIXED same-day:** `YearRemodAdd` clamps to the
  clamped sale year server-side, the slider is capped at 2008, and
  disclosure parity was added (`confidence` on `/predict/sale-probability`,
  `calendar_clamped` on `/market/comps`). Re-verified after the fix.

Final red-team verdict after fixes: **sound to ship**.

## 13. Final QA summary

| Gate | Verdict |
|---|---|
| 232 pytest, 0 xfail/xpass (~51 s) | PASS |
| Frontend build zero-warning, lint clean | PASS |
| 27/27 Playwright (3 specs, Chromium headless) | PASS |
| 10 endpoints live-verified, post-clamp smoke values as §8 | PASS |
| Red-team objections OBJ-1/2/3 + blocker resolved, re-verified | PASS |
| Security gates (pip-audit strict allow-list, npm audit high) | PASS |

**Verdict: PASS — v1.1.0 released 2026-08-08.**
