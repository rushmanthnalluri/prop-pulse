/**
 * Micro-market card (`.cluster-card`): clusterColor swatch + capitalized
 * label + a hover/active chevron affordance + 2-col stats grid (median price, $/sqft, sales, neighborhood count,
 * 30-day velocity). The velocity stat is full-width so the mandatory
 * `badge-muted` "simulated" (ADR-3) fits without wrapping.
 *
 * Renders as a toggleable button (Market rail → fly the map).
 * Every stat is Number.isFinite-guarded before formatting ('—' fallback).
 */
import { clusterColor, clusterLabel } from '../../constants'
import { formatNumber, formatPct, formatUsd, isFiniteValue } from '../../format'

const num = (value, digits) => (isFiniteValue(value) ? formatNumber(value, digits) : '—')
const usd = (value) => (isFiniteValue(value) ? formatUsd(value) : '—')

function ClusterCardBody({ cluster }) {
  const label = clusterLabel(cluster)
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
        <svg
          className="card-chevron"
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
          <polyline points="9 6 15 12 9 18" />
        </svg>
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
          30-day velocity <b>{isFiniteValue(cluster?.sale_velocity_30d) ? formatPct(cluster.sale_velocity_30d) : '—'}</b>{' '}
          <span className="badge badge-muted">simulated</span>
        </span>
      </div>
    </>
  )
}

export default function ClusterCard({ cluster, active = false, onClick }) {
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
