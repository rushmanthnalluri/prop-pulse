/**
 * MICRO-MARKET (SPEC §5.2.2-3): the subject neighborhood's DBSCAN cluster —
 * label, median price, median $/sqft, training-sale count, and the 30-day
 * sale velocity (warn-dotted: it is a descriptive fraction over the
 * SIMULATED target, ADR-3, and the contract `note` renders with raw schema
 * identifiers humanized — see format.js humanizeNote).
 * `fallback: true` means the neighborhood was DBSCAN noise resolved to the
 * nearest cluster — normal for NAmes/CollgCr/Timber (CONTRACT §5.6), so the
 * note informs rather than alarms.
 */
import { Link } from 'react-router'
import { NEIGHBORHOODS } from '../../constants'
import { formatNumber, formatPct, formatUsd, humanizeNote } from '../../format'

export default function MicroMarketCard({ microMarket, neighborhood }) {
  if (!microMarket) return null
  const pricePerSqft = Number(microMarket.median_price_per_sqft)
  const velocity = Number(microMarket.sale_velocity_30d)
  const match = NEIGHBORHOODS.find((n) => n.value === neighborhood)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Micro-market</span>
        {microMarket.fallback === true && (
          <span className="badge badge-muted">Nearest cluster</span>
        )}
      </div>
      <div className="panel-body">
        <p className="mm-label">{microMarket.label}</p>
        <dl className="kv">
          <div>
            <dt>Median price</dt>
            <dd>{formatUsd(microMarket.median_price)}</dd>
          </div>
          <div>
            <dt>Median $/sqft</dt>
            <dd>{Number.isFinite(pricePerSqft) ? `$${formatNumber(pricePerSqft)}` : '—'}</dd>
          </div>
          <div>
            <dt>30-day sale velocity</dt>
            <dd>
              {Number.isFinite(velocity) ? (
                <>
                  <span className="dot-warn" aria-hidden="true" />
                  {formatPct(velocity)}
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Training sales</dt>
            <dd>{formatNumber(microMarket.n_sales, 0)}</dd>
          </div>
        </dl>
        {microMarket.fallback === true && (
          <p className="note mm-note">
            {match?.label ?? 'This neighborhood'} sits between clusters — stats shown are the
            nearest cluster&apos;s.
          </p>
        )}
        {microMarket.note && <p className="note mm-note">{humanizeNote(microMarket.note)}</p>}
      </div>
      <div className="panel-foot">
        <Link to="/market">Explore this market →</Link>
      </div>
    </div>
  )
}
