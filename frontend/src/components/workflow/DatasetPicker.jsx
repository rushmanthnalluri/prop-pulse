/**
 * DatasetPicker (WORKFLOW §6.2) — the active-dataset chip shown on every
 * workflow stage. Shows the active dataset's name and row×col shape; opens a
 * dropdown listing every dataset from `listDatasets` (bundled "ames" first),
 * with an upload affordance that jumps to stage 01 and inline-confirm delete
 * for deletable uploads (never window.confirm, §6.3-01).
 *
 * Self-sufficient: reads and drives the workflow context provided by
 * WorkflowShell (`useWorkflow`). Selecting a dataset re-points every stage
 * link (`?dataset=` + localStorage mirror); deleting the active dataset falls
 * back to the bundled ames record.
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { deleteDataset } from '../../api/workflow'
import { formatDateTime, formatNumber } from '../../format'
import { useToast } from '../Toast'
import { ErrorState } from '../StateView'
import BusyButton from '../shared/BusyButton'
import { SkeletonLine } from '../shared/Skeleton'
import { useWorkflow } from '../../pages/workflow/WorkflowShell'

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function DatasetPicker() {
  const {
    datasetId,
    dataset,
    datasets,
    datasetsLoading,
    datasetsError,
    reloadDatasets,
    selectDataset,
  } = useWorkflow()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const rootRef = useRef(null)

  // Close on outside pointer / Escape (floating-layer hygiene).
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const choose = (id) => {
    selectDataset(id)
    setOpen(false)
    setConfirmId(null)
  }

  const remove = async (record) => {
    try {
      await deleteDataset(record.dataset_id)
      toast.success(`Deleted ${record.name}`)
      setConfirmId(null)
      if (record.dataset_id === datasetId) selectDataset('ames')
      reloadDatasets()
    } catch (error) {
      if (error?.name === 'AbortError') return
      // 400 (bundled) / 409 (job running) arrive as plain-language ApiErrors.
      toast.error(error?.message ?? 'Could not delete the dataset')
    }
  }

  const chipName = dataset?.name ?? (datasetsLoading ? 'Loading…' : datasetId)
  const chipMeta = dataset
    ? `${formatNumber(dataset.n_rows, 0)} × ${formatNumber(dataset.n_cols, 0)}`
    : null

  return (
    <div className="wf-ds" ref={rootRef}>
      <button
        type="button"
        className="wf-ds-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Switch the active workflow dataset"
      >
        <span className="wf-ds-chip-name">{chipName}</span>
        {chipMeta && <span className="wf-ds-chip-meta mono">{chipMeta}</span>}
        <ChevronIcon />
      </button>

      {open && (
        <div className="wf-ds-panel" role="dialog" aria-label="Choose the active dataset">
          <div className="wf-ds-head">
            <span className="wf-ds-title">Active dataset</span>
            {datasets && <span className="wf-ds-count mono">{datasets.length}</span>}
          </div>

          {datasetsLoading && (
            <div className="wf-ds-status" aria-hidden="true">
              <SkeletonLine width="72%" />
              <SkeletonLine width="54%" />
            </div>
          )}
          {datasetsError && (
            <div className="wf-ds-status">
              <ErrorState
                error={datasetsError}
                onRetry={reloadDatasets}
                title="Couldn't load datasets"
              />
            </div>
          )}
          {datasets && datasets.length === 0 && (
            <p className="wf-ds-status note">No datasets yet — upload a CSV in stage 01.</p>
          )}
          {datasets && datasets.length > 0 && (
            <ul className="wf-ds-list">
              {datasets.map((record) => {
                const active = record.dataset_id === datasetId
                const confirming = confirmId === record.dataset_id
                return (
                  <li
                    key={record.dataset_id}
                    className={`wf-ds-item${active ? ' wf-ds-item--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="wf-ds-choose"
                      onClick={() => choose(record.dataset_id)}
                      aria-current={active || undefined}
                    >
                      <span className="wf-ds-row">
                        <span className="wf-ds-name">{record.name}</span>
                        <span
                          className={`badge ${record.source === 'bundled' ? 'badge-accent' : 'badge-muted'}`}
                        >
                          {record.source}
                        </span>
                      </span>
                      <span className="wf-ds-meta mono">
                        {formatNumber(record.n_rows, 0)} × {formatNumber(record.n_cols, 0)}
                        {' · '}
                        {formatDateTime(record.created_at)}
                      </span>
                    </button>
                    {record.deletable && !confirming && (
                      <button
                        type="button"
                        className="wf-ds-delete"
                        aria-label={`Delete dataset ${record.name}`}
                        title={`Delete ${record.name}`}
                        onClick={() => setConfirmId(record.dataset_id)}
                      >
                        Delete
                      </button>
                    )}
                    {confirming && (
                      <div className="wf-ds-confirm" role="alert">
                        <span>
                          Delete <strong>{record.name}</strong>? Its sandbox models go with it.
                        </span>
                        <span className="wf-ds-confirm-actions">
                          <BusyButton
                            className="btn btn-sm btn-secondary"
                            busyLabel="Deleting…"
                            onClick={() => remove(record)}
                          >
                            Delete
                          </BusyButton>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="wf-ds-foot">
            <Link
              to={`/workflow/01-upload?dataset=${datasetId}`}
              onClick={() => setOpen(false)}
            >
              Upload a new CSV →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
