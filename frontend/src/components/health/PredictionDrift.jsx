/**
 * PredictionDrift (SPEC §5.5-3, second half): drift of the model's own
 * outputs — estimated price and sale probability — from GET /metrics →
 * drift.prediction_psi. Under the current "no_data" snapshot this renders
 * the same honest empty state as feature drift; with an "ok" snapshot it
 * reports both output PSIs with the snapshot's warn/drift thresholds, each
 * with a PsiScale (shared with the feature-drift panel) so shift severity
 * reads at a glance.
 */
import { finiteOr, formatDateTime, formatMetric, psiTone } from '../../format'
import { ErrorState, PanelSkeleton } from '../StateView'
import DriftEmpty from './DriftEmpty'
import { PsiScale } from './DriftPanel'

export default function PredictionDrift({ metrics }) {
  const { data, loading, error, reload } = metrics

  if (loading && !data) return <PanelSkeleton height={160} />
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
        detail="Output drift can surface before feature drift — the model's answers move even while
          individual inputs still look stable. Nothing has been scored yet, so there are no PSI
          values to show, and none are invented."
        whatItems={[
          'PSI of the estimated-price distribution vs the training reference',
          'PSI of the sale-probability distribution vs the training reference',
        ]}
      />
    )
  }

  const warnThreshold = finiteOr(drift.warn_threshold, 0.1)
  const driftThreshold = finiteOr(drift.psi_threshold, 0.2)
  const predictionPsi =
    drift.prediction_psi && typeof drift.prediction_psi === 'object' ? drift.prediction_psi : null
  const pricePsi = Number(predictionPsi?.estimated_price)
  const probabilityPsi = Number(predictionPsi?.probability)

  if (!predictionPsi || (!Number.isFinite(pricePsi) && !Number.isFinite(probabilityPsi))) {
    return (
      <p className="note">
        This snapshot does not include prediction PSI — output-drift values appear here when the
        drift check reports them.
      </p>
    )
  }

  return (
    <div className="panel health-drift-panel">
      <div className="panel-head panel-head--raised">
        <h3 className="panel-title">Output PSI vs training reference</h3>
        <span className="chart-tag">
          warn ≥ {formatMetric(warnThreshold, 1)} · drift ≥ {formatMetric(driftThreshold, 1)}
        </span>
      </div>
      <div className="panel-body">
        <div className="metrics metrics--auto">
          <div className="metric">
            <div className={`metric-value${psiTone(pricePsi, warnThreshold, driftThreshold)}`}>
              {formatMetric(predictionPsi.estimated_price)}
            </div>
            <div className="metric-label">Estimated price PSI</div>
            <PsiScale
              psi={pricePsi}
              warnThreshold={warnThreshold}
              driftThreshold={driftThreshold}
              label="Estimated price PSI"
            />
            <div className="metric-hint">distribution of scored prices</div>
          </div>
          <div className="metric">
            <div className={`metric-value${psiTone(probabilityPsi, warnThreshold, driftThreshold)}`}>
              {formatMetric(predictionPsi.probability)}
            </div>
            <div className="metric-label">Sale probability PSI</div>
            <PsiScale
              psi={probabilityPsi}
              warnThreshold={warnThreshold}
              driftThreshold={driftThreshold}
              label="Sale probability PSI"
            />
            <div className="metric-hint">distribution of scored probabilities</div>
          </div>
        </div>
      </div>
      <div className="panel-foot">
        PSI over the model&rsquo;s output distributions vs the training reference — output shift is
        often the first visible sign of input drift. Snapshot generated{' '}
        {formatDateTime(drift.timestamp)}.
      </div>
    </div>
  )
}
