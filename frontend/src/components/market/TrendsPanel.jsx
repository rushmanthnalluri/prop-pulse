/**
 * Market trends panel (Market Intelligence page): one median-price line per
 * micro-market over the half-year periods 2006H1–2008H2, from GET
 * /market/trends. Self-contained fetch (useApi) with its own skeleton /
 * error+retry / empty states, so a failed trends call never blanks the map
 * section, and vice versa.
 *
 * Chart skin: recharts + the shared chartTheme spread props (blueprint §6) —
 * Plex Mono 10px ticks, y-only hairline grid, raised tooltip with a hairline
 * border, 450ms ease-out animation that drops to 0ms under
 * prefers-reduced-motion. Null / non-finite medians are real gaps in the data
 * — they stay gaps (connectNulls=false), never interpolated. Series colors
 * come from clusterColor() in constants.js, the single source of truth shared
 * with the map markers and cluster cards.
 *
 * Accessibility: role="img" + aria-label on the chart frame and a
 * visually-hidden ChartA11yTable of the exact plotted values.
 */
import { useCallback, useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { clusterColor } from '../../constants'
import { formatUsd } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ChartA11yTable from '../shared/ChartA11yTable'
import useReducedMotion from '../shared/useReducedMotion'
import {
  cartesianGridProps,
  getAnimationProps,
  legendProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../shared/chartTheme'

/** Compact "$180k" y-axis tick. */
const kTick = (value) => `$${Math.round(Number(value) / 1000)}k`

export default function TrendsPanel() {
  const fetcher = useCallback((signal) => api.getTrends(signal), [])
  const { data, loading, error, reload } = useApi(fetcher)
  const reduced = useReducedMotion()

  // Shape guards: a contract-drifting payload degrades to the empty state
  // instead of throwing mid-render.
  const { rows, lines } = useMemo(() => {
    const periods = Array.isArray(data?.periods) ? data.periods : []
    const rawSeries = Array.isArray(data?.series) ? data.series : []
    const lines = rawSeries.map((s, index) => ({
      key: typeof s?.label === 'string' && s.label ? s.label : `Cluster ${s?.cluster ?? index}`,
      color: clusterColor(s?.cluster),
      values: Array.isArray(s?.median_price) ? s.median_price : [],
    }))
    const rows = periods.map((period, i) => {
      const row = { period }
      for (const line of lines) {
        const value = line.values[i]
        // null / non-finite points become gaps in the line (connectNulls=false).
        row[line.key] = typeof value === 'number' && Number.isFinite(value) ? value : null
      }
      return row
    })
    return { rows, lines }
  }, [data])

  const note = typeof data?.note === 'string' && data.note ? data.note : null
  const empty =
    rows.length === 0 ||
    lines.length === 0 ||
    lines.every((line) => line.values.every((v) => typeof v !== 'number' || !Number.isFinite(v)))

  // The chart's aria-label and the visible tag name the loaded period range
  // (never a hardcoded window); both fall back when periods are missing.
  const rangeStart = rows[0]?.period
  const rangeEnd = rows[rows.length - 1]?.period
  const chartLabel =
    rangeStart && rangeEnd
      ? `Line chart of median sale price per micro-market, half-year periods ${rangeStart} to ${rangeEnd}`
      : 'Line chart of median sale price per micro-market by half-year'

  // Screen-reader twin of the plotted values.
  const a11yColumns = useMemo(
    () => [
      { key: 'period', label: 'Period' },
      ...lines.map((line) => ({ key: line.key, label: line.key, format: formatUsd })),
    ],
    [lines],
  )

  return (
    <div className="chart-card chart-card-wide">
      <div className="chart-card-head">
        <h3>Median sale price by half-year</h3>
        <span className="chart-tag">
          {rangeStart && rangeEnd
            ? `train window ${rangeStart}–${rangeEnd} · gaps = no sales`
            : 'train window 2006H1–2008H2 · gaps = no sales'}
        </span>
      </div>
      {loading && <PanelSkeleton height={320} />}
      {!loading && error && (
        <ErrorState title="Couldn't load market trends" error={error} onRetry={reload} />
      )}
      {!loading && !error && empty && (
        <EmptyState
          kicker="No trend data"
          title="No trend series available"
          detail="The API returned no usable median-price series."
        />
      )}
      {!loading && !error && !empty && (
        <>
          <div
            className="chart-wrap chart-wrap-tall"
            role="img"
            aria-label={chartLabel}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid {...cartesianGridProps} />
                <XAxis dataKey="period" {...xAxisProps} />
                <YAxis
                  {...yAxisProps}
                  tickFormatter={kTick}
                  domain={['auto', 'auto']}
                  width={56}
                />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, name) => [formatUsd(value), name]}
                />
                <Legend
                  {...legendProps}
                  formatter={(value) => (
                    <span className="capitalize">{value}</span>
                  )}
                />
                {lines.map((line) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={1.8}
                    dot={{ r: 2.5 }}
                    connectNulls={false}
                    {...getAnimationProps(reduced)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ChartA11yTable
            caption="Median sale price per micro-market by half-year, USD — em-dash marks a half-year with no sales"
            columns={a11yColumns}
            rows={rows}
          />
          {note && (
            <p className="note mt-10">
              {note}
            </p>
          )}
        </>
      )}
    </div>
  )
}
