/**
 * Overview page (blueprint §8.1) — the reference home rebuilt on PropPulse
 * payloads, top to bottom:
 *
 *   1. `.home-head` command centre — kicker / H1 / description / pipeline
 *      CTAs / live service strip (GET /metrics) in the hero column, the
 *      "Active model" panel (GET /model/info) in the right rail, and a
 *      full-width quick-action row into /valuation, /market, /model,
 *      /health.
 *   2. "Dataset overview" — 8-cell `.metrics.metrics-rows` strip, the lazy
 *      four-card chart grid (recharts stays out of the landing bundle,
 *      AUDIT §4), then the computed "Data insights" list.
 *   3. "What drives the price" — top-5 mean-|SHAP| driver rows
 *      (GET /model/importance) with a "Full analysis" head link.
 *   4. "The record, at a glance" — group-index tiles counted from the live
 *      workbench registry (GET /workflow/datasets/ames/features).
 *   5. "Disclosures" — the standing honesty notes (ADR-3, historical window,
 *      interval coverage).
 *   6. "The pipeline" — the nine-stage roadmap into /workflow/*.
 *
 * Every number comes from the live API layer. The four static GETs are
 * session-cached and fetched signal-free (the shared promise must never be
 * bound to one consumer's abort — see api/client.js `cachedGet`); the
 * workbench registry fetch and the live /metrics readout are page-owned and
 * use the normal abort path. Sections own their async state and fail
 * independently — a failed /model/importance never blanks the metrics
 * strip.
 */
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { getFeatures } from '../api/workflow'
import ActiveModelPanel from '../components/overview/ActiveModelPanel'
import Hero from '../components/overview/Hero'
import DriverBars from '../components/shared/DriverBars'
import {
  EmptyState,
  ErrorState,
  MetricsSkeleton,
  PanelSkeleton,
} from '../components/StateView'
import { clusterLabel, TRAIN_SALE_WINDOW } from '../constants'
import {
  championTag,
  formatMetric,
  formatNumber,
  formatPct,
  formatUsd,
  isFiniteValue,
  prettyFeature,
  sortedImportanceEntries,
} from '../format'
import { WORKFLOW_STAGES } from './workflow/stages'
import '../styles/overview.css'

const OverviewCharts = lazy(() => import('../components/overview/OverviewCharts'))

/** Capitalize the first character of a free-text label opening a sentence
    ("mid northwest leads…" → "Mid northwest leads…"); mid-sentence uses stay
    lowercase. */
const capFirst = (s) =>
  typeof s === 'string' && s ? s.charAt(0).toUpperCase() + s.slice(1) : s

/**
 * Σ sales_count across the trend series — the full training-sale basis of
 * the comps/trends artifact (the cluster stats' own n_sales cover only the
 * clustered subset, so the headline count comes from here). Null when
 * nothing usable arrived.
 */
function totalTrainingSales(trends) {
  const series = Array.isArray(trends?.series) ? trends.series : []
  let total = 0
  let seen = false
  for (const s of series) {
    const counts = Array.isArray(s?.sales_count) ? s.sales_count : []
    for (const count of counts) {
      if (isFiniteValue(count)) {
        total += Number(count)
        seen = true
      }
    }
  }
  return seen ? total : null
}

/** The record's domain groups over the full Ames schema (81 columns, each
    exactly once). Tile counts are computed against the live registry — a
    column absent from the payload is simply not counted. */
const RECORD_GROUPS = [
  {
    name: 'Identity & style',
    columns: [
      'Id', 'MSSubClass', 'BldgType', 'HouseStyle', 'RoofStyle', 'RoofMatl',
      'Exterior1st', 'Exterior2nd', 'MasVnrType', 'MasVnrArea', 'Foundation',
      'Heating', 'HeatingQC', 'CentralAir', 'Electrical', 'Utilities',
    ],
  },
  {
    name: 'Location & lot',
    columns: [
      'Neighborhood', 'Condition1', 'Condition2', 'MSZoning', 'Street', 'Alley',
      'LotFrontage', 'LotArea', 'LotShape', 'LandContour', 'LotConfig', 'LandSlope',
    ],
  },
  {
    name: 'Size & areas',
    columns: ['GrLivArea', '1stFlrSF', '2ndFlrSF', 'LowQualFinSF'],
  },
  {
    name: 'Quality & condition',
    columns: ['OverallQual', 'OverallCond', 'ExterQual', 'ExterCond', 'KitchenQual', 'Functional'],
  },
  {
    name: 'Rooms & baths',
    columns: [
      'BedroomAbvGr', 'KitchenAbvGr', 'TotRmsAbvGrd', 'FullBath', 'HalfBath',
      'BsmtFullBath', 'BsmtHalfBath',
    ],
  },
  {
    name: 'Age & sale',
    columns: ['YearBuilt', 'YearRemodAdd', 'MoSold', 'YrSold', 'SaleType', 'SaleCondition', 'SalePrice'],
  },
  {
    name: 'Garage & basement',
    columns: [
      'GarageType', 'GarageYrBlt', 'GarageFinish', 'GarageCars', 'GarageArea',
      'GarageQual', 'GarageCond', 'BsmtQual', 'BsmtCond', 'BsmtExposure',
      'BsmtFinType1', 'BsmtFinSF1', 'BsmtFinType2', 'BsmtFinSF2', 'BsmtUnfSF',
      'TotalBsmtSF', 'PavedDrive',
    ],
  },
  {
    name: 'Amenities & outdoors',
    columns: [
      'Fireplaces', 'FireplaceQu', 'WoodDeckSF', 'OpenPorchSF', 'EnclosedPorch',
      '3SsnPorch', 'ScreenPorch', 'PoolArea', 'PoolQC', 'Fence', 'MiscFeature', 'MiscVal',
    ],
  },
]

/** Pipeline-row notes (12.5px text-3) per stage slug — the reference's
    one-line "what happens here" summaries, PropTech edition. */
const PIPELINE_NOTES = {
  '01-upload': 'Bring in the raw record — or your own CSV — and profile it before anything is fit.',
  '02-features': 'Every column in the record — its type, role, coverage, and sample values.',
  '03-stats': 'Centre, spread, and range across the numeric fields, with the sale-price callout.',
  '04-missing': 'Where the record has gaps, and the pipeline\'s documented repairs.',
  '05-viz': 'Distributions, correlations, and category splits — the shape of the data, made visible.',
  '06-preprocess': 'Clean, impute, engineer — then seal the split before any model sees the data.',
  '07-train': 'Regression, classification, and clustering candidates on the sealed split.',
  '08-evaluate': 'One honest look at the held-out numbers before a champion is trusted.',
  '09-predict': 'Sandbox valuations and sale-probability calls on the models you trained.',
}

const PIPELINE_STAGES = WORKFLOW_STAGES.slice(0, 9)

/* -------------------------------------------------------------------------
 * Quick actions — the command-centre row into the product routes. Copy is
 * factual: each line names what the destination actually serves.
 * ------------------------------------------------------------------------- */

/** Right-pointing row arrow (14px, currentColor) — the hover affordance on
    pipeline rows, record tiles, and quick-action cards. */
function RowArrow({ className }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 7h9M8.5 4l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 16px stroke icons for the quick-action cards (no icon library). */
const ACTION_ICONS = {
  valuation: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 2h4.6L14 9.4a1.4 1.4 0 0 1 0 2L11.4 14a1.4 1.4 0 0 1-2 0L2 6.6V2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="5.2" cy="5.2" r="0.9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  market: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 14s5-4.6 5-8a5 5 0 1 0-10 0c0 3.4 5 8 5 8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6" r="1.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  model: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 15 5l-7 3.5L1 5l7-3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 8.5 8 12l6.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  health: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8h2.8l2-5 3.4 10 2-5h2.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
}

const QUICK_ACTIONS = [
  {
    to: '/valuation',
    icon: ACTION_ICONS.valuation,
    title: 'Value a property',
    desc: 'ML price estimate with a prediction interval and sale probability.',
  },
  {
    to: '/market',
    icon: ACTION_ICONS.market,
    title: 'Explore the market',
    desc: 'Micro-market map, cluster stats, and half-year price trends.',
  },
  {
    to: '/model',
    icon: ACTION_ICONS.model,
    title: 'Model insights',
    desc: 'Champion metrics, price drivers, and validation evidence.',
  },
  {
    to: '/health',
    icon: ACTION_ICONS.health,
    title: 'Model health',
    desc: 'Live service status, request traffic, and drift monitoring.',
  },
]

function QuickActions() {
  return (
    <nav className="ov-actions" aria-label="Quick actions">
      {QUICK_ACTIONS.map((action) => (
        <Link className="ov-action" to={action.to} key={action.to}>
          <span className="ov-action-icon" aria-hidden="true">
            {action.icon}
          </span>
          <span className="ov-action-body">
            <span className="ov-action-title">{action.title}</span>
            <span className="ov-action-desc">{action.desc}</span>
          </span>
          <RowArrow className="ov-action-arrow" />
        </Link>
      ))}
    </nav>
  )
}

/** Highest half-year median across all trend series → {value, period, label}. */
function trendsPeak(trends) {
  const periods = Array.isArray(trends?.periods) ? trends.periods : []
  const series = Array.isArray(trends?.series) ? trends.series : []
  let best = null
  for (const s of series) {
    const values = Array.isArray(s?.median_price) ? s.median_price : []
    values.forEach((value, i) => {
      if (isFiniteValue(value) && (!best || Number(value) > best.value)) {
        best = {
          value: Number(value),
          period: periods[i] ?? null,
          label: typeof s?.label === 'string' && s.label ? s.label : `Cluster ${s?.cluster ?? '?'}`,
        }
      }
    })
  }
  return best
}

/**
 * "Data insights" lines — every sentence computed from a live payload, every
 * line dropped individually when its source is missing or drifts. Returns an
 * array of strings (possibly empty).
 */
function buildInsights({ clusters, trends, importance, info, sales }) {
  const lines = []

  const clusterList = Array.isArray(clusters?.clusters) ? clusters.clusters : []
  const hoodCount = Array.isArray(clusters?.neighborhoods) ? clusters.neighborhoods.length : null
  const nClusters = isFiniteValue(clusters?.n_clusters) ? Number(clusters.n_clusters) : null
  if (hoodCount !== null && nClusters !== null && sales !== null) {
    lines.push(
      `The training record holds ${formatNumber(sales, 0)} sales across ${formatNumber(hoodCount, 0)} neighborhoods, grouped into ${formatNumber(nClusters, 0)} micro-markets.`,
    )
  }

  const priced = clusterList.filter((c) => isFiniteValue(c?.median_price))
  if (priced.length >= 2) {
    const top = priced.reduce((a, b) => (Number(b.median_price) > Number(a.median_price) ? b : a))
    const bottom = priced.reduce((a, b) => (Number(b.median_price) < Number(a.median_price) ? b : a))
    lines.push(
      `${capFirst(clusterLabel(top))} leads the micro-markets at a ${formatUsd(top.median_price)} median${isFiniteValue(top.n_sales) ? ` over ${formatNumber(top.n_sales, 0)} sales` : ''}; ${clusterLabel(bottom)} sits lowest at ${formatUsd(bottom.median_price)}.`,
    )
  }

  const peak = trendsPeak(trends)
  const lastPeriod = Array.isArray(trends?.periods) ? trends.periods[trends.periods.length - 1] : null
  if (peak && peak.period && lastPeriod) {
    lines.push(
      `Half-year median prices peaked at ${formatUsd(peak.value)} in ${peak.period} (${peak.label}); the trend record ends ${lastPeriod} — training sales, not current listings.`,
    )
  }

  const importanceEntries = sortedImportanceEntries(importance?.importance)
  if (importanceEntries.length > 0) {
    const [name, value] = importanceEntries[0]
    const sample = importance?.metadata?.val_sample_size
    lines.push(
      `${prettyFeature(name)} leads the price drivers — mean |SHAP| ${Number(value).toFixed(4)}${isFiniteValue(sample) ? ` over ${formatNumber(sample, 0)} validation rows` : ''}, relative influence rather than dollars.`,
    )
  }

  const tag = championTag(info?.regression)
  const testMetrics = info?.regression?.test_metrics ?? {}
  if (tag && isFiniteValue(testMetrics.r2) && isFiniteValue(testMetrics.rmsle)) {
    const coverage = isFiniteValue(testMetrics.interval_coverage)
      ? ` Prediction ranges measured ${formatPct(testMetrics.interval_coverage)} coverage against ~80% nominal.`
      : ''
    lines.push(
      `On the sealed test split the ${tag} champion reaches R² ${formatMetric(testMetrics.r2, 4)} with ${formatMetric(testMetrics.rmsle, 4)} RMSLE.${coverage}`,
    )
  }

  const clsAuc =
    info?.headline_metrics?.classification?.val_roc_auc ??
    info?.classification?.val_metrics?.roc_auc
  if (isFiniteValue(clsAuc)) {
    lines.push(
      `The sale-speed call scores ROC-AUC ${formatMetric(clsAuc, 4)} on validation — a simulated target, so it reads as consistency with the seeded sale-speed simulation, not a listing forecast.`,
    )
  }

  return lines
}

/** Skeleton matching the lazy chart grid's shape (2 small + 2 wide cards;
    the donut head carries no tag/select, so its skeleton head is one line). */
function ChartGridFallback() {
  return (
    <div className="chart-grid mt-32" aria-hidden="true">
      {[false, false, true, true].map((wide, i) => (
        <div className={`chart-card${wide ? ' chart-card-wide' : ''}`} key={i}>
          <div className="chart-card-head">
            <span className="skeleton sk-line" style={{ width: 150, margin: 0 }} />
            {i > 0 && <span className="skeleton sk-line" style={{ width: 90, margin: 0 }} />}
          </div>
          <PanelSkeleton height={200} />
        </div>
      ))}
    </div>
  )
}

/**
 * Headline metrics (blueprint §8.1-3): the record first, then the model.
 * Values derive from /market/clusters, /market/trends, and /model/info and
 * degrade to '—' individually rather than lying; if one source fails, the
 * loaded sources' cells still render and the failures get one shared retry.
 */
function MetricsRow({ clusters, trends, info, sales }) {
  if (clusters.loading || trends.loading || info.loading) return <MetricsSkeleton count={8} />

  const error = clusters.error || trends.error || info.error
  const anyData = clusters.data != null || trends.data != null || info.data != null
  const retryFailed = () => {
    if (clusters.error) clusters.reload()
    if (trends.error) trends.reload()
    if (info.error) info.reload()
  }
  if (error && !anyData) {
    return (
      <ErrorState title="Couldn't load headline metrics" error={error} onRetry={retryFailed} />
    )
  }

  const hoodCount = Array.isArray(clusters.data?.neighborhoods)
    ? clusters.data.neighborhoods.length
    : null
  const nClusters = isFiniteValue(clusters.data?.n_clusters) ? Number(clusters.data.n_clusters) : null

  const testMetrics = info.data?.regression?.test_metrics ?? {}
  const testRmsle =
    info.data?.headline_metrics?.regression?.test_rmsle ?? testMetrics.rmsle ?? null
  const clsAuc =
    info.data?.headline_metrics?.classification?.val_roc_auc ??
    info.data?.classification?.val_metrics?.roc_auc

  const cells = [
    { label: 'Training sales', value: formatNumber(sales, 0) },
    { label: 'Neighborhoods', value: formatNumber(hoodCount, 0) },
    { label: 'Micro-markets', value: formatNumber(nClusters, 0) },
    { label: 'Model features', value: formatNumber(info.data?.n_features, 0) },
    { label: 'Test R²', value: formatMetric(testMetrics.r2, 4) },
    { label: 'Test RMSLE', value: formatMetric(testRmsle, 4) },
    { label: 'Interval coverage', value: formatPct(testMetrics.interval_coverage) },
    { label: 'Sale-speed ROC-AUC', value: formatMetric(clsAuc, 4) },
  ]

  return (
    <>
      <div className="metrics metrics-rows" aria-live="polite">
        {cells.map((cell) => (
          <div className="metric" key={cell.label}>
            <span className="metric-value">{cell.value}</span>
            <span className="metric-label">{cell.label}</span>
          </div>
        ))}
      </div>
      {error && (
        <div className="ov-note-block">
          <ErrorState title="Some metrics unavailable" error={error} onRetry={retryFailed} />
        </div>
      )}
    </>
  )
}

export default function OverviewPage() {
  // Session-cached static GETs are fetched WITHOUT the useApi abort signal:
  // the client shares one promise per path across all consumers, so a single
  // consumer's unmount/StrictMode-remount abort would kill the request for
  // everyone (see api/client.js cachedGet). These payloads are tiny and
  // cache-backed; useApi's cancelled flag still guards setState after unmount.
  const infoFetcher = useCallback(() => api.modelInfo(), [])
  const clustersFetcher = useCallback(() => api.marketClusters(), [])
  const importanceFetcher = useCallback(() => api.modelImportance(), [])
  const trendsFetcher = useCallback(() => api.getTrends(), [])
  const info = useApi(infoFetcher)
  const clusters = useApi(clustersFetcher)
  const importance = useApi(importanceFetcher)
  // Doubles as the signal-free warm-up for the lazy chart grid's trends card
  // (same session-cached promise) and as the insight list's trend source.
  const trends = useApi(trendsFetcher)

  // The record registry (workbench EDA, bundled dataset) — page-owned, so it
  // uses the normal signal-bound abort path.
  const featuresFetcher = useCallback((signal) => getFeatures('ames', signal), [])
  const features = useApi(featuresFetcher)

  // Live service readout for the hero strip (GET /metrics) — never cached,
  // page-owned, signal-bound like the registry fetch.
  const metricsFetcher = useCallback((signal) => api.metrics(signal), [])
  const service = useApi(metricsFetcher)

  /* Training-sale total — computed once for the metrics strip, the insight
     lines, and the disclosures. */
  const trainingSales = useMemo(
    () => (trends.data ? totalTrainingSales(trends.data) : null),
    [trends.data],
  )

  /* Drivers: top entry feeds the section sub ("…leads the ranking."). */
  const importanceEntries = sortedImportanceEntries(importance.data?.importance)
  const topDriver = importanceEntries.length > 0 ? prettyFeature(importanceEntries[0][0]) : null
  const importanceMeta = importance.data?.metadata ?? {}
  const valSample = isFiniteValue(importanceMeta.val_sample_size)
    ? formatNumber(importanceMeta.val_sample_size, 0)
    : null

  /* Record tiles: count each domain group against the live registry. */
  const rawFeatures = Array.isArray(features.data?.raw_features)
    ? features.data.raw_features
    : null
  const rawCount = rawFeatures ? rawFeatures.length : null
  const presentColumns = rawFeatures
    ? new Set(rawFeatures.map((f) => f?.name).filter((n) => typeof n === 'string'))
    : null
  const recordGroups = presentColumns
    ? RECORD_GROUPS.map((group) => ({
        ...group,
        count: group.columns.filter((column) => presentColumns.has(column)).length,
      })).filter((group) => group.count > 0)
    : []

  /* Insights render once every source has settled; lines whose source failed
     are simply absent (each failure is already surfaced by its own section). */
  const insightSources = [clusters, trends, importance, info]
  const insightsSettled = insightSources.every((source) => !source.loading)
  const insightLines = insightsSettled
    ? buildInsights({
        clusters: clusters.data,
        trends: trends.data,
        importance: importance.data,
        info: info.data,
        sales: trainingSales,
      })
    : []
  const retryFailedInsights = () => {
    for (const source of insightSources) if (source.error) source.reload()
  }

  const trainingYears = `${TRAIN_SALE_WINDOW.start.slice(0, 4)}–${TRAIN_SALE_WINDOW.end.slice(0, 4)}`

  return (
    <>
      {/* 1 · Hero + active model + quick actions */}
      <section className="home-head">
        <Hero service={service} />
        <ActiveModelPanel info={info} />
        <QuickActions />
      </section>

      <hr className="divider" />

      {/* 2 · Dataset overview: metrics, charts, insights */}
      <section className="section" aria-label="Dataset overview">
        <div className="section-head">
          <h2 className="section-title">Dataset overview</h2>
          <span className="mono dim mono-sm">
            sealed test split · sale-speed AUC simulated
          </span>
        </div>
        <MetricsRow clusters={clusters} trends={trends} info={info} sales={trainingSales} />

        <Suspense fallback={<ChartGridFallback />}>
          <OverviewCharts clusters={clusters} />
        </Suspense>

        <div className="section-head mt-36">
          <h2 className="section-title">Data insights</h2>
          <span className="mono dim mono-sm">computed from the live data</span>
        </div>
        {!insightsSettled && (
          <div aria-hidden="true">
            {[420, 380, 460, 340, 400].map((width, i) => (
              <div className="skeleton sk-line" style={{ width }} key={i} />
            ))}
          </div>
        )}
        {insightsSettled && insightLines.length === 0 && (
          insightSources.some((source) => source.error) ? (
            <ErrorState
              title="Couldn't compute insights"
              error={insightSources.find((source) => source.error)?.error}
              onRetry={retryFailedInsights}
            />
          ) : (
            <EmptyState
              kicker="No insights"
              title="Nothing computable from the live data"
              detail="The live responses held no usable figures. The chart cards above may still load."
            />
          )
        )}
        {insightsSettled && insightLines.length > 0 && (
          <ul className="insight-list">
            {insightLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <hr className="divider" />

      {/* 3 · What drives the price */}
      <section className="section" aria-label="What drives the price">
        <div className="section-head">
          <h2 className="section-title">What drives the price</h2>
          <Link className="section-link" to="/model">
            Full analysis
          </Link>
        </div>
        <p className="section-sub">
          Mean |SHAP| per model feature{valSample ? ` over ${valSample} validation rows` : ''} —
          relative influence, not dollar impact.{topDriver ? ` ${topDriver} leads the ranking.` : ''}
        </p>
        {importance.loading && <PanelSkeleton height={220} />}
        {!importance.loading && importance.error && (
          <ErrorState
            title="Couldn't load price drivers"
            error={importance.error}
            onRetry={importance.reload}
          />
        )}
        {!importance.loading && !importance.error && (
          <DriverBars importance={importance.data?.importance} top={5} />
        )}
      </section>

      <hr className="divider" />

      {/* 4 · The record, at a glance */}
      <section className="section" aria-label="The record, at a glance">
        <div className="section-head">
          <h2 className="section-title">The record, at a glance</h2>
          <Link className="section-link" to="/workflow/02-features">
            {rawCount !== null ? `All ${formatNumber(rawCount, 0)} fields` : 'All fields'}
          </Link>
        </div>
        {features.loading && <PanelSkeleton height={170} />}
        {!features.loading && features.error && (
          <ErrorState
            title="Couldn't load the field registry"
            error={features.error}
            onRetry={features.reload}
          />
        )}
        {!features.loading && !features.error && recordGroups.length === 0 && (
          <EmptyState
            kicker="No registry"
            title="No field groups to show"
            detail="The workbench registry returned no recognizable Ames columns. The full inventory lives on stage 02."
          >
            <Link className="btn btn-secondary btn-sm" to="/workflow/02-features">
              Analyze features
            </Link>
          </EmptyState>
        )}
        {!features.loading && !features.error && recordGroups.length > 0 && (
          <div className="group-index">
            {recordGroups.map((group) => (
              <Link className="group-cell" to="/workflow/02-features" key={group.name}>
                <span className="group-cell-name">{group.name}</span>
                <span className="group-cell-meta">
                  <span>
                    {group.count} field{group.count === 1 ? '' : 's'}
                  </span>
                  <RowArrow className="group-cell-arrow" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <hr className="divider" />

      {/* 5 · Disclosures */}
      <section className="section" aria-label="Disclosures">
        <div className="section-head">
          <h2 className="section-title">Disclosures</h2>
        </div>
        <div className="ov-disclosures">
          <p className="note">
            The 30-day sale-speed target is simulated — it measures consistency with a
            seeded sale-speed simulation, not a real-world listing forecast.
          </p>
          <p className="note">
            All market figures describe{' '}
            {trainingSales !== null ? `${formatNumber(trainingSales, 0)} ` : ''}training sales
            from Ames, IA ({trainingYears}) in nominal dollars — not current listings.
          </p>
          <p className="note">
            Price ranges are ~80% nominal intervals from validation-residual quantiles, measured
            on a sealed test set.
          </p>
        </div>
      </section>

      <hr className="divider" />

      {/* 6 · The pipeline */}
      <section className="section pb-64" aria-label="The pipeline">
        <div className="section-head">
          <h2 className="section-title">The pipeline</h2>
        </div>
        <ol className="pipeline-list">
          {PIPELINE_STAGES.map((stage) => (
            <li key={stage.slug}>
              <Link className="pipeline-row" to={`/workflow/${stage.slug}`}>
                <span className="pipeline-index">{stage.num}</span>
                <span className="pipeline-body">
                  <span className="pipeline-label">{stage.title}</span>
                  <span className="pipeline-note">{PIPELINE_NOTES[stage.slug]}</span>
                </span>
                <span className="pipeline-status status-live">Live</span>
                <RowArrow className="pipeline-arrow" />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
