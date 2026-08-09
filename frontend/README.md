# PropPulse Frontend

React dashboard for the PropPulse property-valuation API (SPEC §9, ADR-5: Vite + React —
no SSR needed for a dashboard calling our own API).

## Stack

- **Vite 6 + React 19** (functional components only)
- **react-router 8** — three views: Valuation, Market Map, Model Insights
- **recharts 2** — feature-importance chart
- **react-leaflet 5 + leaflet 1.9** — Market Map with OpenStreetMap tiles
- **Hand-rolled CSS** (`src/styles.css`, CSS variables, deep navy + teal palette).
  No CSS framework: the UI is a handful of cards, bars, and a map, so a small
  purpose-built stylesheet keeps the bundle lean and the design exact.
- **ESLint 9** (flat config) — `npm run lint`

No prediction data is hardcoded anywhere — every number comes from the live API.

## API contract

Base URL from `VITE_API_URL` (default `http://localhost:8000`), routes are root-level
(no `/api` prefix). Consumed endpoints:

| Endpoint | Used by |
|---|---|
| `POST /predict` | Valuation — estimate, range, probability + threshold, micro-market, top factors |
| `GET /health` | Header API-status indicator (30s poll) |
| `GET /market/clusters` | Market Map — cluster stats + neighborhood points |
| `GET /model/info` | Model Insights — champion cards + metrics |
| `GET /model/importance` | Model Insights — SHAP importance chart (live endpoint, covered by backend router tests) |
| `GET /metrics` | Model Insights — request counters + drift panel (handles `status: no_data`) |

The valuation form mirrors `backend/app/schemas/property.py` exactly (25 neighborhoods,
enum sets, numeric ranges). Core fields are always sent; advanced overrides are only
included when set, so the backend applies `feature_defaults.json` for everything else.

## Develop

```bash
npm install
cp .env.example .env   # optional; default http://localhost:8000 works out of the box
npm run dev            # http://localhost:5173 (backend CORS allows this origin)
```

Backend (from repo root): `.venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8000`

## Build / verify

```bash
npm run lint       # eslint, zero warnings expected
npm run build      # production bundle in dist/
npm run preview    # serve the production build at http://localhost:4173
```

Note: the backend CORS allow-list defaults to `http://localhost:5173` and
`http://localhost:8080` (`CORS_ORIGINS` env var), so the preview server on
`:4173` renders the shell but its API calls are CORS-blocked unless
`CORS_ORIGINS` is extended.

## Layout

```
src/
  api/client.js        fetch wrapper + error normalisation (422 details → message)
  api/useApi.js        loading/error/reload hook
  components/          Layout (brand/nav/API status), StateView (loading/error/empty),
                       PriceBand, ProbabilityGauge, FactorBars, StatCard
  pages/               Valuation.jsx, MarketMap.jsx, ModelInsights.jsx
  constants.js         form enums mirroring the API schema + default form state
  format.js            USD/percent/feature-label formatting
  styles.css           design system
```
