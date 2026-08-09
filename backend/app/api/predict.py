"""Prediction endpoints: ``/predict``, ``/predict/price``, ``/predict/sale-probability``."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.app.api.deps import (
    get_prediction_service,
    model_version_payload,
    model_version_string,
)
from backend.app.schemas.property import PropertyInput
from backend.app.schemas.responses import (
    ModelVersion,
    PredictResponse,
    PriceRange,
    PriceResponse,
    SaleProbabilityResponse,
)
from backend.app.services.prediction_service import PredictionBundle, PredictionService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["predict"])


def _log_prediction(
    request: Request,
    payload_input: PropertyInput,
    *,
    feature_row: dict[str, Any],
    estimated_price: float | None,
    probability: float | None,
    cluster_id: int,
) -> None:
    """Best-effort SPEC §10 log; never blocks the response.

    Narrow endpoints log ``null`` for the value they deliberately skip (the
    drift check coerces non-floats away, so feature PSI is unaffected).
    """
    try:
        request.app.state.prediction_logger.log(
            # AUD-F8 (accepted): the logged payload intentionally includes
            # server-side defaults the client omitted — drift analysis needs
            # the full effective input, not just the verbatim request fields.
            payload=payload_input.model_dump(mode="json", exclude_none=True),
            features=feature_row,
            prediction={
                "estimated_price": estimated_price,
                "probability": probability,
                "cluster_id": cluster_id,
            },
            model_version=model_version_string(request),
        )
    except Exception as exc:  # noqa: BLE001 — logging must never break serving
        logger.warning("prediction logging skipped: %s", exc)


def _run_prediction(
    request: Request,
    payload_input: PropertyInput,
    service: PredictionService,
) -> tuple[PredictionBundle, dict[str, Any], dict[str, Any]]:
    """Run both champions + cluster lookup and log the prediction (SPEC §10).

    Returns the bundle, the micro-market payload, and the serving payload
    (the confidence range checks read the client-stated values from it).

    Raises:
        HTTPException: 422 when the payload cannot be mapped/built into the
            model feature frame (unknown serving keys, unmappable values).
    """
    serving_payload = payload_input.to_serving_payload()
    try:
        bundle = service.predict(serving_payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    micro_market = request.app.state.cluster_service.lookup(payload_input.neighborhood)
    _log_prediction(
        request,
        payload_input,
        feature_row=bundle.feature_row,
        estimated_price=float(bundle.estimated_price),
        probability=float(bundle.probability),
        cluster_id=int(micro_market["cluster_id"]),
    )
    return bundle, micro_market, serving_payload


@router.post("/predict", response_model=PredictResponse)
def predict(
    payload_input: PropertyInput,
    request: Request,
    service: PredictionService = Depends(get_prediction_service),
) -> dict[str, Any]:
    """Full bundle: price + range + sale probability + micro-market + factors."""
    bundle, micro_market, serving_payload = _run_prediction(request, payload_input, service)
    return {
        "estimated_price": bundle.estimated_price,
        "price_range": PriceRange(low=bundle.price_low, high=bundle.price_high),
        "sale_probability": {
            "probability": bundle.probability,
            "sells_within_30_days": bundle.sells_within_30_days,
            "threshold": service.threshold,
        },
        "micro_market": micro_market,
        "top_price_factors": bundle.top_price_factors,
        "market_position": service.market_position(
            bundle.estimated_price, bundle.feature_row, micro_market
        ),
        "confidence": service.confidence(
            bundle.feature_row, bundle.calendar_clamped, payload=serving_payload
        ),
        "model_version": ModelVersion(**model_version_payload(request)),
    }


@router.post("/predict/price", response_model=PriceResponse)
def predict_price(
    payload_input: PropertyInput,
    request: Request,
    service: PredictionService = Depends(get_prediction_service),
) -> dict[str, Any]:
    """Price only (estimated price + quantile range).

    Skips the classification champion and the SHAP explanation entirely —
    they are not part of this response (~85% of the full-predict cost).
    """
    serving_payload = payload_input.to_serving_payload()
    try:
        result = service.predict_price(serving_payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    micro_market = request.app.state.cluster_service.lookup(payload_input.neighborhood)
    _log_prediction(
        request,
        payload_input,
        feature_row=result.feature_row,
        estimated_price=float(result.estimated_price),
        probability=None,
        cluster_id=int(micro_market["cluster_id"]),
    )
    return {
        "estimated_price": result.estimated_price,
        "price_range": PriceRange(low=result.price_low, high=result.price_high),
        "market_position": service.market_position(
            result.estimated_price, result.feature_row, micro_market
        ),
        "confidence": service.confidence(
            result.feature_row, result.calendar_clamped, payload=serving_payload
        ),
        "model_version": ModelVersion(**model_version_payload(request)),
    }


@router.post("/predict/sale-probability", response_model=SaleProbabilityResponse)
def predict_sale_probability(
    payload_input: PropertyInput,
    request: Request,
    service: PredictionService = Depends(get_prediction_service),
) -> dict[str, Any]:
    """Sale probability only (calibrated; SIMULATED target — ADR-3).

    Skips the regression champion and the SHAP explanation entirely.
    """
    serving_payload = payload_input.to_serving_payload()
    try:
        result = service.predict_sale_probability(serving_payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    micro_market = request.app.state.cluster_service.lookup(payload_input.neighborhood)
    _log_prediction(
        request,
        payload_input,
        feature_row=result.feature_row,
        estimated_price=None,
        probability=float(result.probability),
        cluster_id=int(micro_market["cluster_id"]),
    )
    return {
        "probability": result.probability,
        "sells_within_30_days": result.sells_within_30_days,
        "threshold": service.threshold,
        "confidence": service.confidence(
            result.feature_row, result.calendar_clamped, payload=serving_payload
        ),
        "model_version": ModelVersion(**model_version_payload(request)),
    }
