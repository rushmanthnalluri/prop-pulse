/**
 * ChampionDuo (SPEC §5.4-2): the two production champions, named, badged, and
 * versioned — the page never asks the reader to compare raw candidate tables
 * (SPEC §1.5). Regression = ridge v1 (log1p target); classification =
 * calibrated random_forest v1 at its served threshold, with the SIMULATED
 * TARGET warn badge mandatory whenever its metrics appear (CONTRACT §5.3).
 * Every number comes from GET /model/info.
 */
import { formatMetric, formatUsd } from '../../format'

/** Compact "<name>_<version>" tag, mirroring the backend's model_version string. */
function modelTag(section) {
  return [section?.name, section?.version].filter(Boolean).join('_') || '—'
}

function HeadlineStat({ label, value, hint }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value insights-stat">{value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
    </div>
  )
}

export default function ChampionDuo({ info }) {
  const regression = info?.regression || {}
  const classification = info?.classification || {}
  const regTest = regression.test_metrics || {}
  const clsTest = classification.test_metrics || {}
  const threshold = clsTest.threshold ?? classification.threshold

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">
            Regression · <span className="mono">{modelTag(regression)}</span>
          </span>
          <span className="badge badge-accent">Champion</span>
        </div>
        <div className="panel-body">
          <div className="metrics metrics--3 insights-champion-stats">
            <HeadlineStat
              label="Test RMSLE"
              value={formatMetric(regTest.rmsle, 4)}
              hint="selection metric"
            />
            <HeadlineStat
              label="Test R²"
              value={formatMetric(regTest.r2)}
              hint="variance explained"
            />
            <HeadlineStat
              label="Test MAE"
              value={formatUsd(regTest.mae)}
              hint="typical error"
            />
          </div>
          <p className="note insights-panel-note">
            A regularized linear model predicting log1p(SalePrice) — dollar
            figures are converted back with expm1. It won on validation RMSLE;
            the runner-up was close enough that the bootstrap note below does
            the honest math.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head insights-champion-head">
          <span className="panel-title">
            Classification · <span className="mono">{modelTag(classification)}</span>
          </span>
          <span className="insights-badge-set">
            {classification.calibrated && <span className="badge">Calibrated</span>}
            <span className="badge badge-accent">Champion</span>
            <span className="badge badge-warn">Simulated target</span>
          </span>
        </div>
        <div className="panel-body">
          <div className="metrics metrics--3 insights-champion-stats">
            <HeadlineStat
              label="Test ROC-AUC"
              value={formatMetric(clsTest.roc_auc)}
              hint="0.5 = chance"
            />
            <HeadlineStat
              label="Test PR-AUC"
              value={formatMetric(clsTest.pr_auc)}
              hint="primary metric"
            />
            <HeadlineStat
              label="Threshold"
              value={formatMetric(threshold, 4)}
              hint="max-F1, not 0.5"
            />
          </div>
          <p className="note insights-panel-note">
            Scores P(sale within 30 days). That target is simulated (ADR-3), so
            these numbers measure consistency with a seeded sale-speed
            simulation — not a real-world listing forecast.
          </p>
        </div>
      </div>
    </div>
  )
}
