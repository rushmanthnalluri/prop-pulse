/**
 * One valuation form field (SPEC §5.2.1): label + control + hint, error, and
 * train-range warn hint, with aria wiring. Message priority is error >
 * warn (warn-not-block tier) > hint; the control border returns to neutral
 * when an error clears — no checkmark theatre. Controls: select, checkbox,
 * date, number.
 *
 * Treatment notes: explicit `required: false` fields (the three optional core
 * inputs) carry a quiet mono "Optional" tag so everything else reads as
 * required without asterisk noise; error/warn messages lead with a small
 * aria-hidden glyph so the state never rides on border/text colour alone.
 */
/** Error glyph — circle + exclamation, inherits the danger message colour. */
function ErrorIcon() {
  return (
    <svg
      className="field-msg-icon"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.6" />
      <path d="M7 4.4v3.3" />
      <path d="M7 9.8h.01" />
    </svg>
  )
}

/** Warn glyph — triangle + exclamation, inherits the amber message colour. */
function WarnIcon() {
  return (
    <svg
      className="field-msg-icon"
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 2.2 12.6 11.4H1.4L7 2.2z" />
      <path d="M7 6v2.4" />
      <path d="M7 10h.01" />
    </svg>
  )
}

export default function FormField({ desc, value, error, warn, onChange, onBlur, inputRef }) {
  const id = `pf-${desc.name}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const warnId = `${id}-warn`
  const describedBy = error ? errorId : warn ? warnId : desc.hint ? hintId : undefined
  // Only the explicitly-optional core fields (`required: false`) get the tag —
  // advanced overrides already say "Model default" as their placeholder.
  const showOptional = desc.required === false

  if (desc.kind === 'checkbox') {
    return (
      <div className="field check-field">
        <input
          id={id}
          name={desc.name}
          type="checkbox"
          className="check-input"
          checked={Boolean(value)}
          onChange={(event) => onChange(desc.name, event.target.checked)}
          onBlur={() => onBlur(desc.name)}
          ref={inputRef}
        />
        <label className="field-label" htmlFor={id}>
          {desc.label}
        </label>
      </div>
    )
  }

  const isSelect = desc.kind === 'select'
  const controlClass = `${isSelect ? 'select' : 'field-input'}${error ? ' input-error' : ''}`
  const sharedProps = {
    id,
    name: desc.name,
    className: controlClass,
    'aria-invalid': Boolean(error),
    'aria-required': desc.required || undefined,
    'aria-describedby': describedBy,
    onBlur: () => onBlur(desc.name),
    ref: inputRef,
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {desc.label}
        {desc.unit && <span className="field-unit"> ({desc.unit})</span>}
        {showOptional && <span className="field-tag">Optional</span>}
      </label>
      {isSelect ? (
        <select
          {...sharedProps}
          value={value ?? ''}
          onChange={(event) => onChange(desc.name, event.target.value)}
        >
          {desc.optional && <option value="">{desc.placeholder || 'Model default'}</option>}
          {desc.options.map((option) => (
            <option key={option} value={option}>
              {desc.labels?.[option] ?? option}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...sharedProps}
          type={desc.kind === 'date' ? 'date' : 'number'}
          value={value ?? ''}
          min={desc.min}
          max={desc.max}
          step={desc.kind === 'date' ? undefined : desc.integer ? 1 : 'any'}
          inputMode={desc.kind === 'date' ? undefined : 'decimal'}
          placeholder={desc.optional && desc.kind !== 'date' ? desc.placeholder || 'Model default' : undefined}
          onChange={(event) => onChange(desc.name, event.target.value)}
        />
      )}
      {error && (
        <span className="field-error" id={errorId}>
          <ErrorIcon />
          <span>{error}</span>
        </span>
      )}
      {!error && warn && (
        <span className="field-warn" id={warnId}>
          <WarnIcon />
          <span>{warn}</span>
        </span>
      )}
      {!error && !warn && desc.hint && (
        <span className="field-hint" id={hintId}>
          {desc.hint}
        </span>
      )}
    </div>
  )
}
