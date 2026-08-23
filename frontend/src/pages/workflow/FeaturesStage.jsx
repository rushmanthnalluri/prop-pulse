/**
 * FeaturesStage (WORKFLOW §6.3-02, blueprint §8.3) — stage 02 of the guided
 * workbench: the field registry of the active dataset over
 * `GET /workflow/datasets/{id}/features`.
 *
 * Structure (reference §8.3, adapted to the real payload): page-head
 * (kicker "Stage 02 · Records" / h1 / desc + the reference's "Dataset · name
 * (bundled default)" page-meta) → divider → bare metrics grid-3 (Fields per
 * record / Numeric / Categorical, counted from `raw_features`) → Prediction
 * objectives (TargetCards — carries the structural ADR-3 SimulatedBadge; the
 * objective itself is chosen at stage 07) → the registry: one
 * `.registry-group` per family via FeatureTable (raw + pipeline-derived).
 *
 * An empty `raw_features` "can't happen" on a validated dataset (§6.3-02) but
 * is specced anyway per UX §7.
 */
import { useCallback } from 'react'
import { getFeatures } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import TargetCards from '../../components/workflow/TargetCards'
import FeatureTable from '../../components/workflow/FeatureTable'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-features.css'

export default function FeaturesStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchFeatures = useCallback((signal) => getFeatures(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchFeatures)

  if (loading && !data) return <PageSkeleton />

  const raw = (data?.raw_features ?? []).filter(Boolean)
  const numericCount = raw.filter((f) => f?.dtype === 'numeric').length
  const categoricalCount = raw.length - numericCount

  const pageMeta = dataset
    ? `Dataset · ${dataset.name}${dataset.source === 'bundled' && !dataset.name.endsWith('(bundled)') ? ' (bundled default)' : ''}`
    : 'Loading dataset record…'

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 02 · Records</span>
        <h1 className="page-title">Analyze Features</h1>
        <p className="page-desc">
          Every column in the record — its type, pipeline role, coverage, and sample values —
          before any analysis begins.
        </p>
        <p className="page-meta">{pageMeta}</p>
      </div>

      <hr className="divider" />

      {error && !data ? (
        <div className="section">
          <ErrorState error={error} onRetry={reload} title="Couldn't load the feature analysis" />
        </div>
      ) : (
        <>
          <section className="section pb-8">
            <div className="metrics grid-3">
              <div className="metric">
                <span className="metric-value">{formatNumber(raw.length, 0)}</span>
                <span className="metric-label">Fields per record</span>
              </div>
              <div className="metric">
                <span className="metric-value">{formatNumber(numericCount, 0)}</span>
                <span className="metric-label">Numeric</span>
              </div>
              <div className="metric">
                <span className="metric-value">{formatNumber(categoricalCount, 0)}</span>
                <span className="metric-label">Categorical</span>
              </div>
            </div>
          </section>

          <section className="section pt-12 pb-8">
            <div className="section-head">
              <h2 className="section-title">Prediction objectives</h2>
              <span className="section-note">objective is chosen at stage 07</span>
            </div>
            <TargetCards targets={data?.targets} />
          </section>

          <section className="section pt-12">
            {raw.length === 0 ? (
              <EmptyState
                kicker="No features"
                title="This dataset reported no columns"
                detail="A validated dataset always carries the 81 Ames columns — if you see this, the features endpoint returned an unexpected response."
              >
                <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
                  Reload analysis
                </button>
              </EmptyState>
            ) : (
              <FeatureTable features={raw} pipelineFeatures={data?.pipeline_features ?? []} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
