# llba-features — Line-by-line forensic audit of `ml/features/*`

**Agent:** llba-features · **Date:** 2026-08-07 · **Mode:** report-only (no project source/config/doc modified; writes limited to `docs/audit/`)

**Verdict: PASS WITH CONCERN** — every load-bearing claim was independently re-verified by execution and holds. No P0/P1/P2 defects. Seven P3 observations (stale-cache semantics, docstring/hash mismatch, unvalidated edge inputs, redundant features).

**Evidence files:**
- `docs/audit/evidence/llba-features-core-verification.txt` (script: `llba-features-core-script.py.txt`) — feature-list/order/NaN/Inf/haversine/amenity/engineered-values/stats/defaults/dtype audit
- `docs/audit/evidence/llba-features-serving-cache.txt` (script: `llba-features-serving-cache-script.py.txt`) — schema↔serving mapping, parsing, error paths, cache probes, edge cases, parity, package exports
- Test run: `.venv/Scripts/python.exe -m pytest tests/features -q` → **24 passed in 1.18s**

Ambient note: no servers started, no ports used, no timing-sensitive measurements taken; ambient CPU load irrelevant to this audit. No git commands used (none exist).

---

## 1. Headline claims — independently verified by execution

| Claim | Result | Evidence |
|---|---|---|
| 94 MODEL_FEATURES | **TRUE** — 79 raw + 11 engineered + 4 stats = 94 | core §1 |
| `build_feature_frame` output columns == `models/feature_list.json` (exact order) | **TRUE** for train/val/test | core §1, §2 |
| feature_list.json internal `sha1` == sha1(json.dumps(MODEL_FEATURES)) | **TRUE** (`7601f2f6…`) | core §1 |
| Zero NaN on all three splits | **TRUE** — 945/338/175 rows, 0 NaN, 0 Inf (numeric) | core §2 |
| Row-count preservation | **TRUE** — 945/338/175 | core §3 |
| Haversine correctness | **TRUE** — max abs err 4.1e-13 km vs independent implementation; 1° latitude → 111.1949 km | core §4 |
| `amenity_count` == SPEC §5 formula (8 terms) | **TRUE** — all 945 train rows; range 0–7 | core §5 |
| Engineered formulas (age/remod/bath/sf/month/quarter/year/ratios) | **TRUE** — recomputed independently on all train rows | core §6 |
| Zero-division guard (bedrooms clip ≥1) | **TRUE** — 4 zero-bedroom rows in train produce finite ratios | core §6; test_features.py:111 |
| Neighborhood stats fit on train only | **PROVEN** — artifact == fresh train-only fit; 19/25 neighborhoods' medians differ from full-data medians | core §8 |
| Stats join correct per neighborhood on all splits | **TRUE** | core §7 |
| Unseen-neighborhood fallback (global stats) | **TRUE** — executed end-to-end (`NoSuchPlace`) | serving §F |
| FEATURE_DEFAULTS == train mode/median | **TRUE** — all 79 columns recomputed, zero mismatches | core §9 |
| No `'None'` string tokens / object dtypes in numeric engineered-input columns | **TRUE** on all splits | core §10 |
| serving API_TO_RAW ↔ `PropertyInput` schema 1:1 | **TRUE** — 55 fields both directions, no unmapped either way | serving §A |
| Every API field lands on the correct raw column | **TRUE** — 53 direct mappings + specials, full-payload probe | serving §B |
| feature_version plumbing (SPEC §14: 12-char sha1 of file bytes) | **TRUE** — `ml.tracking.feature_version` = `9b0f8ba4201c` == champion.json | serving §I |

## 2. Per-file reviewed-line table

| File | Lines | Reviewed | How |
|---|---|---|---|
| `ml/features/pipeline.py` | 529 | 529/529 | Read every line; all functions except `main`/`write_feature_list`-write-path executed directly or via test suite |
| `ml/features/serving.py` | 236 | 236/236 | Read every line; all functions executed (full-payload probe + parsing matrix) |
| `ml/features/stats.py` | 178 | 178/178 | Read every line; fit/load/round-trip executed; `save_*` write-path static-only (report-only constraint) |
| `ml/features/defaults.py` | 118 | 118/118 | Read every line; compute/load executed; `save_feature_defaults` write-path static-only |
| `ml/features/__init__.py` | 30 | 30/30 | Read every line; lazy exports executed (all 7 `__all__` names + AttributeError path) |

## 3. Per-function matrix — `pipeline.py`

| Function (lines) | Inputs / types | Validation | Side effects | Branches / error handling | Returns | Callers | Edge cases | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| `_geo_lookup` (219–226) | none; reads `data/external/neighborhood_geo.csv` | none (trusted file) | `lru_cache(maxsize=1)`; file IO once | none — malformed CSV would raise from pandas | `{Neighborhood: (lat,long)}` | `neighborhood_coordinates`, `_fill_geo_from_neighborhood` | stale after in-process file change (F1) | indirect (roundtrip, geo tests) | PASS WITH CONCERN |
| `neighborhood_coordinates` (229–244) | `neighborhood: str` | none | debug log | unseen → `FEATURE_DEFAULTS` lat/long | `(float, float)` | `serving.serving_payload_to_raw` | unseen → train-median coords (42.0333, −93.6403) | test_features.py:226 | PASS — verified by execution (all 25 == CSV, serving §H) |
| `_num` (247–249) | frame, column | `pd.to_numeric(errors="coerce")` | none | unparseable → NaN (silent) | float Series | `build_feature_frame` | would NaN on `'None'` tokens — verified none exist in engineered-input cols (core §10) | indirect | PASS — statically verified + execution |
| `_haversine_km` (252–267) | lat/long Series + fixed point | none | none | none | float Series (km) | `build_feature_frame` | antipodal/pole inputs irrelevant here | value-bounds assert in tests | PASS — verified by execution (err ≤ 4.1e-13; 111.1949 km/°) |
| `_fill_geo_from_neighborhood` (270–290) | raw frame | subset/neighborhood presence checks | copy; per-column fill | both present → passthrough; no Neighborhood → passthrough; missing one → fills only that one; lookup miss → NaN → FEATURE_DEFAULTS fill (if default exists) | frame | `build_feature_frame` | partial lat-only/long-only frames handled; empty FEATURE_DEFAULTS would leave NaN (artifact exists) | geo-override tests | PASS — verified by execution (serving §G) |
| `_property_geo_lookup` (293–346) | `path: Path` | missing cols / empty / non-numeric / non-integer Id / duplicate Id / Ames bbox → `ValueError` | `lru_cache(maxsize=4)` keyed on **path only**; info log once per file | absent → `None` (centroid default) | `dict[int,(float,float)] | None` | `_apply_property_geo_override` | **stale on same-path rewrite/delete (F1, demonstrated)**; cache eviction harmless | 10 geo-override tests (passed) | PASS WITH CONCERN |
| `_apply_property_geo_override` (349–376) | frame (opt. `Id`) | none (delegates) | copy; debug log | no file / no `Id` col → no-op; unmatched Ids keep centroids | frame | `build_feature_frame` | non-numeric `Id` in frame → coerce NaN → no match (safe) | test_geo_override.py | PASS — verified via test suite |
| `_apply_defaults` (379–399) | frame | missing-col check | copy; debug log | missing + no default → `ValueError` (executed, serving §E) | frame | `build_feature_frame` | — | roundtrip tests | PASS — verified by execution |
| `build_feature_frame` (402–486) | raw frame, optional `NeighborhoodStats` | via helpers; `stats=None` → loads artifact **uncached, per call** (F6) | artifact file read when stats=None | strict-zip over 4 stat fields; unseen neighborhood → global fallback | frame with exactly MODEL_FEATURES, in order | training (×2), evaluation, clustering, explainability, backend service, monitoring, tests | negative `property_age` reachable via schema-legal serving combo (F3); `MoSold=13` → `sale_quarter=5` direct-call (F4); `sale_month`/`sale_year` duplicate `MoSold`/`YrSold` (F5) | test_features.py (14 tests, passed) | PASS WITH CONCERN |
| `write_feature_list` (489–504) | path (default `models/feature_list.json`) | — | **writes file** (not executed — report-only) | mkdir parents | path | `main` | docstring misdescribes the sha1 field (F2) | test_features.py:284 (asserts on existing artifact) | PASS — statically verified (write path not executed under report-only rule) |
| `main` (507–529) | — | — | **rewrites 3 artifacts** (not executed — report-only; covered by reproducibility agent's byte-identical check) | — | None | CLI `python -m ml.features.pipeline` | reads train with `keep_default_na=False` ✓ | — | NOT EXECUTED (report-only constraint); statically verified |

Module constants: `EXCLUDED_RAW_COLUMNS` (76–85) matches SPEC §5 leakage rules exactly (Id, SalePrice, days_on_market, sells_within_30_days, SaleType, SaleCondition). `assert` uniqueness of MODEL_FEATURES (198) holds (94 unique). City center (201–202) matches SPEC §2 (42.0347, −93.6199). Ames bbox (215–216) matches GEOGRAPHY.md.

## 4. Per-function matrix — `serving.py`

| Function (lines) | Inputs / types | Validation | Side effects | Branches / error handling | Returns | Callers | Edge cases | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| `API_TO_RAW` (85–140) | 53-entry dict | — | — | — | — | `serving_payload_to_raw` | values ⊆ RAW_INPUT_COLUMNS ✓; no two API fields share a raw target ✓ | test_features.py:259 | PASS — verified by execution (serving §A/B) |
| `_central_air_token` (146–157) | bool/str/any | token whitelist | none | Y/N/TRUE/YES/1/FALSE/NO/0 (case-insensitive); else `ValueError` | "Y"/"N" | `serving_payload_to_raw` | non-bool truthy (e.g. `1`) → "Y" | roundtrip | PASS — verified by execution (9-value matrix, serving §D) |
| `_parse_sale_date` (160–178) | date/datetime/str | month 1–12 check | none | bad format/month → `ValueError` | `(year, month)` | `serving_payload_to_raw` | accepts `YYYY-MM`; year unbounded (schema bounds it) | test_features.py:239 | PASS — verified by execution (7-value matrix, serving §D) |
| `serving_payload_to_raw` (181–236) | `dict` payload | unknown keys → `ValueError` (executed) | none | special: central_air, sale_date; mo/yr_sold override sale_date; year_remod_add←year_built; lat/long←neighborhood centroid | complete raw row (all 79 RAW_INPUT_COLUMNS, no Nones) | `backend/app/services/prediction_service.py:145` | `yr_sold=None` direct call → TypeError not ValueError (F4; backend `exclude_none=True` prevents) | 4 serving tests (passed) + my full-payload probe | PASS — verified by execution |

Docstring mapping table (lines 13–69) cross-checked against code and schema: all 55 rows accurate.

## 5. Per-function matrix — `stats.py`

| Function (lines) | Inputs / types | Validation | Side effects | Branches / error handling | Returns | Callers | Edge cases | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| `NeighborhoodStats` dataclass (49–101) | typed fields | none on construction | frozen | `for_neighborhood` → fallback on miss; `to_dict`/`from_dict` round-trip all 4 STAT_FIELDS coerced float | — | pipeline, backend, clustering | `from_dict` ignores `"version"` field; missing keys → KeyError (acceptable fail-loud) | test_features.py:284 | PASS — verified by execution (artifact round-trip, core §8) |
| `_aggregate` (104–114) | frame, n_months | `GrLivArea.clip(lower=1)` zero-div guard | none | none | 4-stat dict | `fit_neighborhood_stats` | velocity denominator = global train months (36), not per-neighborhood active months — documented "comparable across neighborhoods" design choice | test_features.py:158 | PASS — verified by execution |
| `fit_neighborhood_stats` (117–155) | train frame | missing cols → KeyError; empty → ValueError | info log | — | NeighborhoodStats | `main`, tests, audits | n_months from distinct (YrSold,MoSold) pairs = 36 ✓ | 3 stats tests (passed) | PASS — verified by execution (train-only proven, core §8) |
| `save_neighborhood_stats` (158–167) | stats, path | — | **writes file** (not executed — report-only) | mkdir parents | path | `main` | — | — | NOT EXECUTED (report-only); statically verified |
| `load_neighborhood_stats` (170–178) | path | missing file → FileNotFoundError | file IO **per call (no cache — F6)** | — | NeighborhoodStats | backend main (once, lifespan), training, evaluation, tests | — | test_features.py:119 | PASS — verified by execution |

## 6. Per-function matrix — `defaults.py`

| Function (lines) | Inputs / types | Validation | Side effects | Branches / error handling | Returns | Callers | Edge cases | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| `_default_for_column` (34–48) | Series | numeric vs categorical dispatch | none | int-dtype integral median → int; empty mode → `"None"` | scalar | `compute_feature_defaults` | all-NaN categorical → literal `"nan"` string (F7; impossible in current zero-NaN data) | via artifact check | PASS — verified by execution (79/79 recompute match) |
| `compute_feature_defaults` (51–69) | train frame, columns | missing cols → KeyError | none | — | dict | `main`, reproducibility script | — | test_features.py:284 | PASS — verified by execution |
| `save_feature_defaults` (72–86) | dict, path | — | **writes file** (not executed — report-only) | mkdir parents | path | `main` | — | — | NOT EXECUTED (report-only); statically verified |
| `load_feature_defaults` (89–102) | path | missing → FileNotFoundError | `lru_cache(maxsize=1)`; file IO | supports wrapped + bare formats | dict | `_load_feature_defaults_or_empty`, tests | stale if artifact regenerated in-process (F1 family) | test_features.py:295 | PASS — verified by execution |
| `_load_feature_defaults_or_empty` (105–115) / `FEATURE_DEFAULTS` (118) | — | — | import-time binding | missing artifact → warning + `{}` | dict | pipeline, serving | module-level binding fixed at import; later regeneration invisible without reload | — | PASS — statically verified |

## 7. Per-function matrix — `__init__.py`

| Function (lines) | Behavior | Status |
|---|---|---|
| `__getattr__` (21–30) | PEP 562 lazy export of 7 names from `pipeline`/`stats`; unknown → AttributeError | PASS — verified by execution (all 7 exports + error path, serving-cache evidence tail) |

## 8. Findings

| # | Severity | Location | Description | Evidence |
|---|---|---|---|---|
| F1 | P3 | pipeline.py:293–294 (`_property_geo_lookup`), also 219 (`_geo_lookup`), defaults.py:89 (`load_feature_defaults`) | **Stale-cache semantics:** `lru_cache` keyed on path (or nothing) only. Demonstrated by execution: after rewriting the CSV at the same path, lookup returns the old content; after deleting the file, lookup still returns content instead of None. In-process only — a server restart or fresh process picks up changes. Tests dodge it via unique `tmp_path` per test (acknowledged in test_geo_override.py docstring). Risk: an operator dropping `property_geo.csv` into a running backend sees no effect until restart; a future test writing the real `data/external/property_geo.csv` after another test cached `None` would silently test the wrong thing. | serving §J |
| F2 | P3 | pipeline.py:492–493 (`write_feature_list` docstring) | **Docstring contradicts reality:** claims the internal `sha1` field "serves as the feature_version referenced by champion.json". False — champion.json `feature_version` is `ml.tracking.feature_version()` = 12-char sha1 of the **file bytes** (`9b0f8ba4201c`, matches). The 40-char internal field (`7601f2f6…`) is consumed only by tests/features/test_features.py:293. Two different hashes with overlapping names is a confusion hazard; code behavior itself is correct and SPEC §14-conformant. | serving §I; grep of all `feature_version`/`["sha1"]` consumers |
| F3 | P3 | pipeline.py:447–448; schemas/property.py:82–83,127 | **Negative `property_age` reachable via schema-legal input:** `year_built=2026` + `yr_sold=2006` (both within PropertyInput ranges) → `property_age = −20.0`; same for `years_since_remod`. No cross-field validation anywhere. Zero such rows in actual splits. Model extrapolates on impossible input rather than rejecting. | core §6 (0 negatives in data); serving §K (−20.0) |
| F4 | P3 | serving.py:222–223; pipeline.py:454 | **Direct-call inputs unvalidated:** pipeline-only callers bypassing the API schema get `MoSold=13` → `sale_quarter=5.0` (nonsense, no error), and `yr_sold=None` → raw `TypeError` (not the documented `ValueError`). API path is safe (schema bounds `mo_sold` 1–12, `exclude_none=True`). | serving §K |
| F5 | P3 | pipeline.py:453,455 | **Redundant features:** `sale_month` ≡ `MoSold` and `sale_year` ≡ `YrSold` (verified identical on all rows). Duplicates are in MODEL_FEATURES/feature_list.json consistently, so no correctness impact; SPEC §5 mandates them, so this is a spec-level design redundancy (exact collinearity; harmless to ridge/RF champions, wastes 2 of 94 dims). | core §6 |
| F6 | P3 | pipeline.py:425–426; stats.py:170–178 | **`stats=None` path reloads the JSON artifact on every call** (no cache, unlike the geo/defaults loaders). Backend is unaffected (loads once in lifespan, main.py:102, passes explicitly); only ad-hoc direct callers pay per-call file IO + parse. | static; call graph |
| F7 | P3 | defaults.py:45–48 | `_default_for_column` would return the literal string `"nan"` for an all-NaN categorical column (mode of NaNs → `str(nan)`). Processed data has zero NaNs (verified all splits), so unreachable today; purely defensive note. | core §10; static |

## 9. Things explicitly checked and found CORRECT (no finding)

- Feature order: `out[MODEL_FEATURES]` projection (pipeline.py:486) guarantees column order == MODEL_FEATURES == feature_list.json on all three splits.
- Leakage exclusions: Id/SalePrice/days_on_market/sells_within_30_days/SaleType/SaleCondition absent from RAW_INPUT_COLUMNS; stats train-only (proven, not just asserted: 19/25 neighborhood medians differ from full-data).
- Join fallback: val/test contain no unseen neighborhoods (fallback path not exercised by real data; exercised synthetically — serving §F, test_features.py:166).
- `sale_quarter` formula correct for all 12 months; `total_bath` half-bath weighting matches SPEC.
- `CentralAir`/`PavedDrive` string compare after `.astype(str)` is robust to bool/str tokens.
- `_fill_geo_from_neighborhood` handles lat-only/long-only partial frames; serving rows carry real centroids (not global default) via `neighborhood_coordinates`.
- `property_geo.csv` override: validation (bbox, non-numeric, non-integer Id, duplicates, missing columns, empty) verified by the 10-test suite; file absent in repo (centroid behavior is the committed default); `Id` never enters MODEL_FEATURES.
- Backend↔serving contract: all 55 PropertyInput fields map 1:1; `to_serving_payload(exclude_unset, exclude_none)` interacts correctly with FEATURE_DEFAULTS fill.
- Package lazy exports work; `python -m ml.features.pipeline` re-import safety (PEP 562 rationale) confirmed by reading.
- Tests: 24/24 green in tests/features (14 feature tests + 10 geo-override tests).

## 10. Not executed (report-only constraint)

- `main()` / `save_neighborhood_stats` / `save_feature_defaults` / `write_feature_list` write paths — running them would rewrite `models/*.json`, which report-only forbids. Instead: artifact **contents** verified equal to fresh train-only recomputation (stats: exact; defaults: 79/79 exact; feature_list: exact order + sha1), which proves the committed artifacts match what the write paths would produce. Byte-identical regeneration is the reproducibility agent's lane (scripts/audit_reproducibility.py).
