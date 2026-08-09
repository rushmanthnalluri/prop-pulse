/**
 * SandboxPredictPanel (WORKFLOW §6.3-09 sandbox half, §3.11) — score one
 * property with a model the user trained in this workbench: job + candidate
 * pickers (done jobs from `listJobs`, candidates are the job's `results`
 * entries with status "done"), the shared PropertyForm, and the result card.
 *
 * Honesty (§7, structural):
 * - the result always carries `ProvenanceBanner` with the API's verbatim
 *   sandbox label ("…not the PropPulse champion.") — sandbox predictions are
 *   never logged to the champion drift log server-side (§3.11);
 * - classification results carry `SimulatedBadge` + the API's simulated note,
 *   and the decision threshold shown is the job's own F1-optimal one;
 * - the regression range keeps the API's `interval_note` verbatim
 *   ("~80% range — validation residual quantiles").
 *
 * Gating: `canPredictSandbox === false` renders a designed locked state with
 * a stage-07 CTA (the shell normally gates first — this is the in-stage
 * guarantee that nothing dead-ends, §6.4). Note the server flag turns true
 * for ANY done job — including clustering-only — so an empty predictive
 * roster gets its own designed empty state naming the unblock action.
 *
 * Submit pipeline mirrors Valuation's (AUD-10): abort-supersede on a new run,
 * unmount abort, previous result kept dimmed while reloading, 422s map to
 * form fields via the form's `serverError` prop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { useToast } from '../Toast'
import { EmptyState, ErrorState, PanelSkeleton } from '../StateView'
import PropertyForm from '../shared/PropertyForm'
import { FORM_DEFAULTS } from '../valuation/formConfig'
import ProvenanceBanner from './ProvenanceBanner'
import SimulatedBadge from './SimulatedBadge'
import { useWorkflow } from '../../pages/workflow/WorkflowShell'
import { formatDateTime, formatPct, formatUsd } from '../../format'

/** Done jobs that can serve per-row predictions, with their done candidates. */
function predictiveRoster(jobs) {
  if (!Array.isArray(jobs)) return []
  return jobs
    .filter(
      (job) =>
        job?.status === 'done' &&
        (job.objective === 'regression' || job.objective === 'classification'),
    )
    .map((job) => ({
      job,
      candidates: Object.entries(job.results ?? {})
        .filter(([, result]) => result?.status === 'done')
        .map(([name]) => name)
        .sort(),
    }))
    .filter((entry) => entry.candidates.length > 0)
}

/** Regression result: estimate + residual interval + provenance (§3.11). */
function RegressionResult({ result }) {
  return (
    <>
      <span className="kicker">Sandbox estimate</span>
      <p className="wf-result-price">{formatUsd(result.estimated_price)}</p>
      <p className="wf-result-range mono">
        {formatUsd(result.price_range?.low)} – {formatUsd(result.price_range?.high)}
      </p>
      {result.interval_note && <p className="wf-result-note">{result.interval_note}</p>}
    </>
  )
}

/** Classification result: probability + F1 threshold + SIMULATED labeling. */
function ClassificationResult({ result }) {
  return (
    <>
      <span className="kicker">Sandbox sale likelihood</span>
      <p className="wf-result-price">{formatPct(result.probability)}</p>
      <p className="wf-result-verdict">
        {result.sells_within_30_days
          ? 'Predicted to sell within 30 days'
          : 'Not predicted to sell within 30 days'}
        {' — '}
        decision threshold {formatPct(result.threshold)}, the job&rsquo;s F1-optimal
        threshold on validation rows (never a default 0.5).
      </p>
      <p className="wf-result-note">
        <SimulatedBadge /> {result.note}
      </p>
    </>
  )
}

export default function SandboxPredictPanel() {
  const { datasetId, canPredictSandbox, goToStage } = useWorkflow()
  const toast = useToast()

  const fetchJobs = useCallback((signal) => wf.listJobs(datasetId, signal), [datasetId])
  const { data: jobs, loading, error, reload } = useApi(fetchJobs)

  const roster = useMemo(() => predictiveRoster(jobs), [jobs])

  const [selection, setSelection] = useState({ jobId: null, candidate: null })
  const [seed, setSeed] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState(null) // → PropertyForm (422 field map)
  const [submitError, setSubmitError] = useState(null) // → inline alert (non-422)
  const [result, setResult] = useState(null)
  const [lastPayload, setLastPayload] = useState(null) // for the error alert's retry
  const abortRef = useRef(null)

  // AUD-10: abort the in-flight prediction if the panel unmounts mid-request.
  useEffect(() => () => abortRef.current?.abort(), [])

  // A dataset switch drops every trace of the previous dataset's run.
  useEffect(() => {
    setResult(null)
    setServerError(null)
    setSubmitError(null)
    setSubmitting(false)
  }, [datasetId])

  // Keep the selection valid as the roster (re)loads; default to the newest
  // done job's first candidate (listJobs is newest-first).
  useEffect(() => {
    setSelection((prev) => {
      const entry = roster.find((item) => item.job.job_id === prev.jobId)
      if (entry) {
        return entry.candidates.includes(prev.candidate)
          ? prev
          : { jobId: prev.jobId, candidate: entry.candidates[0] }
      }
      const first = roster[0]
      return first
        ? { jobId: first.job.job_id, candidate: first.candidates[0] }
        : { jobId: null, candidate: null }
    })
  }, [roster])

  const selected = roster.find((item) => item.job.job_id === selection.jobId) ?? null
  const objective = selected?.job.objective ?? null

  const submit = (payload) => {
    if (!selection.jobId || !selection.candidate) return
    abortRef.current?.abort() // supersede any in-flight run
    const controller = new AbortController()
    abortRef.current = controller
    setLastPayload(payload)
    setSubmitting(true)
    setServerError(null)
    setSubmitError(null)
    wf.sandboxPredict(selection.jobId, selection.candidate, payload, controller.signal)
      .then((res) => {
        setResult(res)
        setSubmitting(false)
        toast.success(
          res.model?.objective === 'classification'
            ? 'Sandbox probability ready'
            : 'Sandbox estimate ready',
        )
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return // unmounted or superseded
        setSubmitting(false)
        if (err?.status === 422) {
          // Field-level mapping happens inside PropertyForm via serverError.
          setServerError(err)
          toast.error('The sandbox model rejected the payload', err?.message || undefined)
        } else {
          // 404/409: the job went away or is no longer done — refresh the roster.
          setSubmitError(err)
          if (err?.status === 404 || err?.status === 409) reload()
          toast.error('Sandbox prediction failed', err?.message || undefined)
        }
      })
  }

  const loadExample = () => setSeed({ values: { ...FORM_DEFAULTS } })
  const handleReset = () => {
    abortRef.current?.abort()
    setSeed({ values: { ...FORM_DEFAULTS } })
    setResult(null)
    setServerError(null)
    setSubmitError(null)
    setSubmitting(false)
  }

  /* --- Gates & load states (§6.4) ---------------------------------------- */

  if (canPredictSandbox === null) {
    return <PanelSkeleton height={240} /> // state unknown — never a false lock
  }
  if (canPredictSandbox === false) {
    return (
      <EmptyState
        kicker="Sandbox prediction"
        title="Sandbox predictions are locked"
        detail="Train at least one model in stage 07 — then come back here to score a property with your own model."
      >
        <button
          type="button"
          className="btn btn-primary btn-sm wf-locked-cta"
          onClick={() => goToStage('07-train')}
        >
          Go to stage 07 — Model Training
        </button>
      </EmptyState>
    )
  }
  if (loading) {
    return (
      <>
        <PanelSkeleton height={52} />
        <PanelSkeleton height={320} />
      </>
    )
  }
  if (error) {
    return (
      <ErrorState error={error} onRetry={reload} title="Couldn't load training jobs" />
    )
  }
  if (roster.length === 0) {
    return (
      <EmptyState
        kicker="Sandbox prediction"
        title="No trained model can serve predictions yet"
        detail="Only regression and classification candidates predict properties — clustering segments neighborhoods instead. Train a regression or classification model in stage 07."
      >
        <button
          type="button"
          className="btn btn-primary btn-sm wf-locked-cta"
          onClick={() => goToStage('07-train')}
        >
          Go to stage 07 — Model Training
        </button>
      </EmptyState>
    )
  }

  /* --- Pickers + form + result -------------------------------------------- */

  return (
    <div className="wf-sandbox">
      <div className="wf-picker-row">
        <div className="field">
          <label className="field-label" htmlFor="wf-sb-job">
            Trained job
          </label>
          <select
            id="wf-sb-job"
            className="select"
            value={selection.jobId ?? ''}
            disabled={submitting}
            onChange={(event) =>
              setSelection((prev) => ({ ...prev, jobId: event.target.value }))
            }
          >
            {roster.map(({ job, candidates }) => (
              <option key={job.job_id} value={job.job_id}>
                {`${job.job_id} · ${job.objective} · ${candidates.length} candidate${
                  candidates.length === 1 ? '' : 's'
                } · finished ${formatDateTime(job.finished_at)}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wf-sb-candidate">
            Candidate
          </label>
          <select
            id="wf-sb-candidate"
            className="select"
            value={selection.candidate ?? ''}
            disabled={submitting}
            onChange={(event) =>
              setSelection((prev) => ({ ...prev, candidate: event.target.value }))
            }
          >
            {(selected?.candidates ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {objective === 'classification' && (
        <p className="note wf-sandbox-simnote">
          <SimulatedBadge /> — this candidate scores a seeded days-on-market simulation
          (ADR-3), not an observed market outcome.
        </p>
      )}

      <div aria-live="polite">
        {submitError && (
          <ErrorState
            error={submitError}
            onRetry={lastPayload ? () => submit(lastPayload) : undefined}
            title="Sandbox prediction failed"
          />
        )}
        {result ? (
          <div
            className={`wf-result${submitting ? ' wf-dim' : ''}`}
            aria-busy={submitting}
          >
            {result.model?.objective === 'classification' ? (
              <ClassificationResult result={result} />
            ) : (
              <RegressionResult result={result} />
            )}
            {result.model && (
              <p className="wf-result-meta mono">
                {result.model.candidate} · {result.model.objective} · {result.model.job_id}
              </p>
            )}
            <ProvenanceBanner provenance={result.provenance} />
            {result.provenance?.stale_split && (
              <p className="note wf-stale-note" role="note">
                <span className="badge badge-warn">old split</span>{' '}
                {result.provenance.stale_note ??
                  'This model was trained on a previous preprocessing configuration — re-run preprocessing-aware training for current-split results.'}
              </p>
            )}
          </div>
        ) : (
          !submitting && (
            <div className="wf-result wf-result--empty">
              <span className="kicker">Latest sandbox result</span>
              <p className="wf-result-note">
                Submit the form to score this property with the selected sandbox model —
                the estimate lands here with its provenance.
              </p>
            </div>
          )
        )}
      </div>

      <PropertyForm
        onSubmit={submit}
        onReset={handleReset}
        onLoadExample={loadExample}
        submitting={submitting}
        serverError={serverError}
        seed={seed}
        submitLabel={
          objective === 'classification' ? 'Predict sale likelihood' : 'Predict with sandbox model'
        }
        busyLabel="Predicting…"
      />
    </div>
  )
}
