/** Display formatting helpers — pure presentation, no data logic. */

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** $285,000 */
export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return usd.format(Number(value))
}

/** 0.783 → "78.3%" */
export function formatPct(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${(Number(value) * 100).toFixed(digits)}%`
}

/** 1450 → "1,450", 145.2 → "145.2" — grouped number, no unit (callers append it). */
export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })
}

/** 1965 → "1965" — years are never thousands-grouped (WP-7c). */
export function formatYear(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return String(Math.trunc(Number(value)))
}

/**
 * API honesty notes arrive verbatim and can carry raw schema identifiers —
 * rephrase those into plain English for consumer surfaces (WP-7c). The note's
 * meaning is kept faithful; only the identifier tokens are reworded.
 * "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with
 * sells_within_30_days==1." → "30-day sale velocity is the fraction of this
 * cluster's training-split sales selling within 30 days."
 */
export function humanizeNote(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/sells_within_30_days\s*==\s*1/g, 'selling within 30 days')
    .replace(/sale_velocity_30d/g, '30-day sale velocity')
    .replace(/sells_within_30_days/g, 'sale within 30 days')
    .replace(/TRAIN-split/g, 'training-split')
}

/** 3721.4 s → "1h 2m" uptime */
export function formatUptime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '—'
  const s = Math.floor(Number(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

/** ISO timestamp → "Aug 7, 2026, 10:38" (local time). */
export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

/** 0.118689 → "0.119"; non-finite → '—'. For metric tables. */
export function formatMetric(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  return Number(value).toFixed(digits)
}

/** "property_age" / "1stFlrSF" → readable labels for charts and factor lists. */
const KNOWN_LABELS = {
  total_sf: 'Total floor area',
  property_age: 'Property age',
  years_since_remod: 'Years since remodel',
  total_bath: 'Total bathrooms',
  living_area_per_bedroom: 'Living area / bedroom',
  bathroom_bedroom_ratio: 'Bath / bedroom ratio',
  amenity_count: 'Amenity count',
  distance_to_city_center_km: 'Distance to city center',
  neighborhood_median_price: 'Neighborhood median price',
  neighborhood_mean_price: 'Neighborhood mean price',
  neighborhood_median_price_per_sqft: 'Neighborhood $/sqft',
  sale_year: 'Sale year',
  sale_month: 'Sale month',
  sale_quarter: 'Sale quarter',
  // CamelCase model-feature names as returned by SHAP (`top_price_factors`,
  // `/model/importance`) — SPEC §5.2.4.
  OverallQual: 'Overall quality',
  OverallCond: 'Overall condition',
  GrLivArea: 'Living area',
  '1stFlrSF': 'First-floor area',
  '2ndFlrSF': 'Second-floor area',
  TotalBsmtSF: 'Basement area',
  BsmtFinSF1: 'Finished basement area',
  HeatingQC: 'Heating quality',
  Neighborhood: 'Neighborhood',
  GarageCars: 'Garage capacity',
  YearBuilt: 'Year built',
  LotArea: 'Lot area',
  KitchenQual: 'Kitchen quality',
}

export function prettyFeature(name) {
  if (!name) return '—'
  // Object.hasOwn: a bare lookup would also match Object.prototype keys
  // (e.g. "toString") and return a function, crashing the render.
  if (Object.hasOwn(KNOWN_LABELS, name)) return KNOWN_LABELS[name]
  // snake_case → Title Case; keep CamelCase model features readable.
  const spaced = String(name)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Numeric guard shared by the data surfaces — accepts numeric strings. */
export const isFiniteValue = (value) => Number.isFinite(Number(value))

/**
 * `/model/importance` payload → [name, value] pairs sorted by influence
 * (mean |SHAP|) descending; non-finite values are dropped.
 */
export function sortedImportanceEntries(importance) {
  return Object.entries(importance ?? {})
    .filter(([, v]) => Number.isFinite(Number(v)))
    .sort((a, b) => b[1] - a[1])
}

/** `${name}_${version}` for a champion entry, or null when the shape drifts. */
export function championTag(engine) {
  if (engine && typeof engine.name === 'string' && typeof engine.version === 'string') {
    return `${engine.name}_${engine.version}`
  }
  return null
}

/** Dataset meta line: "my-houses.csv · 1,230 rows". */
export function datasetRowsMeta(dataset) {
  return `${dataset.name} · ${formatNumber(dataset.n_rows, 0)} rows`
}

/** Dataset display name with the source suffix used by the stage meta lines. */
export function datasetMetaName(dataset) {
  return `${dataset.name}${dataset.source === 'bundled' ? (dataset.name.endsWith('(bundled)') ? '' : ' (bundled default)') : ' (uploaded)'}`
}

/** Number(value) when finite, else the fallback — for contract fields that
    should be numeric but might arrive missing or malformed. */
export const finiteOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/** PSI severity vs the snapshot's own thresholds: 'bad' at drift, 'warn' at
    warn, '' below (no invented states). */
export function psiLevel(psi, warnThreshold, driftThreshold) {
  if (!Number.isFinite(psi)) return ''
  if (psi >= driftThreshold) return 'bad'
  if (psi >= warnThreshold) return 'warn'
  return ''
}

/** Threshold-colored metric tone: danger at drift, warn at warn. */
export function psiTone(psi, warnThreshold, driftThreshold) {
  const level = psiLevel(psi, warnThreshold, driftThreshold)
  return level ? ` metric-value--${level}` : ''
}
