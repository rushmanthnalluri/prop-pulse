/**
 * The ~80% range band (SPEC §5.2.2-1): a padded track with the [low, high]
 * model interval as the fill and the point estimate as the marker. Bare
 * presentation — ResultHero supplies the panel chrome and the caption; the
 * fill animates (--dur-emphasis) on a new estimate via valuation.css.
 * Renders nothing when the inputs are non-finite or degenerate. Labelled
 * "~80% range", never "95% CI" (CONTRACT §5.5).
 */
import { formatUsd } from '../format'

export default function PriceBand({ low, high, estimate }) {
  const lo = Number(low)
  const hi = Number(high)
  const est = Number(estimate)
  if (![lo, hi, est].every(Number.isFinite) || hi <= lo) return null

  // Pad the domain so the interval fill never sits flush on the track ends.
  const span = hi - lo
  const pad = span * 0.15
  const toPct = (value) => ((value - (lo - pad)) / (span + 2 * pad)) * 100

  return (
    <>
      <div
        className="band"
        role="img"
        aria-label={`~80% range ${formatUsd(lo)} to ${formatUsd(hi)}, estimate ${formatUsd(est)}`}
      >
        <div
          className="band-fill"
          style={{ left: `${toPct(lo)}%`, right: `${100 - toPct(hi)}%` }}
        />
        <div className="band-marker" style={{ left: `${toPct(est)}%` }} />
      </div>
      <div className="band-scale">
        <span>{formatUsd(lo)}</span>
        <span>estimate {formatUsd(est)}</span>
        <span>{formatUsd(hi)}</span>
      </div>
    </>
  )
}
