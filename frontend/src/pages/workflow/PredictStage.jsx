/**
 * Stage 09 — Predict Property (WORKFLOW §6.3-09). Two faces, side by side
 * and labelled, separated by a hairline:
 *
 * - MAIN: the sandbox prediction panel (SandboxPredictPanel) — the user's own
 *   trained model, real but workbench-only, every result provenance-labelled.
 * - ASIDE: the bridge card to the champion Valuation page — the product's
 *   real prediction UI stays on /valuation (§1: the workflow never gates or
 *   replaces it). The champion meta line (name, test RMSLE, range coverage)
 *   comes from the session-cached /model/info — additive only: omitted when
 *   the fetch fails, never hardcoded (§6.3-09 right panel).
 *
 * Gating note: the shell locks stage 09 until `can_predict_sandbox`; the
 * panel repeats the lock internally so the sandbox half never renders
 * unlabelled or dead-ends (§6.4). The champion half is always available.
 */
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { formatMetric, formatPct } from '../../format'
import SandboxPredictPanel from '../../components/workflow/SandboxPredictPanel'
import '../../styles/workflow-bridge.css'

export default function PredictStage() {
  const fetchModelInfo = useCallback((signal) => api.modelInfo(signal), [])
  const { data: modelInfo } = useApi(fetchModelInfo)

  const championMeta = useMemo(() => {
    if (!modelInfo) return []
    const parts = []
    const champion = [modelInfo.regression?.name, modelInfo.regression?.version]
      .filter(Boolean)
      .join('_')
    if (champion) parts.push(`Champion ${champion}`)
    const rmsle = Number(modelInfo.regression?.test_metrics?.rmsle)
    if (Number.isFinite(rmsle)) parts.push(`test RMSLE ${formatMetric(rmsle, 4)}`)
    const coverage = Number(modelInfo.regression?.test_metrics?.interval_coverage)
    if (Number.isFinite(coverage)) parts.push(`range coverage ${formatPct(coverage)}`)
    return parts
  }, [modelInfo])

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 09 · Predict Property</span>
        <h1 className="page-title">Predict a property</h1>
        <p className="page-desc">
          Two kinds of prediction, side by side and labelled: score a home with a model
          you trained in this workbench, or open the product&rsquo;s champion valuation
          experience. Sandbox models never feed the champion pages.
        </p>
      </header>

      <div className="section wf-duo">
        <section className="wf-duo-main" aria-labelledby="wf-sandbox-title">
          <div className="section-head">
            <h2 className="section-title" id="wf-sandbox-title">
              Your model — sandbox prediction
            </h2>
            <span className="section-note">POST /workflow/jobs/…/predict/…</span>
          </div>
          <p className="note wf-sandbox-lead">
            Served by a model you trained on the active dataset in stage 07 — real
            predictions, workbench-only, never the PropPulse champion.
          </p>
          <SandboxPredictPanel />
        </section>

        <aside className="wf-duo-aside" aria-labelledby="wf-champion-title">
          <div className="wf-bridge">
            <div className="wf-bridge-head">
              <span className="badge badge-accent">Champion</span>
              <h2 className="wf-bridge-title" id="wf-champion-title">
                The full valuation experience
              </h2>
            </div>
            <p className="wf-bridge-copy">
              The product&rsquo;s real prediction UI lives on the Valuation page, powered
              by the PropPulse champion models — SHAP-explained, comps-backed, and
              drift-monitored. What it adds over the sandbox panel:
            </p>
            <ul className="wf-bridge-list">
              <li>
                <strong>SHAP price factors</strong> — what pushed this specific estimate
                up or down.
              </li>
              <li>
                <strong>Comparable sales</strong> — the five most similar 2006–2008
                training sales.
              </li>
              <li>
                <strong>What-if scenarios</strong> — adjust quality, size, or garage and
                re-estimate live.
              </li>
            </ul>
            {championMeta.length > 0 && (
              <p className="wf-bridge-meta mono">{championMeta.join(' · ')}</p>
            )}
            <Link className="btn btn-primary wf-bridge-cta" to="/valuation">
              Open the Valuation page →
            </Link>
          </div>
        </aside>
      </div>
    </>
  )
}
