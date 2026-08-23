/**
 * PreprocessStage — stage 06 of the guided workbench (WORKFLOW §6.3-06),
 * presented after the reference's /preprocess (blueprint §8.7).
 *
 * Runs the real leakage-safe prepare chain via POST …/preprocess/preview
 * (synchronous, ~5 s at the row cap; the run also persists — stage 07 trains
 * on exactly what was previewed). From the persisted/returned PrepareReport
 * only: "The split" metric strip (train/val/sealed-test rows + the simulated
 * sale-speed rate), the pipeline flow built from the real steps[] (Raw → 7
 * real steps → model-ready frame) with per-node status, the per-step
 * accordion with every real number, and the leakage guarantee verbatim. The
 * "Feature set" table is the reference's sticky registry adapted to the real
 * API: the feature inventory comes from GET …/features (the report carries
 * no per-feature train means/stds — the mean column is the honest raw-frame
 * mean, labelled as such). The sale-speed target carries the SimulatedBadge
 * (provider "simulated", ADR-3). A successful run calls reloadState() — the
 * stepper's stage-07/08 gating reads that server truth.
 *
 * e2e pins (e2e/tests/workflow.spec.js, frozen): the "Run preprocessing"
 * button label; split metric labels matching Train/Validation/Test with
 * .metric-value; exactly 9 .wf-flow-node (2 caps + 7 steps) with the
 * SimulatedBadge inside the "Sale-speed target" node; 7 .wf-steps .wf-step;
 * .wf-leakage p with the verbatim note.
 *
 * States (UX §7 / WORKFLOW §6.4): section skeleton on first load, inline
 * error + retry, empty state before the first run, BusyButton while running
 * (previous results stay on screen, dimmed), 400 row-window → inline alert
 * linking back to stage 01.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useWorkflow } from './WorkflowShell'
import * as wf from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { useToast } from '../../components/Toast'
import BusyButton from '../../components/shared/BusyButton'
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import PreprocessConfig, { fractionsValid } from '../../components/workflow/PreprocessConfig'
import BeforeAfterPanel from '../../components/workflow/BeforeAfterPanel'
import SimulatedBadge from '../../components/workflow/SimulatedBadge'
import { formatDateTime, formatNumber, formatPct } from '../../format'
import { SPLIT_CONTRACT } from '../../constants'
import '../../styles/workflow-train.css'
import '../../styles/workflow-preprocess.css'

const DEFAULT_CONFIG = {
  outlier_rule: true,
  split_strategy: 'auto',
  val_frac: 0.15,
  test_frac: 0.15,
  seed: 42,
}

/** Display labels for the real PrepareReport steps (order comes from steps[]). */
const STEP_LABELS = {
  split: 'Split',
  outlier_rule: 'Outlier handling',
  clean: 'Missing treatment',
  sale_speed_target: 'Sale-speed target',
  geo_join: 'Geo join',
  sandbox_stats: 'Train-fit statistics',
  features: 'Feature engineering',
}

/** One-line key fact for the pipeline-flow node of a step. */
function stepFact(step) {
  switch (step?.step) {
    case 'split':
      return `${formatNumber(step.train, 0)} / ${formatNumber(step.val, 0)} / ${formatNumber(step.test, 0)}`
    case 'outlier_rule':
      return step.enabled ? `${formatNumber(step.rows_removed, 0)} removed` : 'disabled'
    case 'clean':
      return `${formatNumber(step.total_na_filled, 0)} filled`
    case 'sale_speed_target':
      return `${formatPct(step.positive_rate_train, 1)} positive (train)`
    case 'geo_join':
      return `${formatNumber(step.neighborhoods_mapped, 0)} neighborhoods`
    case 'sandbox_stats':
      return `${formatNumber(step.n_neighborhoods, 0)} neighborhoods · ${formatNumber(step.n_feature_defaults, 0)} defaults`
    case 'features':
      return `${formatNumber(step.columns_before, 0)} → ${formatNumber(step.columns_after, 0)} columns`
    default:
      return null
  }
}

/** A step that ran but applied no work reads as "skipped", not "done". */
function stepStatus(step) {
  if (step?.step === 'outlier_rule' && step.enabled === false) return 'skipped'
  return 'done'
}

/** Generic honest renderer for a step's fields — every real number shown. */
function StepFields({ step }) {
  const entries = Object.entries(step ?? {}).filter(([key]) => key !== 'step')
  return (
    <dl className="wf-step-fields">
      {entries.map(([key, value]) => {
        const label = key.replaceAll('_', ' ')
        let body
        if (key === 'provider' && value === 'simulated') {
          body = <SimulatedBadge />
        } else if (key === 'simulated') {
          body = value ? 'yes — simulated' : 'no'
        } else if (Array.isArray(value)) {
          body =
            value.length === 0
              ? 'none'
              : `${value.length} ids: ${value.slice(0, 10).join(', ')}${value.length > 10 ? ', …' : ''}`
        } else if (value !== null && typeof value === 'object') {
          const pairs = Object.entries(value)
          body = (
            <span className="wf-chip-list">
              {pairs.slice(0, 8).map(([col, n]) => (
                <span className="wf-mini-chip" key={col}>
                  {col} <span className="mono">{formatNumber(n, 0)}</span>
                </span>
              ))}
              {pairs.length > 8 && (
                <span className="wf-mini-chip">+{pairs.length - 8} more</span>
              )}
            </span>
          )
        } else if (typeof value === 'number') {
          body = (
            <span className="mono">
              {key.startsWith('positive_rate') ? formatPct(value, 1) : formatNumber(value, 0)}
            </span>
          )
        } else {
          body = String(value)
        }
        return (
          <div className="wf-step-field" key={key}>
            <dt>{label}</dt>
            <dd>{body}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/** Node status line — mono microcopy + a status dot (accent = done/persisted). */
function NodeStatus({ status }) {
  const muted = status === 'skipped' || status === 'source'
  return (
    <span className="wfpp-node-status">
      <span
        className={`wfpp-node-dot${muted ? ' wfpp-node-dot--muted' : ''}`}
        aria-hidden="true"
      />
      {status}
    </span>
  )
}

/**
 * The reference's "Feature set" registry (§8.7) adapted to the real API.
 * The PrepareReport carries no per-feature imputed means / train stds, so
 * the table shows what the API actually exposes: the raw-frame mean and
 * missing count per raw input (GET …/features), the pipeline's transform per
 * role, and the two targets role-tagged amber (the simulated classification
 * target badged, ADR-3).
 */
function FeatureSet({ features, loading, error, onRetry }) {
  const rawInputs = (features?.raw_features ?? []).filter((f) => f.role === 'raw_input')
  const pipeline = features?.pipeline_features ?? []
  const targets = features?.targets ?? {}
  const salePrice = (features?.raw_features ?? []).find(
    (f) => f.name === targets?.regression?.column,
  )

  if (loading && !features) return <PanelSkeleton height={220} />
  if (error && !features) {
    return (
      <ErrorState error={error} onRetry={onRetry} title="Couldn't load the feature inventory" />
    )
  }
  if (!features) return null

  const transformFor = (role) =>
    role === 'engineered'
      ? 'derived in pipeline'
      : role === 'neighborhood_stat'
        ? 'train-fit stats join'
        : 'default fill → passthrough'

  return (
    <>
      <div className="table-scroll scroll-60">
        <table className="table table-sticky">
          <thead>
            <tr>
              <th scope="col">Feature</th>
              <th scope="col" className="num">
                Dataset mean
              </th>
              <th scope="col" className="num">
                Missing
              </th>
              <th scope="col">Transform</th>
            </tr>
          </thead>
          <tbody>
            {rawInputs.map((f) => (
              <tr key={f.name}>
                <td className="mono strong">{f.name}</td>
                <td className="num accent">
                  {f.dtype === 'numeric' && f.mean != null ? formatNumber(f.mean, 2) : '—'}
                </td>
                <td className={`num${f.n_missing > 0 ? ' text-danger' : ' dim'}`}>
                  {formatNumber(f.n_missing, 0)}
                </td>
                <td className="dim">{transformFor(f.role)}</td>
              </tr>
            ))}
            {pipeline.map((f) => (
              <tr key={f.name}>
                <td className="mono strong">{f.name}</td>
                <td className="num dim">—</td>
                <td className="num dim">—</td>
                <td className="dim">{transformFor(f.role)}</td>
              </tr>
            ))}
            {targets?.regression?.column && (
              <tr>
                <td className="mono strong">{targets.regression.column}</td>
                <td className="num accent">
                  {salePrice?.mean != null ? formatNumber(salePrice.mean, 2) : '—'}
                </td>
                <td className="num dim">{formatNumber(salePrice?.n_missing ?? 0, 0)}</td>
                <td>
                  <span className="role-tag role-target">target · regression</span>{' '}
                  <span className="dim">log-transformed</span>
                </td>
              </tr>
            )}
            {targets?.classification?.column && (
              <tr>
                <td className="mono strong">
                  {targets.classification.column} <SimulatedBadge />
                </td>
                <td className="num dim">—</td>
                <td className="num dim">—</td>
                <td>
                  <span className="role-tag role-target">target · classification</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note mt-10">
        Means and missing counts describe the raw dataset. The transforms themselves — default
        fills, neighborhood statistics — are fit on the training split only, then frozen:
        validation and test rows never influence them.
      </p>
    </>
  )
}

export default function PreprocessStage() {
  const { datasetId, dataset, reloadState, canTrain, trainBlockedReason } = useWorkflow()
  const toast = useToast()

  const fetcher = useCallback((signal) => wf.getPreprocess(datasetId, signal), [datasetId])
  const { data, loading, error, reload } = useApi(fetcher)

  const featuresFetcher = useCallback((signal) => wf.getFeatures(datasetId, signal), [datasetId])
  const {
    data: features,
    loading: featuresLoading,
    error: featuresError,
    reload: reloadFeatures,
  } = useApi(featuresFetcher)

  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [report, setReport] = useState(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)

  // Hydrate from the persisted state: the last report + its config. A stale
  // payload for another dataset (mid-refetch after a switch) is ignored.
  useEffect(() => {
    if (!data) return
    if (data.summary && data.summary.dataset_id === datasetId) {
      setReport(data.summary)
      setConfig({ ...DEFAULT_CONFIG, ...(data.summary.config ?? {}) })
    } else if (!data.summary) {
      setReport(null)
      setConfig(DEFAULT_CONFIG)
    }
  }, [data, datasetId])

  // Never show another dataset's report after a dataset switch.
  const currentReport = report && report.dataset_id === datasetId ? report : null

  const run = async () => {
    setRunError(null)
    setRunning(true)
    try {
      const result = await wf.previewPreprocess(datasetId, config)
      setReport(result)
      toast.success(
        'Preprocessing complete',
        `splits ${formatNumber(result.splits?.train, 0)} / ${formatNumber(result.splits?.val, 0)} / ${formatNumber(result.splits?.test, 0)} — stage 07 is ready`,
      )
      reloadState() // stepper gating reads the server truth (§6.2)
      reload() // refresh the persisted fingerprint/summary
    } catch (err) {
      if (err?.name !== 'AbortError') setRunError(err)
    } finally {
      setRunning(false)
    }
  }

  const steps = useMemo(
    () => (Array.isArray(currentReport?.steps) ? currentReport.steps : []),
    [currentReport],
  )
  // The simulated sale-speed step carries the split rates (ADR-3 honesty).
  const rateStep = useMemo(
    () => steps.find((step) => step?.step === 'sale_speed_target') ?? null,
    [steps],
  )

  const fingerprint = currentReport?.fingerprint ?? data?.fingerprint ?? null
  const metaBits = [
    dataset ? `${dataset.name} · ${formatNumber(dataset.n_rows, 0)} rows` : null,
    fingerprint ? `fingerprint ${String(fingerprint).slice(0, 12)}` : null,
    currentReport?.prepared_at ? `prepared ${formatDateTime(currentReport.prepared_at)}` : null,
  ].filter(Boolean)

  if (loading && !data) {
    return (
      <>
        <div className="page-head">
          <span className="kicker">Stage 06 · Preparation</span>
          <h1 className="page-title">Preprocessing</h1>
        </div>
        <div className="section">
          <PanelSkeleton height={220} />
        </div>
      </>
    )
  }

  if (error && !data) {
    return (
      <div className="section">
        <ErrorState error={error} onRetry={reload} title="Couldn't load the preprocessing state" />
      </div>
    )
  }

  return (
    <>
      <div className="page-head">
        <span className="kicker">Stage 06 · Preparation</span>
        <h1 className="page-title">Preprocessing</h1>
        <p className="page-desc">
          The same chain the offline pipeline runs — split, outlier rule, missing-value
          policies, the simulated sale-speed target, geo join, and train-fit statistics —
          previewed here and persisted for training. Stage 07 fits on exactly this frame.
        </p>
        {metaBits.length > 0 && <p className="page-meta">{metaBits.join(' · ')}</p>}
      </div>

      <hr className="divider" />

      <div className="section">
        <div className="section-head">
          <span className="section-title">Configuration</span>
          <span className="section-note">persisted on run — training uses exactly this</span>
        </div>
        <div className="panel">
          <div className="panel-body">
            <PreprocessConfig value={config} onChange={setConfig} disabled={running} />
            {datasetId === 'ames' && (
              <p className="note mt-10">
                The bundled Ames dataset keeps its canonical processed splits (
                {SPLIT_CONTRACT.train} / {SPLIT_CONTRACT.val} / {SPLIT_CONTRACT.test}) —
                the split settings are recorded in the fingerprint but not re-applied.
              </p>
            )}
            {canTrain === false && trainBlockedReason && !runError && (
              <div className="alert alert-warn mt-12" role="status">
                <span className="alert-title">Training unavailable for this dataset</span>
                {trainBlockedReason}
              </div>
            )}
            {runError && (
              <div className="alert alert-error mt-12" role="alert">
                <span className="alert-title">
                  {runError.status === 400 ? "This dataset can't be preprocessed" : "Couldn't run preprocessing"}
                </span>
                {runError.message}
                {runError.status === 400 && (
                  <div className="alert-actions">
                    <Link
                      className="btn btn-secondary btn-sm"
                      to={`/workflow/01-upload?dataset=${datasetId}`}
                    >
                      Back to stage 01 — Upload
                    </Link>
                  </div>
                )}
              </div>
            )}
            <div className="wf-config-actions">
              <BusyButton
                busy={running}
                busyLabel="Running preprocessing…"
                disabled={!fractionsValid(config)}
                title={
                  !fractionsValid(config)
                    ? 'Fix the validation/test fractions first'
                    : undefined
                }
                onClick={run}
              >
                Run preprocessing
              </BusyButton>
              <span className="field-hint">
                Synchronous — a few seconds at the 20,000-row cap. Re-running with a new
                config overwrites the persisted prepare.
              </span>
            </div>
          </div>
        </div>
      </div>

      {!currentReport && (
        <div className="section">
          <EmptyState
            kicker="Not prepared yet"
            title="No preprocessing run on this dataset"
            detail="Run preprocessing above to produce the train/val/test splits stage 07 trains on. Skipping it is fine too — the first training job auto-prepares with the default config."
          />
        </div>
      )}

      {currentReport && (
        <div aria-busy={running || undefined} className={running ? 'wf-dimmed' : undefined}>
          <div className="section">
            <div className="section-head">
              <span className="section-title">The split — sealed before anything is fit</span>
              <span className="section-note">rule: {currentReport.splits?.rule}</span>
            </div>
            <p className="section-sub">
              The split is decided now, before anything is fit. Training fits on the training
              rows only, every workbench metric is validation-scored, and the test rows stay
              sealed — they are never shown here.
            </p>
            <div className={rateStep ? 'metrics' : 'metrics metrics--3'}>
              <div className="metric">
                <div className="metric-value">{formatNumber(currentReport.splits?.train, 0)}</div>
                <div className="metric-label">Training rows</div>
                <div className="metric-hint">models fit here only</div>
              </div>
              <div className="metric">
                <div className="metric-value">{formatNumber(currentReport.splits?.val, 0)}</div>
                <div className="metric-label">Validation rows</div>
                <div className="metric-hint">every workbench metric comes from here</div>
              </div>
              <div className="metric">
                <div className="metric-value">{formatNumber(currentReport.splits?.test, 0)}</div>
                <div className="metric-label">Sealed test rows</div>
                <div className="metric-hint">stay sealed — never shown</div>
              </div>
              {rateStep && (
                <div className="metric">
                  <div className="metric-value">{formatPct(rateStep.positive_rate_train, 1)}</div>
                  <div className="metric-label">Sale-speed rate</div>
                  <div className="metric-hint">simulated target · train split</div>
                </div>
              )}
            </div>
            {rateStep && (
              <p className="note mt-16">
                Simulated sale-speed rate across the splits — train{' '}
                <span className="mono">{formatPct(rateStep.positive_rate_train, 1)}</span> · val{' '}
                <span className="mono">{formatPct(rateStep.positive_rate_val, 1)}</span> · test{' '}
                <span className="mono">{formatPct(rateStep.positive_rate_test, 1)}</span>. The
                simulator is fit on the training rows only, so a time-based split can
                legitimately shift the rate; it describes the seeded days-on-market
                simulation, not an observed market outcome.
              </p>
            )}
          </div>

          <div className="section">
            <div className="section-head">
              <span className="section-title">Pipeline — raw data to model-ready frame</span>
              <span className="section-note">
                {steps.length} steps · every statistic fit on train only
              </span>
            </div>
            <ol className="wf-flow" aria-label="Preprocessing pipeline">
              <li className="wf-flow-node wf-flow-node--cap">
                <NodeStatus status="source" />
                <span className="wf-flow-label">Raw data</span>
                <span className="wf-flow-fact mono">
                  {formatNumber(currentReport.before?.n_rows, 0)} × {formatNumber(currentReport.before?.n_cols, 0)}
                </span>
              </li>
              {steps.map((step) => (
                <li className="wf-flow-node" key={step.step}>
                  <NodeStatus status={stepStatus(step)} />
                  <span className="wf-flow-label">
                    {STEP_LABELS[step.step] ?? step.step}
                    {step.step === 'sale_speed_target' && step.provider === 'simulated' && (
                      <SimulatedBadge className="wf-flow-badge" />
                    )}
                  </span>
                  <span className="wf-flow-fact mono">{stepFact(step)}</span>
                </li>
              ))}
              <li className="wf-flow-node wf-flow-node--cap">
                <NodeStatus status="persisted" />
                <span className="wf-flow-label">Model-ready frame</span>
                <span className="wf-flow-fact mono">
                  {formatNumber(currentReport.after?.n_cols, 0)} cols · {formatNumber(currentReport.after?.total_missing, 0)} missing
                </span>
              </li>
            </ol>

            <div className="wf-steps">
              {steps.map((step, index) => (
                <details className="wf-step" key={step.step} open={index === 0}>
                  <summary>
                    <span className="wf-step-name">
                      {STEP_LABELS[step.step] ?? step.step}
                      {step.step === 'sale_speed_target' && step.provider === 'simulated' && (
                        <SimulatedBadge />
                      )}
                    </span>
                    <span className="wf-step-fact mono">{stepFact(step)}</span>
                  </summary>
                  <StepFields step={step} />
                </details>
              ))}
            </div>

            <div className="wf-leakage" role="note">
              <span className="badge badge-accent">Leakage-safe</span>
              <p>{currentReport.leakage_note}</p>
            </div>
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <span className="section-title">
            Feature set — {features ? `${rawInputCount(features) + (features.pipeline_features?.length ?? 0)} inputs, ` : ''}two targets
          </span>
          <span className="section-note">the frame stage 07 trains on</span>
        </div>
        <p className="section-sub">
          Raw Ames inputs pass through with train-fit default fills; engineered features are
          derived in the pipeline; neighborhood statistics are fit on the training split. The
          regression target is log-transformed sale price; the classification target is the
          simulated sale-speed flag.
        </p>
        <FeatureSet
          features={features}
          loading={featuresLoading}
          error={featuresError}
          onRetry={reloadFeatures}
        />
      </div>

      {currentReport && (
        <div
          className={running ? 'section wf-dimmed' : 'section'}
          aria-busy={running || undefined}
        >
          <div className="section-head">
            <span className="section-title">Before / after</span>
            <span className="section-note">raw frame vs persisted processed splits</span>
          </div>
          <BeforeAfterPanel report={currentReport} />
        </div>
      )}
    </>
  )
}

/** Raw-input count for the section title (kept out of FeatureSet's render). */
function rawInputCount(features) {
  return (features?.raw_features ?? []).filter((f) => f.role === 'raw_input').length
}
