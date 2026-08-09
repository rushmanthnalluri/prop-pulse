/**
 * StatsStage (WORKFLOW §6.3-03) — stage 03 of the guided workbench:
 * descriptive statistics over `GET /workflow/datasets/{id}/stats`.
 *
 * Sections (single fetch; §6.4 states):
 *   1. Target spotlight — the SalePrice callout card (money-formatted mono
 *      stats + the "right-skewed — models use log1p" note verbatim).
 *   2. Numeric columns — sortable count/mean/std/min/p25/p50/p75/max table.
 *   3. Categorical columns — sortable count/unique/top/top-freq table.
 *
 * Column sets are exactly the payload's (§6.3-03) — stats the endpoint does
 * not compute (mode/variance/IQR) are not shown rather than derived.
 */
import { useCallback } from 'react'
import { getStats } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import {
  CategoricalStatsTable,
  NumericStatsTable,
  TargetSpotlight,
} from '../../components/workflow/StatsTables'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-eda.css'

export default function StatsStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchStats = useCallback((signal) => getStats(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchStats)

  if (loading && !data) return <PageSkeleton />

  const numeric = data?.numeric ?? []
  const categorical = data?.categorical ?? []
  const metaParts = dataset
    ? [
        dataset.name,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        ...(data
          ? [
              `${formatNumber(numeric.length, 0)} numeric · ${formatNumber(categorical.length, 0)} categorical`,
            ]
          : []),
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 03 · Descriptive Statistics</span>
        <h1 className="page-title">Descriptive statistics</h1>
        <p className="page-desc">
          The distribution of every column in the active dataset — central tendency, spread, and
          the most frequent categories — computed server-side on the raw rows.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      {error && !data ? (
        <div className="section">
          <ErrorState error={error} onRetry={reload} title="Couldn't load the statistics" />
        </div>
      ) : (
        <>
          <div className="wfe-banner-slot">
            <ProvenanceBanner
              provenance={{ dataset_name: dataset?.name ?? datasetId }}
              label="These statistics describe the active dataset — switch it from the dataset chip above."
            />
          </div>

          <div className="section">
            <div className="section-head">
              <span className="section-title">Prediction target</span>
              <span className="section-note">money values in USD</span>
            </div>
            {data?.target ? (
              <TargetSpotlight target={data.target} />
            ) : (
              <EmptyState
                kicker="No target"
                title="No SalePrice column"
                detail="The active dataset has no SalePrice column, so there is no regression target to summarise."
              />
            )}
          </div>

          <hr className="divider" />

          <div className="section">
            <div className="section-head">
              <span className="section-title">Numeric columns</span>
              <span className="section-note">{formatNumber(numeric.length, 0)} columns</span>
            </div>
            {numeric.length === 0 ? (
              <EmptyState
                kicker="No numeric columns"
                title="Nothing numeric to summarise"
                detail="The stats endpoint reported no numeric columns for this dataset."
              />
            ) : (
              <NumericStatsTable rows={numeric} />
            )}
          </div>

          <hr className="divider" />

          <div className="section">
            <div className="section-head">
              <span className="section-title">Categorical columns</span>
              <span className="section-note">{formatNumber(categorical.length, 0)} columns</span>
            </div>
            {categorical.length === 0 ? (
              <EmptyState
                kicker="No categorical columns"
                title="Nothing categorical to summarise"
                detail="The stats endpoint reported no categorical columns for this dataset."
              />
            ) : (
              <CategoricalStatsTable rows={categorical} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
