/**
 * Valuation form configuration (SPEC §5.2.1): the declarative field schema,
 * defaults, client validation, and payload/URL (de)serialization for the
 * /valuation page. Pure module — no React — so the page and the form share
 * one source of truth. Bounds mirror backend/app/schemas/property.py exactly;
 * TRAIN_RANGES (constants.js, CONTRACT §2) drive the warn-not-block tier that
 * pre-announces `confidence.level: "reduced"`.
 */
import {
  ADVANCED_FIELDS,
  BLDG_TYPES,
  DEFAULT_FORM,
  ENUM_LABELS,
  HOUSE_STYLES,
  MS_ZONING,
  NEIGHBORHOODS,
  TRAIN_RANGES,
} from '../../constants'
import { formatNumber, formatYear } from '../../format'

/** Calendar-year fields — hints and validation never thousands-group them. */
const YEAR_FIELDS = new Set(['year_built', 'year_remod_add', 'yr_sold'])

/** Bound formatter for hints/validation: grouped, except years (WP-7c). */
const formatBound = (name, value) =>
  YEAR_FIELDS.has(name) ? formatYear(value) : formatNumber(value, 0)

const neighborhoodOptions = NEIGHBORHOODS.map((n) => n.value)
const neighborhoodLabels = Object.fromEntries(
  NEIGHBORHOODS.map((n) => [n.value, `${n.label} (${n.value})`]),
)

/** "train range 334–4,476" from the contract's train-observed ranges. */
function trainRangeHint(name) {
  const range = TRAIN_RANGES[name]
  if (!range) return undefined
  return `train range ${formatBound(name, range.min)}–${formatBound(name, range.max)}`
}

/** Core fieldsets — always visible, SPEC §5.2.1 order, bounds, and hints. */
export const CORE_GROUPS = [
  {
    legend: 'Location & lot',
    fields: [
      { name: 'neighborhood', label: 'Neighborhood', kind: 'select', options: neighborhoodOptions, labels: neighborhoodLabels, required: true },
      { name: 'lot_area', label: 'Lot area', unit: 'sq ft', kind: 'number', min: 500, max: 200000, integer: true, required: true, hint: trainRangeHint('lot_area') },
      { name: 'lot_frontage', label: 'Lot frontage', unit: 'ft', kind: 'number', min: 1, max: 500, required: false, hint: 'blank → training median' },
    ],
  },
  {
    legend: 'Property',
    fields: [
      { name: 'house_style', label: 'House style', kind: 'select', options: HOUSE_STYLES, labels: ENUM_LABELS.house_style },
      { name: 'bldg_type', label: 'Building type', kind: 'select', options: BLDG_TYPES, labels: ENUM_LABELS.bldg_type },
      { name: 'ms_zoning', label: 'Zoning (MS)', kind: 'select', options: MS_ZONING, labels: ENUM_LABELS.ms_zoning },
      { name: 'year_built', label: 'Year built', kind: 'number', min: 1870, max: 2026, integer: true, required: true, hint: trainRangeHint('year_built') },
      { name: 'year_remod_add', label: 'Remodel year', kind: 'number', min: 1870, max: 2026, integer: true, required: false, hint: `blank → year built · train window ${TRAIN_RANGES.year_remod_add.min}–${TRAIN_RANGES.year_remod_add.max}` },
    ],
  },
  {
    legend: 'Living space',
    fields: [
      { name: 'gr_liv_area', label: 'Living area', unit: 'sq ft', kind: 'number', min: 300, max: 6000, integer: true, required: true, hint: trainRangeHint('gr_liv_area') },
      { name: 'total_bsmt_sf', label: 'Basement area', unit: 'sq ft', kind: 'number', min: 0, max: 4000, integer: true, required: true, hint: `train max ${formatNumber(TRAIN_RANGES.total_bsmt_sf.max, 0)}` },
    ],
  },
  {
    legend: 'Rooms & baths',
    fields: [
      { name: 'bedrooms', label: 'Bedrooms', kind: 'number', min: 0, max: 8, integer: true, required: true, hint: 'Above grade — basement bedrooms excluded' },
      { name: 'full_bath', label: 'Full baths', kind: 'number', min: 0, max: 4, integer: true, required: true, hint: 'Above grade' },
      { name: 'half_bath', label: 'Half baths', kind: 'number', min: 0, max: 2, integer: true, required: true, hint: 'Above grade' },
      { name: 'bsmt_full_bath', label: 'Basement full baths', kind: 'number', min: 0, max: 3, integer: true, required: true },
      { name: 'bsmt_half_bath', label: 'Basement half baths', kind: 'number', min: 0, max: 2, integer: true, required: true },
    ],
  },
  {
    legend: 'Quality & condition',
    fields: [
      { name: 'overall_qual', label: 'Overall quality', kind: 'number', min: 1, max: 10, integer: true, required: true, hint: '10 = very excellent / 1 = very poor' },
      { name: 'overall_cond', label: 'Overall condition', kind: 'number', min: 1, max: 10, integer: true, required: true, hint: '10 = very excellent / 1 = very poor' },
    ],
  },
  {
    legend: 'Garage & amenities',
    fields: [
      { name: 'garage_cars', label: 'Garage', unit: 'cars', kind: 'number', min: 0, max: 5, integer: true, required: true },
      { name: 'garage_area', label: 'Garage area', unit: 'sq ft', kind: 'number', min: 0, max: 2000, required: false, hint: 'blank → training median' },
      { name: 'fireplaces', label: 'Fireplaces', kind: 'number', min: 0, max: 4, integer: true, required: true },
      { name: 'central_air', label: 'Central air', kind: 'checkbox', required: true },
      { name: 'pool_area', label: 'Pool area', unit: 'sq ft', kind: 'number', min: 0, max: 1000, integer: true, required: true },
      { name: 'wood_deck_sf', label: 'Wood deck', unit: 'sq ft', kind: 'number', min: 0, max: 1500, integer: true, required: true },
      { name: 'open_porch_sf', label: 'Open porch', unit: 'sq ft', kind: 'number', min: 0, max: 1000, integer: true, required: true },
      { name: 'screen_porch', label: 'Screen porch', unit: 'sq ft', kind: 'number', min: 0, max: 800, integer: true, required: true },
    ],
  },
]

/**
 * Fields promoted out of ADVANCED_FIELDS into the core fieldsets above — the
 * advanced <details> renders the remaining overrides so no payload key is
 * edited in two places (existing pattern, AUDIT §6.4 KEEP).
 */
const PROMOTED_FIELDS = new Set([
  'bldg_type',
  'ms_zoning',
  'lot_frontage',
  'year_remod_add',
  'garage_area',
  'pool_area',
  'wood_deck_sf',
  'open_porch_sf',
  'screen_porch',
])

/**
 * The 30 advanced overrides, normalized (integer flag derived from step) and
 * with the sale_date placeholder corrected: an omitted sale date defaults to
 * the latest train month 2008-12 — never "today" (CONTRACT §2 calendar
 * clamp) — and later dates are clamped, never extrapolated.
 */
const ADVANCED_EXTRA = ADVANCED_FIELDS.filter((field) => !PROMOTED_FIELDS.has(field.name)).map(
  (field) => {
    const normalized = field.kind === 'number' ? { ...field, integer: field.step !== 'any' } : { ...field }
    if (field.name === 'sale_date') {
      return {
        ...normalized,
        min: '2006-01-01',
        max: '2026-12-31',
        hint: 'Defaults to the latest training month (2008-12); later dates are clamped, never extrapolated.',
      }
    }
    return normalized
  },
)

/** Advanced <details> subheadings (SPEC §5.2.1). */
const ADVANCED_GROUP_NAMES = [
  ['Structure', ['foundation', 'roof_style', 'exterior1st', 'mas_vnr_area', 'electrical', 'lot_shape', 'lot_config', 'land_slope', 'condition1', 'street']],
  ['Quality ratings', ['bsmt_qual', 'kitchen_qual', 'exter_qual', 'heating_qc', 'fireplace_qu', 'functional']],
  ['Garage & basement detail', ['garage_type', 'garage_finish', 'bsmt_fin_sf1', 'bsmt_unf_sf']],
  ['Porches & misc', ['paved_drive', 'enclosed_porch', 'misc_val', 'kitchen_abv_gr', 'tot_rms_abvgrd', 'first_flr_sf', 'second_flr_sf']],
  ['Sale timing', ['sale_date', 'mo_sold', 'yr_sold']],
]

export const ADVANCED_GROUPS = ADVANCED_GROUP_NAMES.map(([title, names]) => ({
  title,
  fields: names
    .map((name) => ADVANCED_EXTRA.find((field) => field.name === name))
    .filter(Boolean),
}))
// Defensive: any override missed by the name lists still renders.
const groupedNames = new Set(ADVANCED_GROUP_NAMES.flatMap(([, names]) => names))
const ungrouped = ADVANCED_EXTRA.filter((field) => !groupedNames.has(field.name))
if (ungrouped.length > 0) ADVANCED_GROUPS.push({ title: 'Additional overrides', fields: ungrouped })

const ADVANCED_FIELDS_FLAT = ADVANCED_GROUPS.flatMap((group) => group.fields)
export const ADVANCED_NAMES = new Set(ADVANCED_FIELDS_FLAT.map((field) => field.name))

/** Every field descriptor by name (core fieldsets, then advanced overrides). */
export const FIELD_INDEX = Object.fromEntries(
  [...CORE_GROUPS.flatMap((group) => group.fields), ...ADVANCED_FIELDS_FLAT].map((field) => [
    field.name,
    field,
  ]),
)
export const LABELS = Object.fromEntries(
  Object.values(FIELD_INDEX).map((field) => [field.name, field.label]),
)
/** Validation / first-invalid-focus order: core fieldsets, then advanced. */
export const FIELD_ORDER = [
  ...CORE_GROUPS.flatMap((group) => group.fields).map((field) => field.name),
  ...ADVANCED_FIELDS_FLAT.map((field) => field.name),
]
/** Fields client validation can check (number + date inputs). */
export const VALIDATED_FIELDS = Object.values(FIELD_INDEX).filter(
  (field) => !field.kind || field.kind === 'number' || field.kind === 'date',
)

/** Initial form state — a typical Ames home, so the minimal path just works. */
export const FORM_DEFAULTS = {
  ...DEFAULT_FORM,
  bldg_type: '1Fam',
  ms_zoning: 'RL',
  lot_frontage: '',
  year_remod_add: '',
  garage_area: '',
  pool_area: 0,
  wood_deck_sf: 0,
  open_porch_sf: 0,
  screen_porch: 0,
}

/** Client-side check for one numeric field: required → type → integer → range. */
function validateNumeric(desc, rawValue, values) {
  const raw = String(rawValue ?? '').trim()
  if (raw === '') return desc.required ? 'Required' : null
  const value = Number(raw)
  if (!Number.isFinite(value)) return 'Enter a number'
  if (desc.integer && !Number.isInteger(value)) return 'Whole numbers only'
  if ((desc.min !== undefined && value < desc.min) || (desc.max !== undefined && value > desc.max)) {
    return `Must be between ${formatBound(desc.name, desc.min)} and ${formatBound(desc.name, desc.max)}`
  }
  if (desc.name === 'year_remod_add') {
    const built = Number(values.year_built)
    if (Number.isFinite(built) && value < built) return 'Must be at or after the year built'
  }
  return null
}

/**
 * Validate one field by kind. Selects/checkboxes are constrained by their
 * options and always pass; dates are range-checked against the schema
 * window (2006-01-01…2026-12-31); numbers go through validateNumeric.
 */
export function validateField(desc, rawValue, values) {
  if (desc.kind === 'select' || desc.kind === 'checkbox') return null
  if (desc.kind === 'date') {
    const raw = String(rawValue ?? '').trim()
    if (raw === '') return desc.required ? 'Required' : null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'Use YYYY-MM-DD'
    if (raw < '2006-01-01' || raw > '2026-12-31') return 'Must be between 2006-01-01 and 2026-12-31'
    return null
  }
  return validateNumeric(desc, rawValue, values)
}

/**
 * Warn-not-block tier (SPEC §5.2.1, CONTRACT §2): values that pass schema
 * validation but leave the train-observed ranges get a --warn hint that
 * pre-announces `confidence.level: "reduced"`. Never blocks submission.
 */
export const TRAIN_WARN_COPY =
  'Outside the 2006–2008 training range — the API will answer with reduced confidence.'

export function trainWarns(values) {
  const warns = {}
  for (const [name, range] of Object.entries(TRAIN_RANGES)) {
    const raw = values[name]
    if (raw === '' || raw === null || raw === undefined) continue
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    if (value < range.min || value > range.max) warns[name] = TRAIN_WARN_COPY
  }
  return warns
}

/**
 * POST body: core fields always; optional core fields only when non-empty
 * (the API applies training-data defaults); advanced overrides only when set.
 */
export function buildPayload(values) {
  const payload = {
    neighborhood: values.neighborhood,
    house_style: values.house_style,
    bldg_type: values.bldg_type,
    ms_zoning: values.ms_zoning,
    central_air: values.central_air === true || values.central_air === 'true',
  }
  for (const desc of Object.values(FIELD_INDEX)) {
    if (desc.name in payload) continue
    const raw = values[desc.name]
    if (raw === '' || raw === null || raw === undefined) continue
    payload[desc.name] =
      desc.kind === 'select' || desc.kind === 'date' ? String(raw) : Number(raw)
  }
  return payload
}

/** Inverse of buildPayload for known fields, layered over the form defaults. */
export function payloadToFormValues(payload) {
  const values = { ...FORM_DEFAULTS }
  if (!payload || typeof payload !== 'object') return values
  for (const name of Object.keys(FIELD_INDEX)) {
    if (payload[name] === undefined || payload[name] === null) continue
    values[name] = payload[name]
  }
  return values
}

/** Submitted payload → URL search params (shareable valuation, SPEC §7.7). */
export function payloadToParams(payload) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue
    params.set(key, String(value))
  }
  return params
}

/**
 * URL search params → validated form values (SPEC §7.7; generalizes the
 * ?neighborhood= handshake, AUDIT §6.11). Unknown/invalid values are dropped
 * silently, never an error. Returns null when no known field is present.
 */
export function parseUrlValues(searchParams) {
  if (!searchParams) return null
  const values = {}
  for (const [name, desc] of Object.entries(FIELD_INDEX)) {
    const raw = searchParams.get(name)
    if (raw === null) continue
    if (desc.kind === 'checkbox') {
      if (raw === 'true') values[name] = true
      else if (raw === 'false') values[name] = false
      continue
    }
    if (desc.kind === 'select') {
      if ((desc.options || []).includes(raw)) values[name] = raw
      continue
    }
    if (raw.trim() === '') continue
    if (validateField(desc, raw, {}) !== null) continue
    values[name] = desc.kind === 'date' ? raw : Number(raw)
  }
  return Object.keys(values).length > 0 ? values : null
}
