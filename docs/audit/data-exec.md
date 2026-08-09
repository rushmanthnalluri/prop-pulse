# Forensic Audit — data-exec (Data & Feature Pipeline, mission §6)

**Date:** 2026-08-07 · **Mode:** report-only, verification by execution · **Python:** `.venv/Scripts/python.exe` (pandas 2.3.3, seed 42), all runs with `PYTHONDONTWRITEBYTECODE=1` (no bytecode writes). No server started, no ports used, no project files modified. All evidence under `docs/audit/evidence/data-exec-*.txt` (command = heredoc python, full stdout pasted).

**Verdict: the data & feature pipeline is substantially TRUE to its claims.** All seven assigned checks PASS by execution. Three findings (1×P2, 2×P3), none of which invalidate the processed data or the artifacts.

---

## Results by assigned check

### (1) Row/col counts & split-sum reconciliation — PASS (verified by execution)
Evidence: `evidence/data-exec-01-counts.txt`, `evidence/data-exec-08-pipeline-repro.txt`
- Raw `data/raw/ames/train.csv`: **1460 rows × 81 cols**; `Id` unique, range 1..1460.
- Raw time split (YrSold≤2008 / =2009 / =2010): **947 / 338 / 175** = 1460.
- Outlier rule `GrLivArea>4000 & SalePrice<300000` recomputed on the raw train split matches exactly Ids **{524, 1299}** (= `data/processed/outliers_report.json`; both Edwards partial sales, 2007/2008). Val/test contain zero rows with `GrLivArea>4000`, so nothing was lost by train-only trimming.
- Processed: **train 945 / val 338 / test 175, 85 cols each**; `945+338+175+2 = 1460` **exactly**. Processed ∪ Ids = raw Ids − {524,1299}; splits pairwise disjoint; `SalePrice/GrLivArea/YrSold/MoSold/LotArea/YearBuilt` identical to raw for all 1458 rows.
- **Full in-memory re-run of `ml.data.pipeline` (split → outliers → clean → simulated DOM → geo join) reproduces the stored CSVs value-for-value on all 1458×85 cells** (dtype-normalized; md5s recorded).

### (2) `schema.json` vs actual CSVs — PASS with one dtype contradiction (see F1)
Evidence: `evidence/data-exec-02-schema.txt`
- Column names **and order** match exactly in all three CSVs (85 cols); `splits` row counts match.
- Every observed categorical value in every split is within the schema's category sets (checked all 33 categorical columns).
- Deep spot-check of 5 columns (`Neighborhood`, `MSZoning`, `BldgType`, `SaleCondition`, `GarageType`): observed sets ⊆ schema, per split (train 25/25 neighborhoods; val 24 — no Veenker; test 23 — no Blueste/Veenker; expected for small time slices).
- **One dtype mismatch: `MSSubClass` — schema says `object`, CSV round-trip yields `int64` → F1.**

### (3) Zero NaN/Inf — PASS (verified by execution)
Evidence: `evidence/data-exec-03-nan-inf.txt`, `evidence/data-exec-03b-none-token-reconcile.txt`
- All splits read with `keep_default_na=False`: **0 NaN cells, 0 empty strings, 0 whitespace-only strings, 0 Inf** (numeric coercion over every column).
- NA→`"None"` reconciliation exact: raw has 7480 NaNs in the 15 NA-absent categorical columns; processed holds 7473 `"None"` tokens + 7 NaNs sat on the removed outlier rows (524: 4, 1299: 3) → exact.
- `LotFrontage`: all 259 raw NaNs imputed with **train-split neighborhood medians** (verified against `fit_cleaner` re-fit on the trimmed raw train split — leakage-safe); global fallback 69.0. `MasVnrArea` 8 NaNs → 0. No suspect literal strings (`"NA"`,`"NaN"`,…) anywhere.

### (4) Feature frames — PASS (verified by execution)
Evidence: `evidence/data-exec-04-features.txt`, `evidence/data-exec-04b-handverify.txt` (04's tail ends in an auditor-script `IndexError` from a hardcoded sample Id not in the train split — my bug, not the project's; 04b supersedes the hand-verify section)
- `build_feature_frame` on all splits: **exactly 94 columns, order == `models/feature_list.json`**, 0 NaNs; dtypes identical across splits; engineered features float64 (`amenity_count` int64); 4 neighborhood-stat columns float64.
- `feature_list.json` sha1 field == recomputed `sha1(json.dumps(MODEL_FEATURES))` (`7601f2f6…`); features == current-code `MODEL_FEATURES`.
- Hand-verified 3 rows (train Id=5, val Id=6, test Id=34) with explicit arithmetic — e.g. Id=5: `property_age = 2008−2000 = 8`; `total_bath = 2+0.5·1+1+0.5·0 = 3.5`; `living_area_per_bedroom = 2198/4 = 549.5`; `haversine((42.0514,−93.6532)→(42.0347,−93.6199)) = 3.318124 km`; `amenity_count = 1+0+1+1+0+1+1+1 = 6` — all match to <1e-9.
- Independent full-population recompute of all 11 engineered features × all 1458 rows: **all exact** (includes zero-bedroom clip and quarter formula).

### (5) `neighborhood_stats.json` — PASS (verified by execution)
Evidence: `evidence/data-exec-05-neighborhood-stats.txt`
- All **25 neighborhoods × 4 stats** (median_price, mean_price, median_price_per_sqft, monthly_sale_velocity) match a train-split-only recomputation with **exact float equality**; `n_train_rows=945`, `n_months=36` (all of 2006–2008) confirmed.
- Global fallback exact: median 164,990.0 / mean 182,125.1343915344 / ppsf 120.57877813504822 / velocity 26.25 (=945/36).
- Leakage guard: re-fitting on train+val changes 24/25 neighborhoods (Veenker absent from val, so unchanged) → artifact is consistent with a train-only fit. `feature_defaults.json` (79 keys) also exactly equals train-only mode/median recomputation.

### (6) Serving path ≡ training path — PASS (verified by execution)
Evidence: `evidence/data-exec-06-serving-parity.txt`, `evidence/data-exec-06b-serving-parity-full.txt`
- Maximally-specified payload for arbitrary train row Id=5 → only **5/94** feature columns differ; every diff is one of the **23 raw columns the API cannot express** (`API_TO_RAW` maps 54 of 79 raw inputs; lat/long are derived), and each differs by exactly `FEATURE_DEFAULTS[col]` — the documented SPEC §8 fallback. Geo coordinates from `neighborhood_coordinates` equal the processed row's centroid exactly.
- Full-parity proof: a synthetic record (Id=5 with the 23 un-mappable columns at defaults, **31 mappable columns at non-default values**) produces a **byte-identical 94-column feature row** through both paths. (My first attempt at this searched for a *real* row matching all 23 defaults — none exists; the loop was vacuous. Corrected with the synthetic record.)
- Minimal SPEC-§8 payload: 24/94 columns differ (all by design — defaults + `year_remod_add:=year_built`); neighborhood-stat columns and geo remain identical. **No train/serve skew in the shared code path.**

### (7) Duplicates / Id integrity / coordinates / DOM flags — PASS (verified by execution)
Evidence: `evidence/data-exec-07-integrity.txt`
- Ids unique within and across splits (union 1458); zero full-row duplicates; zero duplicate rows ignoring `Id`.
- Coordinates: all rows within schema bounds (lat 41.98–42.09, long −93.72–−93.55); every row's lat/long equals the `data/external/neighborhood_geo.csv` centroid for its neighborhood (25/25 covered).
- `days_on_market` ∈ [8,151] ⊂ [1,365], integer; **`sells_within_30_days == (days_on_market ≤ 30)` in every row of every split**; fast-sale rates 0.253/0.293/0.280 (train ≈0.25 as claimed in SPEC §14).
- The simulated DOM re-fitted on train (seed 42) **reproduces the stored values exactly for all three splits**; simulator neighborhood medians == train-only medians. (Simulator prices each row's own SalePrice vs neighborhood median — documented simplification, ADR-3; classification labels are simulated, correctly flagged in schema.json.)

---

## Findings

| # | Severity | Location | Description | Evidence |
|---|----------|----------|-------------|----------|
| F1 | **P2** | `ml/data/clean.py:136` vs `ml/training/common.py:40-41`; `data/processed/schema.json` (`columns.MSSubClass`) | **MSSubClass dtype contradiction.** clean.py casts MSSubClass to `str` ("categorical code, not a magnitude") and schema.json records `object`, but the CSV round-trip re-infers **int64**; `build_preprocessor` selects numerics by dtype, so MSSubClass is **median-imputed + StandardScaler-scaled as a numeric magnitude** (confirmed: 53 numeric cols include it, 41 categorical exclude it) instead of one-hot. Side effect: `feature_defaults.json` holds the **median code 50, not the mode 20** (mode/median semantics inverted for this column). No train/serve skew (both paths see int64), so impact is model-semantics + schema/doc falsehood, not a crash. Repro: run `evidence/data-exec-09-mssubclass.txt`. | `data-exec-02-schema.txt`, `data-exec-09-mssubclass.txt` |
| F2 | **P3** | `ml/data/outliers.py:29` | **Factually wrong comment.** "(there are none >4000 sqft above ~300k in train, but the guard is cheap insurance)" — false: raw train split contains Ids **692 (4316 sqft, $755,000)** and **1183 (4476 sqft, $745,000)**. The `SalePrice < 300_000` guard is not "cheap insurance", it is load-bearing: without it two legitimate luxury sales would be deleted. Behavior is correct; the justification misstates the data. | `data-exec-08-pipeline-repro.txt` |
| F3 | **P3** | `ml/features/serving.py:217-223` | **Default serving rows are temporally out-of-distribution.** With no `sale_date`/`yr_sold`, serving defaults to *today* → `sale_year=2026`, `sale_month=8`, `property_age` ~16+ years beyond any training row (train YrSold ≤ 2010). Sanctioned by SPEC §8 ("default today"), but every API call omitting the date scores outside the feature ranges the models saw; `sale_year`/`sale_month` are model features (in `MODEL_FEATURES`). Flagged for orchestrator to weigh against contract/performance agents' findings. | `data-exec-09-mssubclass.txt` |

No P0/P1 findings. No leakage detected anywhere in the data/feature path (LotFrontage medians, neighborhood stats, feature defaults, DOM simulator all verified train-only by re-fitting).

## Coverage

- **Files executed/verified:** `ml/data/ingest.py` (load_raw_train, load_neighborhood_geo), `ml/data/split.py` (time_split), `ml/data/outliers.py` (partial_sale_rule, apply_outlier_rules), `ml/data/clean.py` (fit_cleaner, apply_cleaner — full re-fit + re-apply), `ml/data/sale_speed.py` (SaleSpeedSimulator.fit/transform — exact reproduction), `ml/data/pipeline.py` (join_neighborhood_geo — full in-memory re-run of run_pipeline's steps), `ml/features/pipeline.py` (build_feature_frame ×3 splits + serving rows, MODEL_FEATURES, write_feature_list sha1), `ml/features/stats.py` (fit/load_neighborhood_stats), `ml/features/defaults.py` (compute_feature_defaults), `ml/features/serving.py` (serving_payload_to_raw, API_TO_RAW), `ml/training/common.py` (build_preprocessor — for F1 consequence only).
- **Artifacts verified by recomputation:** `data/processed/{train,val,test}.csv`, `data/processed/schema.json`, `data/processed/outliers_report.json`, `models/feature_list.json`, `models/neighborhood_stats.json`, `models/feature_defaults.json`, `data/external/neighborhood_geo.csv`.
- **Not in scope / not verified:** `RealDomProvider` (csv provider path; not used by the shipped artifacts), model training/evaluation metrics, `validate.py` behavior under adversarial input (its checks were independently re-implemented here rather than merely re-run).

## Notes for the orchestrator (contradictions to reconcile)

1. **F1 vs SPEC §14** ("Numeric columns are proper numerics" + clean.py's "MSSubClass is a categorical code"): the shipped CSV cannot express MSSubClass-as-string; schema.json asserts `object` while every consumer reads `int64`. Reconcile with llba-training/regression/classification agents: if their champion metrics were produced with MSSubClass-as-numeric (they were — the preprocessor is dtype-driven), the *documented* design (one-hot) differs from what was measured. Fixing the dtype changes the feature space and invalidates stored models; alternatively the documentation/comment intent should be corrected. OneSE-rule metrics would need re-measurement either way.
2. **F3 vs SPEC §8**: "default today" is spec-compliant but distribution-shifting; check whether the api/contract agents observed it in `/predict` responses (prediction intervals, cluster fallback) and whether docs disclose it.
3. Prior QA "PASS everywhere" is consistent with my findings **except** that neither F1's schema/dtype contradiction nor F2's false comment appears in the reports I was told to distrust — suggest docs-truth agent double-checks claims about MSSubClass handling.
