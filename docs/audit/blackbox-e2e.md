# blackbox-e2e — End-to-End Black-Box Runtime Audit (mission §22)

**Agent:** blackbox-e2e · **Date:** 2026-08-07 · **Wave:** B (runtime) · **Ports used:** 8100 (backend), 5200 (frontend) — both free before and after.
**Method:** fresh-started the stack exactly as a user would per README/E2E.md, ran the existing Playwright suite, then ran 11 new ad-hoc browser tests (`e2e/tests/audit-blackbox.spec.js` — the one new file this agent was permitted to add). No implementation reading preceded the suite run; UI source was only consulted afterwards to design the deeper tests.

## Verdict summary

**PASS.** The claimed 5/5 suite reproduces (5 passed, exit 0), and all 11 ad-hoc tests pass. The DOM renders the intercepted `/predict` JSON **byte-equal** (price, band bounds, probability, threshold, badge, micro-market stats, per-factor names/values, model footer — compared using the production `format.js` helpers). Extreme inputs render sanely with no `NaN`/`undefined`/`null` text, noise neighborhoods show the `nearest-cluster fallback` badge, 5 concurrent submits settle consistently, mid-load navigation produces zero page errors, 390×844 mobile layout has no horizontal overflow, and the backend-down → "Try again" → restart → recovery cycle works end-to-end. Three P3 observations (extrapolation caveat, stale E2E.md note, mobile ellipsis).

## Environment & startup (as a user would do it)

```bash
# terminal 1
CORS_ORIGINS=http://localhost:5200 .venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8100
# terminal 2
cd frontend && VITE_API_URL=http://localhost:8100 npm run dev -- --port 5200 --strictPort
```

Both came up clean; `GET /health` → `{"status":"ok","models_loaded":{"regression":true,"classification":true}}`; frontend 200. Ambient load: other wave-B auditors ran servers concurrently (8300, 8400/5400, 8500, docker 18xxx) — no port conflicts; none of my assertions are wall-clock sensitive.

## Evidence index

| File | Contents |
|---|---|
| `evidence/blackbox-e2e-existing-suite.txt` | Full `npx playwright test` output — 5 passed (19.5s), EXIT:0 |
| `evidence/blackbox-e2e-audit-spec.txt` | Full run of my 11-test spec — 11 passed (1.1m), EXIT:0 |
| `evidence/blackbox-e2e-extreme-max.png` | Max-everything property result card ($1,346,195, sane band/gauge/factors) |
| `evidence/blackbox-e2e-fallback-badge.png` | Timber result card with `NEAREST-CLUSTER FALLBACK` badge |
| `evidence/blackbox-e2e-mobile-390.png` | 390×844 full-page render (header pinned for stitch artifact only) |

## Claim verification

| # | Claim (source) | Result | Verdict |
|---|---|---|---|
| C1 | "E2E 5/5 passing" (README.md:30, FINAL-RELEASE.md:19, E2E.md; AUDIT_PLAN A11) | Re-ran `cd e2e && npx playwright test` against my fresh stack: **5 passed (19.5s), exit 0** (evidence: blackbox-e2e-existing-suite.txt) | **PASS — verified by execution** |
| C2 | "Backend down → error state with Try again → recovers" (mission §22 step 4) | Test 11: killed :8100 → `API offline` pill → submit → `role="alert"` "Cannot reach the PropPulse API" **with a visible `Try again` button** → restarted backend (same command) → click Try again → `No valuation yet` → resubmit → result card ($ price) → pill back to `API connected`. 31.9s total | **PASS — verified by execution** |
| C3 | "Noise-fallback neighborhoods show a fallback indication" (clustering.md: CollgCr, NAmes, Timber) | Test 4: each of CollgCr/NAmes/Timber → `micro_market.fallback === true` in the intercepted JSON **and** amber `nearest-cluster fallback` badge visible; control StoneBr → `fallback === false`, badge absent (screenshot: blackbox-e2e-fallback-badge.png) | **PASS — verified by execution** |
| C4 | "No client-side fabrication — DOM equals API JSON" (frontend-static.md §1, static) | Test 1 trace-truth: intercepted `/predict` JSON vs DOM byte-equal via production formatters: `.result-price` == `formatUsd(estimated_price)`; band low/high/marker; `.prob-gauge-value` == `formatPct(probability)`; threshold label; badge text from `sells_within_30_days`; meter `aria-valuenow`; micro-market label + all 4 stats; fallback badge count; factor count + per-row `prettyFeature(feature)` and `±formatPct(magnitude,1)` (incl. U+2212 minus); footer contains all 3 `model_version` fields | **PASS — verified by execution** |
| C5 | "Unknown neighborhood cannot be selected; select lists the 25" (mission §22 step 4) | Test 10: option values === the 25 codes parsed independently from `data/external/neighborhood_geo.csv` (sorted, exact array equality); `selectOption('NoSuchHood')` rejects (2s timeout, throws) | **PASS — verified by execution** |
| C6 | "Extreme-but-valid property renders sanely" (mission §22 step 3) | Test 2 (8 bd, qual 10, 6000 sqft, lot 200000, 2026, 5 garage, 4 fp, NoRidge): price **$1,346,195**, band $1,169,209–$1,512,730, prob 13.1%, sane DOM, no garbage text (screenshot). Test 3 (min everything, MeadowV): finite price in (0, $500k), sane render. Both assert no `/\bNaN\b|\bundefined\b|\bnull\b/` in the result card | **PASS — verified by execution** (see F1) |
| C7 | "Rapid 5× submit → consistent final state" (mission §22 step 3) | Test 5: 5 synchronous `requestSubmit()` → 5 concurrent POSTs (button-disabled bypass); all 5 responses price-identical (deterministic model); exactly 1 result card; DOM equals last JSON; no mixed state | **PASS — verified by execution** |
| C8 | "Switch pages mid-load → no crash" (mission §22 step 3) | Test 6: map → insights → valuation clicked immediately after navigation; zero `pageerror`s; no garbage text; returning to map re-fetches and renders ≥20 markers | **PASS — verified by execution** |
| C9 | "Mobile 390×844 usable, no overlap" (mission §22 step 3; E2E.md gap "single viewport") | Test 7: `scrollWidth − clientWidth ≤ 1` (no horizontal overflow); result renders; screenshot inspected at native res — header/nav/form/result all single-column, no overlap | **PASS — verified by execution** (see F3) |
| C10 | "Reload mid-session behaves" (mission §22 step 3) | Test 8: after a result, reload → documented `No valuation yet` empty state (React state intentionally not persisted); resubmit works | **PASS — verified by execution** |
| C11 | "422 out-of-range field (bypassing HTML5) → field error listed" (E2E.md scenario 2, extended) | Test 9: `noValidate` + `bedrooms=99` → `role="alert"` contains `bedrooms`; no result card. (Existing suite covers `gr_liv_area`.) | **PASS — verified by execution** |

Live values observed this run (cross-check material): realistic Somerst property → **$193,700**, band $168,234–$217,662, prob 31.0% ("Likely to sell within 30 days"), micro-market "mid northwest" ($179,900 median, $119.4/sqft, 27.8% velocity, 14 hoods); Timber → $165,214 with fallback badge "mid southeast"; footer `ridge_v1 + random_forest_v1 · features 9b0f8ba4201c`.

## Findings

| # | Severity | Location | One-liner | Evidence |
|---|---|---|---|---|
| F1 | **P3** | product/UX (backend `prediction_service` + `Valuation.jsx`) | Max-everything out-of-distribution input extrapolates to **$1,346,195** — ~1.8× the $755k training max — rendered with full confidence and no "outside training distribution" caveat. Ridge-on-log1p extrapolation is expected model behavior; the UX gap is the missing disclaimer. | blackbox-e2e-extreme-max.png; test 2 in blackbox-e2e-audit-spec.txt |
| F2 | **P3** (docs) | `reports/E2E.md:103-106` | Stale note: "the valuation-page error card offers no 'Try again' button". The current page **does** pass `onRetry` (`Valuation.jsx:288`) and the button was clicked at runtime in test 11. E2E.md's own scenario 5 predates the fix. | blackbox-e2e-audit-spec.txt test 11; `frontend/src/pages/Valuation.jsx:286-290` |
| F3 | **P3** (cosmetic) | `frontend/src/styles.css` (`.factor-name`) | On 390px the 5th factor name truncates to "Neighborhood medi…" (CSS ellipsis; full text only via `title` tooltip, which touch devices can't hover). Readable, not blocking. | blackbox-e2e-mobile-390.png (factor list region) |

Non-findings explicitly checked and cleared: sticky header floating mid-page in unstitched fullPage captures (Playwright stitching artifact, already documented in E2E.md:78-81 — pinned for my evidence shots); `API offline` pill latency after kill (flips on next poll — immediate on fresh page load); double-submit button disabled state (enforceable only against real clicks — `requestSubmit()` bypass tested separately in C7); reload losing the result (intended — no persistence anywhere in the design).

## Side effects disclosed (orchestrator must know)

1. **`docs/screenshots/*.png` regenerated** (5 files, new bytes/timestamps 19:15) — unavoidable side effect of running the sanctioned existing suite (its `shot()` helper writes there). Content equivalent to prior captures.
2. **`e2e/tests/audit-blackbox.spec.js` added** (permitted). Note for future full-suite runs: it contains its own port-8100 kill + detached restart (test 11), runs before `dashboard.spec.js` alphabetically, and leaves a backend listening on 8100 after it — which `dashboard.spec.js`'s final test then kills. Verified this ordering by running my spec while the suite-owned backend was down.
3. **`logs/predictions.jsonl` restored byte-identical**: pre-run sha256 `6972fb1452b45a8ea455dc4a6ecba87dd82aa553478d75747e60349cafafcf1b` (19 lines) → backed up before any server start → post-run `cp` restore → sha256 re-verified identical → backup deleted. The ~30 prediction rows my runs appended are therefore gone (per the restore rule).
4. **Ports**: 8100 and 5200 verified free after cleanup (`netstat -ano` → no LISTENING entries). One wrinkle: `TaskStop` on the npm wrapper left the vite child alive; killed PID 16328 explicitly — worth noting for other agents' cleanup scripts.

## Coverage

- Executed: full existing suite (5/5), 11 ad-hoc tests covering §22 steps 3–5 in full, startup per README/E2E.md, health pill both states, CORS (frontend on 5200 → backend 8100 with `CORS_ORIGINS=http://localhost:5200` — all browser fetches succeeded, so the origin was accepted).
- Not covered (out of scope / other agents): WebKit/Firefox (chromium-only per config), API contract details (contract agent), latency (performance agent), docker path (devops agent), accessibility tree audit beyond the mobile visual check.

## Contradictions for the orchestrator

1. **E2E.md "no Try again on valuation page" is stale** (F2) — if docs-truth quoted that bullet as current behavior, it needs a correction entry; runtime proves the button exists and works.
2. **E2E.md "drift `no_data`" vs frontend-static "latest.json status ok"**: my run's insights-page assertions don't pin the drift branch (the existing test accepts both). No contradiction observed at runtime — flagging only so wave-D doesn't merge the two wave-A statements as conflicting.
3. **predictions.jsonl line count**: other agents (contract, performance, docs-truth) backed up/restored or read this log concurrently; my restore reset it to the 19-line pre-run state captured at ~19:05. If another agent captured a different baseline later, their restore wins chronology — reconcile in wave-D if counts are compared.
