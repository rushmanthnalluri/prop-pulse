/**
 * App shell: sidebar navigation (desktop) / topbar (≤900px), API status pill
 * with a 30s poll, and a global error banner while the API is unreachable.
 * The poll pauses when the tab is hidden and re-checks immediately on
 * visibility return or manual click; window online/offline events update the
 * pill promptly between polls (WP-7c).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { api } from '../api/client'
import { workflowDocumentTitle } from '../pages/workflow/stages'

const NAV_GROUPS = [
  {
    caption: 'Analyze',
    items: [
      { to: '/', label: 'Overview', end: true },
      { to: '/valuation', label: 'Valuation' },
      { to: '/market', label: 'Market Intelligence' },
    ],
  },
  {
    caption: 'Platform',
    items: [
      { to: '/model', label: 'Model Insights' },
      { to: '/health', label: 'Model Health' },
    ],
  },
  {
    // WORKFLOW §6.1: the guided ML workbench beside the champion product.
    caption: 'Workbench',
    items: [{ to: '/workflow', label: 'ML Workbench' }],
  },
]

const TITLES = {
  '/': 'Overview — PropPulse',
  '/valuation': 'Valuation — PropPulse',
  '/market': 'Market Intelligence — PropPulse',
  '/model': 'Model Insights — PropPulse',
  '/health': 'Model Health — PropPulse',
}

function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect width="26" height="26" rx="6" fill="#123152" />
      <path d="M6 15.5 13 9l7 6.5" fill="none" stroke="#0e7a6d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 18.5h9" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </svg>
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

function NavItems({ onNavigate }) {
  return NAV_GROUPS.map((group) => (
    <div key={group.caption}>
      <div className="nav-caption">{group.caption}</div>
      {group.items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          onClick={onNavigate}
        >
          <span className="nav-item-label">{item.label}</span>
        </NavLink>
      ))}
    </div>
  ))
}

export default function Layout() {
  const { status, recheck } = useApiStatus()
  const location = useLocation()
  const topNavRef = useRef(null)

  useEffect(() => {
    document.title =
      TITLES[location.pathname] ??
      workflowDocumentTitle(location.pathname) ??
      'Page not found — PropPulse'
  }, [location.pathname])

  // Keep the active topbar item visible on small screens.
  useEffect(() => {
    const active = topNavRef.current?.querySelector('.nav-item.active')
    active?.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
  }, [location.pathname])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="side-brand">
          <BrandMark />
          <div>
            <div className="side-brand-name">PropPulse</div>
            <div className="side-brand-tag">Property Intelligence</div>
          </div>
        </div>
        <nav className="side-nav" aria-label="Primary">
          <NavItems />
        </nav>
        <div className="side-foot">
          <ApiStatus status={status} onRecheck={recheck} />
          <div className="side-foot-meta">
            Ames, IA · training window
            <br />
            2006–2008 · 25 neighborhoods
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="topbar-brand">
            <div className="side-brand" style={{ border: 'none', padding: 0 }}>
              <BrandMark />
              <div className="side-brand-name">PropPulse</div>
            </div>
            <ApiStatus status={status} onRecheck={recheck} />
          </div>
          <nav className="topbar-nav" aria-label="Primary" ref={topNavRef}>
            <NavItems />
          </nav>
        </div>

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

        <main className="container" id="main">
          <Outlet />
        </main>

        <footer className="site-foot">
          PropPulse · property intelligence for Ames, IA · sale-speed target is
          simulated (ADR-3) · historical sales 2006–2008, not current listings
        </footer>
      </div>
    </div>
  )
}
