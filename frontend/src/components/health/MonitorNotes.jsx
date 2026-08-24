/**
 * MonitorNotes (SPEC §5.5): the "What this page monitors" methodology block —
 * one row per signal explaining exactly what it measures and where it comes
 * from, closing with the explicit "not shown" list. Static teaching copy;
 * every claim traces to the API contract (CONTRACT §1.1/§1.2/§5.13). Each row
 * leads with a quiet mono icon for scannability — chrome, not status.
 */

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export default function MonitorNotes() {
  return (
    <div className="monitor-list">
      <div className="monitor-row">
        <span className="monitor-label">
          <svg {...iconProps}>
            <polyline points="2.5 12 7 12 10 5 14 19 17 12 21.5 12" />
          </svg>
          Service status
        </span>
        <p>
          The API liveness endpoint reports live liveness. Startup fails hard if either champion
          artifact is missing, so a running server should always report both models loaded —
          anything less means the process is sick.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">
          <svg {...iconProps}>
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          Traffic counters
        </span>
        <p>
          Counters from the metrics endpoint live in process memory and reset on every restart.
          The error count covers HTTP 5xx responses only — validation 4xx rejections are not
          errors here — and average latency is a plain mean since process start, not a
          percentile.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">
          <svg {...iconProps}>
            <polyline points="22 6 13.5 14.5 8.5 9.5 2 17" />
            <polyline points="16 6 22 6 22 12" />
          </svg>
          Drift report
        </span>
        <p>
          The drift block is a verbatim snapshot of <code>reports/drift/latest.json</code>,
          refreshed only when an operator runs <code>python -m ml.monitoring.drift_check</code>{' '}
          over the prediction log — it is not a live stream. PSI (Population Stability Index)
          compares each feature&apos;s recent distribution with the training reference; the
          warn/drift thresholds and minimum sample ship with each snapshot.
        </p>
      </div>
      <div className="monitor-row">
        <span className="monitor-label">
          <svg {...iconProps}>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1.5" y1="1.5" x2="22.5" y2="22.5" />
          </svg>
          Not shown
        </span>
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
