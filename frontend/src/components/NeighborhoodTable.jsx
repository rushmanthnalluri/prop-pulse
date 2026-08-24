/**
 * Neighborhood directory (SPEC §5.3/§7.6): one sortable row per neighborhood,
 * reusing the same /market/clusters payload as the map (no second fetch).
 * Price columns are CLUSTER-level medians joined by cluster_id — the API
 * serves no per-neighborhood medians (the table caption says so, CONTRACT §3).
 * `fallback` assignments (nearest-market, ADR-2) carry a `badge-warn`
 * "approx." chip — informative, not an alarm. Every row links to the
 * valuation form via the `?neighborhood=` prefill handshake (AUDIT §6.11).
 *
 * Find-as-you-type (premium pass): the directory data is fully client-side,
 * so the toolbar searches (name / code / micro-market label) and filters
 * (micro-market chips, toggle to clear) without a round-trip. The live count
 * is a polite status region; zero matches swap the table for an empty state
 * with a clear-filters action. Filtering never touches sort state.
 *
 * Sorting (useSortable + SortHeader): click cycles asc → desc → natural
 * (natural = API order); `aria-sort` on the <th>; numeric columns sort
 * numerically and right-align. The wrapper scrolls horizontally (reference
 * wide tables scroll, never reflow); the neighborhood column stays pinned
 * via the global .table-sticky + .sticky-col mechanism.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { clusterColor, clusterLabel } from '../constants'
import { formatNumber, formatUsd, isFiniteValue } from '../format'
import { EmptyState } from './StateView'
import useSortable from './shared/useSortable'
import SortHeader from './shared/SortHeader'

export default function NeighborhoodTable({ neighborhoods, clusterById }) {
  const [query, setQuery] = useState('')
  const [clusterFilter, setClusterFilter] = useState(null)

  // Flatten the cluster join into sortable row values once per payload change.
  const rows = useMemo(
    () =>
      (Array.isArray(neighborhoods) ? neighborhoods : [])
        .filter((n) => n?.neighborhood)
        .map((n) => {
          const cluster = clusterById?.[n.cluster_id]
          return {
            code: n.neighborhood,
            name: n.name ?? n.neighborhood,
            clusterLabel: clusterLabel(cluster ?? { cluster_id: n.cluster_id }),
            clusterId: n.cluster_id,
            medianPrice: isFiniteValue(cluster?.median_price) ? Number(cluster.median_price) : null,
            medianPpsf: isFiniteValue(cluster?.median_price_per_sqft)
              ? Number(cluster.median_price_per_sqft)
              : null,
            fallback: Boolean(n.fallback),
          }
        }),
    [neighborhoods, clusterById],
  )

  // Micro-market filter chips (label + member count), ordered by cluster id.
  const clusterOptions = useMemo(() => {
    const byKey = new Map()
    for (const row of rows) {
      const key = String(row.clusterId)
      const option = byKey.get(key)
      if (option) option.count += 1
      else byKey.set(key, { id: row.clusterId, label: row.clusterLabel, count: 1 })
    }
    return [...byKey.values()].sort((a, b) => {
      const aNum = Number(a.id)
      const bNum = Number(b.id)
      if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum
      return String(a.label).localeCompare(String(b.label))
    })
  }, [rows])

  // Text search spans the display name, the code, and the micro-market label,
  // so "stone", "StoneBr", and a market name all find the same row.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (clusterFilter !== null && String(row.clusterId) !== String(clusterFilter)) return false
      if (!q) return true
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.clusterLabel.toLowerCase().includes(q)
      )
    })
  }, [rows, query, clusterFilter])

  const { sorted, sort, toggleSort } = useSortable(filtered)

  const filtersActive = query.trim() !== '' || clusterFilter !== null
  const clearFilters = () => {
    setQuery('')
    setClusterFilter(null)
  }

  return (
    <>
      <div className="market-filter-bar">
        <div className="market-search">
          <svg
            className="market-search-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <input
            type="search"
            className="market-search-input"
            aria-label="Search neighborhoods"
            placeholder="Search name or code…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="market-filter-chips" role="group" aria-label="Filter by micro-market">
          <button
            type="button"
            className="market-chip-filter"
            aria-pressed={clusterFilter === null}
            onClick={() => setClusterFilter(null)}
          >
            All markets
            <span className="market-chip-n">{rows.length}</span>
          </button>
          {clusterOptions.map((option) => {
            const active = clusterFilter !== null && String(clusterFilter) === String(option.id)
            return (
              <button
                key={String(option.id)}
                type="button"
                className="market-chip-filter"
                aria-pressed={active}
                onClick={() => setClusterFilter(active ? null : option.id)}
              >
                <span
                  className="swatch"
                  style={{ backgroundColor: clusterColor(option.id) }}
                  aria-hidden="true"
                />
                <span className="capitalize">{option.label}</span>
                <span className="market-chip-n">{option.count}</span>
              </button>
            )
          })}
        </div>
        <div className="market-filter-meta">
          <p className="market-count" role="status">
            {filtersActive
              ? `${filtered.length} of ${rows.length} neighborhoods`
              : `${rows.length} neighborhoods`}
          </p>
          {filtersActive && (
            <button type="button" className="market-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          kicker="No matches"
          title="No neighborhoods match these filters"
          detail="Try a different name or code, or clear the search and micro-market filter."
        >
          <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
            Clear filters
          </button>
        </EmptyState>
      ) : (
        <div className="table-scroll table-scroll--tall">
          <table className="table table-sticky">
            <caption className="table-caption">
              Price stats are cluster-level medians — per-neighborhood medians are not served by the
              API.
            </caption>
            <thead>
              <tr>
                <SortHeader
                  label="Neighborhood"
                  sortKey="name"
                  sort={sort}
                  onToggle={toggleSort}
                  className="sticky-col"
                />
                <SortHeader label="Code" sortKey="code" sort={sort} onToggle={toggleSort} />
                <SortHeader
                  label="Micro-market"
                  sortKey="clusterLabel"
                  sort={sort}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Median price"
                  sortKey="medianPrice"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
                <SortHeader
                  label="Median $/sqft"
                  sortKey="medianPpsf"
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
                <th scope="col">Assignment</th>
                <th scope="col">
                  <span className="visually-hidden">Valuation</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.code}>
                  <td className="strong sticky-col">{row.name}</td>
                  <td className="mono dim">{row.code}</td>
                  <td>
                    <span className="legend-item">
                      <span
                        className="swatch"
                        style={{ backgroundColor: clusterColor(row.clusterId) }}
                        aria-hidden="true"
                      />
                      <span className="capitalize">{row.clusterLabel}</span>
                    </span>
                  </td>
                  <td className="num">{row.medianPrice !== null ? formatUsd(row.medianPrice) : '—'}</td>
                  <td className="num">
                    {row.medianPpsf !== null ? formatNumber(row.medianPpsf, 1) : '—'}
                  </td>
                  <td>
                    {row.fallback ? (
                      <span className="badge badge-warn">approx.</span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>
                    <Link
                      className="row-link"
                      to={`/valuation?neighborhood=${encodeURIComponent(row.code)}`}
                    >
                      Estimate value
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
