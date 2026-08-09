/**
 * One valuation form field (SPEC §5.2.1): label + control + hint, error, and
 * train-range warn hint, with aria wiring. Message priority is error >
 * warn (warn-not-block tier) > hint; the control border returns to neutral
 * when an error clears — no checkmark theatre. Controls: select, checkbox,
 * date, number.
 */
export default function FormField({ desc, value, error, warn, onChange, onBlur, inputRef }) {
  const id = `pf-${desc.name}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const warnId = `${id}-warn`
  const describedBy = error ? errorId : warn ? warnId : desc.hint ? hintId : undefined

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
    'aria-describedby': describedBy,
    onBlur: () => onBlur(desc.name),
    ref: inputRef,
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {desc.label}
        {desc.unit && <span className="field-unit"> ({desc.unit})</span>}
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
          placeholder={desc.optional && desc.kind !== 'date' ? desc.placeholder || 'Model default' : undefined}
          aria-required={desc.required || undefined}
          onChange={(event) => onChange(desc.name, event.target.value)}
        />
      )}
      {error && (
        <span className="field-error" id={errorId}>
          {error}
        </span>
      )}
      {!error && warn && (
        <span className="field-warn" id={warnId}>
          {warn}
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
