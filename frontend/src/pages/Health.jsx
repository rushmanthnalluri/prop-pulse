/**
 * Model Health page (SPEC §5.5): live service status (GET /health), per-
 * process request counters and traffic by route (GET /metrics), and the PSI
 * drift report (GET /metrics → drift — a file snapshot, currently status
 * "no_data", rendered as an honest empty state; no PSI values are invented).
 *
 * Auto-refresh runs every 30s via usePolling, which pauses while the tab is
 * hidden and catches up once on return (fixes AUDIT §2.5). Polls never swap
 * loaded content for skeletons — sections keep prior data and the refresh
 * row shows a subtle "Refreshing…" indicator (SPEC §7.1). The two endpoints
 * degrade independently: /health down never hides /metrics data, and a
 * network failure is labelled "Backend unreachable", distinct from the
 * "API degraded" warn state when a model is not loaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { usePolling } from '../hooks/usePolling'
import { useToast } from '../components/Toast'
import BusyButton from '../components/shared/BusyButton'
import ServiceStatus from '../components/health/ServiceStatus'
import TrafficTable from '../components/health/TrafficTable'
import DriftPanel from '../components/health/DriftPanel'
import PredictionDrift from '../components/health/PredictionDrift'
import MonitorNotes from '../components/health/MonitorNotes'
import '../styles/health.css'

const REFRESH_MS = 30_000

/** HH:MM:SS (24h) for the per-fetch "updated" stamps (SPEC §5.5-4). */
const clockTime = (date) => date.toLocaleTimeString('en-US', { hour12: false })

export default function HealthPage() {
  const toast = useToast()
  const healthFetcher = useCallback((signal) => api.health(signal), [])
  const metricsFetcher = useCallback((signal) => api.metrics(signal), [])
  const health = useApi(healthFetcher)
  const metrics = useApi(metricsFetcher)
  const { reload: reloadHealth } = health
  const { reload: reloadMetrics } = metrics

  // Per-fetch freshness stamps — one per endpoint, so a slow or failed
  // /metrics never overstates /health's freshness (AUDIT §2.5 noted the old
  // single Date updated on either fetch).
  const [statusUpdatedAt, setStatusUpdatedAt] = useState(null)
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState(null)
  useEffect(() => {
    if (health.data) setStatusUpdatedAt(new Date())
  }, [health.data])
  useEffect(() => {
    if (metrics.data) setMetricsUpdatedAt(new Date())
  }, [metrics.data])

  // 30s auto-refresh. usePolling does not fire on mount (useApi covers the
  // initial load), pauses when the tab hides, and fires once on return.
  usePolling(
    useCallback(() => {
      reloadHealth()
      reloadMetrics()
    }, [reloadHealth, reloadMetrics]),
    REFRESH_MS,
  )

  // Manual refresh: controlled busy on the button, transient toast on
  // failure/recovery (SPEC §7.2/§7.3) — the inline section alerts stay the
  // persistent error surface.
  const [manualBusy, setManualBusy] = useState(false)
  const wasErroredRef = useRef(false)
  // The click commits one render BEFORE useApi's loading flags flip true — the
  // effect below must skip that first evaluation, or it reads the stale
  // pre-refresh state and fires a spurious "Refresh failed" toast (and the
  // recovery toast never fires).
  const awaitingLoadingRef = useRef(false)
  const handleRefresh = useCallback(() => {
    wasErroredRef.current = Boolean(health.error || metrics.error)
    awaitingLoadingRef.current = true
    setManualBusy(true)
    reloadHealth()
    reloadMetrics()
  }, [health.error, metrics.error, reloadHealth, reloadMetrics])

  useEffect(() => {
    if (!manualBusy) return
    if (health.loading || metrics.loading) {
      awaitingLoadingRef.current = false // the re-fetch is now in flight
      return
    }
    if (awaitingLoadingRef.current) return // clicked, but fetches haven't entered loading yet
    const error = health.error || metrics.error
    if (error?.isNetworkError) {
      toast.error('Refresh failed — backend unreachable', error.message)
    } else if (error) {
      toast.error('Refresh failed', error.message)
    } else if (wasErroredRef.current) {
      toast.success('API reachable again — service data refreshed')
    }
    setManualBusy(false)
  }, [manualBusy, health.loading, metrics.loading, health.error, metrics.error, toast])

  // Subtle in-flight indicator, only when prior data stays on screen (polls).
  const refreshing = Boolean(health.data || metrics.data) && (health.loading || metrics.loading)

  // Page-head meta: live model identity — loaded champions from /health,
  // feature version from the drift snapshot served by /metrics.
  const metaParts = []
  if (health.data) {
    metaParts.push(`API ${health.data.status || 'unknown'}`)
    const loaded = health.data.models_loaded || {}
    const okCount = ['regression', 'classification'].filter((key) => loaded[key] === true).length
    metaParts.push(`models ${okCount}/2 loaded`)
  }
  const featureVersion = metrics.data?.drift?.reference_feature_version
  if (typeof featureVersion === 'string' && featureVersion) metaParts.push(`features ${featureVersion}`)

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Model Health</span>
        <h1 className="page-title">Live service &amp; drift</h1>
        <p className="page-desc">
          Is the scoring API up, how busy is it, and is the incoming traffic drifting away from
          the data the champions were trained on.
        </p>
        <p className="page-meta">
          {metaParts.length > 0 ? metaParts.join(' · ') : 'Connecting to the API…'}
        </p>
      </div>

      <div className="health-refresh">
        <p className="health-refresh-meta">
          Auto-refresh 30s · paused while tab hidden
          {statusUpdatedAt && ` · status ${clockTime(statusUpdatedAt)}`}
          {metricsUpdatedAt && ` · metrics ${clockTime(metricsUpdatedAt)}`}
          {/* Trailing slot: the visibility-hidden indicator must not push the
              meta text off the left gridline (WP-7c). */}
          <span className={`health-refreshing${refreshing ? ' is-active' : ''}`} aria-hidden="true">
            <span className="health-refreshing-dot" />
            Refreshing…
          </span>
        </p>
        <BusyButton
          className="btn btn-secondary btn-sm"
          busy={manualBusy}
          busyLabel="Refreshing…"
          onClick={handleRefresh}
        >
          Refresh now
        </BusyButton>
      </div>
      <p className="note health-caveat">
        Counters are per-process and reset on restart; drift is a file snapshot, not a live stream.
      </p>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Service status</h2>
          <span className="section-note">GET /health · live liveness</span>
        </div>
        <ServiceStatus health={health} metrics={metrics} />
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Live traffic</h2>
          <span className="section-note">GET /metrics · per-process</span>
        </div>
        <TrafficTable metrics={metrics} />
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Feature drift</h2>
          <span className="section-note">GET /metrics → drift · file snapshot</span>
        </div>
        <DriftPanel metrics={metrics} />
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Prediction drift</h2>
          <span className="section-note">GET /metrics → drift · file snapshot</span>
        </div>
        <PredictionDrift metrics={metrics} />
      </section>

      <hr className="divider" />

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">What this page monitors</h2>
          <span className="section-note">methodology</span>
        </div>
        <MonitorNotes />
      </section>
    </div>
  )
}
