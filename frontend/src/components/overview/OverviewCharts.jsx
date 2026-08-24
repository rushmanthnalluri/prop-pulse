/**
 * Overview chart grid (blueprint §8.1-4) — the reference home's four chart
 * slots rebuilt on PropPulse payloads:
 *
 *   ① "Sales by micro-market"      donut      — GET /market/clusters (page prop)
 *   ② "Field distribution"         histogram  — GET /workflow/datasets/ames/viz/histogram
 *   ③ "Median sale price by field" bars       — GET /workflow/datasets/ames/viz/category
 *   ④ "Price trends by micro-market" lines    — GET /market/trends (session-cached)
 *
 * ④ folds the old standalone TrendsTeaser section into the grid; the
 * reference's ④ (correlation heatmap) stays in the workbench — stage 05 owns
 * the full matrix, and the champion API exposes no correlation payload.
 *
 * The whole grid is one lazy chunk so recharts stays out of the landing
 * bundle (AUDIT §4). Every card owns its skeleton / error+retry / empty
 * state and never blanks a sibling; every chart keeps role="img" +
 * aria-label plus a ChartA11yTable of the exact plotted values (SPEC §7.8),
 * and series animation honors prefers-reduced-motion.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { workflowApi } from '../../api/workflow'
import { NEIGHBORHOODS, clusterColor, clusterLabel } from '../../constants'
import { formatNumber, formatUsd, formatYear, isFiniteValue, prettyFeature } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ChartA11yTable from '../shared/ChartA11yTable'
import TrendsChart from '../shared/TrendsChart'
import useReducedMotion from '../shared/useReducedMotion'
import {
  CHART_PALETTE,
  cartesianGridProps,
  getAnimationProps,
  kTick,
  legendProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../shared/chartTheme'

/** The bundled workbench record the EDA cards describe (bundled default, §3.1). */
const BUNDLED_DATASET = 'ames'

/** Thin long x-axes to ~7 labels (blueprint §6 maxTicksLimit). */
const labelInterval = (length) => Math.max(0, Math.ceil(length / 7) - 1)

/**
 * Single-row tooltip for the histogram: the bars and the smoothed outline
 * share one dataKey, so the default renderer would print the same count
 * twice. This keeps the chartTheme chrome and reads the bin once.
 */
function HistogramTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload
  if (!row) return null
  return (
    <div style={tooltipProps.contentStyle}>
      <div style={tooltipProps.labelStyle}>{row.range}</div>
      <div style={tooltipProps.itemStyle}>{formatNumber(row.count, 0)} sales</div>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* ① Sales by micro-market — donut (data passed from the page-level query)    */
/* ------------------------------------------------------------------------- */

function MarketDonut({ clusters }) {
  const { data, loading, error, reload } = clusters
  const reduced = useReducedMotion()

  const slices = useMemo(() => {
    const list = Array.isArray(data?.clusters) ? data.clusters : []
    return list
      .filter((c) => isFiniteValue(c?.n_sales) && Number(c.n_sales) > 0)
      .map((c) => ({ id: c?.cluster_id, name: clusterLabel(c), value: Number(c.n_sales) }))
  }, [data])

  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const ariaLabel = slices.length
    ? `Donut chart of training sales by micro-market: ${slices
        .map((s) => `${s.name} ${s.value}`)
        .join(', ')}`
    : 'Donut chart of training sales by micro-market'

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h3>Sales by micro-market</h3>
      </div>
      {loading && <PanelSkeleton height={200} />}
      {!loading && error && (
        <ErrorState title="Couldn't load micro-markets" error={error} onRetry={reload} />
      )}
      {!loading && !error && slices.length === 0 && (
        <EmptyState
          kicker="No micro-markets"
          title="No cluster sales returned"
          detail="The API returned no micro-market sales split. The full market read is on the Market Intelligence page."
        >
          <Link className="btn btn-secondary btn-sm" to="/market">
            Open market intelligence
          </Link>
        </EmptyState>
      )}
      {!loading && !error && slices.length > 0 && (
        <>
          <div className="chart-wrap" role="img" aria-label={ariaLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="58%"
                  outerRadius="78%"
                  cy="42%"
                  stroke={CHART_PALETTE.tooltipBg}
                  strokeWidth={2}
                  /* recharts defaults rootTabIndex to 0, putting a dead,
                     nameless <g> in the tab order (no keyboard handlers live
                     on it) — the role=img label + ChartA11yTable below are
                     the real equivalents, so the layer stays out of Tab. */
                  rootTabIndex={-1}
                  {...getAnimationProps(reduced)}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.id ?? slice.name} fill={clusterColor(slice.id)} />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, name) => [
                    `${formatNumber(value, 0)} sales · ${((Number(value) / total) * 100).toFixed(1)}%`,
                    name,
                  ]}
                />
                <Legend
                  {...legendProps}
                  formatter={(value) => <span className="capitalize">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Sale total inside the ring (the card head stays clean; the
                figure is also in the a11y table below). Caption stays one
                short word — the ring's inner chord is ~90px. */}
            <div className="ov-donut-center" aria-hidden="true">
              <span className="ov-donut-total">{formatNumber(total, 0)}</span>
              <span className="ov-donut-caption">sales</span>
            </div>
          </div>
          <ChartA11yTable
            caption="Clustered sales per micro-market"
            columns={[
              { key: 'name', label: 'Micro-market' },
              { key: 'value', label: 'Sales' },
            ]}
            rows={slices}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* ② Field distribution — histogram + smoothed outline, head select           */
/* ------------------------------------------------------------------------- */

const HISTOGRAM_FIELDS = [
  { column: 'SalePrice', bins: 24, tick: kTick, range: (v) => formatUsd(v) },
  {
    column: 'GrLivArea',
    bins: 24,
    tick: (v) => `${formatNumber(Number(v) / 1000, 1)}k`,
    range: (v) => `${formatNumber(v, 0)} sq ft`,
  },
  {
    column: 'LotArea',
    bins: 24,
    tick: (v) => `${formatNumber(Number(v) / 1000, 0)}k`,
    range: (v) => `${formatNumber(v, 0)} sq ft`,
  },
  { column: 'YearBuilt', bins: 24, tick: formatYear, range: formatYear },
  {
    column: 'OverallQual',
    bins: 9,
    tick: (v) => formatNumber(v, 0),
    range: (v) => formatNumber(v, 1),
  },
]

function FieldHistogram() {
  const [column, setColumn] = useState('SalePrice')
  const field = HISTOGRAM_FIELDS.find((f) => f.column === column) ?? HISTOGRAM_FIELDS[0]
  const reduced = useReducedMotion()
  // Per-column response cache: toggling back to a viewed field never refetches.
  const cacheRef = useRef(new Map())

  const fetcher = useCallback(
    (signal) => {
      const cache = cacheRef.current
      const hit = cache.get(column)
      if (hit) return Promise.resolve(hit)
      return workflowApi.viz
        .histogram(BUNDLED_DATASET, { column, bins: field.bins }, signal)
        .then((payload) => {
          cache.set(column, payload)
          return payload
        })
    },
    [column, field.bins],
  )
  const { data, loading, error, reload } = useApi(fetcher)

  const rows = useMemo(() => {
    const bins = Array.isArray(data?.bins) ? data.bins : []
    return bins
      .filter((b) => isFiniteValue(b?.x0) && isFiniteValue(b?.x1) && isFiniteValue(b?.count))
      .map((b) => ({
        tick: field.tick(b.x0),
        range: `${field.range(b.x0)} – ${field.range(b.x1)}`,
        count: Number(b.count),
      }))
  }, [data, field])

  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <h3>Field distribution</h3>
        <select
          className="chart-select"
          value={column}
          onChange={(event) => setColumn(event.target.value)}
          aria-label="Field shown in the distribution chart"
        >
          {HISTOGRAM_FIELDS.map((f) => (
            <option key={f.column} value={f.column}>
              {prettyFeature(f.column)}
            </option>
          ))}
        </select>
      </div>
      {loading && <PanelSkeleton height={200} />}
      {!loading && error && (
        <ErrorState title="Couldn't load the distribution" error={error} onRetry={reload} />
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          kicker="No distribution"
          title="No values for this field"
          detail="The API returned no usable bins for the selected field. The full visualization set is on stage 05."
        >
          <Link className="btn btn-secondary btn-sm" to="/workflow/05-viz">
            Open Visualization
          </Link>
        </EmptyState>
      )}
      {!loading && !error && rows.length > 0 && (
        <>
          <div
            className="chart-wrap"
            role="img"
            aria-label={`Histogram of ${column} across the bundled Ames record — ${rows.length} bins with a smoothed outline`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid {...cartesianGridProps} />
                <XAxis
                  dataKey="tick"
                  {...xAxisProps}
                  interval={labelInterval(rows.length)}
                />
                <YAxis {...yAxisProps} width={40} />
                <Tooltip {...tooltipProps} content={<HistogramTooltip />} />
                <Bar
                  dataKey="count"
                  fill={CHART_PALETTE.accentFill}
                  stroke={CHART_PALETTE.accent}
                  strokeWidth={1}
                  radius={[1.5, 1.5, 0, 0]}
                  {...getAnimationProps(reduced)}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={CHART_PALETTE.text}
                  strokeWidth={1.5}
                  dot={false}
                  {...getAnimationProps(reduced)}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <ChartA11yTable
            caption={`Histogram of ${column} — bin range and sale count`}
            columns={[
              { key: 'range', label: column },
              { key: 'count', label: 'Sales' },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* ③ Median sale price by field — wide bars, head select                      */
/* ------------------------------------------------------------------------- */

const CATEGORY_FIELDS = ['Neighborhood', 'HouseStyle', 'OverallQual', 'BldgType']

/** "NAmes" → "NAmes — North Ames" for the tooltip title; other fields raw. */
function categoryTitle(column, value) {
  if (column !== 'Neighborhood') return value
  const match = NEIGHBORHOODS.find((n) => n.value === value)
  return match ? `${value} — ${match.label}` : value
}

function PriceByField() {
  const [column, setColumn] = useState('Neighborhood')
  const reduced = useReducedMotion()
  const cacheRef = useRef(new Map())

  const fetcher = useCallback(
    (signal) => {
      const cache = cacheRef.current
      const hit = cache.get(column)
      if (hit) return Promise.resolve(hit)
      return workflowApi.viz
        .category(BUNDLED_DATASET, { column, agg: 'median', target: 'SalePrice' }, signal)
        .then((payload) => {
          cache.set(column, payload)
          return payload
        })
    },
    [column],
  )
  const { data, loading, error, reload } = useApi(fetcher)

  const rows = useMemo(() => {
    const groups = Array.isArray(data?.groups) ? data.groups : []
    return groups
      .filter((g) => g?.value != null && isFiniteValue(g?.agg_value))
      .map((g) => ({ name: String(g.value), median: Number(g.agg_value), n: isFiniteValue(g?.n) ? Number(g.n) : null }))
  }, [data])

  return (
    <div className="chart-card chart-card-wide">
      <div className="chart-card-head">
        <h3>Median sale price by field</h3>
        <select
          className="chart-select"
          value={column}
          onChange={(event) => setColumn(event.target.value)}
          aria-label="Field shown in the median-price chart"
        >
          {CATEGORY_FIELDS.map((name) => (
            <option key={name} value={name}>
              {prettyFeature(name)}
            </option>
          ))}
        </select>
      </div>
      {loading && <PanelSkeleton height={200} />}
      {!loading && error && (
        <ErrorState title="Couldn't load the price split" error={error} onRetry={reload} />
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          kicker="No price split"
          title="No groups for this field"
          detail="The API returned no usable category medians for the selected field."
        />
      )}
      {!loading && !error && rows.length > 0 && (
        <>
          <div
            className="chart-wrap"
            role="img"
            aria-label={`Bar chart of median sale price per ${column} group, sorted high to low`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <CartesianGrid {...cartesianGridProps} />
                <XAxis
                  dataKey="name"
                  {...xAxisProps}
                  interval={labelInterval(rows.length)}
                />
                <YAxis {...yAxisProps} tickFormatter={kTick} width={56} />
                <Tooltip
                  {...tooltipProps}
                  labelFormatter={(value) => categoryTitle(column, value)}
                  formatter={(value, _name, item) => [
                    `${formatUsd(value)} median${item?.payload?.n != null ? ` · n=${formatNumber(item.payload.n, 0)}` : ''}`,
                    'Sale price',
                  ]}
                />
                <Bar
                  dataKey="median"
                  fill={CHART_PALETTE.accentFill}
                  stroke={CHART_PALETTE.accent}
                  strokeWidth={1}
                  radius={[1.5, 1.5, 0, 0]}
                  {...getAnimationProps(reduced)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ChartA11yTable
            caption={`Median sale price per ${column} group, USD, sorted high to low`}
            columns={[
              { key: 'name', label: column },
              { key: 'median', label: 'Median sale price', format: formatUsd },
              { key: 'n', label: 'Sales' },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* ④ Price trends by micro-market — wide lines (folds the old TrendsTeaser)   */
/* ------------------------------------------------------------------------- */

function TrendsCard() {
  // Signal-free: api.getTrends is session-cached and shared with the page's
  // warm-up call — one promise, no abortable duplicate (see Overview.jsx).
  const fetcher = useCallback(() => api.getTrends(), [])
  return (
    <TrendsChart
      fetcher={fetcher}
      title="Price trends by micro-market"
      renderTag={({ firstPeriod, lastPeriod }) =>
        firstPeriod && lastPeriod ? (
          <span className="chart-tag">
            Median sale price · {firstPeriod}–{lastPeriod}
          </span>
        ) : null
      }
      ariaLabel={({ firstPeriod, lastPeriod }) =>
        `Line chart of median sale price per micro-market, half-year periods ${firstPeriod} to ${lastPeriod}`
      }
      errorTitle="Couldn't load price trends"
      skeletonHeight={200}
      margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
      strokeWidth={1.8}
      dot={{ r: 2 }}
      noteClassName="note ov-note-block"
    />
  )
}

/* ------------------------------------------------------------------------- */

export default function OverviewCharts({ clusters }) {
  return (
    <div className="chart-grid mt-32">
      <MarketDonut clusters={clusters} />
      <FieldHistogram />
      <PriceByField />
      <TrendsCard />
    </div>
  )
}
