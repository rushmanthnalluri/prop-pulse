/**
 * The property form (SPEC §5.2.1), shared by two submit flows: six core
 * fieldsets + an advanced-overrides <details> grouped under mono
 * subheadings, driven by valuation/formConfig.js (declarative, mirrors
 * backend/app/schemas/property.py).
 *
 * Lives in components/shared/ since WF-F4 (WORKFLOW §6.3-09/§8): the champion
 * Valuation page and the workbench stage-09 sandbox panel render the same
 * form — it already produces a valid `PropertyInput` via the pure
 * `buildPayload`, so each flow only supplies its own `onSubmit`. The schema
 * (formConfig) and the field renderer (FormField) stay in
 * components/valuation/ with their other consumers.
 *
 * Validation: client type/integer/range + the remodel ≥ year-built
 * cross-field rule on blur and on submit, with revalidate-on-change once a
 * field has an error. The warn-not-block tier (formConfig.trainWarns)
 * pre-announces reduced confidence for inputs outside the train-observed
 * ranges. Server 422s map to fields via the structured `fieldErrorMap`
 * (ApiError.details) — the flattened-message parse remains only as the
 * fallback for service-layer 422s whose detail is a plain string. The error
 * summary auto-focuses the first invalid field and force-opens the advanced
 * <details> when the error lives inside it.
 *
 * External value injection: `prefill` merges validated URL-param values
 * (the ?neighborhood= handshake generalized to the full payload, SPEC §7.7);
 * `seed` replaces the whole form (Load example / Restore last / Reset).
 * `submitLabel`/`busyLabel` let the host flow name the action (champion
 * "Estimate value" vs sandbox "Predict with sandbox model").
 */
import { useEffect, useRef, useState } from 'react'
import { ApiError, fieldErrorMap } from '../../api/client'
import BusyButton from './BusyButton'
import FormField from '../valuation/FormField'
import {
  ADVANCED_GROUPS,
  ADVANCED_NAMES,
  CORE_GROUPS,
  FIELD_INDEX,
  FIELD_ORDER,
  FORM_DEFAULTS,
  LABELS,
  VALIDATED_FIELDS,
  buildPayload,
  trainWarns,
  validateField,
} from '../valuation/formConfig'

export default function PropertyForm({
  onSubmit,
  onReset,
  onLoadExample,
  submitting,
  serverError,
  seed,
  prefill,
  submitLabel = 'Estimate value',
  busyLabel = 'Estimating…',
}) {
  const [values, setValues] = useState(FORM_DEFAULTS)
  const [errors, setErrors] = useState({})
  const [showSummary, setShowSummary] = useState(false)
  const inputRefs = useRef({})
  const detailsRef = useRef(null)

  // Seed fills (example property / restore last / reset): replace everything.
  useEffect(() => {
    if (!seed?.values) return
    setValues(seed.values)
    setErrors({})
    setShowSummary(false)
  }, [seed])

  // URL prefill: validated in formConfig.parseUrlValues; merge-only, and it
  // re-applies whenever the search params change (not just on mount).
  useEffect(() => {
    if (!prefill) return
    setValues((prev) => ({ ...prev, ...prefill }))
    setErrors((prev) => {
      const next = { ...prev }
      for (const name of Object.keys(prefill)) delete next[name]
      return next
    })
  }, [prefill])

  // Server 422 → per-field errors. Structured details first; the regex over
  // the flattened message is the fallback for string-detail 422s only.
  useEffect(() => {
    if (!(serverError instanceof ApiError) || serverError.status !== 422) return
    let mapped = fieldErrorMap(serverError)
    if (Object.keys(mapped).length === 0) {
      const legacy = {}
      for (const segment of serverError.message.split('; ')) {
        const match = segment.match(/^([a-z_][a-z0-9_]*):\s+(.+)$/i)
        if (match && FIELD_INDEX[match[1]]) legacy[match[1]] = match[2]
      }
      mapped = legacy
    }
    const known = {}
    for (const [name, message] of Object.entries(mapped)) {
      if (FIELD_INDEX[name]) known[name] = message // API copy verbatim (SPEC §7.4)
    }
    if (Object.keys(known).length === 0) return
    setErrors((prev) => ({ ...prev, ...known }))
    setShowSummary(true)
    const first = FIELD_ORDER.find((name) => known[name])
    if (first && ADVANCED_NAMES.has(first) && detailsRef.current) {
      detailsRef.current.open = true
    }
    if (first) inputRefs.current[first]?.focus()
  }, [serverError])

  const setValue = (name, value) => {
    const nextValues = { ...values, [name]: value }
    setValues(nextValues)
    // Revalidate-on-change, but only for fields already showing an error
    // (year_built also drives the remodel-year cross-field rule).
    setErrors((prev) => {
      const targets = name === 'year_built' ? [name, 'year_remod_add'] : [name]
      if (!targets.some((target) => prev[target])) return prev
      const next = { ...prev }
      for (const target of targets) {
        if (!prev[target]) continue
        const desc = FIELD_INDEX[target]
        const message = desc ? validateField(desc, nextValues[target], nextValues) : null
        if (message) next[target] = message
        else delete next[target]
      }
      return next
    })
  }

  const handleBlur = (name) => {
    const desc = FIELD_INDEX[name]
    if (!desc || desc.kind === 'select' || desc.kind === 'checkbox') return
    const message = validateField(desc, values[name], values)
    setErrors((prev) => {
      const next = { ...prev }
      if (message) next[name] = message
      else delete next[name]
      return next
    })
  }

  const registerRef = (name) => (element) => {
    inputRefs.current[name] = element
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const nextErrors = {}
    for (const desc of VALIDATED_FIELDS) {
      const message = validateField(desc, values[desc.name], values)
      if (message) nextErrors[desc.name] = message
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setShowSummary(true)
      const first = FIELD_ORDER.find((name) => nextErrors[name])
      if (first && ADVANCED_NAMES.has(first) && detailsRef.current) {
        detailsRef.current.open = true
      }
      if (first) inputRefs.current[first]?.focus()
      return
    }
    setShowSummary(false)
    onSubmit(buildPayload(values))
  }

  const warns = trainWarns(values)
  const summaryIssues = FIELD_ORDER.filter((name) => errors[name]).map(
    (name) => `${LABELS[name]}: ${errors[name]}`,
  )

  return (
    <form className="valuation-form" onSubmit={handleSubmit} noValidate>
      {CORE_GROUPS.map((group) => (
        <fieldset className="fieldset" key={group.legend}>
          <legend>{group.legend}</legend>
          <div className="field-row">
            {group.fields.map((desc) => (
              <FormField
                key={desc.name}
                desc={desc}
                value={values[desc.name]}
                error={errors[desc.name]}
                warn={warns[desc.name]}
                onChange={setValue}
                onBlur={handleBlur}
                inputRef={registerRef(desc.name)}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <details className="fieldset" ref={detailsRef}>
        <summary>Advanced overrides</summary>
        <p className="note adv-intro">
          Optional — blank fields use the model&apos;s training-data defaults.
        </p>
        {ADVANCED_GROUPS.map((group) => (
          <div className="adv-group" key={group.title}>
            <span className="adv-group-title">{group.title}</span>
            <div className="field-row">
              {group.fields.map((desc) => (
                <FormField
                  key={desc.name}
                  desc={{ ...desc, optional: true }}
                  value={values[desc.name] ?? ''}
                  error={errors[desc.name]}
                  warn={warns[desc.name]}
                  onChange={setValue}
                  onBlur={handleBlur}
                  inputRef={registerRef(desc.name)}
                />
              ))}
            </div>
          </div>
        ))}
      </details>

      {showSummary && summaryIssues.length > 0 && (
        <div className="alert alert-error" role="alert">
          <span className="alert-title">Fix the highlighted fields</span>
          {summaryIssues.slice(0, 6).map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
          {summaryIssues.length > 6 && <div>…and {summaryIssues.length - 6} more</div>}
        </div>
      )}

      <div className="submit-stack">
        <BusyButton
          type="submit"
          busy={submitting}
          busyLabel={busyLabel}
          className="btn btn-primary valuation-submit"
        >
          {submitLabel}
        </BusyButton>
        <span className="visually-hidden" role="status">
          {submitting ? busyLabel : ''}
        </span>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadExample}
            disabled={submitting}
          >
            Load example property
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onReset}
            disabled={submitting}
          >
            Reset
          </button>
        </div>
      </div>
    </form>
  )
}
