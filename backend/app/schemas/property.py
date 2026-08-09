"""Request schema for the prediction endpoints (SPEC §8).

``PropertyInput`` mirrors the serving contract: snake_case API fields that
:func:`ml.features.serving.serving_payload_to_raw` maps onto raw Ames columns.
Required fields carry the SPEC §8 validation ranges; optional fields default
to ``models/feature_defaults.json`` values when omitted (the payload is dumped
with ``exclude_unset=True`` before mapping). Unknown fields are rejected
(``extra="forbid"`` → 422).
"""
from __future__ import annotations

import datetime as dt
from functools import lru_cache
from typing import Literal

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ml.paths import EXTERNAL_DIR

# ---------------------------------------------------------------------------
# Allowed categorical values — the exact category sets observed in the
# processed train split (data/processed/train.csv; absent features are the
# literal string "None", SPEC §14).
# ---------------------------------------------------------------------------
HouseStyle = Literal["1.5Fin", "1.5Unf", "1Story", "2.5Fin", "2.5Unf", "2Story", "SFoyer", "SLvl"]
BldgType = Literal["1Fam", "2fmCon", "Duplex", "Twnhs", "TwnhsE"]
MSZoning = Literal["C (all)", "FV", "RH", "RL", "RM"]
QualityNone = Literal["Ex", "Gd", "TA", "Fa", "Po", "None"]
QualityNoPo = Literal["Ex", "Gd", "TA", "Fa"]
BsmtQual = Literal["Ex", "Gd", "TA", "Fa", "None"]
FireplaceQu = Literal["Ex", "Gd", "TA", "Fa", "Po", "None"]
HeatingQC = Literal["Ex", "Gd", "TA", "Fa", "Po"]
GarageType = Literal["2Types", "Attchd", "Basment", "BuiltIn", "CarPort", "Detchd", "None"]
GarageFinish = Literal["Fin", "RFn", "Unf", "None"]
Foundation = Literal["BrkTil", "CBlock", "PConc", "Slab", "Stone", "Wood"]
Electrical = Literal["FuseA", "FuseF", "FuseP", "Mix", "SBrkr"]
Functional = Literal["Maj1", "Maj2", "Min1", "Min2", "Mod", "Sev", "Typ"]
LotShape = Literal["Reg", "IR1", "IR2", "IR3"]
LotConfig = Literal["Corner", "CulDSac", "FR2", "FR3", "Inside"]
LandSlope = Literal["Gtl", "Mod", "Sev"]
Condition1 = Literal["Artery", "Feedr", "Norm", "PosA", "PosN", "RRAe", "RRAn", "RRNe", "RRNn"]
RoofStyle = Literal["Flat", "Gable", "Gambrel", "Hip", "Mansard", "Shed"]
Exterior1st = Literal[
    "AsbShng", "BrkFace", "CemntBd", "HdBoard", "ImStucc", "MetalSd",
    "Plywood", "Stone", "Stucco", "VinylSd", "Wd Sdng", "WdShing",
]
PavedDrive = Literal["Y", "N", "P"]
Street = Literal["Pave", "Grvl"]


@lru_cache(maxsize=1)
def known_neighborhoods() -> frozenset[str]:
    """The 25 train neighborhoods (from ``data/external/neighborhood_geo.csv``)."""
    geo = pd.read_csv(EXTERNAL_DIR / "neighborhood_geo.csv", keep_default_na=False)
    return frozenset(str(value) for value in geo["Neighborhood"])


class PropertyInput(BaseModel):
    """Validated ``POST /predict*`` body (SPEC §8).

    Required unless a default is listed. Optional advanced overrides fall back
    to ``FEATURE_DEFAULTS`` (train mode/median) when omitted.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # --- Core fields -------------------------------------------------------
    neighborhood: str = Field(description="One of the 25 Ames neighborhoods")
    house_style: HouseStyle = "1Story"
    bldg_type: BldgType = "1Fam"
    ms_zoning: MSZoning = "RL"
    bedrooms: int = Field(ge=0, le=8)
    full_bath: int = Field(ge=0, le=4)
    half_bath: int = Field(ge=0, le=2)
    bsmt_full_bath: int = Field(ge=0, le=3)
    bsmt_half_bath: int = Field(ge=0, le=2)
    gr_liv_area: int = Field(ge=300, le=6000, description="Above-grade living area (sqft)")
    lot_area: int = Field(ge=500, le=200000)
    lot_frontage: float | None = Field(default=None, ge=1.0, le=500.0, allow_inf_nan=False)
    total_bsmt_sf: int = Field(ge=0, le=4000)
    year_built: int = Field(ge=1870, le=2026)
    year_remod_add: int | None = Field(default=None, ge=1870, le=2026)
    overall_qual: int = Field(ge=1, le=10)
    overall_cond: int = Field(ge=1, le=10)
    garage_cars: int = Field(ge=0, le=5)
    garage_area: float | None = Field(default=None, ge=0.0, le=2000.0, allow_inf_nan=False)
    fireplaces: int = Field(ge=0, le=4)
    central_air: bool
    pool_area: int = Field(default=0, ge=0, le=1000)
    wood_deck_sf: int = Field(default=0, ge=0, le=1500)
    open_porch_sf: int = Field(default=0, ge=0, le=1000)
    screen_porch: int = Field(default=0, ge=0, le=800)
    sale_date: dt.date | None = Field(
        default=None,
        ge=dt.date(2006, 1, 1),
        le=dt.date(2026, 12, 31),
        description=(
            "ISO date bounded to 2006-01-01..2026-12-31 (consistent with the "
            "yr_sold range); mapped to MoSold/YrSold (default: latest train "
            "month 2008-12; dates beyond the 2006-2008 train window are "
            "clamped to the window boundary for scoring)"
        ),
    )

    # --- Optional advanced overrides (SPEC §8) ------------------------------
    bsmt_qual: BsmtQual | None = None
    kitchen_qual: QualityNoPo | None = None
    exter_qual: QualityNoPo | None = None
    heating_qc: HeatingQC | None = None
    garage_type: GarageType | None = None
    garage_finish: GarageFinish | None = None
    foundation: Foundation | None = None
    electrical: Electrical | None = None
    functional: Functional | None = None
    fireplace_qu: FireplaceQu | None = None
    lot_shape: LotShape | None = None
    lot_config: LotConfig | None = None
    land_slope: LandSlope | None = None
    condition1: Condition1 | None = None
    roof_style: RoofStyle | None = None
    exterior1st: Exterior1st | None = None
    mas_vnr_area: float | None = Field(default=None, ge=0.0, le=2000.0, allow_inf_nan=False)
    kitchen_abv_gr: int | None = Field(default=None, ge=0, le=3)
    tot_rms_abvgrd: int | None = Field(default=None, ge=1, le=15)
    bsmt_fin_sf1: int | None = Field(default=None, ge=0, le=2500)
    bsmt_unf_sf: int | None = Field(default=None, ge=0, le=2500)
    first_flr_sf: int | None = Field(default=None, ge=300, le=4000, description="1stFlrSF")
    second_flr_sf: int | None = Field(default=None, ge=0, le=3000, description="2ndFlrSF")
    enclosed_porch: int | None = Field(default=None, ge=0, le=600)
    misc_val: int | None = Field(default=None, ge=0, le=20000)
    paved_drive: PavedDrive | None = None
    street: Street | None = None
    mo_sold: int | None = Field(default=None, ge=1, le=12)
    yr_sold: int | None = Field(default=None, ge=2006, le=2026)

    @field_validator("neighborhood")
    @classmethod
    def _neighborhood_must_be_known(cls, value: str) -> str:
        """Reject neighborhoods outside the 25 train neighborhoods (422)."""
        if value not in known_neighborhoods():
            raise ValueError(
                f"unknown neighborhood {value!r}; must be one of: "
                f"{', '.join(sorted(known_neighborhoods()))}"
            )
        return value

    def to_serving_payload(self) -> dict:
        """Dump only explicitly provided fields for ``serving_payload_to_raw``.

        Unset fields are omitted so the serving layer fills them from
        ``FEATURE_DEFAULTS`` (SPEC §8: "Unspecified fields →
        models/feature_defaults.json"); explicit ``null`` is treated as unset.
        """
        return self.model_dump(exclude_unset=True, exclude_none=True)
