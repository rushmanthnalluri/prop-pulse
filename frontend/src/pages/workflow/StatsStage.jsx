/**
 * StatsStage (blueprint §8.4) — stage 03 of the guided workbench:
 * descriptive statistics over `GET /workflow/datasets/{id}/stats`.
 *
 * One section, matching the reference: "All numeric fields — centre, spread,
 * and range" as a `.table-scroll.scroll-68` sticky-header + sticky-first-col
 * table (Field, count, MEAN in .accent, std, min, 25%, 50%, 75%, max) fed by
 * the payload's `numeric[]`, with the footnote linking to stage 04. The
 * payload's SalePrice `target` entry marks its row with the amber "target"
 * badge and contributes its note ("right-skewed — models use log1p")
 * verbatim to the footnotes.
 *
 * The reference's second section ("Split by outcome") has no counterpart
 * here: the stats endpoint returns no per-group breakdown, and no other
 * frozen endpoint computes feature means by a sale-price or simulated-target
 * split — so the section is omitted rather than faked client-side.
 *
 * No client-side sorting: the reference's table language is plain sticky
 * headers over a tall scroll region (blueprint §5).
 */
import { useCallback } from 'react'
import { Link } from 'react-router'
import { getStats } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-stats.css'

/** Compact stat display: grouped ≥1000, one decimal ≥100, two below. */
const fmtStat = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs >= 1000) return formatNumber(n, 0)
  if (abs >= 100) return formatNumber(n, 1)
  return formatNumber(n, 2)
}

export default function StatsStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchStats = useCallback((signal) => getStats(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchStats)

  if (loading && !data) return <PageSkeleton />

  const numeric = data?.numeric ?? []
  const nCategorical = data?.categorical?.length ?? 0
  const targetName = data?.target?.name ?? null
  const nRows = dataset?.n_rows ?? null

  const metaParts = dataset
    ? [
        `Dataset · ${dataset.name}${dataset.source === 'bundled' ? (dataset.name.endsWith('(bundled)') ? '' : ' (bundled default)') : ' (uploaded)'}`,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        ...(data
          ? [
              `${formatNumber(numeric.length, 0)} numeric · ${formatNumber(nCategorical, 0)} categorical`,
            ]
          : []),
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 03 · Records</span>
        <h1 className="page-title">Descriptive Statistics</h1>
        <p className="page-desc">
          {data
            ? `Mean, median, spread, and range across the ${formatNumber(numeric.length, 0)} numeric fields of the active dataset — computed server-side on the raw rows.`
            : 'Mean, median, spread, and range across every numeric field of the active dataset — computed server-side on the raw rows.'}
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      <hr className="divider" />

      {error && !data ? (
        <div className="section">
          <ErrorState error={error} onRetry={reload} title="Couldn't load the statistics" />
        </div>
      ) : (
        <>
          <div className="wfs-banner-slot">
            <ProvenanceBanner
              provenance={{ dataset_name: dataset?.name ?? datasetId }}
              label="These statistics describe the active dataset — switch it from the dataset chip above."
            />
          </div>

          <div className="section">
            <div className="section-head">
              <span className="section-title">
                All numeric fields — centre, spread, and range
              </span>
              <span className="section-note">
                {formatNumber(numeric.length, 0)} fields
              </span>
            </div>
            {numeric.length === 0 ? (
              <EmptyState
                kicker="No numeric fields"
                title="Nothing numeric to summarise"
                detail="The stats endpoint reported no numeric columns for this dataset — a valid house-records file brings its own."
              >
                <Link
                  className="btn btn-secondary btn-sm wfs-empty-cta"
                  to={`/workflow/01-upload?dataset=${datasetId}`}
                >
                  Review the upload
                </Link>
              </EmptyState>
            ) : (
              <>
                <div className="table-scroll scroll-68" tabIndex={0}>
                  <table className="table table-sticky">
                    <thead>
                      <tr>
                        <th scope="col" className="sticky-col">
                          Field
                        </th>
                        <th scope="col" className="num">
                          count
                        </th>
                        <th scope="col" className="num accent">
                          mean
                        </th>
                        <th scope="col" className="num">
                          std
                        </th>
                        <th scope="col" className="num">
                          min
                        </th>
                        <th scope="col" className="num">
                          25%
                        </th>
                        <th scope="col" className="num">
                          50%
                        </th>
                        <th scope="col" className="num">
                          75%
                        </th>
                        <th scope="col" className="num">
                          max
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {numeric.map((row) => (
                        <tr key={row.name}>
                          <td className="sticky-col mono strong">
                            {row.name}
                            {row.name === targetName && (
                              <span className="badge badge-accent badge-offset">target</span>
                            )}
                          </td>
                          <td className="num dim">{formatNumber(row.count, 0)}</td>
                          <td className="num accent">{fmtStat(row.mean)}</td>
                          <td className="num">{fmtStat(row.std)}</td>
                          <td className="num dim">{fmtStat(row.min)}</td>
                          <td className="num dim">{fmtStat(row.p25)}</td>
                          <td className="num">{fmtStat(row.p50)}</td>
                          <td className="num dim">{fmtStat(row.p75)}</td>
                          <td className="num dim">{fmtStat(row.max)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="wfs-notes">
                  {data?.target?.note && (
                    <p className="note">
                      <span className="mono">{data.target.name}</span> — {data.target.note}.
                    </p>
                  )}
                  <p className="note">
                    {nRows
                      ? `Counts below the ${formatNumber(nRows, 0)}-row total reflect missing values in the raw file — see `
                      : 'Counts below the row total reflect missing values in the raw file — see '}
                    <Link to={`/workflow/04-missing?dataset=${datasetId}`}>Missing Values</Link>.
                  </p>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
