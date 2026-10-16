# PropPulse — Deployment

How to run PropPulse beyond `npm run dev`: configuration reference, a local
production-style run, the Docker Compose stack, drift-check scheduling, the CI
pipeline, a checklist of the production controls already in place, and a
hardening checklist for putting it behind real traffic.

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
| `DATA_DIR` | `data` | Dataset root; only `data/external/neighborhood_geo.csv` (geo lookup) and `data/processed/train.csv` (SHAP background) are needed at serving time |
| `MLFLOW_TRACKING_URI` | *(empty)* | Empty → local file store `./mlruns`; set e.g. `http://localhost:5000` for a server |
| `VITE_API_URL` | `http://localhost:8000` | Frontend → backend base URL. For the frontend Docker image this is a **build-time ARG** (Vite inlines it); changing it requires rebuilding the image |
| `LOG_LEVEL` | `INFO` | Backend logging verbosity (`DEBUG|INFO|WARNING|ERROR`) |
| `PROPULSE_RATE_LIMIT_PREDICTION` / `PROPULSE_RATE_WINDOW_PREDICTION` | `30` / `60` | Prediction POST requests per peer per rolling window (requests / seconds) |
| `PROPULSE_RATE_LIMIT_WORKFLOW_WRITE` / `PROPULSE_RATE_WINDOW_WORKFLOW_WRITE` | `8` / `60` | Workflow mutation requests per peer per rolling window |
| `PROPULSE_RATE_LIMIT_TRAINING` / `PROPULSE_RATE_WINDOW_TRAINING` | `2` / `60` | Training-job submissions per peer per rolling window |
| `PROPULSE_RATE_LIMIT_GENERAL` / `PROPULSE_RATE_WINDOW_GENERAL` | `120` / `60` | Other non-health requests per peer per rolling window |
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

- **Multiple uvicorn workers are supported for serving, but not all state is global.**
  Workflow training/preprocessing uses a cross-process filesystem admission lock;
  every instance must share `PROPULSE_WORKFLOW_MODELS_ROOT` on storage with reliable
  file-lock semantics, or route workflow operations to one instance. Runtime request
  counters remain process-local, so aggregate them outside the app (Prometheus,
  OpenTelemetry, or a log collector). Put a process manager (systemd, NSSM) in
  front for restarts.
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
| `backend` | 8000 | Healthcheck `GET /health` (start_period 40s for champion loading); use `GET /ready` for readiness after required model artifacts are loaded; bind-mounts `./logs` and `./reports/drift` so the host and container share the prediction log + drift report |
| `frontend` | 8080→80 | `VITE_API_URL` baked at build time (default `http://localhost:8000`); `depends_on: backend healthy` |
| `mlflow` (profile `mlflow`) | 5000 | `ghcr.io/mlflow/mlflow:v3.15.1` serving the `./mlruns` file store (`MLFLOW_ALLOW_FILE_STORE=true` set in the service env) |

Smoke check once up:

```bash
curl http://localhost:8000/health   # liveness
curl http://localhost:8000/ready    # readiness; 503 until required model artifacts are loaded
curl http://localhost:8080/         # SPA shell
```

Compose caveats (see also `docker/README.md`):

- The composed frontend on `http://localhost:8080` is in the default
  `CORS_ORIGINS`, so browser calls work out of the box.
- On native Linux, create `logs/` and `reports/drift/` on the host first so
  the non-root container user can write the bind mounts (Docker Desktop on
  Windows/macOS handles this).
- The backend image contains `models/` whole plus two files from `data/`:
  `data/external/neighborhood_geo.csv` (geo lookup) and
  `data/processed/train.csv` (SHAP background); the rest of `data/`,
  notebooks, figures, reports, and `mlruns` are excluded via `.dockerignore`.
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
on sustained live traffic — structural, because the dataset ends in 2010
while serving defaults an omitted sale date to the latest train month
(2008-12) and clamps later dates to that boundary, so live rows pile up at
the window edge. They are reported separately under
`calendar_drift_features`, and since the post-audit guard
(`ml/monitoring/drift_check.py`) **calendar-only drift never sets
`retraining_recommended`** — the flag requires at least one drifted
non-calendar feature plus ≥ 200 valid predictions. `drift_detected` itself is
unchanged (structural drift stays visible). The report also carries
`low_sample: true` below 50 valid predictions — treat small-window PSI as
noisy.

## 5. CI pipeline

`.github/workflows/ci.yml` — on push to `main` and on PRs, the functional, frontend, compose, Docker-smoke, and consolidated verification jobs:

1. **python** (ubuntu-latest, Python 3.12): `pip install -r requirements.txt`
   → strict `pip-audit` gate over both `requirements.txt` (one documented,
   justified ignore — `reports/SECURITY.md` §1.1) and the slim
   `backend/requirements.txt` (no ignores) → `python -m pytest tests
   backend/tests -q` (unit + API + integration; processed data and champion
   artifacts are committed).
2. **frontend** (Node 24): `npm ci` when `frontend/package-lock.json` exists,
   else `npm install` → `npm audit --audit-level=high` gate → `npm run build`.
3. **docker**: `cp .env.example .env` → `docker compose config -q` (base file
   alone) **and** `docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml
   config -q` (merged alt-ports config) — static validation only; no image
   builds, no pushes, no secrets.

CI is the compatibility proof for the pinned Python and Node dependency set.

## 6. Production checklist (controls already in place)

What the repo gives you today — every item is verifiable in-tree:

- **Secrets hygiene:** `.env` is gitignored and excluded from the Docker build
  context (`.dockerignore`); `.env.example` is the committed, secret-free
  template. Compose injects config via `env_file: .env`, CI derives `.env`
  from the example, and the compose stack uses no secrets at all.
- **Dependency audit gates:** CI fails on known fixable CVEs — `pip-audit
  --strict` over both requirements files (a single documented, justified
  ignore on the dev set only) and `npm audit --audit-level=high` for the
  frontend (`.github/workflows/ci.yml`; accepted-risk record:
  `reports/SECURITY.md`).
- **Non-root backend container:** `docker/backend.Dockerfile` creates a
  system user and drops privileges (`USER appuser`); the runtime-writable
  dirs (`/app/logs`, `/app/reports/drift`) are pre-created and chowned. The
  frontend image is `nginx:alpine` serving static files with hardened
  `docker/nginx.conf` (security headers + CSP, `no-cache` on `index.html`,
  immutable caching only for fingerprinted `/assets/`); in compose the
  frontend runs with its own `wget` healthcheck, `read_only` rootfs (+ tmpfs
  for nginx's writable dirs), and a 5s stop grace period.
- **Healthchecks:** the compose backend has a `GET /health` healthcheck
  (start_period 40s for champion loading) and the frontend starts only once
  the backend is healthy (`depends_on: service_healthy`).
- **Restart policies:** every compose service sets `restart: unless-stopped`.
- **Log persistence:** `./logs` (prediction JSONL) and `./reports/drift`
  (drift report) are bind-mounted into the backend container, so both survive
  container rebuilds and are shared between the API writer and the drift
  reader.
- **Scheduled drift check:** `python -m ml.monitoring.drift_check` exits 0 on
  missing/empty logs (`no_data`), so the cron entry in §4 is safe to enable
  before first traffic; the report it writes feeds `GET /metrics`.

## 7. Hardening checklist (before real traffic)

The service is a development-grade deployment. For production:

- **Reverse proxy / TLS:** put nginx/Traefik/Caddy in front; terminate TLS,
  route `/` to the frontend and the API paths to uvicorn; drop the published
  ports.
- **Abuse controls:** conservative in-process rolling-window limits now cover predictions, workflow mutations, training submissions, and other non-health requests. HTTP 429 responses include `Retry-After`; health/readiness and CORS preflight requests are exempt. Configure limits with the `PROPULSE_RATE_LIMIT_*` / `PROPULSE_RATE_WINDOW_*` variables above.
- **AuthN/AuthZ remains a separate decision:** rate limits do not authenticate callers or make uploaded datasets private. For sensitive/private deployments, add identity and per-user authorization through a server-side session/proxy architecture; never embed a static API secret in Vite/browser code.
- **Limiter scope:** counters are process-local and reset on restart. This is best-effort defense in depth for the current single-instance deployment, not a distributed quota. Use a shared Redis/API-gateway limiter before horizontal scaling.
- **CORS:** `CORS_ORIGINS` is env-driven — restrict it to your real frontend
  domain(s) exactly (drop `allow_credentials` if unused).
- **Secrets:** keep `.env` out of version control (already gitignored);
  inject config from a secrets manager (Vault, AWS/GCP secret stores) rather
  than files on disk.
- **Log management:** rotate `logs/predictions.jsonl` (it grows one JSON line
  per prediction; the drift check reads the tail, so rotation is safe);
  ship backend logs to a collector; the drift cron already appends to a
  logfile — rotate that too.
- **Process supervision / scaling:** systemd/NSSM restart policies on bare metal;
  `restart: unless-stopped` is already set in compose. Serving workers may scale,
  but workflow training/preprocessing must share a reliable filesystem lock root or
  be routed to one instance. Request counters are process-local and should be
  aggregated by the deployment telemetry layer.
- **Image hygiene:** pin base images by digest, run a vulnerability scan on
  first real build, and keep the non-root user.
- **Artifact governance:** back up `models/` (it is the registry); promote
  new champions only through `ml.evaluation.evaluate` + human review —
  wire the drift report's `retraining_recommended` flag to an alert, not to
  a retraining job.
- **Observability:** scrape/alert on `GET /metrics` (requests_total,
  errors_total, requests_in_flight, avg_latency_ms, last_request_at, drift summary);
  propagate the `X-Request-ID` response header into logs/traces, use `/health` for
  liveness and `/ready` for readiness, and alert on sustained 5xx/error-rate or
  drift conditions.

## Workflow scaling and coordination

The guided workflow uses a cross-process filesystem admission lock at
`models/workflow/.training.lock`. This replaces the old process-local Python
mutex and works when multiple API workers share the same workflow storage.

**Single replica / local disk:** supported. The API, trainer subprocess, and
workflow model directory must be on the same filesystem.

**Multiple replicas:** do not point several replicas at independent ephemeral
workflow directories. Training admission and job artifacts are shared state and
must live on storage with reliable cross-replica file-lock semantics. If the
platform cannot guarantee those semantics, run one workflow-serving replica or
move admission/job state to a database/queue coordinator before scaling out.

The lock owner metadata is stored beside the lock so an operator can identify
the dataset/job currently holding admission. The trainer owns the lock for the
full fit, so restarting an API worker does not release an active trainer's
admission.

### Health and readiness

- `GET /health` is a liveness check and may succeed while model startup is
  incomplete.
- `GET /ready` is the deployment readiness gate. It returns HTTP 200 only after
  the required serving models/artifacts are loaded; otherwise it returns HTTP
  503.
- Production load balancers should route traffic only after `/ready` succeeds
  and should remove an instance when it stops being ready.

### Operational correlation

Every response receives an `X-Request-ID` value. Clients may supply a safe
existing identifier; otherwise the API generates one. Include this identifier
in support tickets and correlate it with server logs.

The `/metrics` response includes total requests, 5xx count, in-flight requests,
last request time, average latency, route-template counters, and the latest
drift summary.
