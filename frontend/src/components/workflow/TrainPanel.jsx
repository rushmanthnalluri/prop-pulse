/**
 * TrainPanel (WORKFLOW §6.3-07) — candidate selection + launch for one
 * objective. Checkbox list built from the real candidate set
 * (OBJECTIVE_CANDIDATES, §3.9) with an honest one-line "what it is" and the
 * measured cost hints per objective (§4.5: regression ~10–30 s each,
 * classification ~30–60 s each + calibration, DBSCAN < 1 s). The launch
 * button is a BusyButton; the stage page owns the POST and the 409/400
 * handling.
 */
import BusyButton from '../shared/BusyButton'
import { OBJECTIVE_CANDIDATES } from '../../api/workflow'

const CANDIDATE_INFO = {
  linear: 'Ordinary least squares on log1p(SalePrice) — the baseline.',
  ridge: 'L2-regularized linear model; alpha tuned by cross-validation on the train split.',
  lasso: 'L1-regularized linear model; sparse — weak features drop to zero.',
  random_forest: 'Bagged decision trees with a randomized hyperparameter search.',
  xgboost: 'Gradient-boosted trees with a randomized hyperparameter search.',
  logistic: 'Regularized logistic regression with calibrated probabilities.',
  decision_tree: 'A single pruned tree — the interpretable baseline.',
  dbscan: 'Density clustering over the 25-neighborhood matrix; eps from the k-distance knee.',
}

const COST_HINTS = {
  regression: '~10–30 s each',
  classification: '~30–60 s each + calibration',
  clustering: '< 1 s',
}

export default function TrainPanel({
  objective,
  selected,
  onToggle,
  onStart,
  starting = false,
  disabled = false,
  disabledReason = null,
}) {
  const candidates = OBJECTIVE_CANDIDATES[objective] ?? []
  const noneSelected = selected.length === 0

  return (
    <div className="wf-trainpanel">
      <ul className="wf-candidates">
        {candidates.map((name) => (
          <li key={name}>
            <label className="wf-check">
              <input
                type="checkbox"
                checked={selected.includes(name)}
                disabled={disabled || starting}
                onChange={() => onToggle(name)}
              />
              <span>
                <span className="wf-check-label mono">{name}</span>
                <span className="wf-check-hint">{CANDIDATE_INFO[name] ?? ''}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="wf-config-actions">
        <BusyButton
          busy={starting}
          busyLabel="Starting job…"
          disabled={disabled || noneSelected}
          title={
            disabled
              ? (disabledReason ?? 'Training is unavailable')
              : noneSelected
                ? 'Select at least one candidate'
                : undefined
          }
          onClick={onStart}
        >
          Start training
        </BusyButton>
        <span className="field-hint">
          {COST_HINTS[objective]} · one job at a time, server-wide · progress below is real,
          polled from the job status file.
        </span>
      </div>
    </div>
  )
}
