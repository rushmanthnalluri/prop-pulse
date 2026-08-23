/**
 * WHY THIS VALUE (SPEC §5.2.2-5): the top price factors as signed share
 * bars. Fill width is normalized to the top factor (matching DriverBars) so
 * the ranking reads at a glance; the exact `magnitude` share (0–1 of total
 * factor influence — relative, never dollars) stays in the value column and
 * the tooltip. Upward pressure uses the accent fill, downward the danger
 * fill, and the copy says "pushes the estimate up/down", never good/bad
 * (SPEC §2.1). Non-finite magnitudes are filtered out; `top_price_factors:
 * []` (CONTRACT §5.7) gets a designed empty state that points at the global
 * drivers — the valuation itself is unaffected.
 */
import { Link } from 'react-router'
import { formatPct, prettyFeature } from '../format'
import { EmptyState } from './StateView'

export default function FactorBars({ factors }) {
  const valid = (Array.isArray(factors) ? factors : []).filter(
    (factor) =>
      factor &&
      Number.isFinite(Number(factor.magnitude)) &&
      (factor.impact === 'positive' || factor.impact === 'negative'),
  )

  const maxMagnitude = valid.reduce((m, f) => Math.max(m, Math.abs(Number(f.magnitude))), 0)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Why this value</span>
      </div>
      <div className="panel-body">
        {valid.length === 0 ? (
          <EmptyState kicker="No explanation" title="Explanation unavailable for this estimate">
            <p className="empty-state-detail">
              The valuation itself is unaffected — see global drivers on{' '}
              <Link to="/model">Model Insights →</Link>
            </p>
          </EmptyState>
        ) : (
          <>
            <ul className="factor-list">
              {valid.map((factor) => {
                const magnitude = Math.abs(Number(factor.magnitude))
                const positive = factor.impact === 'positive'
                const label = prettyFeature(factor.feature)
                // Fill normalized to the top factor; the exact share stays in
                // the value column + tooltip (2.5% floor keeps a sliver visible).
                const widthPct =
                  maxMagnitude > 0 ? Math.max(2.5, (magnitude / maxMagnitude) * 100) : 2.5
                return (
                  <li
                    key={factor.feature}
                    className="factor-row"
                    title={`${label} pushes the estimate ${positive ? 'up' : 'down'} — ${formatPct(magnitude, 1)} of total factor influence`}
                  >
                    <span className="factor-name" title={factor.feature}>
                      {label}
                    </span>
                    <span className="factor-track" aria-hidden="true">
                      <span
                        className={`factor-fill${positive ? '' : ' factor-fill--neg'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </span>
                    <span className="factor-value">
                      {positive ? '+' : '−'} {formatPct(magnitude, 1)}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="note mt-12">
              Share of total factor influence for this estimate — relative, not dollars.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
