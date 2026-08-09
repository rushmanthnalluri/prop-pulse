# PropPulse — 5-minute demo walkthrough

A guided tour of the running system: one realistic property through the
Valuation page, then the Market Map and Model Insights views, with the
talking points each screen supports. Everything shown is served live by the
API — no number in the UI is hardcoded.

## 0. Start the stack (1 min)

From the repo root (Git Bash on Windows), two terminals:

```bash
# terminal 1 — backend → http://127.0.0.1:8000 (Swagger UI at /docs)
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# terminal 2 — frontend → http://localhost:5173
cd frontend && npm run dev
```

Startup loads both champions and pre-builds the SHAP explainer, so the first
prediction is already fast (≈ 0.5 s cold, warm p50 ≈ 197 ms on an otherwise
idle machine — contended runs measure 2–3× higher; `reports/PERFORMANCE.md`).
The header indicator flips to **API connected** once `/health` answers.

## 1. Valuation — the example property (2 min)

Open http://localhost:5173 and enter this Northridge Heights two-story
(a realistic 2005 Ames family home):

| Field | Value |
|---|---|
| Neighborhood | Northridge Heights (`NridgHt`) |
| House style | `2Story` |
| Bedrooms | 4 |
| Full baths / Half baths | 2 / 1 |
| Basement full / half baths | 1 / 0 |
| Living area (sqft) | 2500 |
| Lot area (sqft) | 10000 |
| Basement area (sqft) | 1300 |
| Year built | 2005 |
| Overall quality / condition | 8 / 5 |
| Garage (cars) | 2 |
| Fireplaces | 1 |
| Central air | Yes |

Press **Estimate value**. Expected result (measured against the committed
champions, 2026-08-08 — small float differences are normal):

- **Estimated price ≈ $262,468**, with the ~80% prediction-interval band
  **$227,961 – $294,937**.
- **30-day sale probability ≈ 25.1%** against the **20.3% operating
  threshold** → the gauge flags a *fast-sale signal (simulated target)*.
- **Micro-market: mid northwest** (cluster 0 — 14 neighborhoods, median
  $179,900, $119/sqft, `fallback: false`).
- **Top price factors**, all positive: OverallQual, GrLivArea, total_sf,
  neighborhood_median_price, neighborhood_mean_price.

What the screen shows, top to bottom: price hero with a per-prediction
confidence note, interval band with the estimate marker, market position
versus the neighborhood/cluster $/sqft medians, probability gauge with the
threshold marker, micro-market card, and the top-5 SHAP factor bars — with
the comparable-sales table and the what-if scenario explorer below the card.

**Error-state beat (30 s):** set Living area to `50` and submit. In a stock
browser the form's HTML5 `min` guard fires first (a native "Value must be
greater than or equal to 300" bubble — client-side validation working as
intended). To see a server error rendered in the UI, stop the backend
(Ctrl+C in its terminal) and submit again: the header flips to **API
offline** and the card shows *"Cannot reach the PropPulse API"* — **Try
again** dismisses it so you can re-submit once the backend is back (the form
keeps its values). With native validation disabled, an API 422 surfaces the
same way, naming the offending field verbatim (see
`docs/screenshots/error-state.png`).

## 2. Market Map (1 min)

Open **Market Map**. 25 circle markers — one per Ames neighborhood, colored
by micro-market cluster — over an OpenStreetMap basemap. Click any marker
for a popup with the cluster label, median price, median $/sqft, and 30-day
sale velocity. The three DBSCAN noise neighborhoods (CollgCr, NAmes, Timber)
are served through the nearest-centroid fallback and flagged as such.

## 3. Model Insights (1 min)

Open **Model Insights**:

- **Champion cards** — `ridge v1` (regression) and `random_forest v1`
  (classification), with validation *and* sealed-test metrics side by side.
- **Feature importance** — top-20 global SHAP bars (OverallQual, OverallCond,
  total_sf, GrLivArea, …), one-hot dummies aggregated back to readable base
  features.
- **Monitoring & drift** — drift status plus the latest PSI drift report
  (or the documented `No drift report yet` empty state until
  `python -m ml.monitoring.drift_check` has run; ops counters — requests,
  latency, uptime — remain available at the `/metrics` endpoint).

## Talking points

- **Leakage-safe features.** Every aggregate (neighborhood median price,
  price per sqft, sale velocity) is fit on the train split only, persisted as
  an artifact, and reused at serving time; `SaleType`/`SaleCondition` are
  excluded as not-knowable pre-listing; the DOM target columns are never
  features. One `ml/features/` pipeline is the single source of truth for
  training and serving — no re-implementation drift.
- **Champion-selection honesty.** Ridge beat XGBoost on validation RMSLE
  (0.1354 vs 0.1398), but the paired-bootstrap 95% CI for the gap
  ([−0.0133, +0.0060]) includes 0 — the README says so plainly. Selection is
  locked to validation by design; on the sealed 2010 test split XGBoost
  actually posts the lower RMSLE.
- **Calibrated probability + honest threshold.** The classifier is
  sigmoid-calibrated and the operating threshold (0.2033) is chosen on
  validation F1, not the naive 0.5 — at 0.5 recall collapses from 0.82 to
  0.08. And the target is **simulated** (ADR-3): probabilities are a product
  demo, not real-world sale-speed claims; a `DOM_PROVIDER=csv` adapter is
  wired for real days-on-market data.
- **Micro-markets.** DBSCAN over geography + train-split market stats finds
  4 micro-markets; noise/unseen neighborhoods fall back to the nearest
  centroid with `fallback: true` rather than failing.
- **Per-prediction SHAP.** Every valuation returns its own top-5 factors
  with sign and magnitude — the same explainer that produces the global
  importance chart.
- **Drift monitoring.** Every `/predict*` call is logged to
  `logs/predictions.jsonl` (the `/market/comps` lookup deliberately is not —
  it carries no prediction fields and must not pollute the drift window); the
  PSI check compares live traffic against the train reference and *recommends*
  retraining (warn ≥ 0.1, drift ≥ 0.2, ≥
  200 samples before recommending; calendar-only drift — `YrSold`,
  `sale_year`, … — is structural and never triggers the recommendation) —
  nothing ever retrains automatically.

## Reset

The demo writes nothing except prediction log lines. To reset completely:

1. Ctrl+C both dev servers.
2. Delete `logs/predictions.jsonl` (or just its newest lines) — it is
   gitignored runtime output, and the drift check reads it.
3. Reload the browser tab — the UI is stateless; a refresh returns the
   Valuation form to its defaults.
