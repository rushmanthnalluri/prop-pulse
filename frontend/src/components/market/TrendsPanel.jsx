/**
 * Market trends panel (Market Intelligence page): one median-price line per
 * micro-market over the half-year periods 2006H1–2008H2, from GET
 * /market/trends. Self-contained fetch (its own signal-bound fetcher) so a
 * failed trends call never blanks the map section, and vice versa; the chart
 * itself — skeleton → error+retry → empty → chart lifecycle, null-gap
 * handling, the chartTheme skin and the ChartA11yTable twin — lives in
 * shared/TrendsChart.
 */
import { useCallback } from 'react'
import { api } from '../../api/client'
import TrendsChart from '../shared/TrendsChart'

export default function TrendsPanel() {
  const fetcher = useCallback((signal) => api.getTrends(signal), [])
  return (
    <TrendsChart
      fetcher={fetcher}
      title="Median sale price by half-year"
      renderTag={({ firstPeriod, lastPeriod }) => (
        <span className="chart-tag">
          {firstPeriod && lastPeriod
            ? `train window ${firstPeriod}–${lastPeriod} · gaps = no sales`
            : 'train window 2006H1–2008H2 · gaps = no sales'}
        </span>
      )}
      ariaLabel={({ firstPeriod, lastPeriod }) =>
        firstPeriod && lastPeriod
          ? `Line chart of median sale price per micro-market, half-year periods ${firstPeriod} to ${lastPeriod}`
          : 'Line chart of median sale price per micro-market by half-year'
      }
      errorTitle="Couldn't load market trends"
      skeletonHeight={320}
      tall
      margin={{ top: 8, right: 24, bottom: 4, left: 8 }}
      strokeWidth={2}
      dot={{ r: 2.5, strokeWidth: 0 }}
      activeDot={{ r: 4, strokeWidth: 0 }}
      noteClassName="note mt-10"
    />
  )
}
