/**
 * AsyncSection (SPEC §5.4 fix, AUDIT §2.4): ONE wrapper per fetch on this
 * page — /model/info drives a single group, /model/importance another — so a
 * failed endpoint renders exactly one error box, never a stack of duplicates.
 *
 * Lifecycle (SPEC §7.1): layout-matched skeleton on first load → inline
 * ErrorState with retry (re-runs that fetch only) → content. `children` is a
 * render prop so it only ever evaluates with a real payload; stale content is
 * kept (aria-busy) while a retry refetches.
 */
import { ErrorState, PanelSkeleton } from '../StateView'

export default function AsyncSection({
  state,
  skeleton = null,
  errorTitle = 'Could not load this data',
  children,
}) {
  const { data, loading, error, reload } = state

  if (loading && !data) return skeleton || <PanelSkeleton />
  if (!loading && error && !data) {
    return <ErrorState error={error} onRetry={reload} title={errorTitle} />
  }
  if (!data) return null
  return (
    <div aria-busy={loading || undefined} className={loading ? 'insights-stale' : undefined}>
      {children(data)}
    </div>
  )
}
