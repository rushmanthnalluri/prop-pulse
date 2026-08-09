"""Serving payload mapping — THE single API → raw-row mapping (SPEC §8).

The backend validates a ``PropertyInput`` payload (snake_case field names) and
hands it to :func:`serving_payload_to_raw`, which returns one complete raw row
 keyed by raw Ames column names, ready for ``pd.DataFrame([row])`` →
:func:`ml.features.pipeline.build_feature_frame`. Every column of
``RAW_INPUT_COLUMNS`` is populated: unspecified fields fall back to
``FEATURE_DEFAULTS`` (train mode/median, ``models/feature_defaults.json``).
No other module may re-implement this mapping.

Field mapping (API ``PropertyInput`` → raw Ames column):

| API field          | Raw column     | Notes                                        |
|--------------------|----------------|----------------------------------------------|
| neighborhood       | Neighborhood   | one of the 25 train neighborhoods            |
| house_style        | HouseStyle     | default "1Story"                             |
| bldg_type          | BldgType       | default "1Fam"                               |
| ms_zoning          | MSZoning       | default "RL"                                 |
| bedrooms           | BedroomAbvGr   |                                              |
| full_bath          | FullBath       |                                              |
| half_bath          | HalfBath       |                                              |
| bsmt_full_bath     | BsmtFullBath   |                                              |
| bsmt_half_bath     | BsmtHalfBath   |                                              |
| gr_liv_area        | GrLivArea      |                                              |
| lot_area           | LotArea        |                                              |
| lot_frontage       | LotFrontage    | optional                                     |
| total_bsmt_sf      | TotalBsmtSF    |                                              |
| year_built         | YearBuilt      |                                              |
| year_remod_add     | YearRemodAdd   | default: ``year_built``                      |
| overall_qual       | OverallQual    |                                              |
| overall_cond       | OverallCond    |                                              |
| garage_cars        | GarageCars     |                                              |
| garage_area        | GarageArea     | optional                                     |
| fireplaces         | Fireplaces     |                                              |
| central_air        | CentralAir     | bool → "Y"/"N" ("Y"/"N" strings pass through)|
| pool_area          | PoolArea       | default 0                                    |
| wood_deck_sf       | WoodDeckSF     | default 0                                    |
| open_porch_sf      | OpenPorchSF    | default 0                                    |
| screen_porch       | ScreenPorch    | default 0                                    |
| sale_date          | MoSold/YrSold  | ISO date or ``datetime.date``; default: latest train month |
| bsmt_qual          | BsmtQual       | advanced override                            |
| kitchen_qual       | KitchenQual    | advanced override                            |
| exter_qual         | ExterQual      | advanced override                            |
| heating_qc         | HeatingQC      | advanced override                            |
| garage_type        | GarageType     | advanced override                            |
| garage_finish      | GarageFinish   | advanced override                            |
| foundation         | Foundation     | advanced override                            |
| electrical         | Electrical     | advanced override                            |
| functional         | Functional     | advanced override                            |
| fireplace_qu       | FireplaceQu    | advanced override                            |
| lot_shape          | LotShape       | advanced override                            |
| lot_config         | LotConfig      | advanced override                            |
| land_slope         | LandSlope      | advanced override                            |
| condition1         | Condition1     | advanced override                            |
| roof_style         | RoofStyle      | advanced override                            |
| exterior1st        | Exterior1st    | advanced override                            |
| mas_vnr_area       | MasVnrArea     | advanced override                            |
| kitchen_abv_gr     | KitchenAbvGr   | advanced override                            |
| tot_rms_abvgrd     | TotRmsAbvGrd   | advanced override                            |
| bsmt_fin_sf1       | BsmtFinSF1     | advanced override                            |
| bsmt_unf_sf        | BsmtUnfSF      | advanced override                            |
| first_flr_sf       | 1stFlrSF       | advanced override                            |
| second_flr_sf      | 2ndFlrSF       | advanced override                            |
| enclosed_porch     | EnclosedPorch  | advanced override                            |
| misc_val           | MiscVal        | advanced override                            |
| paved_drive        | PavedDrive     | advanced override ("Y"/"N"/"P")              |
| street             | Street         | advanced override                            |
| mo_sold            | MoSold         | advanced override (beats ``sale_date``)      |
| yr_sold            | YrSold         | advanced override (beats ``sale_date``)      |

Calendar clamp (statistical-integrity guard): the champions are fit on the
2006-2008 train split, so scoring a sale dated years beyond that window is
unguarded linear extrapolation on ``sale_year``/``property_age`` and friends.
Two rules keep scoring inside the train support:

- an omitted sale date defaults to the LATEST train month
  (:data:`TRAIN_SUPPORT_MAX`), not to "today" (which drifts ever further
  beyond the window as wall-clock time passes);
- an explicitly supplied sale date beyond the train window is clamped to
  :data:`TRAIN_SUPPORT_MAX` for scoring (``YrSold``/``MoSold`` and everything
  the pipeline derives from them: ``sale_year``, ``sale_quarter``,
  ``property_age``, ``years_since_remod``). Callers can detect this case via
  :func:`calendar_clamp_applied` and surface it to the client;
- the same guard extends to the remodel calendar: ``YearRemodAdd`` is pinned
  to at most the clamped ``YrSold``, so ``years_since_remod`` (train support
  [0, 58]) can never go negative. The confidence range check still discloses
  the client-stated remodel year (reference max 2008).
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any

from ml.features.defaults import FEATURE_DEFAULTS
from ml.features.pipeline import RAW_INPUT_COLUMNS, neighborhood_coordinates

logger = logging.getLogger(__name__)

__all__ = [
    "API_TO_RAW",
    "TRAIN_SUPPORT_MAX",
    "TRAIN_SUPPORT_MAX_YEAR",
    "TRAIN_SUPPORT_MIN_YEAR",
    "calendar_clamp_applied",
    "serving_payload_to_raw",
]

#: First sale year covered by the train split (min ``YrSold`` of
#: ``data/processed/train.csv``; matches the ``YrSold`` outer bin edge of
#: ``models/monitoring/reference_stats.json``).
TRAIN_SUPPORT_MIN_YEAR: int = 2006

#: Latest sale year/month covered by the train split: max ``(YrSold, MoSold)``
#: of ``data/processed/train.csv`` — (2008, 12); the ``YrSold`` outer bin edge
#: of ``models/monitoring/reference_stats.json`` (2008.0) cross-checks the
#: year. Documented constants derived from the data stats (no train-stats
#: artifact currently persists the sale window).
TRAIN_SUPPORT_MAX_YEAR: int = 2008
TRAIN_SUPPORT_MAX_MONTH: int = 12

#: ``(year, month)`` upper bound for scoring calendar features.
TRAIN_SUPPORT_MAX: tuple[int, int] = (TRAIN_SUPPORT_MAX_YEAR, TRAIN_SUPPORT_MAX_MONTH)

#: API ``PropertyInput`` field name → raw Ames column name (see module docstring).
API_TO_RAW: dict[str, str] = {
    "neighborhood": "Neighborhood",
    "house_style": "HouseStyle",
    "bldg_type": "BldgType",
    "ms_zoning": "MSZoning",
    "bedrooms": "BedroomAbvGr",
    "full_bath": "FullBath",
    "half_bath": "HalfBath",
    "bsmt_full_bath": "BsmtFullBath",
    "bsmt_half_bath": "BsmtHalfBath",
    "gr_liv_area": "GrLivArea",
    "lot_area": "LotArea",
    "lot_frontage": "LotFrontage",
    "total_bsmt_sf": "TotalBsmtSF",
    "year_built": "YearBuilt",
    "year_remod_add": "YearRemodAdd",
    "overall_qual": "OverallQual",
    "overall_cond": "OverallCond",
    "garage_cars": "GarageCars",
    "garage_area": "GarageArea",
    "fireplaces": "Fireplaces",
    "pool_area": "PoolArea",
    "wood_deck_sf": "WoodDeckSF",
    "open_porch_sf": "OpenPorchSF",
    "screen_porch": "ScreenPorch",
    # Advanced overrides (SPEC §8).
    "bsmt_qual": "BsmtQual",
    "kitchen_qual": "KitchenQual",
    "exter_qual": "ExterQual",
    "heating_qc": "HeatingQC",
    "garage_type": "GarageType",
    "garage_finish": "GarageFinish",
    "foundation": "Foundation",
    "electrical": "Electrical",
    "functional": "Functional",
    "fireplace_qu": "FireplaceQu",
    "lot_shape": "LotShape",
    "lot_config": "LotConfig",
    "land_slope": "LandSlope",
    "condition1": "Condition1",
    "roof_style": "RoofStyle",
    "exterior1st": "Exterior1st",
    "mas_vnr_area": "MasVnrArea",
    "kitchen_abv_gr": "KitchenAbvGr",
    "tot_rms_abvgrd": "TotRmsAbvGrd",
    "bsmt_fin_sf1": "BsmtFinSF1",
    "bsmt_unf_sf": "BsmtUnfSF",
    "first_flr_sf": "1stFlrSF",
    "second_flr_sf": "2ndFlrSF",
    "enclosed_porch": "EnclosedPorch",
    "misc_val": "MiscVal",
    "paved_drive": "PavedDrive",
    "street": "Street",
    "mo_sold": "MoSold",
    "yr_sold": "YrSold",
}

#: Payload keys handled specially (not plain renames).
_SPECIAL_KEYS = frozenset({"central_air", "sale_date"})


def _central_air_token(value: Any) -> str:
    """Normalize ``central_air`` (bool or string) to the Ames "Y"/"N" token."""
    if isinstance(value, str):
        token = value.strip().upper()
        if token in {"Y", "N"}:
            return token
        if token in {"TRUE", "YES", "1"}:
            return "Y"
        if token in {"FALSE", "NO", "0"}:
            return "N"
        raise ValueError(f"unrecognized central_air value: {value!r}")
    return "Y" if bool(value) else "N"


def _parse_sale_date(value: Any) -> tuple[int, int]:
    """Parse ``sale_date`` into ``(year, month)``.

    Accepts ``datetime.date``/``datetime.datetime`` or an ISO ``YYYY-MM-DD``
    (or ``YYYY-MM``) string.
    """
    if isinstance(value, dt.datetime):
        return value.year, value.month
    if isinstance(value, dt.date):
        return value.year, value.month
    if isinstance(value, str):
        parts = value.strip().split("-")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            year, month = int(parts[0]), int(parts[1])
            if 1 <= month <= 12:
                return year, month
    raise ValueError(
        f"sale_date must be a date or ISO 'YYYY-MM-DD' string, got {value!r}"
    )


def _requested_sale_period(payload: dict[str, Any]) -> tuple[int, int, bool]:
    """Resolve the ``(year, month, explicit)`` sale period a payload asks for.

    The base default is :data:`TRAIN_SUPPORT_MAX` (the latest train month,
    NOT "today"); ``sale_date`` replaces both components and the
    ``yr_sold``/``mo_sold`` advanced overrides win last — the same precedence
    as :func:`serving_payload_to_raw`. ``explicit`` is True when any calendar
    field was supplied; an omitted sale date defaults silently (by design),
    while an explicit one beyond the train window must be surfaced.
    """
    year, month = TRAIN_SUPPORT_MAX
    explicit = False
    if "sale_date" in payload:
        year, month = _parse_sale_date(payload["sale_date"])
        explicit = True
    if "yr_sold" in payload:
        year = int(payload["yr_sold"])
        explicit = True
    if "mo_sold" in payload:
        month = int(payload["mo_sold"])
        explicit = True
    return year, month, explicit


def calendar_clamp_applied(payload: dict[str, Any]) -> bool:
    """True when an explicitly supplied sale date falls beyond the train window.

    Used by the serving layer to flag clamped scoring in the confidence block;
    an omitted sale date returns False (defaulting to the train-window
    boundary is the designed default, not a client error).
    """
    year, month, explicit = _requested_sale_period(payload)
    return explicit and (year, month) > TRAIN_SUPPORT_MAX


def serving_payload_to_raw(payload: dict[str, Any]) -> dict[str, Any]:
    """Map an API ``PropertyInput`` payload to a complete raw Ames row.

    Args:
        payload: Validated request body using the snake_case field names of
            SPEC §8 (see the module docstring table).

    Returns:
        A dict keyed by raw Ames column names covering every column of
        ``RAW_INPUT_COLUMNS``; unspecified fields are filled from
        ``FEATURE_DEFAULTS``. Feed via ``pd.DataFrame([row])`` into
        :func:`ml.features.pipeline.build_feature_frame`.

    Raises:
        ValueError: On unknown payload keys or unparseable special values.
    """
    unknown = sorted(set(payload) - set(API_TO_RAW) - _SPECIAL_KEYS)
    if unknown:
        raise ValueError(
            f"unknown PropertyInput fields: {unknown}; "
            "see ml.features.serving for the accepted field names"
        )

    raw: dict[str, Any] = {col: FEATURE_DEFAULTS.get(col) for col in RAW_INPUT_COLUMNS}

    for api_name, value in payload.items():
        if api_name in _SPECIAL_KEYS:
            continue
        raw[API_TO_RAW[api_name]] = value

    # central_air: API boolean -> Ames "Y"/"N" token.
    if "central_air" in payload:
        raw["CentralAir"] = _central_air_token(payload["central_air"])

    # Sale timing: sale_date / mo_sold / yr_sold resolve to (YrSold, MoSold)
    # with TRAIN_SUPPORT_MAX as the base default (NOT "today" — the champions
    # are fit on the 2006-2008 train split, so a drifting wall-clock default
    # would score ever further outside the train support). A requested period
    # beyond the train window is clamped to the window boundary for scoring
    # (YrSold/MoSold and everything the pipeline derives from them:
    # sale_year, sale_quarter, property_age, years_since_remod); callers flag
    # the clamp via calendar_clamp_applied().
    year, month, _explicit = _requested_sale_period(payload)
    if (year, month) > TRAIN_SUPPORT_MAX:
        year, month = TRAIN_SUPPORT_MAX
    raw["YrSold"] = year
    raw["MoSold"] = month

    # SPEC §8: year_remod_add defaults to year_built.
    if "year_remod_add" not in payload:
        raw["YearRemodAdd"] = raw["YearBuilt"]

    # Remodel-calendar clamp — extends the calendar-support clamp above to
    # YearRemodAdd: a remodel year after the clamped sale year would derive a
    # negative years_since_remod (train support [0, 58]), i.e. silent linear
    # extrapolation. Pin the remodel year to the clamped sale year so
    # years_since_remod >= 0. No new disclosure is needed: the confidence
    # range check reads the client-stated payload value (reference max 2008).
    remod_year = raw["YearRemodAdd"]
    if remod_year is not None and float(remod_year) > year:
        raw["YearRemodAdd"] = year

    # Coordinates come from the neighborhood centroid lookup (single
    # implementation in ml.features.pipeline), not the global lat/long
    # defaults, so payload-built rows carry real geography.
    lat, long = neighborhood_coordinates(str(raw["Neighborhood"]))
    raw["lat"] = lat
    raw["long"] = long

    return raw
