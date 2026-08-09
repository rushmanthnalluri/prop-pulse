/**
 * Stepper (WORKFLOW §6.2) — the 12-stage strip across the top of every
 * /workflow/* page. Dumb presentational component: WorkflowShell computes the
 * per-stage status from server truth (GET …/state) + the localStorage
 * visited list and passes it in; this component only renders.
 *
 * States per stage:
 *   done      — visited earlier; teal check icon.
 *   current   — the open stage; accent ring + `aria-current="step"`.
 *   available — plain link.
 *   locked    — greyed + lock icon; `title` names the unblock action and a
 *               click raises a toast with the same message (no navigation).
 *
 * Stage 07 additionally shows a live dot while `state.jobs.running > 0`.
 * ≤900px the list becomes a horizontally scrollable strip (UX §8 topbar
 * pattern) and the current stage is auto-scrolled into view.
 */
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useToast } from '../Toast'

function CheckIcon() {
  return (
    <svg className="wf-step-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.2 4.8 9 10 3.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="wf-step-icon" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.4" y="5.2" width="7.2" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 5V3.8a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * @param {Object} props
 * @param {Array<{num: string, slug: string, short: string, title: string,
 *   status: 'done'|'current'|'available'|'locked', lockMessage: string|null,
 *   jobsRunning: number}>} props.stages - computed by WorkflowShell
 * @param {string} props.datasetId - active dataset, carried in every link
 */
export default function Stepper({ stages, datasetId }) {
  const toast = useToast()
  const listRef = useRef(null)
  const currentSlug = stages.find((stage) => stage.status === 'current')?.slug

  // Keep the current stage visible inside the horizontal scroll strip
  // (same pattern as the topbar in Layout.jsx).
  useEffect(() => {
    const current = listRef.current?.querySelector('.wf-step--current')
    current?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
  }, [currentSlug])

  return (
    <nav className="wf-stepper" aria-label="Guided workflow stages">
      <ol className="wf-stepper-list" ref={listRef}>
        {stages.map((stage) => {
          const inner = (
            <>
              <span className="wf-step-top">
                <span className="wf-step-num">{stage.num}</span>
                {stage.status === 'done' && <CheckIcon />}
                {stage.status === 'locked' && <LockIcon />}
                {stage.jobsRunning > 0 && (
                  <span
                    className="wf-step-dot"
                    role="img"
                    aria-label={`${stage.jobsRunning} training job running`}
                    title={`${stage.jobsRunning} training job running`}
                  />
                )}
              </span>
              <span className="wf-step-label">{stage.short}</span>
            </>
          )
          return (
            <li key={stage.slug} className="wf-stepper-item">
              {stage.status === 'locked' ? (
                <button
                  type="button"
                  className="wf-step wf-step--locked"
                  data-stage={stage.slug}
                  data-status="locked"
                  title={stage.lockMessage}
                  aria-label={`Stage ${stage.num}, ${stage.title}: locked — ${stage.lockMessage}`}
                  onClick={() => toast.info(stage.lockMessage)}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  to={`/workflow/${stage.slug}?dataset=${datasetId}`}
                  className={`wf-step wf-step--${stage.status}`}
                  data-stage={stage.slug}
                  data-status={stage.status}
                  aria-current={stage.status === 'current' ? 'step' : undefined}
                  title={stage.title}
                >
                  {inner}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
