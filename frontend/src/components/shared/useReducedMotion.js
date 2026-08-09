/**
 * useReducedMotion (SPEC §2.4): live `prefers-reduced-motion` flag for JS
 * that CSS can't reach — recharts (`isAnimationActive={false}`,
 * `animationDuration`) and smooth scroll-into-view calls
 * (`behavior: reduced ? 'instant' : 'smooth'`).
 *
 *   const reduced = useReducedMotion()
 */
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export default function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = (event) => setReduced(event.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
