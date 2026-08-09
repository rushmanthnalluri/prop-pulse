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

# Also required at serving time: the SHAP explainer samples its background
# distribution from the processed train split (ml/explainability/explainer.py
# -> ml.training.common.load_split("train")). Without it /predict returns
# empty top_price_factors. Un-excluded in .dockerignore; 334 KB.
COPY data/processed/train.csv data/processed/train.csv

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
    API_HOST=0.0.0.0 \
    API_PORT=8000 \
    VITE_API_URL=http://localhost:8000 \
    LOG_LEVEL=INFO \
    PREDICTION_LOG_PATH=logs/predictions.jsonl \
    DRIFT_PSI_THRESHOLD=0.2

EXPOSE 8000

# The image binds 0.0.0.0 (required inside a container); API_HOST above is the
# settings default, the flag is authoritative.
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
