/**
 * Overview hero, left column of `.home-head` (blueprint §8.1-1): kicker /
 * H1 / 14.5px description / page actions, plus the live service strip — a
 * quiet mono readout of GET /metrics (status dot, uptime, requests, mean
 * latency, errors) with a link into /health. The strip's box holds its
 * shape across loading → error → data so the hero never re-flows; a failed
 * /metrics degrades to a one-line note with retry, never a blank or a
 * fabricated status. CTAs mirror the reference's placement logic: primary
 * into the pipeline, secondary into the data.
 */
import { Link } from 'react-router'
import { formatNumber, formatUptime, isFiniteValue } from '../../format'

/** "up 1h 2m · 12 requests · 42 ms avg · 0 errors" — parts dropped
    individually when the payload drifts, never rendered as '—' soup. */
function serviceStats(data) {
  const parts = []
  if (isFiniteValue(data?.uptime_seconds)) parts.push(`up ${formatUptime(data.uptime_seconds)}`)
  if (isFiniteValue(data?.requests_total)) parts.push(`${formatNumber(data.requests_total, 0)} requests`)
  if (isFiniteValue(data?.avg_latency_ms)) parts.push(`${formatNumber(data.avg_latency_ms, 0)} ms avg`)
  if (isFiniteValue(data?.errors_total)) parts.push(`${formatNumber(data.errors_total, 0)} errors`)
  return parts
}

export default function Hero({ service }) {
  const { data, loading, error, reload } = service
  const stats = !loading && !error && data ? serviceStats(data) : []

  return (
    <div className="ov-hero">
      <p className="page-kicker">Overview</p>
      <h1 className="page-title">PropPulse</h1>
      <p className="page-desc">
        Machine-learning property intelligence over the Ames housing record —
        valuations, sale probability, and micro-market structure — from raw
        upload to a trained property call. Every stage is live on the data now.
      </p>
      <div className="page-actions">
        <Link className="btn btn-primary" to="/workflow/01-upload">
          Start the pipeline
        </Link>
        <Link className="btn btn-secondary" to="/workflow/05-viz">
          Explore the data
        </Link>
      </div>
      <div className="ov-service" aria-live="polite">
        {loading && (
          <span className="ov-service-sk" aria-hidden="true">
            <span className="skeleton ov-service-sk-dot" />
            <span className="skeleton sk-line" style={{ width: 210, height: 10, margin: 0 }} />
          </span>
        )}
        {!loading && error && (
          <>
            <span className="ov-service-dot ov-service-dot--down" aria-hidden="true" />
            <span className="ov-service-lead">Service metrics unavailable</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm ov-service-retry"
              onClick={reload}
            >
              Retry
            </button>
          </>
        )}
        {!loading && !error && data && (
          <>
            <span className="ov-service-dot" aria-hidden="true" />
            <span className="ov-service-lead">API live</span>
            {stats.length > 0 && <span className="ov-service-stats">{stats.join(' · ')}</span>}
            <Link className="ov-service-link" to="/health">
              Service health
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
