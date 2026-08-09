/**
 * Black-box audit spec (WP-7a rewrite for the rebuilt UI, 2026-08-08).
 *
 * Goes beyond dashboard.spec.js: extreme inputs, noise-fallback neighborhoods,
 * submit races, mid-load navigation, mobile viewport, reload, DOM↔API
 * trace-truth (the DOM must render exactly the intercepted /predict JSON —
 * the production format.js helpers are imported so "equal" means byte-equal),
 * and a full backend-down → "Try again" → restart → recovery cycle.
 *
 * Rebuilt-UI anchor changes vs the previous revision:
 *   - valuation lives at /valuation; the result is a .valuation-rail stack of
 *     panels (.result-price, .band/.band-scale, .gauge/.gauge-meta, .mm-label,
 *     .position-scale/.position-marker, .factor-row, .provenance)
 *   - factor magnitudes render as "↑ 21.4%" arrows (not "+21.4%" signs)
 *   - the nearest-cluster fallback badge reads "Nearest cluster"
 *   - the submit pipeline is abort-supersede: N rapid submits fire N requests
 *     but all but the last are cancelled client-side, so only ~1 response
 *     lands (the old "5 responses" assertion tested removed behavior)
 *   - a submitted payload is mirrored to the URL and localStorage: after a
 *     reload the form rehydrates from the URL params and the rail returns to
 *     the documented empty hero (the result itself is not persisted)
 *   - bedrooms=99 is now stopped by client-side validation (no API call); the
 *     server-422 → field mapping is covered mocked in frontend-fixes.spec.js
 *
 * Runs sequentially (workers: 1). The LAST test kills the backend on :8200
 * and re-spawns it detached, so a following full-suite run still works.
 * Evidence screenshots land in docs/audit/evidence/.
 */
import { test, expect } from '@playwright/test'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Production formatting code — used here ONLY to compare the rendered DOM
// against the intercepted API JSON with the exact same formatting rules.
import { formatUsd, formatPct, formatNumber, prettyFeature, humanizeNote } from '../../frontend/src/format.js'

/** E2E-owned ports (see e2e/playwright.config.js). */
const BACKEND_PORT = 8200
const FRONTEND_ORIGIN = 'http://localhost:5300'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const EVIDENCE = fileURLToPath(new URL('../../docs/audit/evidence/', import.meta.url))
const GARBAGE = /\bNaN\b|\bundefined\b|\bnull\b/
const fin = (value) => Number.isFinite(Number(value))

/** Fill the 15 core controls with an explicit, in-range property. */
async function fillCore(page, v) {
  await page.getByLabel('Neighborhood').selectOption(v.neighborhood)
  await page.getByLabel('House style').selectOption(v.house_style)
  await page.getByLabel('Bedrooms').fill(String(v.bedrooms))
  await page.getByLabel('Full baths', { exact: true }).fill(String(v.full_bath))
  await page.getByLabel('Half baths', { exact: true }).fill(String(v.half_bath))
  await page.getByLabel('Basement full baths').fill(String(v.bsmt_full_bath))
  await page.getByLabel('Basement half baths').fill(String(v.bsmt_half_bath))
  await page.getByLabel('Living area (sq ft)').fill(String(v.gr_liv_area))
  await page.getByLabel('Lot area (sq ft)').fill(String(v.lot_area))
  await page.getByLabel('Basement area (sq ft)').fill(String(v.total_bsmt_sf))
  await page.getByLabel('Year built').fill(String(v.year_built))
  await page.getByLabel(/Overall quality/).fill(String(v.overall_qual))
  await page.getByLabel(/Overall condition/).fill(String(v.overall_cond))
  await page.getByLabel('Garage (cars)').fill(String(v.garage_cars))
  await page.getByLabel('Fireplaces', { exact: true }).fill(String(v.fireplaces))
}

/** Submit the form and return the parsed /predict JSON actually received. */
async function submitAndCapture(page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/predict') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Estimate value' }).click(),
  ])
  return response.json()
}

/** Pin fixed/sticky chrome for stitched full-page captures (cosmetic only). */
async function pinForShot(page) {
  await page.addStyleTag({
    content: '.sidebar, .topbar, .sticky-rail { position: static !important; }',
  })
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

const REALISTIC = {
  neighborhood: 'Somerst', house_style: '2Story', bedrooms: 3, full_bath: 2, half_bath: 1,
  bsmt_full_bath: 1, bsmt_half_bath: 0, gr_liv_area: 1800, lot_area: 9000,
  total_bsmt_sf: 1000, year_built: 1995, overall_qual: 7, overall_cond: 5,
  garage_cars: 2, fireplaces: 1,
}

test('trace-truth: DOM renders exactly the intercepted /predict JSON', async ({ page }) => {
  await page.goto('/valuation')
  await fillCore(page, REALISTIC)
  const json = await submitAndCapture(page)

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toBeVisible()

  // Price hero + band — byte-equal to the API numbers after production formatting.
  await expect(rail.locator('.result-price')).toHaveText(formatUsd(json.estimated_price))
  await expect(rail.locator('.band')).toHaveAttribute(
    'aria-label',
    `~80% range ${formatUsd(json.price_range.low)} to ${formatUsd(json.price_range.high)}, estimate ${formatUsd(json.estimated_price)}`,
  )
  const scale = rail.locator('.band-scale span')
  await expect(scale.nth(0)).toHaveText(formatUsd(json.price_range.low))
  await expect(scale.nth(1)).toHaveText(`estimate ${formatUsd(json.estimated_price)}`)
  await expect(scale.nth(2)).toHaveText(formatUsd(json.price_range.high))

  // Sale likelihood: gauge meter value, "x% within 30 days", threshold as a
  // percent, verdict badge, and the mandatory simulated-target badge.
  const prob = json.sale_probability
  const pct = Math.min(100, Math.max(0, Number(prob.probability) * 100))
  await expect(rail.locator('.gauge')).toHaveAttribute(
    'aria-valuenow',
    String(Number(pct.toFixed(1))),
  )
  const gaugeMeta = rail.locator('.gauge-meta span')
  await expect(gaugeMeta.nth(0)).toHaveText(`${formatPct(prob.probability)} within 30 days`)
  await expect(gaugeMeta.nth(1)).toHaveText(`threshold ${formatPct(prob.threshold)}`)
  await expect(
    rail.getByText(prob.sells_within_30_days ? 'Likely fast sale' : 'Slower sale', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    rail.locator('.badge', { hasText: 'Simulated target' }).first(),
  ).toBeVisible()

  // Micro-market panel: label + the four stats; "Nearest cluster" badge iff
  // the API says fallback; the contract note renders with identifiers
  // humanized when present (WP-7c).
  const mm = json.micro_market
  const mmPanel = page.locator('.panel', {
    has: page.getByText('Micro-market', { exact: true }),
  })
  await expect(mmPanel.locator('.mm-label')).toHaveText(mm.label)
  const stats = mmPanel.locator('.kv dd')
  await expect(stats).toHaveCount(4)
  await expect(stats.nth(0)).toHaveText(formatUsd(mm.median_price))
  await expect(stats.nth(1)).toHaveText(
    fin(mm.median_price_per_sqft) ? `$${formatNumber(mm.median_price_per_sqft)}` : '—',
  )
  await expect(stats.nth(2)).toContainText(
    fin(mm.sale_velocity_30d) ? formatPct(mm.sale_velocity_30d) : '—',
  )
  await expect(stats.nth(3)).toHaveText(formatNumber(mm.n_sales, 0))
  await expect(mmPanel.getByText('Nearest cluster', { exact: true })).toHaveCount(
    mm.fallback ? 1 : 0,
  )
  if (mm.note) {
    await expect(
      mmPanel.locator('.mm-note').filter({ hasText: humanizeNote(mm.note) }),
    ).toHaveCount(1)
  }

  // Confidence trust badge: amber "Reduced confidence" with verbatim reasons,
  // or the "Typical confidence" badge (whose MAE caption lands with /model/info).
  if (json.confidence?.level === 'reduced') {
    const conf = rail.locator('.hero-confidence')
    await expect(conf.locator('.badge')).toHaveText('Reduced confidence')
    const items = conf.locator('.hero-confidence-reasons li')
    await expect(items).toHaveCount(json.confidence.reasons.length)
    for (const [i, reason] of json.confidence.reasons.entries()) {
      await expect(items.nth(i)).toHaveText(reason)
    }
  } else {
    await expect(rail.locator('.hero-confidence .badge')).toHaveText('Typical confidence')
  }

  // Price position strip: three markers; aria-label byte-equal to the API values.
  const mp = json.market_position
  await expect(rail.locator('.position-marker')).toHaveCount(3)
  await expect(rail.locator('.position-scale')).toHaveAttribute(
    'aria-label',
    `Estimate $${formatNumber(mp.subject_price_per_sqft)} per sqft, neighborhood median $${formatNumber(mp.neighborhood_median_price_per_sqft)}, micro-market median $${formatNumber(mp.cluster_median_price_per_sqft)}`,
  )
  const vsPct = Number(mp.vs_neighborhood_pct)
  const vsText =
    vsPct === 0
      ? 'In line with the neighborhood median ($/sqft)'
      : `${vsPct > 0 ? '+' : '−'}${formatNumber(Math.abs(vsPct))}% ${vsPct > 0 ? 'above' : 'below'} the neighborhood median ($/sqft)`
  await expect(rail.getByText(vsText, { exact: true })).toBeVisible()

  // Top factors: count, per-row pretty name, arrow + magnitude percent.
  const rows = rail.locator('.factor-list .factor-row')
  await expect(rows).toHaveCount(json.top_price_factors.length)
  for (const [i, f] of json.top_price_factors.entries()) {
    const row = rows.nth(i)
    await expect(row.locator('.factor-name')).toHaveText(prettyFeature(f.feature))
    const arrow = f.impact === 'positive' ? '↑' : '↓'
    await expect(row.locator('.factor-value')).toHaveText(
      `${arrow} ${formatPct(Math.abs(Number(f.magnitude)), 1)}`,
    )
  }

  // Provenance line: the served model + feature versions (the old
  // "About this estimate" link and .model-version-footer are gone).
  const provenance = rail.locator('.provenance')
  await expect(provenance).toContainText(
    `${json.model_version.regression} + ${json.model_version.classification}`,
  )
  await expect(provenance).toContainText(`features ${json.model_version.feature_version}`)

  expect((await rail.innerText()).match(GARBAGE)).toBeNull()
})

test('extreme max property (8 bd, qual 10, 6000 sqft, …) renders sanely', async ({ page }) => {
  await page.goto('/valuation')
  await fillCore(page, {
    neighborhood: 'NoRidge', house_style: '2Story', bedrooms: 8, full_bath: 4, half_bath: 2,
    bsmt_full_bath: 3, bsmt_half_bath: 2, gr_liv_area: 6000, lot_area: 200000,
    total_bsmt_sf: 4000, year_built: 2026, overall_qual: 10, overall_cond: 10,
    garage_cars: 5, fireplaces: 4,
  })
  const json = await submitAndCapture(page)
  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toBeVisible()

  expect(Number.isFinite(json.estimated_price)).toBe(true)
  expect(json.estimated_price).toBeGreaterThan(50_000)
  expect(json.estimated_price).toBeLessThan(5_000_000) // sanity bound (train max ≈ $755k)
  expect(json.price_range.low).toBeGreaterThan(0)
  expect(json.price_range.low).toBeLessThanOrEqual(json.price_range.high)
  await expect(rail.locator('.result-price')).toHaveText(formatUsd(json.estimated_price))
  expect((await rail.innerText()).match(GARBAGE)).toBeNull()

  await pinForShot(page)
  await page.screenshot({ path: `${EVIDENCE}blackbox-e2e-extreme-max.png`, fullPage: true })
})

test('min-everything property (0 bd, 300 sqft, 1870, qual 1) renders sanely', async ({ page }) => {
  await page.goto('/valuation')
  await fillCore(page, {
    neighborhood: 'MeadowV', house_style: '1Story', bedrooms: 0, full_bath: 0, half_bath: 0,
    bsmt_full_bath: 0, bsmt_half_bath: 0, gr_liv_area: 300, lot_area: 500,
    total_bsmt_sf: 0, year_built: 1870, overall_qual: 1, overall_cond: 1,
    garage_cars: 0, fireplaces: 0,
  })
  const json = await submitAndCapture(page)
  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toBeVisible()

  expect(Number.isFinite(json.estimated_price)).toBe(true)
  expect(json.estimated_price).toBeGreaterThan(0)
  expect(json.estimated_price).toBeLessThan(500_000)
  await expect(rail.locator('.result-price')).toHaveText(formatUsd(json.estimated_price))
  expect((await rail.innerText()).match(GARBAGE)).toBeNull()
})

test('noise neighborhoods CollgCr/NAmes/Timber show the fallback badge; StoneBr does not', async ({ page }) => {
  await page.goto('/valuation')
  const form = page.locator('form.valuation-form')
  const rail = page.locator('.valuation-rail')
  for (const hood of ['CollgCr', 'NAmes', 'Timber']) {
    await form.getByLabel('Neighborhood').selectOption(hood)
    const json = await submitAndCapture(page)
    expect(json.micro_market.fallback).toBe(true)
    await expect(rail.getByText('Nearest cluster', { exact: true })).toBeVisible()
    await expect(rail.getByText(/sits between clusters/)).toBeVisible()
  }
  // Screenshot evidence of the badge (Timber still on screen).
  await pinForShot(page)
  await rail.screenshot({ path: `${EVIDENCE}blackbox-e2e-fallback-badge.png` })

  // Control: a clustered neighborhood must NOT show the badge.
  await form.getByLabel('Neighborhood').selectOption('StoneBr')
  const control = await submitAndCapture(page)
  expect(control.micro_market.fallback).toBe(false)
  await expect(rail.getByText('Nearest cluster', { exact: true })).toHaveCount(0)
})

test('race: 5 rapid submits (abort-supersede) settle to one consistent result', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  await page.goto('/valuation')
  await fillCore(page, REALISTIC)

  const responses = []
  page.on('response', (r) => {
    if (r.url().endsWith('/predict') && r.request().method() === 'POST') responses.push(r)
  })
  // Fire 5 submits synchronously — the pipeline abort-supersedes, so all but
  // the last request are cancelled client-side and never produce a response.
  await page.evaluate(() => {
    const form = document.querySelector('form')
    for (let i = 0; i < 5; i++) form.requestSubmit()
  })
  await expect.poll(() => responses.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.valuation-rail .result-price')).toHaveText(/\$[\d,]+/)

  const payloads = await Promise.all(responses.map((r) => r.json()))
  expect(new Set(payloads.map((p) => p.estimated_price)).size).toBe(1) // deterministic model

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveCount(1)
  const last = payloads[payloads.length - 1]
  await expect(rail.locator('.result-price')).toHaveText(formatUsd(last.estimated_price))
  await expect(rail.locator('.gauge-meta span').nth(0)).toHaveText(
    `${formatPct(last.sale_probability.probability)} within 30 days`,
  )
  expect((await rail.innerText()).match(GARBAGE)).toBeNull()
  expect(pageErrors).toEqual([])
})

test('mid-load page switching (market → model → valuation) leaves no errors', async ({ page }) => {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))

  await page.goto('/market') // returns before /market/clusters settles
  await page.getByRole('link', { name: 'Model Insights' }).click()
  await page.getByRole('link', { name: 'Valuation' }).click()
  await expect(page.getByRole('heading', { name: 'Value a property' })).toBeVisible()
  await page.waitForTimeout(2500) // let any in-flight promises reject/settle

  expect(pageErrors).toEqual([])
  expect((await page.locator('body').innerText()).match(GARBAGE)).toBeNull()
  if (consoleErrors.length) console.log('console errors (non-fatal):', consoleErrors)

  // Back to the market page: the session-cached clusters resolve cleanly.
  await page.getByRole('link', { name: 'Market Intelligence' }).click()
  const markers = page.locator('.leaflet-marker-pane .leaflet-marker-icon')
  await expect(markers.first()).toBeVisible()
  expect(await markers.count()).toBeGreaterThanOrEqual(20)
  expect(pageErrors).toEqual([])
})

test('mobile viewport 390x844: usable layout, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/valuation')
  await fillCore(page, REALISTIC)
  await submitAndCapture(page)

  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  await pinForShot(page)
  await page.screenshot({ path: `${EVIDENCE}blackbox-e2e-mobile-390.png`, fullPage: true })
})

test('reload mid-session: empty hero returns, URL-param prefill keeps the form working', async ({ page }) => {
  await page.goto('/valuation')
  await fillCore(page, REALISTIC)
  await submitAndCapture(page)
  await expect(page.locator('.valuation-rail .result-price')).toHaveText(/\$[\d,]+/)

  await page.reload()
  // The result is not persisted: the documented empty hero returns…
  await expect(page.getByText(/Submit the form to see the estimate/)).toBeVisible()
  await expect(page.locator('.band')).toHaveCount(0)
  // …but the submitted payload was mirrored to the URL (SPEC §7.7), so the
  // form rehydrates the submitted neighborhood rather than the NAmes default.
  const form = page.locator('form.valuation-form')
  await expect(form.getByLabel('Neighborhood')).toHaveValue(REALISTIC.neighborhood)

  // Resubmit works.
  await page.getByRole('button', { name: 'Estimate value' }).click()
  await expect(page.locator('.valuation-rail .result-price')).toHaveText(/\$[\d,]+/, {
    timeout: 60_000,
  })
})

test('client validation: bedrooms=99 names the offending field, no API call fires', async ({ page }) => {
  await page.goto('/valuation')
  const predictCalls = []
  page.on('request', (req) => {
    if (req.url().endsWith('/predict') && req.method() === 'POST') predictCalls.push(req.url())
  })
  await page.getByLabel('Bedrooms').fill('99')
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const summary = page.getByRole('alert').filter({ hasText: 'Fix the highlighted fields' })
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Bedrooms')
  await expect(page.locator('#pf-bedrooms-error')).toContainText('Must be between 0 and 8')
  expect(predictCalls).toEqual([]) // client validation blocked the submit
  await expect(page.locator('.band')).toHaveCount(0)
})

test('neighborhood select lists exactly the 25 geo-CSV neighborhoods; unknown rejected', async ({ page }) => {
  await page.goto('/valuation')
  const select = page.getByLabel('Neighborhood')

  // Independent reference: first column of data/external/neighborhood_geo.csv.
  const csv = fs.readFileSync(path.join(REPO_ROOT, 'data/external/neighborhood_geo.csv'), 'utf8')
  const codes = csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]).sort()
  expect(codes.length).toBe(25)

  const optionValues = (await select.locator('option').evaluateAll((els) => els.map((e) => e.value))).sort()
  expect(optionValues).toEqual(codes)

  // An unknown neighborhood is not selectable (Playwright times out finding the option).
  await expect(select.selectOption('NoSuchHood', { timeout: 2000 })).rejects.toThrow()
})

test('backend down → error + Try again → backend restart → full recovery (LAST)', async ({ page }) => {
  test.setTimeout(240_000)
  const killed = await killPort(BACKEND_PORT)
  expect(killed).toBe(true)
  await page.waitForTimeout(1000)

  await page.goto('/valuation')
  await expect(page.locator('.api-status--down').first()).toHaveText('API offline')
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const error = page
    .getByRole('alert')
    .filter({ hasText: 'Cannot reach the PropPulse API' })
  await expect(error).toBeVisible()
  const tryAgain = page.getByRole('button', { name: 'Try again' })
  await expect(tryAgain).toBeVisible()

  // Restart the backend exactly like a user would (same command as README/E2E.md).
  spawn(
    path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'),
    ['-m', 'uvicorn', 'backend.app.main:app', '--port', String(BACKEND_PORT)],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, CORS_ORIGINS: FRONTEND_ORIGIN },
      detached: true,
      stdio: 'ignore',
    },
  ).unref()
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://localhost:${BACKEND_PORT}/health`)).status
        } catch {
          return 0
        }
      },
      { timeout: 180_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(200)

  // "Try again" re-submits the kept payload and the result renders.
  await tryAgain.click()
  const rail = page.locator('.valuation-rail')
  await expect(rail.locator('.result-price')).toHaveText(/\$[\d,]+/, { timeout: 60_000 })
  await expect(page.locator('.api-status--up').first()).toHaveText('API connected', {
    timeout: 45_000, // next 30s health poll
  })
})
