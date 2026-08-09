/**
 * ValidationReport (WORKFLOW §6.3-01) — renders the upload-validation result
 * as a per-check checklist, for both outcomes of `POST /workflow/datasets`:
 *
 *   success — the 201 payload's `validation: {ok, checks}` (pass/warn rows;
 *             cardinality warnings are non-fatal, §2.3)
 *   failure — the dict-shaped 422, read uniformly via `uploadReportOf(error)`:
 *             the failing check plus the report's NAMED details
 *             (`missing_columns`, `n_duplicate_ids` + sample, per-column
 *             category/range `violations`, `parse_error`) — never raw JSON
 *             (§6.3-01 error matrix: corrupt / empty / schema / duplicate /
 *             unsupported all land here in plain language)
 *
 * Non-validation errors (413 too large, 415 wrong type, offline, …) degrade
 * to a plain inline alert carrying the client's already-plain message.
 *
 *   <ValidationReport validation={payload.validation} fileName={file.name} />
 *   <ValidationReport error={apiError} fileName={file.name} />
 */
import { uploadReportOf } from '../../api/workflow'
import { formatNumber } from '../../format'

/** §3.1 check codes → human labels (fallback: the code itself). */
const CHECK_LABELS = {
  format: 'Format',
  parse: 'CSV parse',
  empty: 'Non-empty',
  row_cap: 'Row cap',
  unique_id: 'Unique Id',
  schema: 'Schema · 81 columns',
  extra_columns: 'Extra columns',
  categories: 'Category values',
  ranges: 'Numeric ranges',
  cardinality: 'Cardinality',
}

const STATUS_ICON = { pass: '✓', warn: '!', fail: '✕' }
const STATUS_LABEL = { pass: 'passed', warn: 'warning', fail: 'failed' }

function CheckRows({ checks }) {
  if (!Array.isArray(checks) || checks.length === 0) return null
  return (
    <ul className="wfe-checks">
      {checks.map((check, index) => {
        const status = STATUS_ICON[check?.status] ? check.status : 'fail'
        return (
          <li key={`${check?.code ?? 'check'}-${index}`} className={`wfe-check wfe-check--${status}`}>
            <span
              className="wfe-check-icon"
              role="img"
              aria-label={`check ${STATUS_LABEL[status]}`}
            >
              {STATUS_ICON[status]}
            </span>
            <span className="wfe-check-code mono">
              {CHECK_LABELS[check?.code] ?? check?.code ?? 'check'}
            </span>
            <span className="wfe-check-detail">{check?.detail}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** One named violation line per offending column (categories / ranges / final gate). */
function ViolationLine({ violation }) {
  if (!violation || typeof violation !== 'object') return null
  if (violation.rule === 'categories') {
    const unexpected = Array.isArray(violation.unexpected) ? violation.unexpected : []
    const shown = unexpected.slice(0, 5).join(', ')
    const more = unexpected.length > 5 ? `, +${unexpected.length - 5} more` : ''
    return (
      <li>
        <span className="mono">{violation.column}</span>: unexpected{' '}
        {unexpected.length === 1 ? 'category' : 'categories'} <span className="mono">{shown}{more}</span>
        {Array.isArray(violation.allowed) && (
          <span className="dim" title={`Allowed: ${violation.allowed.join(', ')}`}>
            {' '}— {violation.allowed.length} allowed values
          </span>
        )}
      </li>
    )
  }
  if (violation.rule === 'ranges') {
    const range = Array.isArray(violation.range) ? violation.range.join('–') : null
    return (
      <li>
        <span className="mono">{violation.column}</span>:{' '}
        {violation.detail ??
          `${formatNumber(violation.n_out_of_range, 0)} values outside the documented range${
            range ? ` ${range}` : ''
          }${violation.example != null ? ` (e.g. ${formatNumber(violation.example, 1)})` : ''}`}
      </li>
    )
  }
  return (
    <li>
      {violation.column && <span className="mono">{violation.column}: </span>}
      {violation.detail ?? 'validation rule violated'}
    </li>
  )
}

/** The report's named failure details (§3.1) as plain-language blocks. */
function FailureDetails({ report }) {
  if (!report || typeof report !== 'object') return null
  const blocks = []
  if (report.parse_error) {
    blocks.push(
      <p key="parse" className="wfe-report-line">
        Parser message: <span className="mono">{report.parse_error}</span>
      </p>,
    )
  }
  if (Array.isArray(report.missing_columns) && report.missing_columns.length > 0) {
    const cols = report.missing_columns
    const shown = cols.slice(0, 8) // QA p2: truncate, never dump the raw repr
    blocks.push(
      <div key="missing" className="wfe-report-block">
        <span className="wfe-report-lead">
          {cols.length} required {cols.length === 1 ? 'column is' : 'columns are'} missing:
        </span>
        <span className="mono">
          {shown.join(', ')}
          {cols.length > shown.length ? ` …and ${cols.length - shown.length} more` : ''}
        </span>
      </div>,
    )
  }
  if (report.n_duplicate_ids) {
    const sample = Array.isArray(report.duplicate_id_sample)
      ? report.duplicate_id_sample.slice(0, 5)
      : []
    blocks.push(
      <p key="dupes" className="wfe-report-line">
        {formatNumber(report.n_duplicate_ids, 0)} rows repeat an already-seen Id
        {sample.length > 0 && (
          <>
            {' — e.g. '}
            <span className="mono">{sample.join(', ')}</span>
          </>
        )}
        . Each row must carry a unique Id.
      </p>,
    )
  }
  if (Array.isArray(report.violations) && report.violations.length > 0) {
    const shown = report.violations.slice(0, 6)
    blocks.push(
      <ul key="violations" className="wfe-report-list">
        {shown.map((violation, index) => (
          <ViolationLine key={`${violation?.column ?? 'rule'}-${index}`} violation={violation} />
        ))}
        {report.violations.length > shown.length && (
          <li className="dim">…and {report.violations.length - shown.length} more</li>
        )}
      </ul>,
    )
  }
  if (blocks.length === 0) return null
  return <div className="wfe-report-details">{blocks}</div>
}

export default function ValidationReport({ validation = null, error = null, fileName = null }) {
  if (!validation && !error) return null

  // --- Failure path ---------------------------------------------------------
  if (error) {
    const failure = uploadReportOf(error)
    if (!failure) {
      // 413 / 415 / offline / timeout — the client message is already plain.
      return (
        <div className="alert alert-error" role="alert">
          <span className="alert-title">Upload failed{fileName ? ` — ${fileName}` : ''}</span>
          {error?.message ?? 'The upload could not be completed.'}
        </div>
      )
    }
    // QA p2: the schema_mismatch message embeds the raw Python list repr of
    // every missing column — when the structured list is present, render a
    // clean sentence here and let FailureDetails show the truncated names.
    const missingList = failure.report?.missing_columns
    const message =
      Array.isArray(missingList) && missingList.length > 0
        ? 'The file is missing required Ames columns — the full 81-column schema is required before the pipeline can use it.'
        : failure.message
    return (
      <div className="alert alert-error wfe-report" role="alert">
        <span className="alert-title">
          {fileName ? `"${fileName}" was rejected` : 'The upload was rejected'}
        </span>
        <p className="wfe-report-line">{message}</p>
        <CheckRows checks={failure.report?.checks} />
        <FailureDetails report={failure.report} />
        <p className="wfe-report-line dim">
          Fix the file and upload it again — rejected uploads are not stored.
        </p>
      </div>
    )
  }

  // --- Success path ---------------------------------------------------------
  const checks = Array.isArray(validation?.checks) ? validation.checks : []
  const warnings = checks.filter((check) => check?.status === 'warn').length
  return (
    <div className="alert wfe-report wfe-report--ok" role="status">
      <span className="alert-title">
        {warnings > 0
          ? `Validation passed with ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
          : 'Validation passed'}
        {fileName ? ` — ${fileName}` : ''}
      </span>
      <CheckRows checks={checks} />
      {warnings > 0 && (
        <p className="wfe-report-line dim">
          Warnings are non-fatal — the dataset was stored and is ready for analysis.
        </p>
      )}
    </div>
  )
}
