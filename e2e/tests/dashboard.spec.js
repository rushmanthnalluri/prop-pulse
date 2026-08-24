/**
 * PropPulse dashboard E2E (real Chromium, live backend :8200 + frontend :5300).
 *
 * Design-system rebuild reconciliation (2026-08-09): the suite was re-anchored
 * to the rebuilt UI —
 *   - Overview (/) is the reference home: h1 "PropPulse", 8-cell
 *     `.metrics.metrics-rows`, top-5 `.driver-row`, `.group-index` record
 *     tiles, and the 9-row `.pipeline-list` (the old hero h1, `.metrics--6`
 *     ×6, 8 driver rows, and 4 `.cluster-card`s are gone)
 *   - Valuation (/valuation): the probability gauge was deleted with
 *     ProbabilityGauge.jsx — the result panel now carries the 8px
 *     `.result-track` (role=meter) + `.result-meta` ("{p}% probability" /
 *     "threshold {t}%"); `.result-price`, `.band`, `.mm-label`,
 *     `.factor-list .factor-row`, `form.valuation-form`, "Estimate value"
 *     survive
 *   - the client/server validation summary reads "Check the highlighted
 *     inputs" (was "Fix the highlighted fields")
 *   - /market h1 is "Micro-markets across Ames"; the trends section is
 *     "Trends — median sale price by half-year"
 *   - document.title follows "{Page} · PropPulse" everywhere
 *   - the shell chrome is `.pipeline-sidebar` + `.predict-result` sticky
 *     aside (`.sidebar`/`.topbar`/`.sticky-rail` are gone)
 * WP-7a history: routes /model-insights → /model, /market-map → /market, the
 * valuation form moved / → /valuation; out-of-range core inputs are caught by
 * client-side validation (formConfig.validateField) — the server-422 →
 * field-mapping path is covered mocked in frontend-fixes.spec.js.
 *
 * Scenario order matters — tests run sequentially (workers: 1):
 *   1. overview loads (hero, 8 headline metrics, driver rows, pipeline list)
 *   2. valuation flow (happy path, exactly 5 top factors)
 *   3. valuation result extras (confidence badge, price position strip,
 *      comparable-sales panel, what-if scenario explorer + reset)
 *   4. pinned-estimate comparison (pin → zero delta → cheaper re-estimate →
 *      negative signed delta → remove)
 *   5. pinned estimate persists across reload (localStorage) and compares
 *      against the next estimate
 *   6. prefill flow (?neighborhood= pre-selects the form's neighborhood)
 *   7. client validation (out-of-range living area names the field, no result)
 *   8. market page (leaflet markers, popup cluster stats, directory, trends)
 *   9. model insights (champions, decision threshold, drivers ledger, CMs)
 *   10. model health (service status, traffic counters, drift sections)
 *   11. 404 page (unknown URL → designed not-found + recovery links)
 *   12. API-down state (LAST — stops the backend on port 8200 itself)
 *
 * Portfolio screenshots land in docs/screenshots/ (full page, 1440x900).
 */
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { ensureBackend, killPort, BACKEND_PORT } from '../helpers/backend.js'
import { fillValuationForm, pinChromeForShot } from '../helpers/ui.js'

const SCREENSHOTS = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url))
const shot = async (page, name) => {
  // Full-page captures stitch scroll positions, which makes the sticky sidebar
  // and sticky result rail float mid-page — pin them for the shot only.
  await pinChromeForShot(page)
  await page.screenshot({ path: `${SCREENSHOTS}${name}.png`, fullPage: true })
}

/**
 * The realistic, in-range property filled by the shared form fill. 14 fields —
 * no `bsmt_half_bath`: docs/audit/docs-truth.md:115 pins the exact prediction
 * from this payload.
 */
const PROPERTY = {
  neighborhood: 'NridgHt', house_style: '2Story', bedrooms: 4, full_bath: 2, half_bath: 1,
  bsmt_full_bath: 1, gr_liv_area: 2200, lot_area: 11000, total_bsmt_sf: 1200,
  year_built: 2003, overall_qual: 8, overall_cond: 5, garage_cars: 2, fireplaces: 1,
}

// Self-heal: this spec's tests read live API data and it runs right after the
// audit-blackbox spec (whose LAST test kills + respawns :8200). Guard so a
// stale down-backend can never cascade the dashboard specs.
test.beforeAll(async () => {
  await ensureBackend()
})

test('overview loads: hero, 8 headline metrics, driver rows, pipeline list', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Overview · PropPulse')
  await expect(page.getByRole('heading', { name: 'PropPulse', exact: true })).toBeVisible()
  // Sidebar health pill resolves once GET /health succeeds.
  await expect(page.locator('.api-status--up').first()).toHaveText('API connected')

  // Hero CTAs into the pipeline + the data.
  await expect(page.getByRole('link', { name: 'Start the pipeline' })).toHaveAttribute(
    'href',
    '/workflow/01-upload',
  )
  await expect(page.getByRole('link', { name: 'Explore the data' })).toHaveAttribute(
    'href',
    '/workflow/05-viz',
  )

  // Active-model panel names the served champion (GET /model/info).
  const activeModel = page.locator('.panel', { has: page.getByText('Active model') })
  await expect(activeModel).toContainText('ridge_v1')

  // Headline metric strip: 8 cells from /market/clusters + /market/trends +
  // /model/info (two rows of four).
  const metrics = page.locator('.metrics.metrics-rows .metric')
  await expect(metrics).toHaveCount(8)
  const metric = (label) =>
    page.locator('.metrics.metrics-rows .metric', {
      has: page.locator('.metric-label', { hasText: label }),
    })
  await expect(metric('Training sales').locator('.metric-value')).toHaveText('945')
  await expect(metric('Neighborhoods').locator('.metric-value')).toHaveText('25')
  await expect(metric('Micro-markets').locator('.metric-value')).toHaveText('4')
  await expect(metric('Model features').locator('.metric-value')).toHaveText('94')

  // Top value drivers (GET /model/importance) — top-5 slice on Overview.
  const drivers = page.locator('.driver-row')
  await expect(drivers.first()).toBeVisible({ timeout: 60_000 })
  expect(await drivers.count()).toBe(5)

  // The record tiles (8 domain groups) link into stage 02.
  expect(await page.locator('.group-index .group-cell').count()).toBe(8)

  // The pipeline roadmap lists the nine live stages into /workflow/*.
  const stages = page.locator('.pipeline-list .pipeline-row')
  await expect(stages).toHaveCount(9)
  await expect(stages.first()).toHaveAttribute('href', '/workflow/01-upload')
})

test('valuation flow: form → price, range, probability, micro-market, 5 factors', async ({ page }) => {
  await page.goto('/valuation')
  await expect(page).toHaveTitle('Valuation · PropPulse')
  await expect(page.getByRole('heading', { name: 'Value a property' })).toBeVisible()
  // Idle result panel before any submission (the "—" placeholder verdict).
  await expect(
    page.getByText(/Submit the form to see the estimate/),
  ).toBeVisible()
  await shot(page, 'home-empty')

  await fillValuationForm(page, PROPERTY)
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const rail = page.locator('.valuation-rail')
  // Estimated price renders as a dollar figure like $236,950.
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 }) // first /predict pays SHAP warm-up

  // ~80% range band with low/estimate/high dollar bounds.
  await expect(rail.locator('.band')).toBeVisible()
  const bandScale = await rail.locator('.band-scale').innerText()
  expect(bandScale.match(/\$[\d,]+/g)?.length ?? 0).toBeGreaterThanOrEqual(2)

  // 30-day sale probability renders on the result track with its served
  // threshold (the gauge is gone — the panel carries the meter now).
  const track = rail.locator('.result-track')
  await expect(track).toBeVisible()
  await expect(track).toHaveAttribute('role', 'meter')
  await expect(rail.locator('.result-meta')).toContainText(/\d+(\.\d+)?% probability/)
  await expect(rail.locator('.result-meta')).toContainText(/threshold \d+(\.\d+)?%/)

  // Micro-market label is non-empty.
  const label = (await rail.locator('.mm-label').innerText()).trim()
  expect(label.length).toBeGreaterThan(0)

  // Exactly 5 top price factors render.
  await expect(rail.locator('.factor-list .factor-row')).toHaveCount(5)

  await shot(page, 'valuation-result')
})

test('valuation result: confidence badge, price position, comps, scenario explorer', async ({ page }) => {
  await page.goto('/valuation')
  await fillValuationForm(page, PROPERTY)
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
  // Keyboard, not pointer: the estimate panel sticks at top:24px and the rail
  // scrolls beneath it by design — a pointer click can land in the covered
  // band when scrollIntoView aligns the button to the viewport top.
  await scenarios.getByRole('button', { name: 'Reset scenarios' }).press('Enter')
  await expect(scenarios.locator('dl.kv')).toHaveCount(0)
})

test('pinned estimate: pin, zero delta, cheaper re-estimate shows negative delta, remove', async ({ page }) => {
  await page.goto('/valuation')
  await fillValuationForm(page, PROPERTY)
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 })

  // Nothing pinned yet: the quiet affordance renders, no comparison panel.
  await expect(page.locator('.compare-panel')).toHaveCount(0)
  // Rail buttons are keyboard-pressed (same sticky-estimate overlay as above).
  await page.getByRole('button', { name: 'Pin this estimate' }).press('Enter')

  const compare = page.locator('.compare-panel')
  await expect(compare).toBeVisible()
  // The pinned snapshot names the stored property (real payload fields).
  await expect(compare).toContainText('Northridge Heights')
  await expect(compare).toContainText('2,200 sq ft')
  await expect(compare).toContainText('built 2003')
  // Pinned against itself: a zero delta, never a fabricated one.
  await expect(compare.locator('.compare-delta')).toHaveText('+$0 (+0.0%)')

  // A cheaper profile (overall quality 8 → 6) re-scores lower: signed delta.
  // Form-scoped: the scenario lever shares the accessible name once a result
  // is on screen (strict-mode).
  const qualityInput = page
    .locator('form.valuation-form')
    .getByLabel('Overall quality', { exact: true })
  await qualityInput.fill('6')
  await page.getByRole('button', { name: 'Estimate value' }).click()
  await expect(compare.locator('.compare-delta')).toHaveText(/−\$[\d,]+ \(−[\d.]+%\)/, {
    timeout: 60_000,
  })

  // Remove the pin → panel gone, the affordance returns.
  await page.getByRole('button', { name: 'Remove pin' }).press('Enter')
  await expect(page.locator('.compare-panel')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pin this estimate' })).toBeVisible()
})

test('pinned estimate persists across reload and compares against the next estimate', async ({ page }) => {
  await page.goto('/valuation')
  await fillValuationForm(page, PROPERTY)
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 })
  await page.getByRole('button', { name: 'Pin this estimate' }).press('Enter')
  await expect(page.locator('.compare-panel')).toBeVisible()

  // Reload: the stored pin survives (localStorage proppulse:pinned-estimate);
  // the result does not — a fresh load waits for the next submit (§5.2.2).
  await page.reload()
  await expect(page.locator('.compare-panel')).toHaveCount(0)

  // The URL mirror re-prefills the form; switch neighborhood + quality so the
  // next estimate genuinely differs from the pinned one.
  await page.getByLabel('Neighborhood').selectOption('OldTown')
  await page
    .locator('form.valuation-form')
    .getByLabel('Overall quality', { exact: true })
    .fill('5')
  await page.getByRole('button', { name: 'Estimate value' }).click()
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 })

  const compare = page.locator('.compare-panel')
  await expect(compare).toBeVisible()
  // The pinned side still names the stored property — not the current one.
  await expect(compare).toContainText('Northridge Heights')
  await expect(compare.locator('.compare-delta')).toHaveText(/[+−]\$[\d,]+ \([+−][\d.]+%\)/)
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

  const summary = page.getByRole('alert').filter({ hasText: 'Check the highlighted inputs' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Living area')
  await expect(page.locator('#pf-gr_liv_area-error')).toContainText(
    'Must be between 300 and 6,000',
  )
  // No request succeeded — the idle panel is still up, no range band exists.
  await expect(page.locator('.band')).toHaveCount(0)

  await shot(page, 'error-state')
})

test('market page: leaflet markers, popup cluster stats, directory, trends', async ({ page }) => {
  await page.goto('/market')
  await expect(page).toHaveTitle('Market Intelligence · PropPulse')
  await expect(
    page.getByRole('heading', { name: 'Micro-markets across Ames' }),
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
  await expect(popup.getByRole('link', { name: 'Estimate value' })).toHaveAttribute(
    'href',
    /^\/valuation\?neighborhood=[A-Za-z]+$/,
  )

  // Neighborhood directory: one sortable row per neighborhood (25).
  await expect(page.locator('.market-directory table tbody tr')).toHaveCount(25)

  // Market trends section (GET /market/trends): one line per micro-market.
  await expect(
    page.locator('.market-trends').getByRole('heading', {
      name: 'Trends — median sale price by half-year',
    }),
  ).toBeVisible()
  const trendLines = page.locator('.market-trends .recharts-line')
  await expect(trendLines.first()).toBeVisible({ timeout: 60_000 })
  expect(await trendLines.count()).toBeGreaterThanOrEqual(2) // 4 clusters today

  // Give map tiles a moment so the portfolio screenshot shows the basemap.
  await page.waitForTimeout(2500)
  await shot(page, 'market-map')
})

test('model insights: champions, decision threshold, >=10 driver rows, matrices', async ({ page }) => {
  await page.goto('/model')
  await expect(page).toHaveTitle('Model Insights · PropPulse')
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
  await expect(page).toHaveTitle('Model Health · PropPulse')
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

  // Feature drift: the PSI report panel, or the documented no_data empty
  // state ("Drift status — no_data" kicker + guidance).
  const drift = page.locator('section', {
    has: page.getByRole('heading', { name: 'Feature drift' }),
  })
  const hasReport = (await drift.locator('.panel', { hasText: 'Drift report' }).count()) > 0
  if (hasReport) {
    await expect(drift.getByText('Max PSI')).toBeVisible()
  } else {
    await expect(drift.getByText(/Drift status/)).toBeVisible()
    await expect(drift.getByText('No scored traffic in the drift window yet')).toBeVisible()
  }

  // Prediction drift section renders its own state.
  await expect(page.getByRole('heading', { name: 'Prediction drift' })).toBeVisible()
})

test('404 page: unknown URL renders the designed not-found with recovery links', async ({ page }) => {
  await page.goto('/definitely-not-a-page')
  await expect(page).toHaveTitle('404 · PropPulse')
  await expect(page.getByText('Error 404')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  // Both recovery links are real routes; the primary navigates back to /.
  await expect(page.getByRole('link', { name: 'Go to Upload' })).toHaveAttribute(
    'href',
    '/workflow/01-upload',
  )
  await page.getByRole('link', { name: 'Back to overview' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'PropPulse', exact: true })).toBeVisible()
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

  // Scoped to main — the same copy also lands in the error toast (Notifications).
  const error = page
    .locator('main')
    .getByRole('alert')
    .filter({ hasText: 'Cannot reach the PropPulse API' })
  await expect(error).toBeVisible()
  expect(killed).toBe(true) // prove the test really stopped the backend
})
