# Geography — architecture, limitations, and upgrade paths

How PropPulse represents location today, how good that representation
honestly is, and how to upgrade it. Binding context: SPEC §2 (fallback 1),
ADR-2 (centroid fallback), ADR-9 (neighborhood-grain clustering).

## 1. Current architecture

**Grain: the neighborhood.** The Ames dataset has `Neighborhood` (25 areas)
but no per-property coordinates. `data/external/neighborhood_geo.csv` maps
each of the 25 neighborhoods to one approximate real-world centroid in Ames,
IA — so every property inherits its neighborhood's point.

**Provenance.** Centroids were computed as the mean location of the geocoded
2006–2010 sale locations per neighborhood from the peer-reviewed companion
dataset (Barbour & Fragkias, "Spatializing Ames", *Data in Brief* 63, 2025,
doi:10.1016/j.dib.2025.112155), cross-checked against OpenStreetMap named
features. They are **approximations**: means of where sales happened, not
official boundary centroids. Full schema and confidence notes:
`data/external/README.md`.

**Key numbers (verified against the committed files):**

- 25 unique `(lat, long)` points; the processed splits carry exactly these 25
  pairs — nothing finer.
- All points lie inside the Ames bounding box used for validation:
  lat 41.98–42.09, long −93.72…−93.55 (actual span: lat 41.9920–42.0627,
  long −93.6868…−93.6033).
- Distance from a centroid to the downtown reference (42.0347, −93.6199):
  0.50–5.79 km.
- Nearest-neighbour distance between centroids: median 0.76 km, min 0.13 km
  (MeadowV/Mitchel are nearly the same point), max 1.62 km.

**Who consumes geography:**

- `ml/data` (`ingest.load_neighborhood_geo`, `pipeline.join_neighborhood_geo`)
  left-joins `lat`/`long` onto every processed row and fails the pipeline if a
  neighborhood has no centroid. The processed CSVs are the geo carrier.
- `ml/features/pipeline.py` passes `lat`/`long` through as model features
  (they sit in `RAW_INPUT_COLUMNS`), derives `distance_to_city_center_km`
  (haversine to downtown), and fills coordinates for serving rows that only
  know their `Neighborhood` (`_fill_geo_from_neighborhood` /
  `neighborhood_coordinates()`; unseen neighborhoods → `FEATURE_DEFAULTS`
  coordinates, consistent with the stats global fallback).
- `ml/clustering` (ADR-9) runs DBSCAN (`eps=1.317`, `min_samples=2`, eps from
  the k-distance knee) over the 25 neighborhood points on scaled
  `[lat, long, median_price_per_sqft, monthly_sale_velocity]` (train-split
  stats) → 4 micro-markets + 3 noise neighborhoods (CollgCr, NAmes, Timber).
  Serving maps a property's neighborhood to its cluster; noise/unseen
  neighborhoods fall back to the nearest cluster centroid.
- The frontend Market Map renders these 25 centroid markers from
  `/market/clusters`.

## 2. Error bounds (honest)

- A property sits somewhere inside its neighborhood; the centroid is the
  sales-weighted mean point. Ames neighborhoods are roughly 0.5–1.5 km across
  (nearest centroids are 0.13–1.62 km apart), so a property's displacement
  from its assigned point is typically a few hundred metres, up to ~1 km —
  worse for elongated areas (IDOTRR runs along the UP rail corridor; its
  centroid is flagged "less representative" in the CSV notes).
- Consequence for features: `lat`, `long`, and `distance_to_city_center_km`
  are **identical for every property in a neighborhood** and carry up to
  ~±1 km per-row noise. The models cannot learn within-neighborhood spatial
  effects (e.g. walking distance to the ISU campus, adjacency to rail).
  Geographically the features behave like a 25-level categorical.

## 3. Limitations

1. **No per-property coordinates** — street-level valuation differences are
   invisible by construction.
2. **Only 25 unique points** — DBSCAN density is estimated from 25 samples;
   `eps` comes from a k-distance knee over very few distances, and centroid
   error alone can push a point across a density boundary. The 3 noise
   neighborhoods (12% of points) are partly an artifact of this coarse grain —
   e.g. MeadowV/Mitchel form a tight pair (0.13 km apart) while genuinely
   isolated neighborhoods get labelled noise.
3. **Sale-weighted centroids** — biased toward where 2006–2010 sales happened,
   not the geographic middle of the neighborhood; areas developed after 2010
   are not represented at all.
4. **Single reference point** — `distance_to_city_center_km` uses downtown
   Ames only; no distances to campus, employers, or amenities.

## 4. Upgrade path now available: `property_geo.csv`

`ml/features/pipeline.py` supports an opt-in per-property override:

- Drop `data/external/property_geo.csv` (schema `Id,lat,long`) into the repo.
  It is **not committed** — absence keeps the centroid behavior exactly
  (verified byte-identical by `tests/features/test_geo_override.py`).
- `build_feature_frame` joins on `Id`: matched rows get the per-property
  coordinates (and a recomputed `distance_to_city_center_km`); rows missing
  from the file keep their neighborhood centroids. Frames without an `Id`
  column (serving payloads) are unaffected. `Id` itself never becomes a model
  feature.
- The file is validated at load: missing columns, zero rows, non-numeric or
  non-integer `Id`, duplicate `Id`, or coordinates outside the Ames bounding
  box (lat 41.98–42.09, long −93.72…−93.55) raise `ValueError` — garbage fails
  loudly instead of silently corrupting features.
- The geo source is logged: one INFO line per file naming the override and
  its size; per-frame match counts at DEBUG.
- `MODEL_FEATURES` is unchanged, so `models/feature_list.json` and the
  `feature_version` hash are unchanged — but the **values** of `lat`, `long`,
  and `distance_to_city_center_km` change, so models must be **retrained** to
  benefit; the committed champions were trained on centroids.

How to produce the file: the Barbour & Fragkias companion dataset contains
the geocoded sale locations (address-level) for these sales — matching them to
the Kaggle `Id`s requires address/attribute matching and is deliberately left
out of scope here; alternatively geocode the addresses yourself (below).

## 5. Future options

- **Address-level geocoding** — US Census Bureau batch geocoder (free,
  no key) or Nominatim/OpenStreetMap (mind the usage policy; the companion
  dataset demonstrates the approach). Feeds `property_geo.csv` directly.
- **H3 hexagonal indexing** — replace raw coordinates with multi-resolution
  H3 cell ids as categorical features: smoother than 25 points, robust to
  small geocode errors, and composes with one-hot/embedding encoders.
- **Richer spatial features** — distances to ISU campus, downtown, rail and
  arterial roads; school attendance zones; flood plain flags. All become
  meaningful only with sub-neighborhood coordinates.
- **Spatially-aware validation** — with real coordinates, use spatial
  cross-validation (leave-one-area-out) to quantify spatial autocorrelation
  leakage, and revisit DBSCAN grain/eps on ~1,460 points instead of 25.

## 6. Tests

`tests/features/test_geo_override.py` (10 tests): override applied for
matching Ids, centroid fallback for unmatched Ids, serving rows without `Id`
unaffected, rejection of out-of-bbox / non-numeric / duplicate / non-integer /
missing-column override files, and byte-identical output when the file is
absent.
