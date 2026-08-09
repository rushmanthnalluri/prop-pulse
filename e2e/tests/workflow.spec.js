/**
 * Guided-ML-workbench full-journey E2E (WF-F5 — workflow-architecture §9, the
 * UI-facing acceptance checks C4/C5/C6/C7-UI/C9-UI/C10-UI/C13-UI/C14 plus
 * responsive + console-cleanliness gates). Runs against the live E2E stack:
 * backend :8200 (CORS_ORIGINS=http://localhost:5300) + Vite dev :5300
 * (VITE_API_URL=http://localhost:8200), both started externally per
 * reports/E2E.md. The API-side halves (C1–C3, C8, C11–C13, C15–C16) are
 * covered by backend/tests/test_workflow_*.
 *
 * Journey (serial — later stages depend on earlier state):
 *   1.  stage 01: stepper ×12, bundled ames profile (1,460 × 81), upload a
 *       120-row Ames-schema slice (built from data/raw/ames/train.csv — the
 *       WF-B4 ames_slice pattern) → validation ok → auto-selected
 *   2.  stage 02: three target cards (SIMULATED on classification), 81-row
 *       sortable feature table (aria-sort flips, PoolQC tops missing-% desc)
 *   3.  stage 03: SalePrice spotlight $180,921 / $163,000 + 38/43 tables
 *   4.  stage 04: 7,829 missing cells, 19 %-bars, LotFrontage treatment
 *   5.  stage 05: histogram 30 bins (a11y table sums to 1,460), scatter 1,460
 *       unsampled, correlation 441 cells with OverallQual first
 *   6.  stage 06: preprocess run → 945/338/175 + leakage note + SIMULATED step
 *   7.  stage 07: REAL linear regression job (≤120 s poll) → done, comparison
 *       table shows the real RMSLE + best chip
 *   8.  stage 08: evaluation workspace (metric cards, actual-vs-predicted,
 *       residual hist, importance, a11y tables, "val, 338 rows" captions)
 *   9.  stage 09: sandbox prediction via the shared form → $ price + verbatim
 *       sandbox provenance; logs/predictions.jsonl untouched
 *   10. stages 10/11/12: bridge CTAs navigate to /market, /model, /health
 *   11. gating: the fresh upload (no jobs) locks 08/09 with stage-07 CTAs and
 *       shows can_train=false on 07; locks survive a reload (server truth)
 *   12. responsive: every stage at 390 px has no horizontal overflow
 *
 * Full-suite note: audit-blackbox's last test respawns :8200 but dashboard's
 * last test kills it again and does not respawn — this file sorts last, so
 * beforeAll re-ensures the backend (spawn detached if /health is down).
 * Teardown deletes the upload via the API and scrubs models/workflow +
 * data/uploads (nothing outside this suite tracks them — C15/C16 spirit).
 */
import { test, expect, request } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Production formatting — DOM numbers are compared against the API payloads
// through the exact same helpers (the audit-blackbox trace-truth pattern).
import { formatUsd, formatMetric } from '../../frontend/src/format.js'

const BACKEND = 'http://localhost:8200'
const FRONTEND_ORIGIN = 'http://localhost:5300'
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PREDICTION_LOG = path.join(REPO_ROOT, 'logs', 'predictions.jsonl')

/** Verbatim honesty strings (ml/workflow/prepare.py + ml/workflow/predict.py). */
const LEAKAGE_NOTE =
  'Every statistic was fit on the training rows only — validation and test rows are transformed with frozen values.'
const SANDBOX_LABEL_BUNDLED =
  'Sandbox model — trained on the bundled Ames Housing dataset; not the PropPulse champion.'

/** Console-error filter: only genuinely unexpected failures fail the journey. */
const BENIGN_CONSOLE =
  /Failed to load resource: the server responded with a status of (409|422)/

/** Cross-test journey state (serial mode, one worker). */
const journey = { uploadId: null, uploadName: 'wf-e2e-slice.csv', jobId: null, rmsle: null }

/** Per-test pageerror/console collectors — assert via expectClean() at the end. */
function watch(page) {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  return { pageErrors, consoleErrors }
}

function expectClean(w) {
  expect(w.pageErrors).toEqual([])
  expect(w.consoleErrors.filter((m) => !BENIGN_CONSOLE.test(m))).toEqual([])
}

/** The stage-01 upload: header + first 120 data rows of the bundled raw CSV. */
function buildUploadCsv() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, 'data/raw/ames/train.csv'), 'utf8')
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0)
  return Buffer.from(lines.slice(0, 121).join('\n'), 'utf8') // 120 data rows
}

/** Poll the job protocol endpoint until a terminal status (bounded). */
async function waitForJob(jobId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const resp = await fetch(`${BACKEND}/workflow/jobs/${jobId}`)
    last = await resp.json()
    if (last.status === 'done' || last.status === 'failed') return last
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`job ${jobId} not terminal within ${timeoutMs}ms: ${JSON.stringify(last)}`)
}

/** Re-ensure the E2E backend (dashboard.spec's LAST test stops :8200). */
async function ensureBackend() {
  try {
    if ((await fetch(`${BACKEND}/health`)).status === 200) return
  } catch {
    /* down — respawn below */
  }
  spawn(
    path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe'),
    ['-m', 'uvicorn', 'backend.app.main:app', '--port', '8200'],
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
          return (await fetch(`${BACKEND}/health`)).status
        } catch {
          return 0
        }
      },
      { timeout: 180_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(200)
}

const ames = (slug) => `/workflow/${slug}?dataset=ames`

test.describe('guided workflow — full journey (WF-F5)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    test.setTimeout(240_000) // backend cold start loads champions + SHAP
    await ensureBackend()
  })

  test.afterAll(async () => {
    // Delete the uploaded dataset through the API (C16 semantics: both its
    // directories go with it), then scrub the sandbox training artifacts this
    // journey created on ames. Nothing outside this suite reads them.
    if (journey.uploadId) {
      try {
        const ctx = await request.newContext()
        const resp = await ctx.delete(`${BACKEND}/workflow/datasets/${journey.uploadId}`)
        console.log(`teardown: DELETE ${journey.uploadId} → ${resp.status()}`)
        await ctx.dispose()
      } catch (error) {
        console.log('teardown: dataset delete failed —', error)
      }
    }
    for (const dir of ['models/workflow', 'data/uploads']) {
      try {
        fs.rmSync(path.join(REPO_ROOT, dir), { recursive: true, force: true })
      } catch {
        /* best-effort cleanup only */
      }
    }
  })

  test('01 upload: shell, bundled profile, upload → validate → auto-select', async ({ page }) => {
    const w = watch(page)
    await page.goto('/workflow')
    await expect(page).toHaveURL(/\/workflow\/01-upload\?dataset=ames/)

    // Stepper: 12 stages, 01 current, none locked on a fresh session's ames.
    await expect(page.locator('.wf-stepper .wf-step')).toHaveCount(12)
    await expect(
      page.locator('.wf-step[data-stage="01-upload"][aria-current="step"]'),
    ).toBeVisible()

    // Bundled dataset is active out of the box, with its real shape.
    await expect(page.locator('.wf-ds-chip-name')).toHaveText('Ames Housing (bundled)')
    await expect(page.locator('.wf-ds-chip-meta')).toHaveText('1,460 × 81')
    const profileMetric = (label) =>
      page.locator('.metric', { has: page.locator('.metric-label', { hasText: label }) })
    await expect(profileMetric('Rows').locator('.metric-value')).toHaveText('1,460')
    await expect(profileMetric('Columns').locator('.metric-value')).toHaveText('81')

    // Upload the crafted 120-row Ames-schema slice through the dropzone input.
    await page.locator('.wfe-drop').waitFor()
    await page
      .locator('.wfe-drop-input')
      .setInputFiles({ name: journey.uploadName, mimeType: 'text/csv', buffer: buildUploadCsv() })

    // Validation report: ok (cardinality warnings are non-fatal) + per-check rows.
    const report = page.locator('.wfe-report--ok')
    await expect(report).toBeVisible()
    await expect(report.locator('.alert-title')).toContainText(/validation passed/i)
    expect(await report.locator('.wfe-check').count()).toBeGreaterThanOrEqual(9)

    // Success auto-selects the upload (chip + URL) and offers the stage-02 CTA.
    await expect(page.locator('.wf-ds-chip-name')).toHaveText(journey.uploadName)
    await expect(page).toHaveURL(/dataset=ds_[0-9a-f]{8}/)
    journey.uploadId = /dataset=(ds_[0-9a-f]{8})/.exec(page.url())?.[1] ?? null
    expect(journey.uploadId).not.toBeNull()
    await expect(
      page.getByRole('button', { name: 'Continue to Analyse features →' }),
    ).toBeVisible()
    // The profile card refetched for the upload: its real shape (120 × 81).
    await expect(profileMetric('Rows').locator('.metric-value')).toHaveText('120')

    expectClean(w)
  })

  test('02 features: target cards, 81-row sortable table, inspect expansion', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('02-features'))

    // Three objective cards; classification carries the structural SIMULATED badge.
    await expect(page.locator('.wfe-target')).toHaveCount(3)
    const classification = page.locator('.wfe-target', { hasText: 'Sale speed prediction' })
    await expect(classification.locator('.wf-sim-badge')).toBeVisible()
    await expect(
      page.locator('.wfe-target', { hasText: 'Neighbourhood segmentation' }),
    ).toBeVisible()

    // 81 raw-feature rows; sort by Missing % flips aria-sort and re-orders.
    await expect(page.locator('.wfe-chev')).toHaveCount(81)
    await expect(page.locator('.wfe-toolbar-count')).toHaveText('81 columns')
    const missingHeader = page.getByRole('columnheader', { name: 'Missing %' })
    await expect(missingHeader).toHaveAttribute('aria-sort', 'none')
    await missingHeader.getByRole('button').click()
    await expect(missingHeader).toHaveAttribute('aria-sort', 'ascending')
    await missingHeader.getByRole('button').click()
    await expect(missingHeader).toHaveAttribute('aria-sort', 'descending')
    // Highest missing share first: PoolQC (99.5%) tops the descending order.
    await expect(page.locator('.wfe-feat-name').first()).toHaveText('PoolQC')

    // Row expansion renders the per-feature inspect panel.
    await page.locator('.wfe-chev').first().click()
    await expect(page.locator('.wfe-feat-detail')).toBeVisible()

    // Pipeline-derived features accordion (15 items on ames).
    await expect(page.locator('.wfe-pipe-item')).toHaveCount(15)

    expectClean(w)
  })

  test('03 stats: SalePrice spotlight + 38 numeric / 43 categorical rows', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('03-stats'))

    // Target spotlight — the real train.csv numbers.
    const spot = page.locator('.wfe-spot')
    await expect(spot).toBeVisible()
    await expect(spot.locator('.wfe-spot-stat', { hasText: 'Mean' })).toContainText('$180,921')
    await expect(spot.locator('.wfe-spot-stat', { hasText: 'Median' })).toContainText('$163,000')
    await expect(spot.locator('.wfe-spot-note')).toContainText('log1p')

    const numericSection = page.locator('.section', {
      has: page.locator('.section-title', { hasText: 'Numeric columns' }),
    })
    await expect(numericSection.locator('tbody tr')).toHaveCount(38)
    // The SalePrice row is badged as the target.
    await expect(
      numericSection.locator('tbody tr', { hasText: 'SalePrice' }).locator('.badge'),
    ).toHaveText(/target/i)

    const categoricalSection = page.locator('.section', {
      has: page.locator('.section-title', { hasText: 'Categorical columns' }),
    })
    await expect(categoricalSection.locator('tbody tr')).toHaveCount(43)

    expectClean(w)
  })

  test('04 missing: 7,829 cells, 19 treatment bars, LotFrontage policy', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('04-missing'))

    const metric = (label) =>
      page.locator('.metric', { has: page.locator('.metric-label', { hasText: label }) })
    await expect(metric('Missing cells').locator('.metric-value')).toHaveText('7,829')
    await expect(metric('Columns affected').locator('.metric-value')).toHaveText('19')

    // One %-bar per affected column.
    await expect(page.locator('.wfe-mbar-fill')).toHaveCount(19)

    // LotFrontage names the real neighbourhood-median treatment (C5).
    await expect(
      page.locator('tbody tr', { hasText: 'LotFrontage' }).locator('.badge'),
    ).toHaveText(/neighbou?rhood median/i)

    expectClean(w)
  })

  test('05 viz: histogram, unsampled scatter, correlation grid', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('05-viz'))

    // Default: SalePrice histogram, 30 bars.
    const chart = page.locator('.wfe-viz-chart')
    await expect(chart).toBeVisible()
    await expect(chart.locator('.recharts-bar-rectangle')).toHaveCount(30)
    const caption = page.locator('.wfe-viz-caption')
    await expect(caption).toContainText('1,460 rows · 30 bins')

    // The a11y table carries the exact plotted bins; its counts sum to 1,460.
    const histTable = page.locator('.visually-hidden table', {
      hasText: 'Histogram of SalePrice',
    })
    const binSum = await histTable.locator('tbody tr').evaluateAll((rows) =>
      rows.reduce(
        (sum, row) => sum + Number(row.children[1]?.textContent?.replace(/[^\d]/g, '') ?? 0),
        0,
      ),
    )
    expect(binSum).toBe(1460)

    // Scatter: GrLivArea × SalePrice — every row plotted, no Sampled badge.
    await page.getByRole('button', { name: 'Scatter', exact: true }).click()
    await expect(caption).toContainText('1,460 rows — every row plotted')
    await expect(page.locator('.wfe-sampled')).toHaveCount(0)
    const scatterTable = page.locator('.visually-hidden table', {
      hasText: 'Scatter points: GrLivArea versus SalePrice',
    })
    await expect(scatterTable.locator('tbody tr')).toHaveCount(1460)

    // Correlation top-20: 21×21 = 441 cells, OverallQual leads by |corr|.
    await page.getByRole('button', { name: 'Correlation', exact: true }).click()
    await expect(page.locator('.wfe-heat-cell')).toHaveCount(441)
    await expect(page.locator('.wfe-heat-rowhead').first()).toHaveText('OverallQual')

    expectClean(w)
  })

  test('06 preprocess: run → 945/338/175 + leakage note + SIMULATED step', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('06-preprocess'))

    await page.getByRole('button', { name: 'Run preprocessing' }).click()

    // Canonical bundled splits (ADR-4), straight from the persisted report.
    const splitMetric = (label) =>
      page.locator('.metric', { has: page.locator('.metric-label', { hasText: label }) })
    await expect(splitMetric('Train').locator('.metric-value')).toHaveText('945')
    await expect(splitMetric('Validation').locator('.metric-value')).toHaveText('338')
    await expect(splitMetric('Test').locator('.metric-value')).toHaveText('175')

    // Pipeline flow: 2 caps + 7 real steps; sale-speed step is SIMULATED-badged.
    await expect(page.locator('.wf-flow-node')).toHaveCount(9)
    const saleSpeed = page.locator('.wf-flow-node', { hasText: 'Sale-speed target' })
    await expect(saleSpeed.locator('.wf-sim-badge')).toBeVisible()
    await expect(page.locator('.wf-steps .wf-step')).toHaveCount(7)

    // The leakage guarantee renders verbatim.
    await expect(page.locator('.wf-leakage p')).toHaveText(LEAKAGE_NOTE)

    expectClean(w)
  })

  test('07 train: real linear job reaches done; comparison shows real RMSLE', async ({ page }) => {
    test.setTimeout(180_000) // real fit in a subprocess — bounded 120 s poll + UI
    const w = watch(page)
    await page.goto(ames('07-train'))

    // The classification tab itself carries the SIMULATED badge.
    await expect(
      page.locator('.wf-tab', { hasText: 'Classification' }).locator('.wf-sim-badge'),
    ).toBeVisible()

    // Cheap job: uncheck every regression candidate except linear.
    for (const name of ['ridge', 'lasso', 'random_forest', 'xgboost']) {
      await page.locator('.wf-check', { hasText: name }).locator('input').setChecked(false)
    }

    const [accepted] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith('/workflow/datasets/ames/jobs') && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Start training' }).click(),
    ])
    expect(accepted.status()).toBe(202)
    journey.jobId = (await accepted.json()).job_id
    expect(journey.jobId).toMatch(/^job_[0-9a-f]{8}$/)

    // Live status panel appears; the job reaches done within the bounded poll.
    await expect(page.locator('.wf-jobstatus')).toBeVisible()
    const job = await waitForJob(journey.jobId)
    expect(job.status).toBe('done')
    journey.rmsle = job.results?.linear?.val_metrics?.rmsle
    console.log(
      `journey evidence: job ${journey.jobId} done — linear val RMSLE ${journey.rmsle} ` +
        `(${job.results?.linear?.train_seconds}s train)`,
    )
    expect(journey.rmsle).toBeGreaterThanOrEqual(0.1) // order-of-magnitude (C8)
    expect(journey.rmsle).toBeLessThanOrEqual(0.18)
    await expect(page.locator('.wf-jobstatus .panel-head .badge')).toHaveText('done')
    await expect(page.locator('.wf-jobstatus .wf-jobrow', { hasText: 'linear' })).toContainText(
      `RMSLE ${formatMetric(journey.rmsle)}`,
    )

    // Comparison table (auto-refreshed on the terminal toast): linear row with
    // the real validation RMSLE, carrying the best chip (sole candidate).
    const table = page.locator('.wf-comparison')
    const row = table.locator('tbody tr', { hasText: 'linear' })
    await expect(row).toBeVisible()
    await expect(row.locator('td').nth(1)).toHaveText(formatMetric(journey.rmsle))
    await expect(row.locator('.wf-best-chip')).toHaveText('best')
    // Sort control works on RMSLE (aria-sort flips ascending).
    const rmsleHeader = table.getByRole('columnheader', { name: 'RMSLE' })
    await rmsleHeader.getByRole('button').click()
    await expect(rmsleHeader).toHaveAttribute('aria-sort', 'ascending')
    // Provenance: the sandbox banner names the bundled dataset + train rows.
    await expect(table.locator('.wf-prov')).toContainText('Ames Housing (bundled)')
    await expect(table.locator('.wf-prov')).toContainText('945 train rows')

    expectClean(w)
  })

  test('08 evaluate: regression workspace from the persisted val predictions', async ({ page }) => {
    const w = watch(page)
    await page.goto(`${ames('08-evaluate')}&job=${journey.jobId}`)

    // Deep-linked job + first done candidate are auto-selected.
    await expect(page.locator('#wf-eval-job')).toHaveValue(journey.jobId)
    await expect(page.locator('#wf-eval-candidate')).toHaveValue('linear')

    // Cross-check the UI against the evaluation payload (trace-truth pattern).
    const evaluation = await (
      await fetch(`${BACKEND}/workflow/jobs/${journey.jobId}/evaluation/linear`)
    ).json()
    expect(evaluation.split).toBe('val')
    expect(evaluation.n).toBe(338)

    // Metric cards render the real validation numbers.
    const metric = (label) =>
      page.locator('.metric', { has: page.locator('.metric-label', { hasText: label }) })
    await expect(metric('RMSLE').locator('.metric-value')).toHaveText(
      formatMetric(evaluation.metrics.rmsle, 4),
    )
    await expect(metric('MAE').locator('.metric-value')).toHaveText(
      formatUsd(evaluation.metrics.mae),
    )
    await expect(metric('R²').locator('.metric-value')).toBeVisible()

    // Charts: actual-vs-predicted scatter, residual histogram, importance.
    await expect(page.getByRole('img', { name: /actual vs predicted/i })).toBeVisible()
    await expect(
      page.getByRole('img', { name: 'Histogram of validation residuals in dollars' }),
    ).toBeVisible()
    await expect(
      page.locator('.chart-card', { hasText: 'Feature importance' }).first(),
    ).toBeVisible()

    // Every chart carries its a11y table; captions name split + n verbatim.
    expect(await page.locator('.visually-hidden table').count()).toBeGreaterThanOrEqual(3)
    await expect(
      page.locator('.wf-chart-caption').first(),
    ).toHaveText('val, 338 rows — the sandbox test split stays sealed')

    // The comparison table above the workspace lists the real candidate.
    await expect(
      page.locator('.wf-comparison tbody tr', { hasText: 'linear' }),
    ).toBeVisible()

    expectClean(w)
  })

  test('09 predict: sandbox estimate with verbatim provenance; log untouched', async ({ page }) => {
    const w = watch(page)
    const logLines = () =>
      fs
        .readFileSync(PREDICTION_LOG, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0).length
    const before = logLines()

    await page.goto(ames('09-predict'))
    await expect(page.locator('#wf-sb-job')).toBeVisible()
    await expect(page.locator('#wf-sb-candidate')).toHaveValue('linear')

    // Seed the shared form with the example property, then score it.
    await page.getByRole('button', { name: 'Load example property' }).click()
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => /\/workflow\/jobs\/[^/]+\/predict\//.test(r.url()) && r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Predict with sandbox model' }).click(),
    ])
    expect(response.status()).toBe(200)
    const json = await response.json()
    expect(json.estimated_price).toBeGreaterThan(50_000)
    expect(json.estimated_price).toBeLessThan(500_000)
    expect(json.provenance?.source).toBe('sandbox')
    expect(json.provenance?.n_train_rows).toBe(945)
    console.log(
      `journey evidence: sandbox prediction ${formatUsd(json.estimated_price)} ` +
        `[${formatUsd(json.price_range?.low)} – ${formatUsd(json.price_range?.high)}] ` +
        `via ${json.model?.candidate} of ${json.model?.job_id}`,
    )

    // The result card renders exactly the API number + the verbatim label.
    await expect(page.locator('.wf-result-price')).toHaveText(formatUsd(json.estimated_price))
    await expect(page.locator('.wf-result-range')).toContainText(
      formatUsd(json.price_range.low),
    )
    await expect(page.locator('.wf-prov-label')).toHaveText(SANDBOX_LABEL_BUNDLED)
    await expect(page.locator('.wf-result-meta')).toContainText(journey.jobId)

    // Sandbox predictions never enter the champion drift log (C13 UI-side).
    expect(logLines()).toBe(before)

    expectClean(w)
  })

  test('10-12 bridges: CTAs navigate to /market, /model, /health', async ({ page }) => {
    const w = watch(page)

    await page.goto(ames('10-market'))
    const marketCta = page.locator('.wf-bridge-cta')
    await expect(marketCta).toHaveAttribute('href', '/market')
    await marketCta.click()
    await expect(page).toHaveURL(/\/market$/)
    await expect(
      page.getByRole('heading', { name: 'Four micro-markets, twenty-five neighborhoods' }),
    ).toBeVisible()

    await page.goto(ames('11-explain'))
    const modelCta = page.locator('.wf-bridge-cta')
    await expect(modelCta).toHaveAttribute('href', '/model')
    await modelCta.click()
    await expect(page).toHaveURL(/\/model$/)
    await expect(
      page.getByRole('heading', { name: 'Can you trust the numbers?' }),
    ).toBeVisible()

    await page.goto(ames('12-health'))
    const healthCta = page.locator('.wf-bridge-cta')
    await expect(healthCta).toHaveAttribute('href', '/health')
    await healthCta.click()
    await expect(page).toHaveURL(/\/health$/)
    await expect(page.getByRole('heading', { name: 'Live service & drift' })).toBeVisible()

    expectClean(w)
  })

  test('gating: fresh upload locks 08/09 with stage-07 CTAs (server truth)', async ({ page }) => {
    const w = watch(page)
    const up = (slug) => `/workflow/${slug}?dataset=${journey.uploadId}`

    // Stage 08 deep-linked on a jobless upload: designed lock naming stage 07.
    await page.goto(up('08-evaluate'))
    await expect(page.getByText('This stage is locked')).toBeVisible()
    await expect(
      page.getByText('Train at least one model in stage 07 to unlock evaluation.'),
    ).toBeVisible()
    const cta08 = page.locator('.wf-locked-cta')
    await expect(cta08).toHaveAttribute(
      'href',
      `/workflow/07-train?dataset=${journey.uploadId}`,
    )
    // The stepper marks 08 locked (button, not a link).
    await expect(
      page.locator('.wf-step[data-stage="08-evaluate"][data-status="locked"]'),
    ).toBeVisible()

    // Server truth wins: a reload keeps the lock (no localStorage unlocking).
    await page.reload()
    await expect(page.getByText('This stage is locked')).toBeVisible()

    // Stage 09 locks the same way with its own copy.
    await page.goto(up('09-predict'))
    await expect(page.getByText('This stage is locked')).toBeVisible()
    await expect(
      page.getByText('Train at least one model in stage 07 to unlock sandbox predictions.'),
    ).toBeVisible()
    await expect(page.locator('.wf-locked-cta')).toHaveAttribute(
      'href',
      `/workflow/07-train?dataset=${journey.uploadId}`,
    )

    // Stage 07 itself: can_train=false (120 rows < the 150 train minimum) —
    // the blocked reason renders and launch is disabled.
    await page.goto(up('07-train'))
    const blocked = page.locator('.alert-warn', {
      hasText: 'Training is unavailable for this dataset',
    })
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText(/150/)
    await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled()

    expectClean(w)
  })

  test('responsive: no horizontal overflow on any stage at 390px', async ({ page }) => {
    test.setTimeout(180_000)
    const w = watch(page)
    await page.setViewportSize({ width: 390, height: 844 })

    // Per-stage content anchors (post-journey state: ames prepared + job done).
    const anchors = {
      '01-upload': '.wfe-drop',
      '02-features': '.wfe-target',
      '03-stats': '.wfe-spot',
      '04-missing': '.wfe-mbar-fill',
      '05-viz': '.wfe-viz-chart',
      '06-preprocess': '.wf-flow-node',
      '07-train': '.wf-candidates',
      '08-evaluate': '.chart-card',
      '09-predict': '#wf-sb-job',
      '10-market': '.wf-bridge-cta',
      '11-explain': '.wf-bridge-cta',
      '12-health': '.wf-bridge-cta',
    }
    const overflows = []
    for (const [slug, anchor] of Object.entries(anchors)) {
      await page.goto(ames(slug))
      await page.locator(anchor).first().waitFor()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      if (overflow > 1) overflows.push(`${slug}: +${overflow}px`)
    }
    expect(overflows).toEqual([])

    expectClean(w)
  })

  test('audit m2: a synchronous double-fire on the dropzone uploads once', async ({ page }) => {
    const w = watch(page)
    const ctx = await request.newContext()
    let datasetId = null
    const posts = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/workflow/datasets')) posts.push(r.url())
    })
    try {
      await page.goto(ames('01-upload'))
      await page.locator('.wfe-drop').waitFor()

      // Two change events in one synchronous tick — the `uploading` state
      // cannot have re-rendered yet, so only the ref guard can stop the dupe.
      const [created] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/workflow/datasets') && r.request().method() === 'POST',
        ),
        page.locator('.wfe-drop-input').evaluate((el, content) => {
          const file = new File([content], 'dup-fire.csv', { type: 'text/csv' })
          const dt = new DataTransfer()
          dt.items.add(file)
          Object.defineProperty(el, 'files', { value: dt.files, configurable: true })
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, buildUploadCsv().toString('utf8')),
      ])
      expect(created.status()).toBe(201)
      datasetId = (await created.json()).dataset_id

      // One validation report, and exactly one upload request left the browser.
      await expect(page.locator('.wfe-report--ok')).toBeVisible()
      expect(posts).toHaveLength(1)
    } finally {
      if (datasetId) await ctx.delete(`${BACKEND}/workflow/datasets/${datasetId}`)
      await ctx.dispose()
    }

    expectClean(w)
  })

  test('audit M1: a failed stage chunk degrades the stage, not the shell', async ({ page }) => {
    // Deliberately failing import — the boundary's console.error and the
    // aborted resource load are expected noise, so assert on pageerrors only.
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto(ames('03-stats'))
    await expect(page.locator('.wfe-spot')).toBeVisible()

    // Offline mid-navigation: the never-visited stage 05 chunk cannot load.
    await page.route('**/src/pages/workflow/VizStage*', (route) => route.abort())
    await page.locator('.wf-step[data-stage="05-viz"]').click()
    await expect(page).toHaveURL(/05-viz/)

    // The boundary panel renders inside the content area…
    const crash = page.locator('.crash-box')
    await expect(crash).toBeVisible()
    await expect(crash.locator('.alert-title')).toHaveText('This section failed to render')
    await expect(crash.getByRole('button', { name: 'Reload page' })).toBeVisible()
    // …while the stepper and dataset picker survive (pre-M1 the whole shell went).
    await expect(page.locator('.wf-stepper .wf-step')).toHaveCount(12)
    await expect(page.locator('.wf-ds-chip-name')).toHaveText('Ames Housing (bundled)')

    // Navigating away remounts the boundary (per-stage key): stage 03 works.
    await page.unroute('**/src/pages/workflow/VizStage*')
    await page.locator('.wf-step[data-stage="03-stats"]').click()
    await expect(page.locator('.wfe-spot')).toBeVisible()

    expect(pageErrors).toEqual([])
  })

  test('audit F1: re-prepare flags old-split rows in the comparison table', async ({ page }) => {
    test.setTimeout(240_000) // a real (small) training subprocess runs here
    const w = watch(page)
    const ctx = await request.newContext()
    let datasetId = null
    try {
      // 300-row slice: the alt 0.2/0.2 fractions still leave >= 150 train rows.
      const raw = fs.readFileSync(path.join(REPO_ROOT, 'data/raw/ames/train.csv'), 'utf8')
      const lines = raw.split(/\r?\n/).filter((line) => line.length > 0)
      const csv = Buffer.from(lines.slice(0, 301).join('\n'), 'utf8')
      const up = await ctx.post(`${BACKEND}/workflow/datasets?filename=stale-e2e.csv`, {
        data: csv,
        headers: { 'content-type': 'text/csv' },
      })
      expect(up.status()).toBe(201)
      datasetId = (await up.json()).dataset_id

      const config = { outlier_rule: true, split_strategy: 'auto', val_frac: 0.15, test_frac: 0.15, seed: 42 }
      const prep = await ctx.post(`${BACKEND}/workflow/datasets/${datasetId}/preprocess/preview`, {
        data: { config },
      })
      expect(prep.status()).toBe(200)

      const accepted = await ctx.post(`${BACKEND}/workflow/datasets/${datasetId}/jobs`, {
        data: { objective: 'regression', candidates: ['linear'] },
      })
      expect(accepted.status()).toBe(202)
      const job = await waitForJob((await accepted.json()).job_id)
      expect(job.status).toBe('done')
      expect(job.prepare_fingerprint).toBe((await prep.json()).fingerprint)

      // Re-prepare with a different config → the job's split is superseded.
      const reprep = await ctx.post(`${BACKEND}/workflow/datasets/${datasetId}/preprocess/preview`, {
        data: { config: { ...config, val_frac: 0.2, test_frac: 0.2, seed: 7 } },
      })
      expect(reprep.status()).toBe(200)

      // API truth: the row stays served but is flagged stale-split.
      const models = await (
        await ctx.get(`${BACKEND}/workflow/datasets/${datasetId}/models?objective=regression`)
      ).json()
      expect(models.candidates[0].stale_split).toBe(true)
      expect(models.provenance.prepare_fingerprint).toBe((await reprep.json()).fingerprint)

      // UI: the comparison row carries the "old split" badge + the honesty note.
      await page.goto(`/workflow/07-train?dataset=${datasetId}`)
      const row = page.locator('.wf-comparison tbody tr', { hasText: 'linear' })
      await expect(row).toBeVisible()
      await expect(row.locator('.wf-stale-chip')).toHaveText('old split')
      await expect(page.locator('.wf-stale-note')).toContainText('previous split')
    } finally {
      if (datasetId) await ctx.delete(`${BACKEND}/workflow/datasets/${datasetId}`)
      await ctx.dispose()
    }

    expectClean(w)
  })
})
