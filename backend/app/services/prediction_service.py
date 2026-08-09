"""Prediction service — champion inference behind the prediction endpoints.

Wraps the registered champion pipelines (SPEC §6/§8):

- regression champion (ridge) predicts ``log1p(SalePrice)``; the dollar price
  is ``expm1(pred)`` and the ~80% range is ``expm1(pred + q_low/q_high)`` with
  the validation-residual quantiles from ``champion.json`` (never hardcoded).
- classification champion (calibrated random forest) gives the probability of
  ``sells_within_30_days``; the operating threshold comes from
  ``champion.json`` ``classification.threshold`` (SPEC §14 — not 0.5).

Explanations come from ``ml.explainability.service.explain_instance`` under a
strict contract; ANY failure yields ``top_price_factors == []`` and never
breaks a prediction.

Serving is strictly single-row, so :func:`force_single_threaded` pins every
inner estimator of the loaded champions to ``n_jobs=1`` — joblib process
pools only add spawn/teardown overhead per call (~85% of the warm request,
see ``reports/PERFORMANCE.md``) and never change prediction values.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from ml.features.pipeline import build_feature_frame
from ml.features.serving import (
    TRAIN_SUPPORT_MAX_YEAR,
    TRAIN_SUPPORT_MIN_YEAR,
    calendar_clamp_applied,
    serving_payload_to_raw,
)
from ml.features.stats import NeighborhoodStats

logger = logging.getLogger(__name__)

#: Key numeric raw columns checked against the train distribution extremes by
#: :meth:`PredictionService.confidence`, with human-readable labels.
_CONFIDENCE_RANGE_CHECKS: tuple[tuple[str, str], ...] = (
    ("GrLivArea", "Living area"),
    ("LotArea", "Lot area"),
    ("TotalBsmtSF", "Basement area"),
    ("YearBuilt", "Year built"),
    ("YearRemodAdd", "Remodel year"),
    ("GarageArea", "Garage area"),
)

__all__ = [
    "PredictionBundle",
    "PredictionService",
    "PriceResult",
    "SaleProbabilityResult",
    "force_single_threaded",
]


def force_single_threaded(model: Any) -> Any:
    """Recursively set ``n_jobs=1`` on every inner estimator that has it.

    Walks Pipeline ``steps``, ColumnTransformer ``transformers_`` /
    ``transformer_list``, and ``CalibratedClassifierCV.calibrated_classifiers_``
    → their ``estimator``. ``n_jobs`` only schedules work — fitted parameters
    are untouched, and single-row predictions differ by at most one ULP
    (parallel vote-sum order), i.e. the 6-decimal values the API serves are
    identical. Mutates and returns ``model`` (an in-memory artifact, never
    the joblib on disk).
    """
    seen: set[int] = set()

    def _walk(obj: Any) -> None:
        if obj is None or isinstance(obj, (str, bytes)) or id(obj) in seen:
            return
        seen.add(id(obj))
        if hasattr(obj, "n_jobs"):
            try:
                obj.n_jobs = 1
            except (AttributeError, ValueError):  # frozen/read-only estimator
                logger.debug("could not pin n_jobs on %r", type(obj).__name__)
        for attr in ("steps", "transformer_list", "transformers_"):
            for entry in getattr(obj, attr, None) or []:
                if isinstance(entry, (tuple, list)) and len(entry) >= 2:
                    _walk(entry[1])
        for calibrated in getattr(obj, "calibrated_classifiers_", None) or []:
            _walk(getattr(calibrated, "estimator", None))
        _walk(getattr(obj, "estimator", None))

    _walk(model)
    return model


@dataclass(frozen=True)
class PredictionBundle:
    """Everything the prediction endpoints and the prediction logger need."""

    estimated_price: float
    price_low: float
    price_high: float
    probability: float
    sells_within_30_days: bool
    top_price_factors: list[dict[str, Any]]
    calendar_clamped: bool
    feature_row: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class PriceResult:
    """Price-only result (``/predict/price``) — no classifier, no SHAP."""

    estimated_price: float
    price_low: float
    price_high: float
    calendar_clamped: bool
    feature_row: dict[str, Any] = field(repr=False)


@dataclass(frozen=True)
class SaleProbabilityResult:
    """Probability-only result (``/predict/sale-probability``) — no regressor, no SHAP."""

    probability: float
    sells_within_30_days: bool
    calendar_clamped: bool
    feature_row: dict[str, Any] = field(repr=False)


class PredictionService:
    """Stateless inference over the loaded champion artifacts.

    Args:
        regression_model: Fitted champion pipeline (predicts log1p price).
        classification_model: Fitted calibrated champion classifier.
        neighborhood_stats: Train-fit stats for ``build_feature_frame``.
        threshold: Operating threshold from ``champion.json``.
        residual_interval: ``{"q_low": …, "q_high": …}`` log-space residual
            quantiles from ``champion.json``.
        reference_ranges: ``{raw column: (min, max)}`` outer PSI bin edges from
            ``models/monitoring/reference_stats.json`` (train distribution
            extremes); ``None`` disables the range checks of
            :meth:`confidence`.
    """

    def __init__(
        self,
        regression_model: Any,
        classification_model: Any,
        neighborhood_stats: NeighborhoodStats,
        threshold: float,
        residual_interval: dict[str, float],
        reference_ranges: dict[str, tuple[float, float]] | None = None,
    ) -> None:
        self._regression = regression_model
        self._classification = classification_model
        self._stats = neighborhood_stats
        self.threshold = float(threshold)
        self.q_low = float(residual_interval["q_low"])
        self.q_high = float(residual_interval["q_high"])
        self._reference_ranges = reference_ranges or {}

    def build_features(self, payload: dict[str, Any]) -> pd.DataFrame:
        """Map a validated payload to the single-row MODEL_FEATURES frame.

        Raises:
            ValueError: On unknown payload keys or unmappable values
                (surfaced by the API layer as 422).
        """
        raw = serving_payload_to_raw(payload)
        return build_feature_frame(pd.DataFrame([raw]), stats=self._stats)

    def predict(self, payload: dict[str, Any]) -> PredictionBundle:
        """Run both champions and assemble the full prediction bundle."""
        features = self.build_features(payload)
        estimated_price, price_low, price_high = self._price(features)
        probability = self._probability(features)

        return PredictionBundle(
            estimated_price=round(estimated_price, 2),
            price_low=round(price_low, 2),
            price_high=round(price_high, 2),
            probability=round(probability, 6),
            sells_within_30_days=bool(probability >= self.threshold),
            top_price_factors=self._explain(features),
            calendar_clamped=calendar_clamp_applied(payload),
            feature_row=_json_safe_row(features),
        )

    def predict_price(self, payload: dict[str, Any]) -> PriceResult:
        """Price + range only — the classifier and SHAP are never touched."""
        features = self.build_features(payload)
        estimated_price, price_low, price_high = self._price(features)
        return PriceResult(
            estimated_price=round(estimated_price, 2),
            price_low=round(price_low, 2),
            price_high=round(price_high, 2),
            calendar_clamped=calendar_clamp_applied(payload),
            feature_row=_json_safe_row(features),
        )

    def predict_sale_probability(self, payload: dict[str, Any]) -> SaleProbabilityResult:
        """Sale probability only — the regressor and SHAP are never touched."""
        features = self.build_features(payload)
        probability = self._probability(features)
        return SaleProbabilityResult(
            probability=round(probability, 6),
            sells_within_30_days=bool(probability >= self.threshold),
            calendar_clamped=calendar_clamp_applied(payload),
            feature_row=_json_safe_row(features),
        )

    def market_position(
        self,
        estimated_price: float,
        feature_row: dict[str, Any],
        micro_market: dict[str, Any],
    ) -> dict[str, Any]:
        """Subject $/sqft vs the neighborhood/cluster train medians.

        Positioning against the median only — a label of "above"/"below" is
        NOT an overpricing verdict (a renovated, higher-quality home should
        price above the median).
        """
        gr_liv_area = max(float(feature_row["GrLivArea"]), 1.0)
        subject = float(estimated_price) / gr_liv_area
        neighborhood_stats = self._stats.for_neighborhood(str(feature_row["Neighborhood"]))
        neighborhood_median = float(neighborhood_stats["median_price_per_sqft"])
        cluster_median = float(micro_market["median_price_per_sqft"])
        vs_pct = (
            (subject - neighborhood_median) / neighborhood_median * 100.0
            if neighborhood_median > 0.0
            else 0.0
        )
        label = "near" if abs(vs_pct) <= 5.0 else ("above" if vs_pct > 0.0 else "below")
        return {
            "subject_price_per_sqft": round(subject, 1),
            "neighborhood_median_price_per_sqft": round(neighborhood_median, 1),
            "cluster_median_price_per_sqft": round(cluster_median, 1),
            "vs_neighborhood_pct": round(vs_pct, 1),
            "label": label,
        }

    def confidence(
        self,
        feature_row: dict[str, Any],
        calendar_clamped: bool,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Honesty block: "reduced" when scoring inputs leave the train support.

        One human-readable reason per key numeric input that falls outside the
        observed train range (outer PSI bin edges of the drift reference), plus
        a reason when the sale-date calendar clamp fired. The estimate is still
        served — the band around it is just less trustworthy.

        The range checks read the CLIENT-STATED inputs, not the clamped
        scoring row: serving pins ``YearRemodAdd`` to the clamped sale year
        (ml.features.serving), so ``feature_row`` alone would hide an
        out-of-window remodel year. ``payload`` (the serving payload) restores
        the stated value — or the SPEC §8 year_built default when omitted.
        """
        inputs = feature_row
        if payload:
            stated = payload.get("year_remod_add", payload.get("year_built"))
            if stated is not None:
                inputs = {**feature_row, "YearRemodAdd": stated}
        reasons: list[str] = []
        for raw_column, label in _CONFIDENCE_RANGE_CHECKS:
            bounds = self._reference_ranges.get(raw_column)
            value = inputs.get(raw_column)
            if bounds is None or value is None:
                continue
            low, high = bounds
            if float(value) < low:
                reasons.append(
                    f"{label} below the training range — "
                    "true error may exceed the shown band."
                )
            elif float(value) > high:
                reasons.append(
                    f"{label} above the training range — "
                    "true error may exceed the shown band."
                )
        if calendar_clamped:
            reasons.append(
                f"Sale date beyond the {TRAIN_SUPPORT_MIN_YEAR}-{TRAIN_SUPPORT_MAX_YEAR} "
                "training window; scored at the window boundary."
            )
        return {"level": "reduced" if reasons else "typical", "reasons": reasons}

    def _price(self, features: pd.DataFrame) -> tuple[float, float, float]:
        """Regression champion → (estimate, low, high) on the dollar scale."""
        pred_log = float(self._regression.predict(features)[0])
        estimated_price = float(np.expm1(pred_log))
        price_low = float(np.expm1(pred_log + self.q_low))
        price_high = float(np.expm1(pred_log + self.q_high))
        return estimated_price, price_low, price_high

    def _probability(self, features: pd.DataFrame) -> float:
        """Classification champion → calibrated P(sells_within_30_days)."""
        proba = self._classification.predict_proba(features)[0]
        classes = list(self._classification.classes_)
        if 1 not in classes:
            # Fail loudly (generic 500) instead of silently serving the last
            # proba column: a champion without the positive class is a broken
            # artifact, not a usable prediction (AUD-22).
            raise RuntimeError(
                "classification champion classes_ "
                f"{classes} do not include the positive class 1"
            )
        return float(proba[classes.index(1)])

    def _explain(self, features: pd.DataFrame, top_n: int = 5) -> list[dict[str, Any]]:
        """Best-effort SHAP explanation; [] on ANY failure (SPEC contract).

        ``ml.explainability.service`` is built concurrently with this backend,
        so the import lives inside the try block by design.
        """
        try:
            from ml.explainability.service import explain_instance

            factors = explain_instance(features, top_n=top_n)
            return [
                {
                    "feature": str(item["feature"]),
                    "impact": "positive" if item["impact"] == "positive" else "negative",
                    "magnitude": float(item["magnitude"]),
                }
                for item in factors
            ]
        except Exception as exc:  # noqa: BLE001 — explanation must never break a prediction
            logger.warning("explanation unavailable, returning empty factors: %s", exc)
            return []


def _json_safe_row(features: pd.DataFrame) -> dict[str, Any]:
    """Single-row frame → JSON-serializable dict (numpy scalars → Python)."""
    row: dict[str, Any] = {}
    for key, value in features.iloc[0].to_dict().items():
        if isinstance(value, np.generic):
            value = value.item()
        if isinstance(value, float) and not np.isfinite(value):
            value = None
        row[str(key)] = value
    return row
