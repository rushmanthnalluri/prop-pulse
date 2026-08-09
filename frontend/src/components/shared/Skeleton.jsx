/**
 * Skeleton primitives (SPEC §7.1): base blocks for layout-matched loading
 * states. Initial or full-section loads use these (or the composed
 * PageSkeleton / PanelSkeleton / MetricsSkeleton in `components/StateView.jsx`);
 * user-triggered re-fetches use BusyButton + dimmed content instead — never
 * swap loaded content for a skeleton.
 *
 * All primitives are aria-hidden decoration; the section's real status copy
 * (or the incoming content) carries the meaning.
 */

/** Free-form shimmer block. Size via `width`/`height` (px or CSS length). */
export default function Skeleton({ width, height, className = '', style }) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height, ...style }}
      aria-hidden="true"
    />
  )
}

/** One text-line shimmer (12px tall). */
export function SkeletonLine({ width = '100%', style }) {
  return <Skeleton className="sk-line" width={width} style={style} />
}

/** One panel/block shimmer (default 120px min-height, matches .sk-block). */
export function SkeletonBlock({ height = 120, style }) {
  return <Skeleton className="sk-block" height={height} style={style} />
}
