/**
 * 404 catch-all (SPEC §5.6): branded recovery page with links back to the two
 * primary destinations. document.title is set by Layout for unknown paths
 * ("Page not found — PropPulse"); the route is wrapped in an ErrorBoundary in
 * App.jsx (AUDIT §5.6). No search box — five routes, overkill.
 */
import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="crash-box">
      <span className="kicker">Error 404</span>
      <h1 className="page-title">Page not found</h1>
      <p className="page-desc">
        That page doesn't exist — the valuation tools are one click away.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
        <Link className="btn btn-primary" to="/">
          Back to overview
        </Link>
        <Link className="btn btn-secondary" to="/valuation">
          Value a home
        </Link>
      </div>
    </div>
  )
}
