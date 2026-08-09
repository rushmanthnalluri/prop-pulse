/**
 * The 12-stage guided-workflow catalog (WORKFLOW §1/§6.1). Kept in its own
 * dependency-free module so both `WorkflowShell` (routing/stepper) and
 * `Layout` (document.title) can import it without pulling the lazily-loaded
 * stage pages into the main bundle.
 *
 * Stages 01–08 are real workbench stages; 09 pairs a sandbox prediction panel
 * with a bridge to /valuation; 10–12 are bridge stages linking out to the
 * champion pages (/market, /model, /health). Gating (§6.1/§6.4): 01–07 and
 * 10–12 always available; 08 and 09 lock until the server state endpoint
 * reports can_evaluate / can_predict_sandbox for the active dataset.
 */

export const WORKFLOW_STAGES = [
  { num: '01', slug: '01-upload', short: 'Upload', title: 'Upload Dataset' },
  { num: '02', slug: '02-features', short: 'Features', title: 'Analyse Features' },
  { num: '03', slug: '03-stats', short: 'Stats', title: 'Descriptive Statistics' },
  { num: '04', slug: '04-missing', short: 'Missing', title: 'Missing Values' },
  { num: '05', slug: '05-viz', short: 'Visualize', title: 'Visualization' },
  { num: '06', slug: '06-preprocess', short: 'Preprocess', title: 'Preprocessing' },
  { num: '07', slug: '07-train', short: 'Train', title: 'Model Training' },
  { num: '08', slug: '08-evaluate', short: 'Evaluate', title: 'Model Evaluation' },
  { num: '09', slug: '09-predict', short: 'Predict', title: 'Predict Property' },
  { num: '10', slug: '10-market', short: 'Market', title: 'Neighbourhood Intelligence' },
  { num: '11', slug: '11-explain', short: 'Explain', title: 'Model Explainability' },
  { num: '12', slug: '12-health', short: 'Health', title: 'Model Health' },
]

/** First stage; also the fallback redirect target for /workflow. */
export const DEFAULT_STAGE = '01-upload'

/** Server-side dataset id grammar (§4.9) — used to validate ?dataset= params. */
export const DATASET_ID_RE = /^(ames|ds_[0-9a-f]{8})$/

/** @returns the stage definition for a slug, or null for unknown slugs. */
export function stageBySlug(slug) {
  return WORKFLOW_STAGES.find((stage) => stage.slug === slug) ?? null
}

/**
 * document.title for any /workflow/* path (Layout's TITLES map covers the
 * five product pages). Returns null for non-workflow paths so the caller can
 * fall through to its catch-all title.
 */
export function workflowDocumentTitle(pathname) {
  if (!pathname.startsWith('/workflow')) return null
  const match = pathname.match(/^\/workflow\/([^/?#]+)/)
  const stage = match ? stageBySlug(match[1]) : null
  return stage
    ? `ML Workbench · ${stage.title} — PropPulse`
    : 'ML Workbench — PropPulse'
}
