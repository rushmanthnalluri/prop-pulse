/**
 * Neighborhood map (SPEC §5.3/§7.5): OSM tiles centered on Ames with one
 * keyboard-focusable Leaflet Marker (divIcon dot) per neighborhood — fill =
 * clusterColor(cluster_id) — plus a dashed centroid ring per micro-market
 * and the 4-swatch `.map-legend` inside the `.map-shell`.
 *
 * Accessibility (AUDIT §5.4 fix — popups were mouse-only): real markers with
 * Leaflet's `keyboard: true` — Tab focuses a point, Enter opens its popup,
 * Esc closes it, and the popup's "Value a home here →" router link is a real
 * <a> reachable by Tab. A labeled "Highlight a neighborhood" select offers
 * the same focus+popup without pointing, and the sortable directory table
 * below is the full non-map equivalent (the map's aria-label says so).
 *
 * Hardening contract: `points` arrives pre-validated by the parent (finite
 * lat/long only; skipped points are disclosed in the UI there, AUDIT §2.3).
 * Centroid rings and the fly-to helper double-check coordinates before
 * drawing/flying. Opening a popup reports its cluster upward so the rail
 * card and the market profile stay in sync (marker → rail sync fix).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { divIcon } from 'leaflet'
import { clusterColor } from '../constants'
import { formatNumber, formatPct, formatUsd, humanizeNote } from '../format'
import useReducedMotion from './shared/useReducedMotion'

const AMES_CENTER = [42.0347, -93.62]

const fin = (value) => Number.isFinite(Number(value))

/** Flies the map to the selected micro-market's centroid (rail card / deep link). */
function FlyToTarget({ target, reduced }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    const lat = Number(target.centroid_lat)
    const long = Number(target.centroid_long)
    if (Number.isFinite(lat) && Number.isFinite(long)) {
      map.flyTo([lat, long], 13, { duration: reduced ? 0 : 0.6 })
    }
  }, [map, target, reduced])
  return null
}

/**
 * Esc closes any open popup regardless of which popup element holds focus.
 * Leaflet's own closeOnEscapeKey only fires once the map container itself
 * has been focused, which keyboard popup navigation never does.
 */
function PopupEscapeHandler() {
  const map = useMap()
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') map.closePopup()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [map])
  return null
}

/**
 * Opens the requested point's popup (toolbar select). Leaflet's autopan
 * brings the marker and popup into view, so no explicit fly is needed.
 */
function FocusPoint({ focus, points, markerRefs }) {
  const map = useMap()
  useEffect(() => {
    if (!focus?.code) return
    const point = points.find((p) => p.neighborhood === focus.code)
    if (!point) return
    if (map && Number.isFinite(point.lat) && Number.isFinite(point.long)) {
      markerRefs.current.get(focus.code)?.openPopup()
    }
  }, [map, focus, points, markerRefs])
  return null
}

export default function NeighborhoodMap({
  points,
  clusters,
  clusterById,
  activeClusterId = null,
  flyTo = null,
  onSelectCluster,
}) {
  const reduced = useReducedMotion()
  const markerRefs = useRef(new Map())
  // Code of the point whose popup was opened from the keyboard — used to
  // move focus into the popup, and back to the marker when it closes.
  const keyboardPopup = useRef(null)
  // The toolbar select behaves as an action menu: it stays on the placeholder
  // and every pick fires a fresh focus request object.
  const [focus, setFocus] = useState(null)

  // One divIcon per cluster color, memoized — the dot is CSS, the 28px box
  // is the tap target (SPEC §8 mobile tap targets).
  const iconFor = useMemo(() => {
    const cache = new Map()
    return (clusterId) => {
      const key = Number.isInteger(Number(clusterId)) ? Number(clusterId) : 'unknown'
      if (!cache.has(key)) {
        cache.set(
          key,
          divIcon({
            className: 'map-marker',
            html: `<span class="map-marker-dot" style="background:${clusterColor(clusterId)}"></span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14],
          }),
        )
      }
      return cache.get(key)
    }
  }, [])

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <label className="map-toolbar-label" htmlFor="market-focus-select">
          Highlight a neighborhood
        </label>
        <select
          id="market-focus-select"
          className="map-toolbar-select"
          value=""
          onChange={(event) => {
            const code = event.target.value
            if (code) setFocus({ code, at: Date.now() })
          }}
        >
          <option value="">Choose a neighborhood…</option>
          {points.map((point) => (
            <option key={point.neighborhood} value={point.neighborhood}>
              {point.name ?? point.neighborhood} ({point.neighborhood})
            </option>
          ))}
        </select>
      </div>
      <div
        role="application"
        aria-label="Map of Ames neighborhood centroids, colored by micro-market. Tab to a point and press Enter for details; the sortable directory table below carries the same data."
      >
        <MapContainer center={AMES_CENTER} zoom={12} className="map-canvas" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FlyToTarget target={flyTo} reduced={reduced} />
          <FocusPoint focus={focus} points={points} markerRefs={markerRefs} />
          <PopupEscapeHandler />
          {/* Micro-market centroids: non-interactive dashed rings. */}
          {clusters.map((cluster) => {
            const lat = Number(cluster?.centroid_lat)
            const long = Number(cluster?.centroid_long)
            if (!Number.isFinite(lat) || !Number.isFinite(long)) return null
            return (
              <CircleMarker
                key={`centroid-${cluster?.cluster_id}`}
                center={[lat, long]}
                radius={13}
                interactive={false}
                pathOptions={{
                  color: clusterColor(cluster?.cluster_id),
                  weight: 2,
                  dashArray: '3 4',
                  fill: false,
                }}
              />
            )
          })}
          {points.map((point) => {
            const cluster = clusterById[point.cluster_id]
            const velocityNote =
              typeof cluster?.note === 'string' && cluster.note ? cluster.note : null
            const dimmed = activeClusterId !== null && point.cluster_id !== activeClusterId
            return (
              <Marker
                key={point.neighborhood}
                position={[point.lat, point.long]}
                icon={iconFor(point.cluster_id)}
                title={`${point.name ?? point.neighborhood} — press Enter for market details`}
                keyboard
                opacity={dimmed ? 0.3 : 1}
                ref={(marker) => {
                  if (marker) markerRefs.current.set(point.neighborhood, marker)
                  else markerRefs.current.delete(point.neighborhood)
                }}
                eventHandlers={{
                  keypress: (event) => {
                    if (event.originalEvent?.key !== 'Enter') return
                    // Leaflet opens the popup on Enter; move focus into it so
                    // Tab reaches the "Value a home here →" link and Esc (map
                    // keyboard handler) closes the popup (AUDIT §5.4 fix).
                    keyboardPopup.current = point.neighborhood
                    window.setTimeout(() => {
                      const popupEl = markerRefs.current
                        .get(point.neighborhood)
                        ?.getPopup()
                        ?.getElement()
                      const target =
                        popupEl?.querySelector('.leaflet-popup-content a') ??
                        popupEl?.querySelector('.leaflet-popup-close-button')
                      target?.focus()
                    }, 0)
                  },
                  popupopen: () => onSelectCluster?.(point.cluster_id),
                  popupclose: () => {
                    // A keyboard-opened popup takes its focused content with
                    // it when it closes — return focus to the marker.
                    if (keyboardPopup.current === point.neighborhood) {
                      keyboardPopup.current = null
                      markerRefs.current.get(point.neighborhood)?.getElement()?.focus()
                    }
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -12]}>
                  {point.name}
                </Tooltip>
                <Popup>
                  <div>
                    <strong>{point.name}</strong>{' '}
                    {point.fallback && <span className="badge badge-warn">approximate</span>}
                    {cluster && (
                      <dl className="kv" style={{ marginTop: 8 }}>
                        <div>
                          <dt>Micro-market</dt>
                          <dd style={{ textTransform: 'capitalize' }}>{cluster.label}</dd>
                        </div>
                        <div>
                          <dt>Median price</dt>
                          <dd>{fin(cluster.median_price) ? formatUsd(cluster.median_price) : '—'}</dd>
                        </div>
                        <div>
                          <dt>Median $/sqft</dt>
                          <dd>
                            {fin(cluster.median_price_per_sqft)
                              ? formatNumber(cluster.median_price_per_sqft, 1)
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>30-day velocity</dt>
                          <dd>
                            {fin(cluster.sale_velocity_30d) ? formatPct(cluster.sale_velocity_30d) : '—'}{' '}
                            <span className="badge badge-muted">simulated</span>
                          </dd>
                        </div>
                      </dl>
                    )}
                    {velocityNote && (
                      <p className="note velocity-note" style={{ marginTop: 8 }}>
                        {humanizeNote(velocityNote)}
                      </p>
                    )}
                    {point.fallback && (
                      <p className="note" style={{ marginTop: 8 }}>
                        Approximate centroid — assigned to the nearest micro-market.
                      </p>
                    )}
                    <p style={{ marginTop: 8 }}>
                      <Link to={`/valuation?neighborhood=${encodeURIComponent(point.neighborhood)}`}>
                        Value a home here →
                      </Link>
                    </p>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
      <div className="map-legend">
        {clusters.map((cluster) => (
          <span className="legend-item" key={cluster.cluster_id}>
            <span
              className="swatch"
              style={{ backgroundColor: clusterColor(cluster.cluster_id) }}
              aria-hidden="true"
            />
            <span style={{ textTransform: 'capitalize' }}>{cluster.label}</span>
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-ring" aria-hidden="true" />
          <span>micro-market centroid (approx.)</span>
        </span>
      </div>
    </div>
  )
}
