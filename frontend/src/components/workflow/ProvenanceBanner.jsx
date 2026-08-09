/**
 * ProvenanceBanner (WORKFLOW §7 rules 2-3) — the sandbox-vs-champion honesty
 * banner carried by every sandbox result (stage-07 comparison tables,
 * stage-09 predictions). Renders the API's `provenance` block: the server
 * `label` verbatim ("Sandbox model — trained on your upload; not the
 * PropPulse champion.") plus a mono meta line naming the dataset, train/val
 * rows, and training time. Warn-dim wash per §6.3-09. Champion pages are
 * never annotated with it.
 *
 * Accepts both provenance shapes in the contract:
 *   predict: {source, dataset_id, dataset_name, trained_at, n_train_rows, label}
 *   models:  {dataset, n_train, n_val, simulated_target}
 *
 *   <ProvenanceBanner provenance={prediction.provenance} />
 *   <ProvenanceBanner provenance={models.provenance} label="Sandbox comparison — validation metrics only; the test split stays sealed." />
 */
import { formatDateTime, formatNumber } from '../../format'

const FALLBACK_LABEL = 'Sandbox model — trained in the ML workbench; not the PropPulse champion.'

export default function ProvenanceBanner({ provenance, label, className = '' }) {
  if (!provenance) return null
  const name = provenance.dataset_name ?? provenance.dataset ?? provenance.dataset_id ?? null
  const trainRows = provenance.n_train_rows ?? provenance.n_train ?? null
  const meta = [
    name,
    trainRows !== null ? `${formatNumber(trainRows, 0)} train rows` : null,
    provenance.n_val != null ? `${formatNumber(provenance.n_val, 0)} val` : null,
    provenance.trained_at ? `trained ${formatDateTime(provenance.trained_at)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`wf-prov${className ? ` ${className}` : ''}`} role="note">
      <span className="badge badge-warn wf-prov-badge">Sandbox</span>
      <div className="wf-prov-body">
        <span className="wf-prov-label">{label ?? provenance.label ?? FALLBACK_LABEL}</span>
        {meta && <span className="wf-prov-meta mono">{meta}</span>}
      </div>
    </div>
  )
}
