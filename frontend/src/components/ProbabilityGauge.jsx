/**
 * SALE LIKELIHOOD (SPEC §5.2.2-2): filled gauge against a 0–100% scale with
 * the model's operating threshold ticked at the served value (0.203292 — a
 * max-F1 operating point, never hardcoded to 0.5, CONTRACT §5.4) and printed
 * as a percent in the meta line; the verdict chip uses
 * `sells_within_30_days` as served. The target is SIMULATED (ADR-3), so the
 * warn badge and caveat line are inseparable from the number. NaN discipline:
 * a non-finite probability renders nothing at all — never a NaN width or
 * aria-valuenow.
 */
import { formatPct } from '../format'

export default function ProbabilityGauge({ probability, threshold, sellsWithin30Days }) {
  const prob = Number(probability)
  if (!Number.isFinite(prob)) return null
  const pct = Math.min(100, Math.max(0, prob * 100))

  const thr = threshold === null || threshold === undefined ? NaN : Number(threshold)
  const thrPct = Number.isFinite(thr) ? Math.min(100, Math.max(0, thr * 100)) : null

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Sale likelihood</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <span className={`badge ${sellsWithin30Days ? 'badge-accent' : 'badge-muted'}`}>
            {sellsWithin30Days ? 'Likely fast sale' : 'Slower sale'}
          </span>
          <span className="badge badge-warn">Simulated target</span>
        </span>
      </div>
      <div className="panel-body">
        <div
          className="gauge"
          role="meter"
          aria-valuenow={Number(pct.toFixed(1))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Probability of selling within 30 days"
        >
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: `${pct}%` }} />
            {thrPct !== null && <div className="gauge-tick" style={{ left: `${thrPct}%` }} />}
          </div>
          <div className="gauge-meta">
            <span>{formatPct(prob)} within 30 days</span>
            {Number.isFinite(thr) && <span>threshold {formatPct(thr)}</span>}
          </div>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Simulated target — measures consistency with a seeded sale-speed simulation (ADR-3),
          not a real-world listing forecast.
        </p>
      </div>
    </div>
  )
}
