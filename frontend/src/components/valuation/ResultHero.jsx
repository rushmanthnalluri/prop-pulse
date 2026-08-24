/**
 * THE RESULT PANEL (SPEC §5.2.2-1, blueprint §8.10): the reference predict
 * result adapted to the champion estimate — an amber-bordered .result-panel
 * carrying, in the reference's hierarchy: mono kicker naming the serving
 * models (from `model_version`, never hardcoded) + the sale-call badge →
 * 30px verdict price (mono, tabular — numbers stay Plex per §2) → the ~80%
 * range band with its honesty caption → the 30-day sale probability as an
 * 8px .result-track with the served threshold ticked and the SimulatedBadge
 * beside it (ADR-3 — the disclosure is inseparable from the number) →
 * .result-facts dl of real /predict fields → the hedged, threshold-banded
 * explanation → ConfidenceNote's per-prediction trust badge.
 *
 * Additive-only consumption: range coverage and model R² arrive from
 * /model/info via props and their fact rows simply drop when unavailable;
 * a response without `sale_probability` skips the track block. NaN inputs
 * render nothing rather than a NaN width or aria-valuenow.
 */
import { formatMetric, formatPct, formatUsd } from '../../format'
import PriceBand from '../PriceBand'
import ConfidenceNote from '../ConfidenceNote'
import SimulatedBadge from '../workflow/SimulatedBadge'

/**
 * Hedged sale-speed sentence, banded on the served probability against the
 * served threshold (mirror of the reference's ≥80 / 50–80 / 20–50 / ≤20
 * bands, re-anchored to the max-F1 operating point — never a hardcoded 50%).
 */
function saleCallSentence(prob, thr, sells) {
  const p = formatPct(prob)
  const threshold = Number.isFinite(thr)
    ? `the ${formatPct(thr)} operating threshold`
    : 'the operating threshold'
  if (sells && prob >= 0.8) {
    return `The calibrated classifier scores a sale within 30 days as very likely for this profile — ${p}, well above ${threshold}.`
  }
  if (sells) {
    return `The classifier leans toward a sale within 30 days for this profile — ${p} against ${threshold}.`
  }
  if (Number.isFinite(thr) && thr - prob <= 0.05) {
    return `This profile sits just under ${threshold} at ${p} — a genuinely uncertain sale-speed call that small input changes can flip.`
  }
  return `The classifier leans against a sale within 30 days for this profile — ${p}, short of ${threshold}.`
}

export default function ResultHero({ result, coverage, mae, r2 }) {
  const price = Number(result?.estimated_price)
  if (!Number.isFinite(price)) return null

  const versions = result?.model_version
  const champion = versions?.regression
  const cov = Number(coverage)
  const r2Value = Number(r2)

  const prob = Number(result?.sale_probability?.probability)
  const hasProb = Number.isFinite(prob)
  const pct = hasProb ? Math.min(100, Math.max(0, prob * 100)) : null
  const thrRaw = result?.sale_probability?.threshold
  const thr = thrRaw === null || thrRaw === undefined ? NaN : Number(thrRaw)
  const thrPct = Number.isFinite(thr) ? Math.min(100, Math.max(0, thr * 100)) : null
  const sells = result?.sale_probability?.sells_within_30_days === true
  const microLabel = result?.micro_market?.label

  const caption =
    '~80% range from validation residual quantiles — asymmetric around the estimate, not a confidence interval.'

  const explanation = hasProb
    ? `${saleCallSentence(prob, thr, sells)} The price is a statistical estimate from ${
        champion ?? 'the serving champion'
      } — the ~80% range${
        Number.isFinite(cov)
          ? ` (measured coverage ${formatPct(cov)} on the sealed 2010 test set)`
          : ''
      } is residual-based, not an appraisal — and the sale-speed target is a seeded simulation, not a market forecast.`
    : null

  return (
    <div className="result-panel result-panel--estimate">
      <div className="result-kicker-row">
        <span className="result-kicker">
          {champion ? `Prediction · ${champion}` : 'Prediction · PropPulse champion'}
        </span>
        {hasProb && (
          <span className={`badge ${sells ? 'badge-accent' : 'badge-muted'}`}>
            {sells ? 'Likely fast sale' : 'Slower sale'}
          </span>
        )}
      </div>

      <div className="result-verdict-block">
        <span className="result-verdict result-price">{formatUsd(price)}</span>
        <span className="result-verdict-label">Estimated sale price</span>
      </div>

      <div className="result-band">
        <PriceBand
          low={result?.price_range?.low}
          high={result?.price_range?.high}
          estimate={price}
        />
        <p className="result-caption">{caption}</p>
      </div>

      {hasProb && (
        <div className="result-prob">
          <div className="result-prob-head">
            <span className="result-prob-title">30-day sale probability</span>
            <SimulatedBadge />
          </div>
          <div
            className="result-track"
            role="meter"
            aria-valuenow={Number(pct.toFixed(1))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Probability of selling within 30 days — simulated target"
          >
            <div className="result-fill" style={{ width: `${pct}%` }} />
            {thrPct !== null && (
              <span className="threshold-tick" style={{ left: `${thrPct}%` }} aria-hidden="true" />
            )}
          </div>
          <div className="result-meta">
            <span className="mono">{formatPct(prob)} probability</span>
            {thrPct !== null && <span className="mono dim">threshold {formatPct(thr)}</span>}
          </div>
        </div>
      )}

      {(versions?.regression ||
        hasProb ||
        microLabel ||
        Number.isFinite(cov) ||
        Number.isFinite(r2Value)) && (
        <dl className="result-facts">
          {versions?.regression && (
            <div className="result-fact">
              <dt>Model used</dt>
              <dd>{[versions.regression, versions.classification].filter(Boolean).join(' + ')}</dd>
            </div>
          )}
          {hasProb && (
            <div className="result-fact">
              <dt>Sale probability</dt>
              <dd>{formatPct(prob)}</dd>
            </div>
          )}
          {microLabel && (
            <div className="result-fact">
              <dt>Micro-market</dt>
              <dd className="result-fact-cap">{microLabel}</dd>
            </div>
          )}
          {Number.isFinite(cov) && (
            <div className="result-fact">
              <dt>~80% range coverage</dt>
              <dd>{formatPct(cov)} · sealed test</dd>
            </div>
          )}
          {Number.isFinite(r2Value) && (
            <div className="result-fact">
              <dt>Model R² · sealed test</dt>
              <dd>{formatMetric(r2Value, 4)}</dd>
            </div>
          )}
        </dl>
      )}

      {explanation && <p className="note note-flush">{explanation}</p>}

      <ConfidenceNote confidence={result?.confidence} mae={mae} />
    </div>
  )
}
