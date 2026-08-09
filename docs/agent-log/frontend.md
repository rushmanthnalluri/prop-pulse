# Agent Log — frontend

**Scope owned:** `frontend/**` only. **Date:** 2026-08-07. **Status:** done, verified.

## What was built

The PropPulse dashboard per SPEC §9 (ADR-5: Vite + React), consuming the live
FastAPI backend. No prediction data is hardcoded anywhere — every rendered number
comes from an API response. Hand-rolled CSS (no framework), deep navy + teal
palette, Inter/system font stack, responsive (grid → stacked under 960 px),
loading / error / empty states on every async view, no gratuitous animation
(a spinner and short hover transitions only).

### File tree (frontend/, excluding node_modules/dist)

```
frontend/
  .env.example              VITE_API_URL (default http://localhost:8000)
  .gitignore  .gitkeep
  README.md                 stack choice, contract, commands, layout
  eslint.config.js          ESLint 9 flat config (react-hooks, react-refresh)
  index.html
  package.json  package-lock.json
  vite.config.js            dev :5173 (CORS origin), preview :4173
  public/favicon.svg        PropPulse mark
  src/
    main.jsx                React 19 root; imports leaflet CSS + styles.css
    App.jsx                 createBrowserRouter; Market Map & Insights lazy-loaded
    constants.js            25 neighborhoods + enum sets mirroring
                            backend/app/schemas/property.py; core form defaults;
                            advanced-field descriptors
    format.js               USD / % / uptime formatting, feature-label prettifier
    styles.css              design system (CSS variables, cards, bars, map, responsive)
    api/client.js           fetch wrapper; VITE_API_URL; ApiError; 422 detail-list → message
    api/useApi.js           loading/error/reload hook
    components/
      Layout.jsx            brand header, NavLink nav, /health API-status pill (30 s poll)
      StateView.jsx         Loading / ErrorState (retry) / EmptyState
      StatCard.jsx
      PriceBand.jsx         price-range band with point-estimate marker
      ProbabilityGauge.jsx  probability bar with model threshold marked (≠0.5, SPEC §14)
      FactorBars.jsx        ± SHAP factor bars (green/red)
    pages/
      Valuation.jsx         form → POST /predict → result card
      MarketMap.jsx         react-leaflet + OSM, markers colored by cluster, popups,
                            cluster stat cards
      ModelInsights.jsx     champion cards (/model/info), SHAP bar chart
                            (/model/importance, recharts), monitoring + drift (/metrics)
```

### Views

1. **Valuation** (`/`) — core fields prominent (neighborhood select with display
   names, house style, bedrooms, baths ×4, living/lot/basement area, year built,
   overall quality/condition, garage, fireplaces, central air); 39 advanced
   overrides behind a collapsible section, sent only when set so the backend
   applies `feature_defaults.json`. Result card: formatted USD estimate, range
   band (~80 % interval), probability bar with the 0.2033 operating threshold
   marked, micro-market card (incl. fallback badge), top-5 factor bars, model
   version footer.
2. **Market Map** (`/market-map`) — CircleMarkers colored by cluster_id (stable
   color map by sorted ids), popups with live cluster stats, side panel with one
   stat card per micro-market; centered on Ames (42.0347, -93.6199).
3. **Model Insights** (`/model-insights`) — champion/metric cards from
   /model/info (+ collapsible rationale), top-20 mean-|SHAP| horizontal bar chart
   from /model/importance, counters + per-feature PSI top-10 with warn/drift
   coloring from /metrics; `drift.status === "no_data"` renders an empty state.

## Verification evidence (all run for real)

- `npm install` — 201 packages; final resolved stack: **react 19.2.8,
  react-dom 19.2.8, react-router 8.3.0, react-leaflet 5.0.0, leaflet 1.9.4,
  recharts 2.15.4, vite 6.4.3**. `npm audit` → **found 0 vulnerabilities**.
- `npm run build` — ✓ built in ~20 s; route-level code-splitting:
  index 311 kB (gzip 98.7), MarketMap 158 kB, ModelInsights 389 kB, css 27.5 kB.
- `npm run lint` — clean (zero warnings).
- **Live smoke** (backend on :8000 + `npm run dev` on :5173):
  - `GET :8000/health` → 200 `{"status":"ok","models_loaded":{...true}}`.
  - `POST /predict` with the exact payload the form builds (core only) → 200,
    `estimated_price 155916.51`, range `[135417.92, 175204.76]`,
    `probability 0.2569 / threshold 0.203292`, cluster `0 "mid northwest"`,
    5 factors, `model_version ridge_v1+random_forest_v1 / 9b0f8ba4201c`.
  - `POST /predict` with advanced overrides (`kitchen_qual`, `garage_type`,
    `first_flr_sf`) → 200, `estimated_price 256890.53`.
  - Invalid neighborhood → **422** with `detail:[{loc:["body","neighborhood"],…}]`
    — matches the client's error formatter (strips `body`, joins the rest).
  - Vite dev server: 200 on `/`, `/src/main.jsx`, `/src/App.jsx`, Layout, all
    three page modules, favicon (first-hit 000s were startup races; warm = 200).
  - CORS preflight `OPTIONS /predict` from `Origin: http://localhost:5173` →
    200 with `access-control-allow-origin: http://localhost:5173`.
- **Production build**: `npm run preview` on :4173 → 200 for `/`, SPA fallbacks
  `/market-map` + `/model-insights`, hashed bundle, CSS, favicon.
- All three processes (uvicorn, vite dev, vite preview) killed afterwards;
  ports 8000/5173/4173 confirmed closed.
- Full browser E2E (clicking through the UI) is to be re-verified by QA.

## API-shape notes for the orchestrator

- **`GET /model/importance` returned 404** at verification time (integration-wave
  endpoint not yet landed). The frontend codes against the SPEC §14 contract
  (`{metadata, importance:{feature:weight}}`) and shows a dedicated graceful
  error state ("endpoint not available on this backend yet…") on 404. Once the
  endpoint ships it will just work; QA should re-check Model Insights after the
  integration wave.
- `/market/clusters` response aligned exactly with
  `cluster_service.py`/`responses.py`: `clusters[]` carry
  `cluster_id/label/neighborhoods/n_neighborhoods/n_sales/median_price/
  median_price_per_sqft/sale_velocity_30d/centroid_lat/centroid_long/note`;
  `neighborhoods[]` carry `neighborhood/name/lat/long/cluster_id/fallback`.
- `/predict` `micro_market` includes extra fields beyond the master-prompt list
  (`neighborhoods`, `n_sales`, `centroid_*`, `fallback`, `note`) — all consumed
  (fallback badge, neighborhoods tooltip). `sale_probability` includes
  `threshold` — rendered as the marked boundary.
- `/metrics.drift` live shape: `status: "ok"`, `per_feature_psi{}`,
  `warn_threshold`, `psi_threshold`, `drifted_features[]`,
  `retraining_recommended`, `n_predictions`, `timestamp` — all handled, plus the
  `no_data` empty state.
- **Dependency detour:** initial pin `react-router-dom@6.30.x` had 2 moderate
  advisories; the fix path led to react-router 8.3.0, which requires React ≥ 19.2.7
  → upgraded react/react-dom to 19.2.8 and react-leaflet to 5.0.0 (the
  React-19 line). Final audit: 0 vulnerabilities. Router imports come from
  `react-router` (v8 merged the DOM package). Stack change vs. master prompt
  ("react-router-dom, react-leaflet") is version-level only — same libraries,
  current majors.
- Backend CORS allows only `http://localhost:5173`, so the preview build (:4173)
  renders the shell but its API calls are CORS-blocked by design (SPEC §8) —
  expected, documented in frontend/README.md.
