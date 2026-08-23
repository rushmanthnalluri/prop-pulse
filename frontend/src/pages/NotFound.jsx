/**
 * 404 catch-all — the reference error.html pattern: kicker "Error 404",
 * h1 "Page not found", message, then btn-primary back to the overview and
 * btn-secondary to the upload page. document.title is set by Layout for
 * unknown paths ("404 · PropPulse"); the route is wrapped in an
 * ErrorBoundary in App.jsx. No active nav highlight.
 */
import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="page-head">
      <p className="page-kicker">Error 404</p>
      <h1>Page not found</h1>
      <p className="page-desc">
        That page doesn&rsquo;t exist — the valuation tools and the guided
        pipeline are one click away.
      </p>
      <div className="page-actions">
        <Link className="btn btn-primary" to="/">
          Back to overview
        </Link>
        <Link className="btn btn-secondary" to="/workflow/01-upload">
          Go to Upload
        </Link>
      </div>
    </div>
  )
}
