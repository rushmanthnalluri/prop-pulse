// Capture rendered screenshots of the PlacementPredict reference app (localhost:5000)
// into docs/screenshots/reference/ for the UI reconstruction baseline.
// Usage: cd e2e && node capture-reference.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots', 'reference');
mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5000';

const PAGES = [
  ['/', '01-home'],
  ['/upload', '02-upload'],
  ['/features', '03-features'],
  ['/descriptive', '04-descriptive'],
  ['/missing', '05-missing'],
  ['/visualize', '06-visualize'],
  ['/preprocess', '07-preprocess'],
  ['/train', '08-train'],
  ['/train?model=gradient_boosting', '09-train-detail'],
  ['/evaluate', '10-evaluate'],
  ['/predict', '11-predict'],
  ['/this-page-does-not-exist', '12-404'],
];

const MOBILE = [
  ['/', 'm01-home'],
  ['/upload', 'm02-upload'],
  ['/visualize', 'm06-visualize'],
  ['/predict', 'm11-predict'],
];

const browser = await chromium.launch();

async function shot(page, name) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1400); // let Chart.js fonts.ready + 450ms animation settle
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log('captured', name);
}

// Desktop pass — /train first so the one-time model training (~40s cold) happens early.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(180_000);

for (const [route, name] of PAGES) {
  await page.goto(BASE + route, { waitUntil: 'load' });
  await shot(page, name);
}

// Interaction capture: predict with a filled form → result panel.
await page.goto(BASE + '/predict', { waitUntil: 'load' });
await page.fill('input[name="CGPA"]', '8.3');
await page.fill('input[name="Internships"]', '2');
await page.fill('input[name="AptitudeTestScore"]', '78');
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '13-predict-result.png'), fullPage: true });
console.log('captured 13-predict-result');
await ctx.close();

// Mobile pass (390×844).
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mctx.newPage();
mpage.setDefaultNavigationTimeout(180_000);
for (const [route, name] of MOBILE) {
  await mpage.goto(BASE + route, { waitUntil: 'load' });
  await shot(mpage, name);
}
await mctx.close();

await browser.close();
console.log('done →', OUT);
