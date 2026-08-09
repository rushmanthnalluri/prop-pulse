/**
 * JSON-safe localStorage-backed state (SPEC §5.2.2 — the "Restore last
 * valuation" persistence). All storage failures are non-fatal: a corrupt or
 * unreadable entry falls back to the initial value, and a quota/security error
 * on write leaves React state working for the session (persistence is
 * best-effort). The key is fixed per hook instance — remount to change it.
 */
import { useCallback, useState } from 'react'

function readStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback // corrupt JSON or storage denied — treat as absent
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    // QuotaExceededError / SecurityError: state still updates, nothing persists.
    console.warn(`useLocalStorage: could not persist "${key}" —`, error)
  }
}

/**
 * @param {string} key - e.g. LAST_VALUATION_KEY from `../constants`
 * @param {any} initialValue - used when nothing valid is stored
 * @returns {[any, (next: any | ((prev: any) => any)) => void, () => void]}
 *   `[value, setValue, removeValue]`; `setValue` mirrors the useState setter
 *   (accepts a value or an updater), `removeValue` clears the stored entry and
 *   resets state to `initialValue`.
 */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => readStored(key, initialValue))

  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        writeStored(key, resolved)
        return resolved
      })
    },
    [key],
  )

  const remove = useCallback(() => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // storage denied — nothing to remove
    }
    setValue(initialValue)
  }, [key, initialValue])

  return [value, set, remove]
}
