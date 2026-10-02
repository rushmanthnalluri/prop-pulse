/**
 * TrainStage — stage 07 of the guided workbench (WORKFLOW §6.3-07), presented
 * after the reference's /train (blueprint §8.8).
 *
 * "Model selection": objective tabs (Regression / Classification / Clustering
 * — the classification tab carries the SIMULATED badge in the tab itself),
 * the TrainPanel with real candidate checkboxes (.bench-check) + honest cost
 * hints, and the live JobStatus (1.5 s polling via useJobPolling — real
 * progress, not animated). The panel's job id is mirrored into ?job=
 * (restored on back/reload, the same param EvaluateStage honors) and scoped
 * to its dataset — a mid-job dataset switch hides it rather than showing a
 * foreign job (QA m2/m3). 409 admission conflicts are rendered inline when the trainer lock is held; queued submissions remain valid.
 * inline notice naming the running job with a "view it" action; 400 renders
 * the row-window reason. A terminal job fires a toast + reloadState()
 * (stepper gating) and refreshes the history + comparison.
 *
 * "Benchmark — the candidates, head to head": the reference's .bench-banner
 * (kicker "Best performing model", 20px accent name, mono sub with the real
 * selection rule from GET …/models?objective=…), then the sortable
 * ComparisonTable (the workbench's comparison component — it owns the
 * .wf-comparison contract the e2e journey drives: 3dp cells, sort headers,
 * .wf-best-chip, ProvenanceBanner, bootstrap honesty banner, stale-split
 * chips), then the wide grouped-bar card "Validation metrics by model"
 * (chartTheme skin, fixed per-candidate hues from the theme palette).
 *
 * "Inspect a trained candidate": the reference's model-pick pattern — a
 * select of the objective's trained candidates + "Clear selection" — opening
 * a detail panel (Best/old-split badges, metric cards with the selection
 * metric accented, mono meta line, best params) with a CTA into stage 08,
 * where curves/confusion/residuals live.
 *
 * When can_train is false the launch is disabled and the server's
 * train_blocked_reason renders inline (route-level gating does not cover
 * stage 07 — it is always reachable, §6.1).
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useWorkflow } from './WorkflowShell'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { useToast } from '../../components/Toast'
import TrainPanel, { CANDIDATE_INFO } from '../../components/workflow/TrainPanel'
import JobStatus from '../../components/workflow/JobStatus'
import JobsList from '../../components/workflow/JobsList'
import ComparisonTable from '../../components/workflow/ComparisonTable'
import SimulatedBadge from '../../components/workflow/SimulatedBadge'
import ChartA11yTable from '../../components/shared/ChartA11yTable'
import useReducedMotion from '../../components/shared/useReducedMotion'
import {
  CHART_PALETTE,
  cartesianGridProps,
  getAnimationProps,
  legendProps,
  tooltipProps,
  xAxisProps,
  yAxisProps,
} from '../../components/shared/chartTheme'
import { datasetRowsMeta, formatDateTime, formatMetric, formatNumber } from '../../format'
import '../../styles/confusion-matrix.css'
import '../../styles/wf-comparison.css'
import '../../styles/workflow-train.css'
import '../../styles/workflow-train-page.css'

/** Short labels for the server selection metrics (jobs.py _SELECTION_BLOCKS). */
const SELECTION_METRIC_LABELS = { rmsle: 'RMSLE', pr_auc: 'PR-AUC' }

/** Inspection-panel metric cards per objective: [val_metrics key, label, format]. */
const INSPECT_METRICS = {
  regression: [
    ['rmsle', 'RMSLE', (v) => formatMetric(v, 4)],
    ['rmse', 'RMSE', (v) => `$${formatNumber(v, 0)}`],
    ['mae', 'MAE', (v) => `$${formatNumber(v, 0)}`],
    ['r2', 'R²', (v) => formatMetric(v, 4)],
  ],
  classification: [
    ['pr_auc', 'PR-AUC', (v) => formatMetric(v, 4)],
    ['roc_auc', 'ROC-AUC', (v) => formatMetric(v, 4)],
    ['f1', 'F1', (v) => formatMetric(v, 4)],
    ['brier', 'Brier', (v) => formatMetric(v, 4)],
    ['threshold', 'Threshold', (v) => formatMetric(v, 2)],
  ],
  clustering: [
    ['n_clusters', 'Clusters', (v) => formatNumber(v, 0)],
    ['n_noise', 'Noise rows', (v) => formatNumber(v, 0)],
    ['eps', 'eps', (v) => formatMetric(v, 3)],
    ['min_samples', 'min samples', (v) => formatNumber(v, 0)],
  ],
}

/** Grouped-bar metric groups per objective: [val_metrics key, axis label]. */
const CHART_GROUPS = {
  regression: [
    ['rmsle', 'RMSLE'],
    ['r2', 'R²'],
  ],
  classification: [
    ['pr_auc', 'PR-AUC'],
    ['roc_auc', 'ROC-AUC'],
    ['f1', 'F1'],
    ['brier', 'Brier'],
  ],
  clustering: [
    ['n_clusters', 'Clusters'],
    ['n_noise', 'Noise rows'],
  ],
}

const CHART_TAGS = {
  regression: '0–1 scale · RMSLE lower is better · R² higher',
  classification: '0–1 scale · Brier lower is better',
  clustering: 'row counts',
}

/**
 * Fixed per-candidate bar hues, built only from the theme palette (blueprint
 * §6 carries the same idea: logistic grey, random-forest slate, boosting
 * amber). Alpha fills keep a 1px solid stroke of their hue so adjacent
 * candidates stay distinguishable; assignments never collide within one
 * objective's candidate set.
 */
const BAR_SERIES = {
  linear: { fill: CHART_PALETTE.neutral },
  ridge: { fill: CHART_PALETTE.slateFill, stroke: CHART_PALETTE.slate },
  lasso: { fill: CHART_PALETTE.neutralFill, stroke: CHART_PALETTE.neutral },
  random_forest: { fill: CHART_PALETTE.slate },
  xgboost: { fill: CHART_PALETTE.accent },
  logistic: { fill: CHART_PALETTE.neutral },
  decision_tree: { fill: CHART_PALETTE.neutralFill, stroke: CHART_PALETTE.neutral },
  dbscan: { fill: CHART_PALETTE.accent },
}
const BAR_SERIES_FALLBACK = { fill: CHART_PALETTE.accentFill, stroke: CHART_PALETTE.accent }

/** `job_xxxxxxxx` out of the 409 detail string ("job job_1a2b3c4d (dataset …) is already running"). */
function jobIdFrom(message) {
  const match = /job_[0-9a-f]{8}/.exec(typeof message === 'string' ? message : '')
  return match ? match[0] : null
}

/** The ?job= deep-link param (the same one EvaluateStage honors). */
const JOB_ID_PARAM_RE = /^job_[0-9a-f]{8}$/

/** Wide grouped-bar card: one metric group per cluster of bars, one bar per candidate. */
function BenchmarkChart({ objective, candidates }) {
  const reduced = useReducedMotion()
  const groups = CHART_GROUPS[objective] ?? CHART_GROUPS.regression
  const isCounts = objective === 'clustering'
  const fmt = isCounts ? (v) => formatNumber(v, 0) : (v) => formatMetric(v, 4)
  const rows = groups.map(([key, label]) => {
    const row = { metric: label }
    for (const candidate of candidates) {
      row[candidate.name] = candidate?.val_metrics?.[key] ?? null
    }
    return row
  })
  const names = candidates.map((candidate) => candidate.name)

  return (
    <div className="chart-card chart-card-wide mt-28">
      <div className="chart-card-head">
        <h3>Validation metrics by model</h3>
        <span className="chart-tag">{CHART_TAGS[objective] ?? CHART_TAGS.regression}</span>
      </div>
      <div
        className="chart-wrap chart-wrap-tall"
        role="img"
        aria-label={`Grouped bar chart comparing ${groups
          .map(([, label]) => label)
          .join(', ')} across the trained ${objective} candidates — validation metrics only`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...cartesianGridProps} />
            <XAxis dataKey="metric" {...xAxisProps} />
            <YAxis
              {...yAxisProps}
              domain={isCounts ? [0, 'auto'] : [0, 1]}
              allowDecimals={!isCounts}
            />
            <Tooltip {...tooltipProps} formatter={(value) => (value == null ? '—' : fmt(value))} />
            {names.length > 1 && <Legend {...legendProps} />}
            {names.map((name) => {
              const series = BAR_SERIES[name] ?? BAR_SERIES_FALLBACK
              return (
                <Bar
                  key={name}
                  dataKey={name}
                  fill={series.fill}
                  stroke={series.stroke ?? series.fill}
                  strokeWidth={1}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={26}
                  {...getAnimationProps(reduced)}
                />
              )
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartA11yTable
        caption={`Validation metrics by model — ${objective} candidates`}
        columns={[
          { key: 'metric', label: 'Metric' },
          ...names.map((name) => ({ key: name, label: name, format: fmt })),
        ]}
        rows={rows}
      />
    </div>
  )
}

/**
 * "old split" provenance badge — the reason rides the shared .tip-badge
 * tooltip (shows on :hover AND :focus; the badge is tabbable and wired with
 * aria-describedby, never a hover-only `title`), so keyboard and touch users
 * reach it too. The same pattern as SimulatedBadge.
 */
function StaleSplitBadge({ className = '' }) {
  const tipId = useId()
  return (
    <span
      className={`badge badge-warn tip-badge${className ? ` ${className}` : ''}`}
      tabIndex={0}
      aria-describedby={tipId}
    >
      old split
      <span className="tip-text" id={tipId} role="tooltip">
        Trained on a previous preprocessing configuration — these validation metrics
        describe the previous split.
      </span>
    </span>
  )
}

/** The reference's model-detail panel (§8.8) for one trained candidate. */
function CandidatePanel({ objective, candidate, selectionMetric, datasetId }) {
  const metrics = INSPECT_METRICS[objective] ?? INSPECT_METRICS.regression
  const params =
    candidate?.best_params && Object.keys(candidate.best_params).length > 0
      ? JSON.stringify(candidate.best_params)
      : null
  const meta = [
    'validation split — the test split stays sealed',
    candidate.job_id ? `job ${candidate.job_id}` : null,
    candidate.trained_at ? `trained ${formatDateTime(candidate.trained_at)}` : null,
    candidate.train_seconds != null
      ? `fitted in ${formatNumber(candidate.train_seconds, 1)}s`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="panel wftp-inspect mt-28">
      <div className="panel-head">
        <span className="panel-title mono">{candidate.name}</span>
        <span>
          {candidate.best && <span className="badge badge-accent">Best</span>}
          {candidate.stale_split && <StaleSplitBadge className="badge-offset" />}
        </span>
      </div>
      <div className="panel-body">
        {objective === 'classification' && (
          <p className="note wf-sim-note">
            <SimulatedBadge /> These metrics measure fit to the simulated sale-speed
            target, not an observed market outcome.
          </p>
        )}
        <p className="model-role">
          {CANDIDATE_INFO[candidate.name] ?? `${wf.OBJECTIVE_LABELS[objective]} candidate`}
        </p>
        <div className="metrics metrics-auto">
          {metrics.map(([key, label, fmt]) => (
            <div className="metric" key={key}>
              <div
                className={`metric-value${key === selectionMetric ? ' text-accent' : ''}`}
              >
                {candidate.val_metrics?.[key] != null ? fmt(candidate.val_metrics[key]) : '—'}
              </div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>
        <p className="page-meta">{meta}</p>
        {params && (
          <p className="note wftp-inspect-params">
            best params <span className="mono dim">{params}</span>
          </p>
        )}
        <div className="wftp-inspect-actions">
          <Link
            className="btn btn-secondary"
            to={`/workflow/08-evaluate?dataset=${datasetId}&job=${candidate.job_id}`}
          >
            Open full evaluation — stage 08
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function TrainStage() {
  const { datasetId, dataset, state, reloadState, canTrain, trainBlockedReason } = useWorkflow()
  const toast = useToast()

  const [objective, setObjective] = useState('regression')
  const [selected, setSelected] = useState(() => ({
    regression: [...wf.OBJECTIVE_CANDIDATES.regression],
    classification: [...wf.OBJECTIVE_CANDIDATES.classification],
    clustering: [...wf.OBJECTIVE_CANDIDATES.clustering],
  }))
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)
  // The inspected candidate (reference model-pick), by name, per objective.
  const [inspected, setInspected] = useState(null)
  // QA m3/m4: the live panel tracks {id, datasetId} — mirrored into the URL
  // (?job=, the param EvaluateStage honors) so navigation/back/reload restores
  // it, and scoped to its dataset so a mid-job dataset switch never shows a
  // foreign job above the wrong history.
  const [searchParams, setSearchParams] = useSearchParams()
  const paramJobId = searchParams.get('job')
  const [activeJob, setActiveJob] = useState(null)

  const jobsFetcher = useCallback((signal) => wf.listJobs(datasetId, signal), [datasetId])
  const { data: jobs, loading: jobsLoading, error: jobsError, reload: reloadJobs } =
    useApi(jobsFetcher)

  const modelsFetcher = useCallback(
    (signal) => wf.getModels(datasetId, objective, signal),
    [datasetId, objective],
  )
  const {
    data: models,
    loading: modelsLoading,
    error: modelsError,
    reload: reloadModels,
  } = useApi(modelsFetcher)

  // Resolve the panel's job once this dataset's history is known: keep a
  // correctly-scoped selection; else adopt the ?job= deep link when it names
  // a job of THIS dataset; else auto-resume the dataset's running job (m3).
  // A selection/param from another dataset is dropped (m4) — job payloads
  // carry dataset_id, so a stale list mid-refetch cannot leak one through.
  useEffect(() => {
    if (jobsLoading || !jobs) return
    const own = jobs.filter((job) => job?.dataset_id === datasetId)
    setActiveJob((prev) => {
      if (prev && prev.datasetId === datasetId) return prev
      const wanted =
        prev?.id ?? (paramJobId && JOB_ID_PARAM_RE.test(paramJobId) ? paramJobId : null)
      if (wanted && own.some((job) => job.job_id === wanted)) {
        return { id: wanted, datasetId }
      }
      const running = own.find((job) => wf.isJobActive(job.status))
      return running ? { id: running.job_id, datasetId } : null
    })
  }, [jobs, jobsLoading, datasetId, paramJobId])

  // Mirror the panel into ?job= (replace: the current history entry is
  // updated in place, so Back still lands on the restored panel — m3).
  // Skipped until the history has loaded at least once: without the list the
  // panel's scope is unverifiable, and a deep-linked param must not be wiped
  // by a transient fetch failure.
  useEffect(() => {
    if (!jobs) return
    const wanted = activeJob && activeJob.datasetId === datasetId ? activeJob.id : null
    if ((paramJobId ?? null) !== wanted) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (wanted) next.set('job', wanted)
          else next.delete('job')
          return next
        },
        { replace: true },
      )
    }
  }, [activeJob, datasetId, paramJobId, jobs, setSearchParams])

  /** Select a job for the live panel (start / history View / 409 "view it"). */
  const activateJob = useCallback(
    (jobId) => setActiveJob(jobId ? { id: jobId, datasetId } : null),
    [datasetId],
  )

  const toggleCandidate = (name) => {
    setSelected((prev) => {
      const list = prev[objective]
      return {
        ...prev,
        [objective]: list.includes(name) ? list.filter((n) => n !== name) : [...list, name],
      }
    })
  }

  const switchObjective = (next) => {
    setObjective(next)
    setStartError(null)
    setInspected(null)
  }

  const start = async () => {
    setStartError(null)
    setStarting(true)
    try {
      const accepted = await wf.startJob(datasetId, objective, selected[objective])
      activateJob(accepted.job_id)
      toast.info(
        'Training started',
        `${wf.OBJECTIVE_LABELS[objective]} · ${selected[objective].length} candidate${selected[objective].length === 1 ? '' : 's'} — job ${accepted.job_id}`,
      )
      reloadJobs()
    } catch (err) {
      if (err?.name !== 'AbortError') setStartError(err)
    } finally {
      setStarting(false)
    }
  }

  /** Terminal job → toast + server-truth reload (stepper gating) + refresh lists. */
  const onTerminal = useCallback(
    (job) => {
      if (job.status === 'done') {
        const failed = Object.values(job.results ?? {}).filter((r) => r?.status === 'failed')
        toast.success(
          `Training complete — ${job.job_id}`,
          failed.length > 0
            ? `${failed.length} candidate${failed.length === 1 ? '' : 's'} failed; the rest landed below.`
            : 'Every selected candidate trained.',
        )
      } else {
        toast.error(`Training failed — ${job.job_id}`, job.error ?? undefined)
      }
      reloadState()
      reloadJobs()
      reloadModels()
    },
    [reloadState, reloadJobs, reloadModels, toast],
  )

  const runningJobId = useMemo(() => jobIdFrom(startError?.message), [startError])
  const blocked = canTrain === false

  const candidates = Array.isArray(models?.candidates) ? models.candidates : []
  const best = candidates.find((candidate) => candidate?.best) ?? null
  const selectionMetric = models?.selection?.metric ?? null
  const selectionLabel = SELECTION_METRIC_LABELS[selectionMetric] ?? selectionMetric
  const bestMetricValue =
    best && selectionMetric ? (best.val_metrics?.[selectionMetric] ?? null) : null
  const inspectedCandidate = candidates.find((candidate) => candidate.name === inspected) ?? null
  const nVal = models?.provenance?.n_val ?? null

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 07 · Modelling</span>
        <h1 className="page-title">Model Training</h1>
        <p className="page-desc">
          Train your own sandboxed candidates on the prepared splits of the active dataset.
          Everything is validation-scored; queued jobs are admitted one at a time by the trainer, and sandbox models never
          replace the PropPulse champion.
        </p>
        <p className="page-meta">
          {[
            dataset ? datasetRowsMeta(dataset) : null,
            state?.prepared ? 'splits prepared' : 'not prepared — the first job auto-prepares with defaults',
            state?.jobs ? `${state.jobs.total} job${state.jobs.total === 1 ? '' : 's'} so far` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <hr className="divider" />

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Model selection</h2>
          <span className="section-note">queued jobs · one trainer at a time</span>
        </div>
        <p className="section-sub">
          Pick an objective, tick its candidates, and train. Every fit is a real background job
          on the prepared splits — identical data for every candidate, validation-scored only.
          The first job auto-prepares with the default config if stage 06 has not run yet.
        </p>

        {blocked && (
          <div className="alert alert-warn mb-16" role="alert">
            <span className="alert-title">Training is unavailable for this dataset</span>
            {trainBlockedReason ??
              'The dataset is outside the training row window. Stages 01–06 remain available.'}
          </div>
        )}

        <div className="wf-tabs" role="tablist" aria-label="Training objective">
          {wf.OBJECTIVES.map((obj) => (
            <button
              key={obj}
              type="button"
              role="tab"
              aria-selected={objective === obj}
              className={`wf-tab${objective === obj ? ' wf-tab--active' : ''}`}
              onClick={() => switchObjective(obj)}
            >
              {wf.OBJECTIVE_LABELS[obj]}
              {obj === 'classification' && <SimulatedBadge className="wf-tab-badge" />}
            </button>
          ))}
        </div>

        <div className="panel">
          <div className="panel-body">
            {objective === 'classification' && (
              <p className="note wf-sim-note">
                <SimulatedBadge /> The sale-speed target is simulated — a seeded
                days-on-market simulation. Classification metrics measure fit to that
                simulation, not a real market outcome.
              </p>
            )}
            <TrainPanel
              objective={objective}
              selected={selected[objective]}
              onToggle={toggleCandidate}
              onStart={start}
              starting={starting}
              disabled={blocked}
              disabledReason={trainBlockedReason}
            />
            {startError && (
              <div
                className={`alert mt-12 ${startError.status === 409 ? 'alert-warn' : 'alert-error'}`}
                role="alert"
              >
                <span className="alert-title">
                  {startError.status === 409
                    ? 'A training job is already running'
                    : "Couldn't start the job"}
                </span>
                {startError.message}
                {startError.status === 409 && runningJobId && (
                  <div className="alert-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        activateJob(runningJobId)
                        setStartError(null)
                      }}
                    >
                      View {runningJobId}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {candidates.length > 0 && (
          <div className="model-pick wftp-pick">
            <div className="field model-pick-field">
              <label className="field-label" htmlFor="wftp-inspect">
                Inspect a trained candidate
              </label>
              <select
                id="wftp-inspect"
                className="select"
                value={inspected ?? ''}
                onChange={(event) => setInspected(event.target.value || null)}
              >
                <option value="">Choose a candidate to inspect…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {selectionMetric && candidate.val_metrics?.[selectionMetric] != null
                      ? `${candidate.name} · ${selectionLabel} ${formatMetric(candidate.val_metrics[selectionMetric], 4)}`
                      : candidate.name}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                The latest successful run per candidate — validation metrics only.
              </span>
            </div>
            {inspectedCandidate && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setInspected(null)}
              >
                Clear selection
              </button>
            )}
          </div>
        )}

        {inspectedCandidate && (
          <CandidatePanel
            objective={objective}
            candidate={inspectedCandidate}
            selectionMetric={selectionMetric}
            datasetId={datasetId}
          />
        )}
      </div>

      {activeJob && activeJob.datasetId === datasetId && (
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">Live job status</h2>
            <span className="section-note">polled every 1.5 s · pauses when the tab is hidden</span>
          </div>
          <JobStatus jobId={activeJob.id} datasetId={datasetId} onTerminal={onTerminal} />
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Benchmark — the candidates, head to head</h2>
          <span className="section-note">
            {nVal != null
              ? `${formatNumber(nVal, 0)} validation rows · test stays sealed`
              : 'validation-scored · test stays sealed'}
          </span>
        </div>
        <p className="section-sub">
          Every number below comes from real training jobs on the active dataset — identical
          prepared splits for every candidate. The best candidate follows the server's
          validation rule; the sealed test split plays no part in the choice.
        </p>

        {best && (
          <div className="bench-banner">
            <span className="bench-banner-kicker">Best performing model</span>
            <span className="wftp-banner-row">
              <span className="bench-banner-name">{best.name}</span>
              {best.stale_split && <StaleSplitBadge />}
            </span>
            <span className="bench-banner-sub">
              {[
                models?.selection?.note ?? null,
                bestMetricValue != null && selectionLabel
                  ? `${selectionLabel} ${formatMetric(bestMetricValue, 4)}`
                  : null,
                best.train_seconds != null
                  ? `fitted in ${formatNumber(best.train_seconds, 1)}s`
                  : null,
                best.job_id ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}

        <ComparisonTable
          objective={objective}
          data={models}
          loading={modelsLoading}
          error={modelsError}
          onRetry={reloadModels}
          metricDigits={4}
        />

        {!modelsLoading && !modelsError && candidates.length > 0 && (
          <BenchmarkChart objective={objective} candidates={candidates} />
        )}

        <p className="note mt-16">
          Curves, confusion matrices, and residual detail for any completed job are on the{' '}
          <Link to={`/workflow/08-evaluate?dataset=${datasetId}`}>evaluation stage</Link>; the
          inspected candidate can predict on the{' '}
          <Link to={`/workflow/09-predict?dataset=${datasetId}`}>prediction stage</Link>.
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Job history</h2>
          <span className="section-note">newest first</span>
        </div>
        {jobsLoading && !jobs ? (
          <div className="skeleton sk-block" style={{ minHeight: 120 }} aria-hidden="true" />
        ) : jobsError && !jobs ? (
          <div className="alert alert-error" role="alert">
            <span className="alert-title">Couldn't load the job history</span>
            {jobsError.message}
            <div className="alert-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={reloadJobs}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <JobsList
            jobs={jobs ?? []}
            datasetId={datasetId}
            activeJobId={activeJob?.id ?? null}
            onSelect={activateJob}
          />
        )}
      </div>
    </>
  )
}
