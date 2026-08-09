/**
 * FeaturesStage (WORKFLOW §6.3-02) — stage 02 of the guided workbench:
 * "analyse features" over `GET /workflow/datasets/{id}/features`.
 *
 * Sections (one fetch feeds all three; §6.4 states):
 *   1. Prediction objectives — TargetCards (regression / classification with
 *      the structural SimulatedBadge / clustering), availability + the API
 *      notes verbatim. Detection is REPORTED here; the objective is chosen
 *      at stage 07.
 *   2. Raw features — the sortable/filterable FeatureTable with per-feature
 *      inspect expansion (81 columns on any validated dataset).
 *   3. Pipeline-derived features — the engineered + neighborhood-stat columns
 *      the pipeline computes, collapsed by default and flagged as
 *      computed-not-raw.
 *
 * An empty `raw_features` "can't happen" on a validated dataset (§6.3-02) but
 * is specced anyway per UX §7.
 */
import { useCallback } from 'react'
import { getFeatures } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import TargetCards from '../../components/workflow/TargetCards'
import FeatureTable from '../../components/workflow/FeatureTable'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-eda.css'

/** Collapsible list of the pipeline-computed columns (engineered + neighborhood stats). */
function PipelineFeatures({ features }) {
  const items = Array.isArray(features) ? features : []
  if (items.length === 0) return null
  return (
    <details className="fieldset wfe-pipe">
      <summary>
        {formatNumber(items.length, 0)} pipeline-derived features — computed, not raw columns
      </summary>
      <p className="note wfe-pipe-note">
        {items[0]?.note ?? 'computed in the pipeline — not a raw column'}. They appear after
        preprocessing (stage 06), never in the raw CSV.
      </p>
      <ul className="wfe-pipe-list">
        {items.map((item) => (
          <li key={item?.name} className="wfe-pipe-item">
            <span className="mono">{item?.name}</span>
            <span
              className={`badge ${item?.role === 'engineered' ? 'badge-accent' : 'badge-muted'}`}
            >
              {item?.role === 'neighborhood_stat' ? 'neighborhood stat' : (item?.role ?? '—')}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function FeaturesStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchFeatures = useCallback((signal) => getFeatures(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchFeatures)

  if (loading && !data) return <PageSkeleton />

  const rawCount = data?.raw_features?.length ?? null
  const metaParts = dataset
    ? [
        dataset.name,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        ...(rawCount !== null
          ? [`${formatNumber(rawCount, 0)} raw columns analysed`]
          : []),
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 02 · Analyse Features</span>
        <h1 className="page-title">Feature analysis</h1>
        <p className="page-desc">
          Every raw column of the active dataset, its pipeline role, and the three modelling
          objectives the workbench can train toward.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      {error && !data ? (
        <div className="section">
          <ErrorState error={error} onRetry={reload} title="Couldn't load the feature analysis" />
        </div>
      ) : (
        <>
          <div className="wfe-banner-slot">
            <ProvenanceBanner
              provenance={{ dataset_name: dataset?.name ?? datasetId }}
              label="Feature analysis describes the active dataset — switch it from the dataset chip above."
            />
          </div>

          <div className="section">
            <div className="section-head">
              <span className="section-title">Prediction objectives</span>
              <span className="section-note">objective is chosen at stage 07</span>
            </div>
            <TargetCards targets={data?.targets} />
          </div>

          <hr className="divider" />

          <div className="section">
            <div className="section-head">
              <span className="section-title">Raw features</span>
              {rawCount !== null && (
                <span className="section-note">{formatNumber(rawCount, 0)} columns</span>
              )}
            </div>
            {rawCount === 0 ? (
              <EmptyState
                kicker="No features"
                title="This dataset reported no columns"
                detail="A validated dataset always carries the 81 Ames columns — if you see this, the features endpoint returned an unexpected payload."
              />
            ) : (
              <FeatureTable features={data?.raw_features ?? []} />
            )}
          </div>

          <hr className="divider" />

          <div className="section">
            <div className="section-head">
              <span className="section-title">Pipeline-derived features</span>
              <span className="section-note">computed-not-raw</span>
            </div>
            <PipelineFeatures features={data?.pipeline_features} />
          </div>
        </>
      )}
    </div>
  )
}
