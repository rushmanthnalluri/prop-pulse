/**
 * SortHeader (SPEC §7.6): the `<th>` button paired with `useSortable`.
 * Renders the column label as a button with `aria-sort` on the `<th>` and a
 * mono ↑/↓ indicator; numeric columns pass `numeric` to right-align.
 *
 *   const { sorted, sort, toggleSort } = useSortable(rows)
 *   <SortHeader label="Median price" sortKey="median_price" numeric
 *               sort={sort} onToggle={toggleSort} />
 */
export default function SortHeader({ label, sortKey, sort, onToggle, numeric = false, className }) {
  const active = sort?.key === sortKey ? sort.dir : null
  const ariaSort = active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'
  const thClass = [numeric ? 'num' : null, className].filter(Boolean).join(' ') || undefined

  return (
    <th scope="col" aria-sort={ariaSort} className={thClass}>
      <button
        type="button"
        className={`sort-header${active ? ' active' : ''}`}
        onClick={() => onToggle(sortKey)}
        title={`Sort by ${label}`}
      >
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active === 'asc' ? '↑' : active === 'desc' ? '↓' : ''}
        </span>
      </button>
    </th>
  )
}
