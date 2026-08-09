/**
 * UploadDropzone (WORKFLOW §6.3-01) — the stage-01 drag/click CSV dropzone.
 * Client-side pre-checks run before any bytes leave the browser (§2.3):
 * `.csv` extension only and ≤ 10 MiB (`UPLOAD_MAX_BYTES`, mirrored from the
 * server rule). Rejections render plain-language inline errors here; server
 * validation results are the parent's job (`ValidationReport`).
 *
 * Upload progress is an honest indeterminate state (§6.3-01: "fetch gives no
 * byte progress") — while `uploading` the zone is disabled and carries a
 * spinner + "Uploading and validating…" copy.
 *
 *   <UploadDropzone uploading={busy} onFile={(file) => upload(file)} />
 */
import { useEffect, useRef, useState } from 'react'
import { UPLOAD_MAX_BYTES } from '../../api/workflow'
import { formatNumber } from '../../format'

const MAX_MIB = UPLOAD_MAX_BYTES / (1024 * 1024)

function UploadIcon() {
  return (
    <svg
      className="wfe-drop-icon"
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export default function UploadDropzone({ uploading = false, onFile }) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  // QA m1: `uploading` is React state — it lags one render behind, so a
  // synchronous double-fire (two change/drop events in one tick) races past
  // it. This ref is the real in-flight guard: set synchronously in acceptFile
  // before the parent's first await, re-armed when the upload settles.
  const busyRef = useRef(false)

  useEffect(() => {
    if (!uploading) busyRef.current = false
  }, [uploading])

  const acceptFile = (file) => {
    if (!file || busyRef.current) return
    const name = file.name || 'upload.csv'
    if (!/\.csv$/i.test(name)) {
      setError(
        `"${name}" is not a CSV. The workbench accepts .csv files only — export or convert the file and try again.`,
      )
      return
    }
    if (file.size === 0) {
      setError(`"${name}" is empty — there is nothing to upload.`)
      return
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(
        `"${name}" is ${formatNumber(file.size / (1024 * 1024), 1)} MiB — over the ${formatNumber(MAX_MIB, 0)} MiB upload limit.`,
      )
      return
    }
    setError(null)
    busyRef.current = true
    try {
      onFile?.(file)
    } catch (thrown) {
      busyRef.current = false // the parent never went in-flight — re-arm now
      throw thrown
    }
  }

  const openPicker = () => {
    if (!uploading) inputRef.current?.click()
  }

  const classes = [
    'wfe-drop',
    dragOver ? 'wfe-drop--drag' : null,
    uploading ? 'wfe-drop--busy' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div
        className={classes}
        role="button"
        tabIndex={0}
        aria-disabled={uploading}
        aria-label="Upload a CSV dataset"
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openPicker()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (!uploading) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          if (!uploading) acceptFile(event.dataTransfer?.files?.[0])
        }}
      >
        <UploadIcon />
        {uploading ? (
          <>
            <span className="wfe-drop-title">
              <span className="spinner spinner--dark" aria-hidden="true" /> Uploading and
              validating…
            </span>
            <span className="wfe-drop-hint">
              The file is checked against the full Ames schema — this can take a few seconds.
            </span>
          </>
        ) : (
          <>
            <span className="wfe-drop-title">
              Drop a CSV here, or <span className="wfe-drop-link">choose a file</span>
            </span>
            <span className="wfe-drop-hint mono">
              .csv only · ≤ {formatNumber(MAX_MIB, 0)} MiB · full Ames schema (81 columns)
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="wfe-drop-input"
          tabIndex={-1}
          aria-hidden="true"
          disabled={uploading}
          onChange={(event) => {
            acceptFile(event.target.files?.[0])
            // Allow picking the same file twice in a row (re-upload after a fix).
            event.target.value = ''
          }}
        />
      </div>
      {error && (
        <p className="wfe-drop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
