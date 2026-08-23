/**
 * SimulatedBadge (WORKFLOW §7 rule 1) — the ADR-3 honesty badge carried by
 * every classification number in the workbench (target card, training tab,
 * comparison table, evaluation curves, sandbox predict). Component-enforced
 * so the rule is structural, not remembered. Amber (--warn) per the design
 * system's semantic assignment: amber = honesty caveats.
 *
 *   <SimulatedBadge />                       → "Simulated target"
 *   <SimulatedBadge>Simulated target — ADR-3</SimulatedBadge>
 *
 * Disclosure: the one-liner rides a CSS-only tooltip (`.wf-sim-tip`) shown on
 * :hover AND :focus — the badge itself is focusable (tabIndex=0), so
 * keyboard users and tap-to-focus touch users reach it, not just hover — and
 * is wired to the badge with aria-describedby instead of `title`, so there is
 * no duplicate native tooltip. The same line should additionally appear as
 * real copy wherever a stage page has room (disclosures ≥ 11px, UX §2.2).
 */
import { useId } from 'react'

const DISCLOSURE =
  'Target derived from the seeded days-on-market simulation — simulated, not an observed market outcome.'

export default function SimulatedBadge({ className = '', children }) {
  const tipId = useId()
  return (
    <span
      className={`badge badge-warn wf-sim-badge${className ? ` ${className}` : ''}`}
      tabIndex={0}
      aria-describedby={tipId}
    >
      {children ?? 'Simulated target'}
      <span className="wf-sim-tip" id={tipId} role="tooltip">
        {DISCLOSURE}
      </span>
    </span>
  )
}
