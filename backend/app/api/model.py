"""Model metadata endpoints: ``/model/info`` and ``/model/importance``.

Both payloads are static per process (they only change when artifacts change,
which requires a restart), so they are built once during the lifespan startup
and cached in ``app.state`` — see ``backend/app/main.py``.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from backend.app.schemas.responses import ModelImportanceResponse, ModelInfoResponse

router = APIRouter(tags=["model"])


def build_model_info_payload(state: Any) -> dict[str, Any]:
    """Assemble the ``/model/info`` payload from startup-loaded app state.

    The champion sections are deep-copied so the cached payload is decoupled
    from ``app.state.champion`` (later in-process mutation cannot leak into
    served responses).

    Classification metrics refer to the SIMULATED sale-speed target (ADR-3) —
    not a real-world performance claim.
    """
    champion: dict[str, Any] = copy.deepcopy(state.champion)
    regression = champion.get("regression", {})
    classification = champion.get("classification", {})
    clustering = champion.get("clustering", {})
    # Internal artifact locations are server internals — strip them from the
    # public payload; names/versions/metrics are kept (AUD-19).
    for section in (regression, classification, clustering):
        section.pop("path", None)
    return {
        "regression": regression,
        "classification": classification,
        "clustering": clustering,
        "selected_at": champion.get("selected_at"),
        "dataset_version": champion.get("dataset_version"),
        "feature_version": state.model_version["feature_version"],
        "n_features": len(state.model_features),
        "rationale": champion.get("rationale"),
        "headline_metrics": {
            "regression": {
                "val_rmsle": regression.get("val_metrics", {}).get("rmsle"),
                "val_rmse": regression.get("val_metrics", {}).get("rmse"),
                "val_mae": regression.get("val_metrics", {}).get("mae"),
                "val_r2": regression.get("val_metrics", {}).get("r2"),
                "test_rmsle": regression.get("test_metrics", {}).get("rmsle"),
            },
            "classification": {
                "val_pr_auc": classification.get("val_metrics", {}).get("pr_auc"),
                "val_roc_auc": classification.get("val_metrics", {}).get("roc_auc"),
                "val_brier": classification.get("val_metrics", {}).get("brier"),
                "val_f1": classification.get("val_metrics", {}).get("f1"),
                "threshold": classification.get("threshold"),
                "simulated_target": True,
            },
        },
    }


def load_model_importance(model_dir: Path) -> dict[str, Any]:
    """Read + validate ``explainability/feature_importance.json`` once.

    Returns ``{"payload": {...}}`` on success, or ``{"error": "<detail>"}``
    when the artifact is missing/unreadable/malformed so the endpoint can
    replay the startup-checked 503 without touching disk per request.
    """
    path = model_dir / "explainability" / "feature_importance.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "error": f"feature importance artifact unavailable ({exc.__class__.__name__})"
        }
    importance = payload.get("importance") if isinstance(payload, dict) else None
    if not isinstance(importance, dict) or not importance:
        return {"error": "feature importance artifact is malformed"}
    return {
        "payload": {
            "metadata": payload.get("metadata", {}),
            "importance": importance,
        }
    }


@router.get("/model/info", response_model=ModelInfoResponse)
def model_info(request: Request) -> dict[str, Any]:
    """Champion metadata + headline metrics (cached at startup)."""
    return request.app.state.model_info_payload


@router.get("/model/importance", response_model=ModelImportanceResponse)
def model_importance(request: Request) -> dict[str, Any]:
    """Mean-|SHAP| feature importance of the regression champion (SPEC §14).

    Serves the startup-cached read of
    ``models/explainability/feature_importance.json``; a missing or malformed
    artifact at startup is cached as an error state and replayed as a clean
    503 JSON error (no stack trace).
    """
    cached: dict[str, Any] = request.app.state.model_importance
    if "error" in cached:
        raise HTTPException(status_code=503, detail=cached["error"])
    return cached["payload"]
