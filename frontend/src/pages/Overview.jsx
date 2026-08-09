/**
 * Overview page (SPEC §5.1): hero + engine status, a six-cell headline metric
 * strip, the top value drivers, the four micro-market cards, a market trend
 * teaser (lazy — keeps recharts out of the landing bundle, AUDIT §4), the
 * three-step how-it-works, and the standing disclosures.
 *
 * Every section owns its async state (skeleton / error+retry / empty) and
 * sections fail independently — a failed /model/importance never blanks the
 * metrics strip. The endpoint queries are page-level (all session-cached
 * static GETs) so sections that share a payload never double-fetch: hero
 * panel + metrics share /model/info, metrics + micro-markets share
 * /market/clusters, and a signal-free warm-up call pre-creates the cached
 * /market/trends promise for the lazy chart (which owns its own states and
 * the §7.8 screen-reader table).
 */
import { useCallback } from 'react'
import { Link } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import ClusterCard from '../components/shared/ClusterCard'
import DriverBars from '../components/shared/DriverBars'
import EngineStatusPanel from '../components/overview/EngineStatusPanel'
import Hero from '../components/overview/Hero'
import HowItWorks from '../components/overview/HowItWorks'
import TrendsTeaser from '../components/overview/TrendsTeaser'
import {
  EmptyState,
  ErrorState,
  MetricsSkeleton,
  PanelSkeleton,
} from '../components/StateView'
import { formatMetric, formatNumber, formatPct, humanizeNote } from '../format'
import '../styles/overview.css'

const fin = (value) => Number.isFinite(Number(value))

/** `${name}_${version}` for a champion entry, or null when the shape drifts. */
function championTag(engine) {
  if (engine && typeof engine.name === 'string' && typeof engine.version === 'string') {
    return `${engine.name}_${engine.version}`
  }
  return null
}

/** Contract-verified fallback, replaced by live /model/info facts when loaded. */
const HERO_META_FALLBACK =
  'Champions ridge_v1 + random_forest_v1 · dataset ames-1.0 · training sales 2006–2008'

function heroMeta(info) {
  const reg = championTag(info?.regression)
  const cls = championTag(info?.classification)
  const dataset = typeof info?.dataset_version === 'string' ? info.dataset_version : null
  if (!reg || !cls || !dataset) return HERO_META_FALLBACK
  return `Champions ${reg} + ${cls} · dataset ${dataset} · training sales 2006–2008`
}

/**
 * Headline metrics strip (SPEC §5.1-2): model performance first, then scope.
 * Every value derives from /model/info or /market/clusters and degrades to
 * '—' individually rather than lying; if one source fails, the loaded source's
 * cells still render and the failure gets its own retry.
 */
function MetricsRow({ clusters, info }) {
  if (clusters.loading || info.loading) return <MetricsSkeleton count={6} />

  const error = clusters.error || info.error
  const anyData = clusters.data != null || info.data != null
  const retryFailed = () => {
    if (clusters.error) clusters.reload()
    if (info.error) info.reload()
  }
  if (error && !anyData) {
    return (
      <ErrorState title="Couldn't load headline metrics" error={error} onRetry={retryFailed} />
    )
  }

  const regression = info.data?.regression ?? {}
  const testMetrics = regression.test_metrics ?? {}
  // headline_metrics carries test_rmsle; test_metrics is the fallback source.
  const testRmsle =
    info.data?.headline_metrics?.regression?.test_rmsle ?? testMetrics.rmsle ?? null
  const hoodCount = Array.isArray(clusters.data?.neighborhoods)
    ? clusters.data.neighborhoods.length
    : null
  const nClusters = fin(clusters.data?.n_clusters) ? Number(clusters.data.n_clusters) : null

  const cells = [
    {
      label: 'Test RMSLE',
      value: fin(testRmsle) ? formatMetric(testRmsle, 4) : '—',
      hint: 'sealed 2010 test split',
    },
    {
      label: 'Test R²',
      value: fin(testMetrics.r2) ? formatMetric(testMetrics.r2, 4) : '—',
      hint: 'sealed 2010 test split',
    },
    {
      label: 'Interval coverage',
      value: fin(testMetrics.interval_coverage) ? formatPct(testMetrics.interval_coverage) : '—',
      hint: '~80% nominal range',
    },
    {
      label: 'Neighborhoods',
      value: hoodCount !== null ? formatNumber(hoodCount, 0) : '—',
      hint: 'approximate centroids (ADR-2)',
    },
    {
      label: 'Micro-markets',
      value: nClusters !== null ? formatNumber(nClusters, 0) : '—',
      hint: 'DBSCAN clusters',
    },
    {
      label: 'Features',
      value: fin(info.data?.n_features) ? formatNumber(info.data.n_features, 0) : '—',
      hint: 'model inputs',
    },
  ]

  return (
    <>
      <div className="metrics metrics--6" aria-live="polite">
        {cells.map((cell) => (
          <div className="metric" key={cell.label}>
            <div className="metric-label">{cell.label}</div>
            <div className="metric-value">{cell.value}</div>
            <div className="metric-hint">{cell.hint}</div>
          </div>
        ))}
      </div>
      {error && (
        <div className="ov-note-block">
          <ErrorState
            title="Some metrics unavailable"
            error={error}
            onRetry={retryFailed}
          />
        </div>
      )}
    </>
  )
}

export default function OverviewPage() {
  // Session-cached static GETs are fetched WITHOUT the useApi abort signal:
  // the client shares one promise per path across all consumers, so a single
  // consumer's unmount/StrictMode-remount abort would kill the request for
  // everyone and (worse) hand late consumers the doomed promise — useApi
  // swallows that AbortError and the section would skeleton forever. These
  // payloads are tiny and cache-backed, so aborting buys nothing; useApi's
  // cancelled flag still guards setState after unmount.
  const infoFetcher = useCallback(() => api.modelInfo(), [])
  const clustersFetcher = useCallback(() => api.marketClusters(), [])
  const importanceFetcher = useCallback(() => api.modelImportance(), [])
  const trendsFetcher = useCallback(() => api.getTrends(), [])
  const info = useApi(infoFetcher)
  const clusters = useApi(clustersFetcher)
  const importance = useApi(importanceFetcher)
  // Warm-up only: pre-creates the session-cached trends promise WITHOUT an
  // abort signal, so the lazy TrendsChart's signal-bound fetch hits an
  // unkillable cache entry (its StrictMode/unmount abort would otherwise doom
  // the shared promise and stall the chart's own skeleton — see above).
  // The chart owns the data, its states, and the §7.8 screen-reader table.
  useApi(trendsFetcher)

  const clusterList = Array.isArray(clusters.data?.clusters) ? clusters.data.clusters : []
  // Every cluster carries the same contract `note`; surface it once, with
  // raw schema identifiers humanized (WP-7c).
  const clusterNote =
    clusterList.map((c) => c?.note).find((n) => typeof n === 'string' && n) ?? null

  // Drivers caption from the importance payload's own metadata (SPEC §5.1-3).
  const importanceMeta = importance.data?.metadata ?? {}
  const units =
    typeof importanceMeta.units === 'string' && importanceMeta.units
      ? importanceMeta.units
      : null
  const valSample = fin(importanceMeta.val_sample_size)
    ? formatNumber(importanceMeta.val_sample_size, 0)
    : null
  const driverCaption =
    units && valSample
      ? `Mean |SHAP| in ${units} over ${valSample} validation rows — relative influence, not dollar impact.`
      : 'Mean |SHAP| — relative influence, not dollar impact.'
  const featureCount =
    importance.data?.importance && typeof importance.data.importance === 'object'
      ? Object.keys(importance.data.importance).length
      : null

  return (
    <>
      {/* 1 · Hero + engine status */}
      <section className="ov-hero">
        <div className="grid-hero">
          <Hero meta={heroMeta(info.data)} />
          <EngineStatusPanel info={info} />
        </div>
      </section>

      {/* 2 · Headline metrics */}
      <section className="section" style={{ paddingTop: 0 }} aria-label="Headline metrics">
        <MetricsRow clusters={clusters} info={info} />
      </section>

      {/* 3 · What moves a price */}
      <section className="section" aria-label="What moves a price">
        <div className="section-head">
          <h2 className="section-title">What moves a price</h2>
          <Link className="ov-head-link" to="/model">
            {featureCount ? `All ${featureCount} features →` : 'All features →'}
          </Link>
        </div>
        {importance.loading && <PanelSkeleton height={260} />}
        {!importance.loading && importance.error && (
          <ErrorState
            title="Couldn't load value drivers"
            error={importance.error}
            onRetry={importance.reload}
          />
        )}
        {!importance.loading && !importance.error && (
          <>
            <DriverBars importance={importance.data?.importance} top={8} />
            <p className="note ov-note-block">{driverCaption}</p>
          </>
        )}
      </section>

      <hr className="divider" />

      {/* 4 · Micro-markets */}
      <section className="section" aria-label="Micro-markets">
        <div className="section-head">
          <h2 className="section-title">Micro-markets</h2>
          <span className="section-note">30-day velocity is a simulated target (ADR-3)</span>
        </div>
        {clusters.loading && (
          <div className="grid-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <PanelSkeleton key={i} height={118} />
            ))}
          </div>
        )}
        {!clusters.loading && clusters.error && (
          <ErrorState
            title="Couldn't load micro-markets"
            error={clusters.error}
            onRetry={clusters.reload}
          />
        )}
        {!clusters.loading && !clusters.error && clusterList.length === 0 && (
          <EmptyState
            kicker="No micro-markets"
            title="No clusters returned"
            detail="The API returned no micro-market clusters. Market trends below may still load."
          />
        )}
        {!clusters.loading && !clusters.error && clusterList.length > 0 && (
          <>
            <div className="grid-2">
              {clusterList.map((cluster) => (
                <ClusterCard key={cluster.cluster_id} cluster={cluster} to="/market" />
              ))}
            </div>
            {clusterNote && <p className="note ov-note-block">{humanizeNote(clusterNote)}</p>}
          </>
        )}
      </section>

      {/* 5 · Market trend teaser (lazy — recharts stays out of the entry chunk) */}
      <section className="section" aria-label="Market trend">
        <div className="section-head">
          <h2 className="section-title">Market trend</h2>
          <span className="section-note">Trends end 2008H2 · training sales</span>
        </div>
        <TrendsTeaser />
      </section>

      <hr className="divider" />

      {/* 6 · How PropPulse works */}
      <section className="section" aria-label="How PropPulse works">
        <div className="section-head">
          <h2 className="section-title">How PropPulse works</h2>
        </div>
        <HowItWorks />
      </section>

      {/* 7 · Disclosures */}
      <section className="section" aria-label="Disclosures">
        <div className="section-head">
          <h2 className="section-title">Disclosures</h2>
        </div>
        <div className="ov-disclosures">
          <p className="note">
            The 30-day sale-speed target is simulated (ADR-3) — it measures consistency with a
            seeded sale-speed simulation, not a real-world listing forecast.
          </p>
          <p className="note">
            All market figures describe 945 training sales from Ames, IA (2006–2008) in nominal
            dollars — not current listings.
          </p>
          <p className="note">
            Price ranges are ~80% nominal intervals from validation-residual quantiles, measured
            on a sealed test set.
          </p>
        </div>
      </section>
    </>
  )
}
