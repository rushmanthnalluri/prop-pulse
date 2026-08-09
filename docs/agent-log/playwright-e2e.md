# Agent log — playwright-e2e

**Date:** 2026-08-07 · **Scope owned:** `e2e/`, `docs/screenshots/`, `reports/E2E.md`

## What was built

- `e2e/` — standalone npm project (`@playwright/test` 1.62.1; Chromium
  Headless Shell 151.0.7922.34 via `npx playwright install chromium`):
  - `e2e/package.json`, `e2e/.gitignore` (node_modules, test-results, report)
  - `e2e/playwright.config.js` — baseURL `http://localhost:5200`, chromium
    only, retries 0, workers 1, viewport 1440×900
  - `e2e/tests/dashboard.spec.js` — 5 scenarios in mandatory order:
    valuation flow (price /\$[\d,]+/, range band, probability %, micro-market
    label, exactly 5 factor rows), validation error state (422 names
    `gr_liv_area`), market map (leaflet, 25 circle markers ≥ 20, popup with
    cluster stats), model insights (`ridge v1` + `random_forest v1`, 20
    importance bars ≥ 10, drift empty state), API-down (LAST — the test kills
    the :8100 listener itself via netstat/taskkill, then asserts `API offline`
    header + unreachable-API error card)
- `docs/screenshots/` — 5 full-page 1440×900 portfolio PNGs (home-empty,
  valuation-result, market-map, model-insights, error-state), all visually
  verified after capture.
- `reports/E2E.md` — scenarios, verbatim playwright summary, screenshot list,
  known gaps, re-run instructions.

## Servers / ports

Used exclusively: backend **8100** (`CORS_ORIGINS=http://localhost:5200`) and
frontend dev **5200** (`VITE_API_URL=http://localhost:8100`, `--strictPort`).
Both verified responding before tests; both killed afterwards and confirmed
free via netstat (8100 by the final test by design; 5200 manually — note:
stopping the npm wrapper leaves the Vite child alive, it must be taskkilled
by PID).

## Verification

- `npx playwright test` → **5 passed (25.3s)** (verbatim summary in
  reports/E2E.md). First full run had 1 failure (Playwright strict-mode label
  collision: `Full baths` vs `Basement full baths`) — fixed with exact
  label matching; no product bug.
- `.venv/Scripts/python.exe -m pytest tests backend/tests -q` →
  **154 passed** (114 baseline + concurrent agents' additions), no regressions.
- No `frontend/` or `backend/` files were modified.

## Notes for the orchestrator

- Drift panel was asserted in its documented `no_data` empty state (no drift
  report existed at run time); the same test accepts the PSI card branch once
  `reports/drift/latest.json` exists.
- Validation scenario sets `form.noValidate` in-page to reach the API 422
  path — HTML5 min/max attributes otherwise block the out-of-range submit
  client-side (documented in reports/E2E.md; not a bug).
- Non-blocking observation for the polish agent: valuation error card has no
  "Try again" button (other pages do) — re-submit is the retry path.
- The suite's real predictions append to `logs/predictions.jsonl` (by design).
