/**
 * Typed client for the guided-ML-workbench endpoints (WORKFLOW §3, binding
 * spec `docs/frontend/workflow-architecture.md`). Every route lives under the
 * root-level `/workflow` prefix; every number a stage page renders must come
 * from one of these functions — nothing is hardcoded.
 *
 * Built on `api/client.js` conventions: same `ApiError` class, same 30s
 * timeout (AUD-10), same caller-AbortSignal racing, same offline/timeout
 * message wording. `client.js`'s `request()` is module-private, so the thin
 * wrapper is reimplemented here with two workflow-specific additions:
 *
 * 1. **Upload transport** (§3.1): raw CSV bytes as the body — no multipart
 *    (python-multipart is absent server-side). `uploadDataset` always sends
 *    `Content-Type: text/csv`; Windows reports some .csv files as
 *    `application/vnd.ms-excel`, which the server whitelist rejects (415).
 * 2. **Dict-shaped 422** (§3 "one documented deviation"): upload-validation
 *    failures carry `{"detail": {"code", "message", "report"}}` instead of
 *    FastAPI's `{"detail": [...]}`. Both shapes are normalized onto `ApiError`:
 *    list shape → `error.details` (FieldError[], as in client.js); dict shape
 *    → `error.code` + `error.report` (see `uploadReportOf`).
 *
 * Job polling (§3.9/§6.3-07): `useJobPolling` wraps `hooks/usePolling` (which
 * already pauses while the tab is hidden) and stops at the terminal state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, ApiError, REQUEST_TIMEOUT_MS } from './client'
import { usePolling } from '../hooks/usePolling'

/* ------------------------------------------------------------------------- */
/* Constants                                                                  */
/* ------------------------------------------------------------------------- */

/** Client-side upload pre-check limit (§2.3 — mirrors the server rule). */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024

/** The three training objectives (§3.9). */
export const OBJECTIVES = ['regression', 'classification', 'clustering']

/** Valid `candidates` values per objective for POST …/jobs (§3.9). */
export const OBJECTIVE_CANDIDATES = {
  regression: ['linear', 'ridge', 'lasso', 'random_forest', 'xgboost'],
  classification: ['logistic', 'decision_tree', 'random_forest', 'xgboost'],
  clustering: ['dbscan'],
}

/** Job statuses that mean "still working" (§3.9); anything else is terminal. */
export const ACTIVE_JOB_STATUSES = new Set(['queued', 'preparing', 'running'])

export const isJobActive = (status) => ACTIVE_JOB_STATUSES.has(status)
export const isJobTerminal = (status) => status === 'done' || status === 'failed'

/* ------------------------------------------------------------------------- */
/* Error normalization (client.js semantics + the dict-shaped 422)            */
/* ------------------------------------------------------------------------- */

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

/**
 * The workflow upload 422 deviation (§3): `detail` is a dict
 * `{code, message, report}` so the UI can render per-check results. Surfaced
 * on the ApiError as `.code` / `.report`.
 */
function isWorkflowValidationDetail(payload) {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    payload.detail !== null &&
    typeof payload.detail === 'object' &&
    !Array.isArray(payload.detail)
  )
}

async function workflowRequest(path, options = {}) {
  const { signal: callerSignal, headers = {}, tooLargeMessage, ...rest } = options
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Accept: 'application/json', ...headers },
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
      throw new ApiError(tooLargeMessage ?? 'The request was too large for the API.', 413)
    }
    if (response.status === 422 && isWorkflowValidationDetail(payload)) {
      const { code, message, report } = payload.detail
      const error = new ApiError(
        typeof message === 'string' ? message : 'The dataset failed validation.',
        422,
      )
      /** Upload-validation code, e.g. "corrupt_csv" | "schema_mismatch" (§3.1). */
      error.code = typeof code === 'string' ? code : 'validation_failed'
      /** Structured per-check report (missing_columns, n_duplicate_ids, …). */
      error.report = report ?? null
      throw error
    }
    throw new ApiError(
      extractDetail(payload, `Request failed with status ${response.status}`),
      response.status,
      { details: extractDetails(payload) },
    )
  }
  return payload // null for 204 No Content
}

/** JSON POST convenience wrapper. */
function postJson(path, body, signal, extra = {}) {
  return workflowRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    signal,
    ...extra,
  })
}

/**
 * Read the upload-validation report off an error, uniformly for callers:
 * returns `{code, message, report}` for the dict-shaped workflow 422, else
 * null (F2's ValidationReport keys off this).
 *
 * @param {unknown} error
 * @returns {{code: string, message: string, report: Object|null}|null}
 */
export function uploadReportOf(error) {
  if (error instanceof ApiError && error.status === 422 && typeof error.code === 'string') {
    return { code: error.code, message: error.message, report: error.report ?? null }
  }
  return null
}

/** Build a query string, dropping undefined/null/empty values. */
function qs(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const str = search.toString()
  return str ? `?${str}` : ''
}

/* ------------------------------------------------------------------------- */
/* Payload typedefs (§3)                                                      */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {Object} DatasetRecord
 * @property {string} dataset_id - "ames" (bundled) or "ds_" + 8 hex chars
 * @property {string} name - sanitized filename, e.g. "my-houses.csv"
 * @property {"bundled"|"upload"} source
 * @property {string} created_at - ISO-8601
 * @property {string} sha256_12 - first 12 hex chars of the stored raw.csv sha256
 * @property {number} n_rows
 * @property {number} n_cols
 * @property {boolean} deletable - false only for the bundled ames record
 * @property {Object|null} [prepare] - persisted prepare record (config, fingerprint, prepared_at)
 */

/**
 * @typedef {Object} DatasetState - the stepper's server truth (§3.2/§6.2)
 * @property {boolean} prepared
 * @property {Object|null} prepare_config
 * @property {{total: number, running: number, done: number, failed: number}} jobs
 * @property {string[]} objectives_done - e.g. ["regression"]
 * @property {boolean} can_train
 * @property {boolean} can_evaluate - gates stage 08
 * @property {boolean} can_predict_sandbox - gates the sandbox half of stage 09
 * @property {string|null} train_blocked_reason - set when can_train is false
 */

/**
 * @typedef {Object} JobStatus - the job protocol payload (§3.9)
 * @property {string} job_id
 * @property {string} dataset_id
 * @property {"regression"|"classification"|"clustering"} objective
 * @property {"queued"|"preparing"|"running"|"done"|"failed"} status
 * @property {{done: number, total: number, current: string|null, elapsed_s: number}} progress
 * @property {Object<string, {status: "pending"|"running"|"done"|"failed", val_metrics?: Object, best_params?: Object, train_seconds?: number, error?: string}>} results
 * @property {string} [prepare_fingerprint] - the prepare split the job trained on (red-team F1)
 * @property {string|null} error
 * @property {string} created_at
 * @property {string|null} finished_at
 */

/**
 * @typedef {Object} ModelsResponse - the stage-07 comparison table source (§3.9)
 * @property {string} objective
 * @property {string} dataset_id
 * @property {Array<{name: string, job_id: string, trained_at: string, val_metrics: Object, best_params: Object, train_seconds: number, best: boolean, prepare_fingerprint?: string, stale_split?: boolean}>} candidates
 *   (`stale_split: true` flags rows trained on a superseded prepare config — F1)
 * @property {{metric: string, rule: string, note: string}} selection
 * @property {Object|null} bootstrap - regression-only paired bootstrap, else null
 *   (also null when the compared pair spans different prepare fingerprints — F1)
 * @property {{dataset: string, n_train: number, n_val: number, simulated_target: boolean, prepare_fingerprint?: string}} provenance
 */

/* ------------------------------------------------------------------------- */
/* Datasets (§3.1-3.2)                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Upload + validate a CSV (stage 01). Raw-body transport — pass the `File`
 * straight from an <input type="file"> or drop handler, or a CSV string.
 * Content-Type is always `text/csv` (see module docstring). Resolves with the
 * 201 payload `{…record, validation: {ok, checks[]}, preview: {head[8]}}`;
 * rejects with ApiError (413 >10 MiB, 415 wrong type, 422 validation —
 * read `uploadReportOf(error)`).
 *
 * @param {File|Blob|string} body
 * @param {string} [filename='upload.csv']
 * @param {AbortSignal} [signal]
 */
export function uploadDataset(body, filename = 'upload.csv', signal) {
  return workflowRequest(`/workflow/datasets${qs({ filename })}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/csv' },
    signal,
    tooLargeMessage: 'That file is over the 10 MiB upload limit.',
  })
}

/** GET /workflow/datasets → DatasetRecord[] (bundled "ames" first). */
export function listDatasets(signal) {
  return workflowRequest('/workflow/datasets', { signal })
}

/** GET /workflow/datasets/{id} → DatasetRecord + `state` (DatasetState). */
export function getDataset(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}`, { signal })
}

/** GET /workflow/datasets/{id}/state → DatasetState (bare state object). */
export function getState(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/state`, { signal })
}

/** DELETE /workflow/datasets/{id} → null (204). 400 bundled; 409 job running. */
export function deleteDataset(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal,
  })
}

/* ------------------------------------------------------------------------- */
/* EDA (§3.3-3.7)                                                             */
/* ------------------------------------------------------------------------- */

/** GET …/profile (stage 01 result) → `{n_rows, n_cols, n_numeric, n_categorical, n_duplicate_ids, total_missing_cells, head[8], columns[]}`. */
export function getProfile(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/profile`, { signal })
}

/** GET …/features (stage 02) → `{raw_features[], pipeline_features[], targets, recommended_split}`. */
export function getFeatures(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/features`, { signal })
}

/** GET …/stats (stage 03) → `{numeric[], categorical[], target}`. */
export function getStats(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/stats`, { signal })
}

/** GET …/missing (stage 04) → `{total_missing, n_columns_with_missing, n_complete_columns, columns[], blocking[]}`. */
export function getMissing(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/missing`, { signal })
}

/** Stage-05 pre-aggregated viz payloads (§3.7). Column names are validated server-side (422 otherwise). */
export const viz = {
  /** @param {{column: string, bins?: number}} params → `{column, bins: [{x0,x1,count}], stats}` */
  histogram: (id, { column, bins } = {}, signal) =>
    workflowRequest(
      `/workflow/datasets/${encodeURIComponent(id)}/viz/histogram${qs({ column, bins })}`,
      { signal },
    ),
  /** @param {{x: string, y: string, maxPoints?: number}} params → `{x, y, points, n_total, sampled}` */
  scatter: (id, { x, y, maxPoints } = {}, signal) =>
    workflowRequest(
      `/workflow/datasets/${encodeURIComponent(id)}/viz/scatter${qs({ x, y, max_points: maxPoints })}`,
      { signal },
    ),
  /** @param {{column: string, by: string}} params → `{column, by, groups[]}` (≤25 groups, median desc) */
  box: (id, { column, by } = {}, signal) =>
    workflowRequest(
      `/workflow/datasets/${encodeURIComponent(id)}/viz/box${qs({ column, by })}`,
      { signal },
    ),
  /** @param {{target?: string, top?: number}} params → `{target, features[], matrix[][]}` */
  correlation: (id, { target, top } = {}, signal) =>
    workflowRequest(
      `/workflow/datasets/${encodeURIComponent(id)}/viz/correlation${qs({ target, top })}`,
      { signal },
    ),
  /** @param {{column: string, agg?: "median"|"mean"|"count", target?: string}} params → `{column, target, agg, groups[]}` */
  category: (id, { column, agg, target } = {}, signal) =>
    workflowRequest(
      `/workflow/datasets/${encodeURIComponent(id)}/viz/category${qs({ column, agg, target })}`,
      { signal },
    ),
}

/* ------------------------------------------------------------------------- */
/* Preprocessing (§3.8)                                                       */
/* ------------------------------------------------------------------------- */

/** GET …/preprocess → `{prepared, config, fingerprint, summary|null}`. */
export function getPreprocess(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/preprocess`, { signal })
}

/**
 * POST …/preprocess/preview — runs AND PERSISTS the real prepare chain
 * (stage 07 trains on exactly what was previewed). Sync, ~5s at the row cap.
 * @param {Object} config - `{outlier_rule, split_strategy: "auto"|"time"|"random", val_frac, test_frac, seed}`
 * @returns PrepareReport `{config, fingerprint, splits{train,val,test,rule}, steps[], before, after, sample_before, sample_after, leakage_note}`
 */
export function previewPreprocess(id, config, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/preprocess/preview`, {
    method: 'POST',
    body: JSON.stringify({ config }),
    headers: { 'Content-Type': 'application/json' },
    signal,
  })
}

/* ------------------------------------------------------------------------- */
/* Training jobs, comparison, evaluation, sandbox predict (§3.9-3.11)         */
/* ------------------------------------------------------------------------- */

/**
 * POST …/jobs → 202 `{job_id, status: "queued", links}`.
 * 400 objective blocked by the row window; 409 names the running job;
 * 422 unknown candidates (the response lists the valid ones).
 * @param {"regression"|"classification"|"clustering"} objective
 * @param {string[]} candidates - from OBJECTIVE_CANDIDATES[objective]
 */
export function startJob(id, objective, candidates, signal) {
  return postJson(
    `/workflow/datasets/${encodeURIComponent(id)}/jobs`,
    { objective, candidates },
    signal,
  )
}

/** GET /workflow/jobs/{jobId} → JobStatus. */
export function getJob(jobId, signal) {
  return workflowRequest(`/workflow/jobs/${encodeURIComponent(jobId)}`, { signal })
}

/** GET /workflow/datasets/{id}/jobs → JobStatus[] newest-first. */
export function listJobs(id, signal) {
  return workflowRequest(`/workflow/datasets/${encodeURIComponent(id)}/jobs`, { signal })
}

/** GET …/models?objective=… → ModelsResponse (stage-07 comparison table). */
export function getModels(id, objective, signal) {
  return workflowRequest(
    `/workflow/datasets/${encodeURIComponent(id)}/models${qs({ objective })}`,
    { signal },
  )
}

/**
 * GET /workflow/jobs/{jobId}/evaluation/{candidate} → per-objective payload
 * (§3.10): regression `{metrics, actual_vs_predicted, residual_hist, importance}`;
 * classification `{metrics_at_f1, metrics_at_0_5, roc, pr, calibration, positive_rate, simulated_target: true}`;
 * clustering `{eps, min_samples, n_clusters, n_noise, clusters, assignments, rationale}` (no silhouette).
 * 404 unknown job/candidate; 409 job not done / candidate failed.
 */
export function getEvaluation(jobId, candidate, signal) {
  return workflowRequest(
    `/workflow/jobs/${encodeURIComponent(jobId)}/evaluation/${encodeURIComponent(candidate)}`,
    { signal },
  )
}

/**
 * POST /workflow/jobs/{jobId}/predict/{candidate} — sandbox prediction
 * (stage 09, workbench-only). `payload` is the existing PropertyInput schema.
 * Regression → `{estimated_price, price_range, interval_note, model, provenance}`;
 * classification → `{probability, threshold, sells_within_30_days, simulated_target: true, model, provenance}`.
 * `provenance.label` is verbatim "Sandbox model — trained on your upload; not
 * the PropPulse champion." — render it through ProvenanceBanner.
 */
export function sandboxPredict(jobId, candidate, payload, signal) {
  return postJson(
    `/workflow/jobs/${encodeURIComponent(jobId)}/predict/${encodeURIComponent(candidate)}`,
    payload,
    signal,
  )
}

/* ------------------------------------------------------------------------- */
/* Job polling (§3.9 / §6.3-07)                                               */
/* ------------------------------------------------------------------------- */

/**
 * Poll a training job while it is active. Fetches once immediately (and on
 * every `jobId` change), then ticks every `intervalMs` via `usePolling` —
 * which pauses while the tab is hidden and catches up on visibility return.
 * Polling stops when the job reaches a terminal status (done/failed) or when
 * a fetch fails (no infinite retry loop on a 404).
 *
 * @param {string|null|undefined} jobId - null/undefined disables the hook
 * @param {{intervalMs?: number, onUpdate?: (job: JobStatus) => void}} [options]
 *   `onUpdate` fires with every fresh payload — stage pages use it to trigger
 *   `reloadState()` from the workflow context when the job turns terminal.
 * @returns {{job: JobStatus|null, error: Error|null, active: boolean, refresh: () => Promise<JobStatus|null>}}
 */
export function useJobPolling(jobId, { intervalMs = 1500, onUpdate } = {}) {
  const [job, setJob] = useState(null)
  const [error, setError] = useState(null)
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  const refresh = useCallback(async () => {
    if (!jobId) return null
    try {
      const next = await getJob(jobId)
      setJob(next)
      setError(null)
      onUpdateRef.current?.(next)
      return next
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err)
      return null
    }
  }, [jobId])

  // Initial fetch + reset when the job id changes (stale results never linger).
  useEffect(() => {
    setJob(null)
    setError(null)
    refresh()
  }, [refresh])

  const active = Boolean(jobId) && (job !== null ? isJobActive(job.status) : error === null)
  usePolling(refresh, active ? intervalMs : null)

  return { job, error, active, refresh }
}

/** Grouped surface, mirroring `api/client.js`'s `api` object style. */
export const workflowApi = {
  uploadDataset,
  listDatasets,
  getDataset,
  getState,
  deleteDataset,
  getProfile,
  getFeatures,
  getStats,
  getMissing,
  viz,
  getPreprocess,
  previewPreprocess,
  startJob,
  getJob,
  listJobs,
  getModels,
  getEvaluation,
  sandboxPredict,
}
