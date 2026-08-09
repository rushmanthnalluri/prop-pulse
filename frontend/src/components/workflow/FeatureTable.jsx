/**
 * FeatureTable (WORKFLOW §6.3-02) — the sortable, filterable inventory of a
 * dataset's raw features (`GET …/features` → `raw_features`). One row per
 * column: name, dtype, pipeline role, unique count, missing n/%, and a
 * summary cell (mean for numeric, top value for categorical). Sorting uses
 * useSortable + SortHeader (asc → desc → natural=API order, UX §7.6); the
 * toolbar filters by name substring and role.
 *
 * Each row expands into an inspect panel with the rest of the payload:
 * numeric min/mean/max, categorical top values (≤ 8, with counts), and the
 * role's meaning. Nothing is computed client-side beyond bar widths relative
 * to the largest top-value count.
 */
import { useMemo, useState } from 'react'
import { formatNumber } from '../../format'
import useSortable from '../shared/useSortable'
import SortHeader from '../shared/SortHeader'

/** Role → badge class + plain meaning (roles per §3.4 / ml/features/pipeline lists). */
const ROLES = {
  raw_input: { label: 'input', badge: 'badge-accent', note: 'Model input — raw column' },
  target: { label: 'target', badge: 'badge-warn', note: 'Prediction target — never an input' },
  identifier: { label: 'id', badge: 'badge-muted', note: 'Row identifier — never a model input' },
  excluded: { label: 'excluded', badge: 'badge-muted', note: 'Excluded from the feature pipeline' },
}

const roleMeta = (role) => ROLES[role] ?? { label: role ?? '—', badge: 'badge-muted', note: null }

/** Mean display: grouped thousands, one decimal below 1000. */
const fmtMean = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const n = Number(value)
  return Math.abs(n) >= 1000 ? formatNumber(n, 0) : formatNumber(n, 1)
}

function Chevron({ open }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(90deg)' : undefined }}
    >
      <path
        d="M3.5 2 6.5 5 3.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Expanded per-feature inspect panel (payload facts only). */
function FeatureDetail({ feature }) {
  const meta = roleMeta(feature.role)
  const topValues = Array.isArray(feature.top_values) ? feature.top_values : []
  const maxCount = topValues.reduce((max, tv) => Math.max(max, tv?.count ?? 0), 0) || 1
  return (
    <div className="wfe-feat-detail">
      <div className="wfe-feat-facts">
        <span>
          <span className="wfe-fact-label">Type</span> {feature.dtype}
        </span>
        <span>
          <span className="wfe-fact-label">Unique</span> {formatNumber(feature.n_unique, 0)}
        </span>
        <span>
          <span className="wfe-fact-label">Missing</span> {formatNumber(feature.n_missing, 0)} (
          {formatNumber(feature.missing_pct, 1)}%)
        </span>
        {feature.dtype === 'numeric' && (
          <>
            <span>
              <span className="wfe-fact-label">Mean</span> {fmtMean(feature.mean) ?? '—'}
            </span>
            <span>
              <span className="wfe-fact-label">Min</span> {fmtMean(feature.min) ?? '—'}
            </span>
            <span>
              <span className="wfe-fact-label">Max</span> {fmtMean(feature.max) ?? '—'}
            </span>
          </>
        )}
      </div>
      {meta.note && <p className="note">{meta.note}.</p>}
      {feature.dtype === 'categorical' && topValues.length > 0 && (
        <div className="wfe-topvals">
          <span className="wfe-fact-label">Top values</span>
          {topValues.map((tv) => (
            <div className="wfe-topval" key={String(tv?.value)}>
              <span className="wfe-topval-value mono" title={String(tv?.value)}>
                {String(tv?.value)}
              </span>
              <span className="wfe-topval-track">
                <span
                  className="wfe-topval-fill"
                  style={{ width: `${Math.max(2, ((tv?.count ?? 0) / maxCount) * 100)}%` }}
                />
              </span>
              <span className="wfe-topval-count mono">{formatNumber(tv?.count, 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FeatureTable({ features }) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('all')
  const [openName, setOpenName] = useState(null)

  const roles = useMemo(
    () => [...new Set((features ?? []).map((f) => f?.role).filter(Boolean))],
    [features],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (features ?? []).filter((f) => {
      if (!f) return false
      if (role !== 'all' && f.role !== role) return false
      if (needle && !String(f.name).toLowerCase().includes(needle)) return false
      return true
    })
  }, [features, query, role])

  const { sorted, sort, toggleSort } = useSortable(filtered)
  const total = features?.length ?? 0

  return (
    <div>
      <div className="wfe-toolbar">
        <div className="field wfe-toolbar-search">
          <label className="field-label" htmlFor="wfe-feat-search">
            Filter by name
          </label>
          <input
            id="wfe-feat-search"
            type="search"
            className="field-input"
            placeholder="e.g. GrLivArea"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wfe-feat-role">
            Role
          </label>
          <select
            id="wfe-feat-role"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="all">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleMeta(r).label} ({r})
              </option>
            ))}
          </select>
        </div>
        <span className="wfe-toolbar-count mono" aria-live="polite">
          {filtered.length === total
            ? `${formatNumber(total, 0)} columns`
            : `${formatNumber(filtered.length, 0)} of ${formatNumber(total, 0)} columns`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="note">
          No columns match “{query}” — clear the filter to see all {formatNumber(total, 0)}.
        </p>
      ) : (
        <div className="table-scroll table-scroll--tall" tabIndex={0}>
          <table className="table table-sticky">
            <thead>
              <tr>
                <th scope="col" className="wfe-chev-col" aria-label="Inspect" />
                <SortHeader label="Feature" sortKey="name" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Type" sortKey="dtype" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Role" sortKey="role" sort={sort} onToggle={toggleSort} />
                <SortHeader
                  label="Unique"
                  sortKey="n_unique"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Missing"
                  sortKey="n_missing"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Missing %"
                  sortKey="missing_pct"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Mean / top value"
                  sortKey="mean"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((feature) => {
                const open = openName === feature.name
                const meta = roleMeta(feature.role)
                const top =
                  Array.isArray(feature.top_values) && feature.top_values.length > 0
                    ? feature.top_values[0]
                    : null
                return [
                  <tr key={feature.name} className={open ? 'wfe-row-open' : undefined}>
                    <td className="wfe-chev-col">
                      <button
                        type="button"
                        className="wfe-chev"
                        aria-expanded={open}
                        aria-label={`Inspect ${feature.name}`}
                        onClick={() => setOpenName(open ? null : feature.name)}
                      >
                        <Chevron open={open} />
                      </button>
                    </td>
                    <td>
                      <span className="mono wfe-feat-name">{feature.name}</span>
                    </td>
                    <td className="dim">{feature.dtype}</td>
                    <td>
                      <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="num">{formatNumber(feature.n_unique, 0)}</td>
                    <td className="num">
                      {feature.n_missing > 0 ? (
                        formatNumber(feature.n_missing, 0)
                      ) : (
                        <span className="dim">0</span>
                      )}
                    </td>
                    <td className="num">
                      {feature.missing_pct > 0 ? (
                        `${formatNumber(feature.missing_pct, 1)}%`
                      ) : (
                        <span className="dim">0%</span>
                      )}
                    </td>
                    <td className="num">
                      {feature.dtype === 'numeric' ? (
                        (fmtMean(feature.mean) ?? <span className="dim">—</span>)
                      ) : top ? (
                        <span>
                          <span className="mono">{String(top.value)}</span>{' '}
                          <span className="dim">· {formatNumber(top.count, 0)}</span>
                        </span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>,
                  open && (
                    <tr key={`${feature.name}__detail`} className="wfe-detail-row">
                      <td colSpan={8}>
                        <FeatureDetail feature={feature} />
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
