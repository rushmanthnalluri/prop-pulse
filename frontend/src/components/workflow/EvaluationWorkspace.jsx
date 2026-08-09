/**
 * EvaluationWorkspace (WORKFLOW §6.3-08 / §3.10) — the stage-08 deep view of
 * one trained candidate, rendered exclusively from
 * GET /workflow/jobs/{job}/evaluation/{candidate}:
 *
 * - regression: metric cards (MAE/RMSE/R²/RMSLE + the ~80% residual interval,
 *   labelled "validation residual quantiles" per §7.5), actual-vs-predicted
 *   scatter with a 45° reference line, residual histogram, native importance
 *   bars — an EmptyState (never a fabricated chart) when importance is null.
 * - classification: F1-optimal threshold card (the champion's
 *   pick_f1_threshold rule — never a hardcoded 0.5) with the at-0.5
 *   comparison table as the honesty note, ROC + PR + calibration curves
 *   (diagonal / positive-rate / perfect references dashed), the confusion
 *   matrix at the F1 threshold (shared ConfusionMatrix), importance, and the
 *   SimulatedBadge — every number is against the ADR-3 simulated target.
 * - clustering: eps/min_samples + the verbatim k-distance-knee rationale,
 *   cluster cards (label, members, n_sales, median price), and the
 *   25-neighborhood assignments table with fallback flags. No silhouette
 *   score — the machinery never computes one (§7 omission).
 *
 * Every chart: role="img" + aria-label + ChartA11yTable of the exact plotted
 * values (UX §7.8), animation disabled under prefers-reduced-motion, and a
 * caption naming the split and n ("val, 338 rows").
 */
import { useCallback, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getEvaluation } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import ChartA11yTable from '../shared/ChartA11yTable'
import useReducedMotion from '../shared/useReducedMotion'
import ConfusionMatrix from '../ConfusionMatrix'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import SimulatedBadge from './SimulatedBadge'
import { clusterColor } from '../../constants'
import { formatMetric, formatNumber, formatPct, formatUsd, prettyFeature } from '../../format'

const INK_3 = '#5d6d7d'
const GRID = '#dfe4e6'
const ACCENT = '#0e7a6d'
const SLATE = '#4c6e91'
const WARN = '#a8690f'
const AXIS_TICK = { fontSize: 12, fill: INK_3 }
const TOOLTIP_STYLE = { borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 13 }

const kTick = (value) => `$${Math.round(Number(value) / 1000)}k`

/** Chart caption naming split + n — the val-only honesty label (§7.4). */
function SplitCaption({ split, n }) {
  return (
    <p className="wf-chart-caption mono">
      {split}, {formatNumber(n, 0)} rows — the sandbox test split stays sealed
    </p>
  )
}

/** Shared importance bar chart (native model importance — never SHAP, §7). */
function ImportanceChart({ importance, reduced, split, n }) {
  const rows = useMemo(() => {
    if (!Array.isArray(importance)) return []
    return importance
      .filter((d) => Number.isFinite(Number(d?.weight)))
      .slice(0, 15)
      .map((d) => ({ feature: prettyFeature(d.feature), weight: Number(d.weight) }))
  }, [importance])

  if (importance === null || importance === undefined) {
    return (
      <div className="chart-card">
        <div className="chart-head">
          <span className="chart-title">Feature importance</span>
          <span className="chart-tag">native model importance</span>
        </div>
        <EmptyState
          kicker="Not available"
          title="This model exposes no native importance"
          detail="Linear coefficients, tree importances, and xgboost gain are shown when the fitted model provides them — nothing is synthesized."
        />
      </div>
    )
  }
  if (rows.length === 0) return null

  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title">Feature importance</span>
        <span className="chart-tag">native importance, aggregated to base features — not SHAP</span>
      </div>
      <div
        className="chart-wrap"
        style={{ height: Math.max(200, rows.length * 26) }}
        role="img"
        aria-label={`Bar chart of the top ${rows.length} native feature importances`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID} />
            <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v) => formatMetric(v, 2)} />
            <YAxis type="category" dataKey="feature" width={170} tick={{ fontSize: 12, fill: INK_3 }} />
            <Tooltip
              formatter={(value) => [formatMetric(value, 4), 'importance']}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar dataKey="weight" fill={ACCENT} isAnimationActive={!reduced} animationDuration={450} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`Top ${rows.length} native feature importances (aggregated to base features)`}
        columns={[
          { key: 'feature', label: 'Feature' },
          { key: 'weight', label: 'Importance', format: (v) => formatMetric(v, 4) },
        ]}
        rows={rows}
      />
      <SplitCaption split={split} n={n} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Regression                                                                  */
/* -------------------------------------------------------------------------- */

function RegressionWorkspace({ data, reduced }) {
  const metrics = data.metrics ?? {}
  const interval = metrics.residual_interval ?? {}

  const scatter = useMemo(
    () =>
      (Array.isArray(data.actual_vs_predicted) ? data.actual_vs_predicted : [])
        .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(([actual, predicted]) => ({ actual, predicted })),
    [data],
  )
  const diagonal = useMemo(() => {
    if (scatter.length === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const p of scatter) {
      min = Math.min(min, p.actual, p.predicted)
      max = Math.max(max, p.actual, p.predicted)
    }
    return { min, max }
  }, [scatter])

  const hist = useMemo(
    () =>
      (data.residual_hist?.bins ?? []).map((bin) => ({
        ...bin,
        mid: (bin.x0 + bin.x1) / 2,
        range: `${kTick(bin.x0)} to ${kTick(bin.x1)}`,
      })),
    [data],
  )

  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="metric-label">MAE</div>
          <div className="metric-value">{formatUsd(metrics.mae)}</div>
          <div className="metric-hint">mean absolute error, validation</div>
        </div>
        <div className="metric">
          <div className="metric-label">RMSE</div>
          <div className="metric-value">{formatUsd(metrics.rmse)}</div>
          <div className="metric-hint">penalizes large misses</div>
        </div>
        <div className="metric">
          <div className="metric-label">R²</div>
          <div className="metric-value">{formatMetric(metrics.r2)}</div>
          <div className="metric-hint">share of variance explained</div>
        </div>
        <div className="metric">
          <div className="metric-label">RMSLE</div>
          <div className="metric-value">{formatMetric(metrics.rmsle, 4)}</div>
          <div className="metric-hint">log-space error — the selection metric</div>
        </div>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        ~80% range — validation residual quantiles (log space): q_low{' '}
        <span className="mono">{formatMetric(interval.q_low, 3)}</span>, q_high{' '}
        <span className="mono">{formatMetric(interval.q_high, 3)}</span>. Sandbox predictions add
        these to the log estimate before exponentiating.
      </p>

      <div className="grid-2 wf-eval-grid">
        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Actual vs predicted</span>
            <span className="chart-tag">{formatNumber(scatter.length, 0)} of {formatNumber(data.n, 0)} val rows · seeded thin</span>
          </div>
          <div
            className="chart-wrap chart-wrap--tall"
            role="img"
            aria-label="Scatter chart of actual vs predicted sale prices on the validation split with a 45-degree reference line"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis
                  type="number"
                  dataKey="actual"
                  name="actual"
                  tickFormatter={kTick}
                  tick={AXIS_TICK}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="predicted"
                  name="predicted"
                  tickFormatter={kTick}
                  tick={AXIS_TICK}
                  width={56}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value, name) => [formatUsd(value), name === 'actual' ? 'Actual' : 'Predicted']}
                  contentStyle={TOOLTIP_STYLE}
                />
                {diagonal && (
                  <ReferenceLine
                    segment={[
                      { x: diagonal.min, y: diagonal.min },
                      { x: diagonal.max, y: diagonal.max },
                    ]}
                    stroke={WARN}
                    strokeDasharray="6 4"
                  />
                )}
                <Scatter data={scatter} fill={ACCENT} isAnimationActive={!reduced} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <ChartA11yTable
            caption="Actual vs predicted sale price per plotted validation row (USD)"
            columns={[
              { key: 'actual', label: 'Actual', format: formatUsd },
              { key: 'predicted', label: 'Predicted', format: formatUsd },
            ]}
            rows={scatter}
          />
          <SplitCaption split={data.split} n={data.n} />
        </div>

        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Residuals</span>
            <span className="chart-tag">actual − predicted, USD</span>
          </div>
          <div
            className="chart-wrap chart-wrap--tall"
            role="img"
            aria-label="Histogram of validation residuals in dollars"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID} />
                <XAxis dataKey="mid" tickFormatter={kTick} tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} width={44} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => [formatNumber(value, 0), 'rows']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.range ?? ''}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="count" fill={SLATE} isAnimationActive={!reduced} animationDuration={450} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartA11yTable
            caption="Validation residual histogram — bin range (USD) and row count"
            columns={[
              { key: 'range', label: 'Residual range' },
              { key: 'count', label: 'Rows', format: (v) => formatNumber(v, 0) },
            ]}
            rows={hist}
          />
          <SplitCaption split={data.split} n={data.n} />
        </div>

        <div className="chart-card-wide">
          <ImportanceChart importance={data.importance} reduced={reduced} split={data.split} n={data.n} />
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

function CurveCard({ title, tag, ariaLabel, captionLine, columns, rows, children }) {
  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-tag">{tag}</span>
      </div>
      <div className="chart-wrap" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <ChartA11yTable caption={captionLine} columns={columns} rows={rows} />
    </div>
  )
}

function ClassificationWorkspace({ data, reduced }) {
  const atF1 = data.metrics_at_f1 ?? {}
  const atHalf = data.metrics_at_0_5 ?? {}
  const roc = Array.isArray(data.roc) ? data.roc : []
  const pr = Array.isArray(data.pr) ? data.pr : []
  const calibration = Array.isArray(data.calibration) ? data.calibration : []

  const thresholdRows = [
    {
      rule: `F1-optimal (t = ${formatMetric(atF1.threshold, 3)})`,
      precision: atF1.precision,
      recall: atF1.recall,
      f1: atF1.f1,
    },
    {
      rule: 'Default 0.5',
      precision: atHalf.precision,
      recall: atHalf.recall,
      f1: atHalf.f1,
    },
  ]

  return (
    <>
      <p className="note wf-sim-note">
        <SimulatedBadge /> These curves measure fit to the simulated sale-speed target
        (ADR-3) — a seeded days-on-market simulation, not an observed market outcome.
      </p>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label">Threshold</div>
          <div className="metric-value">{formatMetric(atF1.threshold, 3)}</div>
          <div className="metric-hint">F1-optimal on validation probabilities</div>
        </div>
        <div className="metric">
          <div className="metric-label">Precision</div>
          <div className="metric-value">{formatPct(atF1.precision)}</div>
          <div className="metric-hint">at the F1 threshold</div>
        </div>
        <div className="metric">
          <div className="metric-label">Recall</div>
          <div className="metric-value">{formatPct(atF1.recall)}</div>
          <div className="metric-hint">at the F1 threshold</div>
        </div>
        <div className="metric">
          <div className="metric-label">F1</div>
          <div className="metric-value">{formatMetric(atF1.f1)}</div>
          <div className="metric-hint">
            ROC-AUC {formatMetric(atF1.roc_auc)} · PR-AUC {formatMetric(atF1.pr_auc)} · Brier{' '}
            {formatMetric(atF1.brier)}
          </div>
        </div>
      </div>

      <div className="table-scroll wf-clip" style={{ marginTop: 16 }}>
        <table className="table">
          <caption className="visually-hidden">
            Precision, recall, and F1 at the F1-optimal threshold versus the default 0.5
          </caption>
          <thead>
            <tr>
              <th scope="col">Operating point</th>
              <th scope="col" className="num">Precision</th>
              <th scope="col" className="num">Recall</th>
              <th scope="col" className="num">F1</th>
            </tr>
          </thead>
          <tbody>
            {thresholdRows.map((row) => (
              <tr key={row.rule}>
                <td className="strong">{row.rule}</td>
                <td className="num">{formatPct(row.precision)}</td>
                <td className="num">{formatPct(row.recall)}</td>
                <td className="num">{formatMetric(row.f1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        The operating threshold is picked by F1 on the validation calibrated probabilities —
        the champion&rsquo;s rule — never defaulted to 0.5. Both operating points are shown so
        the trade-off is visible.
      </p>

      <div className="grid-2 wf-eval-grid" style={{ marginTop: 20 }}>
        <CurveCard
          title="ROC curve"
          tag={`${roc.length} points`}
          ariaLabel="ROC curve — true positive rate against false positive rate on the validation split, with the chance diagonal dashed"
          captionLine="ROC curve points (false positive rate, true positive rate), validation split"
          columns={[
            { key: 'fpr', label: 'False positive rate', format: (v) => formatMetric(v, 3) },
            { key: 'tpr', label: 'True positive rate', format: (v) => formatMetric(v, 3) },
          ]}
          rows={roc}
        >
          <LineChart data={roc} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" dataKey="fpr" tick={AXIS_TICK} domain={[0, 1]} />
            <YAxis type="number" dataKey="tpr" tick={AXIS_TICK} width={48} domain={[0, 1]} />
            <Tooltip
              formatter={(value, name) => [formatMetric(value, 3), name === 'tpr' ? 'TPR' : 'FPR']}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={WARN} strokeDasharray="6 4" />
            <Line type="monotone" dataKey="tpr" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={!reduced} animationDuration={450} />
          </LineChart>
        </CurveCard>

        <CurveCard
          title="Precision–recall curve"
          tag={`${pr.length} points · baseline ${formatPct(data.positive_rate)} positive`}
          ariaLabel="Precision-recall curve on the validation split, with the positive-rate baseline dashed"
          captionLine="Precision-recall curve points (recall, precision), validation split"
          columns={[
            { key: 'recall', label: 'Recall', format: (v) => formatMetric(v, 3) },
            { key: 'precision', label: 'Precision', format: (v) => formatMetric(v, 3) },
          ]}
          rows={pr}
        >
          <LineChart data={pr} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" dataKey="recall" tick={AXIS_TICK} domain={[0, 1]} />
            <YAxis type="number" dataKey="precision" tick={AXIS_TICK} width={48} domain={[0, 1]} />
            <Tooltip
              formatter={(value, name) => [formatMetric(value, 3), name]}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine y={data.positive_rate} stroke={WARN} strokeDasharray="6 4" />
            <Line type="monotone" dataKey="precision" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={!reduced} animationDuration={450} />
          </LineChart>
        </CurveCard>

        <CurveCard
          title="Calibration"
          tag={`${calibration.length} bins · quantile-binned`}
          ariaLabel="Calibration curve — observed positive fraction against mean predicted probability, with the perfect-calibration line dashed"
          captionLine="Calibration points (mean predicted probability, observed positive fraction), validation split"
          columns={[
            { key: 'mean_pred', label: 'Mean predicted', format: (v) => formatMetric(v, 3) },
            { key: 'frac_pos', label: 'Observed fraction', format: (v) => formatMetric(v, 3) },
          ]}
          rows={calibration}
        >
          <LineChart data={calibration} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis type="number" dataKey="mean_pred" tick={AXIS_TICK} domain={[0, 1]} />
            <YAxis type="number" dataKey="frac_pos" tick={AXIS_TICK} width={48} domain={[0, 1]} />
            <Tooltip
              formatter={(value, name) => [formatMetric(value, 3), name === 'frac_pos' ? 'observed' : 'predicted']}
              contentStyle={TOOLTIP_STYLE}
            />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={WARN} strokeDasharray="6 4" />
            <Line type="monotone" dataKey="frac_pos" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={!reduced} animationDuration={450} />
          </LineChart>
        </CurveCard>

        <div className="chart-card">
          <div className="chart-head">
            <span className="chart-title">Confusion matrix</span>
            <span className="chart-tag">at t = {formatMetric(atF1.threshold, 3)}</span>
          </div>
          <ConfusionMatrix
            matrix={atF1.confusion_matrix}
            title={`Validation split · F1-optimal threshold ${formatMetric(atF1.threshold, 3)}`}
          />
          <SplitCaption split={data.split} n={data.n} />
        </div>

        <div className="chart-card-wide">
          <ImportanceChart importance={data.importance} reduced={reduced} split={data.split} n={data.n} />
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Clustering — no silhouette score exists in the machinery (§7 omission)      */
/* -------------------------------------------------------------------------- */

function ClusteringWorkspace({ data }) {
  const clusters = Array.isArray(data.clusters) ? data.clusters : []
  const assignments = Array.isArray(data.assignments) ? data.assignments : []
  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="metric-label">eps</div>
          <div className="metric-value">{formatMetric(data.eps, 3)}</div>
          <div className="metric-hint">k-distance knee, scaled feature space</div>
        </div>
        <div className="metric">
          <div className="metric-label">min samples</div>
          <div className="metric-value">{formatNumber(data.min_samples, 0)}</div>
          <div className="metric-hint">DBSCAN density threshold</div>
        </div>
        <div className="metric">
          <div className="metric-label">Clusters</div>
          <div className="metric-value">{formatNumber(data.n_clusters, 0)}</div>
          <div className="metric-hint">over the 25 neighborhoods</div>
        </div>
        <div className="metric">
          <div className="metric-label">Noise</div>
          <div className="metric-value">{formatNumber(data.n_noise, 0)}</div>
          <div className="metric-hint">served via nearest-centroid fallback</div>
        </div>
      </div>

      {data.rationale && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <span className="panel-title">Parameter rationale</span>
          </div>
          <div className="panel-body">
            <p className="note" style={{ margin: 0 }}>{data.rationale}</p>
          </div>
        </div>
      )}

      <div className="wf-cluster-grid">
        {clusters.map((cluster) => (
          <div className="wf-cluster-card" key={cluster.cluster_id}>
            <span
              className="wf-cluster-swatch"
              style={{ background: clusterColor(cluster.cluster_id) }}
              aria-hidden="true"
            />
            <span className="wf-cluster-label">{cluster.label ?? `Cluster ${cluster.cluster_id}`}</span>
            <dl className="wf-cluster-stats">
              <div>
                <dt>Neighborhoods</dt>
                <dd className="mono">{formatNumber(cluster.neighborhoods?.length ?? 0, 0)}</dd>
              </div>
              <div>
                <dt>Train sales</dt>
                <dd className="mono">{formatNumber(cluster.n_sales, 0)}</dd>
              </div>
              <div>
                <dt>Median price</dt>
                <dd className="mono">{formatUsd(cluster.median_price)}</dd>
              </div>
              <div>
                <dt>Median $/sqft</dt>
                <dd className="mono">${formatNumber(cluster.median_price_per_sqft, 0)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="table-scroll wf-clip wf-assignments" style={{ marginTop: 16 }}>
        <table className="table">
          <caption className="visually-hidden">
            Neighborhood cluster assignments with fallback flags
          </caption>
          <thead>
            <tr>
              <th scope="col">Neighborhood</th>
              <th scope="col">Name</th>
              <th scope="col" className="num">Cluster</th>
              <th scope="col">Assignment</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((row) => (
              <tr key={row.neighborhood}>
                <td className="mono strong">{row.neighborhood}</td>
                <td>{row.name}</td>
                <td className="num">
                  <span
                    className="wf-cluster-dot"
                    style={{ background: clusterColor(row.cluster_id) }}
                    aria-hidden="true"
                  />
                  {row.cluster_id}
                </td>
                <td>
                  {row.fallback ? (
                    <span className="badge badge-warn">nearest-centroid fallback</span>
                  ) : (
                    <span className="dim">direct</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        {data.algorithm ?? 'DBSCAN'} over the 25-neighborhood matrix · noise neighborhoods are
        assigned to their nearest cluster centroid at serving time. No cluster-quality score is
        shown — the pipeline does not compute one.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */

export default function EvaluationWorkspace({ jobId, candidate }) {
  const reduced = useReducedMotion()
  const fetcher = useCallback(
    (signal) => getEvaluation(jobId, candidate, signal),
    [jobId, candidate],
  )
  const { data, loading, error, reload } = useApi(fetcher)

  if (loading) return <PanelSkeleton height={320} />
  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={reload}
        title={`Couldn't load the evaluation for ${candidate}`}
      />
    )
  }
  if (!data) {
    return (
      <EmptyState
        kicker="No evaluation"
        title="No evaluation payload for this candidate"
        detail="Evaluations exist for candidates that finished training — pick a completed one above."
      />
    )
  }

  if (data.objective === 'regression') return <RegressionWorkspace data={data} reduced={reduced} />
  if (data.objective === 'classification') {
    return <ClassificationWorkspace data={data} reduced={reduced} />
  }
  if (data.objective === 'clustering') return <ClusteringWorkspace data={data} />
  return (
    <EmptyState
      kicker="Unknown objective"
      title={`No evaluation renderer for "${data.objective}"`}
      detail="The payload's objective is not one of regression, classification, clustering."
    />
  )
}
