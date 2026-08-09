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

/** 145.2 → "$145/sqft"-style compact number with unit */
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
  if (seconds === null || seconds === undefined) return '—'
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

/** "overall_qual" / "1stFlrSF" → readable labels for charts and factor lists. */
const KNOWN_LABELS = {
  overall_qual: 'Overall quality',
  overall_cond: 'Overall condition',
  gr_liv_area: 'Living area',
  total_bsmt_sf: 'Basement area',
  total_sf: 'Total floor area',
  lot_area: 'Lot area',
  lot_frontage: 'Lot frontage',
  year_built: 'Year built',
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
  neighborhood_sale_velocity_30d: 'Neighborhood sale velocity',
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
  if (KNOWN_LABELS[name]) return KNOWN_LABELS[name]
  // snake_case → Title Case; keep CamelCase model features readable.
  const spaced = String(name)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1$2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
