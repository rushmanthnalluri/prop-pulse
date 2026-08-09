/**
 * JobsList (WORKFLOW §6.3-07) — the per-dataset job history, newest first
 * (the endpoint's order is kept). Status chips per job; "View" selects the
 * job for the live JobStatus panel; done jobs get an "Evaluate →" link into
 * stage 08 (deep-linked on ?job=).
 */
import { Link } from 'react-router'
import { EmptyState } from '../StateView'
import { formatDateTime, formatNumber } from '../../format'

const STATUS_CHIP = {
  queued: 'badge-muted',
  preparing: 'badge-muted',
  running: 'badge-accent',
  done: 'badge-accent',
  failed: 'badge-danger',
}

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
    <div className="table-scroll">
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
            return (
              <tr
                key={job.job_id}
                className={job.job_id === activeJobId ? 'wf-row-active' : undefined}
              >
                <td className="mono strong">{job.job_id}</td>
                <td>{job.objective}</td>
                <td>
                  <span className={`badge ${STATUS_CHIP[job.status] ?? 'badge-muted'}`}>
                    {job.status}
                  </span>
                </td>
                <td className="num">
                  {formatNumber(doneCount, 0)}/{formatNumber(total, 0)}
                </td>
                <td className="dim">{formatDateTime(job.created_at)}</td>
                <td className="wf-jobactions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onSelect?.(job.job_id)}
                  >
                    View
                  </button>
                  {job.status === 'done' && (
                    <Link
                      className="btn btn-secondary btn-sm"
                      to={`/workflow/08-evaluate?dataset=${datasetId}&job=${job.job_id}`}
                    >
                      Evaluate →
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
