/**
 * Overview hero, left column of `.home-head` (blueprint §8.1-1): kicker /
 * H1 / 14.5px description / page actions. Static copy — the live record
 * counts sit in the metrics strip directly below, so the hero never
 * re-flows when the payloads land. CTAs mirror the reference's placement
 * logic: primary into the pipeline, secondary into the data.
 */
import { Link } from 'react-router'

export default function Hero() {
  return (
    <div>
      <p className="page-kicker">Overview</p>
      <h1 className="page-title">PropPulse</h1>
      <p className="page-desc">
        Machine-learning property intelligence over the Ames housing record —
        valuations, sale probability, and micro-market structure — from raw
        upload to a trained property call. Every stage is live on the data now.
      </p>
      <div className="page-actions">
        <Link className="btn btn-primary" to="/workflow/01-upload">
          Start the pipeline
        </Link>
        <Link className="btn btn-secondary" to="/workflow/05-viz">
          Explore the data
        </Link>
      </div>
    </div>
  )
}
