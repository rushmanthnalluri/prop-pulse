/**
 * DriftPanel (SPEC §5.5-3): feature drift from GET /metrics → drift. The
 * current real state is status "no_data" — rendered as DriftEmpty, the
 * honest empty state; no PSI values are invented. When a snapshot with
 * status "ok" is served, this renders the full report in reference panel
 * language: a `.panel` whose head carries the status badge (the "Active
 * dataset" pattern), unboxed metric facts, the per-feature PSI ranking as
 * a dense `.table`, the drifted / warn / calendar feature chips, and the
 * advisory retraining flag (a flag only — no retraining endpoint exists).
 *
 * Headline PSI values get a PsiScale — a threshold-ticked micro bar under
 * the number so shift severity reads at a glance. The bar is the visual
 * twin of the printed thresholds; it never replaces them.
 */
import { finiteOr, formatDateTime, formatMetric, formatNumber, prettyFeature, psiLevel, psiTone } from '../../format'
import { ErrorState, PanelSkeleton } from '../StateView'
import DriftEmpty from './DriftEmpty'

/**
 * PsiScale — the visual twin of a PSI reading: a fill to the served value on
 * a track ticked at the snapshot's warn/drift thresholds, with the scale end
 * padded past the worse of the drift line or the reading. Pure presentation
 * of served numbers; the value and thresholds stay printed beside it, and
 * the aria-label repeats them for assistive tech. Shared with the
 * prediction-drift panel.
 */
export function PsiScale({ psi, warnThreshold, driftThreshold, label }) {
  if (!Number.isFinite(psi)) return null
  const end = Math.max(driftThreshold * 1.6, psi * 1.12, Number.EPSILON)
  const pct = (value) => `${Math.min(100, Math.max(0, (value / end) * 100))}%`
  const level = psiLevel(psi, warnThreshold, driftThreshold) || 'ok'
  return (
    <span
      className={`health-psi health-psi--${level}`}
      role="img"
      aria-label={`${label}: PSI ${formatMetric(psi)} — warn ≥ ${formatMetric(warnThreshold, 1)}, drift ≥ ${formatMetric(driftThreshold, 1)}`}
    >
      <span className="health-psi-fill" style={{ width: pct(psi) }} aria-hidden="true" />
      <span className="health-psi-tick health-psi-tick--warn" style={{ left: pct(warnThreshold) }} aria-hidden="true" />
      <span className="health-psi-tick health-psi-tick--drift" style={{ left: pct(driftThreshold) }} aria-hidden="true" />
    </span>
  )
}

/** Row status for the PSI table — threshold compare, no invented states. */
function PsiStatusBadge({ psi, warnThreshold, driftThreshold }) {
  if (psi >= driftThreshold) return <span className="badge badge-danger">Drift</span>
  if (psi >= warnThreshold) return <span className="badge badge-warn">Warn</span>
  return <span className="dim">—</span>
}

/** A labeled row of feature chips (badges) — drifted / warn / calendar lists. */
function FeatureChips({ label, features, badgeClass }) {
  if (!Array.isArray(features) || features.length === 0) return null
  return (
    <div className="health-block">
      <div className="health-block-label">{label}</div>
      <div className="legend">
        {features.map((feature) => (
          <span key={feature} className={`badge ${badgeClass}`} title={feature}>
            {prettyFeature(feature)}
          </span>
        ))}
      </div>
    </div>
  )
}

function FeatureDriftReport({ drift }) {
  const warnThreshold = finiteOr(drift.warn_threshold, 0.1)
  const driftThreshold = finiteOr(drift.psi_threshold, 0.2)
  const maxPsi = Number(drift.max_psi)
  const perFeature = drift.per_feature_psi
    ? Object.entries(drift.per_feature_psi)
        .map(([feature, psi]) => [feature, Number(psi)])
        .filter(([, psi]) => Number.isFinite(psi))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    : []
  const drifted = drift.drift_detected === true

  return (
    <div className="panel health-drift-panel">
      <div className="panel-head panel-head--raised">
        <h3 className="panel-title">Drift report</h3>
        {drifted ? (
          <span className="badge badge-danger">
            <span className="health-badge-dot" aria-hidden="true" />
            Drift detected
          </span>
        ) : (
          <span className="badge badge-success">
            <span className="health-badge-dot" aria-hidden="true" />
            Stable
          </span>
        )}
      </div>
      <div className="panel-body">
        <div className="metrics metrics--auto">
          <div className="metric">
            <div className="metric-value">{formatNumber(drift.n_predictions, 0)}</div>
            <div className="metric-label">Predictions in window</div>
            <div className="metric-hint">most recent scored</div>
          </div>
          <div className="metric">
            <div className={`metric-value${psiTone(maxPsi, warnThreshold, driftThreshold)}`}>
              {formatMetric(drift.max_psi)}
            </div>
            <div className="metric-label">Max PSI</div>
            <PsiScale
              psi={maxPsi}
              warnThreshold={warnThreshold}
              driftThreshold={driftThreshold}
              label="Max PSI"
            />
            <div className="metric-hint">
              warn ≥ {formatMetric(warnThreshold, 1)} · drift ≥ {formatMetric(driftThreshold, 1)}
            </div>
          </div>
          <div className="metric">
            <div className="metric-value">
              {drift.retraining_recommended === true ? (
                <span className="badge badge-warn">
                  <span className="health-badge-dot" aria-hidden="true" />
                  Recommended
                </span>
              ) : (
                <span className="badge badge-muted">
                  <span className="health-badge-dot" aria-hidden="true" />
                  Not recommended
                </span>
              )}
            </div>
            <div className="metric-label">Retraining</div>
            <div className="metric-hint">advisory flag — no trigger endpoint</div>
          </div>
          {drift.low_sample === true && (
            <div className="metric">
              <div className="metric-value">
                <span className="badge badge-warn">
                  <span className="health-badge-dot" aria-hidden="true" />
                  Low sample
                </span>
              </div>
              <div className="metric-label">Sample size</div>
              <div className="metric-hint">PSI indicative only</div>
            </div>
          )}
        </div>

        {perFeature.length > 0 && (
          <div className="health-block">
            <div className="health-block-label">
              Per-feature PSI — top {perFeature.length} by shift
            </div>
            <div className="table-scroll table-zebra">
              <table className="table">
                <caption className="visually-hidden">
                  Population Stability Index per model feature, highest shift first.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col" className="num">PSI</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {perFeature.map(([feature, psi]) => (
                    <tr key={feature}>
                      <td className="mono strong" title={feature}>
                        {prettyFeature(feature)}
                      </td>
                      <td
                        className={`num${
                          psi >= driftThreshold ? ' neg' : psi >= warnThreshold ? ' accent' : ''
                        }`}
                      >
                        {formatMetric(psi)}
                      </td>
                      <td>
                        <PsiStatusBadge
                          psi={psi}
                          warnThreshold={warnThreshold}
                          driftThreshold={driftThreshold}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <FeatureChips label="Drifted features" features={drift.drifted_features} badgeClass="badge-danger" />
        <FeatureChips label="Warn features" features={drift.warn_features} badgeClass="badge-warn" />
        <FeatureChips label="Calendar drift" features={drift.calendar_drift_features} badgeClass="badge-muted" />

        {typeof drift.recommendation_text === 'string' && drift.recommendation_text && (
          <p className="note health-section-note">{drift.recommendation_text}</p>
        )}
      </div>
      <div className="panel-foot">
        Snapshot generated {formatDateTime(drift.timestamp)}
        {Number.isFinite(Number(drift.window)) &&
          ` · window ${formatNumber(drift.window, 0)} predictions`}
        {typeof drift.reference_feature_version === 'string' &&
          drift.reference_feature_version &&
          ` · reference features ${drift.reference_feature_version}`}
      </div>
    </div>
  )
}

export default function DriftPanel({ metrics }) {
  const { data, loading, error, reload } = metrics

  if (loading && !data) return <PanelSkeleton height={260} />
  if (error && !data) {
    return (
      <ErrorState
        error={error}
        onRetry={reload}
        title={error.isNetworkError ? 'Backend unreachable' : 'Could not load the drift report'}
      />
    )
  }

  const drift = data?.drift && typeof data.drift === 'object' ? data.drift : {}
  if (drift.status !== 'ok') {
    return (
      <DriftEmpty
        drift={drift}
        detail="Feature drift answers one question: does live traffic still look like the data the
          champions were trained on? Nothing has been scored yet — so there are no PSI values to
          show, and none are invented."
        whatItems={[
          'PSI per model feature — a dense table, colored at the warn and drift thresholds',
          'Drifted, warn, and calendar-drift feature lists',
          'Max PSI, window sample size, and the retraining-recommendation flag',
        ]}
      />
    )
  }
  return <FeatureDriftReport drift={drift} />
}
