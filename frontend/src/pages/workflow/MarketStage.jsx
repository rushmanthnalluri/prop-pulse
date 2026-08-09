/**
 * Stage 10 — Neighbourhood Intelligence (WORKFLOW §6.3-10). A bridge stage
 * with one piece of real sandbox output on top:
 *
 * - SANDBOX TEASER: when the active dataset has a completed clustering job,
 *   its evaluation payload (§3.10 — real n_clusters / n_noise / eps /
 *   min_samples, no silhouette because none exists, §7) renders as a compact
 *   "your sandbox clustering" card linking to stage 08. Without one, a
 *   designed empty state names the unblock action (stage 07, Clustering tab).
 * - BRIDGE: what the champion /market page offers + the CTA. Honest labeling
 *   (§7 rules 2/6): /market is powered by the champion artifacts (DBSCAN on
 *   the full bundled Ames train split), neighborhood centroids are
 *   approximate, and trends cover the 2006–2008 training window.
 *
 * Bridge numbers (neighborhood count, micro-market count) come from the
 * session-cached /market/clusters payload — additive: when unavailable the
 * copy falls back to un-numbered wording, never hardcoded figures.
 */
import { useCallback } from 'react'
import { Link } from 'react-router'
import * as wf from '../../api/workflow'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-bridge.css'

export default function MarketStage() {
  const { datasetId, dataset, goToStage } = useWorkflow()

  // Sandbox teaser: newest done clustering job → its dbscan evaluation.
  const fetchTeaser = useCallback(
    async (signal) => {
      const jobs = await wf.listJobs(datasetId, signal)
      const job = (jobs ?? []).find(
        (entry) =>
          entry?.status === 'done' &&
          entry.objective === 'clustering' &&
          entry.results?.dbscan?.status === 'done',
      )
      if (!job) return { job: null, evaluation: null }
      const evaluation = await wf.getEvaluation(job.job_id, 'dbscan', signal)
      return { job, evaluation }
    },
    [datasetId],
  )
  const { data: teaser, loading, error, reload } = useApi(fetchTeaser)

  // Bridge copy numbers — session-cached champion payload, additive only.
  const fetchClusters = useCallback((signal) => api.marketClusters(signal), [])
  const { data: clusters } = useApi(fetchClusters)
  const nNeighborhoods = Array.isArray(clusters?.neighborhoods)
    ? clusters.neighborhoods.length
    : null
  const nMicroMarkets = Number.isFinite(Number(clusters?.n_clusters))
    ? Number(clusters.n_clusters)
    : null

  const evaluation = teaser?.evaluation ?? null
  const nAssigned = Array.isArray(evaluation?.assignments)
    ? evaluation.assignments.length
    : null

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 10 · Neighbourhood Intelligence</span>
        <h1 className="page-title">Micro-markets, yours and the champion&rsquo;s</h1>
        <p className="page-desc">
          See what DBSCAN found in your own dataset, then open the product&rsquo;s
          neighbourhood intelligence — an interactive map of the Ames micro-markets the
          champion models use.
        </p>
      </header>

      <section className="section" aria-labelledby="wf-sb-cluster-title">
        <div className="section-head">
          <h2 className="section-title" id="wf-sb-cluster-title">
            Your model — sandbox clustering
          </h2>
          <span className="section-note">GET /workflow/jobs/…/evaluation/dbscan</span>
        </div>

        {loading && <PanelSkeleton height={150} />}

        {!loading && error && (
          <ErrorState
            error={error}
            onRetry={reload}
            title="Couldn't load the sandbox clustering"
          />
        )}

        {!loading && !error && evaluation && (
          <div className="wf-teaser">
            <div className="wf-teaser-head">
              <span className="badge badge-warn">Sandbox</span>
              <h3 className="wf-teaser-title">
                DBSCAN on {dataset?.name ?? datasetId} — train split only
              </h3>
            </div>
            <div className="metrics metrics--3">
              <div className="metric">
                <div className="metric-label">Micro-markets</div>
                <div className="metric-value">{formatNumber(evaluation.n_clusters, 0)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Noise neighborhoods</div>
                <div className="metric-value">{formatNumber(evaluation.n_noise, 0)}</div>
                {nAssigned !== null && (
                  <div className="metric-hint">of {formatNumber(nAssigned, 0)} assigned</div>
                )}
              </div>
              <div className="metric">
                <div className="metric-label">Algorithm</div>
                <div className="metric-value">DBSCAN</div>
                <div className="metric-hint mono">
                  eps {formatNumber(evaluation.eps, 3)} · min_samples{' '}
                  {formatNumber(evaluation.min_samples, 0)}
                </div>
              </div>
            </div>
            <p className="wf-teaser-note">
              Segmentation on location, median $/sqft, and sales velocity — refit on this
              dataset&rsquo;s training rows. No cluster-quality score exists for this
              method; parameters come from the k-distance heuristic. Cluster cards,
              assignments, and the rationale live in stage 08.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => goToStage('08-evaluate')}
              >
                Inspect clusters in stage 08 →
              </button>
            </div>
          </div>
        )}

        {!loading && !error && !evaluation && (
          <EmptyState
            kicker="Sandbox clustering"
            title="No sandbox clustering yet"
            detail="Run the Clustering tab in stage 07 and this card shows your dataset's own micro-markets."
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

      <section className="section" aria-labelledby="wf-market-bridge-title">
        <div className="wf-bridge">
          <div className="wf-bridge-head">
            <span className="badge badge-accent">Champion</span>
            <h2 className="wf-bridge-title" id="wf-market-bridge-title">
              Neighbourhood Intelligence on /market
            </h2>
          </div>
          <p className="wf-bridge-copy">
            The market page is powered by the PropPulse champion artifacts — DBSCAN
            trained on the full bundled Ames train split — not by your sandbox jobs.
            What you&rsquo;ll find:
          </p>
          <div className="wf-find-grid">
            <div className="wf-find-card">
              <span className="wf-find-title">Micro-market map</span>
              <p className="wf-find-body">
                {nNeighborhoods !== null
                  ? `All ${nNeighborhoods} Ames neighborhoods`
                  : 'Every Ames neighborhood'}{' '}
                as approximate centroids on an interactive map, colored by micro-market.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">
                {nMicroMarkets !== null ? `${nMicroMarkets} micro-markets` : 'Micro-markets'}
              </span>
              <p className="wf-find-body">
                Cluster profiles with median price, $/sqft, and 30-day sale velocity per
                micro-market.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Half-year trends</span>
              <p className="wf-find-body">
                Median sale price and sales count per micro-market by half-year — gaps
                shown as gaps, never interpolated.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Sortable directory</span>
              <p className="wf-find-body">
                Every neighborhood&rsquo;s stats in a table you can sort by any column —
                the full non-map equivalent.
              </p>
            </div>
          </div>
          <p className="wf-bridge-note">
            Caveats, stated plainly: neighborhood centroids are approximate, and the
            trends cover the 2006–2008 training window — historical sales, not current
            listings.
          </p>
          <Link className="btn btn-primary wf-bridge-cta" to="/market">
            Open Neighbourhood Intelligence →
          </Link>
        </div>
      </section>
    </>
  )
}
