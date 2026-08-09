/**
 * VizExplorer (WORKFLOW §6.3-05) — the stage-05 chart explorer. Controls
 * (chart type, dtype-filtered column pickers, per-chart options) → debounced
 * fetch of the §3.7 pre-aggregated payloads → render. NO client-side
 * aggregation: the browser receives plot-ready bins, points, box stats,
 * correlation matrices, and category aggregates.
 *
 * Renderers:
 *   histogram   → recharts BarChart (pre-binned counts)
 *   scatter     → recharts ScatterChart (seeded-downsampled points; a
 *                 "Sampled" badge + caption when the server thinned the rows)
 *   box         → hand-built horizontal box-and-whisker (composed bars) on a
 *                 shared scale, groups sorted by median desc (≤ 25)
 *   correlation → pure-CSS labelled heat grid, cells colored from the matrix
 *   category    → recharts horizontal BarChart of the aggregate per group
 *
 * Every chart: role="img" + one-sentence aria-label + ChartA11yTable of the
 * exact plotted values (UX §7.8); recharts animation honors
 * prefers-reduced-motion (useReducedMotion); captions are mono and name n and
 * sampling. Invalid combinations surface the endpoint's 422 message as the
 * designed error state; empty payloads get a designed empty state.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getFeatures, viz } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber, formatUsd } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ChartA11yTable from '../shared/ChartA11yTable'
import useReducedMotion from '../shared/useReducedMotion'

const TOOLTIP_STYLE = { borderRadius: 8, border: '1px solid #dfe4e6', fontSize: 13 }
const TICK_STYLE = { fontSize: 11, fill: '#5d6d7d' }

const KINDS = [
  { id: 'histogram', label: 'Distribution' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'box', label: 'Box by group' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'category', label: 'Category comparison' },
]

/** Entry defaults (§6.3-05): SalePrice histogram; GrLivArea×SalePrice scatter; correlation top-20. */
const DEFAULT_PARAMS = {
  histogram: { column: 'SalePrice', bins: 30 },
  scatter: { x: 'GrLivArea', y: 'SalePrice', maxPoints: 1500 },
  box: { column: 'SalePrice', by: 'Neighborhood' },
  correlation: { target: 'SalePrice', top: 20 },
  category: { column: 'Neighborhood', agg: 'median' },
}

/** Payload shape guards — a stale payload of another kind never renders under the new one. */
const PAYLOAD_MATCH = {
  histogram: (p) => Array.isArray(p?.bins),
  scatter: (p) => Array.isArray(p?.points),
  box: (p) => Array.isArray(p?.groups) && typeof p?.by === 'string',
  correlation: (p) => Array.isArray(p?.features) && Array.isArray(p?.matrix),
  category: (p) => Array.isArray(p?.groups) && typeof p?.agg === 'string',
}

const isEmptyPayload = {
  histogram: (p) => p.bins.length === 0,
  scatter: (p) => p.points.length === 0,
  box: (p) => p.groups.length === 0,
  correlation: (p) => p.features.length === 0,
  category: (p) => p.groups.length === 0,
}

/* ------------------------------------------------------------------------- */
/* Formatting — SalePrice is money (known Ames schema), everything else plain */
/* ------------------------------------------------------------------------- */

const isMoneyCol = (name) => name === 'SalePrice'

/** Short axis tick: "$180k" / "2,500" / "3.5". */
const fmtAxis = (name) => (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (isMoneyCol(name)) return Math.abs(n) >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`
  if (Math.abs(n) >= 10000) return `${Math.round(n / 1000)}k`
  if (Math.abs(n) >= 1000) return formatNumber(Math.round(n), 0)
  return formatNumber(n, 2)
}

/** Full precision for tooltips / a11y tables / captions. */
const fmtFull = (name) => (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  if (isMoneyCol(name)) return formatUsd(n)
  return Number.isInteger(n) ? formatNumber(n, 0) : formatNumber(n, 2)
}

/* ------------------------------------------------------------------------- */
/* Chart renderers                                                            */
/* ------------------------------------------------------------------------- */

function HistogramChart({ payload, reduced }) {
  const { column, bins, stats } = payload
  const rows = bins.map((bin, index) => ({ i: index, count: bin.count }))
  const total = bins.reduce((sum, bin) => sum + (bin.count ?? 0), 0)
  const axis = fmtAxis(column)
  const full = fmtFull(column)
  return (
    <>
      <div
        className="wfe-viz-chart"
        role="img"
        aria-label={`Histogram of ${column} — ${bins.length} bins over ${formatNumber(total, 0)} rows`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe4e6" />
            <XAxis
              dataKey="i"
              tickFormatter={(i) => (bins[i] ? axis(bins[i].x0) : '')}
              tick={TICK_STYLE}
              interval="preserveStartEnd"
              minTickGap={42}
            />
            <YAxis allowDecimals={false} width={48} tick={TICK_STYLE} />
            <Tooltip
              labelFormatter={(i) => (bins[i] ? `${full(bins[i].x0)} – ${full(bins[i].x1)}` : '')}
              formatter={(value) => [`${formatNumber(value, 0)} rows`, column]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar
              dataKey="count"
              fill="#0e7a6d"
              radius={[2, 2, 0, 0]}
              isAnimationActive={!reduced}
              animationDuration={450}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`Histogram of ${column}: bin ranges and row counts`}
        columns={[
          { key: 'range', label: 'Bin range' },
          { key: 'count', label: 'Rows', format: (v) => formatNumber(v, 0) },
        ]}
        rows={bins.map((bin) => ({
          range: `${full(bin.x0)} – ${full(bin.x1)}`,
          count: bin.count,
        }))}
      />
      <p className="wfe-viz-caption mono">
        {formatNumber(total, 0)} rows · {formatNumber(bins.length, 0)} bins · mean{' '}
        {full(stats?.mean)} · median {full(stats?.median)}
      </p>
    </>
  )
}

function ScatterPlot({ payload, reduced }) {
  const { x, y, points, n_total: nTotal, sampled } = payload
  const rows = points.map(([px, py]) => ({ x: px, y: py }))
  const fullX = fmtFull(x)
  const fullY = fmtFull(y)
  return (
    <>
      <div
        className="wfe-viz-chart"
        role="img"
        aria-label={`Scatter plot of ${y} against ${x} — ${formatNumber(rows.length, 0)} points`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dfe4e6" />
            <XAxis
              type="number"
              dataKey="x"
              name={x}
              domain={['auto', 'auto']}
              tickFormatter={fmtAxis(x)}
              tick={TICK_STYLE}
              label={{ value: x, position: 'insideBottomRight', offset: -2, ...TICK_STYLE }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={y}
              domain={['auto', 'auto']}
              tickFormatter={fmtAxis(y)}
              width={56}
              tick={TICK_STYLE}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(value, name) => [name === x ? fullX(value) : fullY(value), name]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Scatter
              data={rows}
              fill="#0e7a6d"
              fillOpacity={0.5}
              isAnimationActive={!reduced}
              animationDuration={450}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`Scatter points: ${x} versus ${y}`}
        columns={[
          { key: 'x', label: x, format: fullX },
          { key: 'y', label: y, format: fullY },
        ]}
        rows={rows}
      />
      <p className="wfe-viz-caption mono">
        {sampled && <span className="badge badge-warn wfe-sampled">Sampled</span>}
        {sampled
          ? `${formatNumber(rows.length, 0)} of ${formatNumber(nTotal, 0)} rows — deterministic seeded sample`
          : `${formatNumber(nTotal, 0)} rows — every row plotted`}
      </p>
    </>
  )
}

/** Horizontal box-and-whisker on a shared scale (composed bars, not recharts). */
function BoxPlot({ payload }) {
  const { column, by, groups } = payload
  const lo = Math.min(...groups.map((g) => g.min))
  const hi = Math.max(...groups.map((g) => g.max))
  const span = hi - lo || 1
  const pct = (v) => ((v - lo) / span) * 100
  const full = fmtFull(column)
  return (
    <>
      <div
        className="wfe-box"
        role="img"
        aria-label={`Box plot of ${column} by ${by} — ${groups.length} groups sorted by median`}
      >
        {groups.map((g) => (
          <div
            className="wfe-box-row"
            key={g.value}
            title={`${g.value} — n ${formatNumber(g.n, 0)} · min ${full(g.min)} · Q1 ${full(g.q1)} · median ${full(g.median)} · Q3 ${full(g.q3)} · max ${full(g.max)}`}
          >
            <span className="wfe-box-label">
              <span className="wfe-box-value">{g.value}</span>
              <span className="wfe-box-n mono">n={formatNumber(g.n, 0)}</span>
            </span>
            <span className="wfe-box-track">
              <span
                className="wfe-box-whisker"
                style={{ left: `${pct(g.min)}%`, width: `${pct(g.max) - pct(g.min)}%` }}
              />
              <span className="wfe-box-cap" style={{ left: `${pct(g.min)}%` }} />
              <span className="wfe-box-cap" style={{ left: `${pct(g.max)}%` }} />
              <span
                className="wfe-box-iqr"
                style={{
                  left: `${pct(g.q1)}%`,
                  width: `${Math.max(0.6, pct(g.q3) - pct(g.q1))}%`,
                }}
              />
              <span className="wfe-box-median" style={{ left: `${pct(g.median)}%` }} />
            </span>
            <span className="wfe-box-med mono">{full(g.median)}</span>
          </div>
        ))}
        <div className="wfe-box-row wfe-box-scalerow" aria-hidden="true">
          <span className="wfe-box-label" />
          <span className="wfe-box-scale mono">
            <span>{full(lo)}</span>
            <span>{full(hi)}</span>
          </span>
          <span className="wfe-box-med" />
        </div>
      </div>
      <ChartA11yTable
        caption={`${column} distribution by ${by}: five-number summary per group`}
        columns={[
          { key: 'value', label: by },
          { key: 'n', label: 'Rows', format: (v) => formatNumber(v, 0) },
          { key: 'min', label: 'Min', format: full },
          { key: 'q1', label: 'Q1', format: full },
          { key: 'median', label: 'Median', format: full },
          { key: 'q3', label: 'Q3', format: full },
          { key: 'max', label: 'Max', format: full },
        ]}
        rows={groups}
      />
      <p className="wfe-viz-caption mono">
        {formatNumber(groups.length, 0)} groups · sorted by median · box = Q1–Q3, whiskers min–max
      </p>
    </>
  )
}

/** Pure-CSS labelled heat grid; cells colored from the matrix (teal +, red −). */
function CorrelationGrid({ payload }) {
  const { target, features, matrix } = payload
  const n = features.length
  return (
    <>
      <div
        className="wfe-heat"
        role="img"
        aria-label={`Correlation matrix of the top ${Math.max(0, n - 1)} numeric features by absolute correlation with ${target}`}
      >
        <div
          className="wfe-heat-grid"
          style={{ gridTemplateColumns: `minmax(96px, max-content) repeat(${n}, minmax(46px, 1fr))` }}
        >
          <div className="wfe-heat-corner" aria-hidden="true" />
          {features.map((feature) => (
            <div key={`h-${feature}`} className="wfe-heat-colhead" title={feature}>
              <span>{feature}</span>
            </div>
          ))}
          {features.map((row, i) => (
            <Fragment key={row}>
              <div className="wfe-heat-rowhead" title={row}>
                {row}
              </div>
              {features.map((col, j) => {
                const value = Number(matrix?.[i]?.[j])
                const valid = Number.isFinite(value)
                const alpha = valid ? 0.06 + 0.84 * Math.abs(value) : 0
                const background = !valid
                  ? 'var(--raised)'
                  : value >= 0
                    ? `rgba(14,122,109,${alpha.toFixed(3)})`
                    : `rgba(182,70,60,${alpha.toFixed(3)})`
                return (
                  <div
                    key={`${row}__${col}`}
                    className="wfe-heat-cell"
                    style={{
                      background,
                      color: valid && Math.abs(value) > 0.55 ? '#ffffff' : 'var(--text)',
                    }}
                    title={`${row} × ${col}: ${valid ? value.toFixed(3) : 'n/a'}`}
                  >
                    {valid ? value.toFixed(2) : '—'}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <ChartA11yTable
        caption={`Pearson correlation matrix — top ${Math.max(0, n - 1)} numeric features plus ${target}`}
        columns={[
          { key: 'feature', label: 'Feature' },
          ...features.map((feature) => ({
            key: feature,
            label: feature,
            format: (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'),
          })),
        ]}
        rows={features.map((row, i) => {
          const record = { feature: row }
          features.forEach((col, j) => {
            record[col] = matrix?.[i]?.[j]
          })
          return record
        })}
      />
      <p className="wfe-viz-caption mono">
        top {formatNumber(Math.max(0, n - 1), 0)} numeric features by |correlation with {target}|
        · Pearson r · teal positive / red negative
      </p>
    </>
  )
}

function CategoryChart({ payload, reduced }) {
  const { column, target, agg, groups } = payload
  const money = agg !== 'count' && isMoneyCol(target)
  const rows = groups.map((g) => ({ value: g.value, n: g.n, agg: g.agg_value }))
  const height = Math.max(220, Math.min(600, groups.length * 26 + 48))
  const aggLabel = agg === 'count' ? 'row count' : `${agg} of ${target}`
  const formatAgg = (v) =>
    !Number.isFinite(Number(v)) ? '—' : money ? formatUsd(v) : formatNumber(v, 0)
  return (
    <>
      <div
        className="wfe-viz-chart wfe-viz-chart--auto"
        style={{ height }}
        role="img"
        aria-label={`Bar chart of ${aggLabel} per ${column} — ${groups.length} groups`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#dfe4e6" />
            <XAxis
              type="number"
              tickFormatter={agg === 'count' ? (v) => formatNumber(v, 0) : fmtAxis(target)}
              tick={TICK_STYLE}
            />
            <YAxis type="category" dataKey="value" width={112} tick={TICK_STYLE} />
            <Tooltip
              formatter={(value, _name, item) => [
                `${formatAgg(value)} · n=${formatNumber(item?.payload?.n, 0)}`,
                aggLabel,
              ]}
              contentStyle={TOOLTIP_STYLE}
            />
            <Bar
              dataKey="agg"
              fill="#0e7a6d"
              radius={[0, 2, 2, 0]}
              isAnimationActive={!reduced}
              animationDuration={450}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`${aggLabel} per ${column} group`}
        columns={[
          { key: 'value', label: column },
          { key: 'n', label: 'Rows', format: (v) => formatNumber(v, 0) },
          { key: 'agg', label: aggLabel, format: formatAgg },
        ]}
        rows={rows}
      />
      <p className="wfe-viz-caption mono">
        {formatNumber(groups.length, 0)} groups · {aggLabel} · sorted descending
      </p>
    </>
  )
}

const RENDERERS = {
  histogram: HistogramChart,
  scatter: ScatterPlot,
  box: BoxPlot,
  correlation: CorrelationGrid,
  category: CategoryChart,
}

/* ------------------------------------------------------------------------- */
/* Controls                                                                   */
/* ------------------------------------------------------------------------- */

function SelectField({ id, label, value, onChange, options, disabled = false }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Explorer                                                                   */
/* ------------------------------------------------------------------------- */

export default function VizExplorer({ datasetId }) {
  const reduced = useReducedMotion()

  // Column lists (dtype-filtered pickers) come from the features endpoint.
  const fetchFeatures = useCallback((signal) => getFeatures(datasetId, signal), [datasetId])
  const features = useApi(fetchFeatures)
  const numericCols = useMemo(
    () =>
      (features.data?.raw_features ?? [])
        .filter((f) => f?.dtype === 'numeric')
        .map((f) => f.name),
    [features.data],
  )
  const categoricalCols = useMemo(
    () =>
      (features.data?.raw_features ?? [])
        .filter((f) => f?.dtype === 'categorical')
        .map((f) => f.name),
    [features.data],
  )

  const [kind, setKind] = useState('histogram')
  const [paramsByKind, setParamsByKind] = useState(DEFAULT_PARAMS)
  const setParam = (key, value) =>
    setParamsByKind((prev) => ({ ...prev, [kind]: { ...prev[kind], [key]: value } }))

  // Debounce control changes (§6.3-05: fetch on change, debounced).
  const request = useMemo(
    () => ({ kind, params: paramsByKind[kind] }),
    [kind, paramsByKind],
  )
  const [debounced, setDebounced] = useState(request)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(request), 300)
    return () => clearTimeout(timer)
  }, [request])

  const fetchViz = useCallback(
    (signal) => viz[debounced.kind](datasetId, debounced.params, signal),
    [datasetId, debounced],
  )
  const { data, loading, error, reload } = useApi(fetchViz)

  // A payload only renders under the kind it belongs to — on a kind switch the
  // previous chart dims behind the "Updating…" state instead of misrendering.
  const matched = data != null && PAYLOAD_MATCH[debounced.kind]?.(data)
  const pickersReady = numericCols.length > 0 && categoricalCols.length > 0
  const withCurrent = (cols, current) =>
    cols.includes(current) ? cols : [current, ...cols]

  const Renderer = RENDERERS[debounced.kind]
  const empty = matched && isEmptyPayload[debounced.kind]?.(data)

  return (
    <div className="panel">
      <div className="panel-body">
        <div className="wfe-viz-controls">
          <div className="wfe-seg" role="group" aria-label="Chart type">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`wfe-seg-btn${debounced.kind === k.id ? ' wfe-seg-btn--on' : ''}`}
                aria-pressed={debounced.kind === k.id}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          {debounced.kind === 'histogram' && (
            <>
              <SelectField
                id="wfe-viz-hist-col"
                label="Numeric column"
                value={paramsByKind.histogram.column}
                onChange={(v) => setParam('column', v)}
                options={withCurrent(numericCols, paramsByKind.histogram.column)}
                disabled={!pickersReady}
              />
              <div className="field">
                <label className="field-label" htmlFor="wfe-viz-hist-bins">
                  Bins <span className="field-unit">{paramsByKind.histogram.bins}</span>
                </label>
                <input
                  id="wfe-viz-hist-bins"
                  type="range"
                  min={10}
                  max={60}
                  step={5}
                  value={paramsByKind.histogram.bins}
                  onChange={(event) => setParam('bins', Number(event.target.value))}
                />
              </div>
            </>
          )}

          {debounced.kind === 'scatter' && (
            <>
              <SelectField
                id="wfe-viz-scatter-x"
                label="X — numeric"
                value={paramsByKind.scatter.x}
                onChange={(v) => setParam('x', v)}
                options={withCurrent(numericCols, paramsByKind.scatter.x)}
                disabled={!pickersReady}
              />
              <SelectField
                id="wfe-viz-scatter-y"
                label="Y — numeric"
                value={paramsByKind.scatter.y}
                onChange={(v) => setParam('y', v)}
                options={withCurrent(numericCols, paramsByKind.scatter.y)}
                disabled={!pickersReady}
              />
              <SelectField
                id="wfe-viz-scatter-max"
                label="Max points"
                value={String(paramsByKind.scatter.maxPoints)}
                onChange={(v) => setParam('maxPoints', Number(v))}
                options={['500', '1500', '3000', '10000']}
              />
            </>
          )}

          {debounced.kind === 'box' && (
            <>
              <SelectField
                id="wfe-viz-box-col"
                label="Numeric column"
                value={paramsByKind.box.column}
                onChange={(v) => setParam('column', v)}
                options={withCurrent(numericCols, paramsByKind.box.column)}
                disabled={!pickersReady}
              />
              <SelectField
                id="wfe-viz-box-by"
                label="Group by — categorical"
                value={paramsByKind.box.by}
                onChange={(v) => setParam('by', v)}
                options={withCurrent(categoricalCols, paramsByKind.box.by)}
                disabled={!pickersReady}
              />
            </>
          )}

          {debounced.kind === 'correlation' && (
            <>
              <SelectField
                id="wfe-viz-corr-target"
                label="Target — numeric"
                value={paramsByKind.correlation.target}
                onChange={(v) => setParam('target', v)}
                options={withCurrent(numericCols, paramsByKind.correlation.target)}
                disabled={!pickersReady}
              />
              <SelectField
                id="wfe-viz-corr-top"
                label="Top features"
                value={String(paramsByKind.correlation.top)}
                onChange={(v) => setParam('top', Number(v))}
                options={['5', '10', '15', '20', '30']}
              />
            </>
          )}

          {debounced.kind === 'category' && (
            <>
              <SelectField
                id="wfe-viz-cat-col"
                label="Categorical column"
                value={paramsByKind.category.column}
                onChange={(v) => setParam('column', v)}
                options={withCurrent(categoricalCols, paramsByKind.category.column)}
                disabled={!pickersReady}
              />
              <SelectField
                id="wfe-viz-cat-agg"
                label="Aggregate"
                value={paramsByKind.category.agg}
                onChange={(v) => setParam('agg', v)}
                options={['median', 'mean', 'count']}
              />
            </>
          )}

          {loading && matched && (
            <span className="wfe-viz-updating" role="status">
              <span className="spinner spinner--dark" aria-hidden="true" /> Updating…
            </span>
          )}
        </div>

        {features.error && (
          <p className="note">
            Column lists failed to load — the chart below keeps its current selection.{' '}
            <button type="button" className="wfe-retry-link" onClick={features.reload}>
              Retry column lists
            </button>
          </p>
        )}

        <div aria-busy={loading && matched ? 'true' : undefined}>
          {loading && !matched && <PanelSkeleton height={300} />}
          {!loading && error && !matched && (
            <ErrorState
              error={error}
              onRetry={reload}
              title="This combination can't be plotted"
            />
          )}
          {matched && error && (
            <div className="alert alert-error wfe-viz-stale" role="alert">
              <span className="alert-title">Refresh failed</span>
              {error?.message ?? 'Could not refresh the chart.'} The previous chart is still
              shown.
              <span className="alert-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
                  Try again
                </button>
              </span>
            </div>
          )}
          {matched && !empty && (
            <div className={loading ? 'wfe-viz-dim' : undefined}>
              <Renderer payload={data} reduced={reduced} />
            </div>
          )}
          {matched && empty && (
            <EmptyState
              kicker="Nothing to plot"
              title="This combination has no rows"
              detail="The server aggregated zero rows for these choices — pick a different column or grouping."
            />
          )}
        </div>
      </div>
    </div>
  )
}
