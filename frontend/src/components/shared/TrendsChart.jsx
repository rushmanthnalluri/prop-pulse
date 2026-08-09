/**
 * Market trends chart (GET /market/trends): one median-price line per
 * micro-market over the half-year periods 2006H1–2008H2. Self-contained fetch
 * (AbortController via useApi) with its own skeleton / error+retry / empty
 * states, so a failed trends call never breaks the surrounding page.
 *
 * Null / non-finite medians are real gaps in the data — they stay gaps
 * (connectNulls=false), never interpolated. Series colors come from
 * clusterColor() in constants.js, the single source of truth shared with the
 * map markers and cluster cards.
 *
 * Accessibility (SPEC §7.8/§2.4): the chart keeps role="img" + aria-label and
 * adds a visually-hidden ChartA11yTable of the exact plotted values; line
 * animation honors prefers-reduced-motion via useReducedMotion. Both changes
 * are internal — the props ({ wide }) are unchanged.
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
import ChartA11yTable from './ChartA11yTable'
import useReducedMotion from './useReducedMotion'

/** Compact "$180k" y-axis tick. */
const kTick = (value) => `$${Math.round(Number(value) / 1000)}k`

export default function TrendsChart({ wide = false }) {
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

  // Screen-reader twin of the plotted values (SPEC §7.8).
  const a11yColumns = useMemo(
    () => [
      { key: 'period', label: 'Period' },
      ...lines.map((line) => ({ key: line.key, label: line.key, format: formatUsd })),
    ],
    [lines],
  )

  return (
    <div className={`chart-card${wide ? ' chart-card-wide' : ''}`}>
      <div className="chart-head">
        <span className="chart-title">Price trends by micro-market</span>
        <span className="chart-tag">Median sale price · 2006H1–2008H2</span>
      </div>
      {loading && <PanelSkeleton height={320} />}
      {!loading && error && <ErrorState error={error} onRetry={reload} />}
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
            className="chart-wrap chart-wrap--tall"
            role="img"
            aria-label="Line chart of median sale price per micro-market, half-year periods 2006H1 to 2008H2"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dfe4e6" />
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#6e7c8b' }} />
                <YAxis
                  tickFormatter={kTick}
                  width={64}
                  tick={{ fontSize: 12, fill: '#6e7c8b' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value, name) => [formatUsd(value), name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #dfe4e6', fontSize: 13 }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 13 }}
                  formatter={(value) => (
                    <span style={{ textTransform: 'capitalize' }}>{value}</span>
                  )}
                />
                {lines.map((line) => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    connectNulls={false}
                    isAnimationActive={!reduced}
                    animationDuration={450}
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
            <p className="note" style={{ marginTop: 10 }}>
              {note}
            </p>
          )}
        </>
      )}
    </div>
  )
}
