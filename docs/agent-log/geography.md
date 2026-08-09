# Agent Log — geography

**Scope:** `ml/features/pipeline.py` (surgical extension),
`tests/features/test_geo_override.py` (new), `docs/GEOGRAPHY.md` (new),
`data/external/README.md` (new). Status: **complete**, all tests green.

## What was built

### 1. Property-level geo override (`ml/features/pipeline.py`)

Opt-in upgrade over the ADR-2 neighborhood centroids, active only when
`data/external/property_geo.csv` (schema `Id,lat,long`) exists — the file is
**not committed**, so the default behavior is unchanged:

- `_PROPERTY_GEO_PATH` module constant + `_AMES_LAT_RANGE` (41.98–42.09) /
  `_AMES_LONG_RANGE` (−93.72…−93.55) validation bounds (same bbox
  `data/README.md` documents for the centroids).
- `_property_geo_lookup(path)` — `lru_cache`-keyed on the path (monkeypatch-
  friendly; one "geo source" INFO log per file). Returns `None` when the file
  is absent. Raises `ValueError` on garbage: missing columns, zero rows,
  non-numeric or non-integer `Id`, duplicate `Id`, out-of-bbox coordinates.
- `_apply_property_geo_override(frame)` — no-op when the file is absent or the
  frame has no `Id` (serving rows); otherwise rows whose `Id` matches get the
  per-property `lat`/`long`, unmatched rows keep centroids. Per-frame match
  counts logged at DEBUG. Called in `build_feature_frame` after
  `_apply_defaults` (so `lat`/`long` always exist), before the
  `RAW_INPUT_COLUMNS` projection drops `Id`.
- `MODEL_FEATURES` untouched → `feature_version` unchanged. Module and
  `build_feature_frame` docstrings updated.

### 2. Tests — `tests/features/test_geo_override.py` (10 tests)

Override applied for matching Ids (incl. equivalence to a frame whose
processed data carried the real coordinates, and the INFO source log via
`caplog`); centroid fallback for unmatched Ids; serving frames without `Id`
unaffected; parametrized rejection (lat/long out of bbox, non-numeric,
duplicate Id, non-integer Id) + missing-column rejection; byte-identical
output (`assert_frame_equal` + `to_csv` bytes) when the file is absent.

### 3. `docs/GEOGRAPHY.md`

Current architecture (grain, Barbour & Fragkias 2025 provenance, consumers:
`ml/data` join, features passthrough + haversine, ADR-9 DBSCAN, frontend map),
verified numbers (25 points; dist-to-downtown 0.50–5.79 km; nearest-centroid
median 0.76 km / min 0.13 km MeadowV–Mitchel), honest error bounds (~±1 km
per-row noise; geo features effectively a 25-level categorical), limitations
(DBSCAN on 25 points, sale-weighted centroids, single reference point), the
`property_geo.csv` upgrade path, and future options (Census/Nominatim
geocoding, H3 indexing, richer spatial features, spatial CV).

### 4. `data/external/README.md`

File-by-file provenance, schemas, and confidence notes for
`neighborhood_geo.csv` (committed/required) and `property_geo.csv`
(optional/not committed), incl. validation rules and the retrain reminder.

## Verification (venv python, from repo root)

- `.venv/Scripts/python.exe -m pytest tests/features/test_geo_override.py -q`
  → **10 passed**.
- `.venv/Scripts/python.exe -m pytest tests/features tests/data -q` →
  **54 passed**.
- `.venv/Scripts/python.exe -m ml.features.pipeline` regenerated the three
  artifacts **byte-identical** (diff vs pre-run backup clean):
  `feature_list.json` sha1 `9b0f8ba4201c8d98020ad00c960ffd9d278ea255`
  (feature_version prefix `9b0f8ba4201c` unchanged), `feature_defaults.json`
  `749a0593dd12…`, `neighborhood_stats.json` `3568fd940942…`.
- Full suite `.venv/Scripts/python.exe -m pytest tests backend/tests -q` →
  **154 passed** (114 baseline + 10 mine + 30 from concurrent agents).

## Notes for other agents

- One transient failure observed mid-wave:
  `backend/tests/test_security.py::test_abuse_unicode_and_long_strings_rejected`
  failed during a full-suite run while other agents were editing backend
  files; it **passed standalone and on the clean rerun** (154 passed). Not
  related to this scope — flagging in case the security agent wants to check
  order/state sensitivity.
- The override lives only in the features layer; `ml/data` still writes
  centroids into the processed CSVs (by design — the processed files stay the
  geo carrier, and absence of `property_geo.csv` keeps everything
  byte-identical).
- If someone commits a real `property_geo.csv`: models must be retrained
  (`lat`/`long`/`distance_to_city_center_km` values change; `MODEL_FEATURES`
  does not).
