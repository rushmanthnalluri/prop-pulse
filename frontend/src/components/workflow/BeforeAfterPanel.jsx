/**
 * BeforeAfterPanel (WORKFLOW §6.3-06) — the stage-06 before/after evidence,
 * in the reference's panel language (blueprint §5): an unboxed delta-metric
 * row (value over label, hairline-separated) followed by two .panel sample
 * tables side by side (panel-head title + mono tag, flush .table-scroll
 * body). Every number comes straight from the PrepareReport (`before`,
 * `after`, `sample_before`, `sample_after`) — nothing is computed
 * client-side.
 */
import { formatNumber } from '../../format'

/** One before → after metric cell ("1,460 → 1,455"), value over label. */
function DeltaMetric({ label, before, after, warnWhenPositive = false }) {
  const changed = before !== after
  const delta = Number(after) - Number(before)
  const signedDelta =
    changed && Number.isFinite(delta)
      ? `${delta > 0 ? '+' : ''}${formatNumber(delta, 0)}`
      : null
  const cls =
    warnWhenPositive && Number(after) > 0
      ? 'metric-value metric-value--warn'
      : 'metric-value'
  return (
    <div className="metric">
      <div className={cls}>
        {formatNumber(before, 0)} <span className="wfpp-delta-arrow">→</span>{' '}
        {formatNumber(after, 0)}
      </div>
      <div className="metric-label">{label}</div>
      <div className="metric-hint">
        {signedDelta !== null
          ? `${signedDelta} · changed by the pipeline`
          : changed
            ? 'changed by the pipeline'
            : 'unchanged'}
      </div>
    </div>
  )
}

/** Compact 5-row sample panel; columns are the union of keys across rows. */
function SamplePanel({ title, tag, rows }) {
  const head = (
    <div className="panel-head">
      <span className="panel-title">{title}</span>
      {tag && <span className="chart-tag">{tag}</span>}
    </div>
  )
  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="panel wfpp-sample">
        {head}
        <div className="panel-body">
          <p className="note note-flush">No sample rows in the report.</p>
        </div>
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
    <div className="panel wfpp-sample">
      {head}
      <div className="table-scroll borderless table-zebra">
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
    <div className="wfpp-beforeafter">
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
      <div className="wfpp-sample-grid">
        <SamplePanel
          title="Raw sample"
          tag="first 5 rows · key columns"
          rows={report.sample_before}
        />
        <SamplePanel
          title="Prepared train sample"
          tag="first 5 rows · key columns"
          rows={report.sample_after}
        />
      </div>
    </div>
  )
}
