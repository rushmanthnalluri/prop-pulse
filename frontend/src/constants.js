/**
 * Form constants for the PropPulse valuation form.
 *
 * Categorical option sets mirror the API contract exactly
 * (`backend/app/schemas/property.py`, SPEC §8) — the backend rejects values
 * outside these sets with 422. The neighborhood list is the 25 train
 * neighborhoods from `data/external/neighborhood_geo.csv` (code + display name).
 */

export const NEIGHBORHOODS = [
  { value: 'Blmngtn', label: 'Bloomington Heights' },
  { value: 'Blueste', label: 'Bluestem' },
  { value: 'BrDale', label: 'Briardale' },
  { value: 'BrkSide', label: 'Brookside' },
  { value: 'ClearCr', label: 'Clear Creek' },
  { value: 'CollgCr', label: 'College Creek' },
  { value: 'Crawfor', label: 'Crawford' },
  { value: 'Edwards', label: 'Edwards' },
  { value: 'Gilbert', label: 'Gilbert' },
  { value: 'IDOTRR', label: 'Iowa DOT & Rail Road' },
  { value: 'MeadowV', label: 'Meadow Village' },
  { value: 'Mitchel', label: 'Mitchell' },
  { value: 'NAmes', label: 'North Ames' },
  { value: 'NPkVill', label: 'Northpark Villa' },
  { value: 'NWAmes', label: 'Northwest Ames' },
  { value: 'NoRidge', label: 'Northridge' },
  { value: 'NridgHt', label: 'Northridge Heights' },
  { value: 'OldTown', label: 'Old Town' },
  { value: 'SWISU', label: 'South & West of ISU' },
  { value: 'Sawyer', label: 'Sawyer' },
  { value: 'SawyerW', label: 'Sawyer West' },
  { value: 'Somerst', label: 'Somerset' },
  { value: 'StoneBr', label: 'Stone Brook' },
  { value: 'Timber', label: 'Timberland' },
  { value: 'Veenker', label: 'Veenker' },
]

export const HOUSE_STYLES = ['1.5Fin', '1.5Unf', '1Story', '2.5Fin', '2.5Unf', '2Story', 'SFoyer', 'SLvl']
export const BLDG_TYPES = ['1Fam', '2fmCon', 'Duplex', 'Twnhs', 'TwnhsE']
export const MS_ZONING = ['C (all)', 'FV', 'RH', 'RL', 'RM']

/** Display labels for categorical values (the API still receives the raw code). */
export const ENUM_LABELS = {
  house_style: {
    '1Story': 'One story', '2Story': 'Two story', '1.5Fin': '1½ story — finished',
    '1.5Unf': '1½ story — unfinished', '2.5Fin': '2½ story — finished',
    '2.5Unf': '2½ story — unfinished', SFoyer: 'Split foyer', SLvl: 'Split level',
  },
  bldg_type: {
    '1Fam': 'Single-family detached', '2fmCon': 'Two-family conversion',
    Duplex: 'Duplex', Twnhs: 'Townhouse — inside unit', TwnhsE: 'Townhouse — end unit',
  },
  ms_zoning: {
    'C (all)': 'Commercial', FV: 'Floating village', RH: 'Residential — high density',
    RL: 'Residential — low density', RM: 'Residential — medium density',
  },
  quality: { Ex: 'Excellent', Gd: 'Good', TA: 'Typical / average', Fa: 'Fair', Po: 'Poor', None: 'None' },

  /* Advanced-override selects — human labels from the Ames data dictionary
     (data_description.txt). Values submitted to the API stay the raw codes. */
  bsmt_qual: { Ex: 'Excellent (100+ in)', Gd: 'Good (90–99 in)', TA: 'Typical (80–89 in)', Fa: 'Fair (70–79 in)', None: 'None — no basement' },
  garage_type: { '2Types': 'More than one type', Attchd: 'Attached to home', Basment: 'Basement garage', BuiltIn: 'Built-in (room above)', CarPort: 'Carport', Detchd: 'Detached', None: 'None — no garage' },
  garage_finish: { Fin: 'Finished', RFn: 'Rough finished', Unf: 'Unfinished', None: 'None — no garage' },
  foundation: { BrkTil: 'Brick & tile', CBlock: 'Cinder block', PConc: 'Poured concrete', Slab: 'Slab', Stone: 'Stone', Wood: 'Wood' },
  electrical: { SBrkr: 'Standard breakers & Romex', FuseA: 'Fuse box >60A (average)', FuseF: 'Fuse box 60A (fair)', FuseP: 'Fuse box, knob & tube (poor)', Mix: 'Mixed' },
  functional: { Typ: 'Typical', Min1: 'Minor deductions 1', Min2: 'Minor deductions 2', Mod: 'Moderate deductions', Maj1: 'Major deductions 1', Maj2: 'Major deductions 2', Sev: 'Severely damaged' },
  fireplace_qu: { Ex: 'Excellent', Gd: 'Good', TA: 'Typical / average', Fa: 'Fair', Po: 'Poor', None: 'None — no fireplace' },
  lot_shape: { Reg: 'Regular', IR1: 'Slightly irregular', IR2: 'Moderately irregular', IR3: 'Irregular' },
  lot_config: { Inside: 'Inside lot', Corner: 'Corner lot', CulDSac: 'Cul-de-sac', FR2: 'Frontage on 2 sides', FR3: 'Frontage on 3 sides' },
  land_slope: { Gtl: 'Gentle slope', Mod: 'Moderate slope', Sev: 'Severe slope' },
  condition1: {
    Norm: 'Normal', Artery: 'Adjacent to arterial street', Feedr: 'Adjacent to feeder street',
    PosN: 'Near park / greenbelt', PosA: 'Adjacent to park / greenbelt',
    RRNn: "Within 200 ft of N–S railroad", RRAn: 'Adjacent to N–S railroad',
    RRNe: "Within 200 ft of E–W railroad", RRAe: 'Adjacent to E–W railroad',
  },
  roof_style: { Flat: 'Flat', Gable: 'Gable', Gambrel: 'Gambrel (barn)', Hip: 'Hip', Mansard: 'Mansard', Shed: 'Shed' },
  exterior1st: {
    AsbShng: 'Asbestos shingles', BrkFace: 'Brick face', CemntBd: 'Cement board', HdBoard: 'Hardboard',
    ImStucc: 'Imitation stucco', MetalSd: 'Metal siding', Plywood: 'Plywood', Stone: 'Stone',
    Stucco: 'Stucco', VinylSd: 'Vinyl siding', 'Wd Sdng': 'Wood siding', WdShing: 'Wood shingles',
  },
  paved_drive: { Y: 'Paved', P: 'Partially paved', N: 'Dirt / gravel' },
  street: { Pave: 'Paved', Grvl: 'Gravel' },
}

/** Deterministic cluster → color map, shared by map, trends, and cluster cards. */
export const CLUSTER_COLORS = ['#0e7a6d', '#4c6e91', '#b98a2f', '#b4593f']
export function clusterColor(id) {
  const n = Number(id)
  if (!Number.isInteger(n) || n < 0) return '#6e7c8b'
  return CLUSTER_COLORS[n % CLUSTER_COLORS.length]
}
export const QUALITY_WITH_NONE = ['Ex', 'Gd', 'TA', 'Fa', 'Po', 'None']
export const QUALITY_NO_PO = ['Ex', 'Gd', 'TA', 'Fa']
export const BSMT_QUAL = ['Ex', 'Gd', 'TA', 'Fa', 'None']
export const HEATING_QC = ['Ex', 'Gd', 'TA', 'Fa', 'Po']
export const GARAGE_TYPES = ['2Types', 'Attchd', 'Basment', 'BuiltIn', 'CarPort', 'Detchd', 'None']
export const GARAGE_FINISH = ['Fin', 'RFn', 'Unf', 'None']
export const FOUNDATION = ['BrkTil', 'CBlock', 'PConc', 'Slab', 'Stone', 'Wood']
export const ELECTRICAL = ['FuseA', 'FuseF', 'FuseP', 'Mix', 'SBrkr']
export const FUNCTIONAL = ['Maj1', 'Maj2', 'Min1', 'Min2', 'Mod', 'Sev', 'Typ']
export const LOT_SHAPE = ['Reg', 'IR1', 'IR2', 'IR3']
export const LOT_CONFIG = ['Corner', 'CulDSac', 'FR2', 'FR3', 'Inside']
export const LAND_SLOPE = ['Gtl', 'Mod', 'Sev']
export const CONDITION1 = ['Artery', 'Feedr', 'Norm', 'PosA', 'PosN', 'RRAe', 'RRAn', 'RRNe', 'RRNn']
export const ROOF_STYLE = ['Flat', 'Gable', 'Gambrel', 'Hip', 'Mansard', 'Shed']
export const EXTERIOR_1ST = [
  'AsbShng', 'BrkFace', 'CemntBd', 'HdBoard', 'ImStucc', 'MetalSd',
  'Plywood', 'Stone', 'Stucco', 'VinylSd', 'Wd Sdng', 'WdShing',
]
export const PAVED_DRIVE = ['Y', 'N', 'P']
export const STREET = ['Pave', 'Grvl']

/**
 * Core form defaults — a typical Ames listing so the minimal path works
 * without touching any field (these are form inputs, not prediction data).
 * Required by the API: neighborhood, bedrooms, baths, areas, quality, garage,
 * fireplaces, central_air.
 */
export const DEFAULT_FORM = {
  neighborhood: 'NAmes',
  house_style: '1Story',
  bedrooms: 3,
  full_bath: 2,
  half_bath: 0,
  bsmt_full_bath: 0,
  bsmt_half_bath: 0,
  gr_liv_area: 1600,
  lot_area: 9000,
  total_bsmt_sf: 1000,
  year_built: 1995,
  overall_qual: 6,
  overall_cond: 5,
  garage_cars: 2,
  fireplaces: 1,
  central_air: true,
}

/**
 * Advanced overrides (SPEC §8). Empty string = omitted from the payload so the
 * API applies its own default / `models/feature_defaults.json`.
 * kind: 'number' | 'text' | 'select' | 'date'
 * Number inputs default to step=1 (integer schema fields); the three
 * float schema fields opt out with step: 'any'.
 */
export const ADVANCED_FIELDS = [
  { name: 'bldg_type', label: 'Building type', kind: 'select', options: BLDG_TYPES, placeholder: 'API default: 1Fam' },
  { name: 'ms_zoning', label: 'MS zoning', kind: 'select', options: MS_ZONING, placeholder: 'API default: RL' },
  { name: 'lot_frontage', label: 'Lot frontage (ft)', kind: 'number', min: 1, max: 500, step: 'any' },
  { name: 'year_remod_add', label: 'Remodel year', kind: 'number', min: 1870, max: 2026, placeholder: 'Default: year built' },
  { name: 'garage_area', label: 'Garage area (sqft)', kind: 'number', min: 0, max: 2000, step: 'any' },
  { name: 'pool_area', label: 'Pool area (sqft)', kind: 'number', min: 0, max: 1000 },
  { name: 'wood_deck_sf', label: 'Wood deck (sqft)', kind: 'number', min: 0, max: 1500 },
  { name: 'open_porch_sf', label: 'Open porch (sqft)', kind: 'number', min: 0, max: 1000 },
  { name: 'screen_porch', label: 'Screen porch (sqft)', kind: 'number', min: 0, max: 800 },
  { name: 'sale_date', label: 'Sale date', kind: 'date', placeholder: 'Default: latest train month (2008-12)' },
  { name: 'bsmt_qual', label: 'Basement quality', kind: 'select', options: BSMT_QUAL, labels: ENUM_LABELS.bsmt_qual, hint: 'Rates basement ceiling height' },
  { name: 'kitchen_qual', label: 'Kitchen quality', kind: 'select', options: QUALITY_NO_PO, labels: ENUM_LABELS.quality },
  { name: 'exter_qual', label: 'Exterior quality', kind: 'select', options: QUALITY_NO_PO, labels: ENUM_LABELS.quality },
  { name: 'heating_qc', label: 'Heating QC', kind: 'select', options: HEATING_QC, labels: ENUM_LABELS.quality },
  { name: 'garage_type', label: 'Garage type', kind: 'select', options: GARAGE_TYPES, labels: ENUM_LABELS.garage_type },
  { name: 'garage_finish', label: 'Garage finish', kind: 'select', options: GARAGE_FINISH, labels: ENUM_LABELS.garage_finish },
  { name: 'foundation', label: 'Foundation', kind: 'select', options: FOUNDATION, labels: ENUM_LABELS.foundation },
  { name: 'electrical', label: 'Electrical', kind: 'select', options: ELECTRICAL, labels: ENUM_LABELS.electrical },
  { name: 'functional', label: 'Functional rating', kind: 'select', options: FUNCTIONAL, labels: ENUM_LABELS.functional },
  { name: 'fireplace_qu', label: 'Fireplace quality', kind: 'select', options: QUALITY_WITH_NONE, labels: ENUM_LABELS.fireplace_qu },
  { name: 'lot_shape', label: 'Lot shape', kind: 'select', options: LOT_SHAPE, labels: ENUM_LABELS.lot_shape },
  { name: 'lot_config', label: 'Lot config', kind: 'select', options: LOT_CONFIG, labels: ENUM_LABELS.lot_config },
  { name: 'land_slope', label: 'Land slope', kind: 'select', options: LAND_SLOPE, labels: ENUM_LABELS.land_slope },
  { name: 'condition1', label: 'Proximity condition', kind: 'select', options: CONDITION1, labels: ENUM_LABELS.condition1 },
  { name: 'roof_style', label: 'Roof style', kind: 'select', options: ROOF_STYLE, labels: ENUM_LABELS.roof_style },
  { name: 'exterior1st', label: 'Exterior covering', kind: 'select', options: EXTERIOR_1ST, labels: ENUM_LABELS.exterior1st },
  { name: 'paved_drive', label: 'Paved drive', kind: 'select', options: PAVED_DRIVE, labels: ENUM_LABELS.paved_drive },
  { name: 'street', label: 'Street', kind: 'select', options: STREET, labels: ENUM_LABELS.street },
  { name: 'mas_vnr_area', label: 'Masonry veneer (sqft)', kind: 'number', min: 0, max: 2000, step: 'any' },
  { name: 'kitchen_abv_gr', label: 'Kitchens above grade', kind: 'number', min: 0, max: 3 },
  { name: 'tot_rms_abvgrd', label: 'Total rooms above grade', kind: 'number', min: 1, max: 15, hint: 'Excludes bathrooms' },
  { name: 'bsmt_fin_sf1', label: 'Basement finished (sqft)', kind: 'number', min: 0, max: 2500 },
  { name: 'bsmt_unf_sf', label: 'Basement unfinished (sqft)', kind: 'number', min: 0, max: 2500 },
  { name: 'first_flr_sf', label: '1st floor (sqft)', kind: 'number', min: 300, max: 4000 },
  { name: 'second_flr_sf', label: '2nd floor (sqft)', kind: 'number', min: 0, max: 3000 },
  { name: 'enclosed_porch', label: 'Enclosed porch (sqft)', kind: 'number', min: 0, max: 600 },
  { name: 'misc_val', label: 'Misc value ($)', kind: 'number', min: 0, max: 20000 },
  { name: 'mo_sold', label: 'Month sold (override)', kind: 'number', min: 1, max: 12 },
  { name: 'yr_sold', label: 'Year sold (override)', kind: 'number', min: 2006, max: 2026 },
]

/**
 * Train-observed input ranges (CONTRACT §2, from
 * `models/monitoring/reference_stats.json` outer PSI bin edges). Values may
 * pass schema validation yet fall outside these — the API still answers but
 * with `confidence.level: "reduced"`. The form uses these for the
 * warn-not-block hint tier (SPEC §5.2.1); keyed by API field name.
 */
export const TRAIN_RANGES = {
  gr_liv_area: { min: 334, max: 4476 },
  lot_area: { min: 1533, max: 164660 },
  total_bsmt_sf: { min: 0, max: 3200 },
  year_built: { min: 1872, max: 2008 },
  year_remod_add: { min: 1950, max: 2008 },
  garage_area: { min: 0, max: 1356 },
}

/**
 * Training sale window (CONTRACT §1.9/§2): an omitted `sale_date` silently
 * defaults to the latest train month (`end`); later dates are clamped to the
 * window boundary for scoring, never extrapolated.
 */
export const TRAIN_SALE_WINDOW = { start: '2006-01', end: '2008-12' }

/** localStorage key for the last submitted valuation payload (SPEC §5.2.2). */
export const LAST_VALUATION_KEY = 'proppulse:last-valuation'
