/**
 * PRICE POSITION (SPEC §5.2.2-4): the subject's estimated $/sqft against the
 * neighborhood and micro-market medians on one padded scale, with the served
 * near/above/below label as a badge. Additive-only — a response without
 * `market_position`, or with any non-finite median, renders nothing. The
 * caption is contract-mandated (§2): positioning vs the training-sale
 * median, never an over- or underpricing verdict.
 */
import { formatNumber } from '../format'

const MARKERS = [
  { key: 'subject', label: 'This estimate', color: 'var(--accent)' },
  { key: 'hood', label: 'Neighborhood median', color: 'var(--slate)' },
  { key: 'cluster', label: 'Micro-market median', color: 'var(--ochre)' },
]

const LABEL_BADGES = {
  near: 'Near the median',
  above: 'Above the median',
  below: 'Below the median',
}

export default function MarketPosition({ marketPosition }) {
  if (!marketPosition) return null
  const values = {
    subject: Number(marketPosition.subject_price_per_sqft),
    hood: Number(marketPosition.neighborhood_median_price_per_sqft),
    cluster: Number(marketPosition.cluster_median_price_per_sqft),
  }
  if (!Object.values(values).every(Number.isFinite)) return null

  const low = Math.min(values.subject, values.hood, values.cluster)
  const high = Math.max(values.subject, values.hood, values.cluster)
  const span = high - low
  // Pad the domain so the outermost markers never sit flush on the track ends.
  const pad = span > 0 ? span * 0.2 : Math.max(high * 0.05, 1)
  const domainLow = low - pad
  const domainHigh = high + pad
  const toPct = (value) => ((value - domainLow) / (domainHigh - domainLow)) * 100

  const vsRaw = marketPosition.vs_neighborhood_pct
  const vsPct = vsRaw === null || vsRaw === undefined ? NaN : Number(vsRaw)
  const labelBadge = LABEL_BADGES[marketPosition.label]

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Price position</span>
        {labelBadge && <span className="badge badge-muted">{labelBadge}</span>}
      </div>
      <div className="panel-body">
        <div
          className="position-scale"
          role="img"
          aria-label={`Estimate $${formatNumber(values.subject)} per sqft, neighborhood median $${formatNumber(values.hood)}, micro-market median $${formatNumber(values.cluster)}`}
        >
          {MARKERS.map((marker) => (
            <span
              key={marker.key}
              className={`position-marker position-marker--${marker.key}`}
              style={{ left: `${toPct(values[marker.key])}%` }}
              title={`${marker.label}: $${formatNumber(values[marker.key])}/sqft`}
            />
          ))}
        </div>
        <div className="position-labels">
          <span>${formatNumber(domainLow, 0)}/sqft</span>
          <span>${formatNumber(domainHigh, 0)}/sqft</span>
        </div>
        <ul className="legend" style={{ marginTop: 12 }}>
          {MARKERS.map((marker) => (
            <li key={marker.key} className="legend-item">
              <span className="swatch" style={{ background: marker.color }} aria-hidden="true" />
              {marker.label} · ${formatNumber(values[marker.key])}/sqft
            </li>
          ))}
        </ul>
        {Number.isFinite(vsPct) && (
          <p className="note" style={{ marginTop: 10 }}>
            {vsPct === 0
              ? 'In line with the neighborhood median ($/sqft)'
              : `${vsPct > 0 ? '+' : '−'}${formatNumber(Math.abs(vsPct))}% ${vsPct > 0 ? 'above' : 'below'} the neighborhood median ($/sqft)`}
          </p>
        )}
        <p className="note" style={{ marginTop: 6 }}>
          Position vs the training-sale median — not an over- or underpricing verdict.
        </p>
      </div>
    </div>
  )
}
