/**
 * "Active model" panel (blueprint §8.1-2, hero right rail): the reference's
 * "Active dataset" panel rebuilt around the regression champion — mono
 * name_version line (the reference's dataset-file slot), a `dl` of real
 * facts from GET /model/info (algorithm, sealed-test R²/RMSE, feature
 * count, training window), and the quiet "Inspect the model →" link.
 *
 * The training window comes from the frozen contract constant
 * (TRAIN_SALE_WINDOW, CONTRACT §1.9) rather than a literal string. A failed
 * /model/info renders "Model details unavailable" with a retry — never
 * silent or fabricated facts (AUDIT §5.8).
 */
import { Link } from 'react-router'
import { ErrorState } from '../StateView'
import { TRAIN_SALE_WINDOW } from '../../constants'
import { formatDateTime, formatMetric, formatNumber, formatUsd } from '../../format'

const fin = (value) => Number.isFinite(Number(value))

/** `${name}_${version}` for a champion entry, or null when the shape drifts. */
function championTag(engine) {
  if (engine && typeof engine.name === 'string' && typeof engine.version === 'string') {
    return `${engine.name}_${engine.version}`
  }
  return null
}

/** Human label for a champion algorithm key; falls back to the raw name. */
const ALGORITHM_LABELS = {
  linear: 'Linear regression',
  ridge: 'Ridge regression',
  lasso: 'Lasso regression',
  logistic: 'Logistic regression',
  decision_tree: 'Decision tree',
  random_forest: 'Random forest',
  xgboost: 'XGBoost',
  dbscan: 'DBSCAN',
}

const TRAINING_WINDOW_LABEL = `${TRAIN_SALE_WINDOW.start} → ${TRAIN_SALE_WINDOW.end}`

export default function ActiveModelPanel({ info }) {
  const { data, loading, error, reload } = info
  const regression = data?.regression ?? {}
  const tag = championTag(data?.regression)
  const testMetrics = regression.test_metrics ?? {}
  const algorithm =
    typeof regression.name === 'string'
      ? (ALGORITHM_LABELS[regression.name] ?? regression.name)
      : '—'
  const datasetVersion =
    typeof data?.dataset_version === 'string' ? data.dataset_version : null

  return (
    <aside className="panel" aria-label="Active model">
      <div className="panel-head">
        <span className="panel-title">Active model</span>
        <span className="badge badge-accent">Champion</span>
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
          <>
            <span className="dataset-file">{tag ?? '—'}</span>
            <p className="ov-model-meta">
              {datasetVersion ? `dataset ${datasetVersion}` : 'dataset —'} · selected{' '}
              {formatDateTime(data.selected_at)}
            </p>
            <dl className="dataset-facts">
              <div className="dataset-fact">
                <dt>Algorithm</dt>
                <dd>{algorithm}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Test R²</dt>
                <dd>{fin(testMetrics.r2) ? formatMetric(testMetrics.r2, 4) : '—'}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Test RMSE</dt>
                <dd>{fin(testMetrics.rmse) ? formatUsd(testMetrics.rmse) : '—'}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Features</dt>
                <dd>{fin(data.n_features) ? formatNumber(data.n_features, 0) : '—'}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Training window</dt>
                <dd>{TRAINING_WINDOW_LABEL}</dd>
              </div>
            </dl>
          </>
        )}
        <Link className="section-link" to="/model">
          Inspect the model →
        </Link>
      </div>
    </aside>
  )
}
