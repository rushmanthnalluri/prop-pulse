/**
 * App shell (blueprint §3/§4): 264px sticky sidebar — brand, the numbered
 * pipeline stepper (stages 01–09, deep-linking into /workflow/*), the product
 * nav with inline-SVG icons, and a footer holding the active dataset, the API
 * service-status card and the desktop collapse toggle. Collapsed rail mode
 * (≥901px, persisted to localStorage) clips every label instead of
 * display:none, so accessible names survive the icon rail. The main column is
 * the centered 940px container with the mono footer row.
 *
 * Desktop keeps the two navigation groups in a vertical scroller with a
 * fixed, separated Dataset/API footer. ≤900px the sidebar becomes a top bar:
 * brand + compact API-status chip, then ONE merged horizontal scroll strip
 * (pipeline stages, then product pages, hairline-divided); section captions
 * drop out at that breakpoint to save height.
 *
 * The API-status poll pauses when the tab is hidden and re-checks on
 * visibility return or manual click; window online/offline events update the
 * pill promptly between polls. Down/degraded states raise the alert-language
 * banners above the main column. Shell presentation beyond the styles.css
 * base lives in ../styles/shell.css, scoped to .shell-* classes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch } from 'react-router'
import { api } from '../api/client'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { WORKFLOW_STAGES, WORKFLOW_STORAGE_KEY, stageBySlug } from '../pages/workflow/stages'
import '../styles/shell.css'

/* The sidebar stepper carries the nine real pipeline stages (01–09); stages
   10–12 are bridge stages into the champion product pages, which the Product
   group already covers. StagePager chains the full 12-stage order. */
const PIPELINE_STAGES = WORKFLOW_STAGES.slice(0, 9)

/* Inline-SVG nav icons — 18px, currentColor, 1.5 stroke, round caps. */
const NAV_ICON = {
  width: 18,
  height: 18,
  viewBox: '0 0 18 18',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
}
const IconOverview = () => (
  <svg {...NAV_ICON}>
    <rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" />
    <rect x="10" y="2.5" width="5.5" height="5.5" rx="1" />
    <rect x="2.5" y="10" width="5.5" height="5.5" rx="1" />
    <rect x="10" y="10" width="5.5" height="5.5" rx="1" />
  </svg>
)
const IconValuation = () => (
  <svg {...NAV_ICON}>
    <path d="M15.44 10.06l-5.38 5.38a1.5 1.5 0 0 1-2.12 0L1.5 9V1.5H9l6.44 6.44a1.5 1.5 0 0 1 0 2.12z" />
    <circle cx="5.25" cy="5.25" r="0.9" />
  </svg>
)
const IconMarket = () => (
  <svg {...NAV_ICON}>
    <path d="M15.75 7.5c0 5.25-6.75 9.75-6.75 9.75s-6.75-4.5-6.75-9.75a6.75 6.75 0 0 1 13.5 0z" />
    <circle cx="9" cy="7.5" r="2.25" />
  </svg>
)
const IconInsights = () => (
  <svg {...NAV_ICON}>
    <path d="M2.2 15.8h13.6" />
    <path d="M13.5 15V7.5M9 15V3M4.5 15v-4.5" />
  </svg>
)
const IconHealth = () => (
  <svg {...NAV_ICON}>
    <path d="M16.5 9h-3l-2.25 6.75L6.75 2.25 4.5 9H1.5" />
  </svg>
)

const PRODUCT_ITEMS = [
  { to: '/', label: 'Overview', end: true, Icon: IconOverview },
  { to: '/valuation', label: 'Valuation', Icon: IconValuation },
  { to: '/market', label: 'Market Intelligence', Icon: IconMarket },
  { to: '/model', label: 'Model Insights', Icon: IconInsights },
  { to: '/health', label: 'Model Health', Icon: IconHealth },
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

/* WORKFLOW_STORAGE_KEY comes from pages/workflow/stages (the shell mirrors
   the active dataset there; the sidebar only reads it) — imported from that
   dependency-free module so the lazy workflow pages stay out of this bundle. */

/** Shell-owned persistence: the desktop sidebar collapse preference. */
const SHELL_STORAGE_KEY = 'proppulse:shell'

/**
 * One sidebar item: `li.is-active > a > [step-num|icon] + step-label`, exactly
 * the reference stepper DOM. `useMatch` drives the active state so the <li>
 * can carry `is-active` (blueprint §4 selector) and the link `aria-current`.
 * Icons are aria-hidden decoration; the accessible name stays the label.
 */
function SidebarItem({ to, num, label, end = false, dataStage, Icon = null }) {
  const match = useMatch({ path: to, end })
  return (
    <li className={match ? 'is-active' : undefined}>
      <Link
        to={to}
        aria-current={match ? 'page' : undefined}
        data-stage={dataStage}
      >
        {num && <span className="step-num">{num}</span>}
        {Icon && (
          <span className="shell-nav-icon" aria-hidden="true">
            <Icon />
          </span>
        )}
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

/** Short visible word for the ≤900px chip (the full label stays the
    aria-label) — a colour-only dot is never the sole status signal. */
const STATUS_SHORT = {
  checking: 'Checking',
  up: 'Connected',
  degraded: 'Degraded',
  down: 'Offline',
}

/** "Checked 16:47:03" meta under the status pill (24h, tabular). */
function checkedMeta(checkedAt) {
  if (!checkedAt) return 'Awaiting first check'
  const pad = (n) => String(n).padStart(2, '0')
  return `Checked ${pad(checkedAt.getHours())}:${pad(checkedAt.getMinutes())}:${pad(
    checkedAt.getSeconds(),
  )}`
}

function ApiStatus({ status, onRecheck }) {
  return (
    <button
      type="button"
      className={`api-status api-status--${status} shell-status-pill`}
      onClick={onRecheck}
      title={`${STATUS_LABEL[status]} — click to re-check`}
      aria-live="polite"
    >
      <span className="api-status-dot" aria-hidden="true" />
      <span className="shell-status-label">{STATUS_LABEL[status]}</span>
      <svg
        className="shell-status-recheck"
        width="13"
        height="13"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M13.4 2.3v3.5H9.9" />
        <path d="M11.95 8.75a5.25 5.25 0 1 1-1.24-5.46L13.4 5.83" />
      </svg>
    </button>
  )
}

/** Alert glyph for the API banners (severity colour comes from the banner). */
function BannerIcon() {
  return (
    <svg
      className="shell-banner-icon"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.86 2.57 1.21 12a1.33 1.33 0 0 0 1.14 2h11.3a1.33 1.33 0 0 0 1.14-2L9.14 2.57a1.33 1.33 0 0 0-2.28 0z" />
      <path d="M8 6v2.67" />
      <path d="M8 11.33h.01" />
    </svg>
  )
}

export default function Layout() {
  const { status, checkedAt, recheck } = useApiStatus()
  const location = useLocation()
  const sidebarRef = useRef(null)
  const mainRef = useRef(null)
  const prevPathRef = useRef(location.pathname)
  const [storedWorkflow] = useLocalStorage(WORKFLOW_STORAGE_KEY, null)
  const activeDatasetId =
    typeof storedWorkflow?.dataset_id === 'string' ? storedWorkflow.dataset_id : 'ames'

  const [storedShell, setStoredShell] = useLocalStorage(SHELL_STORAGE_KEY, null)
  const sidebarCollapsed = storedShell?.collapsed === true
  const toggleSidebar = useCallback(() => {
    setStoredShell((prev) => ({
      ...(prev && typeof prev === 'object' ? prev : {}),
      collapsed: !(prev?.collapsed === true),
    }))
  }, [setStoredShell])

  useEffect(() => {
    document.title =
      TITLES[location.pathname] ??
      workflowDocumentTitle(location.pathname) ??
      '404 · PropPulse'
  }, [location.pathname])

  // Keep the active stepper item visible inside the ≤900px horizontal strip.
  // On desktop .shell-navwrap is the vertical nav scroller, so horizontal
  // scrollLeft remains a no-op. Manual scrollLeft, NOT
  // scrollIntoView: scrollIntoView also moves Chromium's sequential-focus
  // start point to the active link, so the first Tab after navigation would
  // skip the skip-link and every nav item before the active one (hardening
  // §21 keyboard-walk regression).
  useEffect(() => {
    const active = sidebarRef.current?.querySelector('.pipeline-stepper li.is-active a')
    const strip = active?.closest('.shell-navwrap') ?? active?.closest('.pipeline-stepper')
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
    <div className={`app-shell shell-root${sidebarCollapsed ? ' shell-root--collapsed' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="pipeline-sidebar" ref={sidebarRef}>
        <div className="shell-brandrow">
          <Link className="sidebar-brand" to="/">
            <span className="brand-mark" aria-hidden="true">
              <svg
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1.8 8.2h2.3l1.6-4 2.6 8 1.7-4h3.3" />
              </svg>
            </span>
            <span className="brand-text">
              <span className="brand-line-1">PropPulse</span>
              <span className="brand-line-2">Property Intelligence</span>
            </span>
          </Link>

          {/* Compact API-status chip for the ≤900px top bar (CSS shows it
              only there); mirrors ApiStatus's states, non-interactive. The
              visible short word means the dot is never colour-only. */}
          <span
            className={`api-status-compact api-status-compact--${status}`}
            role="status"
            aria-label={STATUS_LABEL[status]}
          >
            <span className="api-status-dot" aria-hidden="true" />
            <span aria-hidden="true">
              {STATUS_SHORT[status]}
            </span>
          </span>
        </div>

        <div className="shell-navwrap">
          <p className="nav-caption shell-caption">Pipeline</p>
          <nav className="pipeline-stepper shell-nav" aria-label="ML pipeline stages">
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

          <p className="nav-caption shell-caption shell-caption--product">Product</p>
          <nav
            className="pipeline-stepper pipeline-stepper--product shell-nav shell-nav--product"
            aria-label="Product pages"
          >
            <ol>
              {PRODUCT_ITEMS.map((item) => (
                <SidebarItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  end={item.end}
                  Icon={item.Icon}
                />
              ))}
            </ol>
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="shell-foot-fact">
            <span className="shell-foot-caption">Dataset</span>
            <span className="sidebar-dataset">{activeDatasetId}</span>
          </div>
          <div className="shell-status-card">
            <ApiStatus status={status} onRecheck={recheck} />
            <span className="shell-status-meta">{checkedMeta(checkedAt)}</span>
          </div>
        </div>

        <button
          type="button"
          className="shell-collapse"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleSidebar}
        >
          <svg
            className="shell-collapse-icon"
            width="15"
            height="15"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M8.6 3.2 5 7.5l3.6 4.3" />
            <path d="M12.4 3.2 8.8 7.5l3.6 4.3" />
          </svg>
          <span className="shell-collapse-label">Collapse</span>
        </button>
      </aside>

      <div className="app-body">
        {status === 'down' && (
          <div className="error-banner" role="alert">
            <span className="shell-banner-msg">
              <BannerIcon />
              <span>
                <strong>API offline.</strong> Valuations and market data are
                unavailable until the backend responds.
              </span>
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={recheck}>
              Retry connection
            </button>
          </div>
        )}
        {status === 'degraded' && (
          <div className="error-banner error-banner--warn" role="alert">
            <span className="shell-banner-msg">
              <BannerIcon />
              <span>
                <strong>API degraded.</strong> One or more models are not loaded;
                some features may be unavailable.
              </span>
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
