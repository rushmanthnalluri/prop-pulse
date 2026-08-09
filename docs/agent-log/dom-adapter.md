# Agent log: dom-adapter

Scope: make the simulated-DOM interface genuinely real-data-ready — complete
`RealDomProvider`, wire env-var provider selection into the data pipeline,
add tests, keep the default simulation byte-identical.

## Files touched (owned scope only)

- `ml/data/sale_speed.py` — `RealDomProvider` fully implemented (was a stub);
  module docstring updated to describe the now-real adapter.
- `ml/data/pipeline.py` — provider selection via env vars; dynamic
  provenance note in `schema.json`; new public `select_dom_provider()`.
- `tests/data/test_dom_adapter.py` — NEW, 20 tests.
- `data/README.md` — new "Using real days-on-market data" section.
- `docs/DECISIONS.md` — ADR-3 addendum only.

No other files modified. No git commands run. No servers started, no ports used.

## What was delivered

### 1. `RealDomProvider(csv_path, min_coverage=0.95)` (ml/data/sale_speed.py)

- CSV schema `Id,days_on_market` (extra columns ignored).
- Strict validation at construction — all hard errors with counts:
  missing file (`FileNotFoundError` with format hint), missing columns,
  non-integer `Id` or `days_on_market` dtypes (catches floats/blanks/text),
  duplicate Ids (lists them), days outside [1, 365] (lists count + observed
  min/max), invalid `min_coverage` (must be in (0, 1]).
- Coverage check at `transform(df)`: fraction of `df`'s Ids present in the
  CSV. Below `min_coverage` → `ValueError` with matched/total counts and a
  sample of unobserved Ids (never silent NaNs). Between `min_coverage` and
  100% → missing rows filled with the median observed DOM + logged warning
  with the exact count.
- Deterministic: rows matched by `Id` (order-independent); verified by a test.

### 2. Provider selection (ml/data/pipeline.py)

- `DOM_PROVIDER=simulated|csv` (default `simulated`),
  `DOM_CSV_PATH` (default `data/external/days_on_market.csv`).
- Active provider is logged (`DOM provider: simulated ... - SIMULATED target`
  / `DOM provider: csv - OBSERVED days_on_market from ...`).
- csv + missing file → `FileNotFoundError` before any output is written, with
  a fix-it message naming both env vars.
- `schema.json` note now reflects provenance (SIMULATED vs OBSERVED); for the
  default run the notes list is identical to before, so `schema.json` is
  unchanged.

### 3. Tests (tests/data/test_dom_adapter.py — 20 new)

- Validation: bad dtype (days and Id), out-of-range, duplicate Id, missing
  file, missing columns, invalid `min_coverage`.
- Behavior: exact-match pass + Id alignment on shuffled input,
  `attach_sale_speed` flag derivation, low-coverage error message contains
  counts (`5/10`, `min_coverage`), partial coverage fills median + warns,
  determinism.
- Selection: default → simulator; csv → RealDomProvider; csv + missing file →
  fail-fast; unknown kind → ValueError.
- End-to-end (TEMP output dirs via `tmp_path_factory` — `data/processed/`
  never touched): full pipeline with `DOM_PROVIDER=csv` + fixture CSV
  (`days = Id % 365 + 1` for every raw Id) → all three splits' targets equal
  the CSV values; schema note records OBSERVED. Default run → DOM columns
  equal the committed splits AND full-file md5 equals the committed bytes.

## Verification evidence (all real command output)

Baseline md5 (BEFORE any re-run), captured with `md5sum data/processed/*.csv`:

```
c237df1860d7310db31de7af24150a2f *data/processed/train.csv
c04b4ab6cfc538eee295ca29485bd7cb *data/processed/val.csv
b576c82c7678ae48e0263d1124ba4404 *data/processed/test.csv
```

Default-provider pipeline re-run (`.venv/Scripts/python.exe -m ml.data.pipeline`,
no `DOM_*` env vars set — `env | grep -i DOM_` empty) → AFTER md5:

```
c237df1860d7310db31de7af24150a2f *data/processed/train.csv
c04b4ab6cfc538eee295ca29485bd7cb *data/processed/val.csv
b576c82c7678ae48e0263d1124ba4404 *data/processed/test.csv
```

**Byte-identical on all three — existing champions remain valid.**

Provider logging + fail-fast (CLI):

```
INFO __main__: DOM provider: simulated (SaleSpeedSimulator, seed 42) - SIMULATED target, classification metrics are not real-world performance claims
FileNotFoundError: DOM_PROVIDER=csv but no DOM file at ... Provide a CSV with columns 'Id,days_on_market' (integer days in [1, 365], unique Ids) at that path, point DOM_CSV_PATH at it, or use DOM_PROVIDER=simulated.
```

Tests:

```
.venv/Scripts/python.exe -m pytest tests/data -q        → 30 passed in 1.71s
.venv/Scripts/python.exe -m pytest tests backend/tests -q → 154 passed in 81.65s
```

Pipeline row counts unchanged: `{'train': 945, 'val': 338, 'test': 175}`.

## Notes for the orchestrator

1. One transient failure observed mid-run: first full-suite attempt showed
   `backend/tests/test_security.py::test_abuse_unicode_and_long_strings_rejected`
   FAILED (153 passed) while another agent was concurrently editing backend
   files; the same test passed in isolation immediately after, and the final
   full run is **154 passed** (114 baseline + 20 mine + 20 added by other
   agents). Not related to this scope.
2. `data/external/days_on_market.csv` intentionally NOT created — it is real
   data the project does not have; the fail-fast path covers its absence.
3. Runtime log/error strings kept ASCII (em-dash rendered as `�` in the Git
   Bash console); docstrings keep the repo's existing em-dash style.
4. When real DOM is adopted, remember the "SIMULATED TARGET" caveats live in
   `ml/training/train_classification.py`, `ml/evaluation/evaluate.py`, and
   `reports/` (outside my scope) — flagged in `data/README.md`.
