/**
 * BeforeAfterPanel (WORKFLOW §6.3-06) — the stage-06 before/after evidence:
 * rows / columns / missing cells of the raw frame vs the persisted processed
 * splits, plus the first-five-row samples of each, side by side. Every number
 * comes straight from the PrepareReport (`before`, `after`, `sample_before`,
 * `sample_after`) — nothing is computed client-side.
 */
import { formatNumber } from '../../format'

/** One before → after metric cell ("1,460 → 1,455"). */
function DeltaMetric({ label, before, after, warnWhenPositive = false }) {
  const changed = before !== after
  const cls =
    warnWhenPositive && Number(after) > 0
      ? 'metric-value metric-value--warn'
      : 'metric-value'
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={cls}>
        {formatNumber(before, 0)} <span className="wf-delta-arrow">→</span>{' '}
        {formatNumber(after, 0)}
      </div>
      <div className="metric-hint">{changed ? 'changed by the pipeline' : 'unchanged'}</div>
    </div>
  )
}

/** Compact 5-row sample table; columns are the union of keys across rows. */
function SampleTable({ title, tag, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="wf-sample">
        <div className="chart-head">
          <span className="chart-title">{title}</span>
          {tag && <span className="chart-tag">{tag}</span>}
        </div>
        <p className="note">No sample rows in the report.</p>
      </div>
    )
  }
  const columns = []
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  return (
    <div className="wf-sample">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        {tag && <span className="chart-tag">{tag}</span>}
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} scope="col">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => {
                  const value = row?.[col]
                  const numeric = typeof value === 'number' && Number.isFinite(value)
                  return (
                    <td key={col} className={numeric ? 'num' : undefined}>
                      {value === null || value === undefined
                        ? '—'
                        : numeric
                          ? formatNumber(value, Number.isInteger(value) ? 0 : 1)
                          : String(value)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function BeforeAfterPanel({ report }) {
  if (!report?.before || !report?.after) return null
  const { before, after } = report
  return (
    <div className="wf-beforeafter">
      <div className="metrics metrics--3">
        <DeltaMetric label="Rows" before={before.n_rows} after={after.n_rows} />
        <DeltaMetric label="Columns" before={before.n_cols} after={after.n_cols} />
        <DeltaMetric
          label="Missing cells"
          before={before.total_missing}
          after={after.total_missing}
          warnWhenPositive
        />
      </div>
      <div className="wf-sample-grid">
        <SampleTable
          title="Raw sample"
          tag="first 5 rows · key columns"
          rows={report.sample_before}
        />
        <SampleTable
          title="Prepared train sample"
          tag="first 5 rows · key columns"
          rows={report.sample_after}
        />
      </div>
    </div>
  )
}
