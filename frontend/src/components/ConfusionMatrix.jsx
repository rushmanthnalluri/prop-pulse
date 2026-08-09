/**
 * Confusion matrix for the classification champion (SPEC §5.4-4) — real
 * counts from /model/info (classification.*_metrics.confusion_matrix) on the
 * `.cm-grid` family, with row/column totals so the split size is readable
 * straight off the figure. Positive class = "fast sale" (sale within 30
 * days, simulated target — ADR-3). Renders nothing when the counts are
 * missing or non-finite (NaN discipline, SPEC §6). The grid is announced as
 * one image whose aria-label carries every count and total.
 */
export default function ConfusionMatrix({ matrix, title = 'Sealed test split' }) {
  const tn = Number(matrix?.tn)
  const fp = Number(matrix?.fp)
  const fn = Number(matrix?.fn)
  const tp = Number(matrix?.tp)
  if (![tn, fp, fn, tp].every(Number.isFinite)) return null

  const actualSlow = tn + fp
  const actualFast = fn + tp
  const predSlow = tn + fn
  const predFast = fp + tp
  const total = tn + fp + fn + tp

  const ariaLabel =
    `Confusion matrix, ${title}, ${total} sales: ` +
    `${tn} true negatives (actual slow, predicted slow), ` +
    `${fp} false positives (actual slow, predicted fast), ` +
    `${fn} false negatives (actual fast, predicted slow), ` +
    `${tp} true positives (actual fast, predicted fast). ` +
    `Totals: ${actualSlow} actually slow, ${actualFast} actually fast; ` +
    `${predSlow} predicted slow, ${predFast} predicted fast.`

  return (
    <figure className="insights-cm">
      {title && <figcaption className="insights-cm-title">{title}</figcaption>}
      <div className="cm-grid cm-grid--totals" role="img" aria-label={ariaLabel}>
        <div className="cm-cell cm-axis" aria-hidden="true" />
        <div className="cm-cell cm-axis">Pred: slow</div>
        <div className="cm-cell cm-axis">Pred: fast</div>
        <div className="cm-cell cm-axis cm-axis--total">Total</div>

        <div className="cm-cell cm-axis">Actual: slow</div>
        <div className="cm-cell cm-cell--tn">
          <strong>{tn}</strong>
          <span>True negative</span>
        </div>
        <div className="cm-cell cm-cell--fp">
          <strong>{fp}</strong>
          <span>False positive</span>
        </div>
        <div className="cm-cell cm-total">
          <strong>{actualSlow}</strong>
        </div>

        <div className="cm-cell cm-axis">Actual: fast</div>
        <div className="cm-cell cm-cell--fn">
          <strong>{fn}</strong>
          <span>False negative</span>
        </div>
        <div className="cm-cell cm-cell--tp">
          <strong>{tp}</strong>
          <span>True positive</span>
        </div>
        <div className="cm-cell cm-total">
          <strong>{actualFast}</strong>
        </div>

        <div className="cm-cell cm-axis cm-axis--total">Total</div>
        <div className="cm-cell cm-total">
          <strong>{predSlow}</strong>
        </div>
        <div className="cm-cell cm-total">
          <strong>{predFast}</strong>
        </div>
        <div className="cm-cell cm-total cm-total--grand">
          <strong>{total}</strong>
        </div>
      </div>
    </figure>
  )
}
