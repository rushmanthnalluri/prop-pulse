# Agent log — eda

**Status:** DONE · 2026-08-07

## Scope owned
`notebooks/`, `figures/`, `reports/EDA_REPORT.md`. No files outside this scope were modified
(data/, ml/, models/ untouched; test.csv never opened).

## Deliverables
- `notebooks/01_eda.ipynb` — real, executed notebook (16/16 code cells have outputs, zero
  errors, execution counts 1..16 in order). Built by `notebooks/build_01_eda.py` (nbformat;
  kept for reproducibility) and executed with
  `.venv/Scripts/python.exe -m jupyter nbconvert --to notebook --execute --inplace notebooks/01_eda.ipynb`.
- `figures/01..14_*.png` — 14 figures, dpi=150, titled axes; all verified on disk non-empty
  (57 KB – 261 KB each).
- `reports/EDA_REPORT.md` — structured findings, embedded figure links, key-numbers table,
  explicit "Implications for modeling" section, figure inventory with byte sizes.

## Coverage (per assignment)
SalePrice + log1p distribution; price_per_sqft (EDA-only, leakage-flagged); living/lot area;
bedrooms/bathrooms (total_bath incl. basement halves, SPEC §5); property age; OverallQual/
OverallCond; amenity_count (SPEC §5 formula); geo scatter (centroids + seeded jitter,
viz-only); 25-neighborhood sorted boxplot; days_on_market + sells_within_30_days
(explicitly labelled SIMULATED TARGET per ADR-3); correlation heatmap; raw missingness
profile (`data/raw/ames/train.csv`); outlier analysis tied to
`data/processed/outliers_report.json` (Ids 524/1299 verified as Partial sales; luxury tail
kept with justification); seasonality by MoSold/YrSold (val.csv 2009 used only for the
yearly panel).

## Key computed numbers (train n=945, all from the executed notebook)
- SalePrice: mean $182,125 / median $164,990 / std $78,872; skew 1.967 → 0.175 after log1p.
- Top correlates of SalePrice: OverallQual r=0.789, GrLivArea 0.752, TotalBsmtSF 0.639,
  total_bath 0.636, GarageCars 0.634.
- Neighborhood median spread: 3.18× (NridgHt $318,000 vs BrDale $100,000).
- Fast-sale class balance: 25.3% / 74.7% (239/706) [SIMULATED target, ADR-3];
  simulated DOM median 41 d, IQR 30–54 d, max 141 d.
- Raw missingness: 19 cols; PoolQC 99.5% … mostly structural NA; only LotFrontage 17.7%
  is a true measurement gap.
- Outliers: 2 partial-sale removals on train (947→945); 39 rows (4.1%) above the $341,750
  IQR fence deliberately kept.
- Seasonality: peak July (167 sales), trough Feb (27); median price 2006→2008 +0.6%.

## Verification performed
- nbconvert execution: clean, no tracebacks (verified programmatically: scanned all cell
  outputs for `output_type == "error"` → none; every code cell has outputs).
- All 14 PNGs exist and are >10 KB (listed with byte sizes in the report); 5 figures
  visually spot-checked after generation.
- Numbers in the report were extracted from the executed notebook's own printed outputs
  (no hand-typed statistics).

## Notes for orchestrator / other agents
- Notebook re-run command: `.venv/Scripts/python.exe notebooks/build_01_eda.py && .venv/Scripts/python.exe -m jupyter nbconvert --to notebook --execute --inplace notebooks/01_eda.ipynb`.
- Rare neighborhoods (Blueste n=1, NPkVill n=3, MeadowV n=9) → noisy medians for the
  train-only neighborhood stats join (features agent, SPEC §5).
- Distance-to-city-center is weakly *positively* correlated with price (r=+0.279): premium
  stock sits on the northern outskirts — location value is neighborhood identity, not
  radial distance (relevant to clustering agent, ADR-9).
- OverallCond is non-informative standalone (r=-0.079, non-monotone); OverallQual dominates.
