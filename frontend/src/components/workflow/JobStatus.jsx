/**
 * JobStatus (WORKFLOW §6.3-07 / §6.4) — live view of one training job, driven
 * by useJobPolling (1.5 s, pauses while the tab is hidden, stops at the
 * terminal state). Progress is real — done/total counts rewritten by the
 * training subprocess after every candidate, never animated. Each candidate
 * row shows its status, seconds, and validation headline metric as it lands;
 * a failed candidate shows its error on expand and never fails the stage.
 *
 * `onTerminal(job)` fires exactly once on the active → done/failed
 * transition; the stage page uses it for the toast + reloadState() (the
 * stepper's gating depends on that reload).
 */
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { isJobTerminal, useJobPolling } from '../../api/workflow'
import { ErrorState, PanelSkeleton } from '../StateView'
import { formatMetric, formatNumber } from '../../format'

const STATUS_CHIP = {
  queued: 'badge-muted',
  preparing: 'badge-muted',
  running: 'badge-accent',
  pending: 'badge-muted',
  done: 'badge-accent',
  failed: 'badge-danger',
}

/** Headline validation metric per objective (§3.9 result shapes). */
function headline(objective, valMetrics) {
  if (!valMetrics) return null
  if (objective === 'regression') return `RMSLE ${formatMetric(valMetrics.rmsle)}`
  if (objective === 'classification') return `PR-AUC ${formatMetric(valMetrics.pr_auc)}`
  if (objective === 'clustering') {
    return `${formatNumber(valMetrics.n_clusters, 0)} clusters · ${formatNumber(valMetrics.n_noise, 0)} noise`
  }
  return null
}

export default function JobStatus({ jobId, datasetId, onTerminal }) {
  const prevStatus = useRef(null)
  const terminalFired = useRef(false)
  const onTerminalRef = useRef(onTerminal)
  useEffect(() => {
    onTerminalRef.current = onTerminal
  }, [onTerminal])

  // A new job id resets the transition tracking (stale results never linger —
  // useJobPolling does the same for its own state).
  useEffect(() => {
    prevStatus.current = null
    terminalFired.current = false
  }, [jobId])

  const { job, error, active, refresh } = useJobPolling(jobId, {
    intervalMs: 1500,
    onUpdate: (payload) => {
      const was = prevStatus.current
      prevStatus.current = payload?.status ?? was
      if (
        payload &&
        isJobTerminal(payload.status) &&
        was &&
        !isJobTerminal(was) &&
        !terminalFired.current
      ) {
        terminalFired.current = true
        onTerminalRef.current?.(payload)
      }
    },
  })

  if (!jobId) return null
  if (!job && !error) return <PanelSkeleton height={160} />
  if (error && !job) {
    return <ErrorState error={error} onRetry={refresh} title="Couldn't load the job status" />
  }

  const progress = job.progress ?? { done: 0, total: 0, current: null, elapsed_s: 0 }
  const total = Number(progress.total) || 0
  const done = Number(progress.done) || 0
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const results = job.results && typeof job.results === 'object' ? job.results : {}

  return (
    <div className="panel wf-jobstatus" aria-live="polite">
      <div className="panel-head">
        <span className="panel-title">
          Job <span className="mono">{job.job_id}</span>
        </span>
        <span className={`badge ${STATUS_CHIP[job.status] ?? 'badge-muted'}`}>
          {active && <span className="wf-pulse-dot" aria-hidden="true" />}
          {job.status}
        </span>
      </div>
      <div className="panel-body">
        <div
          className="wf-progress"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-label={`Training progress — ${done} of ${total} candidates`}
        >
          <div className="wf-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="wf-jobstatus-meta mono">
          {done}/{total} candidates
          {progress.current ? ` · running: ${progress.current}` : ''}
          {` · ${formatNumber(progress.elapsed_s, 0)}s elapsed`}
          {job.objective ? ` · ${job.objective}` : ''}
        </p>

        <ul className="wf-jobrows">
          {Object.entries(results).map(([name, result]) => (
            <li className="wf-jobrow" key={name}>
              <span className="mono wf-jobrow-name">{name}</span>
              <span className={`badge ${STATUS_CHIP[result?.status] ?? 'badge-muted'}`}>
                {result?.status ?? 'pending'}
              </span>
              <span className="wf-jobrow-metrics mono">
                {result?.status === 'done' && headline(job.objective, result.val_metrics)}
                {result?.status === 'done' && result.train_seconds != null && (
                  <span className="dim"> · {formatNumber(result.train_seconds, 1)}s</span>
                )}
              </span>
              {result?.status === 'failed' && result.error && (
                <details className="wf-jobrow-error">
                  <summary>error</summary>
                  <p className="mono">{result.error}</p>
                </details>
              )}
            </li>
          ))}
        </ul>

        {job.status === 'failed' && job.error && (
          <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>
            <span className="alert-title">Job failed</span>
            {job.error}
          </div>
        )}
        {job.status === 'done' && (
          <p className="note" style={{ marginTop: 12 }}>
            Job complete.{' '}
            <Link to={`/workflow/08-evaluate?dataset=${datasetId}&job=${job.job_id}`}>
              Open stage 08 — evaluation →
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
