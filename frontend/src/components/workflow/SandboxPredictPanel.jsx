/**
 * SandboxPredictPanel (WORKFLOW §6.3-09 sandbox half, §3.11; blueprint
 * §8.10) — score one property with a model the user trained in this
 * workbench, laid out on the reference's `.predict-grid`: the form column
 * left (Model fieldset — training run + candidate selects, the first
 * candidate option reading "Best model — {name} (recommended)" — above the
 * shared PropertyForm), the sticky result aside right (`aria-live=polite`).
 *
 * The aside mirrors the reference's two states:
 * - idle: kicker "Awaiting input", verdict "—" in muted ink, and a guidance
 *   note naming the recommended best model;
 * - filled: `.result-panel` with the amber border for a value/positive call
 *   (danger for a negative one), kicker "Prediction · {model}" + a "Best
 *   model" badge, the 30px verdict (estimated price / 30-day-sale call), the
 *   8px animated `.result-track` probability bar (classification), the mono
 *   meta row, the `.result-facts` dl, and the banded hedged explanation
 *   (≥80 / 50–80 / 20–50 / ≤20 wording, adapted to sale probability; the
 *   regression analog bands the ~80% residual range).
 *
 * Honesty (§7, structural):
 * - the result always carries `ProvenanceBanner` with the API's verbatim
 *   sandbox label ("…not the PropPulse champion.") — sandbox predictions are
 *   never logged to the champion drift log server-side (§3.11);
 * - classification results carry `SimulatedBadge` + the API's simulated note,
 *   and the decision threshold shown is the job's own F1-optimal one;
 * - the regression range keeps the API's `interval_note` verbatim
 *   ("~80% range — validation residual quantiles"); the "best" candidate is
 *   the run's own validation leader (RMSLE / ROC-AUC), never a server-round
 *   trip away from the jobs payload.
 *
 * Gating: `canPredictSandbox === false` renders a designed locked state with
 * a stage-07 CTA (the shell normally gates first — this is the in-stage
 * guarantee that nothing dead-ends, §6.4). Note the server flag turns true
 * for ANY done job — including clustering-only — so an empty predictive
 * roster gets its own designed empty state naming the unblock action.
 *
 * Submit pipeline mirrors Valuation's (AUD-10): abort-supersede on a new run,
 * unmount abort, previous result kept dimmed while reloading, 422s map to
 * form fields via the form's `serverError` prop (the form renders them as one
 * alert line per error); non-422 failures render above the grid with retry.
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
import { formatDateTime, formatMetric, formatNumber, formatPct, formatUsd } from '../../format'

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

const finiteNumber = (value) => Number.isFinite(Number(value))

/**
 * The run's own validation leader — regression minimizes RMSLE, classification
 * maximizes ROC-AUC (the stage-07 selection rule's headline metrics). Falls
 * back to the first done candidate when metrics are absent.
 */
function jobBest(job) {
  const done = Object.entries(job?.results ?? {}).filter(([, r]) => r?.status === 'done')
  if (done.length === 0) return null
  if (job.objective === 'regression') {
    const scored = done.filter(([, r]) => finiteNumber(r?.val_metrics?.rmsle))
    if (scored.length > 0) {
      return scored.reduce((a, b) =>
        Number(a[1].val_metrics.rmsle) <= Number(b[1].val_metrics.rmsle) ? a : b,
      )[0]
    }
  }
  if (job.objective === 'classification') {
    const scored = done.filter(([, r]) => finiteNumber(r?.val_metrics?.roc_auc))
    if (scored.length > 0) {
      return scored.reduce((a, b) =>
        Number(a[1].val_metrics.roc_auc) >= Number(b[1].val_metrics.roc_auc) ? a : b,
      )[0]
    }
  }
  return done[0][0]
}

/** Reference option language: "Best model — X (recommended)", else "X · METRIC v". */
function candidateOptionLabel(job, name, isBest) {
  if (isBest) return `Best model — ${name} (recommended)`
  const metrics = job?.results?.[name]?.val_metrics ?? {}
  if (job?.objective === 'regression' && finiteNumber(metrics.rmsle)) {
    return `${name} · RMSLE ${formatMetric(metrics.rmsle, 4)}`
  }
  if (job?.objective === 'classification' && finiteNumber(metrics.roc_auc)) {
    return `${name} · ROC-AUC ${formatMetric(metrics.roc_auc, 4)}`
  }
  return name
}

/**
 * The hedged one-liner under a regression verdict — banded by the ~80%
 * residual half-width (all inputs from the API payload), the API's
 * interval_note verbatim, then the sandbox caveat.
 */
function regressionExplanation(halfPct, intervalNote) {
  let band
  if (halfPct === null) {
    band = 'The range above brackets this estimate from validation residuals.'
  } else if (halfPct <= 10) {
    band = `Comparable validation predictions landed within roughly ±${formatNumber(halfPct, 0)}% of the estimate — a tight band for this model.`
  } else if (halfPct <= 20) {
    band = `Comparable validation predictions landed within roughly ±${formatNumber(halfPct, 0)}% of the estimate — a moderate band.`
  } else {
    band = `Comparable validation predictions landed only within roughly ±${formatNumber(halfPct, 0)}% of the estimate — a wide band, so treat the range rather than the point.`
  }
  const tail =
    'A validation-calibrated estimate from a sandbox model — not an appraisal, and never the PropPulse champion.'
  // The API's interval_note arrives period-less; terminate it before the
  // caveat so the two don't run on. Guard against a note that already ends
  // with punctuation.
  const noteText = intervalNote ? intervalNote.trim() : ''
  const note = noteText ? `${noteText}${/[.!?]$/.test(noteText) ? '' : '.'} ` : ''
  return `${band} ${note}${tail}`
}

/**
 * The hedged one-liner under a classification verdict — the reference's
 * ≥80 / 50–80 / 20–50 / ≤20 bands, adapted to the 30-day sale call.
 */
function classificationExplanation(p, threshold, candidate, rocAuc) {
  const name = candidate ?? 'this model'
  let tone
  if (finiteNumber(p) && p >= 0.5) {
    tone =
      p >= 0.8
        ? 'predicts a high likelihood of selling within 30 days'
        : 'leans toward a sale within 30 days, though the margin is modest'
  } else {
    tone =
      finiteNumber(p) && p <= 0.2
        ? 'predicts a low likelihood of selling within 30 days'
        : 'leans against a sale within 30 days, though the margin is modest'
  }
  const auc = finiteNumber(rocAuc) ? ` (validation ROC-AUC ${formatMetric(rocAuc, 4)})` : ''
  const t = finiteNumber(threshold) ? formatPct(threshold, 0) : '50%'
  return (
    `The model ${tone} based on the provided features. This is a statistical estimate ` +
    `from ${name}${auc} against a simulated target, not a guarantee — probabilities near ` +
    `the ${t} threshold are genuinely uncertain calls.`
  )
}

/** Idle aside (blueprint §8.10): kicker, muted em-dash verdict, guidance. */
function IdleResult({ bestName, objective }) {
  const isClassification = objective === 'classification'
  return (
    <div className="result-panel">
      <span className="result-kicker">Awaiting input</span>
      <span className="result-verdict result-verdict-idle">—</span>
      <p className="note note-flush">
        Fill the property profile on the left and the{' '}
        {isClassification ? 'sale call' : 'estimate'} appears here, with its{' '}
        {isClassification ? 'probability' : '~80% range'}. Pick a specific model, or leave the
        dropdown on the recommended best — {bestName ?? 'the run leader'}.
      </p>
    </div>
  )
}

/** Stale-split note shared by both filled variants (red-team F1). */
function StaleSplitNote({ provenance }) {
  if (!provenance?.stale_split) return null
  return (
    <p className="note" role="note">
      <span className="badge badge-warn">old split</span>{' '}
      {provenance.stale_note ??
        'This model was trained on a previous preprocessing configuration — re-run preprocessing-aware training for current-split results.'}
    </p>
  )
}

/** Regression result: 30px price verdict + ~80% range + provenance (§3.11). */
function RegressionResult({ result, bestName, valMetrics, busy }) {
  const estimate = Number(result.estimated_price)
  const low = Number(result.price_range?.low)
  const high = Number(result.price_range?.high)
  const halfPct =
    finiteNumber(estimate) && estimate > 0 && finiteNumber(low) && finiteNumber(high)
      ? (((high - low) / 2 / estimate) * 100)
      : null
  const isBest = result.model?.candidate != null && result.model.candidate === bestName

  return (
    <div
      className={`result-panel result-placed${busy ? ' result-panel--busy' : ''}`}
      aria-busy={busy || undefined}
    >
      <div className="result-kicker-row">
        <span className="result-kicker">Prediction · {result.model?.candidate}</span>
        {isBest && <span className="badge badge-accent">Best model</span>}
      </div>
      <span className="result-verdict wf-result-price">{formatUsd(result.estimated_price)}</span>
      <div className="result-meta">
        <span className="mono wf-result-range">
          {formatUsd(result.price_range?.low)} – {formatUsd(result.price_range?.high)}
        </span>
        <span className="mono dim">~80% range</span>
      </div>
      <dl className="result-facts">
        <div className="result-fact">
          <dt>Model used</dt>
          <dd>{result.model?.candidate ?? '—'}</dd>
        </div>
        <div className="result-fact">
          <dt>~80% range</dt>
          <dd>
            {formatUsd(result.price_range?.low)} – {formatUsd(result.price_range?.high)}
          </dd>
        </div>
        {finiteNumber(valMetrics?.rmsle) && (
          <div className="result-fact">
            <dt>Validation RMSLE</dt>
            <dd>{formatMetric(valMetrics.rmsle, 4)}</dd>
          </div>
        )}
      </dl>
      <p className="note note-flush">{regressionExplanation(halfPct, result.interval_note)}</p>
      {result.model && (
        <p className="wf-result-meta mono">
          {result.model.candidate} · {result.model.objective} · {result.model.job_id}
        </p>
      )}
      <ProvenanceBanner provenance={result.provenance} />
      <StaleSplitNote provenance={result.provenance} />
    </div>
  )
}

/** Classification result: 30px call + probability track + SIMULATED labeling. */
function ClassificationResult({ result, bestName, valMetrics, busy }) {
  const p = Number(result.probability)
  const threshold = Number(result.threshold)
  const positive = result.sells_within_30_days === true
  const pctText = formatPct(result.probability, 1)
  const isBest = result.model?.candidate != null && result.model.candidate === bestName

  return (
    <div
      className={`result-panel ${positive ? 'result-placed' : 'result-not'}${busy ? ' result-panel--busy' : ''}`}
      aria-busy={busy || undefined}
    >
      <div className="result-kicker-row">
        <span className="result-kicker">Prediction · {result.model?.candidate}</span>
        {isBest && <span className="badge badge-accent">Best model</span>}
      </div>
      <span className="result-verdict">
        {positive ? 'Sells in 30 days' : 'No 30-day sale'}
      </span>
      {finiteNumber(p) && (
        <div
          className="result-track"
          role="img"
          aria-label={`Sale probability ${pctText}`}
        >
          <div
            className="result-fill"
            style={{ width: `${Math.min(100, Math.max(0, p * 100))}%` }}
          />
        </div>
      )}
      <div className="result-meta">
        <span className="mono">{pctText} probability</span>
        <span className="mono dim">threshold {formatPct(result.threshold, 0)}</span>
      </div>
      <dl className="result-facts">
        <div className="result-fact">
          <dt>Model used</dt>
          <dd>{result.model?.candidate ?? '—'}</dd>
        </div>
        <div className="result-fact">
          <dt>Sale probability</dt>
          <dd>{pctText}</dd>
        </div>
        {finiteNumber(valMetrics?.roc_auc) && (
          <div className="result-fact">
            <dt>Validation ROC-AUC</dt>
            <dd>{formatMetric(valMetrics.roc_auc, 4)}</dd>
          </div>
        )}
      </dl>
      <p className="note note-flush">
        {classificationExplanation(p, threshold, result.model?.candidate, valMetrics?.roc_auc)}
      </p>
      <p className="note note-flush">
        <SimulatedBadge /> {result.note}
      </p>
      {result.model && (
        <p className="wf-result-meta mono">
          {result.model.candidate} · {result.model.objective} · {result.model.job_id}
        </p>
      )}
      <ProvenanceBanner provenance={result.provenance} />
      <StaleSplitNote provenance={result.provenance} />
    </div>
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
  // done job's validation leader (listJobs is newest-first).
  useEffect(() => {
    setSelection((prev) => {
      const entry = roster.find((item) => item.job.job_id === prev.jobId)
      if (entry) {
        return entry.candidates.includes(prev.candidate)
          ? prev
          : { jobId: prev.jobId, candidate: jobBest(entry.job) ?? entry.candidates[0] }
      }
      const first = roster[0]
      return first
        ? { jobId: first.job.job_id, candidate: jobBest(first.job) ?? first.candidates[0] }
        : { jobId: null, candidate: null }
    })
  }, [roster])

  const selected = roster.find((item) => item.job.job_id === selection.jobId) ?? null
  const objective = selected?.job.objective ?? null
  const bestName = selected ? jobBest(selected.job) : null
  // Recommended best first, then the rest of the run's candidates.
  const candidateOrder = useMemo(() => {
    const names = selected?.candidates ?? []
    if (!bestName || !names.includes(bestName)) return names
    return [bestName, ...names.filter((name) => name !== bestName)]
  }, [selected, bestName])

  // The result's own provenance lookups — resolved against the job that served
  // it, so a mid-flight selection change never mislabels a previous result.
  const resultJob =
    result?.model?.job_id != null
      ? (roster.find((item) => item.job.job_id === result.model.job_id)?.job ?? null)
      : null
  const resultBest = resultJob ? jobBest(resultJob) : null
  const resultMetrics =
    result?.model?.candidate != null
      ? (resultJob?.results?.[result.model.candidate]?.val_metrics ?? null)
      : null

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

  /* --- Model fieldset + form + sticky result aside (blueprint §8.10) ------- */

  return (
    <>
      {submitError && (
        <div className="mb-20">
          <ErrorState
            error={submitError}
            onRetry={lastPayload ? () => submit(lastPayload) : undefined}
            title="Sandbox prediction failed"
          />
        </div>
      )}
      <div className="predict-grid">
        <div className="predict-main">
          {objective === 'classification' && (
            <p className="note predict-sim-lead">
              <SimulatedBadge /> — this candidate scores a seeded days-on-market
              simulation, not an observed market outcome.
            </p>
          )}
          <fieldset className="predict-fieldset">
            <legend>Model</legend>
            <div className="predict-fields">
              <div className="field">
                <label className="field-label" htmlFor="wf-sb-job">
                  Training run
                </label>
                <select
                  id="wf-sb-job"
                  className="select"
                  value={selection.jobId ?? ''}
                  disabled={submitting}
                  onChange={(event) => {
                    const jobId = event.target.value
                    const entry = roster.find((item) => item.job.job_id === jobId)
                    setSelection({
                      jobId,
                      candidate: entry ? (jobBest(entry.job) ?? entry.candidates[0]) : null,
                    })
                  }}
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
                  Model
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
                  {candidateOrder.map((name) => (
                    <option key={name} value={name}>
                      {candidateOptionLabel(selected?.job, name, name === bestName)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span className="field-hint predict-model-hint">
              Best model = best validation{' '}
              {objective === 'classification' ? 'ROC-AUC' : 'RMSLE'} of the selected run —
              currently {bestName ?? '—'}.
            </span>
          </fieldset>

          <PropertyForm
            onSubmit={submit}
            onReset={handleReset}
            onLoadExample={loadExample}
            submitting={submitting}
            serverError={serverError}
            seed={seed}
            submitLabel={
              objective === 'classification'
                ? 'Predict sale likelihood'
                : 'Predict with sandbox model'
            }
            busyLabel="Predicting…"
          />
          <p className="note mt-10">
            Blank advanced inputs fall back to the model&rsquo;s training-data defaults.
          </p>
        </div>

        <aside className="predict-result" aria-live="polite">
          {result ? (
            result.model?.objective === 'classification' ? (
              <ClassificationResult
                result={result}
                bestName={resultBest}
                valMetrics={resultMetrics}
                busy={submitting}
              />
            ) : (
              <RegressionResult
                result={result}
                bestName={resultBest}
                valMetrics={resultMetrics}
                busy={submitting}
              />
            )
          ) : (
            <IdleResult bestName={bestName} objective={objective} />
          )}
        </aside>
      </div>
    </>
  )
}
