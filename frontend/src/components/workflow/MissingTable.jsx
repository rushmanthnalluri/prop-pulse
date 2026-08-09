/**
 * MissingTable (WORKFLOW §6.3-04) — the sortable missing-value table fed by
 * `GET …/missing` → `columns[]`. One row per affected column: missing count,
 * percentage with a horizontal bar, and the REAL treatment the cleaning
 * pipeline will apply (badge + the policy-table name in mono), plus the
 * backend's plain-language note verbatim.
 *
 * Treatments/policies come straight from the payload (the NA policy tables of
 * ml/data/clean.py) — this component only maps them to badge labels.
 */
import { formatNumber } from '../../format'
import useSortable from '../shared/useSortable'
import SortHeader from '../shared/SortHeader'

/** treatment (§3.6) → badge label. */
const TREATMENTS = {
  fill_absent_token: 'Fill with "None"',
  fill_zero: 'Fill with 0',
  impute_neighborhood_median: 'Neighbourhood median',
  impute_train_mode: 'Train-split mode',
}

export default function MissingTable({ columns }) {
  const { sorted, sort, toggleSort } = useSortable(columns ?? [])
  if (!columns || columns.length === 0) return null
  return (
    <div className="table-scroll table-scroll--tall" tabIndex={0}>
      <table className="table table-sticky">
        <thead>
          <tr>
            <SortHeader label="Feature" sortKey="name" sort={sort} onToggle={toggleSort} />
            <SortHeader
              label="Missing"
              sortKey="n_missing"
              numeric
              sort={sort}
              onToggle={toggleSort}
            />
            <SortHeader
              label="Missing %"
              sortKey="pct_missing"
              numeric
              sort={sort}
              onToggle={toggleSort}
            />
            <SortHeader
              label="Pipeline treatment"
              sortKey="treatment"
              sort={sort}
              onToggle={toggleSort}
            />
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((col) => (
            <tr key={col.name}>
              <td>
                <span className="mono wfe-feat-name">{col.name}</span>
              </td>
              <td className="num">{formatNumber(col.n_missing, 0)}</td>
              <td className="num">
                <span className="wfe-mbar-cell">
                  <span className="wfe-mbar">
                    <span
                      className="wfe-mbar-fill"
                      style={{ width: `${Math.min(100, Math.max(0, col.pct_missing))}%` }}
                    />
                  </span>
                  {formatNumber(col.pct_missing, 1)}%
                </span>
              </td>
              <td>
                <span className="badge badge-accent">
                  {TREATMENTS[col.treatment] ?? col.treatment ?? '—'}
                </span>
                <span className="wfe-policy mono">{col.policy}</span>
              </td>
              <td className="wfe-note-cell">{col.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
