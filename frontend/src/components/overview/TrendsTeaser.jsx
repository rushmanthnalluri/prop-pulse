/**
 * Market trend teaser (SPEC §5.1-5, AUDIT §4): the shared TrendsChart behind a
 * React.lazy boundary so recharts stays out of the landing bundle. The
 * Suspense fallback mirrors the chart card's shape (title + tag lines over a
 * 320px block) so the lazy chunk swap never shifts layout.
 *
 * TrendsChart self-fetches GET /market/trends (session-cached) and owns its
 * own skeleton / error+retry / empty states; the contract `note` renders
 * verbatim inside the card.
 */
import { lazy, Suspense } from 'react'
import { PanelSkeleton } from '../StateView'

const TrendsChart = lazy(() => import('../shared/TrendsChart'))

function TrendsFallback() {
  return (
    <div className="chart-card chart-card-wide" aria-hidden="true">
      <div className="chart-head">
        <span className="skeleton sk-line" style={{ width: 190, margin: 0 }} />
        <span className="skeleton sk-line" style={{ width: 230, margin: 0 }} />
      </div>
      <PanelSkeleton height={320} />
    </div>
  )
}

export default function TrendsTeaser() {
  return (
    <Suspense fallback={<TrendsFallback />}>
      <TrendsChart wide />
    </Suspense>
  )
}
