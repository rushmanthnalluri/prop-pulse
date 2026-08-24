/**
 * UploadStage (WORKFLOW §6.3-01, blueprint §8.2) — stage 01 of the guided
 * workbench: ingest a CSV or keep exploring the bundled Ames cohort.
 *
 * Structure (reference §8.2, in order): page-head (kicker / h1 / desc, no
 * page-meta) → divider → upload form (dropzone + left-aligned primary
 * submit) → validation report slot → loaded panel for the ACTIVE dataset
 * (badge + filename + "Remove file" → Rows/Columns/Missing metrics → Columns
 * table → 8-row preview) → bottom "Continue to Analyze Features →" CTA.
 *
 * The flow mirrors the reference form: the dropzone only chooses a file;
 * "Upload dataset" fires the raw-body POST (§3.1). The 201's per-check rows
 * and the dict-shaped 422's named violations both render through
 * ValidationReport — never raw JSON. Success: toast + the upload becomes the
 * active dataset, so the loaded panel refetches and profiles it in place.
 *
 * Dataset registry management (list/switch/delete arbitrary uploads) lives in
 * the shell's DatasetPicker; this page keeps only the reference's quiet
 * "Remove file" for the active upload, wired to the real DELETE endpoint
 * behind an inline confirm (never window.confirm).
 */
import { useCallback, useRef, useState } from 'react'
import { deleteDataset, getProfile, uploadDataset } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatNumber } from '../../format'
import { useToast } from '../../components/Toast'
import { ErrorState, PanelSkeleton } from '../../components/StateView'
import BusyButton from '../../components/shared/BusyButton'
import UploadDropzone from '../../components/workflow/UploadDropzone'
import ValidationReport from '../../components/workflow/ValidationReport'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-upload.css'

/** Preview cell: numbers grouped, nulls dashed, strings verbatim. */
function previewCell(value) {
  if (value === null || value === undefined) return <span className="dim">—</span>
  if (typeof value === 'number') {
    return Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 2)
  }
  return String(value)
}

/**
 * The active dataset's profile (§3.3): loaded-header (badge + filename +
 * Remove file for uploads), the Rows/Columns/Missing metric trio (missing in
 * danger red when >0), the full column registry, and the raw 8-row head.
 */
function LoadedPanel() {
  const { datasetId, dataset, reloadDatasets, selectDataset, goToStage } = useWorkflow()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [removeError, setRemoveError] = useState(null)

  const fetchProfile = useCallback((signal) => getProfile(datasetId, signal), [datasetId])
  const profile = useApi(fetchProfile)

  const bundled = !dataset || dataset.source === 'bundled'
  const removable = Boolean(dataset && dataset.source !== 'bundled' && dataset.deletable)

  const remove = async () => {
    setRemoveError(null)
    try {
      await deleteDataset(datasetId)
      setConfirming(false)
      // Deleting the ACTIVE dataset switches to the bundled data immediately —
      // and the toast says so, so the switch never depends on noticing the
      // shell's 404 fallback.
      selectDataset('ames')
      reloadDatasets()
      toast.success(
        `Removed ${dataset?.name ?? 'file'}`,
        'The workbench switched back to the bundled Ames data.',
      )
    } catch (error) {
      if (error?.name === 'AbortError') return
      // 400 (bundled) / 409 (job running) arrive as plain-language ApiErrors.
      setRemoveError(error?.message ?? 'Could not remove the file.')
    }
  }

  const columns = profile.data?.columns ?? []
  const head = profile.data?.head ?? []

  return (
    <div className="loaded-panel table-zebra">
      <div className="loaded-header">
        {dataset ? (
          <>
            <span className={`badge${bundled ? '' : ' badge-accent'}`}>
              {bundled ? 'Bundled' : 'Uploaded'}
            </span>
            {/* The "Bundled" badge already carries the provenance — strip the
                redundant " (bundled)" suffix from the registry name. */}
            <span className="loaded-name">
              {bundled ? dataset.name.replace(/ \(bundled\)$/, '') : dataset.name}
            </span>
            {removable && !confirming && (
              <button
                type="button"
                className="link-quiet"
                onClick={() => {
                  setConfirming(true)
                  setRemoveError(null)
                }}
              >
                Remove file
              </button>
            )}
          </>
        ) : (
          <span className="loaded-name dim">{datasetId}</span>
        )}
      </div>

      {confirming && removable && (
        <div className="alert alert-error wfu-remove-confirm" role="alert">
          <span className="alert-title">Remove {dataset.name}?</span>
          The file is deleted from the server — its sandbox models and jobs go with it, and the
          workbench switches back to the bundled Ames data.
          {removeError && <p className="wfu-remove-error">{removeError}</p>}
          <div className="alert-actions">
            <BusyButton
              className="btn btn-sm btn-secondary"
              busyLabel="Removing…"
              onClick={remove}
            >
              Confirm remove
            </BusyButton>
            <button
              type="button"
              className="link-quiet"
              onClick={() => {
                setConfirming(false)
                setRemoveError(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {profile.loading && !profile.data && <PanelSkeleton height={320} />}
      {profile.error && !profile.data && (
        <ErrorState
          error={profile.error}
          onRetry={profile.reload}
          title="Couldn't load the dataset profile"
        />
      )}

      {profile.data && (
        <>
          <div className="metrics grid-3 mb-32">
            <div className="metric">
              <span className="metric-value">{formatNumber(profile.data.n_rows, 0)}</span>
              <span className="metric-label">Rows</span>
            </div>
            <div className="metric">
              <span className="metric-value">{formatNumber(profile.data.n_cols, 0)}</span>
              <span className="metric-label">Columns</span>
            </div>
            <div className="metric">
              <span
                className={`metric-value${profile.data.total_missing_cells > 0 ? ' text-danger' : ''}`}
              >
                {formatNumber(profile.data.total_missing_cells, 0)}
              </span>
              <span className="metric-label">Missing values</span>
            </div>
          </div>
          {bundled && (
            <p className="note note-offset">
              Raw file counts — the bundled Ames CSV exactly as stored; cleaning begins at
              stage 06.
            </p>
          )}

          <div className="section-head">
            <h2 className="section-title">Columns</h2>
          </div>
          <div className="table-scroll scroll-60 mb-32" tabIndex={0}>
            <table className="table table-sticky">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.name}>
                    <td className="mono strong">{col.name}</td>
                    <td className="num dim">{col.dtype}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-head">
            <h2 className="section-title">Preview — first {head.length} rows</h2>
            <span className="mono dim mono-sm">{columns.length} columns · scroll →</span>
          </div>
          <div className="table-scroll" tabIndex={0}>
            <table className="table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.name} scope="col" className="wfu-th-raw">
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {head.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {columns.map((col) => (
                      <td key={col.name} className="num dim">
                        {previewCell(row?.[col.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            className="btn btn-primary mt-28"
            onClick={() => goToStage('02-features')}
          >
            Continue to Analyze Features →
          </button>
        </>
      )}
    </div>
  )
}

export default function UploadStage() {
  const { reloadDatasets, selectDataset } = useWorkflow()
  const toast = useToast()
  const [selected, setSelected] = useState(null) // File chosen in the dropzone
  const [upload, setUpload] = useState(null) // {fileName, status, payload?|error?}
  const uploading = upload?.status === 'uploading'
  // Synchronous interlock: `uploading` is React state and lags one render, so a
  // double requestSubmit() in the same tick would fire two POSTs (audit m2).
  const uploadLock = useRef(false)

  const handleUpload = async () => {
    if (!selected || uploadLock.current) return
    uploadLock.current = true
    setUpload({ fileName: selected.name, status: 'uploading' })
    try {
      const payload = await uploadDataset(selected, selected.name)
      setUpload({ fileName: selected.name, status: 'success', payload })
      setSelected(null)
      toast.success(
        `Uploaded ${payload.name}`,
        `${formatNumber(payload.n_rows, 0)} rows × ${formatNumber(payload.n_cols, 0)} columns — now the active dataset.`,
      )
      // Order matters: refresh the registry, then point every stage at the
      // new dataset (the loaded panel refetches its profile via datasetId).
      reloadDatasets()
      selectDataset(payload.dataset_id)
    } catch (error) {
      if (error?.name === 'AbortError') return
      setUpload({ fileName: selected.name, status: 'failed', error })
    } finally {
      uploadLock.current = false
    }
  }

  return (
    <div>
      <header className="page-head">
        <span className="kicker">Stage 01 · Intake</span>
        <h1 className="page-title">Upload Dataset</h1>
        <p className="page-desc">
          Bring in raw property records as a CSV — or explore the bundled Ames housing cohort.
          Uploads are validated against the full 81-column Ames schema before they are stored.
        </p>
      </header>

      <hr className="divider" />

      <section className="section">
        <form
          className="upload-form"
          onSubmit={(event) => {
            event.preventDefault()
            handleUpload()
          }}
        >
          <UploadDropzone file={selected} onSelect={setSelected} disabled={uploading} />
          <BusyButton
            type="submit"
            className="btn btn-primary upload-submit"
            busy={uploading}
            busyLabel="Uploading…"
            disabled={!selected}
          >
            Upload dataset
          </BusyButton>
        </form>

        {upload?.status === 'failed' && (
          <div className="wfu-report-slot">
            <ValidationReport error={upload.error} fileName={upload.fileName} />
          </div>
        )}
        {upload?.status === 'success' && (
          <div className="wfu-report-slot">
            <ValidationReport validation={upload.payload?.validation} fileName={upload.fileName} />
          </div>
        )}

        <LoadedPanel />
      </section>
    </div>
  )
}
