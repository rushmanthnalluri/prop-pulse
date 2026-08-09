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
 * The full one-liner lives in the `title` and should additionally appear as
 * real copy wherever a stage page has room (disclosures ≥ 11px, UX §2.2).
 */
export default function SimulatedBadge({ className = '', children }) {
  return (
    <span
      className={`badge badge-warn wf-sim-badge${className ? ` ${className}` : ''}`}
      title="Target derived from the seeded days-on-market simulation (ADR-3) — simulated, not an observed market outcome."
    >
      {children ?? 'Simulated target'}
    </span>
  )
}
