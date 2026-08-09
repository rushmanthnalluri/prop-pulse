/**
 * ServiceStatus (SPEC §5.5-1): live liveness from GET /health — status badge
 * and per-champion loaded badges — plus uptime from GET /metrics. The two
 * sources degrade independently: a failed /health blanks only the liveness
 * cells and adds a section alert; a failed /metrics degrades uptime to '—'
 * with an "unavailable" hint. A models_loaded=false response renders the
 * warn banner (degraded), distinct from the network-failure error.
 */
import { formatUptime } from '../../format'
import { ErrorState, MetricsSkeleton } from '../StateView'

function ModelBadge({ loaded }) {
  if (loaded === true) return <span className="badge badge-accent">Loaded</span>
  if (loaded === false) return <span className="badge badge-danger">Missing</span>
  return '—'
}

export default function ServiceStatus({ health, metrics }) {
  const healthData = health.data
  const metricsData = metrics.data

  // Skeleton only on the true initial load — a 30s poll keeps prior data on
  // screen (SPEC §7.1: never swap loaded content for a skeleton).
  const initialLoading =
    !healthData && !metricsData && !health.error && !metrics.error && (health.loading || metrics.loading)
  if (initialLoading) return <MetricsSkeleton count={4} />

  const loaded = (healthData && healthData.models_loaded) || {}
  const degraded = healthData != null && Object.values(loaded).some((value) => value === false)
  const uptimeUnavailable = metrics.error != null && metricsData == null

  return (
    <>
      <div className="metrics metrics--auto">
        <div className="metric">
          <div className="metric-label">API status</div>
          <div className="metric-value">
            {healthData ? (
              <span className={`badge ${healthData.status === 'ok' ? 'badge-accent' : 'badge-danger'}`}>
                {healthData.status || '—'}
              </span>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Regression model</div>
          <div className="metric-value">
            <ModelBadge loaded={loaded.regression} />
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Classification model</div>
          <div className="metric-value">
            <ModelBadge loaded={loaded.classification} />
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Uptime</div>
          <div className="metric-value">{formatUptime(metricsData?.uptime_seconds)}</div>
          <div className="metric-hint">
            {uptimeUnavailable ? 'unavailable — GET /metrics failed' : 'per-process'}
          </div>
        </div>
      </div>

      {degraded && (
        <div className="alert alert-warn health-section-alert" role="alert">
          <span className="alert-title">API degraded</span>
          One or more champion models is not loaded — scoring may fail until the
          process is healthy. The traffic and drift sections below are unaffected.
        </div>
      )}

      {health.error && !healthData && (
        <div className="health-section-alert">
          <ErrorState
            error={health.error}
            onRetry={health.reload}
            title={health.error.isNetworkError ? 'Backend unreachable' : 'Could not load service status'}
          />
        </div>
      )}
    </>
  )
}
