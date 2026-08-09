# PropPulse — Docker build & smoke report

> **Post-audit annotations (2026-08-07, forensic audit):**
> 1. **Compose file renamed.** The `docker-compose.override.yml` this report
>    created is now **`docker-compose.alt-ports.yml`** — committed but
>    **opt-in** (merge explicitly with
>    `-f docker-compose.yml -f docker-compose.alt-ports.yml`; it never
>    auto-merges, so the documented default ports 8000/8080 are what a plain
>    `docker compose up` now publishes). Wherever §1 below says
>    "override", read "alt-ports". (AUD-05, `docs/audit/fix-docker.md`.)
> 2. **This smoke predates the wave-9b latency-fix rebuild.** The image IDs
>    quoted in §3 (`ffed0840ebb8` / `9c67c5dc5742`) were the wave-9 builds;
>    they lacked the wave-9b latency fix. During the audit the devops agent
>    rebuilt both images and re-ran the full smoke — **PASS** (same
>    prediction values; warm `/predict` 0.194–0.226 s). Current image IDs:
>    backend **`d67923e8f282`**, frontend **`1a585b0256a9`** (AUD-14,
>    `docs/audit/devops.md` §4).
> 3. §8's "154 passed" was this wave's concurrent suite count; the post-audit
>    suite is **210 passed**.

**Date:** 2026-08-07 · **Agent:** docker-build · **Host:** Windows + Git Bash,
Docker Client 29.4.0 / **Server 29.4.0**, Compose **v5.1.1** (daemon running —
ADR-7's "daemon unavailable" caveat is now resolved).

All commands run from the repo root `C:/Machine_Learning/Prop-pulse`.
Every result below is pasted from actual command output.

---

## 1. Port situation → `docker-compose.override.yml`

`netstat` / `docker ps` showed the default host ports already bound by
**unrelated foreign projects** (left untouched, per assignment):

```
showcase-gateway    0.0.0.0:8000->8000/tcp
showcase-frontend   0.0.0.0:8080->8080/tcp
showcase-backend    0.0.0.0:5000->5000/tcp
```

(PIDs behind 0.0.0.0:8000/8080/5000: `com.docker.backend.exe`, the Docker
Desktop proxy for those containers.) Ports **18000/18080/15000 were free**.

Created **`docker-compose.override.yml`** (local-only; compose auto-merges it):

- backend `18000:8000`, frontend `18080:80`, mlflow `15000:5000`
- **Gotcha found and documented:** Compose v2 *appends* `ports` on merge, it
  does not replace by target — the first override draft rendered both
  `8000` and `18000` published, which would still collide. Fixed with the
  `!override` YAML tag on each `ports` list. Rendered config after the fix:

```
published: "18000"     # backend (only)
published: "18080"     # frontend (only)
```

- Because the browser talks to the **host** ports, the override also sets:
  - frontend **build ARG** `VITE_API_URL=http://localhost:18000` (Vite inlines
    it at build time), and
  - backend `CORS_ORIGINS=http://localhost:5173,http://localhost:18080`
    (compose `environment:` overrides `env_file`).

Validation:

```
$ docker compose config -q && echo CONFIG VALID
CONFIG VALID
$ docker compose -f docker-compose.yml config -q   # base file alone (what CI checks)
base-file-alone valid
```

## 2. Build

```
$ docker compose build --progress=plain backend frontend
...
 Image proppulse-frontend:latest Built
 Image proppulse-backend:latest Built
BUILD_EXIT=0        duration=175s
```

- **No compilation failures.** Every pinned package in
  `backend/requirements.txt` resolved to a prebuilt **cp312 manylinux wheel**
  on `python:3.12-slim` (spot-checked in the log: pyyaml 6.0.3, uvloop 0.22.1,
  watchfiles, websockets, …). No system libs had to be added.
- One surprise download: `nvidia_nccl_cu13-2.30.7` (216 MB wheel) — a Linux
  dependency of the pinned `xgboost==3.4.0`. It installs as a wheel; it only
  costs image size (see §6), so it was accepted as a pinned-dependency
  consequence, not a Dockerfile defect.

### Fix applied after the first up (the only Dockerfile defect found)

First `/predict` returned `"top_price_factors":[]` and the backend logged:

```
WARNING backend.app.services.prediction_service: explanation unavailable, returning empty factors:
cannot build SHAP background: Processed split not found: /app/data/processed/train.csv.
```

Root cause: `ml/explainability/explainer.py` builds its SHAP background from
`load_split("train")`, but `.dockerignore` excluded all of `data/processed/`
and the Dockerfile only copied `data/external/neighborhood_geo.csv`.
Minimal fix (2 lines + comments):

- `.dockerignore`: added `!data/processed/train.csv` after the
  `data/processed` exclusion.
- `docker/backend.Dockerfile`: added
  `COPY data/processed/train.csv data/processed/train.csv` (334 KB).

Rebuild + restart took 25 s (pip layer cached); `/predict` then returned 5
populated SHAP factors (evidence in §4).

## 3. Images

```
$ docker images
proppulse-backend:latest    1.77GB (ffed0840ebb8)
proppulse-frontend:latest   93.9MB (9c67c5dc5742)
ghcr.io/mlflow/mlflow:latest 1.64GB
```

Backend site-packages breakdown (top entries, `du -sh` inside the image):

```
242M  nvidia      # NCCL/CUDA libs — pulled by pinned xgboost 3.4.0 on linux
173M  llvmlite    # numba (shap runtime dep)
109M  scipy
85M   xgboost
75M   pandas
49M   sklearn
42M   numpy
33M   numba
```

Image weight is dominated by pinned runtime deps; slimming would mean changing
`backend/requirements.txt` (out of docker scope) — noted as a caveat.

## 4. Smoke test (inside the compose setup)

`docker compose up -d` → backend reported **Healthy** (healthcheck via urllib,
start_period 40 s), frontend started after it.

**GET /health** (`:18000`):

```json
{"status":"ok","models_loaded":{"regression":true,"classification":true}}
```

**POST /predict** (StoneBr sample from `docs/API.md`) — all contract keys
present, `top_price_factors` populated after the §2 fix:

```json
{"estimated_price":204881.59,"price_range":{"low":177945.52,"high":230227.22},
 "sale_probability":{"probability":0.408609,"sells_within_30_days":true,"threshold":0.203292},
 "micro_market":{"cluster_id":0,"label":"mid northwest","n_neighborhoods":14,
   "median_price":179900.0,"median_price_per_sqft":119.39,...,"fallback":false},
 "top_price_factors":[
   {"feature":"OverallQual","impact":"positive","magnitude":0.089386},
   {"feature":"neighborhood_median_price","impact":"positive","magnitude":0.088983},
   {"feature":"neighborhood_median_price_per_sqft","impact":"positive","magnitude":0.057562},
   {"feature":"neighborhood_mean_price","impact":"positive","magnitude":0.054321},
   {"feature":"GrLivArea","impact":"positive","magnitude":0.050053}],
 "model_version":{"regression":"ridge_v1","classification":"random_forest_v1",
   "feature_version":"9b0f8ba4201c"}}
```

**GET /market/clusters** → `{"n_clusters":4,"clusters":[{"cluster_id":0,"label":"mid northwest",...` ✓
**GET /model/importance** → `{"metadata":{"model":"Ridge","explainer":"shap.LinearExplainer",...` ✓
**GET /metrics** → `{"requests_total":9,"errors_total":0,"requests_by_path":{"/health":5,"/predict":2,...}}` ✓

**Frontend through nginx** (`:18080`):

```
GET /                      → HTTP 200, 660 bytes (index.html)
index references bundle    → /assets/index-uuBdBQdg.js
GET /assets/index-uuBdBQdg.js → HTTP 200, 311395 bytes, application/javascript
bundle API base URL        → http://localhost:18000   (only match — correct remap)
GET /market (SPA fallback) → HTTP 200
```

**CORS preflight** from the composed frontend's origin:

```
$ curl -i -X OPTIONS http://localhost:18000/predict -H "Origin: http://localhost:18080" \
    -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:18080
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
```

## 5. Prediction log volume + in-container drift check

Host `./logs/predictions.jsonl` (bind-mounted to `/app/logs`) grew from **2 →
7 lines** while the stack was up; the container-origin lines are identifiable
by timestamp/payload (the repo log is shared with concurrent bare-metal agent
runs — e.g. the StoneBr line at `2026-08-07T11:14:36Z` is this smoke's
`/predict`). Mount direction verified.

```
$ docker compose exec -T backend python -m ml.monitoring.drift_check
INFO __main__: drift check: status=ok n=7 drift=True drifted=[...] -> /app/reports/drift/latest.json
```

`/app/reports/drift` is also bind-mounted → the report appeared on the **host**
at `reports/drift/latest.json` (`"n_predictions": 7, "drift_detected": true,
"retraining_recommended": false`). `drift=True` on a 7-row window is
small-sample noise (most features flagged; known YrSold/sale_year caveat
applies); the guardrail correctly kept `retraining_recommended: false`
(< 200 samples). `/metrics` on the container serves this same summary.

## 6. MLflow profile (optional — done)

```
$ docker compose --profile mlflow up -d mlflow     # pulled ghcr.io/mlflow/mlflow:latest (1.64GB)
proppulse-mlflow-1 Up ... 0.0.0.0:15000->5000/tcp
$ curl http://localhost:15000/  → HTTP 200
```

## 7. Teardown

```
$ docker compose --profile mlflow down
 Container proppulse-mlflow-1 Removed
 Container proppulse-backend-1 ... Removed
 Container proppulse-frontend-1 ... Removed
 Network proppulse_default Removed
$ netstat ... :15000/:18000/:18080 → all free (wslrelay released [::1]:18000 within ~10 s)
$ docker ps -a --filter name=proppulse → (empty)
```

Foreign `showcase-*` / `rmp-*` containers were never touched.

## 8. Regression checks

- `docker compose config -q` — valid **with** the override; the base file
  alone (`-f docker-compose.yml`) also validates, so CI (which has no
  override) is unaffected.
- `.venv/Scripts/python.exe -m pytest tests backend/tests -q` →
  **154 passed, 0 failed** in 83.49 s (suite grew from 114 → 154 due to other
  hardening agents' new tests; all green with my changes in place).

## Files changed by this agent

| File | Change |
|---|---|
| `docker-compose.override.yml` | **new** — local port remap 18000/18080/15000 (`!override` ports), `VITE_API_URL` build arg, `CORS_ORIGINS` env |
| `docker/backend.Dockerfile` | +`COPY data/processed/train.csv` (SHAP background) with comment |
| `.dockerignore` | +`!data/processed/train.csv` un-exclusion (root file — flagged to orchestrator) |
| `docker-compose.yml` | header comment: "builds not executed" → verified, points here |
| `docker/README.md` | lead caveat resolved; packaging fixes + remap recipe documented; image-contents note updated |
| `reports/DOCKER_SMOKE.md` | this report |

## Residual caveats

- **Backend image is 1.77 GB.** ~415 MB of that is `nvidia` NCCL (pinned
  xgboost 3.4.0's Linux dep) + `llvmlite` (numba/shap). Slimming means
  touching `backend/requirements.txt` (e.g. dropping xgboost — not a serving
  champion — or shap), which is outside the docker scope.
- **Root `README.md` and `docs/DEPLOYMENT.md`** still carry the "builds not
  executed (daemon unavailable)" wording — outside this agent's file scope;
  flagged for the documentation agent (root README §Docker, and wherever
  DEPLOYMENT.md references ADR-7).
- `docker-compose.override.yml` is intentionally **not** a project default —
  on a free machine, plain `docker compose up --build` still yields
  backend :8000 / frontend :8080 exactly as the base file specifies.
- ADR-7 in `docs/DECISIONS.md` ("daemon unavailable") is now historically
  inaccurate for this machine; left untouched (Lead-owned file), noted here.
