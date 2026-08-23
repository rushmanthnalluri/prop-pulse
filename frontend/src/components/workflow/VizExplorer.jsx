/**
 * VizExplorer (WORKFLOW §6.3-05, rebuilt to blueprint §8.6) — stage 05's
 * sectioned visualization page, modelled on the reference visualize page:
 * a sticky .viz-nav anchor strip, then four sections separated by hairline
 * dividers.
 *
 *   #distributions  2-col grid of histogram cards — compact .chart-select
 *                   field switcher in each card head, "μ x · σ y" chart-tag,
 *                   200px amber histograms plus a smoothed trend line
 *                   derived from the server's bin counts.
 *   #correlations   server correlation matrix rendered as the reference's
 *                   CSS-grid heat map (raised→amber lerp, t = v**0.7, rotated
 *                   column labels, 0 ▬ +1 legend), then a wide
 *                   "Influence on {target}" horizontal-bar card.
 *   #categories     per-category median-{target} bar cards — vertical up to
 *                   12 groups, wide horizontal bars beyond that.
 *   #relationships  wide scatter card with x/y .chart-select controls.
 *
 * Every number comes from the §3.7 pre-aggregated endpoints (api/workflow.js
 * `viz`) — there is no client-side aggregation; the one derived series is
 * the histogram trend line, Gaussian-smoothed from the returned bin counts.
 * Column lists come from GET …/features; the σ in the chart-tags from
 * GET …/stats. Server-side column validation (422) surfaces as inline
 * alerts with retry; empty payloads get designed empty states; every chart
 * keeps role="img" + aria-label + ChartA11yTable (UX §7.8) and honors
 * prefers-reduced-motion (useReducedMotion + getAnimationProps).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { getFeatures, getStats, viz } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber, formatUsd } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ChartA11yTable from '../shared/ChartA11yTable'
import useReducedMotion from '../shared/useReducedMotion'
import {
  CHART_PALETTE,
  axisTick,
  cartesianGridProps,
  getAnimationProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../shared/chartTheme'

const HISTOGRAM_SLOTS = 6
const HISTOGRAM_BINS = 30
const CATEGORY_SLOTS = 4
const CORRELATION_TOP = 20
const SCATTER_MAX_POINTS = 1500
const WIDE_CATEGORY_GROUPS = 12

/** Ames-shaped defaults, always filtered against the live column lists — an
    uploaded dataset without them simply falls through to its own columns. */
const PREFERRED_HISTOGRAMS = ['SalePrice', 'GrLivArea', 'LotArea', 'YearBuilt', 'GarageArea', 'TotalBsmtSF']
const PREFERRED_CATEGORIES = ['Neighborhood', 'BldgType', 'HouseStyle', 'SaleCondition']
const PREFERRED_SCATTER_X = 'GrLivArea'

/** Preferred columns first (when present), then dataset order, capped at `count`. */
function pickColumns(preferred, available, count) {
  const picks = preferred.filter((name) => available.includes(name))
  for (const name of available) {
    if (picks.length >= count) break
    if (!picks.includes(name)) picks.push(name)
  }
  return picks.slice(0, count)
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

/** Compact stat for the "μ x · σ y" chart-tags ("181k" / "1,971" / "7.7"). */
function fmtShort(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 10000) return `${formatNumber(Math.round(n / 1000), 0)}k`
  if (abs >= 1000) return formatNumber(Math.round(n), 0)
  if (abs >= 10) return formatNumber(n, 0)
  return formatNumber(n, 1)
}

/* ------------------------------------------------------------------------- */
/* Derived series — the only client-side math, straight from the payload     */
/* ------------------------------------------------------------------------- */

/** Gaussian-smoothed bin counts — the reference's KDE overlay, computable
    from the histogram payload alone (bandwidth in bin units). */
function smoothCounts(counts, bandwidth = 1.6) {
  const radius = Math.max(1, Math.round(bandwidth * 3))
  const kernel = []
  for (let k = -radius; k <= radius; k += 1) kernel.push(Math.exp(-0.5 * (k / bandwidth) ** 2))
  return counts.map((_, i) => {
    let acc = 0
    let weight = 0
    for (let k = -radius; k <= radius; k += 1) {
      const j = i + k
      if (j < 0 || j >= counts.length) continue
      acc += counts[j] * kernel[k + radius]
      weight += kernel[k + radius]
    }
    return weight > 0 ? acc / weight : 0
  })
}

/** Reference heat cell (eda.py `_heat_color`): raised → amber lerp,
    t = clamp(v, 0, 1) ** 0.7; negative values stay at the base tone.
    The ramp splits at HEAT_FLIP into two segments collinear with that
    line: the smooth lerp crosses a fill-luminance band (~0.15–0.20)
    that neither ink token carries at WCAG 4.5:1, so the step sits at
    the ink flip and reads as the strong-correlation threshold band.
    Measured vs fill: ≥4.57:1 below the flip, ≥4.56:1 at/above it. */
const HEAT_BASE = [27, 31, 28]
const HEAT_TOP = [217, 166, 63]
/* Segment endpoints on the lerp line — the brightest fill --text still
   carries at ≥4.5:1, and the darkest fill --accent-ink still carries. */
const HEAT_MID_LOW = [130, 105, 47]
const HEAT_MID_HIGH = [154, 121, 51]
const HEAT_FLIP = 0.6 // on t (v ≈ +0.48) — fill segment and ink flip together

function heatColor(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return CHART_PALETTE.tooltipBg
  const t = Math.max(0, Math.min(1, v)) ** 0.7
  const [from, to, u] =
    t < HEAT_FLIP
      ? [HEAT_BASE, HEAT_MID_LOW, t / HEAT_FLIP]
      : [HEAT_MID_HIGH, HEAT_TOP, (t - HEAT_FLIP) / (1 - HEAT_FLIP)]
  const [r, g, b] = from.map((base, i) => Math.round(base + (to[i] - base) * u))
  return `rgb(${r}, ${g}, ${b})`
}

/** Ink text once the amber fill is bright enough to carry it — the same
    HEAT_FLIP threshold as the ramp split above. */
function heatStrong(value) {
  const v = Number(value)
  return Number.isFinite(v) && Math.max(0, Math.min(1, v)) ** 0.7 >= HEAT_FLIP
}

/* ------------------------------------------------------------------------- */
/* Shared section chrome                                                      */
/* ------------------------------------------------------------------------- */

function VizSection({ id, title, note, sub, className = '', children }) {
  return (
    <section className={`viz-section${className ? ` ${className}` : ''}`} id={id}>
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        {note && <span className="section-note">{note}</span>}
      </div>
      {sub && <p className="section-sub">{sub}</p>}
      {children}
    </section>
  )
}

/** Compact in-card alert for server column-validation (422) failures. */
function CardError({ error, onRetry }) {
  return (
    <div className="alert alert-error wfv-card-alert" role="alert">
      <span className="alert-title">This combination can&rsquo;t be plotted</span>
      {error?.message ?? 'Could not load the chart.'}
      <span className="alert-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* #distributions — histogram cards                                           */
/* ------------------------------------------------------------------------- */

function HistogramChart({ payload, reduced }) {
  const { column, bins, stats } = payload
  const total = bins.reduce((sum, bin) => sum + (bin.count ?? 0), 0)
  const smoothed = smoothCounts(bins.map((bin) => bin.count ?? 0))
  const rows = bins.map((bin, index) => ({
    i: index,
    count: bin.count ?? 0,
    smooth: smoothed[index],
  }))
  const axis = fmtAxis(column)
  const full = fmtFull(column)
  return (
    <>
      <div
        className="chart-wrap"
        role="img"
        aria-label={`Histogram of ${column} — ${bins.length} bins over ${formatNumber(total, 0)} rows, mean ${full(stats?.mean)}, median ${full(stats?.median)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="8%"
          >
            <CartesianGrid {...cartesianGridProps} />
            <XAxis
              dataKey="i"
              {...xAxisProps}
              interval="preserveStartEnd"
              minTickGap={42}
              tickFormatter={(i) => (bins[i] ? axis(bins[i].x0) : '')}
            />
            <YAxis {...yAxisProps} allowDecimals={false} />
            <Tooltip
              {...tooltipProps}
              labelFormatter={(i) => (bins[i] ? `${full(bins[i].x0)} – ${full(bins[i].x1)}` : '')}
              formatter={(value, name) =>
                name === 'smooth'
                  ? [formatNumber(value, 1), 'smoothed']
                  : [`${formatNumber(value, 0)} rows`, column]
              }
            />
            <Bar
              dataKey="count"
              name="count"
              fill={CHART_PALETTE.accentFill}
              stroke={CHART_PALETTE.accent}
              strokeWidth={1}
              radius={[1.5, 1.5, 0, 0]}
              {...getAnimationProps(reduced)}
            />
            <Line
              dataKey="smooth"
              name="smooth"
              type="monotone"
              stroke={CHART_PALETTE.text}
              strokeWidth={1.5}
              dot={false}
              {...getAnimationProps(reduced)}
            />
          </ComposedChart>
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
    </>
  )
}

function HistogramCard({ datasetId, initialColumn, columns, stdOf, reduced }) {
  const [column, setColumn] = useState(initialColumn)
  useEffect(() => setColumn(initialColumn), [initialColumn])

  const fetcher = useCallback(
    (signal) => viz.histogram(datasetId, { column, bins: HISTOGRAM_BINS }, signal),
    [datasetId, column],
  )
  const { data, loading, error, reload } = useApi(fetcher)
  const payload = data && Array.isArray(data.bins) ? data : null
  const empty = payload !== null && payload.bins.length === 0
  const std = payload ? stdOf(payload.column) : null

  return (
    <div className="chart-card">
      <div className="chart-card-head wfv-card-head">
        <select
          className="chart-select"
          value={column}
          onChange={(event) => setColumn(event.target.value)}
          aria-label="Histogram field"
        >
          {columns.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {payload && (
          <span className="chart-tag">
            μ {fmtShort(payload.stats?.mean)}
            {std !== null && std !== undefined && ` · σ ${fmtShort(std)}`}
          </span>
        )}
      </div>
      {loading && !payload && <PanelSkeleton height={168} />}
      {!loading && error && !payload && <CardError error={error} onRetry={reload} />}
      {payload && !empty && (
        <div className={loading ? 'wfv-dim' : undefined}>
          <HistogramChart payload={payload} reduced={reduced} />
        </div>
      )}
      {payload && empty && (
        <EmptyState
          kicker="Nothing to plot"
          title="No rows for this field"
          detail="The server aggregated zero rows — pick a different field above."
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* #correlations — CSS-grid heat map + influence bars                         */
/* ------------------------------------------------------------------------- */

function InfluenceChart({ payload, reduced }) {
  const targetIndex = payload.features.indexOf(payload.target)
  const rows = payload.features
    .map((feature, i) => {
      const raw = payload.matrix?.[i]?.[targetIndex]
      return { feature, r: raw === null || raw === undefined ? NaN : Number(raw) }
    })
    .filter((row) => row.feature !== payload.target && Number.isFinite(row.r))
  if (targetIndex < 0 || rows.length === 0) return null
  const minR = rows.reduce((min, row) => Math.min(min, row.r), 0)
  return (
    <div className="chart-card chart-card-wide mt-36">
      <div className="chart-card-head">
        <h3>Influence on {payload.target}</h3>
        <span className="chart-tag">correlation coefficient</span>
      </div>
      <div
        className="chart-wrap-tall"
        role="img"
        aria-label={`Horizontal bar chart of each field's correlation with ${payload.target}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={rows}
            margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            barCategoryGap="24%"
          >
            <CartesianGrid {...cartesianGridProps} vertical horizontal={false} />
            <XAxis
              type="number"
              domain={[minR < 0 ? -1 : 0, 1]}
              {...xAxisProps}
              tickFormatter={(v) => Number(v).toFixed(1)}
            />
            <YAxis type="category" dataKey="feature" {...yAxisProps} width={140} />
            <Tooltip
              {...tooltipProps}
              formatter={(value) => [Number(value).toFixed(3), `r with ${payload.target}`]}
            />
            <Bar
              dataKey="r"
              name={payload.target}
              fill={CHART_PALETTE.accentFill}
              stroke={CHART_PALETTE.accent}
              strokeWidth={1}
              radius={[0, 2, 2, 0]}
              maxBarSize={18}
              {...getAnimationProps(reduced)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`Correlation of each numeric field with ${payload.target}`}
        columns={[
          { key: 'feature', label: 'Field' },
          { key: 'r', label: `r with ${payload.target}`, format: (v) => Number(v).toFixed(4) },
        ]}
        rows={rows}
      />
      <p className="wfv-caption">
        {formatNumber(rows.length, 0)} fields · ranked by |r| · bars left of zero are negative
        correlations
      </p>
    </div>
  )
}

function CorrelationMatrix({ payload }) {
  const { target, features, matrix } = payload
  const n = features.length
  return (
    <>
      <div
        className="heat-scroll"
        role="img"
        aria-label={`Correlation matrix of the top ${Math.max(0, n - 1)} numeric fields by absolute correlation with ${target}`}
      >
        <div className="heat-grid" style={{ '--n': n }}>
          <div aria-hidden="true" />
          {features.map((col) => (
            <div key={`h-${col}`} className="heat-col-label">
              <span>{col}</span>
            </div>
          ))}
          {features.map((row, i) => (
            <Fragment key={row}>
              <div className="heat-row-label" title={row}>
                {row}
              </div>
              {features.map((col, j) => {
                const raw = matrix?.[i]?.[j]
                const value = Number(raw)
                const valid = raw !== null && raw !== undefined && Number.isFinite(value)
                return (
                  <div
                    key={`${row}__${col}`}
                    className={`heat-cell${valid && heatStrong(value) ? ' heat-strong' : ''}`}
                    style={{ background: valid ? heatColor(value) : CHART_PALETTE.tooltipBg }}
                    title={valid ? `${row} × ${col}: ${value.toFixed(2)}` : undefined}
                  >
                    {valid ? value.toFixed(2) : ''}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
        <div className="heat-legend">
          <span>0</span>
          <span className="heat-legend-bar" aria-hidden="true" />
          <span>+1</span>
        </div>
      </div>
      <ChartA11yTable
        caption={`Pearson correlation matrix — top ${Math.max(0, n - 1)} numeric fields plus ${target}`}
        columns={[
          { key: 'feature', label: 'Field' },
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
    </>
  )
}

function CorrelationSection({ datasetId, target, reduced }) {
  const fetcher = useCallback(
    (signal) => viz.correlation(datasetId, { target, top: CORRELATION_TOP }, signal),
    [datasetId, target],
  )
  const { data, loading, error, reload } = useApi(fetcher)
  const payload = data && Array.isArray(data.features) && Array.isArray(data.matrix) ? data : null
  const empty = payload !== null && payload.features.length === 0

  return (
    <VizSection
      id="correlations"
      title="Correlation matrix — numeric fields"
      note={payload ? `top ${Math.max(0, payload.features.length - 1)} by |r| with ${payload.target} · pearson` : undefined}
      sub="Computed server-side from the raw active dataset, pairwise-complete. Cells colour from 0 (base) toward +1 (amber); negative correlations stay at the base tone — hover any cell for the signed value."
    >
      {loading && !payload && <PanelSkeleton height={320} />}
      {!loading && error && !payload && (
        <ErrorState error={error} onRetry={reload} title="Couldn't load the correlation matrix" />
      )}
      {payload && !empty && (
        <div className={loading ? 'wfv-dim' : undefined}>
          <CorrelationMatrix payload={payload} />
          <InfluenceChart payload={payload} reduced={reduced} />
        </div>
      )}
      {payload && empty && (
        <EmptyState
          kicker="Nothing to plot"
          title="No numeric fields to correlate"
          detail="The server found no numeric columns with a defined correlation — the dataset needs at least two varying numeric fields."
        />
      )}
    </VizSection>
  )
}

/* ------------------------------------------------------------------------- */
/* #categories — median-{target} bar cards                                    */
/* ------------------------------------------------------------------------- */

function CategoryChart({ payload, reduced }) {
  const { column, target, groups } = payload
  const rows = groups.map((g) => ({ value: g.value, n: g.n, agg: g.agg_value }))
  const wide = groups.length > WIDE_CATEGORY_GROUPS
  const full = fmtFull(target)
  const aggLabel = `median ${target}`
  const formatAgg = (v) => (!Number.isFinite(Number(v)) ? '—' : full(v))
  const axis = fmtAxis(target)
  return (
    <>
      <div
        className={wide ? 'wfv-chart-auto' : 'chart-wrap'}
        style={wide ? { height: Math.max(220, Math.min(600, groups.length * 26 + 48)) } : undefined}
        role="img"
        aria-label={`Bar chart of ${aggLabel} per ${column} — ${groups.length} groups, sorted descending`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {wide ? (
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
              barCategoryGap="24%"
            >
              <CartesianGrid {...cartesianGridProps} vertical horizontal={false} />
              <XAxis type="number" {...xAxisProps} tickFormatter={axis} />
              <YAxis type="category" dataKey="value" {...yAxisProps} width={112} />
              <Tooltip
                {...tooltipProps}
                formatter={(value, _name, item) => [
                  `${formatAgg(value)} · n=${formatNumber(item?.payload?.n, 0)}`,
                  aggLabel,
                ]}
              />
              <Bar
                dataKey="agg"
                name={aggLabel}
                fill={CHART_PALETTE.accentFill}
                stroke={CHART_PALETTE.accent}
                strokeWidth={1}
                radius={[0, 1.5, 1.5, 0]}
                {...getAnimationProps(reduced)}
              />
            </BarChart>
          ) : (
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
              <CartesianGrid {...cartesianGridProps} />
              <XAxis dataKey="value" {...xAxisProps} minTickGap={8} />
              <YAxis {...yAxisProps} tickFormatter={axis} />
              <Tooltip
                {...tooltipProps}
                formatter={(value, _name, item) => [
                  `${formatAgg(value)} · n=${formatNumber(item?.payload?.n, 0)}`,
                  aggLabel,
                ]}
              />
              <Bar
                dataKey="agg"
                name={aggLabel}
                fill={CHART_PALETTE.accentFill}
                stroke={CHART_PALETTE.accent}
                strokeWidth={1}
                radius={[1.5, 1.5, 0, 0]}
                maxBarSize={56}
                {...getAnimationProps(reduced)}
              />
            </BarChart>
          )}
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
    </>
  )
}

function CategoryCard({ datasetId, column, target, reduced }) {
  const fetcher = useCallback(
    (signal) => viz.category(datasetId, { column, agg: 'median', target }, signal),
    [datasetId, column, target],
  )
  const { data, loading, error, reload } = useApi(fetcher)
  const payload = data && Array.isArray(data.groups) ? data : null
  const empty = payload !== null && payload.groups.length === 0
  const wide = payload !== null && payload.groups.length > WIDE_CATEGORY_GROUPS

  return (
    <div className={`chart-card${wide ? ' chart-card-wide' : ''}`}>
      <div className="chart-card-head">
        <h3>{column}</h3>
        <span className="chart-tag">
          median {target}
          {payload && !empty && ` · ${formatNumber(payload.groups.length, 0)} groups`}
        </span>
      </div>
      {loading && !payload && <PanelSkeleton height={168} />}
      {!loading && error && !payload && <CardError error={error} onRetry={reload} />}
      {payload && !empty && (
        <div className={loading ? 'wfv-dim' : undefined}>
          <CategoryChart payload={payload} reduced={reduced} />
        </div>
      )}
      {payload && empty && (
        <EmptyState
          kicker="Nothing to plot"
          title="No groups for this field"
          detail="The server aggregated zero rows for this column."
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* #relationships — scatter with x/y switchers                                */
/* ------------------------------------------------------------------------- */

function ScatterPlot({ payload, reduced }) {
  const { x, y, points, n_total: nTotal, sampled } = payload
  const rows = points.map(([px, py]) => ({ x: px, y: py }))
  const fullX = fmtFull(x)
  const fullY = fmtFull(y)
  return (
    <>
      <div
        className="chart-wrap-tall"
        role="img"
        aria-label={`Scatter plot of ${y} against ${x} — ${formatNumber(rows.length, 0)} points`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid {...cartesianGridProps} />
            <XAxis
              type="number"
              dataKey="x"
              name={x}
              domain={['auto', 'auto']}
              {...xAxisProps}
              tickFormatter={fmtAxis(x)}
              label={{ value: x, position: 'insideBottomRight', offset: -2, ...axisTick }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={y}
              domain={['auto', 'auto']}
              {...yAxisProps}
              width={56}
              tickFormatter={fmtAxis(y)}
            />
            <Tooltip
              {...tooltipProps}
              cursor={{ strokeDasharray: '3 3', stroke: CHART_PALETTE.tooltipBorder }}
              formatter={(value, name) => [name === x ? fullX(value) : fullY(value), name]}
            />
            <Scatter
              data={rows}
              fill={CHART_PALETTE.accent}
              fillOpacity={0.55}
              {...getAnimationProps(reduced)}
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
      <p className="wfv-caption">
        {sampled && <span className="badge badge-warn">Sampled</span>}
        {sampled
          ? `${formatNumber(rows.length, 0)} of ${formatNumber(nTotal, 0)} rows — deterministic seeded sample`
          : `${formatNumber(nTotal, 0)} rows — every row plotted`}
      </p>
    </>
  )
}

function ScatterCard({ datasetId, columns, initialX, initialY, reduced }) {
  const [x, setX] = useState(initialX)
  const [y, setY] = useState(initialY)
  useEffect(() => {
    setX(initialX)
    setY(initialY)
  }, [initialX, initialY])

  const fetcher = useCallback(
    (signal) => viz.scatter(datasetId, { x, y, maxPoints: SCATTER_MAX_POINTS }, signal),
    [datasetId, x, y],
  )
  const { data, loading, error, reload } = useApi(fetcher)
  const payload = data && Array.isArray(data.points) ? data : null
  const empty = payload !== null && payload.points.length === 0

  return (
    <div className="chart-card chart-card-wide">
      <div className="chart-card-head wfv-card-head">
        <h3>{payload ? `${payload.y} × ${payload.x}` : `${y} × ${x}`}</h3>
        <div className="wfv-head-controls">
          <span className="wfv-axis-label" aria-hidden="true">
            x
          </span>
          <select
            className="chart-select"
            value={x}
            onChange={(event) => setX(event.target.value)}
            aria-label="X axis field"
          >
            {columns.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="wfv-axis-label" aria-hidden="true">
            y
          </span>
          <select
            className="chart-select"
            value={y}
            onChange={(event) => setY(event.target.value)}
            aria-label="Y axis field"
          >
            {columns.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading && !payload && <PanelSkeleton height={280} />}
      {!loading && error && !payload && <CardError error={error} onRetry={reload} />}
      {payload && !empty && (
        <div className={loading ? 'wfv-dim' : undefined}>
          <ScatterPlot payload={payload} reduced={reduced} />
        </div>
      )}
      {payload && empty && (
        <EmptyState
          kicker="Nothing to plot"
          title="No rows for this pair"
          detail="Every row is missing one of the two fields — pick a different pair above."
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Explorer                                                                   */
/* ------------------------------------------------------------------------- */

function ExplorerSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="viz-section">
        <div className="chart-grid">
          <PanelSkeleton height={224} />
          <PanelSkeleton height={224} />
        </div>
      </div>
      <div className="viz-section">
        <PanelSkeleton height={320} />
      </div>
    </div>
  )
}

export default function VizExplorer({ datasetId }) {
  const reduced = useReducedMotion()

  // Column lists (dtype-filtered pickers) come from the features endpoint.
  const fetchFeatures = useCallback((signal) => getFeatures(datasetId, signal), [datasetId])
  const features = useApi(fetchFeatures)
  // Full-column σ for the "μ x · σ y" tags (the histogram payload carries
  // min/max/mean/median only); tags degrade to μ-only while it is in flight.
  const fetchStats = useCallback((signal) => getStats(datasetId, signal), [datasetId])
  const stats = useApi(fetchStats)

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

  // The regression target drives correlation + category aggregation; fall
  // back to the last numeric column when the dataset has no SalePrice.
  const target = useMemo(() => {
    const regression = features.data?.targets?.regression
    if (regression?.available && typeof regression.column === 'string') return regression.column
    return numericCols.length > 0 ? numericCols[numericCols.length - 1] : null
  }, [features.data, numericCols])

  const stdMap = useMemo(() => {
    if (stats.loading || !Array.isArray(stats.data?.numeric)) return null
    const map = new Map()
    for (const row of stats.data.numeric) {
      if (row?.name) map.set(row.name, row.std ?? null)
    }
    return map
  }, [stats.loading, stats.data])
  const stdOf = useCallback((name) => (stdMap ? (stdMap.get(name) ?? null) : null), [stdMap])

  // Gate on loading (not just first paint): a dataset switch keeps the old
  // columns in `features.data` while the new list is in flight — rendering
  // those against the new dataset would flash spurious 422 alerts.
  if (features.loading) return <ExplorerSkeleton />
  if (features.error) {
    return (
      <section className="viz-section">
        <ErrorState
          error={features.error}
          onRetry={features.reload}
          title="Couldn't load the column lists"
        />
      </section>
    )
  }

  const histogramPicks = pickColumns(PREFERRED_HISTOGRAMS, numericCols, HISTOGRAM_SLOTS)
  const categoryPicks = pickColumns(PREFERRED_CATEGORIES, categoricalCols, CATEGORY_SLOTS)
  const scatterX = numericCols.includes(PREFERRED_SCATTER_X) ? PREFERRED_SCATTER_X : numericCols[0]
  const scatterY =
    target && target !== scatterX ? target : (numericCols.find((c) => c !== scatterX) ?? scatterX)

  return (
    <>
      <nav className="viz-nav" aria-label="Chart sections">
        <a href="#distributions">Distributions</a>
        <a href="#correlations">Correlations</a>
        <a href="#categories">Categories</a>
        <a href="#relationships">Relationships</a>
      </nav>

      <VizSection
        id="distributions"
        title="Distributions — key numeric fields"
        note={`${HISTOGRAM_BINS} bins · trend smoothed from bin counts`}
      >
        {histogramPicks.length === 0 ? (
          <EmptyState
            kicker="Nothing to plot"
            title="No numeric fields"
            detail="This dataset reported no numeric columns, so there are no distributions to draw."
          />
        ) : (
          <div className="chart-grid">
            {histogramPicks.map((column) => (
              <HistogramCard
                key={column}
                datasetId={datasetId}
                initialColumn={column}
                columns={numericCols}
                stdOf={stdOf}
                reduced={reduced}
              />
            ))}
          </div>
        )}
      </VizSection>

      <hr className="divider" aria-hidden="true" />

      {target ? (
        <CorrelationSection datasetId={datasetId} target={target} reduced={reduced} />
      ) : (
        <VizSection id="correlations" title="Correlation matrix — numeric fields">
          <EmptyState
            kicker="Nothing to plot"
            title="No numeric fields to correlate"
            detail="The dataset needs at least two numeric columns before a correlation matrix can be computed."
          />
        </VizSection>
      )}

      <hr className="divider" aria-hidden="true" />

      <VizSection
        id="categories"
        title={target ? `Categories — median ${target} per group` : 'Categories'}
        note="sorted descending · n per group in the tooltip"
      >
        {categoryPicks.length === 0 || !target ? (
          <EmptyState
            kicker="Nothing to plot"
            title="No categorical fields"
            detail="This dataset reported no categorical columns to group by."
          />
        ) : (
          <div className="chart-grid">
            {categoryPicks.map((column) => (
              <CategoryCard
                key={column}
                datasetId={datasetId}
                column={column}
                target={target}
                reduced={reduced}
              />
            ))}
          </div>
        )}
      </VizSection>

      <hr className="divider" aria-hidden="true" />

      <VizSection
        id="relationships"
        title="Relationships — numeric pairs"
        note={`seeded sample beyond ${formatNumber(SCATTER_MAX_POINTS, 0)} rows`}
        className="pb-56"
      >
        {numericCols.length === 0 ? (
          <EmptyState
            kicker="Nothing to plot"
            title="No numeric fields"
            detail="This dataset reported no numeric columns, so there is no pair to scatter."
          />
        ) : (
          <ScatterCard
            datasetId={datasetId}
            columns={numericCols}
            initialX={scatterX}
            initialY={scatterY}
            reduced={reduced}
          />
        )}
      </VizSection>
    </>
  )
}
