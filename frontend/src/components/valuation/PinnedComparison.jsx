/**
 * PINNED ESTIMATE COMPARISON (innovation pass, mission §42 — property
 * comparison, the one candidate not already covered by ScenarioExplorer /
 * MarketPosition / CompsTable): "Pin this estimate" snapshots the current
 * real /predict result (payload + price + sale probability + timestamp) to
 * localStorage (`proppulse:pinned-estimate`, same best-effort tier as
 * LAST_VALUATION_KEY). From then on, every estimate on this device renders a
 * compact panel beside it: pinned vs current price with the signed delta
 * (client-side arithmetic on two real API numbers — never fabricated), plus
 * the sale-probability shift when both sides serve one.
 *
 * Design language: plain `.panel` + `.kv` delta rows + the page's existing
 * pos/neg delta idiom (ScenarioExplorer), quiet secondary / link-quiet
 * actions, zero fetches, zero new tokens. Empty state is a single quiet
 * button — no panel chrome for one affordance. A corrupt or wrong-shaped
 * stored entry is treated as unpinned (the hook already swallows bad JSON).
 * Rendered by Valuation.jsx only while a result exists, so there is no
 * loading/error surface of its own; no JS-driven motion (hover transitions
 * only, globally reduced).
 */
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { PINNED_ESTIMATE_KEY } from '../../constants'
import { formatDateTime, formatUsd } from '../../format'
import { useToast } from '../Toast'
import { payloadSummary } from './formConfig'

/** Signed money delta in the ScenarioExplorer idiom: +$1,200 / −$850 / +$0. */
function signedUsd(delta) {
  return `${delta >= 0 ? '+' : '−'}${formatUsd(Math.abs(delta))}`
}

/** Pushpin glyph for the pin affordances — 13px, inherits currentColor. */
function PinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 1.6h4L8.6 5.4l1.9 2.4h-7l1.9-2.4L5 1.6z" />
      <path d="M7 7.8v4.6" />
    </svg>
  )
}

/** Signed-delta arrow — direction is also in the text sign; this is the
 *  glanceable cue (aria-hidden, never the only carrier of the sign). */
function DeltaArrow({ up }) {
  return (
    <svg
      className="compare-delta-icon"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {up ? <path d="M7 11.5v-8M3.5 7 7 3.5 10.5 7" /> : <path d="M7 2.5v8M3.5 7 7 10.5 10.5 7" />}
    </svg>
  )
}

export default function PinnedComparison({ result, payload }) {
  const [pinned, setPinned, clearPinned] = useLocalStorage(PINNED_ESTIMATE_KEY, null)
  const toast = useToast()

  const currentPrice = Number(result?.estimated_price)
  if (!Number.isFinite(currentPrice)) return null

  const pin = () => {
    const probability = Number(result?.sale_probability?.probability)
    setPinned({
      payload,
      price: currentPrice,
      probability: Number.isFinite(probability) ? probability : null,
      pinnedAt: new Date().toISOString(),
    })
    toast.success(pinned ? 'Pinned estimate updated' : 'Estimate pinned')
  }

  const pinnedPrice = Number(pinned?.price)
  if (!pinned || !Number.isFinite(pinnedPrice)) {
    return (
      <div className="pin-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={pin}>
          <PinIcon />
          Pin this estimate
        </button>
        <span className="pin-hint">Kept on this device — compare later estimates against it.</span>
      </div>
    )
  }

  const delta = currentPrice - pinnedPrice
  const deltaPct = pinnedPrice !== 0 ? (delta / Math.abs(pinnedPrice)) * 100 : 0
  const deltaClass = delta > 0 ? 'pos' : delta < 0 ? 'neg' : undefined
  const deltaText = `${signedUsd(delta)} (${delta >= 0 ? '+' : '−'}${Math.abs(deltaPct).toFixed(1)}%)`

  const pinnedProb = Number(pinned?.probability)
  const currentProb = Number(result?.sale_probability?.probability)
  const probDelta =
    Number.isFinite(pinnedProb) && Number.isFinite(currentProb)
      ? (currentProb - pinnedProb) * 100
      : null

  const caption = [payloadSummary(pinned.payload), `pinned ${formatDateTime(pinned.pinnedAt)}`]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="panel compare-panel">
      <div className="panel-head">
        <span className="panel-title">Pinned estimate</span>
        <span className="badge badge-muted">On this device</span>
      </div>
      <div className="panel-body">
        {caption && <p className="compare-summary">{caption}</p>}
        <dl className="kv">
          <div>
            <dt>Pinned estimate</dt>
            <dd>{formatUsd(pinnedPrice)}</dd>
          </div>
          <div>
            <dt>Current estimate</dt>
            <dd>{formatUsd(currentPrice)}</dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd className={['compare-delta', deltaClass].filter(Boolean).join(' ')}>
              {delta !== 0 && <DeltaArrow up={delta > 0} />}
              {deltaText}
            </dd>
          </div>
          {probDelta !== null && (
            <div>
              <dt>Sale probability shift</dt>
              <dd>
                {probDelta >= 0 ? '+' : '−'}
                {Math.abs(probDelta).toFixed(1)} pts
              </dd>
            </div>
          )}
        </dl>
        <div className="compare-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={pin}>
            <PinIcon />
            Update pin
          </button>
          <button type="button" className="link-quiet" onClick={clearPinned}>
            Remove pin
          </button>
        </div>
      </div>
    </div>
  )
}
