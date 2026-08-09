/**
 * Micro-market card (`.cluster-card`): clusterColor swatch + capitalized
 * label + 2-col stats grid (median price, $/sqft, sales, neighborhood count,
 * 30-day velocity). The velocity stat is full-width so the mandatory
 * `badge-muted` "simulated" (ADR-3) fits without wrapping.
 *
 * Renders as a Link when `to` is set (Overview cards → /market) or as a
 * toggleable button when `onClick` is set (Market rail → fly the map).
 * Every stat is Number.isFinite-guarded before formatting ('—' fallback).
 */
import { Link } from 'react-router'
import { clusterColor } from '../../constants'
import { formatNumber, formatPct, formatUsd } from '../../format'

const fin = (value) => Number.isFinite(Number(value))
const num = (value, digits) => (fin(value) ? formatNumber(value, digits) : '—')
const usd = (value) => (fin(value) ? formatUsd(value) : '—')

function ClusterCardBody({ cluster }) {
  const label =
    typeof cluster?.label === 'string' && cluster.label
      ? cluster.label
      : `Cluster ${cluster?.cluster_id ?? '?'}`
  // Guard before join (SPEC §7.3): the neighborhoods list may be absent.
  const hoodList = Array.isArray(cluster?.neighborhoods) ? cluster.neighborhoods : []
  return (
    <>
      <div className="cluster-card-head">
        <span
          className="swatch"
          style={{ backgroundColor: clusterColor(cluster?.cluster_id) }}
          aria-hidden="true"
        />
        <span className="cluster-card-name">{label}</span>
      </div>
      <div className="cluster-card-stats">
        <span>
          Median price <b>{usd(cluster?.median_price)}</b>
        </span>
        <span>
          $/sqft <b>{num(cluster?.median_price_per_sqft, 1)}</b>
        </span>
        <span>
          Sales <b>{num(cluster?.n_sales, 0)}</b>
        </span>
        <span title={hoodList.join(', ') || undefined}>
          Neighborhoods <b>{num(cluster?.n_neighborhoods, 0)}</b>
        </span>
        <span style={{ gridColumn: '1 / -1' }}>
          30-day velocity <b>{fin(cluster?.sale_velocity_30d) ? formatPct(cluster.sale_velocity_30d) : '—'}</b>{' '}
          <span className="badge badge-muted">simulated</span>
        </span>
      </div>
    </>
  )
}

export default function ClusterCard({ cluster, to = null, active = false, onClick }) {
  if (to) {
    return (
      <Link className="cluster-card" to={to}>
        <ClusterCardBody cluster={cluster} />
      </Link>
    )
  }
  return (
    <button
      type="button"
      className={`cluster-card${active ? ' active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <ClusterCardBody cluster={cluster} />
    </button>
  )
}
