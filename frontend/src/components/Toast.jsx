/**
 * Toast system (SPEC §7.3): transient feedback for success/recovery only —
 * valuation complete, retry recovered, link copied. Anything that blocks a
 * section stays an inline `.alert-error` with its own retry; toasts never
 * replace section errors.
 *
 *   // App.jsx: <ToastProvider> wraps the layout, inside the router.
 *   const toast = useToast()
 *   toast.push({ kind: 'success' | 'error' | 'info', title, body? }) // → id
 *   toast.success('Estimate updated')                 // sugar
 *   toast.error('Estimate failed — previous result kept')
 *
 * Rules: auto-dismiss 6s (info/success) / 10s (error); every toast is
 * dismissible; max 3 visible, FIFO evicts the oldest; stacked bottom-right
 * ≥900px, full-width top <900px; container `aria-live="polite"`; enter
 * animation `--dur-toast`, none under reduced motion (global rule).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const ToastContext = createContext(null)

const AUTO_DISMISS_MS = { success: 6_000, info: 6_000, error: 10_000 }
const MAX_VISIBLE = 3
const KINDS = new Set(['success', 'error', 'info'])

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  // Pending auto-dismiss timers must not outlive the provider.
  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const push = useCallback(
    ({ kind = 'info', title, body } = {}) => {
      if (!title) return null
      const safeKind = KINDS.has(kind) ? kind : 'info'
      const id = nextId.current++
      setToasts((list) => [...list, { id, kind: safeKind, title, body }].slice(-MAX_VISIBLE))
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS[safeKind]),
      )
      return id
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      push,
      dismiss,
      success: (title, body) => push({ kind: 'success', title, body }),
      error: (title, body) => push({ kind: 'error', title, body }),
      info: (title, body) => push({ kind: 'info', title, body }),
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            <div className="toast-body">
              <span className="toast-title">{toast.title}</span>
              {toast.body && <span className="toast-detail">{toast.body}</span>}
            </div>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Toast API; throws when used outside <ToastProvider> (a wiring bug). */
// eslint-disable-next-line react-refresh/only-export-components -- SPEC §7.3: Toast.jsx exports both the provider and the hook
export function useToast() {
  const ctx = useContext(ToastContext)
  if (ctx === null) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}
