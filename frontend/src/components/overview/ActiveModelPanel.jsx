/**
 * "Active model" panel (blueprint §8.1-2, hero right rail): the reference's
 * "Active dataset" panel rebuilt around the regression champion — mono
 * name_version line (the reference's dataset-file slot), a `dl` of real
 * facts from GET /model/info (algorithm, sealed-test R²/RMSE, feature
 * count, training window), and the quiet "Inspect the model" link.
 *
 * The loading skeleton mirrors the loaded layout row-for-row (tag line,
 * provenance line, five two-column fact rows, footer link) so the panel
 * never jumps when the payload lands. The training window comes from the
 * frozen contract constant (TRAIN_SALE_WINDOW, CONTRACT §1.9) rather than a
 * literal string. A failed /model/info renders "Model details unavailable"
 * with a retry — never silent or fabricated facts (AUDIT §5.8).
 */
import { Link } from 'react-router'
import { ErrorState } from '../StateView'
import { TRAIN_SALE_WINDOW } from '../../constants'
import { championTag, formatDateTime, formatMetric, formatNumber, formatUsd } from '../../format'

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

const TRAINING_WINDOW_LABEL = `${TRAIN_SALE_WINDOW.start} – ${TRAIN_SALE_WINDOW.end}`

/** Skeleton mirroring the loaded panel body, row-for-row. */
function PanelBodySkeleton() {
  return (
    <div className="ov-panel-sk" aria-hidden="true">
      <div className="skeleton sk-line ov-panel-sk-tag" />
      <div className="skeleton sk-line ov-panel-sk-meta" />
      <div className="ov-panel-sk-facts">
        {[64, 52, 72, 58, 96].map((dtWidth, i) => (
          <div className="ov-panel-sk-fact" key={i}>
            <div className="skeleton sk-line" style={{ width: dtWidth }} />
            <div className="skeleton sk-line" style={{ width: 84 - i * 6 }} />
          </div>
        ))}
      </div>
      <div className="skeleton sk-line ov-panel-sk-link" />
    </div>
  )
}

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
        {loading && <PanelBodySkeleton />}
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
                <dd>{formatMetric(testMetrics.r2, 4)}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Test RMSE</dt>
                <dd>{formatUsd(testMetrics.rmse)}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Features</dt>
                <dd>{formatNumber(data.n_features, 0)}</dd>
              </div>
              <div className="dataset-fact">
                <dt>Training window</dt>
                <dd>{TRAINING_WINDOW_LABEL}</dd>
              </div>
            </dl>
          </>
        )}
        <Link className="section-link ov-panel-link" to="/model">
          Inspect the model
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 6h8M7 3l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>
    </aside>
  )
}
