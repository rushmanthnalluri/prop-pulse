/**
 * TrendsChart — the shared median-price-by-half-year line chart behind the
 * overview grid's TrendsCard and the Market Intelligence page's TrendsPanel:
 * one line per micro-market from GET /market/trends, with the skeleton →
 * error+retry → empty → chart lifecycle every chart card keeps, so a failed
 * trends call never blanks a sibling section.
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
 *
 * The two call sites differ only in fetcher binding (signal-free cached vs
 * signal-bound), copy, and chart chrome — passed in as props; everything
 * structural lives here.
 */
import { useMemo } from 'react'
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
import { useApi } from '../../api/useApi'
import { clusterColor, clusterLabel } from '../../constants'
import { formatUsd } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ChartA11yTable from './ChartA11yTable'
import useReducedMotion from './useReducedMotion'
import {
  cartesianGridProps,
  getAnimationProps,
  kTick,
  legendProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from './chartTheme'

export default function TrendsChart({
  fetcher,
  title,
  renderTag,
  ariaLabel,
  errorTitle,
  skeletonHeight,
  tall = false,
  margin,
  strokeWidth,
  dot,
  activeDot,
  noteClassName,
}) {
  const { data, loading, error, reload } = useApi(fetcher)
  const reduced = useReducedMotion()

  // Shape guards: a contract-drifting payload degrades to the empty state
  // instead of throwing mid-render.
  const { rows, lines, firstPeriod, lastPeriod } = useMemo(() => {
    const periods = Array.isArray(data?.periods) ? data.periods : []
    const rawSeries = Array.isArray(data?.series) ? data.series : []
    const lines = rawSeries.map((s, index) => ({
      // The trends payload names the cluster id `cluster` — adapted onto
      // clusterLabel's `cluster_id` shape.
      key: clusterLabel({ label: s?.label, cluster_id: s?.cluster ?? index }),
      color: clusterColor(s?.cluster),
      values: Array.isArray(s?.median_price) ? s.median_price : [],
    }))
    const rows = periods.map((period, i) => {
      const row = { period }
      for (const line of lines) {
        const value = line.values[i]
        // null / non-finite points are real gaps — never interpolated.
        // (Strict typeof check: Number(null) is 0, so a plain Number.isFinite
        // guard would chart a $0 dip instead of a gap.)
        row[line.key] = typeof value === 'number' && Number.isFinite(value) ? value : null
      }
      return row
    })
    return {
      rows,
      lines,
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods[periods.length - 1] ?? null,
    }
  }, [data])

  const note = typeof data?.note === 'string' && data.note ? data.note : null
  const empty =
    rows.length === 0 ||
    lines.length === 0 ||
    lines.every((line) => line.values.every((v) => typeof v !== 'number' || !Number.isFinite(v)))

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
        <h3>{title}</h3>
        {renderTag({ firstPeriod, lastPeriod })}
      </div>
      {loading && <PanelSkeleton height={skeletonHeight} />}
      {!loading && error && <ErrorState title={errorTitle} error={error} onRetry={reload} />}
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
            className={tall ? 'chart-wrap chart-wrap-tall' : 'chart-wrap'}
            role="img"
            aria-label={ariaLabel({ firstPeriod, lastPeriod })}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={margin}>
                <CartesianGrid {...cartesianGridProps} />
                <XAxis dataKey="period" {...xAxisProps} />
                <YAxis {...yAxisProps} tickFormatter={kTick} width={56} domain={['auto', 'auto']} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value, name) => [formatUsd(value), name]}
                />
                <Legend
                  {...legendProps}
                  formatter={(value) => <span className="capitalize">{value}</span>}
                />
                {lines.map((line) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={strokeWidth}
                    dot={dot}
                    activeDot={activeDot}
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
          {note && <p className={noteClassName}>{note}</p>}
        </>
      )}
    </div>
  )
}
