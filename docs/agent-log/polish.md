# Agent Log — polish

**Scope owned:** `README.md`, `docs/API.md`, `docs/DEMO.md` (new),
`frontend/src/pages/Valuation.jsx` (error-card reset button),
`docs/screenshots/error-state.png` (refresh), this log. Status: **complete**.
Did NOT touch `docs/AGENT_STATUS.md` / `FINAL-RELEASE.md` (lead-owned).

## What changed and why

### `README.md`

- **New "Verification status" table** near the top — tests 162 passed; Docker
  build + in-compose smoke verified (backend 1.77 GB / frontend 93.9 MB,
  override ports 18000/18080); browser E2E 5/5 (Playwright 1.62.1 Chromium);
  reproducibility audit PASS (byte-identical data/features, retrain diff
  ≤ 2.22e-16); security audit (1 accepted CVE — `cryptography<50` pinned by
  mlflow 3.15.1); warm `/predict` p50 ≈ 197 ms (was ~800 ms pre wave-9b),
  cold first call ≈ 0.5 s. Every row links its wave-9 report.
- **New "Showcase" section** embedding the five `docs/screenshots/*.png`
  captures (relative paths, one-line captions), linking `docs/DEMO.md`.
- **Docker section rewritten** — the "daemon unavailable / builds not
  executed (ADR-7)" wording is replaced with the verified result
  (`reports/DOCKER_SMOKE.md`): how to run, the optional
  `docker-compose.override.yml` port remap (18000/18080/15000, `!override`
  merge gotcha documented there), and the opt-in mlflow profile.
- **Stale performance claim fixed** — "first `/predict` pays ~4 s SHAP; warm
  ~50 ms" (that ~50 ms was SHAP-only, never the full bundle) → SHAP is
  lifespan-warmed since wave-9b; first call ≈ 0.5 s; warm p50 ≈ 197 ms
  (`reports/PERFORMANCE.md` "After fix").
- **DOM fallback** — updated from "pass `RealDomProvider(csv_path)` at the
  call site" to the live adapter: `DOM_PROVIDER=csv` + `DOM_CSV_PATH` env
  vars, strict load-time validation, retrain checklist in `data/README.md`.
- **Geography fallback** — one line on the new `property_geo.csv`
  per-property coordinate override (`docs/GEOGRAPHY.md` §4; retrain needed).
- Test count 114 → **162** (Features bullet + Testing section, real measured
  duration ~30 s); added browser-E2E paragraph; project-structure block
  gains `e2e/`, `scripts/`, the override file, DEMO/GEOGRAPHY/screenshots;
  "planned improvements" now reflect that both fallback adapters are wired.

### `docs/API.md`

- `/model/importance`: "re-reads the artifact on every request" → payload
  built once at startup, cached in `app.state`; restart required to pick up
  a regenerated artifact (wave-9b; the flagged stale lines 188–189).
- `/model/info` and `/market/clusters`: noted the same startup caching.
- General-behavior bullet: "~4 s first request; warm ~50 ms" → lifespan
  SHAP warm-up, ≈ 0.5 s first call, warm p50 ≈ 197 ms, with report link.

### `docs/DEMO.md` (new)

Five-minute walkthrough: start commands, an exact example property
(NridgHt 2Story, 4 bd, 2+1+1 baths, 2500 sqft, 2005, qual 8), what each
screen shows, six talking points (leakage-safe features, champion-selection
honesty, calibrated probability + 0.2033 threshold, micro-markets, SHAP
factors, drift monitoring), and a reset note. **Expected values in it are
measured, not invented** — I ran the backend on :8100 and POSTed the exact
property: $250,967.50, range $217,972.48–$282,014.33, probability 0.291813
vs threshold 0.203292, micro-market "mid northwest", factors OverallQual /
GrLivArea / total_sf / neighborhood_median_price / neighborhood_mean_price.
*(Superseded 2026-08-08: the wave-10 serving calendar clamp changed these
values — current values in `FINAL-RELEASE.md` v1.1.0.)*
The error beat is written honestly: native HTML5 validation fires first in a
stock browser (per `reports/E2E.md`); the API-down card is the demoable
server-error path.

### `frontend/src/pages/Valuation.jsx`

The valuation error card lacked the "Try again" action the other pages have
(E2E report observation). `ErrorState` already takes `onRetry`; the page now
passes a `reset` handler that clears the error back to the empty state — the
form keeps its values, so fix-and-resubmit is the retry path (a comment says
so). Matches the existing pattern exactly (`btn btn--secondary`, label from
`StateView`).

### `docs/screenshots/error-state.png`

Refreshed via the real Playwright scenario (backend :8100, vite :5200 per
`reports/E2E.md`): `npx playwright test -g "validation error state"` →
**1 passed**, and the capture now shows the **Try again** button under the
422 detail. Verified the image visually.

## Verification evidence

- `pytest tests backend/tests -q` → **162 passed, 4 warnings** (27.32 s
  mid-work; **24.64 s** final run after all edits).
- `npm run lint` → clean; `npm run build` → clean (vite 6.4.3, 763 modules).
- Playwright error-state scenario passed against the edited frontend — the
  new button does not break the scenario-2 assertions.
- Link sweep: every file path referenced in README/DEMO/API exists
  (scripted check; only intentional not-committed paths flagged:
  `data/external/property_geo.csv`, `data/external/days_on_market.csv`).
- Numbers cross-checked against sources: 1.77 GB / 93.9 MB
  (DOCKER_SMOKE §3), 18000/18080/15000 (override file), 5/5 + Playwright
  1.62.1 (E2E), 798.5 → 197.5 ms p50 c=1 + 514.7 ms cold (PERFORMANCE
  "After fix"), 2.22e-16 (REPRODUCIBILITY §3), cryptography/mlflow pin
  (SECURITY §1.1).
- Ports 8100/5200 left free (verified via netstat after killing both
  servers; the vite child needed a direct `taskkill` after the npm wrapper
  died).

## Stale but not mine (flagged, untouched)

- `docs/DEPLOYMENT.md:7-11` — ADR-7 "daemon unavailable / builds not
  executed" caveat (builds are verified now); `:57` — "~4 s first `/predict`"
  stale post wave-9b.
- `docs/PROJECT_SPEC.md:286` (§14) — "first call ~4s warm-up; warm ~50ms"
  stale; now startup-warmed, warm `/predict` p50 ≈ 197 ms.
- `docs/DECISIONS.md` ADR-7 — historically inaccurate for this machine
  (also flagged by the docker agent). Lead-owned.
