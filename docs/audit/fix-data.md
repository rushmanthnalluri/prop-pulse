# Fix Report — fix-data

Agent: **fix-data** · Date: 2026-08-07 · Scope owned: `ml/data/**`, `tests/data/**`, `data/processed/schema.json`
Findings source: `docs/audit/FINDINGS.md` (AUD-09, AUD-13, AUD-16, AUD-23) + `docs/audit/llba-data.md` F2/F6/F10 + stale-count docstring fix.

No CSV bytes, no model artifacts, and no runtime model behavior were changed (md5 evidence below).

## Fixes applied

| AUD-id | file:line | Change |
|---|---|---|
| AUD-09 (llba-data F1) | `ml/data/sale_speed.py:284-292` | `attach_sale_speed` crashed on an empty frame: the INFO log called `int(out["days_on_market"].median())` → `ValueError: cannot convert float NaN to integer`. Guarded the stats log with `if len(out):`; empty frames now log "empty input frame (0 rows)" and return the frame with both target columns, consistent with `RealDomProvider.transform`'s explicit empty-input support. |
| AUD-16 (data-exec F2) | `ml/data/outliers.py:27-32` | Comment was factually wrong ("there are none >4000 sqft above ~300k in train, but the guard is cheap insurance"). Raw train split contains Ids 692 (4316 sqft, $755,000) and 1183 (4476 sqft, $745,000) — re-verified against `data/raw/ames/train.csv`. Comment corrected: the `SalePrice < 300_000` guard is load-bearing; without it those two legitimate luxury sales would be deleted. Code untouched. |
| llba-data F2 (P3 docstring) | `ml/data/outliers.py:42-45` | `apply_outlier_rules` docstring said "cleaned TRAIN split" but `pipeline.py` applies the rules to the **raw** train split (before `fit_cleaner`). Docstring corrected. Behavior unchanged (rule columns are unaffected by cleaning). |
| AUD-13 schema part (data-exec F1) | `data/processed/schema.json:6`; `ml/data/validate.py:236-242`; `ml/data/clean.py:135-142` | schema.json declared `MSSubClass: "object"` while the CSV round-trip and every consumer read int64. `validate.py` has **no dtype enforcement** (checked: only column presence / categories / ranges / no-missing), so nothing to align there. `build_schema_report` now emits the on-disk dtype (`columns["MSSubClass"] = "int64"` with an explanatory comment), and the committed `schema.json` was corrected to `"int64"`. `clean.py` keeps the in-memory `astype(str)` but now carries a comment: the CSV round-trip re-infers int64, consumers treat it as a scaled numeric, and true one-hot treatment is a documented future improvement (changing the feature space would invalidate the verified champions — no retrain, per FINDINGS.md AUD-13 disposition). |
| AUD-23 (llba-data F6/F10) | `ml/data/pipeline.py:108`, `:112-114` | (a) `DOM_PROVIDER=""` (set-but-empty, common .env pattern) was a hard `ValueError`; now `os.environ.get(..., "").strip().lower() or "simulated"` treats empty/whitespace-only as unset → simulated default. Unknown non-empty values still raise. (b) A relative `DOM_CSV_PATH` resolved against the process CWD; now anchored to `ml.paths.REPO_ROOT` (absolute paths unchanged). `select_dom_provider` docstring updated to document both. |
| Stale count (P3 docstring) | `ml/data/pipeline.py:139` | `run_pipeline` docstring example said `{"train": 942, ...}`; actual committed count is 945. Corrected. |

## Regression tests added

- `tests/data/test_dom_adapter.py`
  - `test_attach_sale_speed_empty_frame_real_provider` / `test_attach_sale_speed_empty_frame_simulator` (AUD-09)
  - `test_select_dom_provider_empty_value_means_unset` / `test_select_dom_provider_whitespace_value_means_unset` (AUD-23a)
  - `test_select_dom_provider_relative_csv_path_anchors_repo_root` (AUD-23b — chdir to tmp, relative path must still find `data/external/neighborhood_geo.csv` via the repo-root anchor and then fail on missing DOM columns, proving the file was located)
- `tests/data/test_data_pipeline.py`
  - `test_schema_json_mssubclass_declares_on_disk_dtype` (AUD-13: committed schema declares int64 == CSV round-trip dtype in all 3 splits)
  - `test_build_schema_report_declares_mssubclass_int64` (AUD-13: report emits int64 even for an in-memory str column)

## Evidence

### AUD-09 before/after

Before (pre-fix, reproduced on the old code):

```
empty attach: ValueError cannot convert float NaN to integer
```

After:

```
AUD-09 real provider empty: 0 rows, cols ok: True
AUD-09 simulator empty: 0 rows, cols ok: True
```

### AUD-23 before/after

Before (llba-data evidence, verified): `DOM_PROVIDER=` failed fast with `ValueError: Unknown DOM_PROVIDER=''`; relative `DOM_CSV_PATH` resolved against CWD.

After:

```
AUD-23 DOM_PROVIDER='' -> SaleSpeedSimulator
AUD-23 DOM_PROVIDER='   ' -> SaleSpeedSimulator
```

### AUD-16 fact re-verification (raw train split)

```
  Id  GrLivArea  SalePrice  YrSold
 692       4316     755000    2007
1183       4476     745000    2007
```

### Byte-identity regression guard — `python -m ml.data.pipeline` in-place re-run

Before fix (baseline) → after re-run with fixes:

```
train.csv               c237df1860d7310db31de7af24150a2f  ->  c237df1860d7310db31de7af24150a2f  IDENTICAL
val.csv                 c04b4ab6cfc538eee295ca29485bd7cb  ->  c04b4ab6cfc538eee295ca29485bd7cb  IDENTICAL
test.csv                b576c82c7678ae48e0263d1124ba4404  ->  b576c82c7678ae48e0263d1124ba4404  IDENTICAL
outliers_report.json    b5544a6427c088d204d340a6951844bd  ->  b5544a6427c088d204d340a6951844bd  IDENTICAL
schema.json             4061da6f4fbdb72096b4a51690f82534  ->  2721af81cee05c942202bf2f7eb4e43a  CHANGED (intended: MSSubClass object -> int64)
```

The regenerated `schema.json` md5 (`2721af81...`) exactly equals the hand-corrected committed file's md5 — i.e. `build_schema_report` now deterministically reproduces the corrected schema, so future pipeline re-runs stay stable.

### Tests

- Targeted: `.venv/Scripts/python.exe -m pytest tests/data -q` → **37 passed** (was 30; +7 new).
- Full suite: `.venv/Scripts/python.exe -m pytest tests backend/tests -q` → **169 passed**, 4 warnings (pre-existing shap PendingDeprecationWarning), in 46.82s. Baseline was 162 green; 162 + 7 new = 169, all green.

## Notes for the orchestrator

- `data/processed/schema.json` changed (one value: `MSSubClass` `object`→`int64`); the three CSVs and `outliers_report.json` are byte-identical. `scripts/audit_reproducibility.py` md5-compares schema.json across an in-place rerun — this remains self-consistent because the regenerated file equals the committed one.
- Deliberately NOT done (out of assignment / no behavior-change mandate): llba-data F4 (DOM_MAX/`30`/split-year constant duplication in validate.py), F5 (intra-split duplicate-Id gap in split.py), F7 (median truncation doc note), F8 (partial-output write loop), F9 (duplicate geo loader in `ml/clustering/dataset.py` — owned by another agent). F4/F5/F8 would be code changes beyond my assigned AUD-ids; flagging for the orchestrator's backlog.
- Docs-side AUD-13 wording (DECISIONS.md ADR note) belongs to the docs agent (AUD-27 scope), not touched here.
