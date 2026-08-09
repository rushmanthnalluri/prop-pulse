import { Component } from 'react'

/**
 * Failed lazy-chunk loads (offline mid-navigation, a deploy replacing hashed
 * assets, Vite's CSS preload failing). React caches the rejected import
 * forever, so a soft reset instantly re-throws — only a reload recovers.
 */
const CHUNK_LOAD_RE =
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload/i

function isChunkLoadError(error) {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  return CHUNK_LOAD_RE.test(String(error.message ?? ''))
}

/**
 * Route-level error boundary. A contract drift or render exception inside one
 * page must never white-screen the whole app — show a branded recovery state
 * instead. The component stack goes to the console (never to the UI).
 *
 * Recovery ladder (AUDIT §3.2): "Try again" soft-resets the boundary and
 * re-renders the children (transient render errors recover without losing
 * app state); "Reload page" is the hard fallback; "Back to overview" leaves
 * the broken route. Route boundaries also remount per route via the keys in
 * App.jsx.
 *
 * Chunk-load failures are detected explicitly (WP-7c): for those the primary
 * action is an honest "Reload page", because the poisoned lazy import makes
 * "Try again" a dead end.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.handleReset = () => this.setState({ error: null })
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[PropPulse] render failure:', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      const chunkLoad = isChunkLoadError(this.state.error)
      return (
        <div className="crash-box">
          <div className="alert alert-error" role="alert">
            <span className="alert-title">This section failed to render</span>
            {chunkLoad
              ? 'This section could not be loaded — the connection dropped or the app was updated mid-session. Reloading fetches a fresh copy.'
              : 'An unexpected error occurred while displaying this view. Your data is safe — the rest of the app is unaffected.'}
            <div className="alert-actions">
              {chunkLoad ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => window.location.reload()}
                >
                  Reload page
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={this.handleReset}
                >
                  Try again
                </button>
              )}
              {!chunkLoad && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => window.location.reload()}
                >
                  Reload page
                </button>
              )}
              <a className="btn btn-secondary btn-sm" href="/">
                Back to overview
              </a>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
