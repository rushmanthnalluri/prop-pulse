# Agent log: data-engineering

## Scope delivered

- `data/raw/ames/` — extracted from `house-prices-advanced-regression-techniques1.zip`:
  `train.csv` (1460×81), `test.csv` (1459×80, untouched, never used), `sample_submission.csv`,
  `data_description.txt`.
- `data/README.md` — source (Kaggle House Prices; De Cock, JSE 2011 citation), re-obtain
  steps, license/usage note, row/column counts, and both documented fallbacks (ADR-2
  approximate centroids; ADR-3 SIMULATED DOM target with the exact
  "SIMULATED TARGET — NOT FOR MODEL PERFORMANCE CLAIMS" label).
- `data/external/neighborhood_geo.csv` — 25 neighborhoods (list derived from the actual
  `Neighborhood` column of train.csv), approximate centroids computed from the geocoded
  companion dataset (Barbour & Fragkias, *Data in Brief* 63, 2025,
  doi:10.1016/j.dib.2025.112155), OSM cross-checked; all within lat 41.98–42.09 /
  long −93.72…−93.55; `note` column states centroids are approximate.
- `ml/data/` — `__init__.py`, `ingest.py`, `clean.py`, `validate.py`, `outliers.py`,
  `split.py`, `sale_speed.py`, `pipeline.py` (CLI `python -m ml.data.pipeline`).
- `tests/data/test_data_pipeline.py` — 10 tests, all green.
- `data/processed/` — `train.csv` (945), `val.csv` (338), `test.csv` (175),
  `schema.json`, `outliers_report.json`.

## Key behaviors

- **Split (ADR-4):** train YrSold ≤ 2008 = 947 raw rows, val 2009 = 338, test 2010 = 175.
  Disjoint `Id`s enforced.
- **Outliers (train only):** `GrLivArea > 4000 & SalePrice < 300000` removed exactly 2 rows
  (Ids 524, 1299 — both are literally `SaleCondition == "Partial"`, confirming the
  documented partial-sale caveat). Report in `data/processed/outliers_report.json`.
- **Cleaning:** NA semantics strictly per `data_description.txt` (absent → `"None"`/0);
  `LotFrontage` → train-split Neighborhood median (global train median fallback);
  `Electrical` → train mode; `MSSubClass` → str. Zero NaNs remain.
- **Simulated target:** transparent log-linear DOM model (base 45 days; pricing vs
  neighborhood median, quality/condition, seasonality; per-row noise seeded by
  `(42, Id)` → deterministic and row-order independent). Result: median DOM 37–41 days,
  ~25–29% `sells_within_30_days`. Drop-in `DomProvider` protocol + `RealDomProvider`
  stub for real DOM later.
- **Validation:** expected columns, category sets, numeric ranges, unique Id, coordinate
  bounding box, target consistency; raises `SchemaError` with clear messages.

## Verification (all run for real, venv python)

- `.venv/Scripts/python.exe -m ml.data.pipeline` → `{'train': 945, 'val': 338, 'test': 175}`.
- `.venv/Scripts/python.exe -m pytest tests/data -q` → **10 passed**.
- Reproducibility: pipeline run twice → identical md5 for all three processed CSVs.
- Processed train.csv: 945×85, 0 NaNs, `lat/long/days_on_market/sells_within_30_days/SalePrice` present.

## Issues / deviations (orchestrator please note)

1. **Data vs. description mismatches found and handled:** raw `MSZoning` uses `"C (all)"`
   (not `"C"`), and `BldgType` uses `"2fmCon"/"Duplex"/"Twnhs"` spellings alongside the
   documented ones. Both variants are allowed in `validate.EXPECTED_CATEGORIES` with
   comments. Downstream agents: do not assume only the `data_description.txt` spellings.
2. **"None" token vs pandas NA parsing:** processed CSVs store absent features as the
   literal string `"None"` and contain no NaNs. Readers must use
   `pd.read_csv(..., keep_default_na=False)` or pandas will turn `"None"` back into NaN.
   Documented in `data/README.md` and `data/processed/schema.json` notes — feature/
   training/API agents must follow this.
3. **`SalePrice` range guard:** `validate.NUMERIC_RANGES["SalePrice"] = (10_000, 1_000_000)`;
   observed raw range is 34,900–755,000, comfortably inside.
4. **Outlier report lives in `data/processed/`** (not `reports/`) because `reports/` is
   outside this agent's scope; SPEC §4's "justified in reports/" is satisfied via
   `outliers_report.json` + docstrings. Orchestrator may copy/link it into `reports/`.
5. `requirements.txt` is owned by scaffold; this scope needs only pandas + numpy
   (pytest for tests). Confirmed working with pandas 3.0.5 / numpy 2.5.1 / pytest 9.1.1.
