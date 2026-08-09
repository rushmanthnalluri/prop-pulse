/**
 * Overview hero (SPEC §5.1-1): kicker / H1 / methodology-narrating
 * description / primary + secondary CTAs, plus a mono meta line carrying real
 * provenance (champion versions + dataset). `meta` is a ready-rendered string
 * composed by the page from GET /model/info when available, with the
 * contract-verified static line as fallback.
 */
import { Link } from 'react-router'

export default function Hero({ meta }) {
  return (
    <div>
      <p className="kicker">Overview</p>
      <h1 className="page-title">Know what an Ames home is worth — and why.</h1>
      <p className="page-desc">
        PropPulse estimates market value, explains the estimate factor by factor, and
        benchmarks it against comparable sales — every figure traceable to a published
        model version.
      </p>
      <div className="ov-hero-actions">
        <Link className="btn btn-primary" to="/valuation">
          Value a home
        </Link>
        <Link className="btn btn-secondary" to="/market">
          Explore the market
        </Link>
      </div>
      {meta && <p className="ov-hero-meta">{meta}</p>}
    </div>
  )
}
