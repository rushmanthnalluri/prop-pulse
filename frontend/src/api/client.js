/**
 * Thin API client for the PropPulse backend (CONTRACT §0/§5, AUDIT §1.3).
 *
 * Base URL comes from `VITE_API_URL` (default `http://localhost:8000`); routes
 * are root-level — no `/api` prefix. No prediction data is ever hardcoded here;
 * every number rendered in the UI comes from a live response.
 *
 * Every request carries a 30s timeout (AUD-10) so a stalled-but-open connection
 * surfaces an error instead of spinning forever. Callers may pass an AbortSignal
 * via `options.signal` to cancel in-flight requests (e.g. on component unmount);
 * such cancellations reject with an `AbortError` and are swallowed by callers.
 *
 * Error normalization (CONTRACT §5.11):
 * - FastAPI 422 bodies carry a structured `detail` list; it is exposed verbatim
 *   (mapped to a stable shape) on `ApiError.details` so pages can map errors to
 *   form fields without parsing strings. `ApiError.message` keeps the flattened
 *   "field: msg; field2: msg2" form for generic display.
 * - 413 (body > 64 KiB) and network/timeout failures get plain-language
 *   messages; network failure also detects `navigator.onLine === false`.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')

export { API_URL }

/** Max time any API request may stay in flight before it is aborted (AUD-10). */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * One entry of a FastAPI 422 `detail` list, normalized to a stable shape.
 * `field` is the request-body field path with the leading "body" segment
 * stripped (e.g. "gr_liv_area"); it is null for non-field errors. `msg` is the
 * API's verbatim validation message. `type` is the pydantic error type
 * ("missing", "less_than_equal", "extra_forbidden", …) when present.
 *
 * @typedef {Object} FieldError
 * @property {string|null} field
 * @property {string[]} loc - raw `loc` segments from the API
 * @property {string} msg
 * @property {string} [type]
 */

/** Error raised for non-2xx responses and unreachable hosts. */
export class ApiError extends Error {
  /**
   * @param {string} message - human-readable, display-ready message
   * @param {number} status - HTTP status, or 0 for network failure/timeout
   * @param {{details?: FieldError[]|null}} [extra] - structured 422 field errors
   */
  constructor(message, status, { details = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    /** @type {FieldError[]|null} parsed 422 field errors, else null */
    this.details = details
  }

  /** True when the request never got an HTTP response (offline/timeout/DNS). */
  get isNetworkError() {
    return this.status === 0
  }
}

/**
 * Map an error's structured 422 details to `{ fieldName: message }` for form
 * display — the replacement for regex-parsing `error.message` (AUDIT §5.7).
 * First error per field wins. Returns {} for non-422/non-ApiError errors and
 * for service-layer 422s whose detail is a plain string.
 *
 * @param {unknown} error
 * @returns {Object<string, string>}
 */
export function fieldErrorMap(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {}
  const map = {}
  for (const item of error.details) {
    if (item.field && !(item.field in map)) map[item.field] = item.msg
  }
  return map
}

/** Parse a FastAPI 422 detail list into the stable FieldError[] shape. */
function extractDetails(payload) {
  if (!payload || !Array.isArray(payload.detail)) return null
  return payload.detail.map((item) => {
    const loc = Array.isArray(item?.loc) ? item.loc.map(String) : []
    const field = loc.filter((p) => p !== 'body').join('.') || null
    return {
      field,
      loc,
      msg: typeof item?.msg === 'string' ? item.msg : 'Invalid value',
      type: typeof item?.type === 'string' ? item.type : undefined,
    }
  })
}

/** Turn a FastAPI error body into a readable message (handles 422 detail lists). */
function extractDetail(payload, fallback) {
  if (!payload) return fallback
  if (typeof payload.detail === 'string') return payload.detail
  if (Array.isArray(payload.detail)) {
    return payload.detail
      .map((item) => {
        const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body').join('.') : ''
        return loc ? `${loc}: ${item.msg}` : item.msg
      })
      .join('; ')
  }
  return fallback
}

async function request(path, options = {}) {
  const { signal: callerSignal, ...rest } = options
  // AUD-10: every request times out after REQUEST_TIMEOUT_MS; a caller-supplied
  // signal (unmount cleanup) races with the timeout via AbortSignal.any.
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...rest,
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error // caller-initiated cancel; callers ignore it
    if (error?.name === 'TimeoutError') {
      throw new ApiError(
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds — the API may be busy or unreachable. Check your connection and try again.`,
        0,
      )
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('You appear to be offline. Check your connection and try again.', 0)
    }
    throw new ApiError(
      `Cannot reach the PropPulse API at ${API_URL}. Is the backend running?`,
      0,
    )
  }
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    if (response.status === 413) {
      // CONTRACT §0: bodies over 65,536 bytes are rejected; legit prediction
      // payloads are < 1 KiB, so reaching this means a client bug.
      throw new ApiError('The request was too large for the API (limit 65,536 bytes).', 413)
    }
    throw new ApiError(
      extractDetail(payload, `Request failed with status ${response.status}`),
      response.status,
      { details: extractDetails(payload) },
    )
  }
  return payload
}

/**
 * Session cache for the four static GET payloads — /model/info,
 * /model/importance, /market/clusters, /market/trends are built once at server
 * startup and never change within a session, and every response is
 * `Cache-Control: no-store`, so HTTP caching is unavailable (CONTRACT §5.15).
 *
 * Entries hold the in-flight/resolved promise so concurrent consumers share one
 * request. A rejected request is evicted, so the next call simply refetches —
 * retries after an error keep working.
 */
const sessionCache = new Map()

function cachedGet(path) {
  const hit = sessionCache.get(path)
  if (hit) return hit
  // Signal-free BY DESIGN: the promise is shared by every concurrent consumer,
  // so it must never be bound to one caller's AbortSignal. Binding it let a
  // StrictMode double-mount (or any unmount-while-in-flight) abort the shared
  // request, and a consumer mounting in the same commit grabbed the doomed
  // promise before the eviction microtask ran — useApi swallows the AbortError
  // and the page skeletons forever. Unmount safety lives in useApi's
  // `cancelled` flag instead; the 30s timeout inside request() still applies.
  const promise = request(path)
  sessionCache.set(path, promise)
  promise.catch(() => {
    if (sessionCache.get(path) === promise) sessionCache.delete(path)
  })
  return promise
}

/** Drop all cached static GETs (e.g. after a known server restart). */
export function clearApiCache() {
  sessionCache.clear()
}

/**
 * Typed helpers — one per real endpoint (CONTRACT §1). POST helpers take the
 * PropertyInput body; all helpers may be called with an optional trailing
 * AbortSignal. The four session-cached static GETs accept one too for call-site
 * uniformity, but it is deliberately NOT bound to the shared request (see
 * cachedGet) — a cache entry must outlive any single consumer.
 */
export const api = {
  /**
   * GET /health → `{ status: "ok", models_loaded: { regression, classification } }`
   * Live liveness; never cached. ~5 ms.
   */
  health: (signal) => request('/health', { signal }),

  /**
   * GET /metrics → `{ requests_total, errors_total, requests_by_path,
   * avg_latency_ms, uptime_seconds, drift }`. Counters are per-process and
   * reset on restart; `drift` is a file snapshot (currently status "no_data").
   * Live; never cached.
   */
  metrics: (signal) => request('/metrics', { signal }),

  /**
   * POST /predict → full bundle `{ estimated_price, price_range {low, high},
   * sale_probability {probability, sells_within_30_days, threshold},
   * micro_market, top_price_factors (may be []), market_position, confidence
   * {level: "typical"|"reduced", reasons}, model_version }`. ~180 ms warm;
   * CPU-bound at ~4–5 req/s — always show busy feedback.
   */
  predict: (body, signal) =>
    request('/predict', { method: 'POST', body: JSON.stringify(body), signal }),

  /**
   * POST /predict/price → `{ estimated_price, price_range, market_position,
   * confidence, model_version }` (no classifier, no SHAP). ~27 ms — used by
   * the what-if explorer.
   */
  predictPrice: (body, signal) =>
    request('/predict/price', { method: 'POST', body: JSON.stringify(body), signal }),

  /**
   * POST /predict/sale-probability → `{ probability, sells_within_30_days,
   * threshold, confidence, model_version }` (no regressor, no SHAP). ~144 ms.
   * The target is SIMULATED (ADR-3) — pair with the simulated-target caveat.
   */
  predictSaleProbability: (body, signal) =>
    request('/predict/sale-probability', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),

  /**
   * GET /model/info → champion metadata: `{ regression, classification,
   * clustering, selected_at, dataset_version, feature_version, n_features,
   * rationale, headline_metrics }` (val + test metrics incl. confusion
   * matrices and the champion-vs-runner-up bootstrap). Session-cached.
   */
  modelInfo: () => cachedGet('/model/info'),

  /**
   * GET /model/importance → `{ metadata, importance: { <model feature>: mean
   * |SHAP| in log1p(SalePrice) units } }` (94 features; relative influence,
   * not dollars). 503 if the artifact is missing. Session-cached.
   */
  modelImportance: () => cachedGet('/model/importance'),

  /**
   * GET /market/clusters → `{ n_clusters: 4, clusters: [...],
   * neighborhoods: [{ neighborhood, name, lat, long, cluster_id, fallback
   * }] }` — one map point per all 25 neighborhoods (approximate centroids).
   * Session-cached.
   */
  marketClusters: () => cachedGet('/market/clusters'),

  /**
   * GET /market/trends → `{ periods: ["2006H1"…"2008H2"], series: [{ cluster,
   * label, median_price: […], sales_count: […] }], note }`. `median_price` is
   * null where a cluster had no sales that half-year — render as a gap, never
   * interpolate. Session-cached.
   */
  getTrends: () => cachedGet('/market/trends'),

  /**
   * POST /market/comps → `{ comps: [top-5 train sales], match_scope:
   * "neighborhood"|"cluster", percentile, note, calendar_clamped }`.
   * Historical 2006–2008 training sales, not current listings. Never cached
   * (depends on the request body).
   */
  getComps: (body, signal) =>
    request('/market/comps', { method: 'POST', body: JSON.stringify(body), signal }),
}
