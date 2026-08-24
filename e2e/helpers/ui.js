/**
 * Shared UI helpers for the E2E specs: the valuation-form fill and the
 * sticky-chrome pin used before stitched full-page screenshots.
 */

/**
 * The valuation form's fixed label → payload-key list, in form order.
 * `select` marks the two dropdowns; `exact` disambiguates labels that
 * substring-collide ("Full baths" vs "Basement full baths", "Fireplaces").
 */
const FIELDS = [
  { key: 'neighborhood', label: 'Neighborhood', select: true },
  { key: 'house_style', label: 'House style', select: true },
  { key: 'bedrooms', label: 'Bedrooms' },
  { key: 'full_bath', label: 'Full baths', exact: true },
  { key: 'half_bath', label: 'Half baths', exact: true },
  { key: 'bsmt_full_bath', label: 'Basement full baths' },
  { key: 'bsmt_half_bath', label: 'Basement half baths' },
  { key: 'gr_liv_area', label: 'Living area (sq ft)' },
  { key: 'lot_area', label: 'Lot area (sq ft)' },
  { key: 'total_bsmt_sf', label: 'Basement area (sq ft)' },
  { key: 'year_built', label: 'Year built' },
  { key: 'overall_qual', label: /Overall quality/ },
  { key: 'overall_cond', label: /Overall condition/ },
  { key: 'garage_cars', label: 'Garage (cars)' },
  { key: 'fireplaces', label: 'Fireplaces', exact: true },
]

/**
 * Fill the valuation form from `values`, touching only the controls whose key
 * is present. Callers choose their field set: dashboard's pinned 14-field
 * payload omits `bsmt_half_bath` (docs/audit/docs-truth.md:115 pins its exact
 * prediction); audit-blackbox passes all 15.
 */
export async function fillValuationForm(page, values) {
  for (const field of FIELDS) {
    if (!(field.key in values)) continue
    const locator = page.getByLabel(field.label, field.exact ? { exact: true } : {})
    if (field.select) {
      await locator.selectOption(String(values[field.key]))
    } else {
      await locator.fill(String(values[field.key]))
    }
  }
}

/** Pin fixed/sticky chrome for stitched full-page captures (cosmetic only). */
export async function pinChromeForShot(page) {
  await page.addStyleTag({
    content: '.pipeline-sidebar, .predict-result { position: static !important; }',
  })
}
