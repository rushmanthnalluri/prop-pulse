/**
 * COMPARABLE SALES (SPEC §5.2.2-6): POSTs the submitted property payload to
 * /market/comps and renders the returned historical (2006–2008) sales under
 * the valuation result. In-flight requests abort when superseded or on
 * unmount; failures degrade to an ErrorState with a retry button and never
 * affect the valuation panels above.
 *
 * Refinements: stable composite row keys (the API serves no id — never the
 * array index, AUDIT §5.5); Price and Sold columns sort via
 * useSortable/SortHeader (SPEC §7.6 — natural order is the API's similarity
 * rank and the caption says so); each row expands to a comp-vs-subject
 * comparison over the fields comps actually serve plus the sale price vs
 * estimate delta (SPEC §6.4 — client-side from the stored payload, no new
 * endpoint). match_scope, percentile, note, and calendar_clamped disclosures
 * render verbatim.
 */
import { Fragment, useEffect, useState } from 'react'
import { api } from '../api/client'
import useSortable from './shared/useSortable'
import SortHeader from './shared/SortHeader'
import { ENUM_LABELS, NEIGHBORHOODS } from '../constants'
import { formatNumber, formatUsd, formatYear } from '../format'
import { EmptyState, ErrorState, PanelSkeleton } from './StateView'

/** "NAmes" → "North Ames (NAmes)"; unknown codes pass through unchanged. */
function neighborhoodLabel(code) {
  const match = NEIGHBORHOODS.find((n) => n.value === code)
  return match ? `${match.label} (${match.value})` : code
}

/** "03/2007" → a sortable month ordinal; unparsable → null (sorts last). */
function soldOrdinal(sold) {
  const match = /^(\d{1,2})\/(\d{4})$/.exec(String(sold ?? '').trim())
  if (!match) return null
  return Number(match[2]) * 12 + Number(match[1])
}

/** Composite identity for a comp row — stable across sorts and re-renders. */
function compKey(comp) {
  return [
    comp.sale_price,
    comp.sold,
    comp.gr_liv_area,
    comp.year_built,
    comp.overall_qual,
    comp.baths,
  ].join('|')
}

function fmtSqft(value) {
  const n = Number(value)
  return Number.isFinite(n) ? `${formatNumber(n, 0)} sq ft` : '—'
}

function fmtPlain(value) {
  const n = Number(value)
  return Number.isFinite(n) ? formatNumber(n, 0) : '—'
}

function fmtBaths(value) {
  const n = Number(value)
  return Number.isFinite(n) ? formatNumber(n, 1) : '—'
}

function styleLabel(code) {
  if (!code) return '—'
  return ENUM_LABELS.house_style[code] ?? code
}

/** SPEC §6.4 mini comparison: this sale vs the subject property. */
function Comparison({ comp, payload, estimate }) {
  const subjectBaths =
    Number(payload?.full_bath ?? NaN) + 0.5 * Number(payload?.half_bath ?? 0)
  const rows = [
    ['Sale price', formatUsd(comp.sale_price), Number.isFinite(estimate) ? formatUsd(estimate) : '—'],
    ['Living area', fmtSqft(comp.gr_liv_area), fmtSqft(payload?.gr_liv_area)],
    ['Overall quality', fmtPlain(comp.overall_qual), fmtPlain(payload?.overall_qual)],
    ['Overall condition', fmtPlain(comp.overall_cond), fmtPlain(payload?.overall_cond)],
    ['Year built', formatYear(comp.year_built), formatYear(payload?.year_built)],
    ['Bedrooms', fmtPlain(comp.bedrooms), fmtPlain(payload?.bedrooms)],
    ['Baths (above grade)', fmtBaths(comp.baths), fmtBaths(subjectBaths)],
    ['Garage (cars)', fmtPlain(comp.garage_cars), fmtPlain(payload?.garage_cars)],
    ['House style', styleLabel(comp.house_style), styleLabel(payload?.house_style)],
  ]
  const price = Number(comp.sale_price)
  const delta = Number.isFinite(price) && Number.isFinite(estimate) ? price - estimate : null

  return (
    <div className="cmp">
      <span className="cmp-head" aria-hidden="true" />
      <span className="cmp-head">This sale</span>
      <span className="cmp-head">This property</span>
      {rows.map(([label, compValue, subjectValue]) => (
        <Fragment key={label}>
          <span className="cmp-label">{label}</span>
          <span className="cmp-value">{compValue}</span>
          <span className="cmp-value cmp-value--subject">{subjectValue}</span>
        </Fragment>
      ))}
      {delta !== null && (
        <>
          <span className="cmp-label">Vs the estimate</span>
          <span className={`cmp-value ${delta >= 0 ? 'pos' : 'neg'}`}>
            {delta >= 0 ? '+' : '−'}
            {formatUsd(Math.abs(delta))}
          </span>
          <span className="cmp-value cmp-value--subject" aria-hidden="true" />
        </>
      )}
    </div>
  )
}

export default function CompsTable({ payload, estimate }) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const [retryKey, setRetryKey] = useState(0)
  const [open, setOpen] = useState({})

  useEffect(() => {
    if (!payload) return undefined
    let cancelled = false
    const controller = new AbortController()
    setState({ data: null, loading: true, error: null })
    api
      .getComps(payload, controller.signal)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((error) => {
        if (!cancelled && error?.name !== 'AbortError') {
          setState({ data: null, loading: false, error })
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [payload, retryKey])

  const comps = Array.isArray(state.data?.comps) ? state.data.comps : []
  const rows = comps.map((comp) => ({
    ...comp,
    _key: compKey(comp),
    _sold: soldOrdinal(comp.sold),
  }))
  const { sorted, sort, toggleSort } = useSortable(rows)

  if (!payload) return null

  const scope = state.data?.match_scope === 'cluster' ? 'cluster' : 'neighborhood'
  const pctRaw = state.data?.percentile
  const percentile = pctRaw === null || pctRaw === undefined ? NaN : Number(pctRaw)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Comparable sales</span>
        {!state.loading && !state.error && comps.length > 0 && (
          <span className="comps-tags">
            {state.data?.calendar_clamped === true && (
              <span className="badge badge-warn">Calendar clamped</span>
            )}
            <span className="chart-tag">top {comps.length} · 2006–2008</span>
          </span>
        )}
      </div>
      <div className="panel-body">
        {state.loading && <PanelSkeleton height={220} />}
        {!state.loading && state.error && (
          <ErrorState
            title="Comparable sales unavailable"
            error={state.error}
            onRetry={() => setRetryKey((key) => key + 1)}
          />
        )}
        {!state.loading && !state.error && comps.length === 0 && (
          <EmptyState
            kicker="No matches"
            title="No comparable sales matched"
            detail="No similar sales matched this property in the 2006–2008 training data — the valuation above is unaffected."
          />
        )}
        {!state.loading && !state.error && comps.length > 0 && (
          <>
            <p className="note" style={{ marginBottom: 10 }}>
              {comps.length} similar sales in{' '}
              {scope === 'cluster'
                ? 'this micro-market'
                : neighborhoodLabel(payload.neighborhood)}
              , ranked by similarity — the Price and Sold columns re-sort.
            </p>
            {scope === 'cluster' && (
              <p className="note" style={{ marginBottom: 10 }}>
                Matched within cluster — neighborhood had fewer than 5 training sales.
              </p>
            )}
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col" className="comp-expander">
                      <span className="visually-hidden">Compare with this property</span>
                    </th>
                    <SortHeader
                      label="Price"
                      sortKey="sale_price"
                      numeric
                      sort={sort}
                      onToggle={toggleSort}
                    />
                    <th className="num">$/sqft</th>
                    <th className="num">Sqft</th>
                    <th className="num">Qual</th>
                    <th className="num">Built</th>
                    <th>Beds/Baths</th>
                    <SortHeader label="Sold" sortKey="_sold" sort={sort} onToggle={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((comp) => {
                    const pricePerSqft = Number(comp.price_per_sqft)
                    const expanded = open[comp._key] === true
                    return (
                      <Fragment key={comp._key}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="comp-toggle"
                              aria-expanded={expanded}
                              aria-label={
                                expanded
                                  ? `Hide comparison for the ${comp.sold ?? ''} sale`
                                  : `Compare the ${comp.sold ?? ''} sale with this property`
                              }
                              onClick={() =>
                                setOpen((prev) => ({ ...prev, [comp._key]: !prev[comp._key] }))
                              }
                            >
                              {expanded ? '▾' : '▸'}
                            </button>
                          </td>
                          <td className="num strong">{formatUsd(comp.sale_price)}</td>
                          <td className="num">
                            {Number.isFinite(pricePerSqft)
                              ? `$${formatNumber(pricePerSqft)}`
                              : '—'}
                          </td>
                          <td className="num">{formatNumber(comp.gr_liv_area, 0)}</td>
                          <td className="num">{comp.overall_qual ?? '—'}</td>
                          <td className="num">{comp.year_built ?? '—'}</td>
                          <td>
                            {comp.bedrooms ?? '—'} / {comp.baths ?? '—'}
                          </td>
                          <td className="dim">{comp.sold ?? '—'}</td>
                        </tr>
                        {expanded && (
                          <tr className="comp-detail">
                            <td colSpan={8}>
                              <Comparison comp={comp} payload={payload} estimate={estimate} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {Number.isFinite(percentile) && (
              <p className="note" style={{ marginTop: 10 }}>
                Priced above {formatNumber(percentile)}% of comparable training sales.
              </p>
            )}
            {state.data?.calendar_clamped === true && (
              <p className="note" style={{ marginTop: 6 }}>
                Sale date beyond the 2006–2008 training window — matched at the window
                boundary.
              </p>
            )}
            {state.data?.note && (
              <p className="note" style={{ marginTop: 6 }}>
                {state.data.note}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
