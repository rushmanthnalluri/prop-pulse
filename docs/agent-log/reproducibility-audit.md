# Agent log — reproducibility-audit

**Date:** 2026-08-07 · **Scope owned:** `scripts/audit_reproducibility.py` (new),
`reports/REPRODUCIBILITY.md` (new)

## What was done

Verified PropPulse's ML reproducibility end-to-end with executed evidence (no vibes), and
automated the audit so it is repeatable.

1. **Data determinism** — md5 of `data/processed/{train,val,test}.csv` + `schema.json` +
   `outliers_report.json` before/after a full `python -m ml.data.pipeline` re-run: **5/5
   byte-identical** (3 independent re-runs).
2. **Feature artifacts** — sha1 of `feature_list.json` / `neighborhood_stats.json` /
   `feature_defaults.json` before/after `python -m ml.features.pipeline`: **byte-identical**;
   `feature_version` unchanged at `9b0f8ba4201c`, matching `champion.json`.
3. **Model reproducibility** — backed up `models/regression/`, `models/classification/`,
   classification figures; fully retrained both families (all candidates + calibrated
   variants, MLflow redirected to a scratch store); compared OLD vs NEW on a fixed 50-row val
   slice:
   - ridge_v1: max |Δlog| = **0.0**, max |Δ$| = **$0.0000** (bit-identical)
   - random_forest_calibrated_v1: max |Δprob| = **2.22e-16** (one float64 ulp)
   - metrics.json: 9 differing leaves, **all `random_forest.*`, all 1-ulp scale** (thread-order
     float accumulation in RF predict with `n_jobs=-1`; fit itself is byte-deterministic)
   - 5/6 regression + 7/9 classification artifacts + 2/2 figures byte-identical; the 3
     byte-differing files were restored from backup → repo byte-stable
4. **Seed audit** — `ml/` scan: 19 seeded usages, all anchored to `RANDOM_SEED=42`
   (`ml/paths.py:30`), **0 exceptions**; notes on sklearn/xgboost determinism in the report.
5. **MLflow inventory** — 19 active runs across 4 experiments (regression 9, classification 5,
   clustering 3, evaluation 2); **every active run has `dataset_version` + `feature_version`
   tags**. Cosmetic leftovers documented: 1 failed-but-active `linear_v1`, 2 soft-deleted
   failed `logistic_v1`, 3 orphan run dirs in `.trash` (2 deleted experiments), duplicate run
   names from build-wave re-runs.
6. **Pins** — `requirements.txt` (21) + `backend/requirements.txt` (14) fully `==`-pinned;
   `pip check` → `No broken requirements found.`
7. **Runbook** — verified all 9 pipeline CLIs exist (import + `main()` + `__main__` guard read,
   no `--help` execution); full data→…→monitoring sequence documented in
   `reports/REPRODUCIBILITY.md` §7. `drift_check --help` exercised (only argparse CLI).

## Notable findings for other agents / orchestrator

- **mlflow 3.15 file-store path gotcha:** `FileStore._is_valid_run_directory`
  (ZDI-CAN-26649 defense) rejects any run whose absolute path contains an `artifacts`
  component. A `MLFLOW_TRACKING_URI` under a directory named `artifacts/...` fails
  deterministically at `create_run` with `Run '<uuid>' not found`. Avoid `artifacts` in any
  tracking-URI path (relevant to the optional compose mlflow service / deployment docs).
- **RF predict-time ulp drift is expected:** forest *fits* are byte-deterministic;
  `predict_proba` with `n_jobs=-1` can drift ~1e-16 between runs. The calibrated RF champion
  joblib may therefore differ in bytes after a retrain while being functionally identical.
- An empty `mlruns/models/` dir appears whenever an mlflow client initializes against the file
  store (registry-store side effect); removed after this audit.
- Test suite grew 114 → 154 during the hardening wave (other agents added tests); all green.

## Files created

- `scripts/audit_reproducibility.py` — repeatable audit (steps 1–4 + 6), PASS/FAIL table,
  exit 0/1. Restores backups on FAIL; restores byte-differing artifacts on PASS so the repo
  stays canonical; retrain MLflow runs go to a deleted-afterwards scratch store.
- `reports/REPRODUCIBILITY.md` — full evidence report with pasted command outputs.

## Verification

- `.venv/Scripts/python.exe scripts/audit_reproducibility.py` → **OVERALL: PASS**, exit 0
  (final run output pasted in `reports/REPRODUCIBILITY.md`).
- Post-audit md5 spot-check: `ridge_v1.joblib` `eee200e5…`, `random_forest_calibrated_v1.joblib`
  `cfd06a15…`, both `metrics.json`, both figures, processed CSVs — all match pre-audit hashes.
- `.venv/Scripts/python.exe -m pytest tests backend/tests -q` → **154 passed, 4 warnings in
  31.91s** (exit 0).
- No servers started, no ports used, no git commands run; scratch stores and backups cleaned up.
