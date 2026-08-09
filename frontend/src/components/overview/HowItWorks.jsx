/**
 * "How PropPulse works" (SPEC §5.1-6): the three-step method narrative —
 * Estimate / Explain / Compare — where every row is a real link into the
 * product (fixes the AUDIT §5.17 dead ends). Static copy; numbers named here
 * ("~80% range", "top five", "94 features") are contract facts (CONTRACT §2/§4).
 */
import { Link } from 'react-router'

const STEPS = [
  {
    title: 'Estimate',
    detail:
      'Describe the property — neighborhood, size, rooms, quality. The ridge champion estimates log-price and returns an ~80% range from validation residuals.',
    to: '/valuation',
    link: 'Value a home →',
  },
  {
    title: 'Explain',
    detail:
      'Every estimate is explained factor by factor — the top five SHAP drivers for that home, with global importance for all 94 features under Model Insights.',
    to: '/model',
    link: 'See global drivers →',
  },
  {
    title: 'Compare',
    detail:
      'Benchmark the estimate against the five closest comparable training sales and its micro-market median, then pull what-if levers — living area, quality, remodel year.',
    to: '/valuation',
    link: 'Run a scenario →',
  },
]

export default function HowItWorks() {
  return (
    <div className="row-list">
      {STEPS.map((step, i) => (
        <div className="row-item" key={step.title}>
          <span className="row-index">{String(i + 1).padStart(2, '0')}</span>
          <div className="row-body">
            <strong>{step.title}</strong>
            <span>{step.detail}</span>
          </div>
          <Link className="row-link" to={step.to}>
            {step.link}
          </Link>
        </div>
      ))}
    </div>
  )
}
