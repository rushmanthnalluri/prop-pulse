# Agent Log — devops

**Scope:** `docker/`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/`
**Date:** 2026-08-07 · **Status:** complete (statically validated; builds not executed — daemon down, ADR-7)

## Delivered

| File | Purpose |
|---|---|
| `docker/backend.Dockerfile` | `python:3.12-slim` (ADR-7: container pins stable 3.12, independent of host 3.14); installs `backend/requirements.txt` (slim serving subset — no mlflow needed: `ml.tracking` imports it lazily, verified at `ml/tracking.py:51`); copies `ml/`, `backend/`, `models/` (whole, ~61 MB) and `data/external/neighborhood_geo.csv`; non-root `appuser`; `ENV` defaults mirroring every `.env.example` key; `EXPOSE 8000`; exec-form uvicorn CMD bound to `0.0.0.0`. Creates writable `/app/logs` + `/app/reports/drift` before `USER`. |
| `docker/frontend.Dockerfile` | Multi-stage: `node:24-alpine` build (`ARG VITE_API_URL` default `http://localhost:8000`, baked by Vite) → `nginx:alpine` serving `dist/`. Install pattern: `npm ci` if `package-lock.json` exists else `npm install` (lock file absent at authoring time; documented in README). |
| `docker/nginx.conf` | SPA history fallback (`try_files $uri $uri/ /index.html`), gzip, immutable caching for fingerprinted `/assets/`. |
| `docker-compose.yml` | `backend` (build, `env_file: .env`, `API_HOST=0.0.0.0` override, `8000:8000`, mounts `./logs` + `./reports/drift`, urllib-based `/health` healthcheck with 40s start_period for champion loading), `frontend` (build args, `8080:80`, `depends_on: service_healthy`), `mlflow` (`ghcr.io/mlflow/mlflow:latest`, `mlflow server --backend-store-uri /mlruns`, `./mlruns` mount, `5000:5000`, profile `mlflow`, **`MLFLOW_ALLOW_FILE_STORE=true`** — required by MLflow 3.15 for file stores, SPEC §14; `ml/tracking.py` only sets it in-process, not for the server CLI). |
| `.dockerignore` | Excludes `.venv`, `node_modules`, `mlruns`, `logs`, `.git`, `data/{raw,interim,processed}`, `notebooks`, `figures`, `reports`, `tests`, `backend/tests`, `**/__pycache__`, `.env`, `*.zip`, docs. Keeps everything the images COPY (`data/external/` explicitly kept). |
| `.github/workflows/ci.yml` | Jobs: `python` (setup-python 3.12, `pip install -r requirements.txt`, `python -m pytest tests backend/tests -q`), `frontend` (node 24, guarded `npm ci`/`npm install`, `npm run build`), `docker` (`cp .env.example .env` then `docker compose config -q` — validation only; no builds, no pushes, no secrets). |
| `docker/README.md` | Build/run commands, service table, env-var table, daemon-unavailable caveat, drift-check scheduling (cron + `docker compose exec` + scheduled-CI sketch), CORS caveat, Linux bind-mount permission note. |

## Verification evidence (all actually executed)

1. **YAML parse** (`.venv/Scripts/python.exe`, pyyaml 6.0.3): `docker-compose.yml` OK (keys `name`, `services`); `ci.yml` OK (`on:` surfaces as `True` — standard PyYAML 1.1 coercion, GitHub Actions parses it correctly).
2. **`docker compose config -q`** (Compose v5.1.1, Docker 29.4.0 CLI; daemon not required): exit 0 → `=== compose config -q: VALID ===`; `config --profiles` → `mlflow`. Full render inspected: backend env merge + healthcheck + both bind mounts + `8000:8000`; frontend build arg + `depends_on: service_healthy` + `8080:80`; `--profile mlflow` render shows command/env/mount correct. Temp `.env` (copied from `.env.example`) removed afterwards — none left in repo.
3. **COPY sources exist now**: `ml/`, `backend/`, `models/`, `backend/requirements.txt`, `data/external/neighborhood_geo.csv`, `docker/nginx.conf`, `frontend/package.json` — all present. Frontend is standard Vite (`build: vite build`, default `dist/` outDir per `frontend/vite.config.js`), matching the Dockerfile. `frontend/package-lock.json` absent → guarded install pattern applies; noted as pending-verification until the frontend agent commits the lock.
4. **`.dockerignore` review**: every COPY source checked against every pattern — no needed path excluded; heavy/runtime paths excluded.
5. **Dockerfile eye review** (no hadolint/shellcheck available): layer-cache order (requirements before source), no apt deps required (all pins are self-contained manylinux wheels), exec-form CMD, non-root user, `EXPOSE` correct, busybox-`sh`-compatible `if [ -f ... ]` in frontend stage.

## Why `data/external/neighborhood_geo.csv` is in the backend image

It is read at serving time by three consumers: `ml/features/pipeline.py:196`
(`_geo_lookup`, lat/long for every prediction), `backend/app/schemas/property.py:55`
(neighborhood validation), `backend/app/services/cluster_service.py:28`
(micro-market lookup). Confirmed by grep before writing the Dockerfile.

## Handled findings / decisions

- **CORS gap (needs backend scope):** `CORS_ORIGINS` in `backend/app/main.py:39` allows only `http://localhost:5173`; the composed frontend is served at `http://localhost:8080`, so browser calls to `:8000` will be rejected until the backend allow-list includes `:8080` (or becomes env-driven). Documented in `docker/README.md`; not fixed here — backend files are out of scope.
- **Extra volume `./reports/drift:/app/reports/drift`:** beyond the assigned `./logs` mount; it makes the SPEC §10 monitoring loop coherent — the scheduled drift check (in-container via `docker compose exec`, or host cron) writes `reports/drift/latest.json`, which `/metrics` reads. Persisted on host, excluded from the image.
- **`API_HOST` override in compose:** `.env.example` defaults to `127.0.0.1` (bare-metal dev); containers must bind `0.0.0.0`. Compose `environment:` beats `env_file`, and the uvicorn CMD already pins `--host 0.0.0.0`.
- **MLflow service env:** `MLFLOW_ALLOW_FILE_STORE=true` added (see table above) — without it the `mlflow server` CLI would reject the `/mlruns` file store on MLflow 3.15.

## Not done / risks for first real build

- **No image builds were executed** (daemon unavailable, ADR-7). First build on a live daemon should watch for: missing shared libs on slim (e.g. `libgomp1` — xgboost/scikit-learn wheels vendor their own, but verify), and `npm install` resolving cleanly without a lock file.
- Backend CI job runs on Python 3.12 while the repo pins were verified on 3.14; all pinned packages publish cp312 wheels, but the first CI run is the real proof.
- The `frontend` CI job fails until the frontend agent's `package.json` lands on main (it exists locally already; the job also needs the lock file eventually for `npm ci`).

No git commands were run. No secrets anywhere. `docs/AGENT_STATUS.md` untouched (per instructions).
