/**
 * PreprocessConfig (WORKFLOW §6.3-06) — the stage-06 configuration card with
 * progressive disclosure: the outlier-rule toggle and split-strategy select
 * are always visible; validation/test fractions and the seed live under a
 * collapsed "Advanced" <details>. Fully controlled — the stage page owns the
 * config state, validation, and the run action.
 *
 * The outlier rule is stated in words next to the toggle (the documented
 * Ames partial-sale rule, ml/data/outliers.py:17); fraction inputs mirror the
 * server-side PrepareConfig constraints (each in (0, 1), sum < 0.9).
 */

/** Server-mirroring guard (PrepareConfig): the fractions must leave a train split. */
// eslint-disable-next-line react-refresh/only-export-components -- config validator shared with the stage page (Toast.jsx pattern)
export function fractionsValid(config) {
  const val = Number(config.val_frac)
  const test = Number(config.test_frac)
  return (
    Number.isFinite(val) &&
    Number.isFinite(test) &&
    val > 0 &&
    val < 1 &&
    test > 0 &&
    test < 1 &&
    val + test < 0.9
  )
}

const SPLIT_HINTS = {
  auto: 'Time-based when the data spans two or more sale years, else a seeded shuffle.',
  time: 'Contiguous blocks by (YrSold, MoSold) — train on the past, validate on the future.',
  random: 'Seeded shuffle — repeatable, but ignores the sale timeline.',
}

export default function PreprocessConfig({ value, onChange, disabled = false }) {
  const set = (key, next) => onChange({ ...value, [key]: next })
  const valid = fractionsValid(value)

  return (
    <div className="wf-config">
      <label className="wf-check">
        <input
          type="checkbox"
          checked={Boolean(value.outlier_rule)}
          disabled={disabled}
          onChange={(event) => set('outlier_rule', event.target.checked)}
        />
        <span>
          <span className="wf-check-label">Outlier rule</span>
          <span className="wf-check-hint">
            Removes partial sales over 4,000 sq ft above grade that sold under $300k — a
            handful of known non-arm&rsquo;s-length Ames sales. Applied to the training
            split only.
          </span>
        </span>
      </label>

      <div className="field">
        <label className="field-label" htmlFor="wf-split-strategy">
          Split strategy
        </label>
        <select
          id="wf-split-strategy"
          className="select"
          value={value.split_strategy}
          disabled={disabled}
          onChange={(event) => set('split_strategy', event.target.value)}
        >
          <option value="auto">Auto (recommended)</option>
          <option value="time">Time-based</option>
          <option value="random">Random (seeded)</option>
        </select>
        <span className="field-hint">{SPLIT_HINTS[value.split_strategy] ?? ''}</span>
      </div>

      <details className="fieldset wf-advanced">
        <summary>Advanced — fractions &amp; seed</summary>
        <div className="field-row field-row--3">
          <div className="field">
            <label className="field-label" htmlFor="wf-val-frac">
              Validation fraction
            </label>
            <input
              id="wf-val-frac"
              className="field-input"
              type="number"
              min="0.05"
              max="0.9"
              step="0.05"
              value={value.val_frac}
              disabled={disabled}
              onChange={(event) => set('val_frac', Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="wf-test-frac">
              Test fraction
            </label>
            <input
              id="wf-test-frac"
              className="field-input"
              type="number"
              min="0.05"
              max="0.9"
              step="0.05"
              value={value.test_frac}
              disabled={disabled}
              onChange={(event) => set('test_frac', Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="wf-seed">
              Seed
            </label>
            <input
              id="wf-seed"
              className="field-input"
              type="number"
              min="0"
              step="1"
              value={value.seed}
              disabled={disabled}
              onChange={(event) => set('seed', Math.max(0, Math.trunc(Number(event.target.value) || 0)))}
            />
          </div>
        </div>
        {!valid && (
          <p className="field-error" role="alert">
            Validation + test fractions must each be in (0, 1) and sum to less than 0.9 —
            the training split needs at least 10% of the rows.
          </p>
        )}
        <p className="field-hint">
          Fractions apply to uploads; the bundled Ames dataset always uses its canonical
          processed splits in place.
        </p>
      </details>
    </div>
  )
}
