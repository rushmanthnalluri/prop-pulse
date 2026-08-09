/**
 * Stage 11 — Model Explainability (WORKFLOW §6.3-11). Honest split of where
 * explanations live:
 *
 * - SANDBOX: the user's trained candidates carry native model importance
 *   (tree/linear/xgboost importances aggregated back to base features —
 *   computed at train time, §3.10), rendered in stage 08's evaluation
 *   workspace. The teaser here links there when a completed regression job
 *   exists on the active dataset; otherwise a designed empty state names the
 *   unblock action. SHAP is champion-only — stated, never faked (§7).
 * - BRIDGE: what the champion /model page offers (champions, metrics,
 *   uncertainty, global SHAP, methodology) + the CTA.
 */
import { useCallback } from 'react'
import { Link } from 'react-router'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatDateTime } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-bridge.css'

export default function ExplainStage() {
  const { datasetId, dataset, goToStage } = useWorkflow()

  // Sandbox teaser: does a done regression job exist for the active dataset?
  const fetchTeaser = useCallback(
    async (signal) => {
      const jobs = await wf.listJobs(datasetId, signal)
      return (jobs ?? []).find(
        (entry) =>
          entry?.status === 'done' &&
          entry.objective === 'regression' &&
          Object.values(entry.results ?? {}).some((r) => r?.status === 'done'),
      ) ?? null
    },
    [datasetId],
  )
  const { data: regressionJob, loading, error, reload } = useApi(fetchTeaser)

  const doneCandidates = regressionJob
    ? Object.entries(regressionJob.results ?? {})
        .filter(([, r]) => r?.status === 'done')
        .map(([name]) => name)
    : []

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 11 · Model Explainability</span>
        <h1 className="page-title">Why the numbers move</h1>
        <p className="page-desc">
          Explanations live in two places, labelled: native importances for your sandbox
          models, and the full SHAP treatment for the PropPulse champions on the Model
          Insights page.
        </p>
      </header>

      <section className="section" aria-labelledby="wf-sb-importance-title">
        <div className="section-head">
          <h2 className="section-title" id="wf-sb-importance-title">
            Your model — sandbox importances
          </h2>
          <span className="section-note">native importance, not SHAP</span>
        </div>

        {loading && <PanelSkeleton height={120} />}

        {!loading && error && (
          <ErrorState
            error={error}
            onRetry={reload}
            title="Couldn't load training jobs"
          />
        )}

        {!loading && !error && regressionJob && (
          <div className="wf-teaser">
            <div className="wf-teaser-head">
              <span className="badge badge-warn">Sandbox</span>
              <h3 className="wf-teaser-title">
                Native importance for your {dataset?.name ?? datasetId} models
              </h3>
            </div>
            <p className="wf-teaser-note">
              {regressionJob.job_id} finished {formatDateTime(regressionJob.finished_at)}{' '}
              with {doneCandidates.length} trained candidate
              {doneCandidates.length === 1 ? '' : 's'} ({doneCandidates.join(', ')}). Each
              carries its native feature importance — model weights aggregated to base
              features, not SHAP — charted in stage 08&rsquo;s evaluation workspace.
              Per-prediction SHAP explanations exist for the champion only.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => goToStage('08-evaluate')}
              >
                Open importance in stage 08 →
              </button>
            </div>
          </div>
        )}

        {!loading && !error && !regressionJob && (
          <EmptyState
            kicker="Sandbox importances"
            title="No trained regression model yet"
            detail="Train a regression model in stage 07 and its native feature importance appears in stage 08's evaluation workspace."
          >
            <button
              type="button"
              className="btn btn-primary btn-sm wf-locked-cta"
              onClick={() => goToStage('07-train')}
            >
              Go to stage 07 — Model Training
            </button>
          </EmptyState>
        )}
      </section>

      <section className="section" aria-labelledby="wf-model-bridge-title">
        <div className="wf-bridge">
          <div className="wf-bridge-head">
            <span className="badge badge-accent">Champion</span>
            <h2 className="wf-bridge-title" id="wf-model-bridge-title">
              Model Insights on /model
            </h2>
          </div>
          <p className="wf-bridge-copy">
            Champion explainability lives on the Model Insights page — the production
            models&rsquo; full evidence file, not the sandbox&rsquo;s. What you&rsquo;ll
            find:
          </p>
          <div className="wf-find-grid">
            <div className="wf-find-card">
              <span className="wf-find-title">The champions</span>
              <p className="wf-find-body">
                Which models won selection — regression, classification, clustering —
                and the rationale for each pick.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Performance &amp; uncertainty</span>
              <p className="wf-find-body">
                Validation and test metrics, confusion matrices, and the
                champion-vs-runner-up bootstrap — stated even when not decisive.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Global SHAP drivers</span>
              <p className="wf-find-body">
                Mean |SHAP| importance across every model feature — the champion&rsquo;s
                global drivers of price.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Methodology &amp; caveats</span>
              <p className="wf-find-body">
                How the champions were trained and judged — the leakage-safe protocol
                and its limits, stated plainly.
              </p>
            </div>
          </div>
          <p className="wf-bridge-note">
            Honest split: champion explainability (SHAP, test metrics) lives on /model;
            sandbox importances live in stage 08. The sandbox test split stays sealed —
            no test numbers exist in the workbench.
          </p>
          <Link className="btn btn-primary wf-bridge-cta" to="/model">
            Open Model Insights →
          </Link>
        </div>
      </section>
    </>
  )
}
