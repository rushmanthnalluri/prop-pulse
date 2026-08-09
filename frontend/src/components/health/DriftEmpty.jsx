/**
 * DriftEmpty — the honest no_data state shared by the two drift sections
 * (SPEC §5.5-3, CONTRACT §5.13). The drift check has not run over live
 * traffic, so there are no PSI values to show — and none are invented.
 * Everything on screen is real: the served status, the snapshot's own
 * window/threshold config (rendered only when present), the verbatim
 * recommendation/detail text, the snapshot timestamp, and a teaching
 * preview of what the panel will report once traffic is scored.
 */
import { formatDateTime, formatMetric, formatNumber } from '../../format'
import { EmptyState } from '../StateView'

/** Facts rendered only when the served snapshot actually carries them. */
function snapshotFacts(drift) {
  const facts = []
  if (Number.isFinite(Number(drift.window))) {
    facts.push(['window', `${formatNumber(drift.window, 0)} predictions`])
  }
  if (Number.isFinite(Number(drift.warn_threshold))) {
    facts.push(['warn', `PSI ≥ ${formatMetric(drift.warn_threshold, 1)}`])
  }
  if (Number.isFinite(Number(drift.psi_threshold))) {
    facts.push(['drift', `PSI ≥ ${formatMetric(drift.psi_threshold, 1)}`])
  }
  if (Number.isFinite(Number(drift.min_sample_for_retraining))) {
    facts.push(['retrain sample', `≥ ${formatNumber(drift.min_sample_for_retraining, 0)}`])
  }
  return facts
}

export default function DriftEmpty({ drift, detail, whatItems }) {
  const status = typeof drift.status === 'string' && drift.status ? drift.status : 'no_data'
  const facts = snapshotFacts(drift)
  const report =
    typeof drift.recommendation_text === 'string' && drift.recommendation_text
      ? drift.recommendation_text
      : typeof drift.detail === 'string' && drift.detail
        ? drift.detail
        : null

  return (
    <EmptyState
      kicker={`Drift status — ${status}`}
      title="No scored traffic in the drift window yet"
      detail={detail}
    >
      {facts.length > 0 && (
        <div className="health-empty-facts">
          {facts.map(([label, value]) => (
            <span key={label}>
              <b>{label}</b> {value}
            </span>
          ))}
        </div>
      )}
      <p className="health-empty-cli">
        The drift report refreshes when an operator runs{' '}
        <code>python -m ml.monitoring.drift_check</code>.
      </p>
      <div className="health-empty-what">
        <div className="health-empty-what-title">What this panel will show</div>
        <ul>
          {whatItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      {report && <p className="note health-empty-report">Latest report: {report}</p>}
      {drift.timestamp && (
        <p className="note health-section-note">Snapshot {formatDateTime(drift.timestamp)}</p>
      )}
    </EmptyState>
  )
}
