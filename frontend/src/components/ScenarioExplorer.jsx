/**
 * WHAT-IF SCENARIOS (SPEC §5.2.2-7 / §6.1): re-scores the same champion
 * model via the cheap POST /predict/price endpoint (~27 ms) with one lever
 * changed at a time, and shows the per-lever signed delta vs the base
 * estimate. Sliders carry numeric entry beside them; lever ranges mirror the
 * form schema, and the remodel-year lever is capped at 2008 (the training
 * window — the form's year_remod_add hint says the same, resolving the old
 * 2008/2026 conflict, AUDIT §2.2). Changes are debounced (300 ms) and
 * in-flight requests are aborted when superseded, on reset, or on unmount —
 * the keyed-timer + per-lever abort mechanics are unchanged (AUDIT §6.12).
 * A failed lever gets a real Retry button. The parent keys this component by
 * the submitted payload, so a new valuation remounts it and drops all lever
 * state.
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { formatNumber, formatUsd, formatYear } from '../format'

const DEBOUNCE_MS = 300

// Scoring boundary: the train window ends 2008-12 (ml/features/serving.py).
const REMODEL_YEAR_MAX = 2008

const LEVERS = [
  { name: 'gr_liv_area', label: 'Living area', unit: 'sq ft' },
  { name: 'overall_qual', label: 'Overall quality' },
  { name: 'overall_cond', label: 'Overall condition' },
  { name: 'year_built', label: 'Year built' },
  { name: 'year_remod_add', label: 'Remodel year' },
  { name: 'garage_cars', label: 'Garage', unit: 'cars' },
  { name: 'full_bath', label: 'Full baths' },
]

/** Slider bounds per lever — the same ranges the form validates against. */
function leverBounds(name, basePayload) {
  switch (name) {
    case 'gr_liv_area':
      return { min: 300, max: 6000, step: 10 }
    case 'overall_qual':
    case 'overall_cond':
      return { min: 1, max: 10, step: 1 }
    case 'year_built':
      return { min: 1870, max: 2026, step: 1 }
    case 'year_remod_add': {
      const built = Number(basePayload?.year_built)
      return {
        min: Number.isFinite(built) ? Math.max(1870, built) : 1870,
        max: REMODEL_YEAR_MAX,
        step: 1,
      }
    }
    case 'garage_cars':
      return { min: 0, max: 5, step: 1 }
    case 'full_bath':
      return { min: 0, max: 4, step: 1 }
    default:
      return { min: 0, max: 100, step: 1 }
  }
}

/** Starting value for a lever: the submitted payload (remodel year falls back
 *  to year built, matching the API default), clamped into the slider bounds. */
function leverBaseValue(name, basePayload) {
  const bounds = leverBounds(name, basePayload)
  let raw = Number(basePayload?.[name])
  if (!Number.isFinite(raw) && name === 'year_remod_add') {
    raw = Number(basePayload?.year_built)
  }
  if (!Number.isFinite(raw)) raw = bounds.min
  return Math.min(bounds.max, Math.max(bounds.min, raw))
}

/** Unit-free value for delta rows ("Overall quality 6→7"); years never group. */
function formatPlainValue(lever, value) {
  return lever.name === 'year_built' || lever.name === 'year_remod_add'
    ? formatYear(value)
    : formatNumber(value, 0)
}

function clamp(value, bounds) {
  return Math.min(bounds.max, Math.max(bounds.min, value))
}

export default function ScenarioExplorer({ basePayload, basePrice }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(LEVERS.map((lever) => [lever.name, leverBaseValue(lever.name, basePayload)])),
  )
  const [touched, setTouched] = useState({})
  const [deltas, setDeltas] = useState({})
  const timersRef = useRef({})
  const abortsRef = useRef({})

  // Cancel pending debounces and in-flight re-scores on unmount.
  useEffect(() => {
    const timers = timersRef.current
    const aborts = abortsRef.current
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer))
      Object.values(aborts).forEach((controller) => controller?.abort())
    }
  }, [])

  if (!basePayload || !Number.isFinite(basePrice)) return null

  // A lever is dropped when its range is empty (e.g. year built after 2008
  // leaves no valid remodel year at or below the training window).
  const levers = LEVERS.filter((lever) => {
    const bounds = leverBounds(lever.name, basePayload)
    return bounds.min <= bounds.max
  })
  const baseValues = Object.fromEntries(
    levers.map((lever) => [lever.name, leverBaseValue(lever.name, basePayload)]),
  )
  const touchedNames = levers.map((lever) => lever.name).filter((name) => touched[name])

  const requestDelta = (name, value) => {
    abortsRef.current[name]?.abort()
    const controller = new AbortController()
    abortsRef.current[name] = controller
    setDeltas((prev) => ({ ...prev, [name]: { status: 'loading' } }))
    api
      .predictPrice({ ...basePayload, [name]: value }, controller.signal)
      .then((res) => {
        const price = Number(res?.estimated_price)
        // Surface the additive confidence block: reduced = scored outside
        // the training range; keep the first reason for the hover tooltip.
        const reducedReason =
          res?.confidence?.level === 'reduced'
            ? res.confidence.reasons?.[0] || 'Outside the training range'
            : null
        setDeltas((prev) => ({
          ...prev,
          [name]: Number.isFinite(price)
            ? { status: 'ok', delta: price - basePrice, reducedReason }
            : { status: 'error' },
        }))
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return // superseded, reset, or unmounted
        setDeltas((prev) => ({ ...prev, [name]: { status: 'error' } }))
      })
  }

  const handleChange = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true }))
    setDeltas((prev) => ({ ...prev, [name]: { status: 'loading' } }))
    clearTimeout(timersRef.current[name])
    abortsRef.current[name]?.abort()
    timersRef.current[name] = setTimeout(() => requestDelta(name, value), DEBOUNCE_MS)
  }

  const retry = (name) => {
    clearTimeout(timersRef.current[name])
    requestDelta(name, values[name])
  }

  const handleNumeric = (name, bounds) => (event) => {
    const raw = event.target.value
    if (raw === '') return // keep the last valid value; blur-less numeric entry
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    handleChange(name, clamp(value, bounds))
  }

  const reset = () => {
    Object.values(timersRef.current).forEach((timer) => clearTimeout(timer))
    Object.values(abortsRef.current).forEach((controller) => controller?.abort())
    setValues(baseValues)
    setTouched({})
    setDeltas({})
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">What-if scenarios</span>
      </div>
      <div className="panel-body">
        <p className="note" style={{ marginBottom: 14 }}>
          Re-scores the same model with one change at a time — deltas are versus the
          estimate above.
        </p>
        <div className="lever-stack">
          {levers.map((lever) => {
            const bounds = leverBounds(lever.name, basePayload)
            return (
              <div className="lever" key={lever.name}>
                <div className="lever-head">
                  <label className="field-label" htmlFor={`lever-${lever.name}`}>
                    {lever.label}
                    {lever.unit && <span className="field-unit"> ({lever.unit})</span>}
                  </label>
                </div>
                <div className="lever-controls">
                  <input
                    id={`lever-${lever.name}`}
                    type="range"
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    value={values[lever.name]}
                    onChange={(event) => handleChange(lever.name, Number(event.target.value))}
                  />
                  <input
                    type="number"
                    className="field-input lever-input"
                    aria-label={`${lever.label} — numeric entry`}
                    min={bounds.min}
                    max={bounds.max}
                    step={bounds.step}
                    value={values[lever.name]}
                    onChange={handleNumeric(lever.name, bounds)}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {touchedNames.length > 0 && (
          <>
            <dl className="kv" style={{ marginTop: 16 }}>
              {touchedNames.map((name) => {
                const lever = LEVERS.find((l) => l.name === name)
                const delta = deltas[name]
                const deltaClass =
                  delta?.status === 'ok' ? (delta.delta >= 0 ? 'pos' : 'neg') : undefined
                return (
                  <div key={name}>
                    <dt>
                      {lever.label} {formatPlainValue(lever, baseValues[name])} →{' '}
                      {formatPlainValue(lever, values[name])}
                      {delta?.status === 'ok' && delta.reducedReason && (
                        <>
                          {' '}
                          <span className="badge badge-warn" title={delta.reducedReason}>
                            Reduced confidence
                          </span>
                        </>
                      )}
                    </dt>
                    <dd className={deltaClass}>
                      {delta?.status === 'ok' &&
                        `${delta.delta >= 0 ? '+' : '−'}${formatUsd(Math.abs(delta.delta))}`}
                      {delta?.status === 'error' && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm lever-retry"
                          onClick={() => retry(name)}
                        >
                          Retry
                        </button>
                      )}
                      {(!delta || delta.status === 'loading') && '…'}
                    </dd>
                  </div>
                )
              })}
            </dl>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12 }}
              onClick={reset}
            >
              Reset scenarios
            </button>
          </>
        )}
      </div>
    </div>
  )
}
