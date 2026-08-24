/**
 * HeadlineMetrics (Model Insights): the page's verdict strip — the reference
 * evaluation page's "metrics first" pattern (blueprint §8.9) rendered as the
 * unboxed metric pattern (mono value over label, hairline separators, §5).
 * Every value is a sealed-test figure from GET /model/info; the classification
 * entry carries the simulated-target hint (ADR-3) right in its label line.
 * Non-finite values fall back to '—' via format.js.
 */
import { formatMetric, formatPct, formatUsd } from '../../format'

/** One verdict-strip cell — also exported for ChampionDuo, which passes
    valueClassName="insights-stat" for its smaller in-panel values. */
export function HeadlineMetric({ label, value, hint, focal = false, valueClassName }) {
  return (
    <div className={focal ? 'metric metric--focal' : 'metric'}>
      <div className={valueClassName ? `metric-value ${valueClassName}` : 'metric-value'}>
        {value}
      </div>
      <div className="metric-label">{label}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  )
}

export default function HeadlineMetrics({ info }) {
  const regTest = info?.regression?.test_metrics ?? {}
  const clsTest = info?.classification?.test_metrics ?? {}
  return (
    <div className="metrics insights-headline">
      <HeadlineMetric
        focal
        label="Test RMSLE"
        value={formatMetric(regTest.rmsle, 4)}
        hint="selection metric · regression"
      />
      <HeadlineMetric
        label="Test MAE"
        value={formatUsd(regTest.mae)}
        hint="typical absolute error"
      />
      <HeadlineMetric
        label="Interval coverage"
        value={formatPct(regTest.interval_coverage)}
        hint="~80% nominal range, measured"
      />
      <HeadlineMetric
        label="Test ROC-AUC"
        value={formatMetric(clsTest.roc_auc)}
        hint="classification · simulated target"
      />
    </div>
  )
}
