/**
 * JobsList (WORKFLOW §6.3-07) — the per-dataset job history, newest first
 * (the endpoint's order is kept). Status chips per job (terminal success in
 * green, live states in amber, failures in danger — never colour alone, the
 * chip text carries it); "View" selects the job for the live JobStatus panel
 * (the already-open job shows a "viewing" state pill instead of a dead
 * re-select); done jobs get an "Evaluate" link into stage 08 (deep-linked
 * on ?job=).
 */
import { Link } from 'react-router'
import { JOB_STATUS_CHIP } from '../../api/workflow'
import { EmptyState } from '../StateView'
import { formatDateTime, formatNumber } from '../../format'
// Jobs-table refinements (zebra / active-row accent bar) — loaded here
// because TrainStage's own stylesheets are owned outside this component.
import '../../styles/workflow-stats.css'

export default function JobsList({ jobs, datasetId, activeJobId, onSelect }) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return (
      <EmptyState
        kicker="No jobs yet"
        title="No training jobs on this dataset"
        detail="Start a training run above — the history of every run lands here."
      />
    )
  }

  return (
    <div className="table-scroll wf-jobs">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Objective</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Candidates
            </th>
            <th scope="col">Started</th>
            <th scope="col" className="wf-actions-col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const results = job.results && typeof job.results === 'object' ? job.results : {}
            const total = Object.keys(results).length
            const doneCount = Object.values(results).filter((r) => r?.status === 'done').length
            const isActive = job.job_id === activeJobId
            return (
              <tr
                key={job.job_id}
                className={isActive ? 'wf-row-active' : undefined}
              >
                <td className="mono strong" title={`Internal job reference: ${job.job_id}`}>Run · {formatDateTime(job.created_at)}</td>
                <td>{job.objective}</td>
                <td>
                  <span className={`badge ${JOB_STATUS_CHIP[job.status] ?? 'badge-muted'}`}>
                    {job.status}
                  </span>
                </td>
                <td className="num">
                  {formatNumber(doneCount, 0)}/{formatNumber(total, 0)}
                </td>
                <td className="dim">{formatDateTime(job.created_at)}</td>
                <td className="wf-jobactions">
                  {isActive ? (
                    /* The row's accent bar already marks the open job — the
                       action cell becomes a state pill instead of a no-op
                       re-select. */
                    <span className="wf-job-current mono" aria-current="true">
                      viewing
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelect?.(job.job_id)}
                    >
                      View
                    </button>
                  )}
                  {job.status === 'done' && (
                    <Link
                      className="btn btn-secondary btn-sm"
                      to={`/workflow/08-evaluate?dataset=${datasetId}&job=${job.job_id}`}
                    >
                      Evaluate
                    </Link>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
