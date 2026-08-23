/* Debug 6: does scrollIntoView move the sequential focus start point? */
import { chromium } from '@playwright/test'

async function firstStops(label, stub) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  if (stub) {
    await page.addInitScript(() => {
      Element.prototype.scrollIntoView = () => {}
    })
  }
  await page.goto('http://localhost:5300/', { waitUntil: 'domcontentloaded' })
  await page.locator('h1').first().waitFor({ state: 'visible' })
  await page.waitForTimeout(2000)
  const stops = []
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement
        return (el?.getAttribute('aria-label') || el?.textContent || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 36)
      }),
    )
  }
  console.log(`${label}: stop1="${stops[0]}" stop2="${stops[1]}" stop3="${stops[2]}"`)
  await browser.close()
}

await firstStops('normal          ', false)
await firstStops('scrollIntoView✂ ', true)
