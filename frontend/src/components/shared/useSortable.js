/**
 * useSortable (SPEC §7.6): table-sort state + sorted rows for every data
 * table. Clicking a column cycles asc → desc → natural; natural order is the
 * API order (for comps that is distance rank — the caption says so), so the
 * unsorted array is always the source of truth and is never mutated.
 *
 *   const { sorted, sort, toggleSort } = useSortable(rows)
 *   // sort: { key, dir: 'asc' | 'desc' } | null
 *
 * Numeric columns sort numerically: when both compared values are finite
 * numbers (or numeric strings) a numeric compare is used, otherwise a
 * locale string compare. Null/undefined/non-finite values always sort last,
 * in both directions.
 */
import { useCallback, useMemo, useState } from 'react'

function compareValues(a, b) {
  const aEmpty = a == null || a === '' || Number.isNaN(a)
  const bEmpty = b == null || b === '' || Number.isNaN(b)
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  const aNum = Number(a)
  const bNum = Number(b)
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum
  return String(a).localeCompare(String(b))
}

export default function useSortable(rows) {
  const [sort, setSort] = useState(null)

  const toggleSort = useCallback((key) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }, [])

  const sorted = useMemo(() => {
    if (!sort || !Array.isArray(rows)) return rows
    const copy = [...rows]
    copy.sort((a, b) => compareValues(a?.[sort.key], b?.[sort.key]))
    // Empties stay last in both directions: reverse only the non-empty head.
    if (sort.dir === 'desc') {
      const nonEmpty = copy.filter(
        (row) => !(row?.[sort.key] == null || row?.[sort.key] === '' || Number.isNaN(row?.[sort.key])),
      )
      const empty = copy.slice(nonEmpty.length)
      return [...nonEmpty.reverse(), ...empty]
    }
    return copy
  }, [rows, sort])

  return { sorted, sort, toggleSort }
}
