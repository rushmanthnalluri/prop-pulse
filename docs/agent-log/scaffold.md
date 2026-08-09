# scaffold — completion note (2026-08-07)

## Files delivered

- **Directory skeleton** per PROJECT_SPEC §3: `backend/app/{api,schemas,services,monitoring}`,
  `backend/tests`, `ml/{data,features,training,evaluation,clustering,explainability,monitoring}`
  (each with `__init__.py`; existing `ml/paths.py` + `ml/tracking.py` untouched),
  `models/registry/`, `artifacts/`, `mlruns/`, `data/{raw,interim,processed,external}/`,
  `notebooks/`, `reports/`, `figures/`, `docs/agent-log/`, `docker/`,
  `tests/{data,features,ml,integration}/` (with `__init__.py`), `logs/`,
  `.github/workflows/`, `frontend/` (empty placeholder). `.gitkeep` in empty placeholder dirs.
- `.gitignore` — `.venv/`, `node_modules/`, `__pycache__/`, `*.pyc`, `.env`, `mlruns/`,
  `logs/`, `dist/`, `.pytest_cache/`, `.ipynb_checkpoints/` (+ OS/editor noise).
- `.venv/` — created with `python -m venv .venv` (Python 3.14.5), pip 26.2.1.
- `requirements.txt` — full ML+API dev set, pinned to installed versions.
- `backend/requirements.txt` — slim serving set (fastapi, uvicorn[standard], pydantic,
  pydantic-settings, python-dotenv, joblib, pandas, numpy, scikit-learn, xgboost, scipy,
  httpx, shap, numba), same pins.
- `pytest.ini` — `pythonpath = .`, `testpaths = tests backend/tests`, marker `integration`.
- `.env.example` — exactly the SPEC §12 keys with local defaults
  (`MLFLOW_TRACKING_URI` empty = local `./mlruns` file store via `ml/tracking.py`).
- `conftest.py` — inserts repo root on `sys.path` (belt-and-braces next to `pythonpath = .`).
- `docs/DECISIONS.md` — ADR-6 update with resolver findings (see below).

## Installed versions (verified)

pandas 2.3.3 · numpy 2.4.6 · scipy 1.18.0 · scikit-learn 1.9.0 · matplotlib 3.11.1 ·
seaborn 0.13.2 · joblib 1.5.3 · xgboost 3.4.0 · shap 0.52.0 · numba 0.66.0 ·
mlflow 3.15.1 · fastapi 0.141.1 · uvicorn 0.52.1 · pydantic 2.13.4 ·
pydantic-settings 2.14.2 · python-dotenv 1.2.2 · pytest 9.1.1 · httpx 0.28.1 ·
jupyter 1.1.1 · nbconvert 7.17.1 · requests 2.34.2 · pip 26.2.1

**No package failed on Python 3.14.** shap (the predicted casualty) installed first try,
with working cp314 wheels for its numba/llvmlite chain.

## Verification evidence

- Import check (`sklearn, xgboost, shap, mlflow, fastapi, pandas, numpy, matplotlib` +
  9 more): all import and print versions — full output above; `python 3.14.5`.
- `pip check` → "No broken requirements found."
- shap runtime smoke test: RandomForestRegressor + `shap.TreeExplainer.shap_values`
  on a seeded frame → OK, values shape (5, 2).
- `ml.tracking.get_tracking_uri()` → `file:///C:/Machine_Learning/Prop-pulse/mlruns`
  (created `mlruns/`); `ml.paths` constants resolve and `models/` exists.
- `pytest --collect-only -q` → 10 tests collected (data agent's `tests/data/`) in 0.72s;
  `pytest -q` → **10 passed**. Confirms pytest.ini/conftest wiring works for other agents.

## Issues / deviations (orchestrator must know)

1. **pandas is 2.3.3, not 3.x** — `mlflow==3.15.1` declares `Requires-Dist: pandas<3`;
   the resolver downgraded pandas 3.0.5 → 2.3.3. This supersedes SPEC §1's
   "pandas 3.0.3 confirmed". **All agents should code against the pandas 2.3 API**
   (e.g. no `pd.NA`-only behaviors that differ in 3.x, `.map` vs `.applymap` etc.).
   Recorded under ADR-6.
2. **numpy is 2.4.6** — `numba==0.66.0` (shap dependency) declares `numpy<2.5,>=1.22`.
   Matches the SPEC-confirmed numpy version, so no practical impact.
3. **Transient network failure**: first mlflow install attempt died on a DNS
   `NameResolutionError` for `files.pythonhosted.org`; retry after ~45 s succeeded.
   No package changes resulted.
4. `backend/requirements.txt` includes `shap` + `numba` (shap installed fine, so the
   serving image carries the numba/llvmlite chain — heavier but functional).
5. `.env` files and `mlruns/`, `logs/` contents are gitignored by design;
   `logs/` and `mlruns/` exist on disk but have no `.gitkeep` (they are ignored paths).
