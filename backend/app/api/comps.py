"""Comparable-sales endpoint: ``POST /market/comps``."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.app.api.deps import get_prediction_service
from backend.app.schemas.property import PropertyInput
from backend.app.schemas.responses import CompsResponse
from backend.app.services.prediction_service import PredictionService

router = APIRouter(tags=["market"])


@router.post("/market/comps", response_model=CompsResponse)
def market_comps(
    payload_input: PropertyInput,
    request: Request,
    service: PredictionService = Depends(get_prediction_service),
) -> dict[str, Any]:
    """Top-5 comparable historical sales + the subject's price percentile.

    Runs the cheap price path (no classifier, no SHAP) to position the
    subject among the train-split sales of its neighborhood, falling back to
    its micro-market cluster when the neighborhood has too few sales.

    Raises:
        HTTPException: 422 when the payload cannot be mapped/built into the
            model feature frame (unknown serving keys, unmappable values).
    """
    try:
        result = service.predict_price(payload_input.to_serving_payload())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    micro_market = request.app.state.cluster_service.lookup(payload_input.neighborhood)
    subject = {
        "gr_liv_area": payload_input.gr_liv_area,
        "overall_qual": payload_input.overall_qual,
        "year_built": payload_input.year_built,
        "bedrooms": payload_input.bedrooms,
        # Above-grade total, matching the artifact's `baths` definition.
        "baths": payload_input.full_bath + 0.5 * payload_input.half_bath,
    }
    return {
        **request.app.state.comps_service.comps_response(
            subject=subject,
            neighborhood=payload_input.neighborhood,
            cluster_id=int(micro_market["cluster_id"]),
            estimated_price=float(result.estimated_price),
        ),
        # Additive clamp disclosure: the subject's percentile is scored at the
        # clamped calendar, so clients must see when the clamp fired.
        "calendar_clamped": result.calendar_clamped,
    }
