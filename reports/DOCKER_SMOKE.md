# PropPulse — Docker build & smoke report

**Date:** 2026-08-24 · **Agent:** docker-smoke · **Host:** Windows + Git Bash,
Docker Client 29.4.0 / **Server 29.4.0** (Docker Desktop 4.69.0, Engine API
1.54, linux/amd64), Compose **v5.1.1**.

All commands run from the repo root `D:/Machine_Learning/Prop-pulse`.
Every result below is pasted from actual command output captured during this
run. This is a from-scratch re-verification of the hardened deployment files
(`docker/backend.Dockerfile`, `docker/frontend.Dockerfile`, `docker/nginx.conf`,
`docker-compose.yml`); no deployment files were edited — the one defect found
is reported in §4.7.

---

## 1. Port situation → alt-ports override used

`docker ps` / `netstat` again showed the default host ports bound by
**unrelated foreign projects** (left untouched):

```
showcase-gateway    0.0.0.0:8000->8000/tcp
showcase-frontend   0.0.0.0:8080->8080/tcp
showcase-backend    0.0.0.0:5000->5000/tcp
```

Ports **18000/18080 were free**, so every compose command below was run with
the opt-in merge:

```
docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml ...
```

Effective host ports: backend **:18000**, frontend **:18080**. The `.env` at
the repo root was read by compose but never modified.

## 2. Build

Both images built exactly as the Dockerfiles document (background tasks,
BuildKit, both exit 0):

```
$ docker build -f docker/backend.Dockerfile  -t proppulse-backend:prod-check  .
...
#17 naming to docker.io/library/proppulse-backend:prod-check
#17 DONE 10.2s

$ docker build -f docker/frontend.Dockerfile -t proppulse-frontend:prod-check .
...
#15 20.59 dist/assets/index-D06G4XZv.js   405.57 kB │ gzip: 125.95 kB
#15 20.59 ✓ built in 18.43s
#17 naming to docker.io/library/proppulse-frontend:prod-check
#17 DONE 1.1s
```

- No compilation failures; backend pip layer resolved cleanly on
  `python:3.12-slim`, frontend `node:24-alpine` build → `nginx:alpine` copy
  succeeded.
- Because `docker-compose.yml` pins `image: proppulse-backend:latest` /
  `proppulse-frontend:latest`, the fresh `prod-check` images were additionally
  tagged `:latest` (`docker tag`) so `docker compose up -d` ran exactly these
  builds rather than any stale `:latest` left on the host. Same image IDs —
  no rebuild.

## 3. Images

```
$ docker images
proppulse-backend:prod-check    d6df9472613b   1.92GB
proppulse-backend:latest        d6df9472613b   1.92GB   (same image, extra tag)
proppulse-frontend:prod-check   21e9538d5373   95.3MB
proppulse-frontend:latest       21e9538d5373   95.3MB   (same image, extra tag)
```

Backend weight (~1.9 GB) remains dominated by pinned ML runtime deps
(nvidia NCCL via xgboost, llvmlite/numba via shap, scipy, pandas, sklearn) —
a `backend/requirements.txt` concern, not a Dockerfile defect (known caveat,
unchanged).

## 4. Smoke test (inside the compose setup)

```
$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml up -d
 Container proppulse-backend-1  Started
 Container proppulse-backend-1  Healthy
 Container proppulse-frontend-1 Started
```

Backend reported **healthy** (healthcheck via urllib, start_period 40 s —
passed well inside it). Frontend initially reported healthcheck **unhealthy**
— a genuine defect (§4.7); it was fixed the same day (probe `127.0.0.1`
instead of `localhost`) and re-verified healthy. All functional checks below
were run against the live stack and passed.

### 4.1 GET /health (backend, :18000)

```
HTTP 200
{"status":"ok","models_loaded":{"regression":true,"classification":true}}
```

### 4.2 POST /predict (backend, :18000) — body from `artifacts/api-contract/payload_valid.json`

```
HTTP 200
{"estimated_price":158073.93,"price_range":{"low":137291.7,"high":177629.07},
 "sale_probability":{"probability":0.177099,"sells_within_30_days":false,"threshold":0.203292},
 "micro_market":{"cluster_id":0,"label":"mid northwest",...,"fallback":true,...},
 "top_price_factors":[
   {"feature":"OverallCond","impact":"negative","magnitude":0.077303},
   {"feature":"2ndFlrSF","impact":"negative","magnitude":0.061311},
   {"feature":"neighborhood_median_price","impact":"negative","magnitude":0.045249},
   {"feature":"total_bath","impact":"positive","magnitude":0.043198},
   {"feature":"HeatingQC","impact":"positive","magnitude":0.036309}],
 "market_position":{"subject_price_per_sqft":105.4,...,"label":"below"},
 "confidence":{"level":"typical","reasons":[]},
 "model_version":{"regression":"ridge_v1","classification":"random_forest_v1",
   "feature_version":"9b0f8ba4201c"}}
```

Estimated price **and** sale probability present; 5 populated SHAP factors
(the historical "empty `top_price_factors`" defect did not reappear).

### 4.3 GET /metrics (backend, :18000)

```
HTTP 200
{"requests_total":27,"errors_total":0,
 "requests_by_path":{"/health":26,"/predict":1},
 "avg_latency_ms":29.539,"uptime_seconds":262.927,
 "drift":{"status":"no_data","n_predictions":0,...,
   "retraining_recommended":false,...}}
```

(`drift.status:"no_data"` refers to the last scheduled drift-check report;
the bind-mounted JSONL is being written — §5.)

### 4.4 Frontend through nginx (:18080)

```
GET /        → HTTP 200, 1878 bytes, body contains id="root"
GET /market  → HTTP 200, body byte-identical to / (diff -q) — SPA fallback works
index bundle → /assets/index-D06G4XZv.js
```

### 4.5 Response headers

`GET /`:

```
HTTP/1.1 200 OK
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.basemaps.cartocdn.com; connect-src 'self' http://localhost:8000 https://prop-pulse-api.onrender.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Cache-Control: no-cache
```

`GET /assets/index-D06G4XZv.js` (fingerprinted, 405567 bytes):

```
HTTP/1.1 200 OK
Content-Type: application/javascript
Expires: Tue, 24 Aug 2027 14:36:28 GMT
Cache-Control: max-age=31536000
Cache-Control: public, immutable
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: <same policy as above>
```

The `/assets/` location re-adds the full security-header set — verified
present together with `public, immutable`. (`Server:` is a bare `nginx` —
`server_tokens off` confirmed, no version leaked.)

### 4.6 CSP sanity

Every external reference in the fetched `index.html`:

```
href="/favicon.svg"                                  → 'self'
href="/apple-touch-icon.png"                         → 'self'
src="/assets/index-D06G4XZv.js"                      → script-src 'self'
href="/assets/index-DV43VmDu.css"                    → style-src 'self'
preconnect https://fonts.googleapis.com              → style-src allows it
preconnect https://fonts.gstatic.com                 → font-src allows it
stylesheet fonts.googleapis.com/css2?...Inter...     → style-src allows it
```

No origin referenced by the shell falls outside the CSP. `data:` (inline SVG
chevrons in styles.css) and `https://*.basemaps.cartocdn.com` (CARTO tiles,
used by the /market map at runtime) are covered by `img-src`. PASS.

### 4.7 Frontend healthcheck reported UNHEALTHY while the service was healthy — defect found and fixed

`docker compose ps` showed `proppulse-frontend-1 (unhealthy)` with a growing
failing streak, although `curl http://localhost:18080/` from the host
returned 200 throughout. Health check output (`docker inspect`):

```
"Output":"wget: can't connect to remote host: Connection refused\n"   (exit 1, every attempt)
```

Reproduced inside the container:

```
$ docker compose ... exec -T frontend sh -c '...'
wget http://127.0.0.1/  → OK
wget http://localhost/  → can't connect to remote host: Connection refused
netstat -tln            → tcp 0.0.0.0:80 LISTEN        (IPv4 only)
getent hosts localhost  → ::1  localhost  localhost
```

Root cause: the compose healthcheck probed `http://localhost/`. On the
current `nginx:alpine` image (nginx **1.31.4**, Alpine 15.2.0), `localhost`
resolves to **`::1` first**, while `docker/nginx.conf` has only `listen 80;`
(IPv4 `0.0.0.0:80`; no `listen [::]:80;`). busybox wget dials ::1:80 →
connection refused → healthcheck fails forever. nginx itself is fully
functional on IPv4.

**Fix applied (2026-08-24):** the healthcheck now probes `http://127.0.0.1/`
(`docker-compose.yml`, with a comment recording this analysis). Probing
127.0.0.1 was chosen over `listen [::]:80;` because nginx fails to bind at
startup on runtimes with IPv6 disabled. Re-verified immediately after the
edit:

```
$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml ps
NAME                   STATUS
proppulse-backend-1    Up About a minute (healthy)
proppulse-frontend-1   Up About a minute (healthy)
```

Both services go green; the backend depends_on gate
(`condition: service_healthy`) was never affected (only the frontend
consumes it).

### 4.8 Backend startup logs (INFO level, no traceback)

```
$ docker compose ... logs backend | head
INFO:     Started server process [1]
INFO:     Waiting for application startup.
INFO ml.clustering.dataset: built neighborhood matrix: 25 rows x 4 features
INFO ml.clustering.serve: MicroMarketLookup ready: 4 clusters, 25 assignments, eps=1.3170, min_samples=2
INFO backend.app.services.comps_service: CompsService ready: 945 train sales, window 2006-2008
INFO ml.explainability.explainer: RegressionExplainer ready: Ridge via LinearExplainer, 296 transformed -> 94 base features, background 200 rows, expected_value=12.0003
INFO backend.app.main: SHAP explainer warmed during startup
INFO backend.app.main: PropPulse API ready: regression=ridge_v1 classification=random_forest_v1 feature_version=9b0f8ba4201c
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

`LOG_LEVEL=INFO` from `.env` is honored (`--log-level info` on the process
cmdline, §4.10); "Started server process" present, no traceback.

### 4.9 Graceful stop

```
$ time docker compose ... stop backend
 Container proppulse-backend-1 Stopped
real    0m4.265s

$ docker compose ... logs backend | tail
INFO:     Shutting down
INFO:     Waiting for application shutdown.
INFO:     Application shutdown complete.
INFO:     Finished server process [1]
```

4.3 s — well inside `stop_grace_period: 15s`; clean uvicorn shutdown lines,
no SIGKILL/force-kill.

### 4.10 Non-root proof

```
$ docker compose ... exec -T backend id
uid=999(appuser) gid=999(app) groups=999(app)

$ docker top proppulse-backend-1
UID   PID    CMD
999   9555   python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --log-level info --timeout-graceful-shutdown 10
```

Server process runs as **appuser (uid 999)**, not root; the image CMD shows
the LOG_LEVEL-driven `--log-level info` and `--timeout-graceful-shutdown 10`.

## 5. Prediction log bind mount

Host `./logs/predictions.jsonl` (bind-mounted to `/app/logs`) contains the
container-origin prediction from §4.2 — last line at capture time:

```
{"timestamp": "2026-08-24T14:36:00.901219+00:00", "payload": {"neighborhood": "NAmes", ...}}
```

Mount direction verified (container write → host file). The log is shared
with concurrent bare-metal runs (859 lines total, 4 dated 2026-08-24), so
only this line is claimed as this smoke's.

## 6. MLflow profile

Not re-run this wave (out of the assigned smoke scope). The pinned
`ghcr.io/mlflow/mlflow:v3.15.1` service definition was left untouched; no
claim about it is made here.

## 7. Teardown

```
$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml down
 Container proppulse-frontend-1 Removed
 Container proppulse-backend-1  Removed
 Network proppulse_default      Removed
DOWN_EXIT=0
$ docker ps -a --filter name=proppulse → (empty)
```

Built images left in place per assignment (`proppulse-backend:prod-check` +
`:latest`, `proppulse-frontend:prod-check` + `:latest`); nothing pruned.
Foreign `showcase-*` / `rmp-*` containers were never touched.

## Files changed by this agent

| File | Change |
|---|---|
| `reports/DOCKER_SMOKE.md` | this report (full rewrite with 2026-08-24 evidence) |

No deployment files modified by the smoke agent. The frontend-healthcheck
defect (§4.7) was fixed afterwards on 2026-08-24 (probe `127.0.0.1` in
`docker-compose.yml`) and re-verified: both services report **(healthy)**.

## Residual caveats

- **Backend image is 1.92 GB** (up from 1.77 GB in the 2026-08-07 smoke —
  dependency drift in the pinned ML stack). Slimming still means touching
  `backend/requirements.txt`, outside docker scope.
- On a machine with free default ports, plain `docker compose up --build`
  still publishes backend :8000 / frontend :8080 per the base file; the
  alt-ports merge remains opt-in and was required only because of the foreign
  `showcase-*` containers.
