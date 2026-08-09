/**
 * Confidence trust badge (SPEC §5.2.2-1, CONTRACT §2): the API's per-
 * prediction honesty block, embedded in the result hero. `confidence.level:
 * "reduced"` is an HTTP-200 trust badge, never an error — the warn badge
 * shows with `reasons` listed verbatim. When the level is "typical" and the
 * sealed-test MAE is available (from /model/info, passed down as a prop) the
 * caption states it — never a hardcoded dollar figure. Unknown shapes render
 * nothing (additive-only consumption).
 */
import { formatUsd } from '../format'

export default function ConfidenceNote({ confidence, mae }) {
  if (!confidence || (confidence.level !== 'typical' && confidence.level !== 'reduced')) {
    return null
  }
  const reasons = Array.isArray(confidence.reasons)
    ? confidence.reasons.filter((reason) => typeof reason === 'string' && reason.trim())
    : []
  const maeValue = Number(mae)
  const reduced = confidence.level === 'reduced'
  const showMae = !reduced && Number.isFinite(maeValue)

  if (reduced && reasons.length === 0) return null
  if (!reduced && !showMae) return null

  return (
    <div className="hero-confidence">
      <span className={`badge ${reduced ? 'badge-warn' : 'badge-accent'}`}>
        {reduced ? 'Reduced confidence' : 'Typical confidence'}
      </span>
      {reasons.length > 0 && (
        <ul className="hero-confidence-reasons">
          {reasons.map((reason) => (
            <li key={reason} className="note">
              {reason}
            </li>
          ))}
        </ul>
      )}
      {showMae && (
        <p className="note hero-confidence-mae">
          Typical miss on sealed-test homes: {formatUsd(maeValue)}.
        </p>
      )}
    </div>
  )
}
