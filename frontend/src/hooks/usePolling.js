/**
 * Visibility-aware interval polling (SPEC §5.5-4; fixes AUDIT §2.5/§5.9 — the
 * Health page used to poll while the tab was hidden). The timer only runs
 * while the document is visible: it is cleared when the tab hides and, on
 * return, the callback fires once immediately before the interval restarts.
 *
 * The callback does NOT fire on mount — pages fetch initially via `useApi`
 * and use this for refresh only.
 */
import { useEffect, useRef } from 'react'

/**
 * @param {() => void} callback - invoked each tick; identity may change every
 *   render without resetting the timer
 * @param {number|null|undefined} intervalMs - tick interval; pass null/0 to
 *   disable polling
 */
export function usePolling(callback, intervalMs) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!intervalMs) return undefined
    let timer = null
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const start = () => {
      stop()
      timer = setInterval(() => callbackRef.current(), intervalMs)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        callbackRef.current() // catch up immediately on tab return
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])
}
