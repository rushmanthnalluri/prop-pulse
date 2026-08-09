/**
 * TrafficTable (SPEC §5.5-2): per-process request facts from GET /metrics —
 * total requests, HTTP 5xx errors, mean latency — and a sortable breakdown
 * of requests_by_path (route, count, share of total). Sorting follows the
 * app-wide pattern (SPEC §7.6): click cycles asc → desc → natural, where
 * natural is the API's own order. The `unmatched` row is the backend's
 * bucket for requests that matched no registered route (404 probes).
 */
import { useMemo } from 'react'
import { formatNumber, formatPct } from '../../format'
import { EmptyState, ErrorState, MetricsSkeleton, PanelSkeleton } from '../StateView'
import useSortable from '../shared/useSortable'
import SortHeader from '../shared/SortHeader'

export default function TrafficTable({ metrics }) {
  const { data, loading, error, reload } = metrics

  const rows = useMemo(() => {
    const byPath = data?.requests_by_path
    if (!byPath || typeof byPath !== 'object') return []
    const total = Number(data?.requests_total)
    return Object.entries(byPath).map(([path, count]) => {
      const n = Number(count)
      return {
        path: String(path),
        count: Number.isFinite(n) ? n : null,
        share: Number.isFinite(n) && Number.isFinite(total) && total > 0 ? n / total : null,
      }
    })
  }, [data])
  const { sorted, sort, toggleSort } = useSortable(rows)

  if (loading && !data) {
    return (
      <>
        <MetricsSkeleton count={3} />
        <div className="health-traffic-table">
          <PanelSkeleton height={150} />
        </div>
      </>
    )
  }
  if (error && !data) {
    return (
      <ErrorState
        error={error}
        onRetry={reload}
        title={error.isNetworkError ? 'Backend unreachable' : 'Could not load traffic counters'}
      />
    )
  }

  const errors = Number(data?.errors_total)

  return (
    <>
      <div className="metrics metrics--3">
        <div className="metric">
          <div className="metric-label">Requests</div>
          <div className="metric-value">{formatNumber(data?.requests_total, 0)}</div>
          <div className="metric-hint">since process start</div>
        </div>
        <div className="metric">
          <div className="metric-label">Errors (5xx)</div>
          <div
            className={`metric-value${Number.isFinite(errors) && errors > 0 ? ' metric-value--bad' : ''}`}
          >
            {formatNumber(data?.errors_total, 0)}
          </div>
          <div className="metric-hint">counts HTTP 5xx only</div>
        </div>
        <div className="metric">
          <div className="metric-label">Avg latency</div>
          <div className="metric-value">
            {formatNumber(data?.avg_latency_ms, 0)}
            <span className="health-unit"> ms</span>
          </div>
          <div className="metric-hint">mean since process start, not a percentile</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="health-traffic-table">
          <EmptyState
            kicker="No traffic"
            title="No requests recorded yet"
            detail="Route counters appear here once the backend has served requests in this process lifetime."
          />
        </div>
      ) : (
        <div className="table-scroll health-traffic-table">
          <table className="table">
            <caption className="visually-hidden">
              Requests served per route since process start, with each route's share of the total.
            </caption>
            <thead>
              <tr>
                <SortHeader label="Route" sortKey="path" sort={sort} onToggle={toggleSort} />
                <SortHeader label="Requests" sortKey="count" numeric sort={sort} onToggle={toggleSort} />
                <SortHeader label="Share" sortKey="share" numeric sort={sort} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.path}>
                  <td className="mono">{row.path}</td>
                  <td className="num">{formatNumber(row.count, 0)}</td>
                  <td className="num dim">{formatPct(row.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="note health-section-note">
        Counters are per-process and in-memory — they reset on every backend restart. The{' '}
        <code>unmatched</code> row buckets requests that matched no registered route (e.g. 404
        probes). Click a column header to sort; a third click restores the API order.
      </p>
    </>
  )
}
