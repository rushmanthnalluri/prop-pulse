"""Workflow dataset routes (workflow-architecture §3.1/§3.2).

``POST /workflow/datasets`` takes the **raw CSV body** (no multipart —
``python-multipart`` is deliberately absent, §2.3) and gets a 10 MiB body
limit via the ``BodySizeLimitMiddleware`` rule table; every other route keeps
the global 64 KiB cap.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from backend.app.api.deps import get_workflow_dataset_service
from backend.app.schemas.workflow import (
    DatasetCreatedOut,
    DatasetDetailOut,
    DatasetRecordOut,
    StateOut,
)
from backend.app.services.workflow import WorkflowDatasetService

router = APIRouter(tags=["workflow"])

#: Accepted upload content types (§2.3 whitelist; ``; charset=…`` tolerated).
_UPLOAD_CONTENT_TYPES = ("text/csv", "application/octet-stream")


@router.post("/workflow/datasets", status_code=201, response_model=DatasetCreatedOut)
async def upload_dataset(
    request: Request,
    filename: str = Query(default="upload.csv"),
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> dict[str, Any]:
    """Upload + validate a CSV dataset (stage 01, §3.1).

    Raw request body only; ``filename`` is a query parameter (sanitized
    server-side; only ``.csv`` passes validation). Async because it awaits the
    raw body; everything downstream is sync.

    Raises:
        HTTPException: 400 empty body; 413 >10 MiB (middleware); 415 wrong
            content type; 422 validation failure with the documented
            dict-shaped detail ``{"code", "message", "report"}``.
    """
    content_type = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type not in _UPLOAD_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"unsupported content type {content_type or '<none>'!r} — send the CSV "
                f"bytes as the request body with one of: {', '.join(_UPLOAD_CONTENT_TYPES)}"
            ),
        )
    body = await request.body()
    if not body:
        raise HTTPException(
            status_code=400,
            detail="request body is empty — send the CSV file bytes as the request body",
        )
    return service.upload(body, filename)


@router.get("/workflow/datasets", response_model=list[DatasetRecordOut])
def list_datasets(
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> list[dict[str, Any]]:
    """All datasets — bundled ``ames`` first, uploads newest-first (§3.2)."""
    return service.list_datasets()


@router.get("/workflow/datasets/{dataset_id}", response_model=DatasetDetailOut)
def get_dataset(
    dataset_id: str,
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> dict[str, Any]:
    """One dataset record plus its ``state`` block (§3.2); 404 unknown id."""
    return service.get_dataset(dataset_id)


@router.get("/workflow/datasets/{dataset_id}/state", response_model=StateOut)
def get_dataset_state(
    dataset_id: str,
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> dict[str, Any]:
    """Just the ``state`` block — the stepper's server truth (§3.2/§6.2)."""
    return service.get_state(dataset_id)


@router.delete("/workflow/datasets/{dataset_id}", status_code=204)
def delete_dataset(
    dataset_id: str,
    service: WorkflowDatasetService = Depends(get_workflow_dataset_service),
) -> Response:
    """Delete an upload (storage + sandbox); 204 on success (§3.2).

    400 the bundled dataset (``"The bundled dataset cannot be deleted"``);
    404 unknown id; 409 a job is queued/running on it.
    """
    service.delete_dataset(dataset_id)
    return Response(status_code=204)
