/**
 * Model Insights page (SPEC §5.4): the trust page — champion framing,
 * validation vs sealed-test evidence, global drivers, and open caveats, so a
 * reviewer can judge the model system without opening Python code.
 *
 * Fetch architecture (AUDIT §2.4 fix): exactly two async units, each behind
 * one AsyncSection with its own skeleton → error+retry → content lifecycle —
 *   1. GET /model/info       → champions, performance tables, confusion
 *                              matrices, bootstrap honesty banner. One failure
 *                              renders ONE error box, never three.
 *   2. GET /model/importance → global drivers (503 on artifact failure).
 * Methodology, disclosures, and the CTA are contract-standing copy and render
 * even when an endpoint is down. Both GETs are session-cached (client.js).
 */
import { useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { formatMetric, formatPct, formatUsd } from '../format'
import { useToast } from '../components/Toast'
import ConfusionMatrix from '../components/ConfusionMatrix'
import AsyncSection from '../components/insights/AsyncSection'
import BootstrapNote from '../components/insights/BootstrapNote'
import ChampionDuo from '../components/insights/ChampionDuo'
import Disclosures from '../components/insights/Disclosures'
import GlobalDrivers from '../components/insights/GlobalDrivers'
import Methodology from '../components/insights/Methodology'
import MetricsTable from '../components/insights/MetricsTable'
import { SkeletonBlock } from '../components/shared/Skeleton'
import '../styles/insights.css'

/** ISO timestamp → "Aug 7, 2026" (date-only; selection date, not a time). */
function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function regressionRows(regression) {
  const val = regression?.val_metrics || {}
  const test = regression?.test_metrics || {}
  return [
    { label: 'MAE', hint: 'typical absolute error, in dollars', val: formatUsd(val.mae), test: formatUsd(test.mae) },
    { label: 'RMSE', hint: 'punishes large misses more than MAE', val: formatUsd(val.rmse), test: formatUsd(test.rmse) },
    { label: 'R²', hint: 'share of price variance explained', val: formatMetric(val.r2), test: formatMetric(test.r2) },
    { label: 'RMSLE', hint: 'log-space error — the selection metric', val: formatMetric(val.rmsle, 4), test: formatMetric(test.rmsle, 4) },
    { label: 'Interval coverage', hint: '~80% nominal range, measured on the sealed test', val: '—', test: formatPct(test.interval_coverage) },
  ]
}

function classificationRows(classification) {
  const val = classification?.val_metrics || {}
  const test = classification?.test_metrics || {}
  return [
    { label: 'ROC-AUC', hint: 'ranking quality — 0.5 is chance', val: formatMetric(val.roc_auc), test: formatMetric(test.roc_auc) },
    { label: 'PR-AUC', hint: 'the primary classification metric', val: formatMetric(val.pr_auc), test: formatMetric(test.pr_auc) },
    { label: 'Precision', hint: 'when it predicts fast, how often right', val: formatMetric(val.precision), test: formatMetric(test.precision) },
    { label: 'Recall', hint: 'share of actual fast sales caught', val: formatMetric(val.recall), test: formatMetric(test.recall) },
    { label: 'F1', hint: 'precision/recall balance at the threshold', val: formatMetric(val.f1), test: formatMetric(test.f1) },
    { label: 'Brier', hint: 'probability calibration error — lower is better', val: formatMetric(val.brier), test: formatMetric(test.brier) },
  ]
}

/** First-load skeleton matching the info group's shape (duo + two tables). */
function InfoSkeleton() {
  return (
    <div className="insights-sk" aria-hidden="true">
      <div className="grid-2">
        <SkeletonBlock height={210} />
        <SkeletonBlock height={210} />
      </div>
      <SkeletonBlock height={240} />
      <SkeletonBlock height={320} />
    </div>
  )
}

/** Toast only when a section recovers from an error — never on first load. */
function useRecoveryToast(state, message) {
  const toast = useToast()
  const hadError = useRef(false)
  useEffect(() => {
    if (state.error) hadError.current = true
  }, [state.error])
  useEffect(() => {
    if (state.data && hadError.current) {
      hadError.current = false
      toast.success(message)
    }
  }, [state.data, toast, message])
}

export default function ModelInsightsPage() {
  const infoFetcher = useCallback((signal) => api.modelInfo(signal), [])
  const importanceFetcher = useCallback((signal) => api.modelImportance(signal), [])

  const info = useApi(infoFetcher)
  const importance = useApi(importanceFetcher)

  useRecoveryToast(info, 'Model details loaded')
  useRecoveryToast(importance, 'Feature importance loaded')

  const infoData = info.data

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Model Insights</span>
        <h1 className="page-title">Can you trust the numbers?</h1>
        <p className="page-desc">
          The two production champions, their validation vs sealed-test
          evidence, and the global drivers of price — every figure traced to a
          live API response, every caveat stated plainly.
        </p>
        {infoData && (
          <p className="page-meta">
            dataset {infoData.dataset_version || '—'} · {infoData.n_features ?? '—'} features ·
            feature_version {infoData.feature_version || '—'} · selected{' '}
            {formatDate(infoData.selected_at)}
          </p>
        )}
      </div>

      {/* Everything served by GET /model/info is ONE async unit — a single
          skeleton/error/empty state for champions + tables + matrices. */}
      <AsyncSection
        state={info}
        skeleton={<InfoSkeleton />}
        errorTitle="Couldn't load model details"
      >
        {(data) => {
          const classification = data.classification || {}
          const threshold =
            classification.test_metrics?.threshold ?? classification.threshold
          return (
            <>
              <section className="section insights-section-first">
                <div className="section-head">
                  <h2 className="section-title">The champions</h2>
                  <span className="section-note">GET /model/info</span>
                </div>
                <ChampionDuo info={data} />
              </section>

              <hr className="divider" />

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Regression performance</h2>
                  <span className="section-note">
                    validation n=338 (2009) · sealed test n=175 (2010)
                  </span>
                </div>
                <MetricsTable
                  rows={regressionRows(data.regression)}
                  caption="Ridge regression champion — validation vs sealed-test metrics"
                />
                <p className="note insights-table-note">
                  The served ~80% price range is an additive interval in log1p
                  space from validation residual quantiles — nominal, not a 95%
                  confidence interval. Measured coverage on the sealed 2010
                  test: {formatPct(data.regression?.test_metrics?.interval_coverage)}.
                </p>
              </section>

              <hr className="divider" />

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Classification performance</h2>
                  <span className="badge badge-warn">Simulated target</span>
                </div>
                <MetricsTable
                  rows={classificationRows(data.classification)}
                  caption="Calibrated random-forest classification champion — validation vs sealed-test metrics at the operating threshold"
                />
                <p className="note insights-table-note">
                  Decision threshold {formatMetric(threshold, 6)} — chosen to
                  maximize F1 on validation, deliberately below the 0.5 default.
                  The target is simulated (ADR-3): these numbers grade
                  consistency with a seeded sale-speed simulation, not a
                  real-world listing forecast.
                </p>

                <div className="insights-cm-grid">
                  <ConfusionMatrix
                    matrix={classification.val_metrics?.confusion_matrix}
                    title="Validation split"
                  />
                  <ConfusionMatrix
                    matrix={classification.test_metrics?.confusion_matrix}
                    title="Sealed test split"
                  />
                </div>
                <p className="note insights-table-note">
                  @ threshold {formatMetric(threshold, 4)} — positive class
                  &ldquo;fast sale&rdquo; (sale within 30 days, simulated
                  target).
                </p>
              </section>

              <hr className="divider" />

              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Champion uncertainty</h2>
                  <span className="section-note">paired bootstrap vs runner-up</span>
                </div>
                <BootstrapNote
                  bootstrap={data.regression?.bootstrap_vs_runner_up}
                  championName={data.regression?.name}
                />
              </section>
            </>
          )
        }}
      </AsyncSection>

      <hr className="divider" />

      {/* Independent fetch: an importance failure degrades only this section. */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Global drivers of price</h2>
          <span className="section-note">GET /model/importance</span>
        </div>
        <AsyncSection
          state={importance}
          skeleton={<SkeletonBlock height={640} />}
          errorTitle="Couldn't load feature importance"
        >
          {(data) => <GlobalDrivers payload={data} />}
        </AsyncSection>
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">How the champions were trained and judged</h2>
          <span className="section-note">train 945 · val 338 · sealed test 175</span>
        </div>
        <Methodology info={infoData} />
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Caveats, stated plainly</h2>
        </div>
        <Disclosures />
      </section>

      <section className="section insights-cta">
        <Link className="btn btn-primary" to="/valuation">
          Try the model →
        </Link>
        <Link className="btn btn-secondary" to="/health">
          Model health →
        </Link>
      </section>
    </div>
  )
}
