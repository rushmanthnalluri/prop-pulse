/**
 * MonitorNotes (SPEC §5.5): the "What this page monitors" methodology block —
 * one row per signal explaining exactly what it measures and where it comes
 * from, closing with the explicit "not shown" list. Static teaching copy;
 * every claim traces to the API contract (CONTRACT §1.1/§1.2/§5.13).
 */
export default function MonitorNotes() {
  return (
    <div className="monitor-list">
      <div className="monitor-row">
        <span className="monitor-label">Service status</span>
        <p>
          <code>GET /health</code> is live liveness. Startup fails hard if either champion artifact
          is missing, so a running server should always report both models loaded — anything less
          means the process is sick.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">Traffic counters</span>
        <p>
          <code>GET /metrics</code> counters live in process memory and reset on every restart. The
          error count covers HTTP 5xx responses only — validation 4xx rejections are not errors
          here — and average latency is a plain mean since process start, not a percentile.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">Drift report</span>
        <p>
          The drift block is a verbatim snapshot of <code>reports/drift/latest.json</code>,
          refreshed only when an operator runs <code>python -m ml.monitoring.drift_check</code>{' '}
          over the prediction log — it is not a live stream. PSI (Population Stability Index)
          compares each feature&apos;s recent distribution with the training reference; the
          warn/drift thresholds and minimum sample ship with each snapshot.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">Not shown</span>
        <p>
          No retraining trigger (no such endpoint exists — retraining is an operator action, this
          page carries the advisory flag only); no prediction-log volume or price stats (
          <code>logs/predictions.jsonl</code> exists, but no endpoint aggregates it); no latency
          percentiles (only the mean is served).
        </p>
      </div>
    </div>
  )
}
