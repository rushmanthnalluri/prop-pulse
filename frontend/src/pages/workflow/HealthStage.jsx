/**
 * Stage 12 — Model Health (WORKFLOW §6.3-12). Two honest halves:
 *
 * - SANDBOX PANEL: per-dataset job facts from the workflow state endpoint
 *   (jobs total / done / running / failed — the same server truth that drives
 *   the stepper) plus the §7 honesty note: sandbox models are NOT monitored —
 *   drift and traffic monitoring cover the champion only.
 * - BRIDGE: what the champion /health page shows (liveness, per-process
 *   traffic metrics, drift snapshots) + the CTA. Bridge copy describes what
 *   the page reports — never an asserted current drift value (that number
 *   must come from the live /metrics payload on /health itself).
 */
import { Link } from 'react-router'
import { formatNumber } from '../../format'
import { ErrorState, PanelSkeleton } from '../../components/StateView'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-bridge.css'

export default function HealthStage() {
  const { dataset, datasetId, state, stateLoading, stateError, reloadState } = useWorkflow()

  const jobs = state?.jobs ?? null

  return (
    <>
      <header className="page-head">
        <span className="kicker">Stage 12 · Model Health</span>
        <h1 className="page-title">Health: sandbox facts, champion monitoring</h1>
        <p className="page-desc">
          The workbench keeps honest counts of what you trained; the live monitoring —
          liveness, traffic, and drift — watches the PropPulse champion and lives on the
          Model Health page.
        </p>
      </header>

      <section className="section" aria-labelledby="wf-sb-health-title">
        <div className="section-head">
          <h2 className="section-title" id="wf-sb-health-title">
            Your models — sandbox workbench facts
          </h2>
          <span className="section-note">GET /workflow/datasets/…/state</span>
        </div>

        {stateLoading && <PanelSkeleton height={120} />}

        {!stateLoading && stateError && (
          <ErrorState
            error={stateError}
            onRetry={reloadState}
            title="Couldn't load workflow state"
          />
        )}

        {!stateLoading && !stateError && jobs && (
          <div className="wf-teaser">
            <div className="wf-teaser-head">
              <span className="badge badge-warn">Sandbox</span>
              <h3 className="wf-teaser-title">
                Training activity on {dataset?.name ?? datasetId}
              </h3>
            </div>
            <div className="metrics metrics--auto">
              <div className="metric">
                <div className="metric-label">Jobs run</div>
                <div className="metric-value">{formatNumber(jobs.total, 0)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Completed</div>
                <div className="metric-value">{formatNumber(jobs.done, 0)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Running</div>
                <div className="metric-value">{formatNumber(jobs.running, 0)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Failed</div>
                <div
                  className={`metric-value${jobs.failed > 0 ? ' metric-value--bad' : ''}`}
                >
                  {formatNumber(jobs.failed, 0)}
                </div>
              </div>
            </div>
            <p className="wf-teaser-note">
              Sandbox models are not monitored — no drift or traffic tracking covers
              them, and they are never promoted to champion. The counts above are the
              whole health story for the workbench; live monitoring below is the
              champion&rsquo;s.
            </p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="wf-health-bridge-title">
        <div className="wf-bridge">
          <div className="wf-bridge-head">
            <span className="badge badge-accent">Champion</span>
            <h2 className="wf-bridge-title" id="wf-health-bridge-title">
              Model Health on /health
            </h2>
          </div>
          <p className="wf-bridge-copy">
            The health page monitors the production champion services — live, per this
            server process. What you&rsquo;ll find:
          </p>
          <div className="wf-find-grid">
            <div className="wf-find-card">
              <span className="wf-find-title">Liveness</span>
              <p className="wf-find-body">
                Service status and whether the champion regression and classification
                models are loaded.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Live traffic</span>
              <p className="wf-find-body">
                Per-process request and error counts, average latency, and uptime —
                counters reset on every restart, labelled as such.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Feature drift</span>
              <p className="wf-find-body">
                Per-feature distribution shift of served predictions against the
                champion&rsquo;s training reference.
              </p>
            </div>
            <div className="wf-find-card">
              <span className="wf-find-title">Prediction drift</span>
              <p className="wf-find-body">
                Drift on the prediction stream itself, reported with its real status —
                including an honest &ldquo;no data yet&rdquo; when the reference window
                is empty.
              </p>
            </div>
          </div>
          <p className="wf-bridge-note">
            Note: sandbox predictions never enter the prediction log that feeds drift
            monitoring — mixing the two populations would corrupt the champion&rsquo;s
            reference.
          </p>
          <Link className="btn btn-primary wf-bridge-cta" to="/health">
            Open Model Health →
          </Link>
        </div>
      </section>
    </>
  )
}
