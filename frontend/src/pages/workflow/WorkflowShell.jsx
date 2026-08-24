/**
 * WorkflowShell (WORKFLOW §6.1-6.2) — layout for every /workflow/* route:
 * the active-dataset context, server-truth gating, and the stage pages
 * (owned by WF-F2/F3/F4, lazily imported so each stage chunk loads on
 * demand).
 *
 * Chrome split (blueprint §4): the sidebar in Layout.jsx owns the numbered
 * pipeline stepper; this shell renders the quiet dataset-context strip at the
 * top (with the twelve-segment stage-progress rail — completed / current /
 * locked / upcoming at a glance) and the StagePager (prev ← / next →) at the
 * foot of every stage.
 *
 * Truth model (§6.2, binding):
 * - Server truth first: `GET /workflow/datasets/{id}/state` drives the 08/09
 *   locks and the running-jobs dot. Server state wins every conflict.
 * - Client optimistic layer: localStorage `proppulse:workflow` holds
 *   `{dataset_id, last_stage, visited: [slugs]}`; stages are marked
 *   done-on-visit and /workflow restores the last position on return.
 * - The active dataset is carried in the URL (`?dataset=`, deep-linkable) and
 *   mirrored to localStorage; invalid ids are dropped silently (UX §7.7).
 *
 * Gating (§6.1/§6.4): stages 01–07 and 10–12 are always available; 08 needs
 * `state.can_evaluate`, 09 needs `state.can_predict_sandbox`. A locked stage
 * deep-linked directly renders a designed locked state with a CTA to stage 07
 * (nothing dead-ends). While the state endpoint is in flight a gated stage
 * shows a skeleton (never a false lock); its failure shows an inline error
 * with retry.
 *
 * Stage pages consume `useWorkflow()` — see the context value below for the
 * full contract.
 */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { listDatasets, getState } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useToast } from '../../components/Toast'
import ErrorBoundary from '../../components/ErrorBoundary'
import { ErrorState, PanelSkeleton } from '../../components/StateView'
import StagePager from '../../components/workflow/StagePager'
import DatasetPicker from '../../components/workflow/DatasetPicker'
import { IconCheck, IconLock } from './icons'
import {
  DATASET_ID_RE,
  DEFAULT_STAGE,
  WORKFLOW_STAGES,
  WORKFLOW_STORAGE_KEY,
  stageBySlug,
  stageHref,
} from './stages'
import '../../styles/workflow.css'

/* Stage pages — one lazy chunk per stage; all twelve are fully implemented
   (WF-F2/F3/F4). The lazy boundary keeps each stage's code out of the main
   bundle so /workflow/* loads on demand (WORKFLOW §8). */
const UploadStage = lazy(() => import('./UploadStage'))
const FeaturesStage = lazy(() => import('./FeaturesStage'))
const StatsStage = lazy(() => import('./StatsStage'))
const MissingStage = lazy(() => import('./MissingStage'))
const VizStage = lazy(() => import('./VizStage'))
const PreprocessStage = lazy(() => import('./PreprocessStage'))
const TrainStage = lazy(() => import('./TrainStage'))
const EvaluateStage = lazy(() => import('./EvaluateStage'))
const PredictStage = lazy(() => import('./PredictStage'))
const MarketStage = lazy(() => import('./MarketStage'))
const ExplainStage = lazy(() => import('./ExplainStage'))
const HealthStage = lazy(() => import('./HealthStage'))

const STAGE_COMPONENTS = {
  '01-upload': UploadStage,
  '02-features': FeaturesStage,
  '03-stats': StatsStage,
  '04-missing': MissingStage,
  '05-viz': VizStage,
  '06-preprocess': PreprocessStage,
  '07-train': TrainStage,
  '08-evaluate': EvaluateStage,
  '09-predict': PredictStage,
  '10-market': MarketStage,
  '11-explain': ExplainStage,
  '12-health': HealthStage,
}

/**
 * Server-truth gates (§6.4). `key` is the DatasetState field that unlocks the
 * stage; `reason` is the locked-state copy naming the unblock action.
 */
const GATED_STAGES = {
  '08-evaluate': {
    key: 'can_evaluate',
    reason: 'Train at least one model in stage 07 to unlock evaluation.',
    ctaSlug: '07-train',
    ctaLabel: 'Go to stage 07 — Model Training',
  },
  '09-predict': {
    key: 'can_predict_sandbox',
    reason: 'Train at least one model in stage 07 to unlock sandbox predictions.',
    ctaSlug: '07-train',
    ctaLabel: 'Go to stage 07 — Model Training',
  },
}

const INITIAL_STORED = { dataset_id: 'ames', last_stage: null, visited: [] }

const WorkflowContext = createContext(null)

/**
 * The workflow context consumed by every stage page (WF-F2/F3/F4 contract):
 *
 *   datasetId          active dataset id ("ames" | "ds_xxxxxxxx")
 *   dataset            its DatasetRecord from the list endpoint (or null)
 *   datasets           DatasetRecord[] | null
 *   datasetsLoading / datasetsError / reloadDatasets()
 *   selectDataset(id)  switch the active dataset (URL ?dataset= + storage)
 *
 *   state              DatasetState | null — server truth (§3.2)
 *   stateLoading / stateError / reloadState()
 *                      Call reloadState() after any mutation that changes it
 *                      (upload, preprocess run, job reaching a terminal state).
 *   canTrain / trainBlockedReason
 *   canEvaluate        gates stage 08 content
 *   canPredictSandbox  gates the sandbox half of stage 09
 *   (the three above are null while state is unknown — render neutral copy)
 *
 *   stages             stepper view-model [{num, slug, short, title, status,
 *                      lockMessage, jobsRunning}]
 *   currentSlug / currentStage
 *   goToStage(slug)    navigate, preserving ?dataset=
 *   visited            slugs marked done-on-visit (client layer)
 */
// eslint-disable-next-line react-refresh/only-export-components -- context hook next to its provider (Toast.jsx pattern)
export function useWorkflow() {
  const ctx = useContext(WorkflowContext)
  if (ctx === null) throw new Error('useWorkflow must be used inside <WorkflowShell>')
  return ctx
}

/** Designed locked state (§6.4): lock tile, the unblock action, CTA to the
    unblocking stage (nothing dead-ends). Keeps the reference's "Soon"-tag
    pattern (.step-soon) for the status chip. Pinned copy: the title and
    gate.reason render verbatim (e2e workflow.spec gating test). */
function LockedStage({ stage, gate, datasetId }) {
  return (
    <div className="section">
      <div className="empty-state wf-locked">
        <span className="wf-locked-icon" aria-hidden="true">
          <IconLock size={18} />
        </span>
        <span className="kicker">
          Stage {stage.num} · {stage.title}
        </span>
        <div className="empty-state-title">This stage is locked</div>
        <p className="empty-state-detail">{gate.reason}</p>
        <div className="wf-locked-actions">
          <span className="step-soon wf-locked-tag">Locked</span>
          <Link
            className="btn btn-primary btn-sm wf-locked-cta"
            to={stageHref(gate.ctaSlug, datasetId)}
          >
            {gate.ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Layout-matched suspense/gating fallback: head lines + one panel block. */
function StageFallback() {
  return (
    <div aria-hidden="true">
      <div className="page-head">
        <div className="skeleton sk-line" style={{ width: 140 }} />
        <div className="skeleton sk-line" style={{ width: 300, height: 22 }} />
        <div className="skeleton sk-line" style={{ width: 460 }} />
      </div>
      <div className="section">
        <PanelSkeleton height={280} />
      </div>
    </div>
  )
}

/** Segment status copy for the progress rail's aria-labels. */
const PROGRESS_STATUS = {
  done: 'completed',
  current: 'current stage',
  locked: 'locked',
  available: 'not visited yet',
}

/**
 * Stage-progress rail (§6.2 stepper view-model, made visible): twelve
 * segments — completed (check) / current (accent, aria-current="step") /
 * locked (lock glyph) / upcoming (quiet number) — each a real link preserving
 * ?dataset=, so the rail doubles as keyboard-accessible stage navigation and
 * its state is never colour-only (the status rides every aria-label). The
 * sidebar stepper stays the primary nav; this strip surfaces the per-stage
 * state the sidebar does not carry, including the stage-07 live-jobs dot
 * (server truth: state.jobs.running).
 */
function StageProgress({ stages, datasetId }) {
  return (
    <nav className="wf-progress" aria-label="Workflow stage progress">
      <ol className="wf-progress-list">
        {stages.map((item) => {
          const label =
            `Stage ${item.num} of ${stages.length}: ${item.title} — ` +
            (PROGRESS_STATUS[item.status] ?? item.status) +
            (item.status === 'locked' && item.lockMessage ? `. ${item.lockMessage}` : '') +
            (item.jobsRunning > 0
              ? ` — ${item.jobsRunning} job${item.jobsRunning === 1 ? '' : 's'} running`
              : '')
          return (
            <li key={item.slug}>
              <Link
                className={`wf-progress-seg wf-progress-seg--${item.status}`}
                to={stageHref(item.slug, datasetId)}
                aria-label={label}
                aria-current={item.status === 'current' ? 'step' : undefined}
              >
                {item.status === 'done' ? (
                  <IconCheck size={11} />
                ) : item.status === 'locked' ? (
                  <IconLock size={11} />
                ) : (
                  <span className="wf-progress-num">{item.num}</span>
                )}
                {item.jobsRunning > 0 && (
                  <span className="wf-progress-live" aria-hidden="true" />
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default function WorkflowShell() {
  const toast = useToast()
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [stored, setStored] = useLocalStorage(WORKFLOW_STORAGE_KEY, INITIAL_STORED)

  // --- Current stage (splat route: /workflow/* → params['*']) ---------------
  const rawSlug = (params['*'] ?? '').replace(/\/+$/, '')
  const stage = stageBySlug(rawSlug)

  // --- Active dataset: URL wins, then storage, then the bundled default -----
  const paramId = searchParams.get('dataset')
  const storedId = typeof stored?.dataset_id === 'string' ? stored.dataset_id : null
  const datasetId =
    paramId && DATASET_ID_RE.test(paramId)
      ? paramId
      : storedId && DATASET_ID_RE.test(storedId)
        ? storedId
        : 'ames'

  // Keep the URL canonical (?dataset= always present on /workflow/*). The
  // functional form preserves the rest of the query string — a deep link like
  // /workflow/08-evaluate?job=job_xxxxxxxx (no ?dataset=) must not lose its
  // job param to the canonicalization rewrite.
  useEffect(() => {
    if (paramId === datasetId) return
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('dataset', datasetId)
        return next
      },
      { replace: true },
    )
  }, [paramId, datasetId, setSearchParams])

  // Mirror the active dataset into localStorage (§6.2 client layer).
  useEffect(() => {
    if (storedId !== datasetId) {
      setStored((prev) => ({ ...INITIAL_STORED, ...prev, dataset_id: datasetId }))
    }
  }, [datasetId, storedId, setStored])

  const selectDataset = useCallback(
    (id) => {
      if (!DATASET_ID_RE.test(id)) return
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('dataset', id)
        return next
      })
    },
    [setSearchParams],
  )

  // --- Server truth: dataset list + active-dataset state --------------------
  const fetchDatasets = useCallback((signal) => listDatasets(signal), [])
  const {
    data: datasets,
    loading: datasetsLoading,
    error: datasetsError,
    reload: reloadDatasets,
  } = useApi(fetchDatasets)

  const fetchState = useCallback((signal) => getState(datasetId, signal), [datasetId])
  const {
    data: state,
    loading: stateLoading,
    error: stateError,
    reload: reloadState,
  } = useApi(fetchState)

  const dataset = useMemo(
    () => datasets?.find((record) => record.dataset_id === datasetId) ?? null,
    [datasets, datasetId],
  )

  // A 404 state means the active id no longer exists server-side (deleted in
  // another tab / expired upload): fall back to the bundled dataset.
  useEffect(() => {
    if (stateError?.status === 404 && datasetId !== 'ames') {
      toast.info('That dataset no longer exists — switched to the bundled Ames data.')
      selectDataset('ames')
      reloadDatasets()
    }
  }, [stateError, datasetId, selectDataset, reloadDatasets, toast])

  // --- Client optimistic layer: visited + last position ----------------------
  const visited = useMemo(
    () =>
      Array.isArray(stored?.visited)
        ? stored.visited.filter((slug) => stageBySlug(slug))
        : [],
    [stored],
  )

  useEffect(() => {
    if (!stage) return
    setStored((prev) => {
      const safe = { ...INITIAL_STORED, ...prev }
      const safeVisited = Array.isArray(safe.visited) ? safe.visited : []
      const already = safeVisited.includes(stage.slug)
      if (already && safe.last_stage === stage.slug) return safe
      return {
        ...safe,
        last_stage: stage.slug,
        visited: already ? safeVisited : [...safeVisited, stage.slug],
      }
    })
  }, [stage, setStored])

  // --- Stepper view-model -----------------------------------------------------
  const stages = useMemo(
    () =>
      WORKFLOW_STAGES.map((def) => {
        const gate = GATED_STAGES[def.slug]
        const locked = Boolean(gate && state && !state[gate.key])
        const status = locked
          ? 'locked'
          : stage && def.slug === stage.slug
            ? 'current'
            : visited.includes(def.slug)
              ? 'done'
              : 'available'
        return {
          ...def,
          status,
          lockMessage: locked ? gate.reason : null,
          jobsRunning: def.slug === '07-train' ? (state?.jobs?.running ?? 0) : 0,
        }
      }),
    [state, stage, visited],
  )

  const goToStage = useCallback(
    (slug) => {
      if (!stageBySlug(slug)) return
      navigate(stageHref(slug, datasetId))
    },
    [navigate, datasetId],
  )

  const contextValue = useMemo(
    () => ({
      datasetId,
      dataset,
      datasets,
      datasetsLoading,
      datasetsError,
      reloadDatasets,
      selectDataset,
      state,
      stateLoading,
      stateError,
      reloadState,
      canTrain: state?.can_train ?? null,
      trainBlockedReason: state?.train_blocked_reason ?? null,
      canEvaluate: state?.can_evaluate ?? null,
      canPredictSandbox: state?.can_predict_sandbox ?? null,
      stages,
      currentSlug: stage?.slug ?? null,
      currentStage: stage ?? null,
      goToStage,
      visited,
    }),
    [
      datasetId,
      dataset,
      datasets,
      datasetsLoading,
      datasetsError,
      reloadDatasets,
      selectDataset,
      state,
      stateLoading,
      stateError,
      reloadState,
      stages,
      stage,
      goToStage,
      visited,
    ],
  )

  // /workflow (or an unknown slug) → the last visited stage, else stage 01.
  if (!stage) {
    const target = stageBySlug(stored?.last_stage) ?? stageBySlug(DEFAULT_STAGE)
    return <Navigate to={stageHref(target.slug, datasetId)} replace />
  }

  const gate = GATED_STAGES[stage.slug]
  const StageComponent = STAGE_COMPONENTS[stage.slug]
  let body
  if (gate && stateLoading) {
    body = <StageFallback />
  } else if (gate && stateError && stateError.status !== 404) {
    body = (
      <div className="section">
        <ErrorState
          error={stateError}
          onRetry={reloadState}
          title="Couldn't load workflow state"
        />
      </div>
    )
  } else if (gate && state && !state[gate.key]) {
    body = <LockedStage stage={stage} gate={gate} datasetId={datasetId} />
  } else {
    body = (
      // QA M1: a stage-level boundary around the stage outlet — a failed lazy
      // stage chunk (offline mid-navigation) degrades to the boundary panel in
      // the content area while the stepper + dataset picker survive. The
      // per-stage key remounts the boundary on navigation, so moving to
      // another stage always gets a fresh attempt. The App.jsx route boundary
      // still guards catastrophic shell failures above this.
      <ErrorBoundary key={stage.slug}>
        <Suspense fallback={<StageFallback />}>
          <StageComponent />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <WorkflowContext.Provider value={contextValue}>
      <div className="wf-shell">
        {/* Quiet mono context strip — reads as the page-head meta area; the
            dataset picker is a compact quiet control on the right. Below the
            meta row, the stage-progress rail surfaces completed / current /
            locked / upcoming for all twelve stages (the §6.2 view-model). */}
        <div className="wf-context">
          <div className="wf-context-top">
            <p className="wf-context-line">
              <span className="wf-context-dot" aria-hidden="true" />
              Sandbox workbench — models you train here serve this workbench only and
              never replace the PropPulse champion.
            </p>
            <div className="wf-context-side">
              <span className="wf-context-stage">
                Stage <span className="wf-context-stage-num">{stage.num}</span>
                {' / '}
                {WORKFLOW_STAGES.length}
              </span>
              <DatasetPicker />
            </div>
          </div>
          <StageProgress stages={stages} datasetId={datasetId} />
        </div>
        {body}
        <StagePager currentSlug={stage.slug} datasetId={datasetId} />
      </div>
    </WorkflowContext.Provider>
  )
}
