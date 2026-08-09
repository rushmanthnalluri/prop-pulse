# data/external — external reference data

Small, hand-maintained lookup files that patch documented gaps in the Ames
dataset (SPEC §2). Everything here is non-secret and safe to commit unless
noted otherwise. See `docs/GEOGRAPHY.md` for the full geographic architecture
and `data/README.md` for the raw-dataset fallbacks (ADR-2/ADR-3).

## `neighborhood_geo.csv` (committed, required)

Maps each of the 25 Ames `Neighborhood` codes to an **approximate real-world
centroid**. Required by `ml.data.ingest` / `ml.data.pipeline` (joined onto
every processed row) and by `ml.features.pipeline` (serving rows, unseen
neighborhood fallback).

Schema (25 rows, one per neighborhood, no header quirks — plain CSV):

| column | type | meaning |
|---|---|---|
| `Neighborhood` | str | dataset code (e.g. `NAmes`) — join key |
| `name` | str | human-readable name (e.g. `North Ames`) |
| `lat` | float | approximate centroid latitude (WGS-84) |
| `long` | float | approximate centroid longitude (WGS-84) |
| `note` | str | provenance + locality caveat for that row |

**Provenance.** Centroids were computed as the mean location of the geocoded
2006–2010 sale locations per neighborhood from the peer-reviewed companion
dataset — Barbour & Fragkias, "Spatializing Ames", *Data in Brief* 63, 2025,
doi:10.1016/j.dib.2025.112155 — and cross-checked against OpenStreetMap named
features. City-center reference used by the feature pipeline: downtown Ames
(42.0347, −93.6199).

**Confidence notes.**

- These are **approximations, not official boundary centroids**: each point is
  the sales-weighted mean of where transactions happened, so it is biased
  toward developed streets.
- Accuracy is neighborhood-grain only: a given property is typically a few
  hundred metres (up to ~1 km) from its assigned point; elongated
  neighborhoods (notably `IDOTRR` along the rail corridor) are less well
  represented — see the per-row `note`.
- All 25 points lie inside the Ames validation bounding box
  (lat 41.98–42.09, long −93.72…−93.55); `ml.data` fails the pipeline if a
  neighborhood is missing from this file.

## `property_geo.csv` (optional, **not committed**)

Opt-in per-property coordinate override consumed by
`ml.features.pipeline.build_feature_frame` (docs/GEOGRAPHY.md §4). When the
file is absent the pipeline behaves exactly as with centroids only.

Schema: header `Id,lat,long`, one row per property.

| column | type | meaning |
|---|---|---|
| `Id` | int | property id matching the `Id` column of the raw/processed frames |
| `lat` | float | property latitude (WGS-84) |
| `long` | float | property longitude (WGS-84) |

**Semantics.** Rows whose `Id` appears here get these coordinates (and a
recomputed `distance_to_city_center_km`); every other row keeps its
neighborhood centroid. Partial coverage is fine. Serving payloads (no `Id`)
always use centroids.

**Validation (fail-loud).** Loading raises `ValueError` on: missing columns,
zero rows, non-numeric or non-integer `Id`, duplicate `Id`, or any coordinate
outside the Ames bounding box (lat 41.98–42.09, long −93.72…−93.55).

**Confidence notes.** The pipeline guarantees the coordinates are *plausible*
(in-bbox, well-typed) — correctness of the geocoding itself is the producer's
responsibility. Suggested sources: the geocoded sale locations in the
Barbour & Fragkias companion dataset (requires matching to Kaggle `Id`s), or
your own run of the US Census batch geocoder / Nominatim over sale addresses.
After adding the file, **retrain** the models: `MODEL_FEATURES` and the
`feature_version` hash are unchanged, but `lat`/`long` values change.
