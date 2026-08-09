/**
 * MetricsTable (SPEC §5.4-3): the validation vs sealed-test comparison shared
 * by the regression and classification champions. Each row carries a one-line
 * plain-English `hint` under the metric name (SPEC §1 — the UI teaches).
 * Values arrive pre-formatted by the caller (format.js '—' fallback keeps
 * NaN/undefined off screen). Tables scroll on small screens, never reflow
 * (SPEC §8).
 *
 *   <MetricsTable
 *     caption="Ridge regression champion, validation vs sealed test"
 *     rows={[{ label: 'R²', hint: 'share of variance explained', val: '0.928', test: '0.930' }]}
 *   />
 */
export default function MetricsTable({ rows, caption }) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  return (
    <div className="table-scroll">
      <table className="table insights-metrics">
        {caption && <caption className="visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col" className="num">Validation</th>
            <th scope="col" className="num">Sealed test</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="strong">
                {row.label}
                {row.hint && <span className="insights-metric-hint">{row.hint}</span>}
              </td>
              <td className="num">{row.val}</td>
              <td className="num">{row.test}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
