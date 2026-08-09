# Agent Log — features

**Scope:** `ml/features/**`, `tests/features/**`, and the artifacts
`models/neighborhood_stats.json`, `models/feature_defaults.json`,
`models/feature_list.json`. Status: **complete**, all tests green.

## What was built (SPEC §5)

- `ml/features/pipeline.py`
  - `RAW_INPUT_COLUMNS` — 79 raw processed-CSV columns (all 85 minus the
    excluded `Id`, `SalePrice`, `days_on_market`, `sells_within_30_days`,
    `SaleType`, `SaleCondition`).
  - `MODEL_FEATURES` — **94 features** = 79 raw + 11 engineered
    (`property_age`, `years_since_remod`, `total_bath`,
    `living_area_per_bedroom`, `bathroom_bedroom_ratio`, `total_sf`,
    `sale_month`, `sale_quarter`, `sale_year`,
    `distance_to_city_center_km`, `amenity_count`) + 4 neighborhood stats
    (`neighborhood_median_price`, `neighborhood_mean_price`,
    `neighborhood_median_price_per_sqft`,
    `neighborhood_monthly_sale_velocity`). `lat`/`long` passthrough already
    sit in `RAW_INPUT_COLUMNS`.
  - `build_feature_frame(df, stats=None)` — applies FEATURE_DEFAULTS for
    missing optional columns, geo-joins `lat`/`long` from
    `data/external/neighborhood_geo.csv` when absent (unseen neighborhoods →
    defaults), zero-division guard on `BedroomAbvGr == 0` (treated as 1),
    haversine to downtown Ames (42.0347, -93.6199), joins train-only
    neighborhood stats with global fallback. `stats=None` loads the persisted
    artifact (serving path).
  - `neighborhood_coordinates(neighborhood)` — shared centroid lookup used by
    serving (no duplicated geo logic).
  - `write_feature_list()` + `python -m ml.features.pipeline` CLI regenerates
    all three artifacts from the train split only.
- `ml/features/stats.py` — `NeighborhoodStats` dataclass,
  `fit_neighborhood_stats(train_df)` (median/mean SalePrice, median
  price_per_sqft, `monthly_sale_velocity` = train sales / 36 distinct train
  months), `save_/load_neighborhood_stats` (JSON). Fit: 945 train rows,
  25 neighborhoods, 36 months.
- `ml/features/defaults.py` — `compute_feature_defaults` (train mode for
  categoricals, median for numerics; integral medians of int columns stay
  ints), `save_/load_feature_defaults`, module-level `FEATURE_DEFAULTS`.
- `ml/features/serving.py` — `serving_payload_to_raw(payload) -> raw row`
  covering every `RAW_INPUT_COLUMNS` key. Handles `central_air` bool→"Y"/"N",
  `sale_date` (ISO string or date; default today) → `MoSold`/`YrSold` with
  explicit `mo_sold`/`yr_sold` overrides winning, `year_remod_add` defaulting
  to `year_built`, `lat`/`long` from the neighborhood centroid lookup, all
  other unspecified fields from FEATURE_DEFAULTS. Unknown keys raise
  `ValueError`. Full API→raw mapping table in the module docstring.
- `ml/features/__init__.py` — lazy (PEP 562) re-exports of the public API.

## Artifacts (regenerate: `.venv/Scripts/python.exe -m ml.features.pipeline`)

- `models/neighborhood_stats.json` — 25 neighborhoods + `global_fallback`
  (median_price 164990.0, mean_price 182125.13, median_price_per_sqft
  120.579, monthly_sale_velocity 26.25 = 945/36).
- `models/feature_defaults.json` — 79 defaults (wrapped format with
  provenance; loader also accepts a bare mapping).
- `models/feature_list.json` — `{"features": [...94...], "generated_from":
  "ml.features.pipeline", "sha1": "7601f2f66c747fe43b5900019dd9762ad86ea75f"}`
  (sha1 over `json.dumps(MODEL_FEATURES)`; use as `feature_version` in
  `champion.json`).

## Verification (venv python, from repo root)

- `.venv/Scripts/python.exe -m pytest tests/features -q` → **14 passed**.
- Full suite `.venv/Scripts/python.exe -m pytest tests -q` → **24 passed**
  (nothing outside my scope broken).
- Tests prove: identical MODEL_FEATURES columns + zero NaNs on
  train/val/test; stats equal train-only medians and differ from full-data
  medians for at least one neighborhood; unseen-neighborhood fallback;
  serving round-trip of a minimal SPEC §8 payload → complete raw row →
  NaN-free feature frame (e.g. NAmes/2009-06-15 payload → distance 0.877 km,
  joined median_price 140000.0).

## Notes for other agents

- Training: read `MODEL_FEATURES` from `models/feature_list.json`; models
  consume the `build_feature_frame` output directly (preprocessing lives in
  the sklearn Pipeline per SPEC §5).
- Backend: import `serving_payload_to_raw` from `ml.features.serving` — the
  single sanctioned mapping; do not re-implement.
- Clustering (ADR-9): per-neighborhood `median_price_per_sqft` and
  `monthly_sale_velocity` are available in `models/neighborhood_stats.json`
  (train-only), alongside `lat`/`long` in the processed CSVs.
