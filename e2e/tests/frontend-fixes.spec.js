/**
 * Regression specs for the frontend hardening fixes (docs/audit/FINDINGS.md):
 *   AUD-10  30s fetch timeout → clear error state (stalled API spun forever)
 *   WP-7a   session-cached static GETs are signal-free: unmounting a consumer
 *           mid-fetch must NOT abort the shared request (StrictMode double-
 *           mount / navigate-away poisoned the cache → eternal skeleton)
 *   AUD-24a empty top_price_factors → explicit "explanation unavailable" note
 *   AUD-24b factor names wrap at 390px instead of CSS-ellipsis truncation
 *   AUD-24c health pill shows a degraded state when models_loaded.* is false
 *   AUD-24d drift panel shows a low-sample note when drift.low_sample is true
 *   WP-7a   server 422 → per-field errors via ApiError.details (the client
 *           validation tier blocks out-of-range submits before the API, so
 *           this path is only reachable with a mocked 422)
 *
 * All API traffic is intercepted (page.route), so these tests are independent
 * of the live backend and of the suite's backend-killing scenarios.
 *
 * WP-7a rebuild updates (2026-08-08): valuation moved / → /valuation; the
 * drift panel moved /model-insights → /health; the comps failure now renders
 * the ErrorState "Comparable sales unavailable"; the old AUD-10 "unmount
 * aborts the in-flight clusters request" assertion tested the very behavior
 * WP-7a removed — its replacement proves the shared request survives.
 */
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const EVIDENCE = fileURLToPath(new URL('../../docs/audit/evidence/', import.meta.url))

/** Minimal but complete PredictResponse-shaped fixture (values are test data). */
const PREDICT_BASE = {
  estimated_price: 185400,
  price_range: { low: 161200, high: 209900 },
  sale_probability: { probability: 0.312, sells_within_30_days: true, threshold: 0.203292 },
  micro_market: {
    cluster_id: 2,
    label: 'test micro-market',
    median_price: 179900,
    median_price_per_sqft: 119.4,
    sale_velocity_30d: 0.278,
    n_sales: 214,
    n_neighborhoods: 1,
    fallback: false,
    neighborhoods: ['NAmes'],
    note: '',
  },
  top_price_factors: [
    { feature: 'overall_qual', impact: 'positive', magnitude: 0.214 },
    { feature: 'gr_liv_area', impact: 'positive', magnitude: 0.183 },
    // Long name: this is the one that ellipsized to "Neighborhood medi…" at 390px.
    { feature: 'neighborhood_median_price', impact: 'negative', magnitude: 0.122 },
    { feature: 'YearBuilt', impact: 'positive', magnitude: 0.095 },
    { feature: 'GarageCars', impact: 'positive', magnitude: 0.061 },
  ],
  model_version: { regression: 'ridge_v1', classification: 'random_forest_v1', feature_version: 'test-fixture' },
}

/** Minimal valid /market/clusters payload (2 micro-markets, 3 points). */
const CLUSTERS_FIXTURE = {
  n_clusters: 2,
  clusters: [
    {
      cluster_id: 0, label: 'test alpha', median_price: 180000, median_price_per_sqft: 120.5,
      n_sales: 300, n_neighborhoods: 2, sale_velocity_30d: 0.25,
      centroid_lat: 42.03, centroid_long: -93.62, neighborhoods: ['NAmes', 'OldTown'],
      note: 'Sale velocity is a simulated target (ADR-3).',
    },
    {
      cluster_id: 1, label: 'test beta', median_price: 250000, median_price_per_sqft: 150.2,
      n_sales: 200, n_neighborhoods: 1, sale_velocity_30d: 0.3,
      centroid_lat: 42.05, centroid_long: -93.6, neighborhoods: ['StoneBr'],
      note: 'Sale velocity is a simulated target (ADR-3).',
    },
  ],
  neighborhoods: [
    { neighborhood: 'NAmes', name: 'North Ames', lat: 42.04, long: -93.63, cluster_id: 0, fallback: false },
    { neighborhood: 'OldTown', name: 'Old Town', lat: 42.02, long: -93.61, cluster_id: 0, fallback: false },
    { neighborhood: 'StoneBr', name: 'Stone Brook', lat: 42.06, long: -93.64, cluster_id: 1, fallback: false },
  ],
}

const fulfillJson = (route, body) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

const submitDefaultForm = async (page) => {
  await page.goto('/valuation')
  await page.getByRole('button', { name: 'Estimate value' }).click()
}

test('AUD-24a: empty top_price_factors renders an explicit note, not a bare header', async ({ page }) => {
  await page.route('**/predict', (route) =>
    fulfillJson(route, { ...PREDICT_BASE, top_price_factors: [] }),
  )
  await submitDefaultForm(page)

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toBeVisible()
  await expect(rail.getByText('Why this value')).toBeVisible()
  await expect(rail.getByText(/Explanation unavailable for this estimate/)).toBeVisible()
  expect(await rail.locator('.factor-row').count()).toBe(0)
})

test('AUD-24b: factor names are not truncated at 390x844 (no ellipsis overflow)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/predict', (route) => fulfillJson(route, PREDICT_BASE))
  await submitDefaultForm(page)

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.factor-row')).toHaveCount(5)
  // Ellipsis truncation means content overflows the box (scrollWidth > clientWidth).
  const names = rail.locator('.factor-name')
  for (let i = 0; i < (await names.count()); i += 1) {
    const overflow = await names.nth(i).evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
  // The long name that used to truncate must render in full.
  await expect(rail.getByText('Neighborhood median price')).toBeVisible()

  // Evidence capture for docs/audit/fix-frontend.md (pin sticky elements for the stitch).
  await page.addStyleTag({
    content: '.sidebar, .topbar, .sticky-rail { position: static !important; }',
  })
  await page.screenshot({ path: `${EVIDENCE}fix-frontend-mobile-390.png`, fullPage: true })
})

test('AUD-24c: health pill shows a degraded state when a model is not loaded', async ({ page }) => {
  await page.route('**/health', (route) =>
    fulfillJson(route, { status: 'ok', models_loaded: { regression: false, classification: true } }),
  )
  await page.goto('/valuation')
  const pill = page.locator('.api-status--degraded').first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveText('API degraded')
})

test('AUD-24c control: fully loaded models still show API connected', async ({ page }) => {
  await page.route('**/health', (route) =>
    fulfillJson(route, { status: 'ok', models_loaded: { regression: true, classification: true } }),
  )
  await page.goto('/valuation')
  await expect(page.locator('.api-status--up').first()).toHaveText('API connected')
})

const METRICS_FIXTURE = {
  requests_total: 12,
  errors_total: 0,
  avg_latency_ms: 42.5,
  uptime_seconds: 3661,
  drift: {
    status: 'ok',
    drift_detected: true,
    n_predictions: 7,
    max_psi: 1.23,
    per_feature_psi: { GrLivArea: 1.23, OverallQual: 0.45 },
    warn_threshold: 0.1,
    psi_threshold: 0.2,
    drifted_features: ['GrLivArea', 'OverallQual'],
    retraining_recommended: false,
    timestamp: '2026-08-07T12:00:00Z',
  },
}

test('AUD-24d: drift panel shows the low-sample note when low_sample is true', async ({ page }) => {
  await page.route('**/metrics', (route) =>
    fulfillJson(route, { ...METRICS_FIXTURE, drift: { ...METRICS_FIXTURE.drift, low_sample: true } }),
  )
  await page.goto('/health')
  const drift = page.locator('section', {
    has: page.getByRole('heading', { name: 'Feature drift' }),
  })
  await expect(drift.getByText('Low sample')).toBeVisible()
  await expect(drift.getByText(/PSI indicative only/)).toBeVisible()
})

test('AUD-24d control: no low-sample note when the key is absent', async ({ page }) => {
  await page.route('**/metrics', (route) => fulfillJson(route, METRICS_FIXTURE))
  await page.goto('/health')
  const drift = page.locator('section', {
    has: page.getByRole('heading', { name: 'Feature drift' }),
  })
  // The report itself renders (proves the fixture loaded)…
  await expect(drift.getByText('Max PSI')).toBeVisible()
  // …but no low-sample badge.
  await expect(drift.getByText('Low sample')).toHaveCount(0)
})

test('AUD-10: a stalled API surfaces a timeout error instead of spinning forever', async ({ page }) => {
  test.setTimeout(120_000)
  await page.route('**/predict', async (route) => {
    // Outlive the client's 30s AbortSignal.timeout, then fulfill; if the client
    // already aborted (expected), the fulfill throws — swallowed below.
    await new Promise((resolve) => setTimeout(resolve, 35_000))
    try {
      await fulfillJson(route, PREDICT_BASE)
    } catch {
      /* request aborted by the client timeout — the expected path */
    }
  })
  await submitDefaultForm(page)

  const error = page.getByRole('alert').filter({ hasText: /timed out/ })
  await expect(error).toBeVisible({ timeout: 45_000 }) // client aborts at ~30s
  await expect(error).toContainText(/check your connection/i)
})

test('WP-7a: unmounting mid-fetch never aborts the shared static GET (signal-free cache)', async ({ page }) => {
  const pageErrors = []
  const failed = []
  let clusterRequests = 0
  page.on('pageerror', (err) => pageErrors.push(err))
  page.on('requestfailed', (req) => {
    if (req.url().includes('/market/clusters')) failed.push(req.failure()?.errorText)
  })
  page.on('request', (req) => {
    if (req.url().includes('/market/clusters')) clusterRequests += 1
  })
  // Gate the clusters response so the page unmounts while it is in flight.
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  await page.route('**/market/clusters', async (route) => {
    await gate
    await fulfillJson(route, CLUSTERS_FIXTURE)
  })

  await page.goto('/market')
  // Still gated: the map has not rendered (skeletons only).
  await expect(page.locator('.leaflet-container')).toHaveCount(0)

  // Navigate away while the shared request is in flight…
  await page.getByRole('link', { name: 'Valuation' }).click()
  await expect(page.getByRole('heading', { name: 'Value a property' })).toBeVisible()
  release() // …the fetch must survive the unmount (pre-fix it was aborted).
  await page.waitForTimeout(500)

  expect(failed).toEqual([]) // no ERR_ABORTED for the shared GET
  expect(pageErrors).toEqual([])

  // Back to the market page: served from the session cache — no second fetch,
  // no eternal skeleton (the WP-7a regression).
  await page.getByRole('link', { name: 'Market Intelligence' }).click()
  const markers = page.locator('.leaflet-marker-pane .leaflet-marker-icon')
  await expect(markers).toHaveCount(3)
  expect(clusterRequests).toBe(1)
  expect(pageErrors).toEqual([])
})

test('server 422 maps to the offending form field (mocked API validation error)', async ({ page }) => {
  await page.route('**/predict', (route) =>
    route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        detail: [
          {
            type: 'greater_than_equal',
            loc: ['body', 'gr_liv_area'],
            msg: 'Input should be greater than or equal to 300',
            input: '50',
          },
        ],
      }),
    }),
  )
  await submitDefaultForm(page)

  // The rail alert keeps its fixed copy…
  const railAlert = page
    .getByRole('alert')
    .filter({ hasText: 'The API rejected some fields' })
  await expect(railAlert).toBeVisible()
  // …the form summary names the field's label…
  const summary = page.getByRole('alert').filter({ hasText: 'Fix the highlighted fields' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Living area')
  // …and the API's verbatim message lands on the field itself.
  await expect(page.locator('#pf-gr_liv_area-error')).toHaveText(
    'Input should be greater than or equal to 300',
  )
  await expect(page.locator('#pf-gr_liv_area')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.band')).toHaveCount(0)
})

test('comps failure degrades to an inline error; the valuation panels are unaffected', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err))
  await page.route('**/predict', (route) => fulfillJson(route, PREDICT_BASE))
  await page.route('**/market/comps', (route) => route.abort()) // simulate API-down for comps
  await submitDefaultForm(page)

  // The valuation result renders fully from the (successful) /predict…
  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText('$185,400')
  // …and the comps panel shows its documented inline error state with retry.
  const comps = page.locator('.panel', {
    has: page.getByText('Comparable sales', { exact: true }),
  })
  await expect(comps.getByText('Comparable sales unavailable')).toBeVisible()
  await expect(comps.getByRole('button', { name: 'Try again' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
