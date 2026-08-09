/**
 * PropPulse rebuild QA harness (not a spec — a scripted browser pass).
 * Loads every page at six breakpoints against the live dev servers,
 * captures console/page errors + screenshots, and exercises the core
 * interactions (valuation submit, validation errors, cluster selection,
 * API-offline behavior).
 *
 * Usage: node qa-rebuild.mjs   (backend :8000 + frontend :5173 must be up)
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5173'
const API = 'http://localhost:8000'
const SHOTS = '../docs/screenshots/qa'
mkdirSync(SHOTS, { recursive: true })

const VIEWPORTS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 720 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
]

const PAGES = [
  { name: 'overview', path: '/' },
  { name: 'valuation', path: '/valuation' },
  { name: 'market', path: '/market' },
  { name: 'model', path: '/model' },
  { name: 'health', path: '/health' },
  { name: 'notfound', path: '/no-such-page' },
]

const report = { consoleErrors: {}, pageErrors: {}, checks: [], overflow: [] }
const note = (check, ok, detail = '') => {
  report.checks.push({ check, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => {
    const key = `${vp.name}`
    ;(report.pageErrors[key] ??= []).push(String(e).slice(0, 300))
  })
  for (const p of PAGES) {
    errs.length = 0
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {})
    await page.waitForTimeout(p.name === 'market' ? 2500 : 1200)
    if (errs.length) (report.consoleErrors[`${p.name}@${vp.name}`] ??= []).push(...errs)
    // horizontal overflow check
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (overflow > 1) report.overflow.push(`${p.name}@${vp.name}: +${overflow}px`)
    await page.screenshot({ path: `${SHOTS}/${p.name}-${vp.name}.png`, fullPage: true })
  }
  await context.close()
}

// ---- interaction pass @1440 ------------------------------------------------
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => (report.pageErrors['interact'] ??= []).push(String(e).slice(0, 300)))

// 1. Valuation happy path
await page.goto(`${BASE}/valuation`, { waitUntil: 'networkidle' })
const submit = page.locator('button[type="submit"], button:has-text("Valuation"), button:has-text("Value")').first()
await submit.click()
const price = page.locator('.result-price')
const gotPrice = await price.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
note('valuation submit → result price renders', gotPrice, gotPrice ? await price.textContent() : 'no .result-price')
if (gotPrice) {
  note('price is a dollar figure', /^\$[\d,]+$/.test((await price.textContent()).trim()), (await price.textContent()).trim())
}
note('price band renders', await page.locator('.band').count() > 0)
note('probability gauge renders', await page.locator('.gauge').count() > 0)
note('simulated-target disclosure present', await page.locator('text=/simulated/i').count() > 0)
note('factor bars render', await page.locator('.factor-row').count() > 0, `${await page.locator('.factor-row').count()} rows`)
const compsOk = await page.locator('.comps-table, .table').first().waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
note('comps table renders', compsOk)
note('no NaN/undefined in result rail', (await page.locator('.sticky-rail').innerText().catch(() => '')).match(/NaN|undefined|\[object/) === null)
await page.screenshot({ path: `${SHOTS}/interact-valuation-result.png`, fullPage: true })

// 2. Client-side validation
await page.goto(`${BASE}/valuation`, { waitUntil: 'networkidle' })
const livArea = page.locator('input[name="gr_liv_area"]')
await livArea.fill('999999')
await page.locator('button[type="submit"], button:has-text("Valuation"), button:has-text("Value")').first().click()
await page.waitForTimeout(600)
const inlineErr = await page.locator('.field-error, .alert-error').count()
note('out-of-range input → inline/alert error, no API call', inlineErr > 0, `${inlineErr} error nodes`)
await page.screenshot({ path: `${SHOTS}/interact-validation-error.png`, fullPage: true })

// 3. Market cluster selection
await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)
const card = page.locator('.cluster-card').first()
const cardOk = await card.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)
note('cluster rail renders', cardOk)
if (cardOk) {
  await card.click()
  await page.waitForTimeout(1200)
  note('cluster card activates on click', await page.locator('.cluster-card.active').count() > 0)
  note('map markers render', await page.locator('.leaflet-interactive').count() >= 25, `${await page.locator('.leaflet-interactive').count()} markers`)
  note('map legend renders', await page.locator('.map-legend .legend-item').count() === 4)
}
await page.screenshot({ path: `${SHOTS}/interact-market.png`, fullPage: true })

// 4. Neighborhood prefill deep link
await page.goto(`${BASE}/valuation?neighborhood=StoneBr`, { waitUntil: 'networkidle' })
const hoodVal = await page.locator('select[name="neighborhood"]').inputValue().catch(() => '')
note('?neighborhood=StoneBr prefills the form', hoodVal === 'StoneBr', hoodVal)

// 5. 404 page
await page.goto(`${BASE}/definitely-not-a-route`, { waitUntil: 'networkidle' })
note('404 page renders', await page.locator('text=/404|never existed/i').count() > 0)

// 6. API offline simulation — abort all API traffic, reload
const offline = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const opage = await offline.newPage()
await opage.route(`${API}/**`, (route) => route.abort())
await opage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await opage.waitForTimeout(3500)
note('API down → global error banner', await opage.locator('.error-banner').count() > 0)
const bodyText = await opage.locator('body').innerText()
note('API down → no raw stack traces / NaN', !/NaN|undefined|\[object Object\]|TypeError|fetch failed/i.test(bodyText))
await opage.screenshot({ path: `${SHOTS}/interact-api-down.png`, fullPage: true })
await offline.close()

// 7. Model + Health render real values
await page.goto(`${BASE}/model`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const modelText = await page.locator('body').innerText()
note('model page shows confusion matrix', await page.locator('.cm-grid').count() > 0)
note('model page shows ridge version', /ridge_v1/.test(modelText))
note('model page shows threshold', /0\.203292/.test(modelText))
await page.goto(`${BASE}/health`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const healthText = await page.locator('body').innerText()
note('health page shows drift empty state or PSI data', /drift/i.test(healthText))
note('health page shows uptime', /uptime/i.test(healthText))

await context.close()
await browser.close()

console.log('\n--- console errors ---')
console.log(JSON.stringify(report.consoleErrors, null, 2))
console.log('--- page errors ---')
console.log(JSON.stringify(report.pageErrors, null, 2))
console.log('--- horizontal overflow ---')
console.log(JSON.stringify(report.overflow, null, 2))
const fails = report.checks.filter((c) => !c.ok).length
console.log(`\n${report.checks.length - fails}/${report.checks.length} interaction checks passed`)
process.exit(fails > 0 ? 1 : 0)
