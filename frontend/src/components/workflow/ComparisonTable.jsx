/**
 * ComparisonTable (WORKFLOW §6.3-07/08) — the per-objective model comparison
 * from GET …/models?objective=… (latest successful result per candidate
 * across jobs). Sortable on every metric (useSortable + SortHeader, UX §7.6);
 * the best row follows the server's selection rule and carries the chip +
 * --accent-wash highlight. The regression paired-bootstrap block renders as
 * the honesty banner — "not statistically decisive" framing when
 * significant=false (§7; the BootstrapNote pattern, UX §5.4-5). Every number
 * is validation-only; the ProvenanceBanner states dataset, n_train/n_val, and
 * the classification table carries the SimulatedBadge (ADR-3).
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

/** Column sets per objective: [sortKey, label, numeric, render?]. */
const COLUMNS = {
  regression: [
    ['rmsle', 'RMSLE', true],
    ['rmse', 'RMSE', true, (v) => `$${formatNumber(v, 0)}`],
    ['mae', 'MAE', true, (v) => `$${formatNumber(v, 0)}`],
    ['r2', 'R²', true],
  ],
  classification: [
    ['pr_auc', 'PR-AUC', true],
    ['roc_auc', 'ROC-AUC', true],
    ['f1', 'F1', true],
    ['brier', 'Brier', true],
  ],
  clustering: [
    ['n_clusters', 'Clusters', true, (v) => formatNumber(v, 0)],
    ['n_noise', 'Noise', true, (v) => formatNumber(v, 0)],
    ['eps', 'eps', true],
    ['min_samples', 'min samples', true, (v) => formatNumber(v, 0)],
  ],
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
    params: candidate?.best_params ? JSON.stringify(candidate.best_params) : '',
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

export default function ComparisonTable({ objective, data, loading, error, onRetry }) {
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
        detail="Train one in stage 07 — the latest successful result per candidate lands here."
      />
    )
  }

  const columns = COLUMNS[objective] ?? COLUMNS.regression
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
          <SimulatedBadge /> Every number below is against a simulated target (ADR-3) — a
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
              {columns.map(([key, label, numeric]) => (
                <SortHeader
                  key={key}
                  label={label}
                  sortKey={key}
                  numeric={numeric}
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
              <th scope="col">Best params</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.name} className={row.best ? 'wf-best-row' : undefined}>
                <td className="mono strong">
                  {row.name}
                  {row.best && <span className="badge badge-accent wf-best-chip">best</span>}
                  {row.stale && (
                    <span
                      className="badge badge-warn wf-stale-chip"
                      title="Trained on a previous preprocessing configuration — these validation metrics describe the previous split."
                    >
                      old split
                    </span>
                  )}
                  {row.threshold != null && (
                    <span className="wf-threshold-hint mono">t={formatMetric(row.threshold, 2)}</span>
                  )}
                </td>
                {columns.map(([key, , numeric, render]) => (
                  <td key={key} className={numeric ? 'num' : undefined}>
                    {row[key] == null ? '—' : render ? render(row[key]) : formatMetric(row[key])}
                  </td>
                ))}
                <td className="num">{row.seconds == null ? '—' : formatNumber(row.seconds, 1)}</td>
                <td className="mono dim wf-params" title={row.params}>
                  {row.params.length > 44 ? `${row.params.slice(0, 44)}…` : row.params || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.selection?.note && (
        <p className="note" style={{ marginTop: 10 }}>
          Selection: <span className="mono">{data.selection.metric ?? '—'}</span> (
          {data.selection.rule ?? '—'}) — {data.selection.note}
        </p>
      )}
      <BootstrapBanner bootstrap={data.bootstrap} bestName={bestName} />
    </div>
  )
}
