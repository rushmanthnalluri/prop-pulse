/**
 * Neighborhood directory (SPEC §5.3/§7.6): one sortable row per neighborhood,
 * reusing the same /market/clusters payload as the map (no second fetch).
 * Price columns are CLUSTER-level medians joined by cluster_id — the API
 * serves no per-neighborhood medians (the table caption says so, CONTRACT §3).
 * `fallback` assignments (nearest-market, ADR-2) carry a `badge-warn`
 * "approx." chip — informative, not an alarm. Every row links to the
 * valuation form via the `?neighborhood=` prefill handshake (AUDIT §6.11).
 *
 * Sorting (useSortable + SortHeader): click cycles asc → desc → natural
 * (natural = API order); `aria-sort` on the <th>; numeric columns sort
 * numerically and right-align.
 */
import { useMemo } from 'react'
import { Link } from 'react-router'
import { clusterColor } from '../constants'
import { formatNumber, formatUsd } from '../format'
import useSortable from './shared/useSortable'
import SortHeader from './shared/SortHeader'

const fin = (value) => Number.isFinite(Number(value))

export default function NeighborhoodTable({ neighborhoods, clusterById }) {
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
            clusterLabel:
              typeof cluster?.label === 'string' && cluster.label
                ? cluster.label
                : `Cluster ${n.cluster_id}`,
            clusterId: n.cluster_id,
            medianPrice: fin(cluster?.median_price) ? Number(cluster.median_price) : null,
            medianPpsf: fin(cluster?.median_price_per_sqft)
              ? Number(cluster.median_price_per_sqft)
              : null,
            fallback: Boolean(n.fallback),
          }
        }),
    [neighborhoods, clusterById],
  )

  const { sorted, sort, toggleSort } = useSortable(rows)

  return (
    <div className="table-scroll table-scroll--tall">
      <table className="table table-sticky">
        <caption className="table-caption">
          Price stats are cluster-level medians — per-neighborhood medians are not served by the
          API.
        </caption>
        <thead>
          <tr>
            <SortHeader label="Neighborhood" sortKey="name" sort={sort} onToggle={toggleSort} />
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
              <td className="strong">{row.name}</td>
              <td className="mono dim">{row.code}</td>
              <td>
                <span className="legend-item">
                  <span
                    className="swatch"
                    style={{ backgroundColor: clusterColor(row.clusterId) }}
                    aria-hidden="true"
                  />
                  <span style={{ textTransform: 'capitalize' }}>{row.clusterLabel}</span>
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
                  Value a home here →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
