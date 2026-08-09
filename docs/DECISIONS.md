# PropPulse — Architecture Decision Records

## ADR-1: Dataset = Ames Housing (found in repo)
`house-prices-advanced-regression-techniques1.zip` (Kaggle, Ames IA 2006–2010,
1460 labeled rows). Real data, rich attributes (79 features incl. quality/condition/
amenities). `test.csv` has no target → all splits come from `train.csv`.

## ADR-2: Geolocation fallback = documented neighborhood centroids
Ames has `Neighborhood` (25 areas) but no per-property coordinates.
`data/external/neighborhood_geo.csv` maps each neighborhood to an **approximate real
centroid** in Ames, IA (hand-compiled from public maps; approximation documented in
`data/README.md`). City center = downtown Ames (42.0347, -93.6199). Clustering therefore
discovers micro-markets of neighborhoods, not street-level segments.

## ADR-3: days-on-market = transparent simulated target (documented fallback)
No public dataset with DOM + price + location is available in-repo, and MLS/Redfin DOM
data requires credentials. `ml/data/sale_speed.py` simulates `days_on_market` from a
transparent, seeded function of real features, with a clean interface to drop in real
DOM later. The exact model (`SaleSpeedSimulator.transform`):

```
log(days) = log(45)
            + 0.9 * log(SalePrice / nbhd_median)   [ratio clipped to 0.5-2.0]
            - 0.06 * (OverallQual - 5) - 0.04 * (OverallCond - 5)
            + season(MoSold)
            + noise ~ N(0, 0.35), seeded by (RANDOM_SEED, Id)
```

`nbhd_median` is the train-split median SalePrice per neighborhood (global train
median for unseen ones). `season` is a fixed month map, additive on log days:
Dec-Feb +0.25, Mar-May -0.10, Jun-Aug -0.05, Sep-Nov +0.05. The per-row noise is
deterministic per property and independent of row order. The result is
exponentiated, clipped to [1, 365] and rounded to integer days. There is **no
market-velocity input** — an earlier version of this ADR listed one in error;
monthly sale velocity appears only in the clustering matrix and descriptive
stats, never in the DOM formula. All classification metrics are labelled:
simulated target, not real-world performance.

**Addendum (dom-adapter, 2026-08-07) — real-DOM adapter landed.** The drop-in
interface promised above is now implemented. `RealDomProvider` in
`ml/data/sale_speed.py` loads an observed `Id,days_on_market` CSV with strict
validation: integer days in [1, 365], unique Ids, and a coverage check against
each split (`min_coverage`, default 0.95) that raises with matched/missing
counts instead of producing silent NaNs. `ml/data/pipeline.py` selects the
provider via env vars `DOM_PROVIDER=simulated|csv` (default `simulated`) and
`DOM_CSV_PATH` (default `data/external/days_on_market.csv`), logs the active
provider, fails fast with a helpful message if the CSV is missing, and records
the target's provenance in `data/processed/schema.json`. The simulated default
is unchanged: re-running the default pipeline reproduces
`data/processed/{train,val,test}.csv` byte-identically (md5-verified), so
existing champions remain valid. Usage + retrain checklist:
`data/README.md` → "Using real days-on-market data".

## ADR-4: Time-based split, sealed test
Train YrSold≤2008 / val 2009 / test 2010. Prevents temporal leakage; test touched once.

## ADR-5: Frontend = Vite + React (not Next.js)
Spec allows "React / Next.js". Vite is lighter, faster to build, no SSR needed for a
dashboard calling our own API. `VITE_API_URL` configures the backend URL.

## ADR-6: Python 3.14 (only interpreter on this machine)
pandas 3.0.3/numpy 2.4.6 verified. If any pinned package lacks cp314 wheels, the
installing agent must record the exact failure here and use the newest compatible
version; final `requirements.txt` reflects what actually installed.

**Update (scaffold agent, 2026-08-07) — final resolved versions:**
All assigned packages installed on Python 3.14.5 — **no package was a casualty**
(shap 0.52.0 works, incl. a TreeExplainer smoke test). Two resolver-driven
downgrades, verified in installed package metadata:
1. `mlflow==3.15.1` declares `Requires-Dist: pandas<3` → pandas resolved to
   **2.3.3** (not the 3.0.5 that pip initially installed). SPEC §1's
   "pandas 3.0.3 confirmed" is superseded: the project-wide pandas baseline is 2.3.3.
2. `numba==0.66.0` (runtime dependency of shap) declares `numpy<2.5,>=1.22` →
   numpy resolved to **2.4.6** (matches the SPEC-confirmed version).
`pip check` reports no broken requirements. One transient DNS failure
(`files.pythonhosted.org` NameResolutionError) hit the first mlflow download
attempt; a retry after ~45s succeeded with no package changes.

## ADR-7: Docker containers pin python:3.12 (independent of host 3.14)
The dev machine runs Python 3.14 only; containers use `python:3.12-slim` for a
stable, widely-wheeled target. The daemon was unavailable during the build waves
(static validation only); **superseded in wave 9**: images build cleanly and the
full compose stack passed an in-container smoke test (`reports/DOCKER_SMOKE.md`).

## ADR-8: MLflow = local file store, registry = models/registry/ + champion.json
No server dependency for local runs; `MLFLOW_TRACKING_URI` env can point to a real
server in deployment (compose includes an optional mlflow service).

## ADR-9: Clustering = DBSCAN on scaled [lat, long, median price_per_sqft, sale velocity]
Density-based, no assumed cluster count (per spec). Neighborhood-level points (25)
with train-split market aggregates. Serving maps a property's neighborhood → cluster;
unseen/noise neighborhoods → nearest cluster centroid with `label` noting fallback.

## ADR-10: Regression target trained as log1p(SalePrice)
Prices are right-skewed; RMSLE is the primary champion metric; dollar metrics via expm1.

## ADR-11: MSSubClass served as a scaled numeric (schema corrected; one-hot deferred)
`MSSubClass` is a categorical code semantically, but the processed-CSV round-trip
re-infers it as `int64`, so the dtype-driven preprocessor median-imputes and
StandardScaler-scales it as a numeric magnitude (no train/serve skew — both paths
see int64). Found during the 2026-08-07 forensic audit (AUD-13): `schema.json` was
corrected to declare the on-disk dtype (`int64`), and `ml/data/clean.py` documents
the behavior. **No retrain**: switching to one-hot would change the feature space
and invalidate the verified-working champions for a semantic preference — rejected
under "do not modify a working model without evidence of incorrectness". All
reported metrics are honest for the trained configuration. One-hot `MSSubClass` is
a documented future improvement that requires a full retrain + re-evaluation.
