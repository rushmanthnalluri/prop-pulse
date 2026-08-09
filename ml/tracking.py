"""MLflow tracking helpers (local file store by default).

Usage:
    from ml.tracking import track_run, log_model_artifact

    with track_run("regression", "ridge_v1", params={"alpha": 1.0}) as (mlflow, run):
        mlflow.log_metrics({"rmsle": 0.12})
        log_model_artifact(pipeline, "model")

Tracking URI resolution: env MLFLOW_TRACKING_URI > local file store at <repo>/mlruns.
"""
from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from ml.paths import DATASET_VERSION, MLRUNS_DIR

# mlflow 3.15 blocks the local file store unless this is set (must precede mlflow import).
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")


def get_tracking_uri() -> str:
    """Return the MLflow tracking URI (file store default)."""
    uri = os.getenv("MLFLOW_TRACKING_URI")
    if uri:
        return uri
    MLRUNS_DIR.mkdir(parents=True, exist_ok=True)
    return MLRUNS_DIR.resolve().as_uri()


def feature_version(feature_list_path: Path) -> str:
    """Content hash of the feature list — used as the feature version tag."""
    data = Path(feature_list_path).read_bytes()
    return hashlib.sha1(data).hexdigest()[:12]


@contextmanager
def track_run(
    experiment: str,
    run_name: str,
    params: dict[str, Any] | None = None,
    tags: dict[str, str] | None = None,
) -> Iterator[tuple[Any, Any]]:
    """Context manager yielding (mlflow, active_run) with standard tags applied."""
    import mlflow  # local import so non-training code never pays the import cost

    mlflow.set_tracking_uri(get_tracking_uri())
    mlflow.set_experiment(experiment)
    with mlflow.start_run(run_name=run_name) as run:
        base_tags = {"dataset_version": DATASET_VERSION, "trained_at": datetime.now(timezone.utc).isoformat()}
        if tags:
            base_tags.update(tags)
        mlflow.set_tags(base_tags)
        if params:
            mlflow.log_params({k: str(v) for k, v in params.items()})
        yield mlflow, run


def log_model_artifact(model: Any, artifact_name: str = "model") -> None:
    """Log a fitted sklearn-compatible pipeline as an MLflow artifact.

    Uses cloudpickle serialization: mlflow 3.15 defaults to skops, which rejects
    fitted numpy dtypes inside sklearn Pipelines as untrusted types.
    """
    import mlflow.sklearn

    mlflow.sklearn.log_model(model, artifact_name, serialization_format="cloudpickle")


def log_dict_artifact(payload: dict, filename: str) -> None:
    """Log a small JSON-serialisable dict as an MLflow artifact.

    Must be called inside an active run (i.e. within `track_run`).
    """
    import mlflow

    tmp = Path(os.getenv("TMPDIR", ".")) / filename
    tmp.write_text(json.dumps(payload, indent=2, default=str))
    try:
        mlflow.log_artifact(str(tmp))
    finally:
        tmp.unlink(missing_ok=True)
