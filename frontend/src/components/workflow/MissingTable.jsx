/**
 * MissingTable (blueprint §8.5) — the repair table fed by
 * `GET …/missing` → `columns[]`. One row per affected column, in the
 * payload's own order (most-affected first): missing count, % of rows, the
 * REAL treatment the cleaning pipeline will apply (badge + the policy-table
 * name in mono — the honest analogue of the reference's "imputed mean"
 * column, which the PropPulse payload does not compute), and the coverage
 * bar "x% → 100%" (non-null share today → full after repair).
 *
 * Treatments/policies come straight from the payload (the NA policy tables
 * of ml/data/clean.py) — this component only maps them to badge labels. No
 * client-side sorting: the payload order is the meaningful one (blueprint
 * §5 — wide tables scroll, they do not sort).
 */
import { formatNumber } from '../../format'

/** treatment (§3.6) → badge label. */
const TREATMENTS = {
  fill_absent_token: 'Fill with "None"',
  fill_zero: 'Fill with 0',
  impute_neighborhood_median: 'Neighborhood median',
  impute_train_mode: 'Train-split mode',
}

export default function MissingTable({ columns }) {
  if (!columns || columns.length === 0) return null
  return (
    <div className="table-scroll" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Column</th>
            <th scope="col" className="num">
              Missing
            </th>
            <th scope="col" className="num">
              % of rows
            </th>
            <th scope="col">Treatment</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => {
            const coverage = Math.min(100, Math.max(0, 100 - (Number(col.pct_missing) || 0)))
            return (
              <tr key={col.name}>
                <td className="mono strong">{col.name}</td>
                <td className="num">{formatNumber(col.n_missing, 0)}</td>
                <td className="num dim">{formatNumber(col.pct_missing, 1)}%</td>
                <td>
                  <span className="badge badge-accent">
                    {TREATMENTS[col.treatment] ?? col.treatment ?? '—'}
                  </span>
                  <span className="wfm-policy mono">{col.policy}</span>
                </td>
                <td>
                  <span className="coverage">
                    <span className="coverage-track">
                      <span
                        className="coverage-fill"
                        style={{ '--w': `${coverage}%` }}
                      />
                    </span>
                    <span className="coverage-pct">{formatNumber(coverage, 1)}% → 100%</span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
