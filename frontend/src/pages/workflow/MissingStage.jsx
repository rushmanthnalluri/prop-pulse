/**
 * MissingStage (blueprint §8.5) — stage 04 of the guided workbench:
 * missing-value analysis over `GET /workflow/datasets/{id}/missing`.
 *
 * Reference structure, adapted to the real payload:
 *   1. Metrics — Total cells / Missing cells (red when > 0) / Complete % /
 *      Columns affected. Total cells and completeness are derived from the
 *      dataset record's real n_rows × n_cols and the payload's
 *      total_missing — nothing is invented.
 *   2. Blocking alert — columns with missing values but NO documented NA
 *      policy land in `blocking`; cleaning (stage 06) would raise on them,
 *      so they render in the alert language, not as table rows.
 *   3. Chart card "Missing values per column" (tag "raw file · cells") —
 *      tall danger-red recharts bar chart over every gapped column
 *      (columns[] + blocking[]), chartTheme skin, role="img" +
 *      ChartA11yTable.
 *   4. "Repair — documented NA policies" — the reference's repair table
 *      adapted to the payload: the treatment badge + policy-table name
 *      stands in for the reference's "imputed mean" (the pipeline's real
 *      policies are fills/medians/modes, not mean imputation), coverage bar
 *      "x% → 100%". Closing notes: complete-columns count, NA="absent"
 *      semantics with the payload's own numbers and verbatim policy note,
 *      and the honesty line that these are the pipeline's fixed policy
 *      tables, not data-driven suggestions.
 *
 * Empty case: `total_missing === 0` replaces chart + repair with a designed
 * empty state (mono kicker + guidance + CTA to stage 05).
 */
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getMissing } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PageSkeleton } from '../../components/StateView'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import ChartA11yTable from '../../components/shared/ChartA11yTable'
import useReducedMotion from '../../components/shared/useReducedMotion'
import {
  CHART_PALETTE,
  MONO_FONT,
  cartesianGridProps,
  getAnimationProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../../components/shared/chartTheme'
import MissingTable from '../../components/workflow/MissingTable'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-missing.css'

/** Blocking entries (missing values with no documented policy) — an error. */
function BlockingAlert({ blocking }) {
  if (!Array.isArray(blocking) || blocking.length === 0) return null
  return (
    <div className="alert alert-error mt-28" role="alert">
      <span className="alert-title">
        Cleaning is blocked for {blocking.length}{' '}
        {blocking.length === 1 ? 'column' : 'columns'}
      </span>
      These columns have missing values but no documented treatment policy, so the cleaning step
      (stage 06) would raise. Resolve them in the source CSV and re-upload.
      <ul className="wfm-blocking-list">
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

export default function MissingStage() {
  const { datasetId, dataset } = useWorkflow()
  const fetchMissing = useCallback((signal) => getMissing(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetchMissing)
  const reduced = useReducedMotion()

  const columns = useMemo(
    () => (Array.isArray(data?.columns) ? data.columns : []),
    [data],
  )
  // The chart covers every gapped column — repairable and blocking alike —
  // most missing first (the payload's own ordering within each list).
  const chartRows = useMemo(
    () =>
      [...columns, ...(Array.isArray(data?.blocking) ? data.blocking : [])]
        .map((col) => ({
          name: col?.name ?? '—',
          missing: col?.n_missing ?? 0,
          pct: col?.pct_missing ?? 0,
        }))
        .sort((a, b) => b.missing - a.missing),
    [columns, data],
  )

  if (loading && !data) return <PageSkeleton />

  const nRows = dataset?.n_rows ?? null
  const totalCells =
    dataset?.n_rows != null && dataset?.n_cols != null ? dataset.n_rows * dataset.n_cols : null
  const completePct =
    data && totalCells ? Math.max(0, 100 * (1 - data.total_missing / totalCells)) : null
  const totalColumns =
    data != null ? (data.n_columns_with_missing ?? 0) + (data.n_complete_columns ?? 0) : null
  const absentExample =
    columns.find((col) => col?.name === 'PoolQC') ??
    columns.find((col) => col?.treatment === 'fill_absent_token') ??
    null

  const metaParts = dataset
    ? [
        `Dataset · ${dataset.name}${dataset.source === 'bundled' ? (dataset.name.endsWith('(bundled)') ? '' : ' (bundled default)') : ' (uploaded)'}`,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        ...(data ? [`${formatNumber(data.total_missing, 0)} missing cells`] : []),
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 04 · Records</span>
        <h1 className="page-title">Missing Values</h1>
        <p className="page-desc">
          {data
            ? data.total_missing > 0
              ? `${formatNumber(data.n_columns_with_missing, 0)} of the ${formatNumber(totalColumns, 0)} columns have gaps — measured here, then repaired by the cleaning pipeline's documented NA policies.`
              : 'Every column of the active dataset arrives complete — nothing for the cleaning pipeline to fill.'
            : 'Where the gaps are, and exactly what the cleaning pipeline will do about each one.'}
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      <hr className="divider" />

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
          <div className="wfm-banner-slot">
            <ProvenanceBanner
              provenance={{ dataset_name: dataset?.name ?? datasetId }}
              label="Missing-value analysis describes the active dataset — switch it from the dataset chip above."
            />
          </div>

          <div className="section">
            <div className="metrics">
              <div className="metric">
                <span className="metric-value">
                  {totalCells !== null ? formatNumber(totalCells, 0) : '—'}
                </span>
                <span className="metric-label">Total cells</span>
              </div>
              <div className="metric">
                <span
                  className={`metric-value${data?.total_missing > 0 ? ' text-danger' : ''}`}
                >
                  {formatNumber(data?.total_missing, 0)}
                </span>
                <span className="metric-label">Missing cells</span>
              </div>
              <div className="metric">
                <span className="metric-value">
                  {completePct !== null ? `${formatNumber(completePct, 1)}%` : '—'}
                </span>
                <span className="metric-label">Complete</span>
              </div>
              <div className="metric">
                <span className="metric-value">
                  {formatNumber(data?.n_columns_with_missing, 0)}
                </span>
                <span className="metric-label">Columns affected</span>
              </div>
            </div>

            {data?.blocking?.length > 0 && <BlockingAlert blocking={data.blocking} />}

            {data?.total_missing > 0 && (
              <div className="chart-card mt-36">
                <div className="chart-card-head">
                  <h3>Missing values per column</h3>
                  <span className="chart-tag">raw file · cells</span>
                </div>
                <div
                  className="chart-wrap chart-wrap-tall"
                  role="img"
                  aria-label={`Bar chart of missing cells per column — ${formatNumber(chartRows.length, 0)} columns with gaps`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                      <CartesianGrid {...cartesianGridProps} />
                      <XAxis
                        dataKey="name"
                        {...xAxisProps}
                        interval="preserveStartEnd"
                        minTickGap={28}
                      />
                      <YAxis
                        {...yAxisProps}
                        width={64}
                        allowDecimals={false}
                        tickFormatter={(v) => formatNumber(v, 0)}
                        label={{
                          value: 'missing cells',
                          angle: -90,
                          position: 'insideLeft',
                          style: {
                            fontFamily: MONO_FONT,
                            fontSize: 10,
                            fill: CHART_PALETTE.tick,
                            textAnchor: 'middle',
                          },
                        }}
                      />
                      <Tooltip
                        {...tooltipProps}
                        formatter={(value) => [`${formatNumber(value, 0)} cells`, 'missing']}
                      />
                      <Bar
                        dataKey="missing"
                        fill={CHART_PALETTE.dangerFill}
                        stroke={CHART_PALETTE.danger}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={48}
                        {...getAnimationProps(reduced)}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartA11yTable
                  caption="Missing cells per column (raw file)"
                  columns={[
                    { key: 'name', label: 'Column' },
                    { key: 'missing', label: 'Missing cells', format: (v) => formatNumber(v, 0) },
                    { key: 'pct', label: '% of rows', format: (v) => `${formatNumber(v, 1)}%` },
                  ]}
                  rows={chartRows}
                />
              </div>
            )}

            {data?.total_missing === 0 && (
              <div className="mt-36">
                <EmptyState
                  kicker="Complete data"
                  title="No missing values"
                  detail="Every column of the active dataset is fully populated — the cleaning step (stage 06) has nothing to fill."
                >
                  <Link
                    className="btn btn-primary btn-sm wfm-empty-cta"
                    to={`/workflow/05-viz?dataset=${datasetId}`}
                  >
                    Continue to stage 05 — Visualization →
                  </Link>
                </EmptyState>
              </div>
            )}
          </div>

          {data?.total_missing > 0 && (
            <>
              <hr className="divider" />

              <div className="section">
                <div className="section-head">
                  <span className="section-title">Repair — documented NA policies</span>
                  {columns.length > 0 && (
                    <span className="section-note">
                      {formatNumber(columns.length, 0)} columns treated
                    </span>
                  )}
                </div>
                <p className="section-sub">
                  Each gap is filled by the cleaning pipeline's fixed policy tables — never by a
                  rule invented here. Stage 06 applies them fit on the training rows only, so
                  nothing leaks from validation or test rows.
                </p>
                {columns.length > 0 ? (
                  <MissingTable columns={columns} />
                ) : (
                  <p className="note">
                    None of the affected columns has a documented treatment — resolve the blocked
                    columns above, then re-upload.
                  </p>
                )}
                <div className="wfm-notes">
                  {totalColumns !== null && (
                    <p className="note">
                      All other {formatNumber(data.n_complete_columns, 0)} columns arrive complete
                      — no action needed.
                    </p>
                  )}
                  {absentExample && (
                    <p className="note">
                      For most Ames columns a missing value means the feature is <em>absent</em>,
                      not unknown: <span className="mono">{absentExample.name}</span> is missing
                      for {formatNumber(absentExample.n_missing, 0)}
                      {nRows ? ` of ${formatNumber(nRows, 0)}` : ''} rows (
                      {formatNumber(absentExample.pct_missing, 1)}%). Pipeline policy:{' '}
                      {absentExample.note}.
                    </p>
                  )}
                  <p className="note">
                    These treatments are policy-based: the fixed, documented NA rules of the
                    cleaning pipeline (ml/data/clean.py), not data-driven suggestions. Stage 06
                    applies them fit on the training rows only.
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
