/**
 * FindCard — one cell of the bridge stages' "What you'll find" grid
 * (.wf-find-grid in workflow-bridge.css): an aria-hidden icon tile, the card
 * title, and the body copy. The body is `children` so inline markup and
 * payload-derived numbers compose naturally. Purely presentational.
 */
export default function FindCard({ Icon, title, children }) {
  return (
    <div className="wf-find-card">
      <span className="wf-find-icon" aria-hidden="true">
        {Icon && <Icon size={15} />}
      </span>
      <span className="wf-find-title">{title}</span>
      <p className="wf-find-body">{children}</p>
    </div>
  )
}
