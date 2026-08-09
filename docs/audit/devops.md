# Forensic Runtime Audit — devops (mission §19)

**Date:** 2026-08-07 · **Agent:** devops · **Mode:** runtime verification; report-only for project source/config/docs.
**Scope:** `docker-compose.yml`, `docker-compose.override.yml`, `docker/backend.Dockerfile`, `docker/frontend.Dockerfile`, `docker/nginx.conf`, `.github/workflows/ci.yml`, docker README/DEPLOYMENT port claims, live Docker engine execution (build/up/smoke/down), image freshness vs source tree.

**Environment mutation disclosed up front:** the two `:latest` image tags were rebuilt during this audit (assignment-sanctioned: "if a rebuild is quick and safe, do it and re-smoke"). Old wave-9 images remain on the daemon as dangling images (`ffed0840ebb8` backend, `9c67c5dc5742` frontend); new tags are `d67923e8f282` (backend) / `1a585b0256a9` (frontend). No source/config/doc file was modified. `logs/predictions.jsonl` and `reports/drift/latest.json` were backed up before container work and restored byte-identical afterwards (md5-verified, evidence 17).

## Environment incident (not a project defect)

Mid-audit (~14:00 UTC) the Docker Desktop engine died: `com.docker.backend.exe` was gone and the `dockerDesktopLinuxEngine` pipe missing, after `docker version` had confirmed Server 29.4.0 minutes earlier. WSL bootstrap retries (`GET /ping` deadline exceeded) did not recover. Recovered by a full Docker Desktop restart (engine back 14:04 UTC). All foreign `showcase-*`/`rmp-*` containers auto-recovered via their restart policies; they were never touched directly. Timing-sensitive auditors should note the daemon was down roughly 13:58–14:04 UTC. Recovery evidence: `devops-03-images.txt` (post-recovery inventory).

## Evidence files

| File | Contents |
|---|---|
| `devops-01-compose-config.txt` | `docker compose config -q` exit 0 merged AND base-only; rendered published ports: merged 18000/18080, base 8000/8080; Compose v5.1.1 / Server 29.4.0 |
| `devops-02-docs-and-config.txt` | override mentions across 4 docs; override NOT in `.gitignore`; pytest.ini; `frontend/package-lock.json` exists (116 KB) |
| `devops-03-images.txt` | `docker images` — proppulse-backend 1.77GB `ffed0840ebb8`, proppulse-frontend 93.9MB `9c67c5dc5742`, mlflow 1.64GB; Created timestamps; full `docker ps -a` (foreign containers) |
| `devops-04-log-backup.txt` | predictions.jsonl baseline: 19 lines, md5 `f2fef684…`; drift latest.json baseline md5 `34d64318…`; backups taken |
| `devops-05-source-mtimes.txt` | newest image-input mtimes (models retrained 18:45–18:52 IST, after build) |
| `devops-06-freshness.txt` | all image inputs newer than the builds; Valuation.jsx newer than frontend image |
| `devops-07-stale-code-diffs.txt` | unified diffs image-vs-host for the 6 differing code files |
| `devops-08-up.txt` | `docker compose up -d` on as-built images; backend healthy; ports 18000/18080 |
| `devops-09-smoke-api.txt` | /health, /predict (full contract, 5 SHAP factors), /market/clusters, /model/importance — all 200 |
| `devops-10-smoke-frontend-cors.txt` | nginx 200, bundle `index-uuBdBQdg.js` 311395 B baked to `http://localhost:18000`, SPA fallback 200, CORS preflight allowed from :18080, denied for foreign origin |
| `devops-11-drift-and-logs.txt` | host log 19→20 lines (container StoneBr line); in-container drift check exit 0 → host `reports/drift/latest.json` rewritten (md5 changed); `/metrics` serves the summary |
| `devops-12-asbuilt-latency.txt` | as-built image warm /predict 0.65–0.88 s (pre–wave-9b code path) |
| `devops-13-rebuild.txt` | `docker compose down`; `docker compose build` exit 0 in 20 s (cached dep layers); new image IDs |
| `devops-14-resmoke.txt` | rebuilt stack: full smoke re-pass; warm /predict 0.194–0.226 s; same price 204881.59; new bundle hash |
| `devops-15-mlflow-teardown.txt` | mlflow profile: up → HTTP 200 on :15000 → down; zero proppulse containers; ports free |
| `devops-16-log-analysis.txt` | post-backup log lines 20–29 all inside my two smoke windows, all my payloads — no foreign interleave; no LISTENING on my ports |
| `devops-17-restore.txt` | drift json + predictions.jsonl restored byte-identical (md5 verified); 0 proppulse containers; no LISTENING |

## 1. Static verification

| Item | Verdict | Evidence |
|---|---|---|
| `docker compose config -q` (base+override merged, as users/CI run it) | **PASS — verified by execution** (exit 0) | evidence 01 |
| `docker compose -f docker-compose.yml config -q` (base alone) | **PASS — verified by execution** (exit 0) | evidence 01 |
| backend.Dockerfile line-by-line: `python:3.12-slim` pinned by tag (not digest — P3 nit, pre-noted by llba F10 family), deps layer before source COPYs (cache-correct), non-root `appuser` + `chown` + `USER` (54–57), writable `/app/logs` + `/app/reports/drift`, healthcheck in compose via urllib (slim has no curl), CMD binds 0.0.0.0 | **PASS — statically verified** (docker/backend.Dockerfile:15,28-29,54-57,75; compose healthcheck docker-compose.yml:34-47) | line review; behavior re-proven live (below) |
| frontend.Dockerfile line-by-line: multi-stage node:24-alpine→nginx:alpine, `ARG VITE_API_URL` before use, `npm ci` when lock present (lock now exists → reproducible path taken), sources after install; nginx stage runs as root + no healthcheck (llba F10, P3, confirmed) | **PASS WITH CONCERN — statically verified** (docker/frontend.Dockerfile:18-41) | line review |
| CI python job: `pip install -r requirements.txt` on 3.12 — every pin `==`-pinned; requires_python floors all ≤3.12 (tightest: scipy/shap/xgboost ≥3.12); cp312 wheels exist for all binary pins | **PASS — statically verified** (requirements.txt:10-36; PyPI metadata cross-check in llba evidence 07, re-read and confirmed here) | evidence 02 + llba-frontend-infra-07 |
| pytest.ini present, `testpaths = tests backend/tests` == CI command `python -m pytest tests backend/tests -q` | **PASS — statically verified** (pytest.ini:1-5, ci.yml:33) | evidence 02 |
| CI frontend job: runs `npm ci` iff lock exists; lock exists and is in sync (`npm ci --dry-run` exit 0) | **PASS — verified by execution** | this audit's npm dry-run; evidence 02 |
| CI docker job: `cp .env.example .env` + `docker compose config -q` — meaningful only as YAML/schema validation; no build, no run; and because the override ships it validates the **merged** config, never the base alone | **PASS WITH CONCERN — statically verified** (ci.yml:57-68) | evidence 01/02; feeds F1 |
| CI does not test Python 3.14 (local dev platform) at all — deliberate 3.12 pin matching the Docker image (ADR-7); not a defect, noted as coverage gap | observation | ci.yml:19-22 |

## 2. llba-frontend-infra F1 — **VERIFIED TRUE (P2)**

Claim: shipped `docker-compose.override.yml` auto-merges on plain `docker compose` commands, contradicting docs that call the override optional and ports 8000/8080.

- **Mechanics confirmed by my execution:** `docker compose config` with no `-f` flags renders **only** published 18000/18080; base-only renders 8000/8080 (evidence 01 §3–4). The override is **not** in `.gitignore` (evidence 02).
- **Doc-by-doc reality check:**
  - `README.md:325-326` — quickstart prints `# backend :8000, frontend :8080` with no caveat on the command itself; :337-346 does disclose the override ("optional", "auto-merged", remaps to 18000/18080/15000). Calling a shipped, auto-merging file "optional" is the contradiction — it is opt-**out** (delete/rename), not opt-in.
  - `docker/README.md:37,58-59,66-68` — states `up --build` → :8000/:8080 and a service table with 8000/8080/5000; :18-23 presents the override as a recipe the *user* should "drop next to the base file", never disclosing one **ships in the tree**.
  - `docs/DEPLOYMENT.md:72-86` — commands + table claim :8000/:8080/:5000; the only override mention (:11) points at docker/README "first-build notes"; a reader following DEPLOYMENT.md on this tree gets 18000/18080 with no explanation.
  - `FINAL-RELEASE.md:20,35` — discloses the override ports correctly.
  - `docker-compose.override.yml:1` — header says "NOT committed defaults" while the file ships un-gitignored. `docker-compose.yml:8-10` does disclose auto-merge.
  - `reports/DOCKER_SMOKE.md:50` — "base file alone (what CI checks)" is **wrong**: CI checks out the tree including the override, so CI's `docker compose config -q` validates the merged config (confirmed by my evidence 01).
- **Verdict:** F1 stands as filed (P2, truth-in-docs/packaging defect). Behavior is self-consistent (VITE_API_URL/CORS re-pointed correctly — re-verified live, evidence 10/14), so it is not a runtime bug.

## 3. Execution — container smoke (as-built wave-9 images)

`docker compose up -d` (override auto-merged → 18000/18080), backend healthy on first poll, frontend started after `service_healthy` (evidence 08).

| Check | Result |
|---|---|
| `GET /health` | 200 `{"status":"ok","models_loaded":{"regression":true,"classification":true}}` — **PASS** |
| `POST /predict` (StoneBr, full contract) | 200; all 6 top-level keys; price 204881.59; probability 0.408609; threshold 0.203292; **5 populated SHAP factors**; feature_version 9b0f8ba4201c — **PASS** (matches DOCKER_SMOKE §4 byte-for-byte on values) |
| `GET /market/clusters` | 200, `n_clusters:4` — **PASS** |
| `GET /model/importance` | 200, Ridge/shap.LinearExplainer metadata — **PASS** |
| Frontend nginx | `/` 200 (660 B); bundle `/assets/index-uuBdBQdg.js` 200 (311,395 B, `application/javascript`); bundle's only `localhost` URL = `http://localhost:18000`; SPA fallback `/market` 200 — **PASS** |
| CORS preflight from `http://localhost:18080` | 200 + `access-control-allow-origin: http://localhost:18080` — **PASS**; foreign origin gets no ACAO — **PASS** |
| In-container drift check | `docker compose exec -T backend python -m ml.monitoring.drift_check` exit 0, `status=ok n=20`, wrote `/app/reports/drift/latest.json` → appeared on **host** (md5 changed) — **PASS** |
| Prediction log reaching host | host `logs/predictions.jsonl` 19→20 lines; new line is the container's StoneBr prediction (14:09:51Z) — **PASS** |
| `/metrics` surfaces drift summary | yes (same timestamp as host file) — **PASS** |

## 4. Freshness — images were **STALE**; rebuilt and re-smoked

- Backend image `ffed0840ebb8` created **11:13:48 UTC**; frontend `9c67c5dc5742` **11:06:55 UTC** (evidence 03).
- Content hash-diff (93 baked files vs host tree): **models/, data/ — byte-identical** (the 13:15–13:22 UTC retrains reproduced the same bytes, consistent with the reproducibility PASS); but **6 code files differed**: `backend/app/main.py`, `backend/app/api/market.py`, `backend/app/api/model.py`, `backend/app/api/predict.py`, `backend/app/services/prediction_service.py` (host mtimes 12:01–12:21 UTC — **after** the build), and `ml/data/pipeline.py` (trivial log-punctuation edit) (evidence 06/07).
- **What the image lacked = the wave-9b latency fix**: `force_single_threaded` (n_jobs=1 estimator pinning), startup-cached static payloads (`market_clusters_payload`, `model_info_payload`, importance artifact), the `_SHAP_WARMUP_PAYLOAD` lifespan warm-up, and the narrow-endpoint logging refactor. Runtime proof: as-built warm /predict **0.65–0.88 s** vs rebuilt **0.194–0.226 s** under the same ambient audit load (evidence 12/14). The wave-9 **security** files (`security.py`, middleware, config) hash-matched — they were already in the image.
- Frontend image also stale: `frontend/src/pages/Valuation.jsx` (12:35 UTC) postdated its build; rebuild emitted a new bundle hash (`index-BPR07Fhi.js`).
- **Resolution:** `docker compose build` (20 s, exit 0, cached dependency layers) + full re-smoke — **all checks PASS**, identical prediction values (204881.59 etc.), warm latency now matches the claimed p50 ≈197 ms. New tags: backend `d67923e8f282`, frontend `1a585b0256a9`; old images remain dangling for inspection.
- **Consequence for docs:** README/FINAL-RELEASE "Docker build + smoke verified" remains true, but `reports/DOCKER_SMOKE.md`'s evidence describes **pre-wave-9b** code — the smoke report predates the latency fix it now sits next to (README:316-319 cites the fix in the same breath as the smoke evidence).

## 5. mlflow profile — **PASS — verified by execution**

`docker compose --profile mlflow up -d mlflow` → `curl http://localhost:15000/` → **HTTP 200** (after ~20 s warm-up) → `docker compose --profile mlflow down` (evidence 15).

## 6. Teardown / state restoration

- `docker compose --profile mlflow down`: all proppulse containers + network removed; `docker ps -a --filter name=proppulse` = 0 (evidence 15/17).
- Ports 18000/18080/15000: no LISTENING sockets after down (residual TIME_WAIT client sockets only) (evidence 16/17).
- `logs/predictions.jsonl`: all 10 appended lines proven to be mine (timestamps inside my two smoke windows; my exact payloads; no foreign interleave — evidence 16); restored from pre-audit backup → **19 lines, md5 `f2fef6841259953455a4ebd0fcdbd076` == baseline** (evidence 17).
- `reports/drift/latest.json`: confirmed untouched by others after my run, then restored → md5 `34d643185f775ca91362a68ea1f46356` == baseline (evidence 17).

## Findings

| # | Severity | Location | One-liner | Evidence |
|---|---|---|---|---|
| D1 | **P2** | `docker-compose.override.yml` (ships, un-gitignored) vs README.md:325/:338, docker/README.md:37/66-68, DEPLOYMENT.md:72-86, DOCKER_SMOKE.md:50 | F1 VERIFIED: override auto-merges → real ports 18000/18080 while docs lead with 8000/8080; CI validates merged config, never base alone | devops-01, devops-02 |
| D2 | **P2** | image `proppulse-backend:latest` (was `ffed0840ebb8`) vs backend/app/{main,api/market,api/model,api/predict,services/prediction_service}.py | Built image was stale: lacked the wave-9b latency fix (as-built warm /predict 0.65–0.88 s vs 0.194–0.226 s rebuilt); DOCKER_SMOKE evidence describes pre-fix code. **Remediated this audit: rebuilt (exit 0, 20 s) + re-smoke PASS** | devops-06, 07, 12, 13, 14 |
| D3 | **P3** | image `proppulse-frontend:latest` (was `9c67c5dc5742`) vs frontend/src/pages/Valuation.jsx | Frontend image stale by one source file (post-build edit 12:35 UTC); fixed by the same rebuild (new bundle hash) | devops-06, 13, 14 |
| D4 | **P3** | `.github/workflows/ci.yml:57-68` | Docker job is config-validation only (no build/run) and only ever sees the merged config; DOCKER_SMOKE.md:50's "(what CI checks)" = base-alone claim is false | devops-01, 02 |
| D5 | **P3** | `ml/data/pipeline.py:119` | Image-vs-host diff includes a punctuation-only log change (em-dash → hyphen) — harmless, but proves the image predates even cosmetic source churn; swept into D2's rebuild | devops-07 |
| D6 | **P3** | `ci.yml:19-22` | CI never tests Python 3.14 (the local dev platform); deliberate 3.12 pin per ADR-7 — coverage observation, not a defect | ci.yml |

(Pre-existing llba findings re-confirmed during line review but not re-filed: F10 nginx-as-root/no frontend healthcheck/unpinned mlflow tag; F9 index.html caching.)

## Coverage

- Static: both Dockerfiles, nginx.conf, both compose files, ci.yml — line-by-line re-review, all directives accounted for (see §1).
- Runtime: full in-compose smoke ×2 (as-built + rebuilt), drift check, bind mounts, CORS allow/deny, SPA fallback, bundle baking, mlflow profile, teardown, port freedom, log/drift restoration.
- NOT done (with reason): `docker compose up` on the **base** ports 8000/8080 — those are occupied by foreign `showcase-*` containers (would collide); base-config validity was verified via `config -q` + rendered ports instead. Image push/registry workflows — none exist (compose never pushes). Linux-host bind-mount permissions — Windows Docker Desktop only; documented caveat stands.
