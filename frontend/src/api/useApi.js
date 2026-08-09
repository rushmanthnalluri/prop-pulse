/**
 * Shared data-fetching hook with loading / error / reload semantics.
 *
 * @param {(signal: AbortSignal) => Promise<any>} fetcher - memoized API call
 *   (wrap in useCallback); receives an AbortSignal that is aborted when the
 *   component unmounts or a reload supersedes the run (AUD-10).
 * @returns {{data: any, loading: boolean, error: Error|null, reload: () => void}}
 */
import { useCallback, useEffect, useState } from 'react'

export function useApi(fetcher) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))
    fetcher(controller.signal)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        // Aborts (unmount / superseded reload) are cancellations, not failures.
        if (!cancelled && error?.name !== 'AbortError') {
          setState({ data: null, loading: false, error })
        }
      })
    return () => {
      cancelled = true
      controller.abort() // AUD-10: cancel the in-flight request, not just the setState
    }
  }, [fetcher, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  return { ...state, reload }
}
