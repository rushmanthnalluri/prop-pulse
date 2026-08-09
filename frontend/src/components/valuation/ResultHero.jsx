/**
 * THE ESTIMATE (SPEC §5.2.2-1): the result hero — the 30px mono navy price
 * (the only 30px element in the app), the ~80% range band, the coverage
 * caption, and the confidence trust badge (ConfidenceNote). The kicker names
 * the serving champion from `model_version`, never hardcoded; the caption's
 * coverage figure comes from /model/info and is omitted when unavailable.
 */
import { formatPct, formatUsd } from '../../format'
import PriceBand from '../PriceBand'
import ConfidenceNote from '../ConfidenceNote'

export default function ResultHero({ result, coverage, mae }) {
  const price = Number(result?.estimated_price)
  if (!Number.isFinite(price)) return null

  const champion = result?.model_version?.regression
  const cov = Number(coverage)
  const caption =
    '~80% range — validation residual quantiles' +
    (Number.isFinite(cov)
      ? `; measured coverage ${formatPct(cov)} on the sealed 2010 test set`
      : '') +
    '.'

  return (
    <div className="panel panel--hero">
      <div className="result-hero">
        <div className="hero-head">
          <span className="kicker">
            {champion ? `The estimate — Champion ${champion}` : 'The estimate'}
          </span>
        </div>
        <p className="result-price">{formatUsd(price)}</p>
        <PriceBand
          low={result?.price_range?.low}
          high={result?.price_range?.high}
          estimate={price}
        />
        <p className="result-caption">{caption}</p>
        <ConfidenceNote confidence={result?.confidence} mae={mae} />
      </div>
    </div>
  )
}
