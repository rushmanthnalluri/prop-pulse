/**
 * Market Intelligence page (SPEC §5.3): keyboard-accessible Leaflet map of
 * the 25 neighborhood centroids + micro-market rail (click → select + flyTo)
 * + selected-market profile, a sortable neighborhood directory (same
 * /market/clusters payload — no second fetch), and the trends chart (own
 * fetch, fully independent states — a failed trends call never blanks the
 * map, and vice versa).
 *
 * Hardening: every map point is coordinate-checked before render — malformed
 * points are skipped AND disclosed in the UI ("N of 25 neighborhood points
 * could not be placed"), fixing the old silent console.warn (AUDIT §2.3).
 * Page-head counts come from the payload, never hardcoded (AUDIT §2.3).
 * `?cluster=<id>` is a supported deep link (SPEC §7.7); unknown values are
 * dropped silently.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { humanizeNote } from '../format'
import ClusterRail from '../components/market/ClusterRail'
import MarketProfile from '../components/market/MarketProfile'
import NeighborhoodMap from '../components/NeighborhoodMap'
import NeighborhoodTable from '../components/NeighborhoodTable'
import TrendsChart from '../components/shared/TrendsChart'
import { EmptyState, ErrorState, PanelSkeleton } from '../components/StateView'
import { SkeletonLine } from '../components/shared/Skeleton'
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
  // the rest are named and disclosed under the map (AUDIT §2.3 fix).
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

  // ?cluster=<id> deep link (SPEC §7.7): validated against the payload,
  // invalid values dropped silently. Applies selection + fly once per param.
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

  // Simulated-velocity caveat (identical across clusters, CONTRACT §1.8);
  // rendered with raw schema identifiers humanized (WP-7c).
  const velocityNote = clusters.find((c) => typeof c?.note === 'string' && c.note)?.note ?? null

  const hasData = !loading && !error && neighborhoods.length > 0
  const metaCounts = hasData
    ? `${neighborhoods.length} neighborhoods · ${clusters.length} micro-markets · `
    : ''

  return (
    <>
      <header className="page-head">
        <p className="kicker">MARKET INTELLIGENCE</p>
        <h1 className="page-title">Four micro-markets, twenty-five neighborhoods</h1>
        <p className="page-desc">
          Neighborhoods are grouped into micro-markets clustered from location, price level, and
          sale velocity. Select a market card to fly the map; select a map point or a table row to
          start a valuation there.
        </p>
        <p className="page-meta">
          {metaCounts}sales 2006–2008 · approximate centroids (ADR-2)
        </p>
      </header>

      {/* Map + cluster rail + selected-market profile */}
      <section className="section market-map-section" style={{ paddingTop: 0 }} aria-label="Neighborhood map">
        <div className="section-head">
          <h2 className="section-title">THE MAP — APPROXIMATE NEIGHBORHOOD CENTROIDS</h2>
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

      {/* Neighborhood directory — same payload, client-side join, sortable */}
      <section className="section market-directory" aria-label="Neighborhood directory">
        <div className="section-head">
          <h2 className="section-title">DIRECTORY — SORT ANY COLUMN</h2>
          <span className="section-note">cluster-level medians · rows link to valuation</span>
        </div>
        {loading && (
          <div className="panel market-table-skeleton" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <SkeletonLine key={i} width={`${92 - (i % 4) * 7}%`} />
            ))}
          </div>
        )}
        {!loading && error && (
          <ErrorState title="Couldn't load the directory" error={error} onRetry={reload} />
        )}
        {!loading && !error && neighborhoods.length === 0 && (
          <EmptyState
            kicker="No neighborhoods"
            title="Nothing to list"
            detail="The API returned an empty neighborhood list."
          />
        )}
        {hasData && <NeighborhoodTable neighborhoods={neighborhoods} clusterById={clusterById} />}
      </section>

      {/* Trends — independent fetch, own states (SPEC §5.3) */}
      <section className="section market-trends" aria-label="Market trends">
        <div className="section-head">
          <h2 className="section-title">TRENDS — MEDIAN SALE PRICE BY HALF-YEAR</h2>
          <span className="section-note">
            train window 2006H1–2008H2 · gaps = no sales that half-year
          </span>
        </div>
        <TrendsChart wide />
      </section>

      {/* Honesty notes (SPEC §5.3 row 5) */}
      <section className="section market-notes" aria-label="Data notes">
        <div className="section-head">
          <h2 className="section-title">DATA NOTES</h2>
        </div>
        <div className="market-notes-body">
          <p className="note">
            Map points are approximate geocoded neighborhood centroids (ADR-2), not parcel
            locations; dashed rings mark the micro-market centroids.
          </p>
          {velocityNote && <p className="note">{humanizeNote(velocityNote)}</p>}
          <p className="note">
            Every figure on this page comes from the 945 training sales, 2006–2008, Ames, Iowa, in
            nominal dollars — none of it describes today&apos;s market.
          </p>
        </div>
      </section>
    </>
  )
}
