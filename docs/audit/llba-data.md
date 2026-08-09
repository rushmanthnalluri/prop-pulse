# Forensic Audit — llba-data (ml/data/*, ml/paths.py)

Agent: **llba-data** · Date: 2026-08-07 · Mode: report-only (no project files modified)
Scope: `ml/data/clean.py`, `ingest.py`, `outliers.py`, `pipeline.py`, `sale_speed.py`, `split.py`, `validate.py`, `ml/paths.py`.

Every line of all 8 files was read directly (Read tool, full files). Assignment estimated ~1,130 lines; actual total is **1,089 lines** (`wc -l`).

## 1. Reviewed-lines table

| File | Lines | Lines reviewed | How | Verdict |
|---|---|---|---|---|
| `ml/paths.py` | 30 | 30/30 | full read + import sweep | PASS — statically verified |
| `ml/data/ingest.py` | 56 | 56/56 | full read + execution | PASS — verified by execution |
| `ml/data/clean.py` | 144 | 144/144 | full read + execution | PASS — verified by execution |
| `ml/data/outliers.py` | 67 | 67/67 | full read + execution | PASS WITH CONCERN (doc inaccuracy, F2) |
| `ml/data/split.py` | 54 | 54/54 | full read + execution | PASS WITH CONCERN (intra-split dup gap, F5) |
| `ml/data/sale_speed.py` | 288 | 288/288 | full read + execution | PASS WITH CONCERN (empty-frame crash, F1) |
| `ml/data/pipeline.py` | 188 | 188/188 | full read + CLI execution | PASS — verified by execution |
| `ml/data/validate.py` | 262 | 262/262 | full read + execution | PASS — verified by execution |

## 2. Execution evidence index

| Evidence file | Contents |
|---|---|
| `evidence/llba-data-columns-splits.txt` | RAW_COLUMNS vs actual raw CSV (exact 81/81 match, order identical); validate_raw/validate_processed PASS on real data; NA-column coverage; processed splits 945/338/175 × 85 cols, zero empty strings, years per split, fast-sale rates (0.2529/0.2929/0.2800); geo lookup 25 rows, all neighborhoods covered; `data/external/days_on_market.csv` absent (default csv path) |
| `evidence/llba-data-split-dom.txt` | time_split 947/338/175, zero cross-split Id overlap; outlier rule removes Ids [524, 1299] (947→945), matches committed `outliers_report.json`; val LotFrontage imputation == train neighborhood medians (leakage guard verified on 65 imputed rows, 5 sampled); DOM shuffle-invariance, same-seed reproduction, different-seed divergence (98.2%), noise ~N(0.003, 0.342); 30-day flag consistency; unfitted-transform raises; unseen-neighborhood fallback; expensive-large-home guard |
| `evidence/llba-data-pytest.txt` | `pytest tests/data -v`: **30/30 PASSED** (incl. byte-identity regression + full csv-provider pipeline) |
| `evidence/llba-data-edge-cases.txt` | RealDomProvider: empty/blank/float CSVs rejected, 1/365 boundaries accepted, min_coverage (0,1] enforced, empty-frame transform OK, extra cols ignored, even-count median truncation (50.5→50); **attach_sale_speed crashes on empty frame (F1)**; time_split rejects year 2011, accepts intra-split dup Id (F5); validate_raw rejects missing col / bad category / out-of-range / dup Id; fit_cleaner drops all-NaN neighborhood; apply_cleaner raises on residual NA + does not mutate input; ingest FileNotFoundError/ValueError paths; DOM_PROVIDER env variants (`' CSV '`, `'Csv'`, `'SIMULATED'` accepted; `''`, `'real'` rejected); join_neighborhood_geo rejects unknown neighborhood; validate_processed rejects inconsistent flag and DOM=400; grep sweep: no `except` clauses anywhere, only seeded `np.random.default_rng([seed, Id])` |
| `evidence/llba-data-repro.txt` | CLI `python -m ml.data.pipeline --output-dir <tmp>`: counts {945, 338, 175}; md5 of fresh train/val/test.csv **byte-identical** to committed; schema.json + outliers_report.json identical; `DOM_PROVIDER=` (empty) fails fast at `select_dom_provider` with **0 files written** |

## 3. Function matrix

Status vocabulary per audit plan: PASS / PASS WITH CONCERN / FAIL / NOT EXECUTABLE / NOT APPLICABLE.

### ml/paths.py (module-level constants only)

| Symbol | Notes | Status |
|---|---|---|
| `REPO_ROOT` … `NOTEBOOKS_DIR` | Derived from `Path(__file__).resolve().parents[1]`; no hardcoded absolutes. All paths exist in repo. Imported by 35 files (ml/, backend/, tests/, scripts/, notebooks/). | PASS — statically verified (paths.py:6-27) |
| `DATASET_VERSION="ames-1.0"`, `RANDOM_SEED=42` | Consumed by pipeline.py:164 and sale_speed.py:79/32. Immutable constants; no mutable globals. | PASS — statically verified |

### ml/data/ingest.py

| Function | Matrix | Status |
|---|---|---|
| `load_raw_train(path=None)` | In: optional Path override. Returns raw `train.csv` (1460×81 verified), `Id` forced int64. Validates existence → FileNotFoundError with fix-it message (verified I1). No schema validation here (validate_raw downstream). Side effects: none. Branches: path override / default. Edge: empty CSV → pandas EmptyDataError (loud). Callers: pipeline.py:134 only. Test coverage: none direct (indirect via run_pipeline tests). | PASS — verified by execution |
| `load_neighborhood_geo(path=None)` | In: optional Path. Validates columns ⊇ {Neighborhood, lat, long, note} → ValueError (verified I2). Actual CSV has 5 cols (adds `name`) — extras ignored. 25 rows, unique Neighborhood, all raw neighborhoods covered (verified). Note: `ml/clustering/dataset.py:50` re-implements this with a *different* required set ({Neighborhood, name, lat, long}) — duplication, see F9. Callers: pipeline.py:135; name collision with clustering's local copy. Test coverage: none direct. | PASS — verified by execution |

### ml/data/clean.py

| Function | Matrix | Status |
|---|---|---|
| `NA_ABSENT_CATEGORICAL` / `NA_ABSENT_NUMERIC` / `ABSENT_TOKEN` | Module-level mutable lists (idiomatic constants). Cross-checked against raw data: all 19 NA-bearing raw columns are covered by these lists + LotFrontage + Electrical (verified). | PASS — verified by execution |
| `Cleaner` (dataclass) | `field(default_factory=dict)` — no mutable-default bug. Default `electrical_mode="SBrkr"` matches actual train mode. | PASS — statically verified (clean.py:65-78) |
| `fit_cleaner(train_df)` | In: raw train split. Fits per-Neighborhood LotFrontage medians (25 fitted, verified), global median (69.0), Electrical mode (SBrkr). `.dropna()` on groupby medians correctly excludes all-NaN neighborhoods (verified C1). Edge: all-NaN `Electrical` → `.mode().iloc[0]` raises IndexError (cryptic but loud; unreachable with real data — P3 note). Branches: none. Side effects: logging only. Returns: `Cleaner`. Callers: pipeline.py:144. Tests: none direct. | PASS — verified by execution |
| `apply_cleaner(df, cleaner)` | In: any raw split. Copies input (non-mutating, verified C3). Fills documented NA→"None"/0, LotFrontage by train medians w/ global fallback (val-split verification: 65 imputed rows match train medians exactly), Electrical→mode, MSSubClass→str. **Raises on any residual NA** (verified C2 with NaN in LotArea). Returns cleaned copy. Edge: missing column → KeyError (loud; prevented upstream by validate_raw). Callers: pipeline.py:145. Tests: none direct. | PASS — verified by execution |

### ml/data/outliers.py

| Function | Matrix | Status |
|---|---|---|
| `partial_sale_rule(df)` | Mask `GrLivArea>4000 & SalePrice<300000`. Removes exactly Ids [524, 1299] (4676 sqft/$184,750; 5642 sqft/$160,000 — both clearly partial-sale pattern). Price guard keeps expensive large homes (verified). Callers: apply_outlier_rules. Tests: none direct. | PASS — verified by execution |
| `apply_outlier_rules(train_df)` | Returns (filtered copy, report dict). Report round-trips to committed `outliers_report.json` exactly (947→945). **Doc bug (F2):** docstring says "cleaned TRAIN split" but pipeline.py:140 calls it on the *raw* train split (before fit_cleaner). Harmless (rule columns untouched by cleaning) but the doc lies about the contract. Branches: docstring-guard `if rule.__doc__`. No broad except. Callers: pipeline.py:140. Tests: indirect only (row-count test). | PASS WITH CONCERN — verified by execution |

### ml/data/split.py

| Function | Matrix | Status |
|---|---|---|
| `time_split(df)` | train YrSold≤2008 (947), val 2009 (338), test 2010 (175) — verified; cross-split Id overlap zero; total-length conservation check present. Raises on unexpected years (verified S1 with 2011). **Gap (F5):** overlap check is cross-split only; intra-split duplicate Ids pass (verified S2) — guarded upstream by `validate_raw` in the pipeline, so not reachable in the real flow; the function alone doesn't enforce its "disjoint Id sets" contract within a split. Edge: NaN year → caught by unexpected-year check; empty year-range → empty split allowed (feeds F1 downstream). No shuffling, no randomness. Callers: pipeline.py:137. Tests: none direct (years/overlap asserted on committed CSVs only). | PASS WITH CONCERN — verified by execution |

### ml/data/sale_speed.py

| Function | Matrix | Status |
|---|---|---|
| `DomProvider` (Protocol) | `@runtime_checkable`, single `transform` method. Used for typing in pipeline.py:79/112. Never used with `isinstance` — the decorator is currently unnecessary but harmless. | PASS — statically verified |
| `SaleSpeedSimulator.fit(train_df)` | Fits per-Neighborhood median SalePrice + global median on train only (leakage-safe). Returns self (chainable). Callers: pipeline.py:117, tests. | PASS — verified by execution |
| `SaleSpeedSimulator._row_noise(ids)` | `np.random.default_rng([self.seed, int(prop_id)])` per row — deterministic per (seed, Id), independent of row order (verified: shuffle-invariant, same-seed reproducible, seed 43 changes 98.2% of rows; noise ~N(0.0029, 0.3422) vs claimed N(0, 0.35)). Only randomness in the entire scope; fully seeded. | PASS — verified by execution |
| `SaleSpeedSimulator.transform(df)` | Unfitted → RuntimeError (verified). Unseen neighborhood → global-median fallback, no NaN (verified). price_ratio clipped [0.5, 2.0] → no log(0)/Inf. Season map covers all 12 months. Result clipped [1,365], rounded, int. NaN in inputs (e.g. MoSold) → loud `.astype(int)` failure. Train DOM 8–141, median 41; fast-sale rates 25.3%/29.3%/28.0% match docstring "quarter to a third" and SPEC §14 "≈0.25". | PASS — verified by execution |
| `RealDomProvider.__init__(csv_path, min_coverage=0.95)` | Strict validation all verified by execution: missing file → FileNotFoundError; missing cols / non-integer Id / non-integer days (catches floats incl. whole-number floats, blanks→NaN, text) / duplicate Ids / out-of-range days → ValueError with counts; boundaries 1 and 365 accepted; min_coverage (0,1] enforced; empty CSV rejected (via dtype check — message is slightly misleading for that case, P3 note); extra columns ignored. `median_days=int(days.median())` truncates x.5 (verified 50.5→50; deterministic, fill-only — P3 note). | PASS — verified by execution |
| `RealDomProvider.transform(df)` | Id-aligned (row-order independent — verified by shuffled-subset test in suite). Coverage < min → ValueError with matched/total + sample Ids (verified); ≥ min but <100% → median fill + warning (verified, suite). Empty frame → clean empty series (verified). | PASS — verified by execution |
| `attach_sale_speed(df, provider)` | Copies input; NaN-check on provider output; clips [1,365]; flag = `days <= 30` consistent with validate_processed (verified on fresh + committed data, all splits). **F1 (P2): crashes on empty input in its logging line** — `int(out["days_on_market"].median())` → `ValueError: cannot convert float NaN to integer` (verified with both providers). Inconsistent with `RealDomProvider.transform`'s explicit empty-frame support at sale_speed.py:237-238. Unreachable with real Ames data (splits non-empty), but latent for any empty-split/empty-frame caller. Minor note: the re-clip at :282 silently fixes out-of-range values from hypothetical third-party providers (no-op for both built-in providers). | **FAIL (P2, edge-case)** — verified by execution |

### ml/data/pipeline.py

| Function | Matrix | Status |
|---|---|---|
| `join_neighborhood_geo(df, geo)` | Left merge on Neighborhood; raises listing unmapped neighborhoods (verified J1 "Atlantis"). Duplicate geo rows would fan out — caught downstream by validate_processed's unique-Id check (geo file verified: 25 unique rows). Row order preserved by left merge. Callers: run_pipeline. Tests: none direct. | PASS — verified by execution |
| `select_dom_provider(train_df)` | Env parsing `.strip().lower()` — `' CSV '`/`'Csv'`/`'SIMULATED'` accepted; `''`/`'real'` → ValueError with clear message (verified). `csv` + missing file → FileNotFoundError **before any output write** (verified: 0 files written). Relative `DOM_CSV_PATH` resolves against CWD while the default is repo-root-anchored (F6, P3). Returns (provider, provenance note). Callers: run_pipeline, tests. Tests: 4 dedicated tests, all pass. | PASS — verified by execution |
| `run_pipeline(output_dir=PROCESSED_DIR)` | Order: validate_raw → split → trim (train only) → fit cleaner (trimmed train) → clean all → DOM attach all → geo join all → validate_processed → write. Every fitted statistic train-only (SPEC §4 honored; LotFrontage val imputation verified to equal train medians). Full CLI run byte-reproduces committed CSVs + schema.json + outliers_report.json (md5-verified). Notes list correctly swaps note[0] by provider (suite-verified). Minor: per-split validate→write loop can leave a fresh train.csv beside stale val/test if a later split fails validation (F8, P3, not triggerable with valid data). Returns counts {945,338,175}. | PASS — verified by execution |
| `main()` | argparse CLI (`--output-dir`, `--verbose`); verified end-to-end via CLI run. | PASS — verified by execution |

### ml/data/validate.py

| Function | Matrix | Status |
|---|---|---|
| `SchemaError` | ValueError subclass — callers catching ValueError also catch it. | PASS — statically verified |
| `RAW_COLUMNS` (81) | **Exact match** with actual `data/raw/ames/train.csv` header — same 81 names, same order (verified). | PASS — verified by execution |
| `EXPECTED_CATEGORIES` (42 cols) | Raw spellings "C (all)", "2fmCon"/"Duplex"/"Twnhs" handled with comments (matches SPEC §14). All real categories pass on raw + processed (validate_raw/processed run clean). Not validated: MSSubClass (code→str), Exterior1st/2nd, MasVnrType — deliberate (open/rare levels); one-hot uses handle_unknown='ignore' downstream. P3 observation only. | PASS — verified by execution |
| `NUMERIC_RANGES` (19 cols) | All pass on real data. GarageYrBlt deliberately absent (0 = no garage after cleaning). | PASS — verified by execution |
| `_check_columns` / `_check_unique_ids` / `_check_categories` / `_check_ranges` / `_check_no_missing` | All negative paths verified by execution (missing col, dup Id, bad category, out-of-range each raise SchemaError with actionable messages). Category/range checks skip NaN (correct for raw) and skip absent columns. | PASS — verified by execution |
| `validate_raw(df)` | Composes the four checks; PASS on real raw. Returns df for chaining. Callers: pipeline.py:134. Tests: none direct (only via run_pipeline). | PASS — verified by execution |
| `validate_processed(df, split_name)` | Raw checks + no-missing-anywhere + extras present + Ames bbox + DOM∈[1,365] + flag↔DOM consistency. PASS on all 3 committed splits; negative paths (flipped flag, DOM=400) verified to raise. Note: flag check astype(int)-truncates a hypothetical non-binary float flag before comparing (theoretical only — CSV round-trip yields int64). | PASS — verified by execution |
| `build_schema_report(splits, version, notes)` | dtypes from train split; hardcoded split-year strings duplicate split.py constants (F4). Produces committed schema.json structure (verified identical on re-run). | PASS — verified by execution |
| `write_schema_json(...)` | mkdir(parents=True) + write; round-trip verified byte-identical. | PASS — verified by execution |
| `DOM_MAX = 365` (validate.py:131) | **Duplicates** `sale_speed.DOM_MAX` instead of importing it; `validate_processed` also hardcodes `30` vs `FAST_SALE_THRESHOLD_DAYS` (F4, P3 drift risk — values agree today). | PASS WITH CONCERN — statically verified |

## 4. Callers (grep, repo-wide, excluding .venv)

| Public symbol | Callers |
|---|---|
| `load_raw_train` | ml/data/pipeline.py:134 (only) |
| `load_neighborhood_geo` (ingest) | ml/data/pipeline.py:135. **Name collision:** ml/clustering/dataset.py:50 defines its own same-named function (F9) |
| `fit_cleaner` / `apply_cleaner` / `Cleaner` | ml/data/pipeline.py:144-145 only |
| `partial_sale_rule` / `apply_outlier_rules` | outliers.py:47 / pipeline.py:140 |
| `time_split` | ml/data/pipeline.py:137 (only) |
| `SaleSpeedSimulator` / `RealDomProvider` / `DomProvider` / `attach_sale_speed` | ml/data/pipeline.py:79-150; tests/data/test_dom_adapter.py |
| `validate_raw` | ml/data/pipeline.py:134 (only) |
| `validate_processed` / `SchemaError` / `LAT_RANGE` / `LONG_RANGE` | ml/data/pipeline.py:157; tests/data/test_data_pipeline.py |
| `write_schema_json` | ml/data/pipeline.py:164; `build_schema_report` internal only |
| `run_pipeline` / `select_dom_provider` | tests/data/test_dom_adapter.py; `python -m ml.data.pipeline` from scripts/audit_reproducibility.py:117 (in-place rerun + md5 compare) |
| `join_neighborhood_geo` | run_pipeline only |
| `ml.paths` constants | 35 files across ml/, backend/, tests/, scripts/, notebooks/ |
| Consumers of the processed CSV contract (`keep_default_na=False`) | ml/training/common.py:31; ml/features/pipeline.py:510; tests/data fixtures |

## 5. Findings

| # | Severity | file:line | Finding | Evidence |
|---|---|---|---|---|
| F1 | **P2** | ml/data/sale_speed.py:286 | `attach_sale_speed` crashes on an empty frame: the INFO log calls `int(out["days_on_market"].median())` → `ValueError: cannot convert float NaN to integer`. Verified with both providers. Contradicts `RealDomProvider.transform`'s explicit empty-input support (sale_speed.py:237-238). Unreachable with real Ames data; latent for empty-split/empty-frame reuse. Fix: guard the log line (`if len(out)`). | evidence/llba-data-edge-cases.txt (E6, E6b) |
| F2 | P3 | ml/data/outliers.py:40 | Docstring says "cleaned TRAIN split" but pipeline.py:140 applies rules to the **raw** train split (cleaning happens at :144). Behavior safe (rule columns unaffected by cleaning); doc/contract mismatch only. | static: pipeline.py:139-145 |
| F3 | P3 | ml/data/clean.py:17,135-136 | MSSubClass→str intent is lost on disk round-trip: `ml/training/common.py:31` and `ml/features/pipeline.py:510` read processed CSVs without `dtype={"MSSubClass": str}` → int64 → `build_preprocessor` (common.py:40) treats it as **numeric** (median-imputed + scaled as a magnitude), while the tests' fixture does pass dtype=str. Training vs serving consistency for this feature depends on downstream handling (MSSubClass is in MODEL_FEATURES but absent from the backend schema — see Contradictions). The data module itself does its job; the consumer side must reconcile. | execution: load_split returns int64; grep backend = no MSSubClass |
| F4 | P3 | ml/data/validate.py:131,220,247-249 | Constant duplication: `DOM_MAX=365` duplicates sale_speed.py:37; literal `30` duplicates `FAST_SALE_THRESHOLD_DAYS` (sale_speed.py:38); split-year strings hardcode split.py:14-16 values. All agree today; drift would silently desync validator from producer. | static |
| F5 | P3 | ml/data/split.py:41-45 | Overlap guard is cross-split only; intra-split duplicate Ids pass `time_split` (verified). Real flow is protected by `validate_raw` upstream (pipeline.py:134 runs first), so unreachable in-pipeline; standalone callers get a weaker guarantee than the docstring implies. | evidence/llba-data-edge-cases.txt (S2) |
| F6 | P3 | ml/data/pipeline.py:105 | A user-supplied relative `DOM_CSV_PATH` resolves against the process CWD, whereas the default is anchored to the repo root via `EXTERNAL_DIR`. Minor env-parsing inconsistency; data/README examples use absolute paths. | static + evidence (P1 probes) |
| F7 | P3 | ml/data/sale_speed.py:214 | `int(days.median())` truncates even-count medians (50.5→50, verified). Deterministic, in-range, fill-only; undocumented. | evidence (E8) |
| F8 | P3 | ml/data/pipeline.py:156-161 | Per-split validate→write loop: a validation failure on val/test would leave a fresh train.csv alongside stale val/test (partial outputs). Not triggerable with valid data; provider/validation errors before the loop ARE fail-fast (verified 0 files written). | evidence/llba-data-repro.txt |
| F9 | P3 | ml/clustering/dataset.py:50 | `load_neighborhood_geo` is re-implemented there with a **different** required-column set ({Neighborhood,name,lat,long} vs ingest's {Neighborhood,lat,long,note}) instead of importing from ml.data.ingest — duplication drift risk; also makes grep-based caller analysis ambiguous. (File belongs to llba-ml-services' scope; recorded here because it surfaced in my callers analysis.) | static: clustering/dataset.py:50-65 |
| F10 | P3 | ml/data/pipeline.py:103-116 | `DOM_PROVIDER=""` (set-but-empty, a common .env pattern) is a hard error rather than the simulated default. Verified fail-fast with clear message and 0 files written; reasonable strictness, but undocumented. | evidence/llba-data-edge-cases.txt (P1), llba-data-repro.txt |

**No P0/P1 findings.** No broad/empty excepts, no unseeded randomness, no hardcoded absolute paths, no mutable-global state, no silent NaN swallowing, no threading/race surface anywhere in scope (grep sweep + full read).

## 6. Verified claims (independent recomputation)

- Splits **945/338/175** ✔ (raw time-split 947/338/175; 2 partial-sale outliers removed: Ids 524, 1299 — matches committed outliers_report.json byte-for-byte).
- 1460 raw rows = 1458 processed + 2 trimmed ✔; 81 raw cols ✔; 85 processed cols ✔; zero NaNs/empty strings with `keep_default_na=False` ✔.
- Split integrity: years {2006-2008}/{2009}/{2010} disjoint; zero cross-split Id overlap ✔.
- Leakage guards: LotFrontage medians fitted on trimmed train only — val imputations match train medians exactly (65 rows) ✔; outlier rules train-only ✔; simulator stats train-only ✔.
- DOM simulation: noise truly seeded per (seed, Id) — shuffle-invariant and reproducible ✔; flag `days<=30` consistent in fresh + committed data ✔; train fast-sale rate 0.2529 ≈ SPEC §14's ≈0.25 ✔.
- Reproducibility: fresh CLI run byte-identical (md5) for all 3 CSVs + schema.json + outliers_report.json ✔ (matches ADR-3 addendum claim).
- DOM_PROVIDER=csv adapter: all strict-validation and coverage behaviors verified; 30/30 tests/data pass ✔.

## 7. Test-coverage gaps (not defects)

- No dedicated unit tests for `clean.py`, `outliers.py`, `split.py`, `ingest.py` — exercised only indirectly via `run_pipeline` tests. Unfit/unseen-neighborhood fallback, unexpected-year rejection, missing-file paths, residual-NA guard: all untested by the suite (I verified each manually).
- `validate_raw` never tested directly; `join_neighborhood_geo`, `main()`, simulator shuffle-invariance/unfitted-raise untested.
- `attach_sale_speed` empty-frame path untested (would have caught F1).

## 8. Contradictions the orchestrator must reconcile

1. **MSSubClass dtype chain (with llba-features / llba-training / llba-backend):** clean.py casts to str (intent: categorical code); training + features read it back as int64 and the shared preprocessor scales it as a numeric magnitude; the tests' fixture reads it as str; the backend schema has no MSSubClass field at all though it's in MODEL_FEATURES (94). Either the intent or the consumers are wrong — decide one canonical treatment and document it.
2. **Duplicate geo loader (with llba-ml-services):** two `load_neighborhood_geo` definitions with different required-column contracts (ingest requires `note`, clustering requires `name`). Both pass on today's CSV (has both); pick one implementation.
3. **Line-count baseline:** AUDIT_PLAN/assignment says ~1,130 lines for this scope; actual is 1,089 (`wc -l`). Cosmetic baseline drift.
4. **Split-size narrative:** plan/reports quote "945/338/175"; the raw time-split is 947/338/175 and the 2-row difference is the outlier trim. Docs that attribute 945 to the split itself would be wrong; current docs I checked phrase it correctly.
5. **`DOM_PROVIDER=""` semantics (with devops/docs-truth):** if any deployment env file sets `DOM_PROVIDER=` empty, the pipeline hard-fails; .env.example should be checked for this pattern (deferred to llba-frontend-infra).
