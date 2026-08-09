/**
 * Engine status panel (SPEC §5.1-1, hero right rail): champion model badges +
 * versions and dataset provenance, sourced from GET /model/info (read once,
 * session-cached). Live API up/down is the Layout status pill's job — the page
 * does not re-poll /health (AUDIT §2.1/§9).
 *
 * A failed /model/info renders "Model details unavailable" with a retry —
 * never silent or fabricated badges (AUDIT §5.8).
 */
import { Link } from 'react-router'
import { ErrorState } from '../StateView'
import { formatDateTime, formatNumber } from '../../format'

const fin = (value) => Number.isFinite(Number(value))

/** `${name}_${version}` for a champion entry, or null when the shape drifts. */
function championTag(engine) {
  if (engine && typeof engine.name === 'string' && typeof engine.version === 'string') {
    return `${engine.name}_${engine.version}`
  }
  return null
}

export default function EngineStatusPanel({ info }) {
  const { data, loading, error, reload } = info
  const regression = championTag(data?.regression)
  const classification = championTag(data?.classification)
  const calibrated = data?.classification?.calibrated === true
  const simulated = data?.headline_metrics?.classification?.simulated_target === true

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Engine status</span>
      </div>
      <div className="panel-body" aria-live="polite">
        {loading && (
          <div aria-hidden="true">
            {[170, 200, 130, 90, 180, 160].map((width, i) => (
              <div className="skeleton sk-line" style={{ width }} key={i} />
            ))}
          </div>
        )}
        {!loading && error && (
          <ErrorState title="Model details unavailable" error={error} onRetry={reload} />
        )}
        {!loading && !error && data && (
          <dl className="kv">
            <div>
              <dt>Regression champion</dt>
              <dd>{regression ?? '—'}</dd>
            </div>
            <div>
              <dt>Classification champion</dt>
              <dd>
                {classification ?? '—'}{' '}
                {calibrated && <span className="badge badge-accent">Calibrated</span>}{' '}
                {simulated && <span className="badge badge-warn">Simulated target</span>}
              </dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{typeof data.dataset_version === 'string' ? data.dataset_version : '—'}</dd>
            </div>
            <div>
              <dt>Features</dt>
              <dd>{fin(data.n_features) ? formatNumber(data.n_features, 0) : '—'}</dd>
            </div>
            <div>
              <dt>Feature version</dt>
              <dd>
                {typeof data.feature_version === 'string' ? data.feature_version : '—'}
              </dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>{formatDateTime(data.selected_at)}</dd>
            </div>
          </dl>
        )}
      </div>
      <div className="panel-foot">
        <Link to="/model">Model details →</Link>
      </div>
    </div>
  )
}
