# Wave 10 — Orchestrator decision log (2026-08-08)

Lead/orchestrator: Kimi. Scope: independent re-verification of v1.0.0, PlacementPredict
benchmark mining, red-team + innovation review, then a product-hardening wave and its
remediation. This file records the decisions; per-agent details live in the other logs
and in the final release report (`docs/agent-log/final-release.md`).

## Wave composition (13 agents)

| Agent | Role | Outcome |
|---|---|---|
| recon-1 | PlacementPredict reverse-engineering (read-only) | reference map + 11 adoption candidates |
| recon-2 | v1.0.0 independent verification | claims REAL: 210/210 tests, 8/8 endpoints live, no canned responses; 1 flaky latency test found |
| recon-3 | Red-team ML integrity | 3 objections (velocity caveat dropped in UI; sale_date=today extrapolation; ADR-3 formula misdescribed) |
| recon-4 | Innovation/product review | 6 ranked features + cut list |
| impl-1 | Backend: comps, trends, market_position, confidence, calendar clamp | done; 67 backend tests; honest 2006–2008 ranges (data-forced contract deviation) |
| impl-2 | Frontend: valuation page (comps, position, scenarios, confidence, prefill, declutter) | done; build+lint clean |
| impl-3 | Frontend: map/insights/client (velocity caveats, gauge wording, trends chart, declutter) | done; build+lint clean |
| impl-4 | Docs: ADR-3 fix, METHODOLOGY disclosures, MODEL_CARD.md, API.md | done |
| impl-5 | Tests/CI: flaky-test fix, clamp tests, pip-audit/npm-audit CI gates | done |
| integ-1 | Cross-agent seam reconciliation + full re-verification | 227/227 green; all 10 endpoints live-verified |
| e2e-1 | Playwright reconciliation + new coverage | (final run pending at time of writing) |
| redteam-2 | Objection-resolution verification + new-feature attack | OBJ-1/2/3 RESOLVED; 1 blocker + 2 should-fixes filed |
| fix-1 | Remediation: remodel-year clamp, disclosure parity, slider bounds | done; 232/232 green; live-smoke verified |

## Key decisions and rationale

1. **Calendar clamp (RT OBJ-2 → CHANGE).** Serving no longer stamps `sale_date=today`.
   Omitted dates default to the latest train month (2008-12, derived from
   `data/processed/train.csv`, not hardcoded); later dates clamp lexicographically and are
   disclosed via `confidence.reasons`. Measured pre-fix bias ≈2.2% on every default
   prediction; unguarded against future champion swaps. Accepted the prediction-value
   churn (docs re-measured) as the price of correctness.
2. **Velocity caveat in UI (RT OBJ-1 → CHANGE).** `cluster.note` now renders under every
   30-day-velocity display (map popup, cluster cards, valuation micro-market card) and the
   gauge badge reads "Fast-sale signal (simulated target)".
3. **New features accepted (innovation review):** comps panel, market-position strip,
   what-if scenario explorer, market-trends chart, per-prediction confidence flags,
   map→valuation prefill. All derivable from train-split data; nothing simulated presented
   as real. Declined: investment-attractiveness score (no rental/yield data — would be
   fabrication); per-property map pins (geo is neighbourhood-grain).
4. **PlacementPredict adoptions:** MODEL_CARD.md (added), strict pip-audit/npm-audit CI
   gate (added, one accepted CVE allow-listed with reference to reports/SECURITY.md).
   **Declined:** joblib SHA-guard before serving — pickles are not integrity-protectable
   by hashing and `feature_version` already guards schema drift; build-time training in
   Docker — N/A, PropPulse ships pre-built versioned artifacts (equivalent cold-start
   property, verified in reports/DOCKER_SMOKE.md).
5. **Comps/trends window is 2006–2008 by design** (train split only; val=2009/test=2010
   never served as comps). All human-facing text aligned to the honest range.
6. **`/market/comps` deliberately does not write to the prediction log** (response carries
   no prediction fields; comps/scenario traffic must not pollute PSI drift input).
   `/predict*` logs as before.
7. **Red-team blocker (wave-10 regression) fixed same-day:** `YearRemodAdd` now clamps to
   the clamped sale year server-side (`years_since_remod` can never go negative), scenario
   slider capped at 2008, reduced-confidence surfaced per lever, disclosure parity added to
   `/predict/sale-probability` (confidence block) and `/market/comps` (`calendar_clamped`).

## Evidence anchors

- 232 pytest passed (tests + backend/tests), 0 xfail/xpass — post-remediation run.
- Frontend `npm run build` zero warnings; `npm run lint` clean.
- Live smoke: `/predict` default → $261,464.40 (clamp-active default), `yr_sold=2026` →
  identical price + reduced-confidence reason; `/market/comps` → 5 real comps,
  percentile 21.3, `calendar_clamped` correct both ways; invalid payloads → clean 422.
- comps artifact: 945 train-only records, zero simulated-target columns (asserted at build).
