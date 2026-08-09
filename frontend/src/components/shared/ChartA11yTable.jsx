/**
 * ChartA11yTable (SPEC §7.8): every recharts chart gets `role="img"` + a
 * one-sentence aria-label PLUS this visually-hidden table of the exact
 * plotted values, so screen-reader users receive the data, not a summary.
 *
 *   <ChartA11yTable
 *     caption="Median sale price per micro-market by half-year"
 *     columns={[
 *       { key: 'period', label: 'Period' },
 *       { key: 'north', label: 'North', format: formatUsd },
 *     ]}
 *     rows={rows}
 *   />
 *
 * `columns`: { key, label, format? }[] — `format(value)` optional; raw
 * values render as-is, null/undefined as '—' (app-wide fallback).
 */
export default function ChartA11yTable({ caption, columns, rows }) {
  if (!Array.isArray(columns) || columns.length === 0 || !Array.isArray(rows)) {
    return null
  }
  return (
    <div className="visually-hidden">
      <table>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((col) => {
                const value = row?.[col.key]
                const text =
                  value == null ? '—' : col.format ? col.format(value) : String(value)
                return <td key={col.key}>{text}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
