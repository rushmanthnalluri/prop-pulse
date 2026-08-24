/**
 * Shared async-state primitives (SPEC §7.1): layout-matched skeletons for
 * initial / full-section loads, ErrorState (always with retry when the
 * caller can retry), EmptyState (always with an action when the caller has
 * one — pass it as children). User-triggered re-fetches with data already on
 * screen use BusyButton + dimmed content instead — never a skeleton swap,
 * and full-page spinners after first paint are banned (the dead `Loading`
 * export was deleted, AUDIT §3.3). Base blocks live in
 * `components/shared/Skeleton.jsx`.
 */

/** Full-page skeleton used for lazy routes and page-level fetches. */
export function PageSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="page-head">
        <div className="skeleton sk-line" style={{ width: 140 }} />
        <div className="skeleton sk-line" style={{ width: 320, height: 22 }} />
        <div className="skeleton sk-line" style={{ width: 480 }} />
      </div>
      <div className="section">
        <div className="skeleton sk-block" />
      </div>
      <div className="section">
        <div className="skeleton sk-block" />
      </div>
    </div>
  )
}

/** Panel-shaped skeleton for cards/charts/tables inside a section. */
export function PanelSkeleton({ height = 160 }) {
  return <div className="skeleton sk-block" style={{ minHeight: height }} aria-hidden="true" />
}

/** Metric-row skeleton matching .metrics. */
export function MetricsSkeleton({ count = 4 }) {
  return (
    <div className="metrics" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="metric" key={i}>
          <div className="skeleton sk-line" style={{ width: 72 }} />
          <div className="skeleton sk-line" style={{ width: 96, height: 20 }} />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'Could not load this data' }) {
  return (
    <div className="alert alert-error" role="alert">
      <span className="alert-title">{title}</span>
      {error?.message || 'An unexpected error occurred.'}
      {onRetry && (
        <div className="alert-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

/* Default empty-state glyph: a shallow tray — "nothing here yet". 17px
   inline SVG, currentColor, 1.5 stroke (the .empty-state-icon ring styles
   live in styles.css). */
function EmptyIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 10.5l2-6h9l2 6" />
      <path d="M2.5 10.5V13a1.5 1.5 0 0 0 1.5 1.5h10A1.5 1.5 0 0 0 15.5 13v-2.5h-3.9a1.6 1.6 0 0 1-3.2 0H2.5z" />
    </svg>
  )
}

/**
 * Empty state: icon slot (override with `icon={<Svg/>}`, hide with
 * `icon={null}`), kicker → title → detail hierarchy, and a centred action
 * area for children.
 */
export function EmptyState({ kicker = 'No data', title, detail, icon, children }) {
  return (
    <div className="empty-state">
      {icon !== null && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon ?? <EmptyIcon />}
        </span>
      )}
      <span className="kicker">{kicker}</span>
      <div className="empty-state-title">{title}</div>
      {detail && <p className="empty-state-detail">{detail}</p>}
      {children && <div className="empty-state-actions">{children}</div>}
    </div>
  )
}
