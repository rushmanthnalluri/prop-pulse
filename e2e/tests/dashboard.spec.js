/**
 * PropPulse dashboard E2E (real Chromium, live backend :8200 + frontend :5300).
 *
 * WP-7a (2026-08-08): rewritten for the rebuilt UI. Stale anchors replaced:
 *   - routes: /model-insights → /model, /market-map → /market, the valuation
 *     form moved / → /valuation ("/" is now the Overview page)
 *   - headings: "Property valuation" → "Value a property", "Market map" →
 *     "Four micro-markets, twenty-five neighborhoods", "Model insights" →
 *     "Can you trust the numbers?"
 *   - result column: .result-card is gone — the sticky .valuation-rail stacks
 *     panels (ResultHero .result-price + .band, ProbabilityGauge .gauge,
 *     MicroMarketCard .mm-label, MarketPosition .position-marker,
 *     FactorBars .factor-row, CompsTable .table, ScenarioExplorer)
 *   - "Explore scenarios" → "What-if scenarios" with 7 #lever-<name> sliders
 *   - the drift panel moved to /health; /model carries champions + drivers
 *   - out-of-range core inputs are now caught by client-side validation
 *     (formConfig.validateField), so the old "API 422 surfaces in the UI"
 *     scenario became a client-validation scenario here; the server-422 →
 *     field-mapping path is covered mocked in frontend-fixes.spec.js.
 *
 * Scenario order matters — tests run sequentially (workers: 1):
 *   1. overview loads (hero, 6 headline metrics, driver rows, market cards)
 *   2. valuation flow (happy path, exactly 5 top factors)
 *   3. valuation result extras (confidence badge, price position strip,
 *      comparable-sales panel, what-if scenario explorer + reset)
 *   4. prefill flow (?neighborhood= pre-selects the form's neighborhood)
 *   5. client validation (out-of-range living area names the field, no result)
 *   6. market page (leaflet markers, popup cluster stats, directory, trends)
 *   7. model insights (champions, decision threshold, drivers ledger, CMs)
 *   8. model health (service status, traffic counters, drift sections)
 *   9. API-down state (LAST — stops the backend on port 8200 itself)
 *
 * Portfolio screenshots land in docs/screenshots/ (full page, 1440x900).
 */
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** E2E-owned backend port (started externally; the LAST scenario kills it). */
const BACKEND_PORT = 8200

const SCREENSHOTS = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url))
const shot = async (page, name) => {
  // Full-page captures stitch scroll positions, which makes the fixed sidebar,
  // topbar, and sticky result rail float mid-page — pin them for the shot only.
  await page.addStyleTag({
    content: '.sidebar, .topbar, .sticky-rail { position: static !important; }',
  })
  await page.screenshot({ path: `${SCREENSHOTS}${name}.png`, fullPage: true })
}

/** Fill the core valuation form with a realistic, in-range property. */
async function fillValuationForm(page) {
  await page.getByLabel('Neighborhood').selectOption('NridgHt')
  await page.getByLabel('House style').selectOption('2Story')
  await page.getByLabel('Bedrooms').fill('4')
  await page.getByLabel('Full baths', { exact: true }).fill('2')
  await page.getByLabel('Half baths', { exact: true }).fill('1')
  await page.getByLabel('Basement full baths').fill('1')
  await page.getByLabel('Living area (sq ft)').fill('2200')
  await page.getByLabel('Lot area (sq ft)').fill('11000')
  await page.getByLabel('Basement area (sq ft)').fill('1200')
  await page.getByLabel('Year built').fill('2003')
  await page.getByLabel(/Overall quality/).fill('8')
  await page.getByLabel(/Overall condition/).fill('5')
  await page.getByLabel('Garage (cars)').fill('2')
  await page.getByLabel('Fireplaces', { exact: true }).fill('1')
}

/** Force-stop whatever process is LISTENING on the given TCP port (Windows). */
function killPort(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], (err, stdout) => {
      if (err) return resolve(false)
      const pids = new Set(
        String(stdout)
          .split(/\r?\n/)
          .filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'))
          .map((line) => line.trim().split(/\s+/).pop())
          .filter(Boolean),
      )
      if (pids.size === 0) return resolve(false)
      let pending = pids.size
      for (const pid of pids) {
        execFile('taskkill', ['/PID', pid, '/F'], () => {
          if (--pending === 0) resolve(true)
        })
      }
    })
  })
}

test('overview loads: hero, 6 headline metrics, driver rows, micro-market cards', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Know what an Ames home is worth — and why.' }),
  ).toBeVisible()
  // Sidebar health pill resolves once GET /health succeeds.
  await expect(page.locator('.api-status--up').first()).toHaveText('API connected')

  // Headline metric strip (GET /model/info + /market/clusters).
  const metricValues = page.locator('.metrics--6 .metric-value')
  await expect(metricValues).toHaveCount(6)
  await expect(page.locator('.metrics--6 .metric', { hasText: 'Neighborhoods' })).toContainText(
    '25',
  )
  await expect(page.locator('.metrics--6 .metric', { hasText: 'Micro-markets' })).toContainText(
    '4',
  )

  // Top value drivers (GET /model/importance) — top-8 slice on Overview.
  const drivers = page.locator('.driver-row')
  await expect(drivers.first()).toBeVisible({ timeout: 60_000 })
  expect(await drivers.count()).toBe(8)

  // Four micro-market cards link to /market.
  await expect(page.locator('.cluster-card')).toHaveCount(4)
})

test('valuation flow: form → price, range, probability, micro-market, 5 factors', async ({ page }) => {
  await page.goto('/valuation')
  await expect(page.getByRole('heading', { name: 'Value a property' })).toBeVisible()
  // Empty hero before any submission (the "—" placeholder price).
  await expect(
    page.getByText(/Submit the form to see the estimate/),
  ).toBeVisible()
  await shot(page, 'home-empty')

  await fillValuationForm(page)
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const rail = page.locator('.valuation-rail')
  // Estimated price renders as a dollar figure like $236,950.
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 }) // first /predict pays SHAP warm-up

  // ~80% range band with low/estimate/high dollar bounds.
  await expect(rail.locator('.band')).toBeVisible()
  const bandScale = await rail.locator('.band-scale').innerText()
  expect(bandScale.match(/\$[\d,]+/g)?.length ?? 0).toBeGreaterThanOrEqual(2)

  // 30-day sale probability renders as a percentage on the gauge.
  await expect(rail.locator('.gauge')).toBeVisible()
  await expect(rail.locator('.gauge-meta')).toContainText(/\d+(\.\d+)?% within 30 days/)

  // Micro-market label is non-empty.
  const label = (await rail.locator('.mm-label').innerText()).trim()
  expect(label.length).toBeGreaterThan(0)

  // Exactly 5 top price factors render.
  await expect(rail.locator('.factor-list .factor-row')).toHaveCount(5)

  await shot(page, 'valuation-result')
})

test('valuation result: confidence badge, price position, comps, scenario explorer', async ({ page }) => {
  await page.goto('/valuation')
  await fillValuationForm(page)
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 })

  // Per-prediction confidence trust badge (typical or reduced — API-decided).
  await expect(rail.locator('.hero-confidence .badge')).toHaveText(/confidence/i)

  // Price position strip: subject vs neighborhood vs micro-market $/sqft.
  await expect(rail.locator('.position-marker')).toHaveCount(3)

  // Comparable sales panel (POST /market/comps): 5 rows + scope line,
  // percentile line, and the historical-data honesty note.
  const comps = page.locator('.panel', {
    has: page.getByText('Comparable sales', { exact: true }),
  })
  await expect(comps.locator('.table tbody tr')).toHaveCount(5)
  await expect(comps).toContainText('5 similar sales in')
  await expect(comps).toContainText(/Priced above .* comparable training sales/)
  await expect(comps).toContainText(/training data/)

  // What-if scenario explorer: 7 levers; moving one re-scores via
  // /predict/price and shows a signed delta line; Reset clears it.
  const scenarios = page.locator('.panel', {
    has: page.getByText('What-if scenarios'),
  })
  await expect(scenarios.locator('input[type=range]')).toHaveCount(7)
  const qualSlider = scenarios.locator('#lever-overall_qual')
  await qualSlider.focus()
  await qualSlider.press('ArrowUp') // 8 → 9
  const deltaList = scenarios.locator('dl.kv')
  await expect(deltaList).toHaveCount(1)
  await expect(deltaList.locator('dt')).toContainText('Overall quality 8 → 9')
  await expect(deltaList.locator('dd')).toHaveText(/[+−]\$[\d,]+/, { timeout: 60_000 })
  await scenarios.getByRole('button', { name: 'Reset scenarios' }).click()
  await expect(scenarios.locator('dl.kv')).toHaveCount(0)
})

test('prefill flow: /valuation?neighborhood=StoneBr pre-selects StoneBr in the form', async ({ page }) => {
  const form = page.locator('form.valuation-form')
  // StoneBr is NOT the form default (NAmes), so a match proves the prefill worked.
  await page.goto('/valuation?neighborhood=StoneBr')
  await expect(page.getByRole('heading', { name: 'Value a property' })).toBeVisible()
  await expect(form.getByLabel('Neighborhood')).toHaveValue('StoneBr')
  // An unknown code is ignored: the form falls back to its default (NAmes).
  await page.goto('/valuation?neighborhood=NoSuchHood')
  await expect(form.getByLabel('Neighborhood')).toHaveValue('NAmes')
})

test('client validation: out-of-range living area names the field, no result renders', async ({ page }) => {
  await page.goto('/valuation')
  // The form carries noValidate by design — PropPulse's own validation tier
  // (formConfig.validateField) runs on submit and blocks the API call.
  await page.getByLabel('Living area (sq ft)').fill('50')
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const summary = page.getByRole('alert').filter({ hasText: 'Fix the highlighted fields' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Living area')
  await expect(page.locator('#pf-gr_liv_area-error')).toContainText(
    'Must be between 300 and 6,000',
  )
  // No request succeeded — the empty hero is still up, no range band exists.
  await expect(page.locator('.band')).toHaveCount(0)

  await shot(page, 'error-state')
})

test('market page: leaflet markers, popup cluster stats, directory, trends', async ({ page }) => {
  await page.goto('/market')
  await expect(
    page.getByRole('heading', { name: 'Four micro-markets, twenty-five neighborhoods' }),
  ).toBeVisible()

  await expect(page.locator('.leaflet-container')).toBeVisible()
  // One keyboard-focusable divIcon marker per neighborhood (25).
  const markers = page.locator('.leaflet-marker-pane .leaflet-marker-icon')
  await expect(markers.first()).toBeVisible()
  expect(await markers.count()).toBeGreaterThanOrEqual(20)

  // Clicking a marker opens a popup with micro-market cluster stats.
  await markers.first().click({ force: true })
  const popup = page.locator('.leaflet-popup')
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('Micro-market')
  await expect(popup).toContainText(/\$[\d,]+/) // median price
  // Every 30-day velocity figure carries the simulated-target caveat caption.
  await expect(popup.locator('.velocity-note')).toBeVisible()
  // The popup links to the valuation form prefilled with this neighborhood.
  await expect(popup.getByRole('link', { name: 'Value a home here' })).toHaveAttribute(
    'href',
    /^\/valuation\?neighborhood=[A-Za-z]+$/,
  )

  // Neighborhood directory: one sortable row per neighborhood (25).
  await expect(page.locator('.market-directory table tbody tr')).toHaveCount(25)

  // Market trends section (GET /market/trends): one line per micro-market.
  await expect(page.locator('.market-trends .chart-title')).toHaveText(
    'Price trends by micro-market',
  )
  const trendLines = page.locator('.market-trends .recharts-line')
  await expect(trendLines.first()).toBeVisible({ timeout: 60_000 })
  expect(await trendLines.count()).toBeGreaterThanOrEqual(2) // 4 clusters today

  // Give OSM tiles a moment so the portfolio screenshot shows the basemap.
  await page.waitForTimeout(2500)
  await shot(page, 'market-map')
})

test('model insights: champions, decision threshold, >=10 driver rows, matrices', async ({ page }) => {
  await page.goto('/model')
  await expect(page.getByRole('heading', { name: 'Can you trust the numbers?' })).toBeVisible()

  // Champion cards name the served versions (mono tags in the panel titles).
  await expect(page.getByText('ridge_v1').first()).toBeVisible()
  await expect(page.getByText('random_forest_v1').first()).toBeVisible()

  // The classifier's operating threshold is disclosed verbatim.
  await expect(page.getByText(/Decision threshold/)).toBeVisible()

  // Global drivers ledger (GET /model/importance): top-20 slice.
  const drivers = page.locator('.driver-row')
  await expect(drivers.first()).toBeVisible({ timeout: 60_000 })
  expect(await drivers.count()).toBeGreaterThanOrEqual(10)

  // Validation + sealed-test confusion matrices render as accessible grids.
  expect(await page.locator('.cm-grid').count()).toBeGreaterThanOrEqual(2)

  // Standing disclosures: the simulated-target caveat is mandatory copy.
  await expect(page.getByText('Simulated classification target')).toBeVisible()

  await shot(page, 'model-insights')
})

test('model health: service status, traffic counters, drift sections', async ({ page }) => {
  await page.goto('/health')
  await expect(page.getByRole('heading', { name: 'Live service & drift' })).toBeVisible()

  // Service status (GET /health): API ok + both champions loaded + uptime.
  const service = page.locator('section', {
    has: page.getByRole('heading', { name: 'Service status' }),
  })
  await expect(
    service.locator('.metric', { hasText: 'API status' }).locator('.badge'),
  ).toHaveText('ok')
  await expect(service.locator('.badge', { hasText: 'Loaded' })).toHaveCount(2)
  await expect(service.locator('.metric', { hasText: 'Uptime' })).toBeVisible()

  // Live traffic (GET /metrics): per-process counters.
  const traffic = page.locator('section', {
    has: page.getByRole('heading', { name: 'Live traffic' }),
  })
  await expect(traffic.locator('.metric', { hasText: 'Requests' })).toBeVisible()
  await expect(traffic.locator('.metric', { hasText: 'Avg latency' })).toBeVisible()

  // Feature drift: the PSI report, or the documented no_data empty state —
  // "Drift status" is present either way (metric label vs empty-state kicker).
  const drift = page.locator('section', {
    has: page.getByRole('heading', { name: 'Feature drift' }),
  })
  await expect(drift.getByText(/Drift status/)).toBeVisible()
  const hasReport = (await drift.locator('.factor-row').count()) > 0
  if (!hasReport) {
    await expect(drift.getByText('No scored traffic in the drift window yet')).toBeVisible()
  }

  // Prediction drift section renders its own state.
  await expect(page.getByRole('heading', { name: 'Prediction drift' })).toBeVisible()
})

test('API-down state: valuation submit shows a reachable error (LAST — stops backend)', async ({ page }) => {
  // This scenario intentionally kills the E2E backend on BACKEND_PORT
  // (exclusive to this suite) to verify the dashboard's degraded state.
  const killed = await killPort(BACKEND_PORT)
  // Give the OS a moment to release the socket.
  await page.waitForTimeout(1000)

  await page.goto('/valuation')
  // Sidebar health pill flips to offline once its /health poll fails.
  await expect(page.locator('.api-status--down').first()).toHaveText('API offline')
  await page.getByRole('button', { name: 'Estimate value' }).click() // default form is valid

  const error = page
    .getByRole('alert')
    .filter({ hasText: 'Cannot reach the PropPulse API' })
  await expect(error).toBeVisible()
  expect(killed).toBe(true) // prove the test really stopped the backend
})
