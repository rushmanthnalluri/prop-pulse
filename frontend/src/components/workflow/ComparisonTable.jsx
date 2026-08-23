/**
 * ComparisonTable (WORKFLOW §6.3-07/08) — the per-objective model comparison
 * from GET …/models?objective=… (latest successful result per candidate
 * across jobs), presented as the reference's "verdict" table (blueprint
 * §8.9): the selection metric renders as the accent column, lower-is-better
 * headers carry the ↓ marker, and the server-flagged best row keeps the
 * champion tint + "best" chip (e2e-pinned copy — PropPulse's only "Champion"
 * is the production model, so the sandbox best is labelled "best").
 *
 * Reference deviations, all deliberate: the table stays sortable on every
 * metric (useSortable + SortHeader, UX §7.6 — e2e-pinned), and stage 08
 * passes metricDigits={4} for the benchmark-table 4dp convention (§12)
 * while stage 07 keeps the 3dp default. The regression paired-bootstrap
 * block renders as the honesty banner — "not statistically decisive"
 * framing when significant=false (§7; the BootstrapNote pattern, UX §5.4-5).
 * Every number is validation-only; the ProvenanceBanner states dataset,
 * n_train/n_val, and the classification table carries the SimulatedBadge
 * (ADR-3).
 *
 * Self-contained states: skeleton while loading, inline error + retry, empty
 * state when no candidate has completed for the objective.
 */
import useSortable from '../shared/useSortable'
import SortHeader from '../shared/SortHeader'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import ProvenanceBanner from './ProvenanceBanner'
import SimulatedBadge from './SimulatedBadge'
import { formatMetric, formatNumber } from '../../format'

/**
 * Column sets per objective. `lower` marks lower-is-better headers (↓);
 * `accent` is the fallback accent column when the server's selection metric
 * does not name a column; `usd`/`int` pick the cell format; anything else is
 * a unitless metric rendered at the table's metricDigits.
 */
const COLUMNS = {
  regression: [
    { key: 'rmsle', label: 'RMSLE', lower: true, accent: true },
    { key: 'rmse', label: 'RMSE', lower: true, usd: true },
    { key: 'mae', label: 'MAE', lower: true, usd: true },
    { key: 'r2', label: 'R²' },
  ],
  classification: [
    { key: 'pr_auc', label: 'PR-AUC' },
    { key: 'roc_auc', label: 'ROC-AUC', accent: true },
    { key: 'f1', label: 'F1' },
    { key: 'brier', label: 'Brier', lower: true },
  ],
  clustering: [
    { key: 'n_clusters', label: 'Clusters', int: true },
    { key: 'n_noise', label: 'Noise', int: true },
    { key: 'eps', label: 'eps', digits: 3 },
    { key: 'min_samples', label: 'min samples', int: true },
  ],
}

/** One-line reading guide per objective, under the table (no numbers). */
const OBJECTIVE_NOTES = {
  regression:
    'RMSLE is the selection metric — a log-space error, so a 10% miss costs the same at $100k and $1M. RMSE and MAE are the dollar misses; RMSE punishes outliers harder.',
  classification:
    'Brier measures probability quality (lower is better) — it is what the operating threshold trades against. ROC-AUC and PR-AUC are pure ranking: a monotone remap of probabilities never changes them.',
  clustering:
    'DBSCAN exposes no validation metric — a clustering run is judged by coverage and noise share, not a score. eps comes from the k-distance knee computed at prepare time.',
}

/** Flatten a candidate entry into a sortable row. */
function toRow(candidate) {
  const metrics = candidate?.val_metrics ?? {}
  return {
    name: candidate?.name ?? '—',
    job_id: candidate?.job_id ?? null,
    best: Boolean(candidate?.best),
    // Red-team F1: the server flags results whose prepare fingerprint was
    // superseded by a re-prepare — they stay visible, honestly labelled.
    stale: Boolean(candidate?.stale_split),
    seconds: candidate?.train_seconds ?? null,
    threshold: metrics.threshold ?? null,
    rmsle: metrics.rmsle ?? null,
    rmse: metrics.rmse ?? null,
    mae: metrics.mae ?? null,
    r2: metrics.r2 ?? null,
    pr_auc: metrics.pr_auc ?? null,
    roc_auc: metrics.roc_auc ?? null,
    f1: metrics.f1 ?? null,
    brier: metrics.brier ?? null,
    n_clusters: metrics.n_clusters ?? null,
    n_noise: metrics.n_noise ?? null,
    eps: metrics.eps ?? null,
    min_samples: metrics.min_samples ?? null,
  }
}

/** Cell text per column format; null/NaN discipline = the app-wide '—'. */
function formatCell(col, value, metricDigits) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  if (col.usd) return `$${formatNumber(value, 0)}`
  if (col.int) return formatNumber(value, 0)
  return formatMetric(value, col.digits ?? metricDigits)
}

/** The paired-bootstrap honesty banner (regression only, §3.9/§7). */
function BootstrapBanner({ bootstrap, bestName }) {
  if (!bootstrap) return null
  const decisive = bootstrap.significant === true
  const ci = Array.isArray(bootstrap.ci95) ? bootstrap.ci95 : []
  return (
    <div className="alert alert-warn wf-bootstrap" role="note">
      <span className="alert-title">
        {decisive
          ? `Best vs ${bootstrap.runner_up}: statistically decisive`
          : `Best vs ${bootstrap.runner_up}: not statistically decisive`}
      </span>
      Paired bootstrap on validation predictions — observed RMSLE diff{' '}
      <span className="mono">{formatMetric(bootstrap.observed_rmsle_diff, 4)}</span>, 95% CI{' '}
      <span className="mono">
        [{formatMetric(ci[0], 4)}, {formatMetric(ci[1], 4)}]
      </span>
      , P({bootstrap.runner_up} is actually better) ={' '}
      <span className="mono">{formatMetric(bootstrap.prob_runner_up_better, 2)}</span>.{' '}
      {decisive
        ? `${bestName} keeps the "best" chip with statistical support.`
        : `${bestName} keeps the "best" chip by the validation-RMSLE rule, but the gap is inside noise — treat the top two as tied.`}
    </div>
  )
}

export default function ComparisonTable({
  objective,
  data,
  loading,
  error,
  onRetry,
  metricDigits = 3,
}) {
  const rows = (data?.candidates ?? []).map(toRow)
  const { sorted, sort, toggleSort } = useSortable(rows)

  if (loading) return <PanelSkeleton height={200} />
  if (error) {
    return <ErrorState error={error} onRetry={onRetry} title="Couldn't load the model comparison" />
  }
  if (!data || rows.length === 0) {
    return (
      <EmptyState
        kicker="No candidates"
        title={`No completed ${objective} candidates yet`}
        detail="Train a candidate first — the latest successful result per candidate lands here."
      />
    )
  }

  const columns = COLUMNS[objective] ?? COLUMNS.regression
  // The accent column follows the server's selection rule; when the metric
  // name is not a column (or is absent), the per-objective fallback applies.
  const selectionMetric = data.selection?.metric ?? null
  const accentKey =
    (selectionMetric && columns.some((col) => col.key === selectionMetric)
      ? selectionMetric
      : null) ?? columns.find((col) => col.accent)?.key ?? null
  const bestName = rows.find((row) => row.best)?.name ?? 'best'
  const simulated = data.provenance?.simulated_target === true
  const staleAny = rows.some((row) => row.stale)

  return (
    <div className="wf-comparison">
      <ProvenanceBanner
        provenance={data.provenance}
        label="Sandbox comparison — validation metrics only; the test split stays sealed."
      />
      {staleAny && (
        <p className="note wf-stale-note">
          <span className="badge badge-warn">old split</span> marks candidates trained before
          the latest preprocessing run — their metrics describe the previous split and are kept
          for provenance, not comparability.
          {objective === 'regression' &&
            rows.length >= 2 &&
            !data.bootstrap &&
            ' The paired bootstrap is hidden while the compared candidates span different splits.'}
        </p>
      )}
      {simulated && (
        <p className="note wf-sim-note">
          <SimulatedBadge /> Every number below is against a simulated target — a
          seeded days-on-market simulation, not an observed market outcome.
        </p>
      )}
      <div className="table-scroll wf-clip">
        <table className="table">
          <caption className="visually-hidden">
            {objective} candidates ranked by validation {data.selection?.metric ?? 'metric'} —{' '}
            {data.selection?.note}
          </caption>
          <thead>
            <tr>
              <SortHeader label="Candidate" sortKey="name" sort={sort} onToggle={toggleSort} />
              {columns.map((col) => (
                <SortHeader
                  key={col.key}
                  label={col.lower ? `${col.label} ↓` : col.label}
                  sortKey={col.key}
                  numeric
                  sort={sort}
                  onToggle={toggleSort}
                />
              ))}
              <SortHeader
                label="Train s"
                sortKey="seconds"
                numeric
                sort={sort}
                onToggle={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.name} className={row.best ? 'champion-row' : undefined}>
                <td className="mono strong">
                  {row.name}
                  {row.best && <span className="badge badge-accent wf-best-chip">best</span>}
                  {row.stale && (
                    <span
                      className="badge badge-warn wf-stale-chip"
                      tabIndex={0}
                      aria-label="Old split — trained on a previous preprocessing configuration; these validation metrics describe the previous split."
                    >
                      old split
                    </span>
                  )}
                  {row.threshold != null && (
                    <span className="wf-threshold-hint mono">t={formatMetric(row.threshold, 2)}</span>
                  )}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.key === accentKey ? 'num accent' : 'num'}
                  >
                    {formatCell(col, row[col.key], metricDigits)}
                  </td>
                ))}
                <td className="num">{row.seconds == null ? '—' : formatNumber(row.seconds, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {OBJECTIVE_NOTES[objective] && (
        <p className="note mt-10">
          {OBJECTIVE_NOTES[objective]}
        </p>
      )}
      {data.selection?.note && (
        <p className="note mt-10">
          Selection: <span className="mono">{data.selection.metric ?? '—'}</span> (
          {data.selection.rule ?? '—'}) — {data.selection.note}
        </p>
      )}
      <BootstrapBanner bootstrap={data.bootstrap} bestName={bestName} />
    </div>
  )
}
