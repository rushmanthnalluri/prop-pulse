/**
 * UploadDropzone (WORKFLOW §6.3-01, blueprint §8.2/§5) — the stage-01
 * dropzone in the reference's shape: a `<label.upload-drop>` wrapping a
 * visually-hidden file input, so click and keyboard both open the picker and
 * `:focus-within` styles the zone. An `aria-hidden` icon tile sits above the
 * title as the browse affordance. The zone only SELECTS a file — the
 * parent's left-aligned "Upload dataset" submit fires the raw-body POST
 * (select-then-submit, exactly like the reference form). A chosen file shows
 * in the mono accent filename line; drag-over flips `.is-dragover` (accent
 * border + surface bg).
 *
 * Client-side pre-checks run before any bytes leave the browser (§2.3):
 * `.csv` only (raw text/csv transport — no multipart), non-empty, and
 * ≤ 10 MB (`UPLOAD_MAX_BYTES`, mirrored from the server rule). Rejections
 * render as one plain-language inline line (with an alert glyph, so the
 * failure is not colour-only); server validation results are the parent's
 * job (`ValidationReport`). While `disabled` (upload in flight) the zone is
 * inert and says so: the icon tile swaps to a spinner, the title reads
 * "Upload in progress…", the dashed border solidifies, and the label carries
 * aria-disabled/aria-busy.
 *
 *   <UploadDropzone file={selected} onSelect={setSelected} disabled={uploading} />
 */
import { useState } from 'react'
import { UPLOAD_MAX_BYTES } from '../../api/workflow'
import { formatNumber } from '../../format'

const MAX_MIB = UPLOAD_MAX_BYTES / (1024 * 1024)

export default function UploadDropzone({ file = null, onSelect, disabled = false }) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)

  const acceptFile = (candidate) => {
    if (!candidate || disabled) return
    const name = candidate.name || 'upload.csv'
    if (!/\.csv$/i.test(name)) {
      setError(
        `"${name}" is not a CSV. The workbench accepts .csv files only — export or convert the file and try again.`,
      )
      return
    }
    if (candidate.size === 0) {
      setError(`"${name}" is empty — there is nothing to upload.`)
      return
    }
    if (candidate.size > UPLOAD_MAX_BYTES) {
      setError(
        `"${name}" is ${formatNumber(candidate.size / (1024 * 1024), 1)} MiB — over the ${formatNumber(MAX_MIB, 0)} MB upload limit.`,
      )
      return
    }
    setError(null)
    onSelect?.(candidate)
  }

  const classes = [
    'upload-drop',
    dragOver ? 'is-dragover' : null,
    disabled ? 'is-disabled' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <label
        className={classes}
        aria-disabled={disabled || undefined}
        aria-busy={disabled || undefined}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          if (!disabled) acceptFile(event.dataTransfer?.files?.[0])
        }}
      >
        <span className="upload-drop-icon" aria-hidden="true">
          {disabled ? (
            /* In-flight lock: the affordance tile becomes the progress
               indicator (dark-track spinner for the raised tile). */
            <span className="spinner spinner--dark" />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 10.5V3" />
              <path d="M4.75 5.75 8 2.5l3.25 3.25" />
              <path d="M2 10.75V13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2.25" />
            </svg>
          )}
        </span>
        <span className="upload-drop-title">
          {disabled ? 'Upload in progress…' : 'Drop a file here, or click to browse'}
        </span>
        <span className="upload-drop-hint">.csv · up to {formatNumber(MAX_MIB, 0)} MB</span>
        <span className="upload-drop-filename">{file ? file.name : ''}</span>
        <input
          type="file"
          className="visually-hidden"
          accept=".csv,text/csv"
          aria-label="Choose a CSV dataset"
          disabled={disabled}
          onChange={(event) => {
            acceptFile(event.target.files?.[0])
            // Allow picking the same file twice in a row (re-upload after a fix).
            event.target.value = ''
          }}
        />
      </label>
      {error && (
        <p className="wfu-drop-error" role="alert">
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 1.9 10.9 10.1a.8.8 0 0 1-.7 1.2H1.8a.8.8 0 0 1-.7-1.2L6 1.9Z" />
            <path d="M6 4.7v2.5" />
            <path d="M6 9.1v.02" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
