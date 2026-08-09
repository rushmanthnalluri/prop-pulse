/**
 * GlobalDrivers (SPEC §5.4-6): the top-20 global drivers of price from
 * GET /model/importance, rendered as DriverBars (ledger-style bars — the same
 * component Overview uses for its top-5) plus a visually-hidden
 * ChartA11yTable of the exact displayed values (SPEC §7.8). The caption keeps
 * the honest framing: mean |SHAP| in log1p(SalePrice) units over the
 * validation sample — relative influence across all 94 model features, not
 * dollar impacts (CONTRACT §1.7).
 */
import { useMemo } from 'react'
import { formatNumber, prettyFeature } from '../../format'
import DriverBars from '../shared/DriverBars'
import ChartA11yTable from '../shared/ChartA11yTable'

const TOP_N = 20

export default function GlobalDrivers({ payload }) {
  const rows = useMemo(() => {
    return Object.entries(payload?.importance ?? {})
      .filter(([, value]) => Number.isFinite(Number(value)))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, TOP_N)
      .map(([feature, weight], index) => ({
        rank: index + 1,
        feature: prettyFeature(feature),
        weight: Number(weight).toFixed(4),
      }))
  }, [payload])

  const meta = payload?.metadata ?? {}
  const totalFeatures = Object.keys(payload?.importance ?? {}).length

  if (rows.length === 0) {
    // DriverBars renders the same EmptyState; render it alone (no a11y table).
    return <DriverBars importance={payload?.importance} top={TOP_N} />
  }

  return (
    <>
      <DriverBars importance={payload?.importance} top={TOP_N} numbered />
      <ChartA11yTable
        caption={`Top ${rows.length} of ${totalFeatures || '—'} model features by mean absolute SHAP value`}
        columns={[
          { key: 'rank', label: 'Rank' },
          { key: 'feature', label: 'Feature' },
          { key: 'weight', label: 'Mean |SHAP|' },
        ]}
        rows={rows}
      />
      <p className="note insights-drivers-note">
        {meta.aggregation || 'Mean absolute SHAP values'}
        {meta.units ? ` — units ${meta.units}` : ''}; background n ={' '}
        {formatNumber(meta.background_size, 0)}
        {meta.background_split ? ` (${meta.background_split})` : ''}, validation
        sample n = {formatNumber(meta.val_sample_size, 0)}, seed{' '}
        {formatNumber(meta.seed, 0)}. Top {rows.length} of{' '}
        {totalFeatures || '—'} model features — relative influence on the
        log-price prediction, not dollar impacts.
      </p>
    </>
  )
}
