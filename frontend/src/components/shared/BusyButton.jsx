/**
 * BusyButton (SPEC §7.2): a `.btn` with a built-in busy state — disabled +
 * 12px spinner + verb label ("Estimating…", "Retrying…"). Use it for every
 * user-triggered POST so the control itself carries the progress feedback;
 * never swap in a skeleton while data is already on screen.
 *
 * Two usage modes:
 *   Controlled  — pass `busy` when the request state already lives in the
 *                 parent (e.g. a submit pipeline):
 *                 <BusyButton busy={submitting} busyLabel="Estimating…">Estimate value</BusyButton>
 *   Self-managed — pass an async `onClick`; the button goes busy until the
 *                 returned promise settles (restored in `finally`):
 *                 <BusyButton onClick={async () => reload()} busyLabel="Retrying…">Retry</BusyButton>
 *
 * `busyLabel` is required copy — the verb phrase shown while busy.
 */
import { useState } from 'react'

export default function BusyButton({
  busy: controlledBusy,
  busyLabel = 'Working…',
  onClick,
  disabled = false,
  className = 'btn btn-primary',
  type = 'button',
  children,
  ...rest
}) {
  const [internalBusy, setInternalBusy] = useState(false)
  const selfManaged = controlledBusy === undefined
  const busy = selfManaged ? internalBusy : controlledBusy

  const handleClick = (event) => {
    if (busy || disabled) return
    const result = onClick?.(event)
    // Self-managed mode only tracks promise-returning handlers; sync handlers
    // need the controlled `busy` prop instead.
    if (selfManaged && result && typeof result.then === 'function') {
      setInternalBusy(true)
      result.finally(() => setInternalBusy(false))
    }
  }

  // The default spinner is ink-on-teal; quiet variants need the dark track.
  const spinnerClass = className.includes('btn-primary')
    ? 'spinner'
    : 'spinner spinner--dark'

  return (
    <button
      type={type}
      className={className}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      {busy && <span className={spinnerClass} aria-hidden="true" />}
      {busy ? busyLabel : children}
    </button>
  )
}
