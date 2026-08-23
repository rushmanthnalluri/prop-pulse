/**
 * EvaluationWorkspace (WORKFLOW §6.3-08 / §3.10, blueprint §8.9) — the
 * stage-08 deep view of one trained candidate, rendered exclusively from
 * GET /workflow/jobs/{job}/evaluation/{candidate} and presented on the
 * reference's evaluation rhythm:
 *
 * - regression: metric cards (MAE/RMSE/R²/RMSLE + the ~80% residual interval,
 *   labelled "validation residual quantiles" per §7.5), then wide tall cards —
 *   actual-vs-predicted scatter with a dashed 45° reference and the residual
 *   histogram — and the native-importance bar card (an EmptyState, never a
 *   fabricated chart, when importance is null).
 * - classification: the F1-optimal operating point (the champion's
 *   pick_f1_threshold rule — never a hardcoded 0.5) with the at-0.5 comparison
 *   table as the honesty note, the wide tall ROC + reliability cards (dashed
 *   chance / perfectly-calibrated diagonals, legend "name · AUC" /
 *   "name · Brier"), the PR card, and the .eval-duo — confusion matrix at the
 *   F1 threshold (shared ConfusionMatrix, .cm-grid language) beside the h-340
 *   importance card. Every number carries the SimulatedBadge context (ADR-3).
 * - clustering: eps/min_samples + the verbatim k-distance-knee rationale, the
 *   cluster-sizes bar card (amber clusters, danger noise group), cluster
 *   cards, and the 25-neighborhood assignments table with fallback flags. No
 *   silhouette score — the machinery never computes one (§7 omission).
 *
 * Charts are recharts on the shared chartTheme (Plex Mono 10px ticks, y-only
 * hairline grid, dashed neutral references). Every chart: role="img" +
 * aria-label + ChartA11yTable of the exact plotted values (UX §7.8),
 * animation disabled under prefers-reduced-motion, and a caption naming the
 * split and n ("val, 338 rows").
 */
import { useCallback, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
import {
  CHART_PALETTE,
  MONO_FONT,
  axisTick,
  cartesianGridProps,
  getAnimationProps,
  legendProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../shared/chartTheme'
import ConfusionMatrix from '../ConfusionMatrix'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import SimulatedBadge from './SimulatedBadge'
import { clusterColor } from '../../constants'
import { formatMetric, formatNumber, formatPct, formatUsd, prettyFeature } from '../../format'

const kTick = (value) => `$${Math.round(Number(value) / 1000)}k`

/** Mono axis titles (blueprint §8.9) — recharts Label prop objects. */
const monoAxisLabel = (value, position, extra = {}) => ({
  value,
  position,
  fill: CHART_PALETTE.tick,
  fontSize: 10,
  fontFamily: MONO_FONT,
  ...extra,
})

/** Chart caption naming split + n — the val-only honesty label (§7.4). */
function SplitCaption({ split, n }) {
  return (
    <p className="wf-chart-caption mono">
      {split}, {formatNumber(n, 0)} rows — the sandbox test split stays sealed
    </p>
  )
}

/** The sealed-set honesty note closing every per-candidate workspace (§8.9). */
function ClosingNote({ objective }) {
  return (
    <p className="note wf-eval-closing">
      Validation predictions are persisted once, at train time — this page reads them and
      nothing else, and the sandbox test split stays sealed. Scores here are the
      candidate&rsquo;s honest in-sandbox estimate; no tuning was done against them, and the
      PropPulse champion is never touched by sandbox training.
      {objective === 'classification' &&
        ' The classification curves describe the simulated target, not an observed market outcome.'}
    </p>
  )
}

/** Shared importance bar chart (native model importance — never SHAP, §7).
    `tallFrame` fixes the reference's h-340 frame inside the .eval-duo; the
    default frame grows with the row count for full-width placement. */
function ImportanceChart({ importance, reduced, split, n, tallFrame = false }) {
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
        className={tallFrame ? 'chart-wrap h-340' : 'chart-wrap'}
        style={tallFrame ? undefined : { height: Math.max(200, rows.length * 26) }}
        role="img"
        aria-label={`Bar chart of the top ${rows.length} native feature importances`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={CHART_PALETTE.grid} horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => formatMetric(v, 2)} {...xAxisProps} />
            <YAxis
              type="category"
              dataKey="feature"
              width={170}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
            />
            <Tooltip {...tooltipProps} formatter={(value) => [formatMetric(value, 4), 'importance']} />
            <Bar
              dataKey="weight"
              fill={CHART_PALETTE.accentFill}
              stroke={CHART_PALETTE.accent}
              radius={2}
              maxBarSize={18}
              {...getAnimationProps(reduced)}
            />
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
      <p className="note mt-10">
        ~80% range — validation residual quantiles (log space): q_low{' '}
        <span className="mono">{formatMetric(interval.q_low, 3)}</span>, q_high{' '}
        <span className="mono">{formatMetric(interval.q_high, 3)}</span>. Sandbox predictions add
        these to the log estimate before exponentiating.
      </p>

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">Actual vs predicted</span>
          <span className="chart-tag">
            {formatNumber(scatter.length, 0)} of {formatNumber(data.n, 0)} val rows · seeded thin
          </span>
        </div>
        <div
          className="chart-wrap chart-wrap-tall"
          role="img"
          aria-label="Scatter chart of actual vs predicted sale prices on the validation split with a 45-degree reference line"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis
                type="number"
                dataKey="actual"
                name="actual"
                tickFormatter={kTick}
                domain={['auto', 'auto']}
                {...xAxisProps}
                label={monoAxisLabel('actual sale price', 'insideBottom', { offset: 4 })}
              />
              <YAxis
                type="number"
                dataKey="predicted"
                name="predicted"
                tickFormatter={kTick}
                domain={['auto', 'auto']}
                {...yAxisProps}
                width={60}
                label={monoAxisLabel('predicted sale price', 'insideLeft', { angle: -90, offset: 8 })}
              />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [
                  formatUsd(value),
                  name === 'actual' ? 'Actual' : 'Predicted',
                ]}
              />
              {diagonal && (
                <ReferenceLine
                  segment={[
                    { x: diagonal.min, y: diagonal.min },
                    { x: diagonal.max, y: diagonal.max },
                  ]}
                  stroke={CHART_PALETTE.neutral}
                  strokeDasharray="5 5"
                  strokeWidth={1}
                />
              )}
              <Scatter
                data={scatter}
                fill={CHART_PALETTE.accent}
                fillOpacity={0.65}
                {...getAnimationProps(reduced)}
              />
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

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">Residuals</span>
          <span className="chart-tag">actual − predicted, USD</span>
        </div>
        <div
          className="chart-wrap chart-wrap-tall"
          role="img"
          aria-label="Histogram of validation residuals in dollars"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis dataKey="mid" tickFormatter={kTick} {...xAxisProps} />
              <YAxis {...yAxisProps} width={44} allowDecimals={false} />
              <Tooltip
                {...tooltipProps}
                formatter={(value) => [formatNumber(value, 0), 'rows']}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.range ?? ''}
              />
              <Bar
                dataKey="count"
                fill={CHART_PALETTE.accentFill}
                stroke={CHART_PALETTE.accent}
                radius={1.5}
                {...getAnimationProps(reduced)}
              />
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

      <div className="mt-28">
        <ImportanceChart importance={data.importance} reduced={reduced} split={data.split} n={data.n} />
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

function ClassificationWorkspace({ data, reduced, candidate }) {
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
        <SimulatedBadge /> These curves measure fit to the simulated sale-speed
        target — a seeded days-on-market simulation, not an observed market outcome.
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

      <div className="table-scroll wf-clip mt-16">
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
      <p className="note mt-10">
        The operating threshold is picked by F1 on the validation calibrated probabilities —
        the champion&rsquo;s rule — never defaulted to 0.5. Both operating points are shown so
        the trade-off is visible.
      </p>

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">True-positive rate vs false-positive rate</span>
          <span className="chart-tag">dashed = chance</span>
        </div>
        <div
          className="chart-wrap chart-wrap-tall"
          role="img"
          aria-label="ROC curve — true positive rate against false positive rate on the validation split, with the chance diagonal dashed"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={roc} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis
                type="number"
                dataKey="fpr"
                domain={[0, 1]}
                {...xAxisProps}
                label={monoAxisLabel('false-positive rate', 'insideBottom', { offset: 4 })}
              />
              <YAxis
                type="number"
                dataKey="tpr"
                domain={[0, 1]}
                {...yAxisProps}
                width={56}
                label={monoAxisLabel('true-positive rate', 'insideLeft', { angle: -90, offset: 8 })}
              />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [formatMetric(value, 3), name]}
              />
              <Legend verticalAlign="top" {...legendProps} iconType="line" iconSize={18} />
              <Line
                data={[
                  { fpr: 0, tpr: 0 },
                  { fpr: 1, tpr: 1 },
                ]}
                type="monotone"
                dataKey="tpr"
                name="chance"
                stroke={CHART_PALETTE.neutral}
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="tpr"
                name={`${candidate} · AUC ${formatMetric(atF1.roc_auc, 4)}`}
                stroke={CHART_PALETTE.accent}
                strokeWidth={1.8}
                dot={false}
                {...getAnimationProps(reduced)}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartA11yTable
          caption="ROC curve points (false positive rate, true positive rate), validation split"
          columns={[
            { key: 'fpr', label: 'False positive rate', format: (v) => formatMetric(v, 3) },
            { key: 'tpr', label: 'True positive rate', format: (v) => formatMetric(v, 3) },
          ]}
          rows={roc}
        />
        <SplitCaption split={data.split} n={data.n} />
      </div>

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">Reliability — do the probabilities mean what they say?</span>
          <span className="chart-tag">dashed = perfectly calibrated</span>
        </div>
        <div
          className="chart-wrap chart-wrap-tall"
          role="img"
          aria-label="Reliability curve — observed fast-sale fraction against mean predicted probability on the validation split, with the perfect-calibration line dashed"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={calibration} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis
                type="number"
                dataKey="mean_pred"
                domain={[0, 1]}
                {...xAxisProps}
                label={monoAxisLabel('mean predicted probability', 'insideBottom', { offset: 4 })}
              />
              <YAxis
                type="number"
                dataKey="frac_pos"
                domain={[0, 1]}
                {...yAxisProps}
                width={56}
                label={monoAxisLabel('observed fraction', 'insideLeft', { angle: -90, offset: 8 })}
              />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [formatMetric(value, 3), name]}
              />
              <Legend verticalAlign="top" {...legendProps} iconType="line" iconSize={18} />
              <Line
                data={[
                  { mean_pred: 0, frac_pos: 0 },
                  { mean_pred: 1, frac_pos: 1 },
                ]}
                type="monotone"
                dataKey="frac_pos"
                name="perfectly calibrated"
                stroke={CHART_PALETTE.neutral}
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="frac_pos"
                name={`${candidate} · Brier ${formatMetric(atF1.brier, 4)}`}
                stroke={CHART_PALETTE.accent}
                strokeWidth={1.8}
                dot={{ r: 3, fill: CHART_PALETTE.accent, strokeWidth: 0 }}
                {...getAnimationProps(reduced)}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartA11yTable
          caption="Reliability points (mean predicted probability, observed fast-sale fraction), validation split"
          columns={[
            { key: 'mean_pred', label: 'Mean predicted', format: (v) => formatMetric(v, 3) },
            { key: 'frac_pos', label: 'Observed fraction', format: (v) => formatMetric(v, 3) },
          ]}
          rows={calibration}
        />
        <p className="note mt-10">
          Each point pools the validation rows whose predicted probability falls into one bin,
          then plots the observed fast-sale rate against it. Points on the diagonal mean a
          predicted 70% really sells within 30 days about 70% of the time — read against the
          simulated target.
        </p>
        <SplitCaption split={data.split} n={data.n} />
      </div>

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">Precision–recall — the fast-sale operating envelope</span>
          <span className="chart-tag">
            {pr.length} points · baseline {formatPct(data.positive_rate)} positive
          </span>
        </div>
        <div
          className="chart-wrap"
          role="img"
          aria-label="Precision-recall curve on the validation split, with the positive-rate baseline dashed"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={pr} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis
                type="number"
                dataKey="recall"
                domain={[0, 1]}
                {...xAxisProps}
                label={monoAxisLabel('recall', 'insideBottom', { offset: 4 })}
              />
              <YAxis
                type="number"
                dataKey="precision"
                domain={[0, 1]}
                {...yAxisProps}
                width={56}
                label={monoAxisLabel('precision', 'insideLeft', { angle: -90, offset: 8 })}
              />
              <Tooltip
                {...tooltipProps}
                formatter={(value, name) => [formatMetric(value, 3), name]}
              />
              {Number.isFinite(Number(data.positive_rate)) && (
                <ReferenceLine
                  y={Number(data.positive_rate)}
                  stroke={CHART_PALETTE.neutral}
                  strokeDasharray="5 5"
                  strokeWidth={1}
                />
              )}
              <Line
                type="monotone"
                dataKey="precision"
                name="precision"
                stroke={CHART_PALETTE.accent}
                strokeWidth={1.8}
                dot={false}
                {...getAnimationProps(reduced)}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <ChartA11yTable
          caption="Precision-recall curve points (recall, precision), validation split"
          columns={[
            { key: 'recall', label: 'Recall', format: (v) => formatMetric(v, 3) },
            { key: 'precision', label: 'Precision', format: (v) => formatMetric(v, 3) },
          ]}
          rows={pr}
        />
        <SplitCaption split={data.split} n={data.n} />
      </div>

      <div className="eval-duo">
        <div>
          <div className="section-head mt-0">
            <span className="section-title">
              Confusion matrix — <span className="mono">{candidate}</span>
            </span>
          </div>
          <ConfusionMatrix
            matrix={atF1.confusion_matrix}
            title={`Validation split · F1-optimal threshold ${formatMetric(atF1.threshold, 3)}`}
          />
          <SplitCaption split={data.split} n={data.n} />
        </div>
        <div>
          <div className="section-head mt-0">
            <span className="section-title">
              Feature importance — <span className="mono">{candidate}</span>
            </span>
          </div>
          <ImportanceChart
            importance={data.importance}
            reduced={reduced}
            split={data.split}
            n={data.n}
            tallFrame
          />
        </div>
      </div>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Clustering — no silhouette score exists in the machinery (§7 omission)      */
/* -------------------------------------------------------------------------- */

function ClusteringWorkspace({ data, reduced }) {
  const clusters = useMemo(
    () => (Array.isArray(data.clusters) ? data.clusters : []),
    [data],
  )
  const assignments = Array.isArray(data.assignments) ? data.assignments : []

  // Cluster-sizes bars: one amber bar per cluster (neighborhoods served) plus
  // the noise group in danger — the honest count of what fell outside.
  const sizeRows = useMemo(() => {
    const rows = clusters.map((cluster) => ({
      name: cluster.label ?? `Cluster ${cluster.cluster_id}`,
      neighborhoods: Array.isArray(cluster.neighborhoods) ? cluster.neighborhoods.length : 0,
      sales: cluster.n_sales ?? null,
      price: cluster.median_price ?? null,
      noise: false,
    }))
    const noise = Number(data.n_noise)
    if (Number.isFinite(noise) && noise > 0) {
      rows.push({ name: 'Noise', neighborhoods: noise, sales: null, price: null, noise: true })
    }
    return rows
  }, [clusters, data])

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
        <div className="panel mt-16">
          <div className="panel-head">
            <span className="panel-title">Parameter rationale</span>
          </div>
          <div className="panel-body">
            <p className="note" style={{ margin: 0 }}>
              {data.rationale}
            </p>
          </div>
        </div>
      )}

      <div className="chart-card chart-card-wide mt-28">
        <div className="chart-head">
          <span className="chart-title">Cluster sizes — neighborhoods per micro-market</span>
          <span className="chart-tag">
            {formatNumber(data.n_clusters, 0)} clusters · {formatNumber(data.n_noise, 0)} noise
          </span>
        </div>
        <div
          className="chart-wrap"
          role="img"
          aria-label="Bar chart of neighborhoods per cluster, with the noise group in red"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sizeRows} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...cartesianGridProps} />
              <XAxis dataKey="name" interval={0} {...xAxisProps} />
              <YAxis {...yAxisProps} width={44} allowDecimals={false} />
              <Tooltip
                {...tooltipProps}
                formatter={(value) => [formatNumber(value, 0), 'neighborhoods']}
              />
              <Bar dataKey="neighborhoods" radius={3} maxBarSize={48} {...getAnimationProps(reduced)}>
                {sizeRows.map((row) => (
                  <Cell
                    key={row.name}
                    fill={row.noise ? CHART_PALETTE.dangerFill : CHART_PALETTE.accentFill}
                    stroke={row.noise ? CHART_PALETTE.danger : CHART_PALETTE.accent}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ChartA11yTable
          caption="Neighborhoods per cluster (plus the noise group), with train sales and median price"
          columns={[
            { key: 'name', label: 'Cluster' },
            { key: 'neighborhoods', label: 'Neighborhoods', format: (v) => formatNumber(v, 0) },
            { key: 'sales', label: 'Train sales', format: (v) => formatNumber(v, 0) },
            { key: 'price', label: 'Median price', format: formatUsd },
          ]}
          rows={sizeRows}
        />
        <p className="wf-chart-caption mono">
          {data.algorithm ?? 'DBSCAN'} over the 25-neighborhood matrix — fit once at train time
        </p>
      </div>

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

      <div className="table-scroll wf-clip wf-assignments mt-16">
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
      <p className="note mt-10">
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
        title="No evaluation response for this candidate"
        detail="Evaluations exist for candidates that finished training — pick a completed one above."
      />
    )
  }

  if (data.objective === 'regression') {
    return (
      <>
        <RegressionWorkspace data={data} reduced={reduced} />
        <ClosingNote objective="regression" />
      </>
    )
  }
  if (data.objective === 'classification') {
    return (
      <>
        <ClassificationWorkspace data={data} reduced={reduced} candidate={candidate} />
        <ClosingNote objective="classification" />
      </>
    )
  }
  if (data.objective === 'clustering') {
    return <ClusteringWorkspace data={data} reduced={reduced} />
  }
  return (
    <EmptyState
      kicker="Unknown objective"
      title={`No evaluation renderer for "${data.objective}"`}
      detail="The response's objective is not one of regression, classification, clustering."
    />
  )
}
