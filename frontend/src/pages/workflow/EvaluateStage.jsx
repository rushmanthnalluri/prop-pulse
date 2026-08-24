/**
 * EvaluateStage — stage 08 of the guided workbench (WORKFLOW §6.3-08,
 * blueprint §8.9). The shell locks this route until state.can_evaluate (at
 * least one completed job on the active dataset); this page renders the
 * job/candidate picker (done jobs from listJobs, grouped by objective; the
 * ?job= deep link from stage 07 is honored), then the reference's evaluation
 * rhythm: "The verdict" per-objective ComparisonTable (selection metric as
 * the accent column, ↓ on lower-better headers, 4dp per §12, champion row
 * tinted, best row from the server's selection rule + the regression
 * bootstrap honesty banner), the ProvenanceBanner, and the
 * EvaluationWorkspace for the selected candidate (wide curve cards +
 * the .eval-duo). Every number is validation-only and carries its
 * provenance; every classification number carries the SimulatedBadge (§7 —
 * component-enforced inside the shared components).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useWorkflow } from './WorkflowShell'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import ComparisonTable from '../../components/workflow/ComparisonTable'
import EvaluationWorkspace from '../../components/workflow/EvaluationWorkspace'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import { datasetRowsMeta, formatDateTime } from '../../format'
import '../../styles/confusion-matrix.css'
import '../../styles/wf-cluster.css'
import '../../styles/wf-comparison.css'
import '../../styles/workflow-evaluate.css'

/** Done jobs that have at least one successfully trained candidate. */
function evaluableJobs(jobs) {
  return (Array.isArray(jobs) ? jobs : []).filter(
    (job) =>
      job?.status === 'done' &&
      Object.values(job.results ?? {}).some((r) => r?.status === 'done'),
  )
}

/** First successfully-trained candidate name of a job (submission order). */
function firstDoneCandidate(job) {
  const entry = wf.doneCandidateEntries(job)[0]
  return entry ? entry[0] : null
}

export default function EvaluateStage() {
  const { datasetId, dataset } = useWorkflow()
  const [searchParams] = useSearchParams()
  const deepLinkJob = searchParams.get('job')

  const jobsFetcher = useCallback((signal) => wf.listJobs(datasetId, signal), [datasetId])
  const { data: jobs, loading, error, reload } = useApi(jobsFetcher)

  const candidates = useMemo(() => evaluableJobs(jobs), [jobs])
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [selectedCandidate, setSelectedCandidate] = useState(null)

  // Auto-select: honor the ?job= deep link when it is evaluable, else the
  // newest evaluable job; re-run only when the current selection is invalid.
  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedJobId(null)
      setSelectedCandidate(null)
      return
    }
    if (candidates.some((job) => job.job_id === selectedJobId)) return
    const linked = candidates.find((job) => job.job_id === deepLinkJob)
    const next = linked ?? candidates[0]
    setSelectedJobId(next.job_id)
    setSelectedCandidate(firstDoneCandidate(next))
  }, [candidates, selectedJobId, deepLinkJob])

  const selectedJob = candidates.find((job) => job.job_id === selectedJobId) ?? null
  const objective = selectedJob?.objective ?? null

  const modelsFetcher = useCallback(
    (signal) =>
      objective ? wf.getModels(datasetId, objective, signal) : Promise.resolve(null),
    [datasetId, objective],
  )
  const {
    data: models,
    loading: modelsLoading,
    error: modelsError,
    reload: reloadModels,
  } = useApi(modelsFetcher)

  const selectJob = (jobId) => {
    const job = candidates.find((j) => j.job_id === jobId)
    setSelectedJobId(jobId)
    setSelectedCandidate(firstDoneCandidate(job))
  }

  if (loading && !jobs) {
    return (
      <>
        <header className="page-head">
          <span className="kicker">Stage 08 · Modelling</span>
          <h1 className="page-title">Model Evaluation</h1>
        </header>
        <div className="section">
          <PanelSkeleton height={260} />
        </div>
      </>
    )
  }

  if (error && !jobs) {
    return (
      <div className="section">
        <ErrorState error={error} onRetry={reload} title="Couldn't load the job list" />
      </div>
    )
  }

  if (candidates.length === 0) {
    return (
      <div className="section">
        <EmptyState
          kicker="Stage 08 · Modelling"
          title="No completed training jobs on this dataset"
          detail="Evaluation reads the persisted validation predictions of a finished job — train at least one candidate in stage 07 first."
        >
          <Link
            className="btn btn-primary btn-sm wf-locked-cta"
            to={`/workflow/07-train?dataset=${datasetId}`}
          >
            Go to stage 07 — Model Training
          </Link>
        </EmptyState>
      </div>
    )
  }

  const doneCandidates = wf.doneCandidateEntries(selectedJob).map(([name]) => name)

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 08 · Modelling</span>
        <h1 className="page-title">Model Evaluation</h1>
        <p className="page-desc">
          One honest look at the validation split for each sandbox candidate — metrics,
          curves, confusion matrix, and feature importance from the predictions persisted
          at train time. The sandbox test split stays sealed; no test numbers exist in the
          workbench.
        </p>
        <p className="page-meta">
          {[
            dataset ? datasetRowsMeta(dataset) : null,
            `${candidates.length} completed job${candidates.length === 1 ? '' : 's'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <hr className="divider" />

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">Candidate</h2>
          <span className="section-note">completed jobs only</span>
        </div>
        <div className="panel">
          <div className="panel-body">
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="wf-eval-job">
                  Job
                </label>
                <select
                  id="wf-eval-job"
                  className="select"
                  value={selectedJobId ?? ''}
                  onChange={(event) => selectJob(event.target.value)}
                >
                  {wf.OBJECTIVES.map((obj) => {
                    const group = candidates.filter((job) => job.objective === obj)
                    if (group.length === 0) return null
                    return (
                      <optgroup key={obj} label={obj}>
                        {group.map((job) => (
                          <option key={job.job_id} value={job.job_id}>
                            {job.job_id} · {formatDateTime(job.created_at)}
                          </option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="wf-eval-candidate">
                  Candidate
                </label>
                <select
                  id="wf-eval-candidate"
                  className="select"
                  value={selectedCandidate ?? ''}
                  onChange={(event) => setSelectedCandidate(event.target.value)}
                >
                  {doneCandidates.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {objective && (
        <div className="section">
          <div className="section-head">
            <h2 className="section-title">The verdict — {objective} validation split</h2>
            <span className="section-note">latest successful result per candidate</span>
          </div>
          <ComparisonTable
            objective={objective}
            data={models}
            loading={modelsLoading}
            error={modelsError}
            onRetry={reloadModels}
            metricDigits={4}
          />
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h2 className="section-title">
            Evaluation — <span className="mono">{selectedCandidate}</span>
          </h2>
          <span className="section-note mono">{selectedJobId}</span>
        </div>
        {models?.provenance && (
          <div className="mb-16">
            <ProvenanceBanner
              provenance={models.provenance}
              label="Sandbox evaluation — validation metrics only; the test split stays sealed."
            />
          </div>
        )}
        {selectedJobId && selectedCandidate && (
          <EvaluationWorkspace
            key={`${selectedJobId}:${selectedCandidate}`}
            jobId={selectedJobId}
            candidate={selectedCandidate}
          />
        )}
      </div>
    </>
  )
}
