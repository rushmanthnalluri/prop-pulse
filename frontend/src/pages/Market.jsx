/**
 * Market Intelligence page — rebuilt on the PlacementPredict design language
 * (docs/frontend/PLACEMENTPREDICT_UI_BLUEPRINT.md §2/§4/§5/§6): page-head
 * (kicker / title / desc / mono page-meta with real coverage facts), then
 * hairline-separated sections — map + micro-market rail + selected-market
 * profile, the sortable neighborhood directory (same /market/clusters
 * payload — no second fetch), and the trends chart (own fetch, fully
 * independent states — a failed trends call never blanks the map, and vice
 * versa).
 *
 * Hardening kept from the audit pass: every map point is coordinate-checked
 * before render — malformed points are skipped AND disclosed in the UI ("N of
 * 25 neighborhood points could not be placed"). Page-meta counts come from
 * the payload, never hardcoded. `?cluster=<id>` is a supported deep link;
 * unknown values are dropped silently.
 *
 * The two clusters-driven sections share ONE fetch lifecycle: a failure
 * renders a single error box (in the map section) instead of stacked
 * duplicates — the same one-async-unit rule the Model Insights page uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { humanizeNote } from '../format'
import ClusterRail from '../components/market/ClusterRail'
import MarketProfile from '../components/market/MarketProfile'
import TrendsPanel from '../components/market/TrendsPanel'
import NeighborhoodMap from '../components/NeighborhoodMap'
import NeighborhoodTable from '../components/NeighborhoodTable'
import { EmptyState, ErrorState, PanelSkeleton } from '../components/StateView'
import { SkeletonLine } from '../components/shared/Skeleton'
// Keep after NeighborhoodMap: market.css's leaflet overrides must land later
// than the leaflet.css that NeighborhoodMap imports (module order = CSS order).
import '../styles/market.css'

export default function MarketPage() {
  const fetcher = useCallback((signal) => api.marketClusters(signal), [])
  const { data, loading, error, reload } = useApi(fetcher)
  const [activeClusterId, setActiveClusterId] = useState(null)
  const [flyToTarget, setFlyToTarget] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Shape guards: a contract-drifting payload degrades to the empty state
  // instead of throwing mid-render.
  const clusters = useMemo(() => (Array.isArray(data?.clusters) ? data.clusters : []), [data])
  const neighborhoods = useMemo(
    () => (Array.isArray(data?.neighborhoods) ? data.neighborhoods : []),
    [data],
  )
  const clusterById = useMemo(
    () => Object.fromEntries(clusters.map((c) => [c.cluster_id, c])),
    [clusters],
  )

  // Guard every point: only finite lat/long with a code reaches the map;
  // the rest are named and disclosed under the map.
  const { points, skippedNames } = useMemo(() => {
    const valid = []
    const bad = []
    for (const n of neighborhoods) {
      const lat = Number(n?.lat)
      const long = Number(n?.long)
      if (n?.neighborhood && Number.isFinite(lat) && Number.isFinite(long)) {
        valid.push({ ...n, lat, long })
      } else {
        bad.push(n?.name ?? n?.neighborhood ?? 'unknown')
      }
    }
    return { points: valid, skippedNames: bad }
  }, [neighborhoods])

  useEffect(() => {
    if (skippedNames.length > 0) {
      console.warn(
        `[market] skipped ${skippedNames.length} neighborhood point(s) with missing or non-finite coordinates:`,
        skippedNames,
      )
    }
  }, [skippedNames])

  // Selection is mirrored to ?cluster= (replace — no history spam); the
  // effect below treats an already-applied param as a no-op so marker-driven
  // selections never trigger a fly-to.
  const lastAppliedParam = useRef(null)
  const selectCluster = useCallback(
    (id, { fly = false } = {}) => {
      setActiveClusterId(id)
      if (fly && id !== null && clusterById[id]) setFlyToTarget(clusterById[id])
      lastAppliedParam.current = id === null ? null : String(id)
      setSearchParams(id === null ? {} : { cluster: String(id) }, { replace: true })
    },
    [clusterById, setSearchParams],
  )

  // ?cluster=<id> deep link: validated against the payload, invalid values
  // dropped silently. Applies selection + fly once per param.
  const clusterParam = searchParams.get('cluster')
  useEffect(() => {
    if (clusterParam === null) {
      lastAppliedParam.current = null
      return
    }
    if (lastAppliedParam.current === clusterParam) return
    const id = Number(clusterParam)
    if (Number.isInteger(id) && clusterById[id]) {
      lastAppliedParam.current = clusterParam
      setActiveClusterId(id)
      setFlyToTarget(clusterById[id])
    }
  }, [clusterParam, clusterById])

  const activeCluster =
    activeClusterId !== null ? (clusterById[activeClusterId] ?? null) : null

  // Profile members: cluster codes joined to display names + fallback flags.
  const memberInfoByCode = useMemo(
    () =>
      Object.fromEntries(
        neighborhoods
          .filter((n) => n?.neighborhood)
          .map((n) => [
            n.neighborhood,
            { code: n.neighborhood, name: n.name ?? n.neighborhood, fallback: Boolean(n.fallback) },
          ]),
      ),
    [neighborhoods],
  )
  const activeMembers = useMemo(() => {
    if (!activeCluster) return []
    const codes = Array.isArray(activeCluster.neighborhoods) ? activeCluster.neighborhoods : []
    return codes.map((code) => memberInfoByCode[code] ?? { code, name: code, fallback: false })
  }, [activeCluster, memberInfoByCode])

  // Simulated-velocity caveat (identical across clusters); rendered with raw
  // schema identifiers humanized.
  const velocityNote = clusters.find((c) => typeof c?.note === 'string' && c.note)?.note ?? null

  const hasData = !loading && !error && neighborhoods.length > 0
  const metaCounts = hasData
    ? `${neighborhoods.length} neighborhoods · ${clusters.length} micro-markets · `
    : ''

  return (
    <>
      <header className="page-head">
        <p className="kicker">Market Intelligence</p>
        <h1 className="page-title">Micro-markets across Ames</h1>
        <p className="page-desc">
          Neighborhoods are grouped into micro-markets clustered from location, price level, and
          sale velocity. Select a market card to fly the map; select a map point or a table row to
          start a valuation there.
        </p>
        <p className="page-meta">
          {metaCounts}sales 2006–2008 · approximate centroids
        </p>
      </header>

      <hr className="divider" aria-hidden="true" />

      {/* Map + cluster rail + selected-market profile */}
      <section className="section" aria-label="Neighborhood map">
        <div className="section-head">
          <h2 className="section-title">The map — approximate neighborhood centroids</h2>
          <span className="section-note">tab to a point · Enter for details · cards fly the map</span>
        </div>
        {loading && (
          <div className="market-map-grid" aria-hidden="true">
            <PanelSkeleton height={460} />
            <div className="cluster-rail">
              {[0, 1, 2, 3].map((i) => (
                <PanelSkeleton key={i} height={118} />
              ))}
            </div>
          </div>
        )}
        {!loading && error && (
          <ErrorState title="Couldn't load market clusters" error={error} onRetry={reload} />
        )}
        {!loading && !error && neighborhoods.length === 0 && (
          <EmptyState
            kicker="No neighborhoods"
            title="No map points returned"
            detail="The API returned an empty neighborhood list."
          />
        )}
        {hasData && (
          <>
            <div className="market-map-grid">
              <NeighborhoodMap
                points={points}
                clusters={clusters}
                clusterById={clusterById}
                activeClusterId={activeClusterId}
                flyTo={flyToTarget}
                onSelectCluster={(id) => selectCluster(id)}
              />
              <ClusterRail
                clusters={clusters}
                activeClusterId={activeClusterId}
                onSelect={(id) => selectCluster(id, { fly: id !== null })}
              />
            </div>
            {skippedNames.length > 0 && (
              <p className="alert alert-warn market-skip-note" role="status">
                <span className="alert-title">Some map points could not be placed</span>
                {skippedNames.length} of {neighborhoods.length} neighborhood points could not be
                placed ({skippedNames.join(', ')}) — {skippedNames.length === 1 ? 'it is' : 'they are'}{' '}
                still listed in the directory below.
              </p>
            )}
            <MarketProfile cluster={activeCluster} members={activeMembers} />
          </>
        )}
      </section>

      {/* Neighborhood directory — the same clusters payload, so it shares the
          map section's lifecycle: skeleton while loading, the table once data
          lands (error/empty render no directory). */}
      {(hasData || loading) && (
        <>
          <hr className="divider" aria-hidden="true" />
          <section className="section market-directory" aria-label="Neighborhood directory">
            <div className="section-head">
              <h2 className="section-title">Directory — search, filter, sort any column</h2>
              <span className="section-note">cluster-level medians · rows link to valuation</span>
            </div>
            {loading ? (
              <div className="panel market-table-skeleton" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <SkeletonLine key={i} width={`${92 - (i % 4) * 7}%`} />
                ))}
              </div>
            ) : (
              <NeighborhoodTable neighborhoods={neighborhoods} clusterById={clusterById} />
            )}
          </section>
        </>
      )}

      <hr className="divider" aria-hidden="true" />

      {/* Trends — independent fetch, own states */}
      <section className="section market-trends" aria-label="Market trends">
        <div className="section-head">
          <h2 className="section-title">Trends — median sale price by half-year</h2>
          <span className="section-note">Training sales 2006–2008 · gaps = no sales that half-year</span>
        </div>
        <TrendsPanel />
      </section>

      <hr className="divider" aria-hidden="true" />

      {/* Honesty notes */}
      <section className="section market-notes" aria-label="Data notes">
        <div className="section-head">
          <h2 className="section-title">Data notes</h2>
        </div>
        <div className="market-notes-body">
          <p className="note">
            Map points are approximate geocoded neighborhood centroids, not parcel
            locations; dashed rings mark the micro-market centroids.
          </p>
          {velocityNote && <p className="note">{humanizeNote(velocityNote)}</p>}
          <p className="note">
            Every figure on this page comes from the training sales, 2006–2008, Ames, Iowa, in
            nominal dollars — none of it describes today&apos;s market.
          </p>
        </div>
      </section>
    </>
  )
}
