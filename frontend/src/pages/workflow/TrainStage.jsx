/**
 * TrainStage — stage 07 of the guided workbench (WORKFLOW §6.3-07).
 *
 * Objective tabs (Regression / Classification / Clustering — the
 * classification tab carries the SIMULATED badge in the tab itself), the
 * TrainPanel with real candidate lists + honest cost hints, and the live
 * JobStatus (1.5 s polling via useJobPolling — real progress, not animated).
 * The panel's job id is mirrored into ?job= (restored on back/reload, the
 * same param EvaluateStage honors) and scoped to its dataset — a mid-job
 * dataset switch hides it rather than showing a foreign job (QA m2/m3).
 * 409 (one job at a time, server-wide) renders an inline notice naming the
 * running job with a "view it" action; 400 renders the row-window reason.
 * A terminal job fires a toast + reloadState() (stepper gating) and refreshes
 * the history + comparison. Below: JobsList (history, newest first) and the
 * sortable ComparisonTable from GET …/models?objective=… with the bootstrap
 * honesty banner. When can_train is false the launch is disabled and the
 * server's train_blocked_reason renders inline (route-level gating does not
 * cover stage 07 — it is always reachable, §6.1).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useWorkflow } from './WorkflowShell'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { useToast } from '../../components/Toast'
import TrainPanel from '../../components/workflow/TrainPanel'
import JobStatus from '../../components/workflow/JobStatus'
import JobsList from '../../components/workflow/JobsList'
import ComparisonTable from '../../components/workflow/ComparisonTable'
import SimulatedBadge from '../../components/workflow/SimulatedBadge'
import '../../styles/workflow-train.css'

const OBJECTIVE_LABELS = {
  regression: 'Regression',
  classification: 'Classification',
  clustering: 'Clustering',
}

/** `job_xxxxxxxx` out of the 409 detail string ("job job_1a2b3c4d (dataset …) is already running"). */
function jobIdFrom(message) {
  const match = /job_[0-9a-f]{8}/.exec(typeof message === 'string' ? message : '')
  return match ? match[0] : null
}

/** The ?job= deep-link param (the same one EvaluateStage honors). */
const JOB_ID_PARAM_RE = /^job_[0-9a-f]{8}$/

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
  }

  const start = async () => {
    setStartError(null)
    setStarting(true)
    try {
      const accepted = await wf.startJob(datasetId, objective, selected[objective])
      activateJob(accepted.job_id)
      toast.info(
        'Training started',
        `${OBJECTIVE_LABELS[objective]} · ${selected[objective].length} candidate${selected[objective].length === 1 ? '' : 's'} — job ${accepted.job_id}`,
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

  return (
    <>
      <div className="page-head">
        <span className="kicker">Stage 07 · Model Training</span>
        <h1 className="page-title">Model Training</h1>
        <p className="page-desc">
          Train your own sandboxed candidates on the prepared splits of the active dataset.
          Everything is validation-scored, one job runs at a time, and sandbox models never
          replace the PropPulse champion.
        </p>
        <p className="page-meta">
          {[
            dataset ? `${dataset.name} · ${dataset.n_rows} rows` : null,
            state?.prepared ? 'splits prepared' : 'not prepared — the first job auto-prepares with defaults',
            state?.jobs ? `${state.jobs.total} job${state.jobs.total === 1 ? '' : 's'} so far` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">New training job</span>
          <span className="section-note">real fits in a background process</span>
        </div>

        {blocked && (
          <div className="alert alert-warn" role="alert" style={{ marginBottom: 16 }}>
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
              {OBJECTIVE_LABELS[obj]}
              {obj === 'classification' && <SimulatedBadge className="wf-tab-badge" />}
            </button>
          ))}
        </div>

        <div className="panel">
          <div className="panel-body">
            {objective === 'classification' && (
              <p className="note wf-sim-note">
                <SimulatedBadge /> The sale-speed target is simulated (ADR-3) — a seeded
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
                className={`alert ${startError.status === 409 ? 'alert-warn' : 'alert-error'}`}
                role="alert"
                style={{ marginTop: 12 }}
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
      </div>

      {activeJob && activeJob.datasetId === datasetId && (
        <div className="section">
          <div className="section-head">
            <span className="section-title">Live job status</span>
            <span className="section-note">polled every 1.5 s · pauses when the tab is hidden</span>
          </div>
          <JobStatus jobId={activeJob.id} datasetId={datasetId} onTerminal={onTerminal} />
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <span className="section-title">Comparison — {OBJECTIVE_LABELS[objective]}</span>
          <span className="section-note">latest successful result per candidate</span>
        </div>
        <ComparisonTable
          objective={objective}
          data={models}
          loading={modelsLoading}
          error={modelsError}
          onRetry={reloadModels}
        />
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">Job history</span>
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
