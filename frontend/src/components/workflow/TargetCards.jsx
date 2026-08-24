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
import { OBJECTIVES, OBJECTIVE_LABELS } from '../../api/workflow'
import SimulatedBadge from './SimulatedBadge'

/* Card titles per objective — pinned copy (e2e workflow.spec.js); the kicker
   is the shared OBJECTIVE_LABELS map from api/workflow.js. */
const OBJECTIVE_TITLES = {
  regression: 'Sale price prediction',
  classification: 'Sale speed prediction',
  clustering: 'Neighborhood segmentation',
}

function TargetCard({ kicker, title, target }) {
  const available = Boolean(target?.available)
  const simulated = target?.derived === 'simulated'
  return (
    <div className={`wff-target${available ? '' : ' wff-target--off'}`}>
      <div className="wff-target-top">
        <span className="wff-target-kicker">{kicker}</span>
        <span className={`badge ${available ? 'badge-accent' : 'badge-muted'}`}>
          {available ? 'Available' : 'Not available'}
        </span>
      </div>
      <h3 className="wff-target-title">{title}</h3>
      {available ? (
        <>
          <div className="wff-target-chips">
            {target.column && <span className="wff-chip mono">{target.column}</span>}
            {target.method && <span className="wff-chip mono">{target.method}</span>}
            {simulated && <SimulatedBadge />}
          </div>
          {simulated && typeof target.positive_rate === 'number' && (
            <p className="wff-target-meta mono">
              positive rate {formatPct(target.positive_rate)} of train-split rows — simulated
            </p>
          )}
          <p className="wff-target-note">{target.note}</p>
        </>
      ) : (
        <p className="wff-target-note dim">
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
    <div className="wff-targets">
      {OBJECTIVES.map((key) => (
        <TargetCard
          key={key}
          kicker={OBJECTIVE_LABELS[key]}
          title={OBJECTIVE_TITLES[key]}
          target={targets[key]}
        />
      ))}
    </div>
  )
}
