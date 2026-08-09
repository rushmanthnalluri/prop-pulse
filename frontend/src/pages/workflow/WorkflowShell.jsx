/**
 * WorkflowShell (WORKFLOW §6.1-6.2) — layout for every /workflow/* route:
 * the 12-stage stepper, the active-dataset context, server-truth gating, and
 * the stage pages (owned by WF-F2/F3/F4, lazily imported so each stage chunk
 * loads on demand).
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
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import Stepper from '../../components/workflow/Stepper'
import DatasetPicker from '../../components/workflow/DatasetPicker'
import {
  DATASET_ID_RE,
  DEFAULT_STAGE,
  WORKFLOW_STAGES,
  stageBySlug,
} from './stages'
import '../../styles/workflow.css'

/* Stage pages — placeholders now, real implementations land with WF-F2/F3/F4
   at exactly these paths (WORKFLOW §8). One lazy chunk per stage. */
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

export const WORKFLOW_STORAGE_KEY = 'proppulse:workflow'
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

/** Designed locked state (§6.4): names the unblock action, CTA to stage 07. */
function LockedStage({ stage, gate, datasetId }) {
  return (
    <div className="section">
      <EmptyState
        kicker={`Stage ${stage.num} · ${stage.title}`}
        title="This stage is locked"
        detail={gate.reason}
      >
        <Link
          className="btn btn-primary btn-sm wf-locked-cta"
          to={`/workflow/${gate.ctaSlug}?dataset=${datasetId}`}
        >
          {gate.ctaLabel}
        </Link>
      </EmptyState>
    </div>
  )
}

function StageFallback() {
  return (
    <div className="section">
      <PanelSkeleton height={280} />
    </div>
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

  // Keep the URL canonical (?dataset= always present on /workflow/*).
  useEffect(() => {
    if (paramId !== datasetId) setSearchParams({ dataset: datasetId }, { replace: true })
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
      navigate(`/workflow/${slug}?dataset=${datasetId}`)
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
    return <Navigate to={`/workflow/${target.slug}?dataset=${datasetId}`} replace />
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
        <div className="wf-top">
          <Stepper stages={stages} datasetId={datasetId} />
          <div className="wf-context">
            <p className="wf-context-line">
              Sandbox workbench — models you train here serve this workbench only and
              never replace the PropPulse champion.
            </p>
            <DatasetPicker />
          </div>
        </div>
        {body}
      </div>
    </WorkflowContext.Provider>
  )
}
