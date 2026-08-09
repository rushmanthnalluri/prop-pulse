# PropPulse — Deployment

How to run PropPulse beyond `npm run dev`: configuration reference, a local
production-style run, the Docker Compose stack, drift-check scheduling, the CI
pipeline, and a hardening checklist for putting it behind real traffic.

> **Build status (updated, supersedes ADR-7's original caveat):** images build
> cleanly and the full compose stack (backend, frontend-nginx, optional mlflow
> profile) passed an in-container smoke test — see `reports/DOCKER_SMOKE.md`.
> The first-build notes in `docker/README.md` (port remapping via the opt-in
> `docker-compose.alt-ports.yml`) still apply.

## 1. Configuration reference

The backend reads env vars / `.env` via pydantic-settings
(`backend/app/config.py`, case-insensitive; `.env.example` is the template —
copy it, never commit secrets). Relative paths resolve against the repo root.

| Variable | Default | Purpose |
|---|---|---|
| `MODEL_DIR` | `models` | Model artifact root (champions, feature list, stats, monitoring refs) |
| `DATA_DIR` | `data` | Dataset root; only `data/external/neighborhood_geo.csv` is needed at serving time |
| `MLFLOW_TRACKING_URI` | *(empty)* | Empty → local file store `./mlruns`; set e.g. `http://localhost:5000` for a server |
| `API_HOST` | `127.0.0.1` | Uvicorn bind address (containers must use `0.0.0.0` — compose overrides this) |
| `API_PORT` | `8000` | Uvicorn port |
| `VITE_API_URL` | `http://localhost:8000` | Frontend → backend base URL. For the frontend Docker image this is a **build-time ARG** (Vite inlines it); changing it requires rebuilding the image |
| `LOG_LEVEL` | `INFO` | Backend logging verbosity (`DEBUG|INFO|WARNING|ERROR`) |
| `PREDICTION_LOG_PATH` | `logs/predictions.jsonl` | JSONL prediction log (SPEC §10 binding schema) |
| `DRIFT_PSI_THRESHOLD` | `0.2` | PSI drift threshold honored by `ml.monitoring.drift_check`; the warn threshold is a fixed 0.1 (half of the default — it does not scale with an override) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173,http://localhost:8080` | Comma-separated browser origins allowed by CORS (Vite dev server, Vite preview, compose frontend). Parsed by `Settings.cors_origin_list` |
| `MLFLOW_ALLOW_FILE_STORE` | `true` | Required by MLflow 3.15 to permit a local file store (SPEC §14). Not consumed by the backend — it exists so bare-metal `mlflow server --backend-store-uri ./mlruns` works after `cp .env.example .env` + sourcing `.env`; `ml/tracking.py` also sets it in-process and the compose `mlflow` service sets it in its own environment |

## 2. Local production-style run

From the repo root, with the trained artifacts committed in `models/`:

```bash
cp .env.example .env          # adjust if needed; no secrets required
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt  # slim serving subset (or requirements.txt for full)

# Backend — bind/port come from .env; explicit flags win:
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

# Frontend production build + preview:
cd frontend && npm install && npm run build && npm run preview   # http://localhost:4173
```

Operational notes:

- **Use a single uvicorn worker.** Request counters and the drift summary
  reader are in-memory per process, and the prediction log writer is
  thread-safe but not multi-process-aware; `--workers > 1` would split
  `/metrics` state across workers. Put a process manager (systemd, NSSM) in
  front for restarts instead.
- Champions load in the lifespan startup (the calibrated RF takes a few
  seconds) and the SHAP explainer is warmed during startup — the first
  `/predict` costs ≈0.5 s, warm p50 ≈197 ms (quiet machine; expect 2–3×
  higher under concurrent load — see `reports/PERFORMANCE.md`).
- The frontend preview on `:4173` is covered by the default `CORS_ORIGINS`
  (alongside `:5173` and `:8080`), so the preview build talks to the API out
  of the box; other origins must be added to `CORS_ORIGINS`.

## 3. Docker Compose stack

Files: `docker/backend.Dockerfile` (python:3.12-slim, non-root `appuser`),
`docker/frontend.Dockerfile` (node:24-alpine build → nginx:alpine serve),
`docker/nginx.conf` (SPA fallback), `docker-compose.yml`. Full service/env
reference: `docker/README.md`.

```bash
cp .env.example .env                       # required: compose reads env_file .env
docker compose up --build                  # backend :8000, frontend :8080
docker compose --profile mlflow up --build # + MLflow UI on :5000 (opt-in)
```

If the default host ports are occupied on your machine, merge the committed
**opt-in** alt-ports mapping explicitly (it is not named
`docker-compose.override.yml`, so compose never picks it up automatically):

```bash
docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml up --build
# backend :18000, frontend :18080 (+ mlflow :15000 with --profile mlflow)
```

| Service | Port | Notes |
|---|---|---|
| `backend` | 8000 | Healthcheck `GET /health` (start_period 40s for champion loading); bind-mounts `./logs` and `./reports/drift` so the host and container share the prediction log + drift report; compose forces `API_HOST=0.0.0.0` |
| `frontend` | 8080→80 | `VITE_API_URL` baked at build time (default `http://localhost:8000`); `depends_on: backend healthy` |
| `mlflow` (profile `mlflow`) | 5000 | `ghcr.io/mlflow/mlflow:latest` serving the `./mlruns` file store (`MLFLOW_ALLOW_FILE_STORE=true` set in the service env) |

Smoke check once up:

```bash
curl http://localhost:8000/health   # {"status":"ok","models_loaded":{"regression":true,"classification":true}}
curl http://localhost:8080/         # SPA shell
```

Compose caveats (see also `docker/README.md`):

- The composed frontend on `http://localhost:8080` is in the default
  `CORS_ORIGINS`, so browser calls work out of the box.
- On native Linux, create `logs/` and `reports/drift/` on the host first so
  the non-root container user can write the bind mounts (Docker Desktop on
  Windows/macOS handles this).
- The backend image contains `models/` whole plus
  `data/external/neighborhood_geo.csv`; raw/processed data, notebooks,
  figures, reports, and `mlruns` are excluded via `.dockerignore`.
- Compose never pushes images and uses no secrets.

## 4. Drift-check scheduling

The monitoring loop: API appends predictions to `logs/predictions.jsonl` →
`python -m ml.monitoring.drift_check` computes per-numeric-feature PSI vs the
train reference → writes `reports/drift/latest.json` → `GET /metrics`
surfaces it. **`retraining_recommended` is a recommendation flag only —
nothing ever retrains automatically** (true only on drift in at least one
**non-calendar** feature + ≥ 200 valid predictions in the window — see the
calendar guard below).

```bash
# One-off, host or container:
.venv/Scripts/python.exe -m ml.monitoring.drift_check --window 500
docker compose exec backend python -m ml.monitoring.drift_check --window 500
cat reports/drift/latest.json
```

CLI: `--window N` (default 500 most-recent log lines), `--log PATH` (default
`logs/predictions.jsonl`). Exit code is **0 even with no log data** (report
status `no_data`) so it is safe to schedule before traffic starts; exit 2
means the reference artifact is missing or corrupt.

Cron example (every 15 min, host crontab driving the container):

```cron
*/15 * * * * cd /opt/proppulse && docker compose exec -T backend python -m ml.monitoring.drift_check --window 500 >> /var/log/proppulse-drift.log 2>&1
```

A GitHub Actions scheduled variant (checkout → setup-python →
`pip install -r requirements.txt` → the same CLI) also works if the
prediction log is synced back as an artifact.

Reading the report: drift = PSI ≥ 0.2 (override with `DRIFT_PSI_THRESHOLD`),
warn = PSI ≥ 0.1. Calendar-derived features (`YrSold`, `MoSold`, `sale_year`,
`sale_month`, `sale_quarter`, `property_age`, `years_since_remod`) always flag
on post-2010 traffic — structural, because the dataset ends in 2010 while
serving stamps the sale date as today. They are reported separately under
`calendar_drift_features`, and since the post-audit guard
(`ml/monitoring/drift_check.py`) **calendar-only drift never sets
`retraining_recommended`** — the flag requires at least one drifted
non-calendar feature plus ≥ 200 valid predictions. `drift_detected` itself is
unchanged (structural drift stays visible). The report also carries
`low_sample: true` below 50 valid predictions — treat small-window PSI as
noisy.

## 5. CI pipeline

`.github/workflows/ci.yml` — on push to `main` and on PRs, three jobs:

1. **python** (ubuntu-latest, Python 3.12): `pip install -r requirements.txt`
   → `python -m pytest tests backend/tests -q` (unit + API + integration;
   processed data and champion artifacts are committed).
2. **frontend** (Node 24): `npm ci` when `frontend/package-lock.json` exists,
   else `npm install` → `npm run build`.
3. **docker**: `cp .env.example .env` → `docker compose config -q` (base file
   alone) **and** `docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml
   config -q` (merged alt-ports config) — static validation only; no image
   builds, no pushes, no secrets.

The dev environment pins were verified on Python 3.14 while CI runs 3.12;
all pinned packages publish cp312 wheels, but the first CI run is the real
proof.

## 6. Hardening checklist (before real traffic)

The service is a development-grade deployment. For production:

- **Reverse proxy / TLS:** put nginx/Traefik/Caddy in front; terminate TLS,
  route `/` to the frontend and the API paths to uvicorn; drop the published
  ports.
- **AuthN/AuthZ:** the API is wide open — add an API key or OAuth2/JWT at the
  proxy or as FastAPI dependencies, and rate-limit the prediction endpoints.
- **CORS:** `CORS_ORIGINS` is env-driven — restrict it to your real frontend
  domain(s) exactly (drop `allow_credentials` if unused).
- **Secrets:** keep `.env` out of version control (already gitignored);
  inject config from a secrets manager (Vault, AWS/GCP secret stores) rather
  than files on disk.
- **Log management:** rotate `logs/predictions.jsonl` (it grows one JSON line
  per prediction; the drift check reads the tail, so rotation is safe);
  ship backend logs to a collector; the drift cron already appends to a
  logfile — rotate that too.
- **Process supervision:** systemd/NSSM restart policies on bare metal;
  `restart: unless-stopped` is already set in compose. Keep one uvicorn
  worker (see §2) or externalize the metrics state first.
- **Image hygiene:** pin base images by digest, run a vulnerability scan on
  first real build, and keep the non-root user.
- **Artifact governance:** back up `models/` (it is the registry); promote
  new champions only through `ml.evaluation.evaluate` + human review —
  wire the drift report's `retraining_recommended` flag to an alert, not to
  a retraining job.
- **Observability:** scrape/alert on `GET /metrics` (errors_total,
  avg_latency_ms, drift summary) and set up uptime checks on `/health`.
