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
        navWrapOverflowY: getComputedStyle(document.querySelector('.shell-navwrap')).overflowY,
        pipelineOverflowY: getComputedStyle(
          document.querySelector('.shell-nav-section--pipeline > .shell-nav'),
        ).overflowY,
        product: rect('.shell-nav--product'),
        footer: rect('.sidebar-footer'),
        dataset: rect('.shell-foot-fact'),
        status: rect('.shell-status-card'),
      }
    })

    expect(geometry.navWrapOverflowY).toBe('hidden')
    expect(geometry.pipelineOverflowY).toBe('auto')
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


test('mobile sidebar keeps Pipeline, Product, and Dataset in distinct rows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const sidebar = page.locator('aside.pipeline-sidebar')
  const pipeline = sidebar.locator('.shell-nav-section--pipeline')
  const product = sidebar.locator('.shell-nav-section--product')
  const dataset = sidebar.locator('.shell-foot-fact')
  const compactStatus = sidebar.locator('.api-status-compact')

  await expect(pipeline.getByText('Pipeline', { exact: true })).toBeVisible()
  await expect(product.getByText('Product', { exact: true })).toBeVisible()
  await expect(dataset.getByText('Dataset', { exact: true })).toBeVisible()
  await expect(dataset.locator('.sidebar-dataset')).toBeVisible()
  await expect(compactStatus).toBeVisible()

  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector)
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: r.height }
    }
    return {
      pipeline: rect('.shell-nav-section--pipeline'),
      product: rect('.shell-nav-section--product'),
      footer: rect('.sidebar-footer'),
      dataset: rect('.shell-foot-fact'),
    }
  })

  expect(geometry.pipeline).not.toBeNull()
  expect(geometry.product).not.toBeNull()
  expect(geometry.footer).not.toBeNull()
  expect(
    geometry.product.top,
    'mobile Product row should start after Pipeline ends',
  ).toBeGreaterThanOrEqual(geometry.pipeline.bottom - 1)
  expect(
    geometry.footer.top,
    'mobile Dataset footer should start after Product ends',
  ).toBeGreaterThanOrEqual(geometry.product.bottom - 1)
  expect(geometry.dataset.bottom).toBeLessThanOrEqual(geometry.footer.bottom + 1)
})
