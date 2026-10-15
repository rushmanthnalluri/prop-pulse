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
 *   1.  stage 01: sidebar stepper ×9 (01 current), bundled ames profile
 *       (1,460 × 81), upload a 120-row Ames-schema slice (built from
 *       data/raw/ames/train.csv — the WF-B4 ames_slice pattern) → select →
 *       "Upload dataset" → validation ok → auto-selected
 *   2.  stage 02: three objective cards (SIMULATED on classification), the
 *       field registry's payload-derived groups (Identifier 1 / Numeric 36 /
 *       Categorical 41 / Targets 1 / Excluded 2 / Pipeline-derived 15)
 *   3.  stage 03: 38-row numeric table, SalePrice badged target with the real
 *       mean/median + the verbatim log1p note
 *   4.  stage 04: 7,829 missing cells of 118,260, 19 affected columns, the
 *       missing-cells chart + a11y table, LotFrontage's neighbourhood-median
 *       treatment
 *   5.  stage 05: sectioned explorer — SalePrice histogram 30 bins (a11y
 *       table sums to 1,460), GrLivArea×SalePrice scatter 1,460 unsampled,
 *       correlation heat map 441 cells with OverallQual first
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
 * Design-system rebuild (2026-08-09) reconciliation — the in-shell
 * `.wf-stepper`/`.wf-step` strip is GONE: stage nav is the sidebar
 * `.pipeline-stepper` (`li.is-active > a[data-stage]` with `.step-num` /
 * `.step-label`; only the nine pipeline stages 01–09), with the `.stage-pager`
 * prev/next links at every stage foot. Upload is now select-then-submit
 * (`.upload-drop` picks, "Upload dataset" POSTs; `.wfu-report--ok` /
 * `.wfu-check`). Stage 02's sortable/expandable toolbar table is gone by
 * design (blueprint §5 bans client-side sorting/filtering) — the registry
 * renders as `.registry-group` families. Stages 03–05 dropped their old
 * `.wfe-*` hooks for the reference table/chart language.
 *
 * Full-suite note: audit-blackbox's last test respawns :8200 but dashboard's
 * last test kills it again and does not respawn — this file sorts last, so
 * beforeAll re-ensures the backend (spawn detached if /health is down).
 * Teardown deletes the upload via the API and scrubs models/workflow +
 * data/uploads (nothing outside this suite tracks them — C15/C16 spirit).
 */
import { test, expect, request } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ensureBackend, BACKEND_ORIGIN as BACKEND, REPO_ROOT } from '../helpers/backend.js'
// Production formatting — DOM numbers are compared against the API payloads
// through the exact same helpers (the audit-blackbox trace-truth pattern).
import { formatUsd, formatMetric } from '../../frontend/src/format.js'

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

const ames = (slug) => `/workflow/${slug}?dataset=ames`

/** `.metric` card located by its `.metric-label` text. */
const metric = (page, label) =>
  page.locator('.metric', { has: page.locator('.metric-label', { hasText: label }) })

/** The sidebar pipeline stepper (Layout) — stages 01–09 deep-link into /workflow/*. */
const sidebarStages = (page) =>
  page.locator('.pipeline-stepper[aria-label="ML pipeline stages"] a[data-stage]')

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
    await expect(page).toHaveTitle('Upload Dataset · PropPulse')

    // Sidebar stepper: the nine pipeline stages, 01 current.
    await expect(sidebarStages(page)).toHaveCount(9)
    await expect(
      page.locator('.pipeline-stepper li.is-active > a[data-stage="01-upload"]'),
    ).toHaveAttribute('aria-current', 'page')

    // Bundled dataset is active out of the box, with its real shape.
    await expect(page.locator('.wf-ds-chip-name')).toHaveText('Ames Housing (bundled)')
    await expect(page.locator('.wf-ds-chip-meta')).toHaveText('1,460 × 81')
    await expect(metric(page, 'Rows').locator('.metric-value')).toHaveText('1,460')
    await expect(metric(page, 'Columns').locator('.metric-value')).toHaveText('81')

    // Select the crafted 120-row Ames-schema slice in the dropzone, then submit.
    await page.locator('.upload-drop').waitFor()
    await page
      .locator('.upload-drop input[type="file"]')
      .setInputFiles({ name: journey.uploadName, mimeType: 'text/csv', buffer: buildUploadCsv() })
    await page.getByRole('button', { name: 'Upload dataset' }).click()

    // Validation report: ok (cardinality warnings are non-fatal) + per-check rows.
    const report = page.locator('.wfu-report--ok')
    await expect(report).toBeVisible()
    await expect(report.locator('.alert-title')).toContainText(/validation passed/i)
    expect(await report.locator('.wfu-check').count()).toBeGreaterThanOrEqual(9)

    // Success auto-selects the upload (chip + URL) and offers the stage-02 CTA.
    await expect(page.locator('.wf-ds-chip-name')).toHaveText(journey.uploadName)
    await expect(page).toHaveURL(/dataset=ds_[0-9a-f]{8}/)
    journey.uploadId = /dataset=(ds_[0-9a-f]{8})/.exec(page.url())?.[1] ?? null
    expect(journey.uploadId).not.toBeNull()
    await expect(
      page.getByRole('button', { name: 'Continue to Analyze Features →' }),
    ).toBeVisible()
    // The profile card refetched for the upload: its real shape (120 × 81).
    await expect(metric(page, 'Rows').locator('.metric-value')).toHaveText('120')

    expectClean(w)
  })

  test('02 features: objective cards + payload-derived registry groups', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('02-features'))
    await expect(page).toHaveTitle('Analyze Features · PropPulse')

    // Headline counts straight from raw_features (38 numeric incl. Id + target).
    await expect(metric(page, 'Fields per record').locator('.metric-value')).toHaveText('81')
    await expect(metric(page, 'Numeric').locator('.metric-value')).toHaveText('38')
    await expect(metric(page, 'Categorical').locator('.metric-value')).toHaveText('43')

    // Three objective cards; classification carries the structural SIMULATED badge.
    await expect(page.locator('.wff-target')).toHaveCount(3)
    const classification = page.locator('.wff-target', { hasText: 'Sale speed prediction' })
    await expect(classification.locator('.wf-sim-badge')).toBeVisible()
    await expect(
      page.locator('.wff-target', { hasText: 'Neighborhood segmentation' }),
    ).toBeVisible()

    // The registry groups derive from the payload's own role+dtype facets
    // (live ames: 81 raw + 15 pipeline-derived). No client sorting exists.
    await expect(page.locator('.registry-group')).toHaveCount(6)
    const groupCount = (id) => page.locator(`#group-${id} .registry-count`)
    await expect(groupCount('identifier')).toHaveText('1 field')
    await expect(groupCount('numeric-inputs')).toHaveText('36 fields')
    await expect(groupCount('categorical-inputs')).toHaveText('41 fields')
    await expect(groupCount('targets')).toHaveText('1 field')
    await expect(groupCount('excluded')).toHaveText('2 fields')
    await expect(groupCount('pipeline-derived')).toHaveText('15 fields')

    // The target row carries the amber role tag; the identifier group names Id.
    await expect(
      page.locator('#group-targets .role-tag.role-target'),
    ).toHaveText('target')
    await expect(page.locator('#group-identifier tbody tr')).toHaveText(/Id/)

    expectClean(w)
  })

  test('03 stats: 38-row numeric table, SalePrice target row + log1p note', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('03-stats'))
    await expect(page).toHaveTitle('Descriptive Statistics · PropPulse')

    // The real payload shape lands in the mono page-meta line.
    await expect(page.locator('.page-meta')).toContainText('38 numeric · 43 categorical')

    // One sticky table over every numeric field of the raw file.
    const rows = page.locator('.table-scroll.scroll-68 tbody tr')
    await expect(rows).toHaveCount(38)

    // The SalePrice row is badged as the target and carries the real numbers.
    const salePrice = rows.filter({ hasText: 'SalePrice' })
    await expect(salePrice.locator('.badge')).toHaveText('target')
    await expect(salePrice).toContainText('180,921') // mean
    await expect(salePrice).toContainText('163,000') // median (50%)

    // The payload's verbatim target note + the stage-04 cross-link.
    await expect(page.locator('.wfs-notes')).toContainText('log1p')
    await expect(
      page.locator('.wfs-notes a[href*="/workflow/04-missing"]'),
    ).toBeVisible()

    expectClean(w)
  })

  test('04 missing: 7,829 of 118,260 cells, 19 columns, LotFrontage policy', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('04-missing'))
    await expect(page).toHaveTitle('Missing Values · PropPulse')

    await expect(metric(page, 'Total cells').locator('.metric-value')).toHaveText('118,260')
    await expect(metric(page, 'Missing cells').locator('.metric-value')).toHaveText('7,829')
    await expect(metric(page, 'Complete').locator('.metric-value')).toHaveText('93.4%')
    await expect(metric(page, 'Columns affected').locator('.metric-value')).toHaveText('19')

    // The danger bar chart covers every gapped column (19), role="img" + a11y
    // table whose Missing cells sum to the payload's total.
    await expect(
      page.getByRole('img', { name: 'Bar chart of missing cells per column — 19 columns with gaps' }),
    ).toBeVisible()
    const missingTable = page.locator('.visually-hidden table', {
      hasText: 'Missing cells per column (raw file)',
    })
    await expect(missingTable.locator('tbody tr')).toHaveCount(19)
    const cellSum = await missingTable.locator('tbody tr').evaluateAll((trs) =>
      trs.reduce(
        (sum, row) => sum + Number(row.children[1]?.textContent?.replace(/[^\d]/g, '') ?? 0),
        0,
      ),
    )
    expect(cellSum).toBe(7829)

    // Repair table: LotFrontage names the real neighbourhood-median treatment
    // (C5), and every affected column gets a coverage bar "x% → 100%".
    await expect(
      page.locator('tbody tr', { hasText: 'LotFrontage' }).locator('.badge'),
    ).toHaveText('Neighborhood median')
    await expect(page.locator('.coverage-fill')).toHaveCount(19)

    expectClean(w)
  })

  test('05 viz: histogram grid, unsampled scatter, correlation heat map', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('05-viz'))
    await expect(page).toHaveTitle('Visualization · PropPulse')

    // The sticky section nav anchors the four real sections.
    await expect(page.locator('.viz-nav a')).toHaveCount(4)

    // #distributions — six histogram cards; the SalePrice card leads and plots
    // 30 bins over the full 1,460 rows.
    const distributions = page.locator('#distributions')
    await expect(distributions.locator('.chart-card')).toHaveCount(6)
    await expect(
      page.getByRole('img', { name: /^Histogram of SalePrice — 30 bins over 1,460 rows/ }),
    ).toBeVisible()
    // The a11y table carries the exact plotted bins; its counts sum to 1,460.
    const histTable = page.locator('.visually-hidden table', {
      hasText: 'Histogram of SalePrice: bin ranges and row counts',
    })
    const binSum = await histTable.locator('tbody tr').evaluateAll((trs) =>
      trs.reduce(
        (sum, row) => sum + Number(row.children[1]?.textContent?.replace(/[^\d]/g, '') ?? 0),
        0,
      ),
    )
    expect(binSum).toBe(1460)

    // #relationships — GrLivArea × SalePrice: every row plotted, no Sampled badge.
    const relationships = page.locator('#relationships')
    await expect(
      relationships.getByRole('img', {
        name: 'Scatter plot of SalePrice against GrLivArea — 1,460 points',
      }),
    ).toBeVisible()
    await expect(relationships.locator('.wfv-caption')).toContainText(
      '1,460 rows — every row plotted',
    )
    await expect(relationships.locator('.badge', { hasText: 'Sampled' })).toHaveCount(0)
    const scatterTable = page.locator('.visually-hidden table', {
      hasText: 'Scatter points: GrLivArea versus SalePrice',
    })
    await expect(scatterTable.locator('tbody tr')).toHaveCount(1460)

    // #correlations — top-20 + target: 21×21 = 441 cells, OverallQual leads by |r|.
    await expect(page.locator('.heat-cell')).toHaveCount(441)
    await expect(page.locator('.heat-row-label').first()).toHaveText('OverallQual')

    expectClean(w)
  })

  test('06 preprocess: run → 945/338/175 + leakage note + SIMULATED step', async ({ page }) => {
    const w = watch(page)
    await page.goto(ames('06-preprocess'))
    await expect(page).toHaveTitle('Preprocessing · PropPulse')

    await page.getByRole('button', { name: 'Run preprocessing' }).click()

    // Canonical bundled splits (ADR-4), straight from the persisted report.
    await expect(metric(page, 'Train').locator('.metric-value')).toHaveText('945')
    await expect(metric(page, 'Validation').locator('.metric-value')).toHaveText('338')
    await expect(metric(page, 'Test').locator('.metric-value')).toHaveText('175')

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
    await expect(page).toHaveTitle('Model Training · PropPulse')

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
    // the real validation RMSLE. The "best" chip follows the server's rule
    // (lowest validation RMSLE) and lands on whichever candidate wins — a
    // previously-persisted candidate may out-score linear (ridge did on the
    // 2026-08-11 regression), so assert the chip on the server-flagged best row
    // via the trace-truth models API rather than assuming a clean sandbox.
    const table = page.locator('.wf-comparison')
    const row = table.locator('tbody tr', { hasText: 'linear' })
    await expect(row).toBeVisible()
    await expect(row.locator('td').nth(1)).toHaveText(formatMetric(journey.rmsle, 4))
    const models = await (
      await fetch(`${BACKEND}/workflow/datasets/ames/models?objective=regression`)
    ).json()
    const bestName = models.candidates.find((c) => c.best)?.name
    expect(bestName).toBeTruthy() // exactly one server-flagged best for regression
    await expect(
      table.locator('tbody tr', { hasText: bestName }).locator('.wf-best-chip'),
    ).toHaveText('best')
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
    await expect(page).toHaveTitle('Model Evaluation · PropPulse')

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
    await expect(metric(page, 'RMSLE').locator('.metric-value')).toHaveText(
      formatMetric(evaluation.metrics.rmsle, 4),
    )
    await expect(metric(page, 'MAE').locator('.metric-value')).toHaveText(
      formatUsd(evaluation.metrics.mae),
    )
    await expect(metric(page, 'R²').locator('.metric-value')).toBeVisible()

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
    await expect(page).toHaveTitle('Predict Property · PropPulse')
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

    // The result panel renders exactly the API number + the verbatim label.
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
      page.getByRole('heading', { name: 'Micro-markets across Ames' }),
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
    // 08-evaluate is asserted by its own dedicated test below.
    const anchors = {
      '01-upload': '.upload-drop',
      '02-features': '.wff-target',
      '03-stats': '.table-scroll.scroll-68 tbody tr',
      '04-missing': '.coverage-fill',
      '05-viz': '.heat-cell',
      '06-preprocess': '.wf-flow-node',
      '07-train': '.wf-candidates',
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

  // Regression guard: at 390px the regression importance card on stage 08 once
  // overflowed the viewport by exactly 70px — the card head's `.chart-tag`
  // ("native importance, aggregated to base features — not SHAP") was
  // `white-space: nowrap` via the global rule and the wrap override covered
  // only `.eval-duo .chart-tag`. Fixed in workflow-evaluate.css (card-head
  // children may shrink, the tag wraps). This test pins the fix.
  test('responsive: 08-evaluate at 390px — no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ames('08-evaluate'))
    await page.locator('.chart-card').first().waitFor()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // Regression guard: a synchronous double-submit of the stage-01 upload form
  // once fired TWO POST /workflow/datasets (two identical datasets stored) —
  // the `uploading` React state lags one render and cannot catch a second
  // submit inside the same tick. Fixed by a ref interlock
  // (`uploadLock`) in UploadStage.handleUpload. This test pins the fix.
  test('audit m2: a synchronous double-submit of the upload form uploads once', async ({ page }) => {
    const w = watch(page)
    const ctx = await request.newContext()
    const createdIds = []
    const posts = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/workflow/datasets')) posts.push(r.url())
    })
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/workflow/datasets') && r.status() === 201) {
        r.json()
          .then((body) => body?.dataset_id && createdIds.push(body.dataset_id))
          .catch(() => {})
      }
    })
    try {
      await page.goto(ames('01-upload'))
      await page.locator('.upload-drop').waitFor()

      // Select the slice, then fire two submits in one synchronous tick — the
      // `uploading` state cannot have re-rendered yet, so only an explicit
      // guard (ref/disabled) can stop the duplicate POST.
      await page
        .locator('.upload-drop input[type="file"]')
        .setInputFiles({ name: 'dup-fire.csv', mimeType: 'text/csv', buffer: buildUploadCsv() })
      const [created] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/workflow/datasets') && r.request().method() === 'POST',
        ),
        page.locator('form.upload-form').evaluate((form) => {
          form.requestSubmit()
          form.requestSubmit()
        }),
      ])
      expect(created.status()).toBe(201)

      // One validation report, and exactly one upload request left the browser.
      await expect(page.locator('.wfu-report--ok')).toBeVisible()
      expect(posts).toHaveLength(1)
    } finally {
      await page.waitForTimeout(300) // let any duplicate response land for cleanup
      for (const id of createdIds) await ctx.delete(`${BACKEND}/workflow/datasets/${id}`)
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
    await expect(page.locator('.table-scroll.scroll-68 tbody tr').first()).toBeVisible()

    // Offline mid-navigation: the never-visited stage 05 chunk cannot load.
    await page.route('**/src/pages/workflow/VizStage*', (route) => route.abort())
    await page.locator('.pipeline-stepper a[data-stage="05-viz"]').click()
    await expect(page).toHaveURL(/05-viz/)

    // The boundary panel renders inside the content area…
    const crash = page.locator('.crash-box')
    await expect(crash).toBeVisible()
    await expect(crash.locator('.alert-title')).toHaveText('This section failed to render')
    await expect(crash.getByRole('button', { name: 'Reload page' })).toBeVisible()
    // …while the sidebar stepper and dataset picker survive (pre-M1 the whole
    // shell went).
    await expect(sidebarStages(page)).toHaveCount(9)
    await expect(page.locator('.wf-ds-chip-name')).toHaveText('Ames Housing (bundled)')

    // Navigating away remounts the boundary (per-stage key): stage 03 works.
    await page.unroute('**/src/pages/workflow/VizStage*')
    await page.locator('.pipeline-stepper a[data-stage="03-stats"]').click()
    await expect(page.locator('.table-scroll.scroll-68 tbody tr').first()).toBeVisible()

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

  test('stale training job 404 stops polling after the first missing status response', async ({ page }) => {
    let statusRequests = 0
    // The Train stage restores deep-linked jobs only when the dataset's job list
    // confirms their ownership. Simulate the status file disappearing after that list response.
    await page.route('**/workflow/datasets/ames/jobs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            job_id: 'job_ffffffff',
            dataset_id: 'ames',
            objective: 'regression',
            status: 'running',
            progress: { done: 0, total: 1, current: 'ridge', elapsed_s: 1 },
            results: { ridge: { status: 'running' } },
            error: null,
            created_at: '2026-10-16T00:00:00+00:00',
            finished_at: null,
          },
        ]),
      })
    })
    await page.route('**/workflow/jobs/job_ffffffff', async (route) => {
      statusRequests += 1
      if (statusRequests === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: 'job_ffffffff',
            dataset_id: 'ames',
            objective: 'regression',
            status: 'running',
            progress: { done: 0, total: 1, current: 'ridge', elapsed_s: 1 },
            results: { ridge: { status: 'running' } },
            error: null,
            created_at: '2026-10-16T00:00:00+00:00',
            finished_at: null,
          }),
        })
        return
      }
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ detail: "unknown job id: 'job_ffffffff'" }),
      })
    })

    await page.goto(`${ames('07-train')}&job=job_ffffffff`)
    // A 404 intentionally replaces the live panel with ErrorState, so assert
    // the terminal error rather than requiring the panel to remain mounted.
    await expect(page.getByText("Couldn't load the job status")).toBeVisible({ timeout: 10_000 })
    // A 404 is non-retryable even though the last known payload said "running".
    // The second request is expected; any later one indicates a polling loop.
    await page.waitForTimeout(5500)
    expect(statusRequests).toBe(2)
  })

})
