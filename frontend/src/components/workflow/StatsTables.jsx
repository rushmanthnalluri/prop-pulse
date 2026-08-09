/**
 * StatsTables (WORKFLOW §6.3-03) — the descriptive-statistics tables fed by
 * `GET …/stats`:
 *
 *   TargetSpotlight       the SalePrice callout card — mean/median/std/min/max
 *                         + quartiles formatted as money, with the API's
 *                         "right-skewed — models use log1p" note verbatim.
 *   NumericStatsTable     count/mean/std/min/p25/p50/p75/max per numeric column
 *   CategoricalStatsTable count/unique/top/top-freq (+ share of non-missing)
 *                         per categorical column
 *
 * Both tables sort via useSortable + SortHeader (UX §7.6); numbers are
 * right-aligned tabular-nums (UX §2). Column sets are exactly the payload's —
 * variance/range/IQR are not in the contract, so they are not shown.
 */
import { formatNumber, formatUsd } from '../../format'
import useSortable from '../shared/useSortable'
import SortHeader from '../shared/SortHeader'

/** Compact stat display: grouped ≥1000, one decimal ≥100, two below. */
const fmtStat = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs >= 1000) return formatNumber(n, 0)
  if (abs >= 100) return formatNumber(n, 1)
  return formatNumber(n, 2)
}

/** SalePrice callout: the target's distribution at a glance (money formatting). */
export function TargetSpotlight({ target }) {
  if (!target) return null
  const stats = [
    { label: 'Mean', value: formatUsd(target.mean) },
    { label: 'Median', value: formatUsd(target.p50) },
    { label: 'Std dev', value: formatUsd(target.std) },
    { label: 'Min', value: formatUsd(target.min) },
    { label: 'Q1', value: formatUsd(target.p25) },
    { label: 'Q3', value: formatUsd(target.p75) },
    { label: 'Max', value: formatUsd(target.max) },
    { label: 'Rows', value: formatNumber(target.count, 0), money: false },
  ]
  return (
    <div className="wfe-spot">
      <div className="wfe-spot-head">
        <span className="wfe-target-kicker">Target spotlight</span>
        <h3 className="wfe-spot-title mono">{target.name}</h3>
      </div>
      <div className="wfe-spot-grid">
        {stats.map((stat) => (
          <div className="wfe-spot-stat" key={stat.label}>
            <span className="wfe-spot-label">{stat.label}</span>
            <span className="wfe-spot-value mono">{stat.value}</span>
          </div>
        ))}
      </div>
      {target.note && <p className="note wfe-spot-note">{target.note}</p>}
    </div>
  )
}

export function NumericStatsTable({ rows }) {
  const { sorted, sort, toggleSort } = useSortable(rows ?? [])
  if (!rows || rows.length === 0) return null
  return (
    <div className="table-scroll table-scroll--tall" tabIndex={0}>
      <table className="table table-sticky">
        <thead>
          <tr>
            <SortHeader label="Feature" sortKey="name" sort={sort} onToggle={toggleSort} />
            <SortHeader label="Count" sortKey="count" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Mean" sortKey="mean" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Std" sortKey="std" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Min" sortKey="min" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Q1" sortKey="p25" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Median" sortKey="p50" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Q3" sortKey="p75" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader label="Max" sortKey="max" numeric sort={sort} onToggle={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.name}>
              <td>
                <span className={`mono wfe-feat-name${row.name === 'SalePrice' ? ' strong' : ''}`}>
                  {row.name}
                </span>
                {row.name === 'SalePrice' && <span className="badge badge-accent">target</span>}
              </td>
              <td className="num">{formatNumber(row.count, 0)}</td>
              <td className="num">{fmtStat(row.mean)}</td>
              <td className="num">{fmtStat(row.std)}</td>
              <td className="num">{fmtStat(row.min)}</td>
              <td className="num">{fmtStat(row.p25)}</td>
              <td className="num">{fmtStat(row.p50)}</td>
              <td className="num">{fmtStat(row.p75)}</td>
              <td className="num">{fmtStat(row.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CategoricalStatsTable({ rows }) {
  const { sorted, sort, toggleSort } = useSortable(rows ?? [])
  if (!rows || rows.length === 0) return null
  return (
    <div className="table-scroll table-scroll--tall" tabIndex={0}>
      <table className="table table-sticky">
        <thead>
          <tr>
            <SortHeader label="Feature" sortKey="name" sort={sort} onToggle={toggleSort} />
            <SortHeader label="Count" sortKey="count" numeric sort={sort} onToggle={toggleSort} />
            <SortHeader
              label="Unique"
              sortKey="n_unique"
              numeric
              sort={sort}
              onToggle={toggleSort}
            />
            <SortHeader label="Top value" sortKey="top" sort={sort} onToggle={toggleSort} />
            <SortHeader
              label="Top freq"
              sortKey="top_freq"
              numeric
              sort={sort}
              onToggle={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const share =
              row.count > 0 && Number.isFinite(Number(row.top_freq))
                ? (Number(row.top_freq) / Number(row.count)) * 100
                : null
            return (
              <tr key={row.name}>
                <td>
                  <span className="mono wfe-feat-name">{row.name}</span>
                </td>
                <td className="num">{formatNumber(row.count, 0)}</td>
                <td className="num">{formatNumber(row.n_unique, 0)}</td>
                <td>
                  <span className="mono">{row.top ?? '—'}</span>
                </td>
                <td className="num">
                  {formatNumber(row.top_freq, 0)}
                  {share !== null && <span className="dim"> · {formatNumber(share, 1)}%</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
