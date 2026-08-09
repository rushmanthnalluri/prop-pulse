# PropPulse — Docker packaging (SPEC §12, ADR-7)

Three images/services: the FastAPI **backend** (`docker/backend.Dockerfile`),
the Vite/React **frontend** (`docker/frontend.Dockerfile`, nginx-served), and an
opt-in **MLflow** tracking server (compose profile `mlflow`).

> **Builds verified 2026-08-07** (Docker Server 29.4.0, Compose v5.1.1):
> both images build cleanly and the full stack passed a live smoke test —
> every endpoint, the nginx-served frontend, CORS, the bind-mounted
> prediction log, and an in-container drift check. Commands, image sizes,
> and evidence: **`reports/DOCKER_SMOKE.md`**.
>
> Two packaging fixes fell out of the first real build (both applied):
> 1. The SHAP explainer builds its background from `data/processed/train.csv`
>    at serving time (`ml/explainability/explainer.py`), so the backend image
>    now copies that one file (un-excluded in `.dockerignore`). Without it
>    `/predict` returned empty `top_price_factors`.
> 2. If host ports 8000/8080/5000 are occupied (e.g. other Docker projects),
>    merge the committed `docker-compose.alt-ports.yml` explicitly (recipe
>    below) — it remaps `ports` with the `!override` tag (Compose v2 *appends*
>    port mappings otherwise) and sets `CORS_ORIGINS` / the `VITE_API_URL`
>    build ARG to the remapped ports. See `reports/DOCKER_SMOKE.md` §Port
>    remap.

## Prerequisites

- Docker Engine 24+ with Compose v2 (`docker compose version`).
- A local `.env`: `cp .env.example .env` (compose reads `env_file: .env`;
  the file is gitignored and must contain no secrets).

## Build & run the whole stack

From the **repo root**:

```bash
cp .env.example .env          # once
docker compose up --build     # backend on :8000, frontend on :8080
docker compose --profile mlflow up --build   # also MLflow UI on :5000 (opt-in)
```

Default host ports are **8000** (backend), **8080** (frontend), **5000**
(mlflow). If they are occupied on your host, merge the committed alternative
mapping (18000/18080/15000) explicitly — it is deliberately *not* named
`docker-compose.override.yml`, so compose never picks it up automatically:

```bash
docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml up --build
# backend on :18000, frontend on :18080 (+ mlflow on :15000 with --profile mlflow)
```

(This repo's development machine has unrelated `showcase-*` containers bound
to 8000/8080/5000 — that is why the alt-ports file exists.)

Individual images (equivalent to what compose does):

```bash
docker build -f docker/backend.Dockerfile -t proppulse-backend:latest .
docker build -f docker/frontend.Dockerfile \
  --build-arg VITE_API_URL=http://localhost:8000 \
  -t proppulse-frontend:latest .

# Backend alone (bind-mount the logs so the drift check can read them):
docker run --rm -p 8000:8000 \
  -v "$PWD/logs:/app/logs" \
  proppulse-backend:latest
```

Smoke check once up:

```bash
curl http://localhost:8000/health          # {"status":"ok","models_loaded":{...}}
curl http://localhost:8080/                # SPA shell
```

## Services

| Service  | Image | Port | Notes |
|---|---|---|---|
| backend  | `proppulse-backend` (python:3.12-slim) | 8000 | non-root user; healthcheck `GET /health` (start_period 40s — champions load at startup); mounts `./logs` and `./reports/drift` |
| frontend | `proppulse-frontend` (node:24-alpine → nginx:alpine) | 8080→80 | `VITE_API_URL` is a **build** ARG (Vite inlines it); `depends_on` backend healthy |
| mlflow   | `ghcr.io/mlflow/mlflow:latest` | 5000 | profile `mlflow` (opt-in); `MLFLOW_ALLOW_FILE_STORE=true` is required by MLflow 3.15 for the file store (SPEC §14); mounts `./mlruns` |

## Environment variables

Keys mirror `.env.example` (SPEC §12). The backend image sets the defaults
below via `ENV`; compose's `env_file: .env` overrides them, and the compose
`environment:` block overrides `env_file` (used to force `API_HOST=0.0.0.0`).

| Variable | Default (image / .env.example) | Purpose |
|---|---|---|
| `MODEL_DIR` | `models` | model artifact root (repo-relative → `/app/models`) |
| `DATA_DIR` | `data` | dataset root (only `data/external/neighborhood_geo.csv` + `data/processed/train.csv` are baked in) |
| `MLFLOW_TRACKING_URI` | empty | empty → local file store; set `http://localhost:5000` to use the mlflow service from the host |
| `API_HOST` | `0.0.0.0` in container (`127.0.0.1` in .env.example) | bind address; containers must use 0.0.0.0 |
| `API_PORT` | `8000` | uvicorn port |
| `VITE_API_URL` | `http://localhost:8000` | frontend → backend base URL; **frontend build-time ARG** — changing it requires rebuilding the frontend image |
| `LOG_LEVEL` | `INFO` | backend logging verbosity |
| `PREDICTION_LOG_PATH` | `logs/predictions.jsonl` | JSONL prediction log (bind-mounted to `./logs`) |
| `DRIFT_PSI_THRESHOLD` | `0.2` | PSI drift threshold honored by the drift check (warn threshold fixed at 0.1) |
| `MLFLOW_ALLOW_FILE_STORE` | `true` (mlflow service only) | MLflow 3.15 file-store gate (SPEC §14) |

## Monitoring: drift check in deployment

The API appends every prediction to `logs/predictions.jsonl` (SPEC §10 binding
schema); `ml.monitoring.drift_check` compares the recent window against
`models/monitoring/reference_stats.json` and writes `reports/drift/latest.json`,
which `GET /metrics` surfaces. **It never retrains** — it only sets
`retraining_recommended`.

Because compose bind-mounts `./logs` and `./reports/drift`, the check can run
inside the backend container on a schedule. Cron example (every 15 min):

```cron
*/15 * * * * cd /opt/proppulse && docker compose exec -T backend python -m ml.monitoring.drift_check --window 500 >> /var/log/proppulse-drift.log 2>&1
```

One-off / manual:

```bash
docker compose exec backend python -m ml.monitoring.drift_check --window 500
cat reports/drift/latest.json
```

GitHub Actions scheduled variant (runs on the hosted checkout with the full dev
requirements; uses the same mounted log if artifacts are synced back):

```yaml
on:
  schedule: [{ cron: "*/30 * * * *" }]
# steps: checkout → setup-python 3.12 → pip install -r requirements.txt
#      → python -m ml.monitoring.drift_check --window 500
```

Exit code is 0 even with no log data (report status `no_data`), so the schedule
is safe before traffic starts.

## Notes & caveats

- **CORS**: allowed origins are env-driven via `CORS_ORIGINS`
  (`backend/app/config.py`, default `http://localhost:5173,http://localhost:4173,http://localhost:8080`
  in `.env.example`). The composed frontend on `:8080` therefore works out of
  the box; add more origins as a comma-separated list in `.env` if needed.
- **npm install pattern** (frontend image + CI): `npm ci` when
  `frontend/package-lock.json` exists (reproducible), otherwise `npm install`.
  The lock file is committed, so `npm ci` is the default path.
- **Non-root**: the backend runs as `appuser` (uid/gid `app`); `/app/logs` and
  `/app/reports/drift` are created writable. On native Linux hosts, bind-mounted
  host dirs must be writable by the container user (`mkdir -p logs reports/drift`
  first; Docker Desktop on Windows/macOS handles this automatically).
- **Image contents**: the backend image copies `models/` whole (champions +
  feature/neighborhood/cluster/monitoring/explainability artifacts) plus two
  files from `data/`: `data/external/neighborhood_geo.csv` (serving-time geo
  lookup) and `data/processed/train.csv` (SHAP background, 334 KB). Raw/interim
  data, the val/test splits, notebooks, figures, reports and the local `mlruns`
  store are excluded via `.dockerignore`.
- Compose **never pushes images** and uses no secrets; CI validates the
  compose files with `docker compose config -q` only — the base file alone
  and merged with `docker-compose.alt-ports.yml` (no image builds).
