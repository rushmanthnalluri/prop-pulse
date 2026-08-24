/**
 * 404 catch-all — the reference error.html pattern: kicker "Error 404",
 * h1 "Page not found", message, then btn-primary back to the overview and
 * btn-secondary to the upload page. The oversized outlined "404" numeral is
 * pure decoration (aria-hidden, pointer-events:none, hidden ≤900px) — the
 * kicker remains the accessible error label. The attempted path renders in
 * mono (real request data, never fabricated), and a hairline recovery list
 * links the four product destinations so the dead end routes somewhere
 * useful. document.title is set by Layout for unknown paths
 * ("404 · PropPulse"); the route is wrapped in an ErrorBoundary in App.jsx.
 * No active nav highlight.
 */
import { Link, useLocation } from 'react-router'
import '../styles/insights.css'

const RECOVERY_LINKS = [
  { to: '/', label: 'Overview', note: 'the product at a glance' },
  { to: '/valuation', label: 'Valuation', note: 'price a property' },
  { to: '/market', label: 'Market Intelligence', note: 'the micro-market map' },
  { to: '/model', label: 'Model Insights', note: 'model evidence & caveats' },
]

export default function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <div className="page-head not-found">
      <span className="not-found-numeral" aria-hidden="true">
        404
      </span>
      <p className="page-kicker">Error 404</p>
      <h1>Page not found</h1>
      <p className="page-desc">
        That page doesn&rsquo;t exist — the valuation tools and the guided
        pipeline are one click away.
      </p>
      <p className="not-found-path">
        no route matches <span className="mono">{pathname}</span>
      </p>
      <div className="page-actions">
        <Link className="btn btn-primary" to="/">
          Back to overview
        </Link>
        <Link className="btn btn-secondary" to="/workflow/01-upload">
          Go to Upload
        </Link>
      </div>
      <nav className="not-found-nav" aria-label="Popular pages">
        <p className="not-found-nav-kicker">Or start from a popular page</p>
        <ul className="not-found-links">
          {RECOVERY_LINKS.map((link) => (
            <li key={link.to}>
              <Link className="not-found-link" to={link.to}>
                <span className="not-found-link-label">{link.label}</span>
                <span className="not-found-link-note">{link.note}</span>
                <span className="not-found-link-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
