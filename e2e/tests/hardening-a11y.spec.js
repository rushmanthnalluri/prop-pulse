/**
 * Hardening audit — ACCESSIBILITY matrix (brief §21). Read-only against the
 * live backend :8200 + frontend :5300; the only state touched is the
 * valuation form (safe to submit) and client-side sort clicks.
 *
 *   1. keyboard-only walk on /, /valuation, /market, /model — every Tab stop
 *      is visible AND shows a focus ring (outline or box-shadow); region
 *      order is monotonic (sidebar → content → footer); stop #1 = skip-link
 *   2. skip-link activates #main (hash set; focus at/inside main)
 *   3. every valuation-form control has an associated label (+getByLabel)
 *   4. validation error → role=alert summary + aria-invalid/describedby +
 *      focus moves to the first invalid field
 *   5. aria-sort cycles on the market directory table
 *   6. probability track exposes role=meter with value/min/max/label
 *   7. map popup: Enter opens (focus moves in), Esc closes, focus returns
 *      to the marker
 *   8. SimulatedBadge tooltip reachable by keyboard focus (Tab walk)
 *   9. prefers-reduced-motion → computed animation/transition durations ~0
 */
import { test, expect } from '@playwright/test'
import { ensureBackend } from '../helpers/backend.js'

test.beforeAll(async () => {
  await ensureBackend()
})

test.describe.configure({ mode: 'serial' })

/* ---------------------------------------------------------------- helpers */

/** One Tab press → descriptor of the newly focused element (null = body). */
async function tabOnce(page) {
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) return null
    const cs = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const text = (el.getAttribute('aria-label') || el.textContent || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 48)
    const region = el.closest('aside.pipeline-sidebar')
      ? 'sidebar'
      : el.closest('.app-body')
        ? 'content'
        : el.closest('footer.site-footer')
          ? 'footer'
          : 'other'
    return {
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
      text,
      region,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        cs.visibility !== 'hidden' &&
        cs.display !== 'none',
    }
  })
}

const hasRing = (stop) =>
  (stop.outlineStyle !== 'none' && parseFloat(stop.outlineWidth) > 0) ||
  stop.boxShadow !== 'none'

/** Tab walk up to `max` stops; fails on any invisible or ring-less stop. */
async function assertWalk(page, max = 40) {
  const stops = []
  for (let i = 0; i < max; i++) {
    const stop = await tabOnce(page)
    if (!stop) break
    stops.push(stop)
    const desc = `${stop.tag}.${stop.cls} "${stop.text}"`
    expect(stop.visible, `Tab stop ${i + 1} not visible: ${desc}`).toBe(true)
    expect(
      hasRing(stop),
      `Tab stop ${i + 1} has no focus ring: ${desc} (outline=${stop.outlineStyle} ${stop.outlineWidth}, shadow=${stop.boxShadow})`,
    ).toBe(true)
  }
  return stops
}

/** Region order must never regress: other(skip) → sidebar → content → footer. */
function assertMonotonicRegions(stops) {
  const order = { other: 0, sidebar: 1, content: 2, footer: 3 }
  let peak = 0
  for (const stop of stops) {
    const rank = order[stop.region]
    expect(
      rank >= peak,
      `Tab order regressed from ${peak} back to ${stop.region} at "${stop.text}"`,
    ).toBe(true)
    peak = Math.max(peak, rank)
  }
}

/* ------------------------------------------------------------- 1+2. walk */

for (const [name, path, maxStops] of [
  ['/', '/', 26],
  ['/valuation', '/valuation', 30],
  ['/market', '/market', 30],
  ['/model', '/model', 26],
]) {
  test(`keyboard walk ${name}: ringed, visible, ordered stops`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('h1').first()).toBeVisible()
    // Let lazy chart chunks mount so the focusable set is stable mid-walk.
    await page.waitForTimeout(800)
    const stops = await assertWalk(page, maxStops)
    expect(stops.length, 'walk should reach at least 8 interactive stops').toBeGreaterThan(8)
    expect(stops[0].cls).toContain('skip-link')
    assertMonotonicRegions(stops)
    console.log(
      `walk ${name}: ${stops.length} stops — ` +
        stops.map((s) => `${s.tag}${s.region === 'sidebar' ? 'ⁿ' : ''}:"${s.text}"`).join(' | '),
    )
  })
}

test('skip-link moves to #main content', async ({ page }) => {
  await page.goto('/valuation')
  await expect(page.locator('h1')).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = await page.evaluate(() => document.activeElement?.className ?? '')
  expect(skip).toContain('skip-link')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#main$/)
  // Chrome focuses the tabindex=-1 target; otherwise the sequential focus
  // start point is #main and the next Tab lands inside main. Accept either.
  const state = await page.evaluate(() => ({
    activeIsMain: document.activeElement?.id === 'main',
  }))
  if (!state.activeIsMain) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(
      () => document.activeElement?.closest('#main') !== null || document.activeElement?.id === 'main',
    )
    expect(inside, 'after skip-link, focus should be at/inside #main').toBe(true)
  }
})

/* ------------------------------------------------------------- 3. labels */

test('valuation form: every control labelled, getByLabel resolves', async ({ page }) => {
  await page.goto('/valuation')
  const form = page.locator('form.valuation-form')
  await expect(form).toBeVisible()
  const audit = await form.evaluate((root) => {
    const controls = root.querySelectorAll('input, select, textarea')
    const bad = []
    for (const c of controls) {
      const ok =
        c.getAttribute('aria-label') ||
        c.getAttribute('aria-labelledby') ||
        (c.id && root.querySelector(`label[for="${c.id}"]`)) ||
        c.closest('label')
      if (!ok) bad.push(`${c.tagName.toLowerCase()}[name=${c.name}]`)
    }
    return { total: controls.length, bad }
  })
  expect(audit.total).toBeGreaterThan(20)
  expect(audit.bad, `unlabelled controls: ${audit.bad.join(', ')}`).toEqual([])

  // getByLabel spot checks across all four control kinds used by the form.
  await expect(page.getByLabel('Neighborhood')).toBeVisible() // select
  await expect(page.getByLabel('Living area (sq ft)')).toBeVisible() // number
  await expect(page.getByLabel('Year built')).toBeVisible() // number
  await expect(page.getByLabel(/Overall quality/)).toBeVisible()
  await expect(page.getByLabel('Central air')).toBeVisible() // checkbox
})

/* ------------------------------------------------ 4. error announcements */

test('validation error: role=alert + aria-invalid/describedby + focus move', async ({ page }) => {
  await page.goto('/valuation')
  const input = page.getByLabel('Living area (sq ft)')
  await input.fill('50')
  await page.getByRole('button', { name: 'Estimate value' }).click()

  const alert = page.getByRole('alert').filter({ hasText: 'Check the highlighted inputs' })
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('Living area')

  await expect(input).toHaveAttribute('aria-invalid', 'true')
  const descId = await input.getAttribute('aria-describedby')
  expect(descId, 'invalid input must point at its error node').toBeTruthy()
  const errorNode = page.locator(`[id="${descId}"]`)
  await expect(errorNode).toBeVisible()
  await expect(errorNode).toContainText(/300|range|between/i)

  // The submit handler focuses the first invalid field.
  await expect(input).toBeFocused()
})

/* ------------------------------------------------------------- 5. aria-sort */

test('market directory: aria-sort cycles asc → desc → none', async ({ page }) => {
  await page.goto('/market')
  const sortBtn = page.locator('th .sort-header').filter({ hasText: 'Median price' })
  await expect(sortBtn).toBeVisible()
  const th = page.locator('th[aria-sort]').filter({ hasText: 'Median price' })
  await expect(th).toHaveAttribute('aria-sort', 'none')
  await sortBtn.click()
  await expect(th).toHaveAttribute('aria-sort', 'ascending')
  await sortBtn.click()
  await expect(th).toHaveAttribute('aria-sort', 'descending')
  // every sortable column header exposes aria-sort
  const sorts = await page.locator('main th[aria-sort]').count()
  expect(sorts).toBeGreaterThanOrEqual(5)
})

/* ----------------------------------- 6+8. meter + badge (one submit flow) */

test('result rail: role=meter track + keyboard-reachable SimulatedBadge tooltip', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.goto('/valuation')
  const valForm = page.locator('form.valuation-form')
  await valForm.getByRole('button', { name: 'Load example property' }).click()
  await valForm.getByRole('button', { name: 'Estimate value' }).click()

  const track = page.locator('.result-track')
  await expect(track).toBeVisible({ timeout: 60_000 })
  await expect(track).toHaveAttribute('role', 'meter')
  await expect(track).toHaveAttribute('aria-valuemin', '0')
  await expect(track).toHaveAttribute('aria-valuemax', '100')
  const now = Number(await track.getAttribute('aria-valuenow'))
  expect(now, `aria-valuenow ${now} within 0–100`).toBeGreaterThanOrEqual(0)
  expect(now).toBeLessThanOrEqual(100)
  expect(await track.getAttribute('aria-label')).toBeTruthy()

  // SimulatedBadge: Tab from the submit button until the badge holds focus.
  const badge = page.locator('.result-prob .wf-sim-badge')
  await expect(badge).toBeVisible()
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(
      () => document.activeElement?.classList?.contains('wf-sim-badge') ?? false,
    )
  }
  expect(reached, 'SimulatedBadge reachable via Tab from the form').toBe(true)

  // Keyboard focus shows the CSS tooltip and aria-describedby resolves to it.
  const tip = badge.locator('.wf-sim-tip')
  await expect(tip).toBeVisible()
  const describedby = await badge.getAttribute('aria-describedby')
  expect(describedby).toBeTruthy()
  await expect(page.locator(`[id="${describedby}"]`)).toHaveText(/simulated/i)
})

/* --------------------------------------------------- 7. map popup Esc */

test('market map: Enter opens popup (focus in), Esc closes (focus back to marker)', async ({
  page,
}) => {
  await page.goto('/market')
  const marker = page.locator('.leaflet-marker-pane .leaflet-marker-icon').first()
  await expect(marker).toBeVisible({ timeout: 30_000 })

  await marker.focus()
  await expect(marker).toBeFocused()
  await page.keyboard.press('Enter')

  const popup = page.locator('.leaflet-popup')
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('Micro-market')
  const focusInPopup = await page.evaluate(
    () => document.activeElement?.closest('.leaflet-popup') !== null,
  )
  expect(focusInPopup, 'Enter should move focus into the popup').toBe(true)

  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  const focusBack = await page.evaluate(() =>
    document.activeElement?.classList?.contains('leaflet-marker-icon'),
  )
  expect(focusBack, 'Esc should return focus to the marker').toBe(true)
})

/* ------------------------------------------- 9. prefers-reduced-motion */

test('prefers-reduced-motion zeroes animation/transition durations', async ({ page }) => {
  // Contrast first: normal motion keeps the entrance animation.
  await page.goto('/valuation')
  const head = page.locator('.app-body main > .page-head').first()
  await expect(head).toBeVisible()
  const normal = await head.evaluate((el) => getComputedStyle(el).animationDuration)
  expect(parseFloat(normal), `normal entrance ${normal}`).toBeGreaterThan(0.1)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/valuation')
  const head2 = page.locator('.app-body main > .page-head').first()
  await expect(head2).toBeVisible()
  const anim = await head2.evaluate((el) => getComputedStyle(el).animationDuration)
  expect(parseFloat(anim), `reduced animation-duration ${anim}`).toBeLessThan(0.001)
  const trans = await page
    .locator('.btn')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration)
  expect(parseFloat(trans), `reduced transition-duration ${trans}`).toBeLessThan(0.001)
})
