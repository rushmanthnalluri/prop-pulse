/**
 * MarketProfile (SPEC §5.3): the selected micro-market's profile panel —
 * typical (median) price, $/sqft, size (train sales + neighborhood count),
 * the member list with nearest-market (fallback) disclosure, and the
 * simulated-velocity caveat (ADR-3, identifiers humanized via humanizeNote). Renders a quiet placeholder
 * until a market is selected. Every stat is Number.isFinite-guarded ('—'
 * fallback); `members` arrives pre-joined from the page.
 */
import { Link } from 'react-router'
import { clusterColor } from '../../constants'
import { formatNumber, formatPct, formatUsd, humanizeNote } from '../../format'

const fin = (value) => Number.isFinite(Number(value))

export default function MarketProfile({ cluster, members = [] }) {
  if (!cluster) {
    return (
      <div className="market-profile market-profile--empty">
        <p className="note">
          Select a micro-market card or a map point to see the market profile — typical price,
          size, and member neighborhoods.
        </p>
      </div>
    )
  }

  const label =
    typeof cluster.label === 'string' && cluster.label
      ? cluster.label
      : `Cluster ${cluster.cluster_id}`
  const note = typeof cluster.note === 'string' && cluster.note ? cluster.note : null
  const fallbackMembers = members.filter((member) => member.fallback)
  const firstMember = members[0] ?? null

  return (
    <aside className="market-profile" aria-label={`Market profile: ${label}`}>
      <div className="market-profile-head">
        <span
          className="swatch"
          style={{ backgroundColor: clusterColor(cluster.cluster_id) }}
          aria-hidden="true"
        />
        <h3 className="market-profile-name">{label}</h3>
        <span className="badge badge-accent">selected market</span>
      </div>

      <div className="metrics metrics--auto market-profile-stats">
        <div className="metric">
          <div className="metric-label">Typical price (median)</div>
          <div className="metric-value">{fin(cluster.median_price) ? formatUsd(cluster.median_price) : '—'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Median $/sqft</div>
          <div className="metric-value">
            {fin(cluster.median_price_per_sqft) ? formatNumber(cluster.median_price_per_sqft, 1) : '—'}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Train sales</div>
          <div className="metric-value">{fin(cluster.n_sales) ? formatNumber(cluster.n_sales, 0) : '—'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Neighborhoods</div>
          <div className="metric-value">
            {fin(cluster.n_neighborhoods) ? formatNumber(cluster.n_neighborhoods, 0) : '—'}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">30-day velocity</div>
          <div className="metric-value">
            {fin(cluster.sale_velocity_30d) ? formatPct(cluster.sale_velocity_30d) : '—'}
          </div>
          <div className="metric-hint">
            <span className="badge badge-muted">simulated</span> fraction of train sales (ADR-3)
          </div>
        </div>
      </div>

      {members.length > 0 && (
        <div className="market-profile-members">
          <span className="metric-label">Member neighborhoods</span>
          <ul className="market-chips">
            {members.map((member) => (
              <li
                key={member.code}
                className="market-chip"
                title={member.fallback ? 'Nearest-market assignment (approx.)' : undefined}
              >
                {member.name}
                {member.fallback && <span className="badge badge-warn">nearest</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fallbackMembers.length > 0 && (
        <p className="note market-profile-note">
          {fallbackMembers.map((member) => member.name).join(', ')}{' '}
          {fallbackMembers.length === 1 ? 'sits' : 'sit'} between clusters — included here as{' '}
          {fallbackMembers.length === 1 ? 'a nearest-market assignment' : 'nearest-market assignments'}{' '}
          (ADR-2). The stats are the nearest market's; this is normal, not an error.
        </p>
      )}

      {note && <p className="note market-profile-note">{humanizeNote(note)}</p>}

      {firstMember && (
        <Link
          className="market-profile-cta"
          to={`/valuation?neighborhood=${encodeURIComponent(firstMember.code)}`}
          title={`Prefills the valuation form with ${firstMember.name}`}
        >
          Value a home in this market →
        </Link>
      )}
    </aside>
  )
}
