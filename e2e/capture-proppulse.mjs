// Capture rendered screenshots of the rebuilt PropPulse app (frontend :5300,
// backend :8200) into docs/screenshots/proppulse/ for side-by-side comparison
// with docs/screenshots/reference/. Usage: cd e2e && node capture-proppulse.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots', 'proppulse');
mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5300';

const PAGES = [
  ['/', '01-home'],
  ['/workflow/01-upload', '02-upload'],
  ['/workflow/02-features', '03-features'],
  ['/workflow/03-stats', '04-descriptive'],
  ['/workflow/04-missing', '05-missing'],
  ['/workflow/05-viz', '06-visualize'],
  ['/workflow/06-preprocess', '07-preprocess'],
  ['/workflow/07-train', '08-train'],
  ['/workflow/08-evaluate', '10-evaluate'],
  ['/workflow/09-predict', '11-predict'],
  ['/workflow/10-market', '14-bridge-market'],
  ['/workflow/11-explain', '15-bridge-explain'],
  ['/workflow/12-health', '16-bridge-health'],
  ['/valuation', '17-valuation'],
  ['/market', '18-market'],
  ['/model', '19-insights'],
  ['/health', '20-health'],
  ['/this-page-does-not-exist', '12-404'],
];

const MOBILE = [
  ['/', 'm01-home'],
  ['/workflow/01-upload', 'm02-upload'],
  ['/workflow/05-viz', 'm06-visualize'],
  ['/workflow/09-predict', 'm11-predict'],
  ['/valuation', 'm17-valuation'],
];

const browser = await chromium.launch();
const consoleErrors = [];

async function shot(page, name) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log('captured', name);
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(90_000);
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`[${page.url()}] ${msg.text()}`);
});
page.on('pageerror', (err) => consoleErrors.push(`[${page.url()}] PAGEERROR ${err.message}`));

for (const [route, name] of PAGES) {
  try {
    await page.goto(BASE + route, { waitUntil: 'load' });
    await shot(page, name);
  } catch (err) {
    console.log('FAILED', name, String(err).slice(0, 120));
  }
}

// Interaction capture: valuation with the real /predict round-trip.
try {
  await page.goto(BASE + '/valuation', { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /estimate value/i }).click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(OUT, '13-valuation-result.png'), fullPage: true });
  console.log('captured 13-valuation-result');
} catch (err) {
  console.log('FAILED 13-valuation-result', String(err).slice(0, 200));
}
await ctx.close();

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mctx.newPage();
mpage.setDefaultNavigationTimeout(90_000);
for (const [route, name] of MOBILE) {
  try {
    await mpage.goto(BASE + route, { waitUntil: 'load' });
    await shot(mpage, name);
  } catch (err) {
    console.log('FAILED', name, String(err).slice(0, 120));
  }
}
await mctx.close();

await browser.close();
console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
console.log('done:', OUT);
