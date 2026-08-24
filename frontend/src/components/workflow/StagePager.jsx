/**
 * StagePager — the reference `_pager.html` pattern at the foot of every
 * /workflow/* stage: hairline top border, "← Stage NN" prev link on the left
 * (empty span on the first stage), "Stage NN →" next link on the right
 * (omitted on the last). Chains all 12 stages in WORKFLOW_STAGES order and
 * preserves the active `?dataset=` param in both links.
 *
 * The sidebar owns step navigation; this pager is the linear prev/next
 * companion at the page foot. Purely presentational — gating stays
 * server-truth in WorkflowShell (a locked target renders its designed
 * locked state when visited).
 */
import { Link } from 'react-router'
import { WORKFLOW_STAGES, stageHref } from '../../pages/workflow/stages'

/**
 * @param {Object} props
 * @param {string} props.currentSlug - slug of the open stage
 * @param {string} props.datasetId - active dataset, carried in both links
 */
export default function StagePager({ currentSlug, datasetId }) {
  const index = WORKFLOW_STAGES.findIndex((stage) => stage.slug === currentSlug)
  if (index === -1) return null
  const prev = WORKFLOW_STAGES[index - 1] ?? null
  const next = WORKFLOW_STAGES[index + 1] ?? null

  return (
    <nav className="stage-pager" aria-label="Workflow stages">
      {prev ? (
        <Link className="pager-link" rel="prev" to={stageHref(prev.slug, datasetId)}>
          <span className="pager-dir">← Stage {prev.num}</span>
          <span className="pager-label">{prev.title}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next && (
        <Link className="pager-link pager-next" rel="next" to={stageHref(next.slug, datasetId)}>
          <span className="pager-dir">Stage {next.num} →</span>
          <span className="pager-label">{next.title}</span>
        </Link>
      )}
    </nav>
  )
}
