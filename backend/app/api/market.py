"""Market endpoints: ``/market/clusters`` and ``/market/trends``."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from backend.app.schemas.responses import MarketClustersResponse, MarketTrendsResponse

router = APIRouter(tags=["market"])


@router.get("/market/clusters", response_model=MarketClustersResponse)
def market_clusters(request: Request) -> dict[str, Any]:
    """Cluster stats + neighborhood points (lat/long) for the market map.

    The payload only changes with the clustering artifacts, so it is built
    once during the lifespan startup and cached in ``app.state``.
    """
    return request.app.state.market_clusters_payload


@router.get("/market/trends", response_model=MarketTrendsResponse)
def market_trends(request: Request) -> dict[str, Any]:
    """Half-year median sale price + sales count per micro-market cluster.

    Aggregated from the train-split comps artifact; built once during the
    lifespan startup and cached in ``app.state`` (same pattern as
    ``market_clusters_payload``).
    """
    return request.app.state.market_trends_payload
