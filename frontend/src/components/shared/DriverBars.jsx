/**
 * "What drives value" (SPEC §7.1): the top-N features from GET
 * /model/importance as `.driver-row`s — prettyFeature name, bar scaled to the
 * top entry, mono mean-|SHAP| value at 4dp. Non-finite values are dropped;
 * an empty/unusable payload renders an EmptyState.
 *
 * Props (backward-compatible; existing callers pass only `importance`/`top`):
 *   importance — { <model feature>: mean |SHAP| } payload map
 *   top        — how many rows to show (default 5)
 *   numbered   — NEW, optional (default false): prefix each row with its mono
 *                rank ("01"…), used by Model Insights' top-20 ledger list.
 *                Adds the `driver-row--numbered` modifier class for grid room.
 */
import { prettyFeature } from '../../format'
import { EmptyState } from '../StateView'

export default function DriverBars({ importance, top = 5, numbered = false }) {
  const entries = Object.entries(importance ?? {})
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, top)

  if (entries.length === 0) {
    return (
      <EmptyState
        kicker="No importance data"
        title="Feature importance unavailable"
        detail="The API returned no usable importance values."
      />
    )
  }

  const max = Number(entries[0][1])
  return (
    <div>
      {entries.map(([name, value], index) => {
        const pct = max > 0 ? Math.min(100, Math.max(0, (Number(value) / max) * 100)) : 0
        return (
          <div className={numbered ? 'driver-row driver-row--numbered' : 'driver-row'} key={name}>
            {numbered && (
              <span className="driver-rank" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
            )}
            <span className="driver-name" title={name}>
              {prettyFeature(name)}
            </span>
            <div className="driver-track">
              <div className="driver-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="driver-value">{Number(value).toFixed(4)}</span>
          </div>
        )
      })}
    </div>
  )
}
