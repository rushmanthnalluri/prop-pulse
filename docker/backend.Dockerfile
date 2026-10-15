# syntax=docker/dockerfile:1
# PropPulse backend image (SPEC §12, ADR-7).
#
# Serves the FastAPI app (backend.app.main:app) with the registered champion
# artifacts. The container pins python:3.12-slim deliberately — independent of
# the host's Python 3.14 (ADR-7) — and runs as a non-root user.
#
# Build from the REPO ROOT (the build context must include ml/, backend/,
# models/ and data/external/):
#
#   docker build -f docker/backend.Dockerfile -t proppulse-backend:latest .
#
# NOTE: builds verified 2026-08-07 (Docker Server 29.4.0) — full smoke
# evidence in reports/DOCKER_SMOKE.md; see docker/README.md.
FROM python:3.12-slim

# Python runtime hygiene: unbuffered logs, no .pyc writes, no pip cache.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first so this layer is cached unless the pinned
# requirements change. backend/requirements.txt is the slim serving subset
# (no mlflow — ml.tracking imports mlflow lazily, only inside training calls).
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Application code + model artifacts.
#   ml/      — feature pipeline, clustering serving, explainability, monitoring
#   backend/ — FastAPI app (config resolves paths against /app via ml/paths.py)
#   models/  — registry champions, champion.json, feature/neighborhood/cluster/
#              monitoring/explainability artifacts (small; copied whole, §6)
COPY ml/ ml/
COPY backend/ backend/
COPY models/ models/

# Required at serving time: every prediction maps Neighborhood -> approximate
# centroid (ml/features/pipeline.py, backend/app/schemas/property.py,
# backend/app/services/cluster_service.py all read this CSV).
COPY data/external/neighborhood_geo.csv data/external/neighborhood_geo.csv

# The guided Ames workflow loads this raw CSV to validate and start training.
# .dockerignore re-includes only this file; the Kaggle archive stays excluded.
COPY data/raw/ames/train.csv data/raw/ames/train.csv

# Required by the workflow's canonical bundled Ames dataset. Train is also
# the SHAP background distribution; validation/test are used by training jobs.
COPY data/processed/train.csv data/processed/train.csv
COPY data/processed/val.csv data/processed/val.csv
COPY data/processed/test.csv data/processed/test.csv

# Runtime-writable directories: the prediction JSONL log (bind-mounted in
# compose) and the drift report written by `python -m ml.monitoring.drift_check`.
# Then drop privileges — the app never needs root.
RUN groupadd --system app && useradd --system --gid app --no-create-home appuser \
    && mkdir -p /app/logs /app/reports/drift \
    && chown -R appuser:app /app
USER appuser

# Env defaults — keys mirror .env.example (SPEC §12). Values are repo-relative
# and resolve against /app (ml/paths.py REPO_ROOT). compose env_file overrides.
ENV MODEL_DIR=models \
    DATA_DIR=data \
    MLFLOW_TRACKING_URI="" \
    LOG_LEVEL=INFO \
    PREDICTION_LOG_PATH=logs/predictions.jsonl \
    DRIFT_PSI_THRESHOLD=0.2

EXPOSE 8000

# The image binds 0.0.0.0 (required inside a container) via the CMD's --host
# flag — no app setting reads a host/port var, the flags are authoritative.
#
# `sh -c "exec ..."` form: JSON exec-form cannot expand $LOG_LEVEL, so a shell
# does it; `exec` replaces the shell, keeping uvicorn as PID 1 so SIGTERM still
# reaches it directly. --log-level puts uvicorn's own loggers (uvicorn /
# uvicorn.error / uvicorn.access) on the same LOG_LEVEL that
# logging.basicConfig (backend/app/main.py) applies to the root logger for the
# app loggers — uvicorn's dictConfig gives its loggers dedicated handlers with
# propagate=False, so nothing double-logs and LOG_LEVEL stays the single
# 12-factor control. Uvicorn's CLI accepts only lowercase level names
# (click.Choice is case-sensitive), hence the `tr` pipe; the :-INFO fallback
# covers an empty/unset override. --timeout-graceful-shutdown 10 lets in-flight
# requests drain for up to 10s after SIGTERM before the worker exits.
# Deliberately NO --proxy-headers: nothing in the app reads client IP (no IP
# logging or rate limiting — backend/app/monitoring/middleware.py), no proxy
# fronts uvicorn in compose (the browser calls the backend directly), and
# uvicorn would only trust X-Forwarded-* from 127.0.0.1 by default anyway.
CMD ["sh", "-c", "exec python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --log-level \"$(printf '%s' \"${LOG_LEVEL:-INFO}\" | tr '[:upper:]' '[:lower:]')\" --timeout-graceful-shutdown 10"]
