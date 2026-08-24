/**
 * FeatureTable (WORKFLOW §6.3-02, blueprint §8.3) — the field registry of the
 * active dataset over `GET …/features`: one `.registry-group` per family,
 * each a `Field | Type | Role | Coverage | Unique | Notes` table. No
 * client-side sorting/filtering (blueprint §5) — the registry reads top to
 * bottom like the reference.
 *
 * Groups derive from the payload's own facets (role + dtype): Identifier,
 * Numeric inputs, Categorical inputs, Targets, Excluded (families present in
 * the data only), then Pipeline-derived (the computed columns, with dashes
 * where a raw-only fact doesn't exist). The API carries no curated domain
 * taxonomy, so none is invented — that and the Notes column are documented
 * deviations: the reference's hand-written notes don't exist server-side, so
 * Notes show payload facts instead (categorical top values "e.g. …", numeric
 * observed range + mean).
 *
 * Every cell is a real payload field: Coverage = 100 − missing_pct (4px bar,
 * danger fill under 95%), Unique = n_unique, the target row carries the amber
 * `.role-tag.role-target`.
 */
import { formatNumber } from '../../format'

/** role → tag label (roles per §3.4 / ml/features/pipeline lists). */
const ROLE_TAGS = {
  raw_input: 'input',
  identifier: 'identifier',
  target: 'target',
  excluded: 'excluded',
  engineered: 'engineered',
  neighborhood_stat: 'neighborhood stat',
}

/** Registry families in display order, matched on the payload's role + dtype. */
const GROUPS = [
  { id: 'identifier', title: 'Identifier', match: (f) => f?.role === 'identifier' },
  {
    id: 'numeric-inputs',
    title: 'Numeric inputs',
    match: (f) => f?.role === 'raw_input' && f?.dtype === 'numeric',
  },
  {
    id: 'categorical-inputs',
    title: 'Categorical inputs',
    match: (f) => f?.role === 'raw_input' && f?.dtype === 'categorical',
  },
  { id: 'targets', title: 'Targets', match: (f) => f?.role === 'target' },
  { id: 'excluded', title: 'Excluded', match: (f) => f?.role === 'excluded' },
]

/** ≥1000 grouped with no decimals, below that one decimal (range/mean in Notes). */
const fmtStat = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const n = Number(value)
  return Math.abs(n) >= 1000 ? formatNumber(n, 0) : formatNumber(n, 1)
}

/** Notes cell: payload facts only — samples for categoricals, range for numerics. */
function noteFor(feature) {
  if (feature?.dtype === 'categorical') {
    const samples = (Array.isArray(feature?.top_values) ? feature.top_values : [])
      .slice(0, 3)
      .map((tv) => String(tv?.value))
    return samples.length > 0 ? `e.g. ${samples.join(' · ')}` : null
  }
  const min = fmtStat(feature?.min)
  const max = fmtStat(feature?.max)
  const mean = fmtStat(feature?.mean)
  if (min === null || max === null) return null
  return `range ${min}–${max}${mean !== null ? ` · mean ${mean}` : ''}`
}

/** 4px coverage bar + 1dp percent; danger fill under 95% (reference threshold). */
function CoverageCell({ feature }) {
  // Clamped like MissingTable's bar — a stray missing_pct outside [0, 100]
  // must not yield a negative/overflowing width or a "-0.5%" label.
  const coverage = Math.min(
    100,
    Math.max(0, Math.round((100 - (feature?.missing_pct ?? 0)) * 10) / 10),
  )
  return (
    <span className="coverage">
      <span className="coverage-track" aria-hidden="true">
        <span
          className={`coverage-fill${coverage < 95 ? ' coverage-low' : ''}`}
          style={{ '--w': `${coverage}%` }}
        />
      </span>
      <span className="coverage-pct">{coverage.toFixed(1)}%</span>
    </span>
  )
}

function RawRow({ feature }) {
  const note = noteFor(feature)
  return (
    <tr>
      <td className="mono strong">{feature.name}</td>
      <td className="mono num dim">{feature.dtype}</td>
      <td>
        <span className={`role-tag${feature.role === 'target' ? ' role-target' : ''}`}>
          {ROLE_TAGS[feature.role] ?? feature.role ?? '—'}
        </span>
      </td>
      <td>
        <CoverageCell feature={feature} />
      </td>
      <td className="num dim">{formatNumber(feature.n_unique, 0)}</td>
      <td className="registry-optional dim cell-note">{note ?? '—'}</td>
    </tr>
  )
}

/** Pipeline-derived columns are computed, not raw — raw-only facts dash out. */
function PipelineRow({ feature }) {
  return (
    <tr>
      <td className="mono strong">{feature?.name}</td>
      <td className="num dim">—</td>
      <td>
        <span className="role-tag">{ROLE_TAGS[feature?.role] ?? feature?.role ?? '—'}</span>
      </td>
      <td className="dim">—</td>
      <td className="num dim">—</td>
      <td className="registry-optional dim cell-note">
        {feature?.note ?? 'computed in the pipeline — not a raw column'}
      </td>
    </tr>
  )
}

function RegistryGroup({ id, title, rows, children }) {
  return (
    <div className="registry-group" id={`group-${id}`}>
      <div className="registry-group-head">
        <h2>{title}</h2>
        <span className="registry-count">
          {rows} {rows === 1 ? 'field' : 'fields'}
        </span>
      </div>
      <div className="table-scroll borderless table-zebra">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Type</th>
              <th scope="col">Role</th>
              <th scope="col">Coverage</th>
              <th scope="col">Unique</th>
              <th scope="col" className="registry-optional">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  )
}

export default function FeatureTable({ features = [], pipelineFeatures = [] }) {
  const raw = Array.isArray(features) ? features.filter(Boolean) : []
  const pipeline = Array.isArray(pipelineFeatures) ? pipelineFeatures.filter(Boolean) : []

  const groups = []
  for (const def of GROUPS) {
    const rows = raw.filter((f) => def.match(f))
    if (rows.length > 0) groups.push({ ...def, rows })
  }
  // Forward-compat: any role/dtype the families don't know lands in "Other".
  const matched = new Set(groups.flatMap((group) => group.rows.map((f) => f.name)))
  const rest = raw.filter((f) => !matched.has(f.name))
  if (rest.length > 0) groups.push({ id: 'other', title: 'Other columns', rows: rest })

  return (
    <div>
      {groups.map((group) => (
        <RegistryGroup key={group.id} id={group.id} title={group.title} rows={group.rows.length}>
          {group.rows.map((feature) => (
            <RawRow key={feature.name} feature={feature} />
          ))}
        </RegistryGroup>
      ))}
      {pipeline.length > 0 && (
        <RegistryGroup
          id="pipeline-derived"
          title="Pipeline-derived"
          rows={pipeline.length}
        >
          {pipeline.map((feature) => (
            <PipelineRow key={feature?.name} feature={feature} />
          ))}
        </RegistryGroup>
      )}
    </div>
  )
}
