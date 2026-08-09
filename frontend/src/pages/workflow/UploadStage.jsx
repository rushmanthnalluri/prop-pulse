/**
 * UploadStage (WORKFLOW §6.3-01) — stage 01 of the guided workbench:
 * upload + validate a CSV against the full Ames schema, inspect the active
 * dataset's profile, and manage the server's datasets.
 *
 * Sections (per-section skeleton → error+retry → content, §6.4):
 *   1. Active dataset — the real profile of whatever dataset is active
 *      (bundled ames out of the box): shape metrics + the 8-row head table.
 *   2. Upload a CSV — UploadDropzone (client-side .csv / ≤10 MiB pre-checks)
 *      → raw-body POST → ValidationReport (per-check rows from the 201, or the
 *      named violations of the dict-shaped 422 — never raw JSON). Success:
 *      toast + the upload becomes the active dataset + "Continue" CTA.
 *   3. Datasets on this server — the registry list with select + inline-confirm
 *      delete (never window.confirm); the bundled ames is non-deletable.
 *
 * Upload progress is an honest indeterminate state — fetch reports no bytes.
 */
import { useCallback, useState } from 'react'
import { deleteDataset, getProfile, uploadDataset } from '../../api/workflow'
import { useApi } from '../../api/useApi'
import { formatDateTime, formatNumber } from '../../format'
import { useToast } from '../../components/Toast'
import { EmptyState, ErrorState, PanelSkeleton } from '../../components/StateView'
import BusyButton from '../../components/shared/BusyButton'
import ProvenanceBanner from '../../components/workflow/ProvenanceBanner'
import UploadDropzone from '../../components/workflow/UploadDropzone'
import ValidationReport from '../../components/workflow/ValidationReport'
import { useWorkflow } from './WorkflowShell'
import '../../styles/workflow-eda.css'

/** Head-table cell: numbers grouped, nulls dashed, strings verbatim. */
function headCell(value) {
  if (value === null || value === undefined) return <span className="dim">—</span>
  if (typeof value === 'number') {
    return Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 2)
  }
  return String(value)
}

/** The active dataset's profile: shape metrics + 8-row preview (§3.3). */
function ActiveDatasetCard({ profile }) {
  const numeric = new Set(
    (profile.columns ?? [])
      .filter((col) => col.dtype !== 'object')
      .map((col) => col.name),
  )
  return (
    <>
      <div className="metrics metrics--auto">
        <div className="metric">
          <div className="metric-label">Rows</div>
          <div className="metric-value">{formatNumber(profile.n_rows, 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Columns</div>
          <div className="metric-value">{formatNumber(profile.n_cols, 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Numeric</div>
          <div className="metric-value">{formatNumber(profile.n_numeric, 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Categorical</div>
          <div className="metric-value">{formatNumber(profile.n_categorical, 0)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Missing cells</div>
          <div className="metric-value">{formatNumber(profile.total_missing_cells, 0)}</div>
          <div className="metric-hint">stage 04 breaks this down</div>
        </div>
        <div className="metric">
          <div className="metric-label">Duplicate Ids</div>
          <div className="metric-value">{formatNumber(profile.n_duplicate_ids, 0)}</div>
        </div>
      </div>

      <h3 className="wfe-sub-title">First {profile.head?.length ?? 0} rows</h3>
      <div className="table-scroll wfe-head-scroll" tabIndex={0}>
        <table className="table">
          <thead>
            <tr>
              {(profile.columns ?? []).map((col) => (
                <th key={col.name} className="wfe-th-raw" scope="col">
                  {col.name}
                  <span className="wfe-th-dtype">{col.dtype}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(profile.head ?? []).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {(profile.columns ?? []).map((col) => (
                  <td key={col.name} className={numeric.has(col.name) ? 'num' : undefined}>
                    {headCell(row?.[col.name])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Preview of the raw CSV exactly as stored — no cleaning applied yet.</p>
    </>
  )
}

/** The registry list with select + inline-confirm delete (§6.3-01). */
function DatasetManager() {
  const { datasetId, datasets, datasetsLoading, datasetsError, reloadDatasets, selectDataset } =
    useWorkflow()
  const toast = useToast()
  const [confirmId, setConfirmId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  const remove = async (record) => {
    setDeleteError(null)
    try {
      await deleteDataset(record.dataset_id)
      setConfirmId(null)
      // QA p3: deleting the ACTIVE dataset switches to the bundled data
      // immediately — and the toast says so, so the switch never depends on
      // noticing the shell's 6 s fallback toast.
      if (record.dataset_id === datasetId) {
        selectDataset('ames')
        toast.success(
          `Deleted ${record.name}`,
          'It was the active dataset — the workbench switched to the bundled Ames data.',
        )
      } else {
        toast.success(`Deleted ${record.name}`)
      }
      reloadDatasets()
    } catch (error) {
      if (error?.name === 'AbortError') return
      // 400 (bundled) / 409 (job running) arrive as plain-language ApiErrors.
      setDeleteError(error?.message ?? 'Could not delete the dataset.')
    }
  }

  if (datasetsLoading && !datasets) return <PanelSkeleton height={180} />
  if (datasetsError && !datasets) {
    return (
      <ErrorState error={datasetsError} onRetry={reloadDatasets} title="Couldn't load datasets" />
    )
  }
  if (!datasets || datasets.length === 0) {
    return (
      <EmptyState
        kicker="No datasets"
        title="No datasets registered"
        detail="Upload a CSV above — the bundled Ames dataset is normally always present."
      />
    )
  }

  return (
    <div className="table-scroll" tabIndex={0}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Dataset</th>
            <th scope="col">Source</th>
            <th scope="col" className="num">
              Rows
            </th>
            <th scope="col" className="num">
              Columns
            </th>
            <th scope="col">Added</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((record) => {
            const active = record.dataset_id === datasetId
            const confirming = confirmId === record.dataset_id
            return [
              <tr key={record.dataset_id} className={active ? 'wfe-row-active' : undefined}>
                <td>
                  <span className="strong">{record.name}</span>
                  <span className="dim wfe-cell-sub mono">{record.dataset_id}</span>
                </td>
                <td>
                  <span
                    className={`badge ${record.source === 'bundled' ? 'badge-accent' : 'badge-muted'}`}
                  >
                    {record.source}
                  </span>
                </td>
                <td className="num">{formatNumber(record.n_rows, 0)}</td>
                <td className="num">{formatNumber(record.n_cols, 0)}</td>
                <td className="dim">{formatDateTime(record.created_at)}</td>
                <td className="wfe-actions-cell">
                  {!confirming && (
                    <span className="wfe-actions">
                      {active ? (
                        <span className="badge badge-accent">Active</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => selectDataset(record.dataset_id)}
                        >
                          Make active
                        </button>
                      )}
                      {record.deletable ? (
                        <button
                          type="button"
                          className="wfe-delete-btn"
                          onClick={() => {
                            setConfirmId(record.dataset_id)
                            setDeleteError(null)
                          }}
                        >
                          Delete
                        </button>
                      ) : (
                        <span
                          className="dim wfe-nuke-note"
                          title="The bundled dataset is the workbench's built-in demo data and can never be deleted."
                        >
                          non-deletable
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>,
              confirming && (
                <tr key={`${record.dataset_id}__confirm`} className="wfe-confirm-row">
                  <td colSpan={6}>
                    <span className="wfe-confirm" role="alert">
                      <span className="wfe-confirm-text">
                        Delete <strong>{record.name}</strong>? Its sandbox models and any
                        running-or-finished jobs go with it.
                        {deleteError && (
                          <span className="wfe-confirm-error">{deleteError}</span>
                        )}
                      </span>
                      <span className="wfe-confirm-actions">
                        <BusyButton
                          className="btn btn-sm btn-secondary"
                          busyLabel="Deleting…"
                          onClick={() => remove(record)}
                        >
                          Confirm delete
                        </BusyButton>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => {
                            setConfirmId(null)
                            setDeleteError(null)
                          }}
                        >
                          Cancel
                        </button>
                      </span>
                    </span>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function UploadStage() {
  const { datasetId, dataset, reloadDatasets, selectDataset, goToStage } = useWorkflow()
  const toast = useToast()
  const [upload, setUpload] = useState(null) // {fileName, status, payload?|error?}

  const fetchProfile = useCallback((signal) => getProfile(datasetId, signal), [datasetId])
  const profile = useApi(fetchProfile)

  const handleFile = async (file) => {
    setUpload({ fileName: file.name, status: 'uploading' })
    try {
      const payload = await uploadDataset(file, file.name)
      setUpload({ fileName: file.name, status: 'success', payload })
      toast.success(
        `Uploaded ${payload.name}`,
        `${formatNumber(payload.n_rows, 0)} rows × ${formatNumber(payload.n_cols, 0)} columns — now the active dataset.`,
      )
      // Order matters: refresh the registry, then point every stage at the
      // new dataset (the profile card above refetches via datasetId).
      reloadDatasets()
      selectDataset(payload.dataset_id)
    } catch (error) {
      if (error?.name === 'AbortError') return
      setUpload({ fileName: file.name, status: 'failed', error })
    }
  }

  const metaParts = dataset
    ? [
        dataset.name,
        `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`,
        dataset.source,
      ]
    : ['Loading dataset record…']

  return (
    <div>
      <div className="page-head">
        <span className="kicker">Stage 01 · Upload Dataset</span>
        <h1 className="page-title">Upload &amp; validate</h1>
        <p className="page-desc">
          Every workflow stage runs on the bundled Ames dataset out of the box. To work with your
          own data, upload a CSV here — it is validated against the full 81-column Ames schema
          before it is stored.
        </p>
        <p className="page-meta">{metaParts.join(' · ')}</p>
      </div>

      <div className="wfe-banner-slot">
        <ProvenanceBanner
          provenance={{ dataset_name: dataset?.name ?? datasetId }}
          label="Profiling the active dataset — switch it from the dataset chip above."
        />
      </div>

      <div className="section">
        <div className="section-head">
          <span className="section-title">Active dataset</span>
          <span className="section-note">GET /workflow/datasets/{datasetId}/profile</span>
        </div>
        {profile.loading && !profile.data && <PanelSkeleton height={300} />}
        {profile.error && !profile.data && (
          <ErrorState
            error={profile.error}
            onRetry={profile.reload}
            title="Couldn't load the dataset profile"
          />
        )}
        {profile.data && <ActiveDatasetCard profile={profile.data} />}
      </div>

      <hr className="divider" />

      <div className="section">
        <div className="section-head">
          <span className="section-title">Upload a CSV</span>
          <span className="section-note">raw body · 10 MiB cap</span>
        </div>
        <UploadDropzone uploading={upload?.status === 'uploading'} onFile={handleFile} />
        {upload?.status === 'failed' && (
          <div className="wfe-report-slot">
            <ValidationReport error={upload.error} fileName={upload.fileName} />
          </div>
        )}
        {upload?.status === 'success' && (
          <div className="wfe-report-slot">
            <ValidationReport
              validation={upload.payload?.validation}
              fileName={upload.fileName}
            />
            <div className="wfe-upload-next">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => goToStage('02-features')}
              >
                Continue to Analyse features →
              </button>
              <span className="note">
                {upload.payload?.name} is now the active dataset — every stage reads it.
              </span>
            </div>
          </div>
        )}
      </div>

      <hr className="divider" />

      <div className="section">
        <div className="section-head">
          <span className="section-title">Datasets on this server</span>
          <span className="section-note">uploads survive restarts</span>
        </div>
        <DatasetManager />
      </div>
    </div>
  )
}
