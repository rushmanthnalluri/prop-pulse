/**
 * MissingStage (WORKFLOW §6.3-04) — stage 04 of the guided workbench:
 * missing-value analysis over `GET /workflow/datasets/{id}/missing`.
 *
 * Sections (single fetch; §6.4 states):
 *   1. Summary strip — total missing cells / columns affected / complete
 *      columns (the payload's own counts).
 *   2. Blocking alert — columns with missing values but NO documented NA
 *      policy land in `blocking`; cleaning cannot proceed until they are
 *      resolved, so they render as an error alert, not a table row.
 *   3. Affected columns — the sortable MissingTable with %-bars and the real
 *      pipeline treatment per column.
 *   4. Reading the treatments — NA="absent" semantics (PoolQC example with
 *      the payload's real numbers) + the honesty note that recommendations
 *      are the pipeline's fixed policy tables, not data-driven suggestions.
 *
 * Empty state: `total_missing === 0` renders a success panel (§6.3-04).
 */
import { useCallback } from 'react'
import { getMissing } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import MissingTable from '../../components/workflow/MissingTable'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-eda.css'

/** Blocking entries (missing values with no documented policy) — an error, per §6.3-04. */
function BlockingAlert({ blocking }) {
  if (!Array.isArray(blocking) || blocking.length === 0) return null
  return (
    <div className="alert alert-error" role="alert">
      <span className="alert-title">
        Cleaning is blocked for {blocking.length}{' '}
        {blocking.length === 1 ? 'column' : 'columns'}
      </span>
      These columns have missing values but no documented treatment policy, so the cleaning step
      (stage 06) would raise. Resolve them in the source CSV and re-upload.
      <ul className="wfe-blocking-list">
        {blocking.map((col) => (
          <li key={col?.name}>
            <span className="mono">{col?.name}</span> — {formatNumber(col?.n_missing, 0)} missing
            ({formatNumber(col?.pct_missing, 1)}%). {col?.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** NA="absent" semantics with the payload's own highest-profile example (PoolQC on Ames). */
function AbsentNote({ columns, nRows }) {
  const list = Array.isArray(columns) ? columns : []
  const example =
    list.find((col) => col?.name === 'PoolQC') ??
    list.find((col) => col?.treatment === 'fill_absent_token') ??
    null
  return (
    <div className="wfe-missing-notes">
      {example && (
        <p className="note">
          For most Ames columns a missing value means the feature is <em>absent</em>, not unknown:{' '}
          <span className="mono">{example.name}</span> is missing for{' '}
          {formatNumber(example.n_missing, 0)}
          {nRows ? ` of ${formatNumber(nRows, 0)}` : ''} rows (
          {formatNumber(example.pct_missing, 1)}%) because those homes simply have no pool — the
          pipeline encodes that as the literal category “None”, a real value the model can learn
          from.
        </p>
      )}
      <p className="note">
        These recommendations are policy-based: they are the fixed, documented NA rules of the
        cleaning pipeline (ml/data/clean.py), not data-driven suggestions. Stage 06 applies them
        fit on the training rows only.
      </p>
    </div>
  )
}

export default function MissingStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchMissing = useCallback((signal) => getMissing(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchMissing)

  if (loading && !data) return <PageSkeleton />

  const totalColumns =
    data != null ? (data.n_columns_with_missing ?? 0) + (data.n_complete_columns ?? 0) : null
  const metaParts = dataset
    ? [
        dataset.name,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        ...(data ? [`${formatNumber(data.total_missing, 0)} missing cells`] : []),
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 04 · Missing Values</span>
        <h1 className="page-title">Missing values</h1>
        <p className="page-desc">
          Where the gaps are, and exactly what the cleaning pipeline will do about each one —
          the treatments below are the pipeline&rsquo;s real policy tables, not generic advice.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      {error && !data ? (
        <div className="section">
          <ErrorState
            error={error}
            onRetry={reload}
            title="Couldn't load the missing-value analysis"
          />
        </div>
      ) : (
        <>
          <div className="wfe-banner-slot">
            <ProvenanceBanner
              provenance={{ dataset_name: dataset?.name ?? datasetId }}
              label="Missing-value analysis describes the active dataset — switch it from the dataset chip above."
            />
          </div>

          <div className="section">
            <div className="metrics metrics--3">
              <div className="metric">
                <div className="metric-label">Missing cells</div>
                <div className="metric-value">{formatNumber(data?.total_missing, 0)}</div>
                {totalColumns !== null && (
                  <div className="metric-hint">across {formatNumber(totalColumns, 0)} columns</div>
                )}
              </div>
              <div className="metric">
                <div className="metric-label">Columns affected</div>
                <div className="metric-value">
                  {formatNumber(data?.n_columns_with_missing, 0)}
                </div>
                {data?.blocking?.length > 0 && (
                  <div className="metric-hint">
                    {formatNumber(data.blocking.length, 0)} blocking cleaning
                  </div>
                )}
              </div>
              <div className="metric">
                <div className="metric-label">Complete columns</div>
                <div className="metric-value">
                  {formatNumber(data?.n_complete_columns, 0)}
                </div>
                {totalColumns !== null && (
                  <div className="metric-hint">of {formatNumber(totalColumns, 0)}</div>
                )}
              </div>
            </div>
          </div>

          {data?.blocking?.length > 0 && (
            <>
              <hr className="divider" />
              <div className="section">
                <BlockingAlert blocking={data.blocking} />
              </div>
            </>
          )}

          <hr className="divider" />

          <div className="section">
            <div className="section-head">
              <span className="section-title">Affected columns</span>
              {data?.columns?.length > 0 && (
                <span className="section-note">
                  {formatNumber(data.columns.length, 0)} with a documented treatment
                </span>
              )}
            </div>
            {data?.total_missing === 0 ? (
              <EmptyState
                kicker="Complete data"
                title="No missing values"
                detail="Every column of the active dataset is fully populated — the cleaning step has nothing to fill."
              />
            ) : (
              <MissingTable columns={data?.columns ?? []} />
            )}
          </div>

          {data?.total_missing > 0 && (
            <div className="section wfe-notes-section">
              <AbsentNote columns={data?.columns} nRows={dataset?.n_rows} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
