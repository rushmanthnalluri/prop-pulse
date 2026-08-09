"""Response schemas for the PropPulse API (SPEC §8/§10)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """``GET /health`` — liveness plus per-model loaded status."""

    status: str
    models_loaded: dict[str, bool]


class PriceRange(BaseModel):
    """Quantile-based ~80% prediction interval (validation residuals, log-space)."""

    low: float
    high: float


class SaleProbability(BaseModel):
    """Calibrated probability of selling within 30 days (SIMULATED target, ADR-3)."""

    probability: float
    sells_within_30_days: bool
    threshold: float


class MicroMarket(BaseModel):
    """Micro-market cluster payload from :class:`ml.clustering.serve.MicroMarketLookup`."""

    cluster_id: int
    label: str
    neighborhoods: list[str]
    n_neighborhoods: int
    n_sales: int
    median_price: float
    median_price_per_sqft: float
    sale_velocity_30d: float
    centroid_lat: float
    centroid_long: float
    fallback: bool
    note: str


class PriceFactor(BaseModel):
    """One SHAP-style explanation item (see ``ml.explainability.service``)."""

    feature: str
    impact: Literal["positive", "negative"]
    magnitude: float


class ModelVersion(BaseModel):
    """Champion identifiers + feature-list content hash."""

    regression: str
    classification: str
    feature_version: str


class MarketPosition(BaseModel):
    """Subject $/sqft positioned against train-split neighborhood/cluster medians.

    Positioning vs the median only — NOT an overpricing verdict.
    """

    subject_price_per_sqft: float
    neighborhood_median_price_per_sqft: float
    cluster_median_price_per_sqft: float
    vs_neighborhood_pct: float
    label: Literal["near", "above", "below"]


class Confidence(BaseModel):
    """Honesty block: 'reduced' when scoring inputs leave the train support."""

    level: Literal["typical", "reduced"]
    reasons: list[str]


class PredictResponse(BaseModel):
    """``POST /predict`` — the full bundle (SPEC §8)."""

    estimated_price: float
    price_range: PriceRange
    sale_probability: SaleProbability
    micro_market: MicroMarket
    top_price_factors: list[PriceFactor]
    market_position: MarketPosition
    confidence: Confidence
    model_version: ModelVersion


class PriceResponse(BaseModel):
    """``POST /predict/price`` — price only."""

    estimated_price: float
    price_range: PriceRange
    market_position: MarketPosition
    confidence: Confidence
    model_version: ModelVersion


class SaleProbabilityResponse(BaseModel):
    """``POST /predict/sale-probability`` — probability only."""

    probability: float
    sells_within_30_days: bool
    threshold: float
    confidence: Confidence
    model_version: ModelVersion


class MetricsResponse(BaseModel):
    """``GET /metrics`` — request counters, latency, latest drift summary."""

    requests_total: int
    errors_total: int
    requests_by_path: dict[str, int]
    avg_latency_ms: float
    uptime_seconds: float
    drift: dict[str, Any]


class NeighborhoodPoint(BaseModel):
    """One neighborhood marker for the market map."""

    neighborhood: str
    name: str
    lat: float
    long: float
    cluster_id: int
    fallback: bool


class MarketClustersResponse(BaseModel):
    """``GET /market/clusters`` — cluster stats + neighborhood points for the map."""

    n_clusters: int
    clusters: list[dict[str, Any]]
    neighborhoods: list[NeighborhoodPoint]


class Comp(BaseModel):
    """One comparable historical sale (train split, 2006-2008)."""

    sale_price: int
    price_per_sqft: float
    gr_liv_area: int
    overall_qual: int
    overall_cond: int
    year_built: int
    bedrooms: int
    baths: float
    garage_cars: int
    house_style: str
    sold: str
    match_scope: Literal["neighborhood", "cluster"]


class CompsResponse(BaseModel):
    """``POST /market/comps`` — top-5 similar train sales + price percentile."""

    comps: list[Comp]
    match_scope: Literal["neighborhood", "cluster"]
    percentile: float
    note: str
    calendar_clamped: bool


class TrendSeries(BaseModel):
    """One cluster's half-year trend line (``None`` = no sales that window)."""

    cluster: int
    label: str
    median_price: list[float | None]
    sales_count: list[int]


class MarketTrendsResponse(BaseModel):
    """``GET /market/trends`` — half-year median price + count per cluster."""

    periods: list[str]
    series: list[TrendSeries]
    note: str


class ChampionSection(BaseModel):
    """Public view of one ``champion.json`` entry (AUD-18).

    The internal artifact ``path`` is stripped before serving (AUD-19);
    remaining extra keys (metrics, bootstrap details, …) pass through.
    """

    model_config = ConfigDict(extra="allow")

    name: str
    version: str


class HeadlineRegressionMetrics(BaseModel):
    """``headline_metrics.regression`` — val/test summaries from champion.json."""

    val_rmsle: float | None = None
    val_rmse: float | None = None
    val_mae: float | None = None
    val_r2: float | None = None
    test_rmsle: float | None = None


class HeadlineClassificationMetrics(BaseModel):
    """``headline_metrics.classification`` (SIMULATED target, ADR-3)."""

    val_pr_auc: float | None = None
    val_roc_auc: float | None = None
    val_brier: float | None = None
    val_f1: float | None = None
    threshold: float | None = None
    simulated_target: bool


class HeadlineMetrics(BaseModel):
    """``headline_metrics`` section of ``GET /model/info``."""

    regression: HeadlineRegressionMetrics
    classification: HeadlineClassificationMetrics


class ModelInfoResponse(BaseModel):
    """``GET /model/info`` — public champion metadata + headline metrics."""

    regression: ChampionSection
    classification: ChampionSection
    clustering: dict[str, Any]
    selected_at: str | None
    dataset_version: str | None
    feature_version: str
    n_features: int
    rationale: str | None
    headline_metrics: HeadlineMetrics


class ModelImportanceResponse(BaseModel):
    """``GET /model/importance`` — mean-|SHAP| per model feature (SPEC §14)."""

    metadata: dict[str, Any]
    importance: dict[str, float]
