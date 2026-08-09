/**
 * Disclosures (SPEC §5.4-7/8, §1.4): the page's standing caveats and the
 * explicit "not shown" list — the product's trust signature, placed
 * prominently and styled, never footnote-grey. Two parts:
 *
 *  1. Honesty notes — the simulated-target caveat (CONTRACT §5.3: required
 *     wherever classification numbers appear) and the nominal-interval
 *     caveat. Static copy; both facts are contract-standing.
 *  2. What this page doesn't show — ROC/PR/calibration curves (NOT
 *     AVAILABLE: no curve-point artifact exists), the full candidate
 *     leaderboard (only champions are served), live prediction stats (no
 *     endpoint aggregates the log). SPEC §6 REJECTED: do not build, do not
 *     fake — say so instead.
 */
const NOT_SHOWN = [
  {
    tag: 'Not available',
    text: 'ROC, PR, and calibration curves — the backend stores scalar AUCs only; no curve-point artifact exists to plot.',
  },
  {
    tag: 'Not shown',
    text: 'Full candidate leaderboard — the API serves the two champions (and the champion-vs-runner-up bootstrap) only.',
  },
  {
    tag: 'Not available',
    text: 'Live prediction statistics — the prediction log exists, but no endpoint aggregates or exposes it.',
  },
]

export default function Disclosures() {
  return (
    <div className="insights-disclosures">
      <div className="alert alert-warn">
        <span className="alert-title">Simulated classification target</span>
        The sale-within-30-days target comes from a transparent, seeded
        days-on-market simulation (ADR-3). Every classification figure on this
        page — AUCs, F1, the confusion matrices — measures consistency with
        that simulation, not real-world sale speed.
      </div>

      <ul className="insights-not-shown">
        {NOT_SHOWN.map((item) => (
          <li key={item.text}>
            <span className="badge badge-muted insights-not-shown-tag">{item.tag}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
