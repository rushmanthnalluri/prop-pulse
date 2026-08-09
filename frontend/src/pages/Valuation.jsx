/**
 * Valuation page (SPEC §5.2 — the product): structured property form →
 * POST /predict → sticky result rail in strict hierarchy order (estimate →
 * ~80% range → sale likelihood → micro-market → price position → why this
 * value → comparable sales → what-if scenarios → provenance). GET /model/info
 * is fetched once for the page-meta line and the coverage/MAE captions —
 * additive only: when it fails, those figures are omitted, never hardcoded.
 *
 * Submit pipeline (AUDIT §6.12 — all four behaviors kept): abort-supersede
 * on a new run, previous result kept dimmed while reloading, smooth
 * scroll-into-view on ≤1024px honoring reduced motion, and the scenario
 * explorer remounts keyed by the payload. The error path is fixed
 * (AUDIT §2.2): a failed re-submit keeps the previous result dimmed with an
 * inline banner + toast — `result: null` only happens on Reset.
 *
 * State sharing (SPEC §5.2.2/§7.7): the submitted payload is mirrored to the
 * URL (shareable links; the ?neighborhood= handshake is one case of it) and
 * persisted to localStorage (proppulse:last-valuation); on load, URL params
 * win, else a "Restore last valuation" chip offers the stored payload.
 * Client-only — no backend exists for saved work (CONTRACT §5.15).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { LAST_VALUATION_KEY, NEIGHBORHOODS } from '../constants'
import { formatDateTime, formatMetric, formatNumber, formatPct } from '../format'
import { useToast } from '../components/Toast'
import BusyButton from '../components/shared/BusyButton'
import useReducedMotion from '../components/shared/useReducedMotion'
import { PanelSkeleton } from '../components/StateView'
import PropertyForm from '../components/shared/PropertyForm'
import ResultHero from '../components/valuation/ResultHero'
import MicroMarketCard from '../components/valuation/MicroMarketCard'
import {
  FORM_DEFAULTS,
  parseUrlValues,
  payloadToFormValues,
  payloadToParams,
} from '../components/valuation/formConfig'
import ProbabilityGauge from '../components/ProbabilityGauge'
import FactorBars from '../components/FactorBars'
import MarketPosition from '../components/MarketPosition'
import CompsTable from '../components/CompsTable'
import ScenarioExplorer from '../components/ScenarioExplorer'
import '../styles/valuation.css'

export default function ValuationPage() {
  const [state, setState] = useState({ result: null, loading: false, error: null })
  const [submittedPayload, setSubmittedPayload] = useState(null)
  // The payload that produced the kept result — updated only on success, so a
  // failed re-submit (which keeps the previous result dimmed, AUDIT §2.2)
  // never pairs the old estimate with comps/scenarios for the new payload.
  const [resultPayload, setResultPayload] = useState(null)
  const [resultAt, setResultAt] = useState(null)
  const [seed, setSeed] = useState(null)
  const [restoreDismissed, setRestoreDismissed] = useState(false)
  const [lastPayload, setLastPayload] = useLocalStorage(LAST_VALUATION_KEY, null)
  const abortRef = useRef(null)
  const hadResultRef = useRef(false)
  const railRef = useRef(null)
  const toast = useToast()
  const reducedMotion = useReducedMotion()
  const [searchParams, setSearchParams] = useSearchParams()

  // Validated URL-param form values (bad values dropped silently, SPEC §7.7).
  // Identity changes only when the search params change — the form merges
  // them, which also keeps the ?neighborhood= handshake re-applying.
  const prefill = useMemo(() => parseUrlValues(searchParams), [searchParams])

  // Page-meta line + the hero/gauge captions (SPEC §5.2: fetched once,
  // additive — omitted when unavailable, never hardcoded).
  const fetchModelInfo = useCallback((signal) => api.modelInfo(signal), [])
  const { data: modelInfo } = useApi(fetchModelInfo)
  const testMae = Number(modelInfo?.regression?.test_metrics?.mae)
  const intervalCoverage = Number(modelInfo?.regression?.test_metrics?.interval_coverage)

  const metaParts = useMemo(() => {
    if (!modelInfo) return []
    const parts = []
    const champion = [modelInfo.regression?.name, modelInfo.regression?.version]
      .filter(Boolean)
      .join('_')
    if (champion) parts.push(`Champion ${champion}`)
    const rmsle = Number(modelInfo.regression?.test_metrics?.rmsle)
    if (Number.isFinite(rmsle)) parts.push(`test RMSLE ${formatMetric(rmsle, 4)}`)
    if (Number.isFinite(intervalCoverage)) {
      parts.push(`range coverage ${formatPct(intervalCoverage)}`)
    }
    const threshold = Number(modelInfo.classification?.threshold)
    if (Number.isFinite(threshold)) parts.push(`threshold ${formatPct(threshold)}`)
    return parts
  }, [modelInfo, intervalCoverage])

  // AUD-10: abort the in-flight /predict if the page unmounts mid-request.
  useEffect(() => () => abortRef.current?.abort(), [])

  const submit = (payload) => {
    abortRef.current?.abort() // supersede any in-flight run
    const controller = new AbortController()
    abortRef.current = controller
    hadResultRef.current = Boolean(state.result)
    setSubmittedPayload(payload)
    setLastPayload(payload) // persist for the restore chip
    setSearchParams(payloadToParams(payload), { replace: true }) // shareable URL
    // Keep the previous result on screen (dimmed) while reloading.
    setState((prev) => ({ result: prev.result, loading: true, error: null }))
    api
      .predict(payload, controller.signal)
      .then((result) => {
        setState({ result, loading: false, error: null })
        setResultPayload(payload)
        setResultAt(new Date())
        toast.success(hadResultRef.current ? 'Estimate updated' : 'Estimate ready')
        // Single-column layouts: bring the result rail into view after success.
        if (window.matchMedia('(max-width: 1024px)').matches) {
          railRef.current?.scrollIntoView({
            behavior: reducedMotion ? 'auto' : 'smooth',
            block: 'start',
          })
        }
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return // unmounted or superseded
        // FIX (AUDIT §2.2): a failed re-submit keeps the previous result.
        setState((prev) => ({ result: prev.result, loading: false, error }))
        toast.error(
          hadResultRef.current ? 'Estimate failed — previous result kept' : 'Estimate failed',
          error?.status === 422
            ? 'Fix the highlighted fields and try again.'
            : error?.message || undefined,
        )
      })
  }

  const loadExample = () => setSeed({ values: { ...FORM_DEFAULTS } })

  const handleReset = () => {
    abortRef.current?.abort()
    setSeed({ values: { ...FORM_DEFAULTS } })
    // result: null only on Reset (SPEC §5.2.2).
    setState({ result: null, loading: false, error: null })
    setSubmittedPayload(null)
    setResultPayload(null)
    setResultAt(null)
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  // "Restore last valuation" — only when the URL carries no valuation state.
  const restoreSummary = useMemo(() => {
    if (!lastPayload || typeof lastPayload !== 'object') return null
    const parts = []
    const hood = NEIGHBORHOODS.find((n) => n.value === lastPayload.neighborhood)
    if (hood) parts.push(hood.label)
    const area = Number(lastPayload.gr_liv_area)
    if (Number.isFinite(area)) parts.push(`${formatNumber(area, 0)} sq ft`)
    const built = Number(lastPayload.year_built)
    if (Number.isFinite(built)) parts.push(`built ${built}`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [lastPayload])
  const showRestore = !prefill && restoreSummary !== null && !restoreDismissed
  const restoreLast = () => {
    setSeed({ values: payloadToFormValues(lastPayload) })
    setRestoreDismissed(true)
  }

  const { result } = state
  const versions = result?.model_version
  const provenanceParts = []
  if (versions?.regression && versions?.classification) {
    provenanceParts.push(`${versions.regression} + ${versions.classification}`)
  } else if (versions?.regression) {
    provenanceParts.push(versions.regression)
  }
  if (versions?.feature_version) provenanceParts.push(`features ${versions.feature_version}`)
  if (modelInfo?.dataset_version) provenanceParts.push(modelInfo.dataset_version)
  if (resultAt) provenanceParts.push(`estimated ${formatDateTime(resultAt.toISOString())}`)

  return (
    <>
      <header className="page-head">
        <span className="kicker">Valuation</span>
        <h1 className="page-title">Value a property</h1>
        <p className="page-desc">
          Estimate a home&apos;s market value in Ames, IA — with an ~80% range, a calibrated
          30-day sale probability, micro-market context, and comparable sales. Trained on
          2006–2008 historical sales.
        </p>
        {metaParts.length > 0 && <p className="page-meta">{metaParts.join(' · ')}</p>}
      </header>

      {showRestore && (
        <div className="restore-bar">
          <span className="restore-text">
            A previous valuation is saved on this device
            <span className="restore-summary"> · {restoreSummary}</span>
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={restoreLast}>
            Restore last valuation
          </button>
          <button
            type="button"
            className="restore-dismiss"
            aria-label="Dismiss"
            onClick={() => setRestoreDismissed(true)}
          >
            ×
          </button>
        </div>
      )}

      <div className="valuation-grid">
        <PropertyForm
          onSubmit={submit}
          onReset={handleReset}
          onLoadExample={loadExample}
          submitting={state.loading}
          serverError={state.error}
          seed={seed}
          prefill={prefill}
        />

        <div className="sticky-rail valuation-rail" ref={railRef} aria-live="polite">
          {state.loading && !result && (
            <>
              <PanelSkeleton height={190} />
              <PanelSkeleton height={110} />
              <PanelSkeleton height={180} />
            </>
          )}

          {state.error && (
            <div className="alert alert-error" role="alert">
              <span className="alert-title">Valuation failed</span>
              {state.error?.status === 422
                ? 'The API rejected some fields — they are highlighted in the form.'
                : state.error?.message || 'An unexpected error occurred.'}
              {result && (
                <span className="rail-error-note">
                  The previous estimate is kept below, dimmed.
                </span>
              )}
              <div className="alert-actions">
                <BusyButton
                  busy={state.loading}
                  busyLabel="Retrying…"
                  className="btn btn-secondary btn-sm"
                  onClick={() => submittedPayload && submit(submittedPayload)}
                >
                  Try again
                </BusyButton>
              </div>
            </div>
          )}

          {!state.loading && !state.error && !result && (
            <div className="panel panel--hero">
              <div className="result-hero">
                <span className="kicker">The estimate</span>
                <p className="result-price result-price--empty" aria-hidden="true">
                  —
                </p>
                <p className="result-caption">
                  Submit the form to see the estimate, its ~80% range, sale likelihood, and
                  comparable sales.
                </p>
                <div className="rail-empty-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={loadExample}
                  >
                    Load example property
                  </button>
                </div>
              </div>
            </div>
          )}

          {result && (
            <div
              className={`rail-stack${state.loading || state.error ? ' rail-stack--dim' : ''}`}
              aria-busy={state.loading}
            >
              <ResultHero result={result} coverage={intervalCoverage} mae={testMae} />
              <ProbabilityGauge
                probability={result.sale_probability?.probability}
                threshold={result.sale_probability?.threshold}
                sellsWithin30Days={result.sale_probability?.sells_within_30_days}
              />
              <MicroMarketCard
                microMarket={result.micro_market}
                neighborhood={resultPayload?.neighborhood}
              />
              <MarketPosition marketPosition={result.market_position} />
              <FactorBars factors={result.top_price_factors} />
              <CompsTable payload={resultPayload} estimate={Number(result.estimated_price)} />
              {/* Keyed by payload so a new valuation drops all lever state. */}
              <ScenarioExplorer
                key={JSON.stringify(resultPayload)}
                basePayload={resultPayload}
                basePrice={Number(result.estimated_price)}
              />
              {provenanceParts.length > 0 && (
                <p className="provenance">{provenanceParts.join(' · ')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
