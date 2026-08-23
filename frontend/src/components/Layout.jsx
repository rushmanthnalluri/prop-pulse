/**
 * App shell (blueprint §3/§4): 264px sticky sidebar — brand, the numbered
 * pipeline stepper (stages 01–09, deep-linking into /workflow/*), the product
 * nav, and a footer row with the active dataset + API status. The main column
 * is the centered 940px container with the mono footer row. ≤900px the
 * sidebar becomes a full-width top bar and the stepper a horizontal scroll
 * strip (blueprint §10; the active item is scrolled into view); a compact
 * api-status-compact dot rides beside the brand, shown only there.
 *
 * The API-status poll pauses when the tab is hidden and re-checks on
 * visibility return or manual click; window online/offline events update the
 * pill promptly between polls. Down/degraded states raise the alert-language
 * banners above the main column.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router'
import { api } from '../api/client'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { WORKFLOW_STAGES, stageBySlug } from '../pages/workflow/stages'

/* The sidebar stepper carries the nine real pipeline stages (01–09); stages
   10–12 are bridge stages into the champion product pages, which the Product
   group already covers. StagePager chains the full 12-stage order. */
const PIPELINE_STAGES = WORKFLOW_STAGES.slice(0, 9)

const PRODUCT_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/valuation', label: 'Valuation' },
  { to: '/market', label: 'Market Intelligence' },
  { to: '/model', label: 'Model Insights' },
  { to: '/health', label: 'Model Health' },
]

const TITLES = {
  '/': 'Overview · PropPulse',
  '/valuation': 'Valuation · PropPulse',
  '/market': 'Market Intelligence · PropPulse',
  '/model': 'Model Insights · PropPulse',
  '/health': 'Model Health · PropPulse',
}

/** "{Stage title} · PropPulse" for any /workflow/* path, null elsewhere. */
function workflowDocumentTitle(pathname) {
  if (!pathname.startsWith('/workflow')) return null
  const match = pathname.match(/^\/workflow\/([^/?#]+)/)
  const stage = match ? stageBySlug(match[1]) : null
  return stage ? `${stage.title} · PropPulse` : 'ML Workbench · PropPulse'
}

/** localStorage key owned by WorkflowShell (WORKFLOW_STORAGE_KEY) — the
    shell mirrors the active dataset there; the sidebar only reads it. */
const WORKFLOW_STORAGE_KEY = 'proppulse:workflow'

/**
 * One sidebar item: `li.is-active > a > [step-num] + step-label`, exactly the
 * reference stepper DOM. `useMatch` drives the active state so the <li> can
 * carry `is-active` (blueprint §4 selector) and the link `aria-current`.
 */
function SidebarItem({ to, num, label, end = false, dataStage }) {
  const match = useMatch({ path: to, end })
  return (
    <li className={match ? 'is-active' : undefined}>
      <Link
        to={to}
        aria-current={match ? 'page' : undefined}
        data-stage={dataStage}
      >
        {num && <span className="step-num">{num}</span>}
        <span className="step-label">{label}</span>
      </Link>
    </li>
  )
}

function useApiStatus() {
  const [status, setStatus] = useState('checking') // checking | up | degraded | down
  const [checkedAt, setCheckedAt] = useState(null)
  const timer = useRef(null)

  const check = useCallback(async () => {
    try {
      const data = await api.health()
      const loaded = data?.models_loaded ?? {}
      const degraded = Object.values(loaded).some((v) => v === false)
      setStatus(degraded ? 'degraded' : 'up')
    } catch {
      setStatus('down')
    }
    setCheckedAt(new Date())
  }, [])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') check()
    }
    tick()
    timer.current = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer.current)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [check])

  // React to connectivity events promptly instead of waiting up to 30s for
  // the next poll: offline marks the API down immediately, online re-checks.
  useEffect(() => {
    const onOffline = () => setStatus('down')
    const onOnline = () => check()
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [check])

  return { status, checkedAt, recheck: check }
}

const STATUS_LABEL = {
  checking: 'Checking API…',
  up: 'API connected',
  degraded: 'API degraded',
  down: 'API offline',
}

function ApiStatus({ status, onRecheck }) {
  return (
    <button
      type="button"
      className={`api-status api-status--${status}`}
      onClick={onRecheck}
      title="Re-check API status"
      aria-live="polite"
    >
      <span className="api-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </button>
  )
}

export default function Layout() {
  const { status, recheck } = useApiStatus()
  const location = useLocation()
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const prevPathRef = useRef(location.pathname)
  const [storedWorkflow] = useLocalStorage(WORKFLOW_STORAGE_KEY, null)
  const activeDatasetId =
    typeof storedWorkflow?.dataset_id === 'string' ? storedWorkflow.dataset_id : 'ames'

  useEffect(() => {
    document.title =
      TITLES[location.pathname] ??
      workflowDocumentTitle(location.pathname) ??
      '404 · PropPulse'
  }, [location.pathname])

  // Keep the active stepper item visible inside the ≤900px scroll strip.
  // Manual scrollLeft, NOT scrollIntoView: scrollIntoView also moves
  // Chromium's sequential-focus start point to the active link, so the
  // first Tab after navigation would skip the skip-link and every nav item
  // before the active one (hardening §21 keyboard-walk regression).
  useEffect(() => {
    const active = sidebarRef.current?.querySelector('.pipeline-stepper li.is-active a')
    const strip = active?.closest('.pipeline-stepper')
    if (!active || !strip) return
    const delta = active.getBoundingClientRect().left - strip.getBoundingClientRect().left
    strip.scrollLeft += delta - (strip.clientWidth - active.clientWidth) / 2
  }, [location.pathname])

  // Focus-on-route-change (UI UX Pro Max `focus-on-route-change` rule): move
  // focus to the <main> region after navigation so screen-reader users start
  // at the new content instead of the old page position. Skipped on first
  // render (don't steal focus from a restored browser session) — guarded by
  // path comparison, not a boolean flag, because StrictMode replays mount
  // effects in dev and a flag would already be consumed by the replay.
  useEffect(() => {
    if (prevPathRef.current === location.pathname) return
    prevPathRef.current = location.pathname
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="pipeline-sidebar" ref={sidebarRef}>
        <Link className="sidebar-brand" to="/">
          <span className="brand-mark" aria-hidden="true">PP</span>
          <span className="brand-text">
            <span className="brand-line-1">PropPulse</span>
            <span className="brand-line-2">Property Intelligence</span>
          </span>
        </Link>

        {/* Compact API-status twin for the ≤900px top bar (CSS shows it only
            there); mirrors ApiStatus's states and labels, non-interactive. */}
        <span
          className={`api-status-compact api-status-compact--${status}`}
          role="status"
          aria-label={STATUS_LABEL[status]}
        >
          <span className="api-status-dot" aria-hidden="true" />
        </span>

        <p className="nav-caption">Pipeline</p>
        <nav className="pipeline-stepper" aria-label="ML pipeline stages">
          <ol>
            {PIPELINE_STAGES.map((stage) => (
              <SidebarItem
                key={stage.slug}
                to={`/workflow/${stage.slug}`}
                num={stage.num}
                label={stage.title}
                dataStage={stage.slug}
              />
            ))}
          </ol>
        </nav>

        <p className="nav-caption">Product</p>
        <nav className="pipeline-stepper pipeline-stepper--product" aria-label="Product pages">
          <ol>
            {PRODUCT_ITEMS.map((item) => (
              <SidebarItem
                key={item.to}
                to={item.to}
                label={item.label}
                end={item.end}
              />
            ))}
          </ol>
        </nav>

        <div className="sidebar-footer">
          <Link to="/" className="sidebar-overview-link">← Overview</Link>
          <span className="sidebar-dataset">{activeDatasetId}</span>
          <ApiStatus status={status} onRecheck={recheck} />
        </div>
      </aside>

      <div className="app-body">
        {status === 'down' && (
          <div className="error-banner" role="alert">
            <span>
              <strong>API offline.</strong> Valuations and market data are
              unavailable until the backend responds.
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={recheck}>
              Retry connection
            </button>
          </div>
        )}
        {status === 'degraded' && (
          <div className="error-banner error-banner--warn" role="alert">
            <span>
              <strong>API degraded.</strong> One or more models are not loaded;
              some features may be unavailable.
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={recheck}>
              Re-check
            </button>
          </div>
        )}

        <main id="main" tabIndex={-1} ref={mainRef}>
          <Outlet />
        </main>

        <footer className="site-footer">
          <div className="footer-row">
            <span>PropPulse · property intelligence for Ames, IA</span>
            <span>9-stage ML workflow</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
