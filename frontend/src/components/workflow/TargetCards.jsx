/**
 * TargetCards (WORKFLOW §6.3-02) — the three training objectives reported
 * from `GET …/features` → `targets`. "Target detection" is objective
 * reporting over the known Ames schema (§7: no arbitrary schema guessing);
 * each card states availability + the API note VERBATIM, and the objective
 * itself is chosen later at stage 07.
 *
 * Honesty (§7 rule 1): the classification target is derived from the seeded
 * days-on-market simulation — the card carries SimulatedBadge structurally,
 * and the positive rate is labelled as simulated.
 */
import { formatPct } from '../../format'
import SimulatedBadge from './SimulatedBadge'

const OBJECTIVES = [
  {
    key: 'regression',
    kicker: 'Regression',
    title: 'Sale price prediction',
  },
  {
    key: 'classification',
    kicker: 'Classification',
    title: 'Sale speed prediction',
  },
  {
    key: 'clustering',
    kicker: 'Clustering',
    title: 'Neighbourhood segmentation',
  },
]

function TargetCard({ kicker, title, target }) {
  const available = Boolean(target?.available)
  const simulated = target?.derived === 'simulated'
  return (
    <div className={`wfe-target${available ? '' : ' wfe-target--off'}`}>
      <div className="wfe-target-top">
        <span className="wfe-target-kicker">{kicker}</span>
        <span className={`badge ${available ? 'badge-accent' : 'badge-muted'}`}>
          {available ? 'Available' : 'Not available'}
        </span>
      </div>
      <h3 className="wfe-target-title">{title}</h3>
      {available ? (
        <>
          <div className="wfe-target-chips">
            {target.column && <span className="wfe-chip mono">{target.column}</span>}
            {target.method && <span className="wfe-chip mono">{target.method}</span>}
            {simulated && <SimulatedBadge />}
          </div>
          {simulated && typeof target.positive_rate === 'number' && (
            <p className="wfe-target-meta mono">
              positive rate {formatPct(target.positive_rate)} of train-split rows — simulated
            </p>
          )}
          <p className="wfe-target-note">{target.note}</p>
        </>
      ) : (
        <p className="wfe-target-note dim">
          This objective is unavailable on the active dataset — its column is missing from the
          schema.
        </p>
      )}
    </div>
  )
}

export default function TargetCards({ targets }) {
  if (!targets || typeof targets !== 'object') return null
  return (
    <div className="wfe-targets">
      {OBJECTIVES.map((objective) => (
        <TargetCard
          key={objective.key}
          kicker={objective.kicker}
          title={objective.title}
          target={targets[objective.key]}
        />
      ))}
    </div>
  )
}
