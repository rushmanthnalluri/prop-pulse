import { test, expect } from '@playwright/test'
import { ensureBackend } from '../helpers/backend.js'

test.beforeAll(async () => {
  await ensureBackend()
})

test('desktop sidebar separates Product links from the Dataset and API footer', async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const sidebar = page.locator('aside.pipeline-sidebar')
    const product = sidebar.getByRole('navigation', { name: 'Product pages' })
    const dataset = sidebar.locator('.shell-foot-fact')
    const status = sidebar.locator('.shell-status-card')

    await expect(product.getByRole('link', { name: 'Model Insights' })).toBeVisible()
    await expect(product.getByRole('link', { name: 'Model Health' })).toBeVisible()
    await expect(sidebar.getByText('Product', { exact: true })).toBeVisible()
    await expect(dataset.getByText('Dataset', { exact: true })).toBeVisible()
    await expect(dataset.locator('.sidebar-dataset')).toBeVisible()
    await expect(status.locator('.shell-status-pill')).toBeVisible()

    const geometry = await page.evaluate(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector)
        if (!node) return null
        const r = node.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, height: r.height }
      }
      return {
        viewportHeight: window.innerHeight,
        navOverflowY: getComputedStyle(document.querySelector('.shell-navwrap')).overflowY,
        product: rect('.shell-nav--product'),
        footer: rect('.sidebar-footer'),
        dataset: rect('.shell-foot-fact'),
        status: rect('.shell-status-card'),
      }
    })

    expect(geometry.navOverflowY).toBe('auto')
    expect(geometry.product).not.toBeNull()
    expect(geometry.dataset).not.toBeNull()
    expect(
      geometry.dataset.top - geometry.product.bottom,
      'Product navigation needs a visible gap before the Dataset card',
    ).toBeGreaterThanOrEqual(10)
    expect(
      geometry.status.top - geometry.dataset.bottom,
      'Dataset and API status should be separate visual blocks',
    ).toBeGreaterThanOrEqual(6)
    expect(geometry.dataset.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.status.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  }
})
