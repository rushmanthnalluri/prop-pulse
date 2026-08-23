/**
 * Hardening audit — RESPONSIVE matrix (brief §22). Read-only: navigate,
 * settle, measure, screenshot. No uploads, no submits.
 *
 * Routes × viewports (6×6):
 *   /, /valuation, /market, /model, /health, /workflow/01-upload
 *   1920x1080, 1440x900, 1280x720, 1024x768, 768x1024, 390x844
 *
 * Assertion: document.documentElement.scrollWidth <= innerWidth + 1 — no
 * horizontal PAGE overflow. Intentional inner scrolling (.table-scroll,
 * .heat-scroll, the ≤900px stepper strip, the map canvas) is excluded via a
 * generic clipped-by-an-in-bounds-scroller check, and offenders are listed
 * in the failure message for diagnosis.
 *
 * Full-page screenshots land in e2e/test-results/hardening/ (gitignored).
 */
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { ensureBackend } from '../helpers/backend.js'

const OUT_DIR = fileURLToPath(new URL('../test-results/hardening/', import.meta.url))

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
]

const ROUTES = [
  { slug: 'overview', path: '/' },
  { slug: 'valuation', path: '/valuation' },
  { slug: 'market', path: '/market' },
  { slug: 'model', path: '/model' },
  { slug: 'health', path: '/health' },
  { slug: 'workflow-01-upload', path: '/workflow/01-upload' },
]

test.beforeAll(async () => {
  await ensureBackend()
})

/** Page-overflow probe: scrollWidth + up to 8 out-of-bounds elements. */
function probeOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    /** True when an in-bounds ancestor clips/scrolls x — intentional scroll. */
    const clippedByScroller = (el) => {
      let node = el.parentElement
      while (node && node !== document.body) {
        const cs = getComputedStyle(node)
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) {
          const r = node.getBoundingClientRect()
          if (r.left >= -1 && r.right <= vw + 1) return true
        }
        node = node.parentElement
      }
      return false
    }
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= vw + 1 && r.left >= -1) continue
      if (clippedByScroller(el)) continue
      const cls =
        (typeof el.className === 'string' ? el.className : el.className?.baseVal) || ''
      offenders.push({
        el: `${el.tagName.toLowerCase()}.${String(cls).trim().split(/\s+/).join('.')}`.slice(0, 90),
        left: Math.round(r.left),
        right: Math.round(r.right),
      })
      if (offenders.length >= 8) break
    }
    return {
      vw,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      offenders,
    }
  })
}

for (const route of ROUTES) {
  test(`responsive: ${route.path} — no page-level horizontal overflow`, async ({ page }) => {
    test.setTimeout(180_000)
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
      if (route.path === '/market') {
        // Tiles lag the shell; give the map a bounded chance to populate.
        await page
          .locator('.leaflet-marker-icon')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 })
          .catch(() => {})
      }
      // Settle async charts/panels + fonts before measuring and shooting.
      await page.waitForTimeout(1400)

      const probe = await probeOverflow(page)
      expect
        .soft(
          probe.scrollW,
          `${route.path} @ ${vp.name}: scrollWidth ${probe.scrollW} > viewport ${probe.vw} + 1\n` +
            `offenders: ${JSON.stringify(probe.offenders, null, 1)}`,
        )
        .toBeLessThanOrEqual(vp.width + 1)

      await page.screenshot({
        path: `${OUT_DIR}${route.slug}-${vp.name}.png`,
        fullPage: true,
      })
      console.log(
        `${route.slug} @ ${vp.name}: scrollW=${probe.scrollW} vw=${probe.vw} ` +
          `${probe.offenders.length ? `OFFENDERS=${JSON.stringify(probe.offenders)}` : 'ok'}`,
      )
    }
  })
}
