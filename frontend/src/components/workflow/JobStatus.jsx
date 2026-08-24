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
import { JOB_STATUS_CHIP, isJobTerminal, useJobPolling } from '../../api/workflow'
import { ErrorState, PanelSkeleton } from '../StateView'
import { formatMetric, formatNumber } from '../../format'
// Live-panel refinements (progress gradient, row hovers) — loaded here
// because TrainStage's own stylesheets are owned outside this component.
import '../../styles/workflow-stats.css'

/**
 * Leading status glyph per candidate row — the CI-job-list idiom: shape +
 * colour + the text badge together, never colour alone. Inline SVG,
 * currentColor, one 1.5 stroke; the colour comes from the modifier class.
 */
function StatusGlyph({ status }) {
  const s = status ?? 'pending'
  let body
  if (s === 'done') {
    body = <path d="M4.6 8.6l2.3 2.3L11.4 5.4" />
  } else if (s === 'failed') {
    body = <path d="M5 5l6 6M11 5l-6 6" />
  } else if (s === 'running') {
    body = <circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none" />
  } else {
    body = <circle cx="8" cy="8" r="5.2" />
  }
  return (
    <span className={`wf-jobrow-ico wf-jobrow-ico--${s}`} aria-hidden="true">
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {body}
      </svg>
    </span>
  )
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
  const resultEntries = Object.entries(results)
  // Queued/preparing: no totals reported yet — the track breathes until the
  // worker's first progress write, so an empty 0% bar never reads as stalled.
  const awaiting = total === 0 && active

  return (
    <div className="panel wf-jobstatus">
      <div className="panel-head">
        <span className="panel-title">
          Job <span className="mono">{job.job_id}</span>
        </span>
        {/* Status transitions are the one live announcement: the meta line's
            elapsed seconds rewrite every poll, so an aria-live region around
            the whole panel would flood screen readers. */}
        <span
          className={`badge ${JOB_STATUS_CHIP[job.status] ?? 'badge-muted'}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {active && <span className="wf-pulse-dot" aria-hidden="true" />}
          {job.status}
        </span>
      </div>
      <div className="panel-body">
        <div
          className={`wf-jobprogress${awaiting ? ' wf-jobprogress--awaiting' : ''}`}
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-label={`Training progress — ${done} of ${total} candidates`}
        >
          <div className="wf-jobprogress-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="wf-jobstatus-meta mono">
          {done}/{total} candidates
          {total > 0 ? ` · ${pct}%` : ''}
          {progress.current ? ` · running: ${progress.current}` : ''}
          {` · ${formatNumber(progress.elapsed_s, 0)}s elapsed`}
          {job.objective ? ` · ${job.objective}` : ''}
        </p>

        {resultEntries.length === 0 && active && (
          <p className="note wf-jobstatus-waiting">
            Candidate rows appear here as the worker reports each fit.
          </p>
        )}
        {resultEntries.length > 0 && (
          <ul className="wf-jobrows">
            {resultEntries.map(([name, result]) => (
              <li className="wf-jobrow" key={name}>
                <StatusGlyph status={result?.status} />
                <span className="mono wf-jobrow-name">{name}</span>
                <span className={`badge ${JOB_STATUS_CHIP[result?.status] ?? 'badge-muted'}`}>
                  {result?.status ?? 'pending'}
                </span>
                <span className="wf-jobrow-metrics mono">
                  {result?.status === 'done' && headline(job.objective, result.val_metrics)}
                  {result?.status === 'done' && result.train_seconds != null && (
                    <span className="dim">
                      {headline(job.objective, result.val_metrics) ? ' · ' : ''}
                      {formatNumber(result.train_seconds, 1)}s
                    </span>
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
        )}

        {job.status === 'failed' && job.error && (
          <div className="alert alert-error mt-12" role="alert">
            <span className="alert-title">Job failed</span>
            {job.error}
          </div>
        )}
        {job.status === 'done' && (
          <p className="note mt-12">
            Job complete.{' '}
            <Link to={`/workflow/08-evaluate?dataset=${datasetId}&job=${job.job_id}`}>
              Open stage 08 — evaluation
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
