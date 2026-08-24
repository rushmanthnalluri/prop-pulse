/**
 * BootstrapNote (SPEC §5.4-5): the champion-vs-runner-up paired bootstrap,
 * promoted from inline text to a designed honesty banner (SPEC §1.4 — honesty
 * caveats use the amber/warn treatment, ≥11px, never footnote-grey). Renders
 * the served interval verbatim: observed RMSLE diff, CI95, resample count,
 * seed, and P(runner-up better) — plus one plain-English line on how to read
 * an interval that spans zero. Renders nothing when the API omits the block.
 */
import { formatMetric, formatNumber, formatPct } from '../../format'

/** -0.004341 → "−0.0043"; +0.006 → "+0.0060". Non-finite → '—'. */
function signed(value, digits = 4) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '−' : '+'
  return `${sign}${Math.abs(n).toFixed(digits)}`
}

export default function BootstrapNote({ bootstrap, championName }) {
  if (!bootstrap || typeof bootstrap !== 'object') return null
  const {
    runner_up: runnerUp,
    observed_rmsle_diff: observed,
    ci95,
    prob_runner_up_better: probBetter,
    n_resamples: nResamples,
    seed,
    significant,
  } = bootstrap
  const [ciLow, ciHigh] = Array.isArray(ci95) ? ci95 : [null, null]

  return (
    <div className="alert alert-warn insights-bootstrap">
      <span className="alert-title">
        {significant
          ? 'Champion vs runner-up — the gap is statistically decisive'
          : 'Champion vs runner-up — the gap is not statistically decisive'}
      </span>
      {/* The three served figures pulled out of the prose as a scannable stat
          row — the verdict's evidence at a glance. */}
      <div className="insights-bootstrap-stats">
        <div className="insights-bootstrap-stat">
          <span className="insights-bootstrap-stat-value">{signed(observed)}</span>
          <span className="insights-bootstrap-stat-label">
            Δ RMSLE — {championName || 'champion'} minus {runnerUp || 'runner-up'}
          </span>
        </div>
        <div className="insights-bootstrap-stat">
          <span className="insights-bootstrap-stat-value">
            [{signed(ciLow)}, {signed(ciHigh)}]
          </span>
          <span className="insights-bootstrap-stat-label">CI95 on the difference</span>
        </div>
        <div className="insights-bootstrap-stat">
          <span className="insights-bootstrap-stat-value">{formatPct(probBetter)}</span>
          <span className="insights-bootstrap-stat-label">P(runner-up better)</span>
        </div>
      </div>
      <p className="insights-bootstrap-body">
        Runner-up <strong>{runnerUp || '—'}</strong> was{' '}
        {significant ? 'statistically worse' : 'not statistically worse'} across{' '}
        {formatNumber(nResamples, 0)} paired bootstrap resamples of the
        validation split (seed {formatMetric(seed, 0)}).
      </p>
      <p className="insights-bootstrap-explainer">
        A bootstrap re-runs the validation comparison on thousands of resampled
        row sets; when the interval spans zero, the data cannot separate the two
        models. {championName || 'The champion'} ships as the safer default —
        interpretable, tiny, fastest to serve — not as a proven winner.
      </p>
    </div>
  )
}
