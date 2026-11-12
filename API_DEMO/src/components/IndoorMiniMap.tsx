import { useEffect, useRef, useState } from 'react'
import {
  createAdvancedMarker,
  latLngLiteral,
  loadGoogleMaps,
  mapOptions,
  setAdvancedMarkerSvg,
  type AdvMarker,
} from '../googleMaps'
import { bearingDeg, haversineM, type LiveFix } from '../liveNavigation'

type Pin = {
  latitude: number
  longitude: number
  label: string
}

type Props = {
  liveFix: LiveFix | null
  /** Final unit pin (D). */
  destination: Pin
  /** Entrance / current indoor stop — used to frame the map when you're still approaching. */
  focus?: Pin | null
}

/** Beyond this, don't zoom out to fit you↔unit (looks like indoor “starts from far”). */
const NEAR_BUILDING_M = 150

function pinSvg(fill: string, label: string) {
  const safe = label.slice(0, 1).toUpperCase().replace(/[<>&"]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <path d="M18 1c-8.3 0-15 6.7-15 15 0 11.2 15 27 15 27s15-15.8 15-27C33 7.7 26.3 1 18 1z" fill="${fill}" stroke="#fff" stroke-width="2"/>
  <circle cx="18" cy="16" r="7" fill="#fff"/>
  <text x="18" y="20" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="${fill}">${safe}</text>
</svg>`
}

function livePuckSvg(rotDeg: number | null) {
  const hasHeading = rotDeg != null && Number.isFinite(rotDeg)
  const rot = hasHeading ? Number(rotDeg) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 80 80">
  <g transform="rotate(${rot.toFixed(1)} 40 40)">
    ${
      hasHeading
        ? `<path d="M40 4 L55 30 L40 24 L25 30 Z" fill="#1a73e8" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>`
        : ''
    }
    <circle cx="40" cy="40" r="16" fill="#1a73e8" stroke="#ffffff" stroke-width="5"/>
    <circle cx="40" cy="40" r="5.5" fill="#ffffff"/>
  </g>
</svg>`
}

function normalizeDeg(d: number) {
  return ((d % 360) + 360) % 360
}

function relativeCue(heading: number | null, bearing: number, targetLabel: string): string {
  if (heading == null || !Number.isFinite(heading)) return `Walk toward ${targetLabel}`
  const delta = ((bearing - heading + 540) % 360) - 180
  if (Math.abs(delta) <= 25) return `${targetLabel} is ahead — keep going`
  if (delta > 25 && delta <= 140) return `${targetLabel} is to your right`
  if (delta < -25 && delta >= -140) return `${targetLabel} is to your left`
  return `${targetLabel} is behind you — turn around`
}

export function IndoorMiniMap({ liveFix, destination, focus }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const destMarkerRef = useRef<AdvMarker | null>(null)
  const focusMarkerRef = useRef<AdvMarker | null>(null)
  const puckRef = useRef<AdvMarker | null>(null)
  const lineRef = useRef<google.maps.Polyline | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [cue, setCue] = useState('Unit pin on the map')

  const dest = latLngLiteral(Number(destination.latitude), Number(destination.longitude))
  const focusLit =
    focus && Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude)
      ? latLngLiteral(Number(focus.latitude), Number(focus.longitude))
      : dest
  const focusLabel = focus?.label || destination.label || 'entrance'

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !hostRef.current) return
        const map = new google.maps.Map(
          hostRef.current,
          mapOptions(focusLit, 18, {
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
            zoomControl: true,
            gestureHandling: 'greedy',
            clickableIcons: false,
          }),
        )
        mapRef.current = map
        destMarkerRef.current = createAdvancedMarker({
          map,
          position: dest,
          title: destination.label || 'Unit',
          zIndex: 40,
          svg: pinSvg('#ea4335', 'D'),
        })
        setReady(true)
        setError('')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Map failed to load')
      })

    return () => {
      cancelled = true
      if (puckRef.current) puckRef.current.map = null
      if (destMarkerRef.current) destMarkerRef.current.map = null
      if (focusMarkerRef.current) focusMarkerRef.current.map = null
      accuracyRef.current?.setMap(null)
      lineRef.current?.setMap(null)
      puckRef.current = null
      destMarkerRef.current = null
      focusMarkerRef.current = null
      accuracyRef.current = null
      lineRef.current = null
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination.latitude, destination.longitude, destination.label])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const sameFocusAsDest =
      Math.abs(focusLit.lat - dest.lat) < 1e-5 && Math.abs(focusLit.lng - dest.lng) < 1e-5

    if (!sameFocusAsDest) {
      if (!focusMarkerRef.current) {
        focusMarkerRef.current = createAdvancedMarker({
          map,
          position: focusLit,
          title: focusLabel,
          zIndex: 45,
          svg: pinSvg('#22c55e', 'E'),
        })
      } else {
        focusMarkerRef.current.position = focusLit
        focusMarkerRef.current.map = map
      }
    } else if (focusMarkerRef.current) {
      focusMarkerRef.current.map = null
      focusMarkerRef.current = null
    }

    if (!liveFix) {
      if (puckRef.current) puckRef.current.map = null
      puckRef.current = null
      accuracyRef.current?.setMap(null)
      accuracyRef.current = null
      lineRef.current?.setMap(null)
      lineRef.current = null
      map.setCenter(focusLit)
      map.setZoom(18)
      setCue(`At the building · ${focusLabel} (waiting for GPS)`)
      return
    }

    const you = latLngLiteral(liveFix.latitude, liveFix.longitude)
    const distToUnit = haversineM(liveFix.latitude, liveFix.longitude, dest.lat, dest.lng)
    const distToFocus = haversineM(liveFix.latitude, liveFix.longitude, focusLit.lat, focusLit.lng)
    const nearBuilding = Math.min(distToUnit, distToFocus) <= NEAR_BUILDING_M
    const aim = nearBuilding ? dest : focusLit
    const aimLabel = nearBuilding ? destination.label || 'unit' : focusLabel
    const bearing = bearingDeg(liveFix.latitude, liveFix.longitude, aim.lat, aim.lng)
    const heading =
      liveFix.heading != null && Number.isFinite(liveFix.heading)
        ? normalizeDeg(liveFix.heading)
        : null
    const puckRot = heading

    if (!puckRef.current) {
      puckRef.current = createAdvancedMarker({
        map,
        position: you,
        title: 'You (live)',
        zIndex: 1000,
        svg: livePuckSvg(puckRot),
        anchor: 'center',
      })
    } else {
      puckRef.current.position = you
      setAdvancedMarkerSvg(puckRef.current, livePuckSvg(puckRot), 'center')
    }

    const accR = Math.max(8, Math.min(40, liveFix.accuracy || 15))
    if (!accuracyRef.current) {
      accuracyRef.current = new google.maps.Circle({
        map,
        center: you,
        radius: accR,
        strokeColor: '#1a73e8',
        strokeOpacity: 0.4,
        strokeWeight: 1,
        fillColor: '#1a73e8',
        fillOpacity: 0.1,
        zIndex: 5,
      })
    } else {
      accuracyRef.current.setCenter(you)
      accuracyRef.current.setRadius(accR)
    }

    if (!lineRef.current) {
      lineRef.current = new google.maps.Polyline({
        map,
        path: [you, aim],
        strokeColor: '#1a73e8',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        geodesic: true,
        zIndex: 8,
      })
    } else {
      lineRef.current.setPath([you, aim])
    }

    if (nearBuilding) {
      const bounds = new google.maps.LatLngBounds()
      bounds.extend(you)
      bounds.extend(dest)
      if (!sameFocusAsDest) bounds.extend(focusLit)
      map.fitBounds(bounds, { top: 36, right: 36, bottom: 36, left: 36 })
      const z = map.getZoom() ?? 18
      if (z > 19) map.setZoom(19)
      if (z < 16) map.setZoom(17)
    } else {
      // Still approaching — keep street zoom on you → entrance, never campus-wide fit to unit.
      map.setCenter(you)
      map.setZoom(17)
    }

    const distM = nearBuilding ? distToUnit : distToFocus
    const distLabel =
      distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`
    setCue(
      nearBuilding
        ? `${relativeCue(heading, bearing, 'Unit')} · ~${distLabel}`
        : `Head to ${aimLabel} first · ~${distLabel} (indoor unlocks at the door)`,
    )
  }, [
    liveFix,
    ready,
    dest.lat,
    dest.lng,
    destination.label,
    focusLit.lat,
    focusLit.lng,
    focusLabel,
  ])

  return (
    <div className="indoor-mini">
      <div className="indoor-mini__head">
        <span className="indoor-mini__title">Live map · you → building / unit</span>
        <span className="indoor-mini__cue">{cue}</span>
      </div>
      {error ? (
        <p className="indoor-mini__error" role="alert">
          {error}
        </p>
      ) : (
        <div className="indoor-mini__map" ref={hostRef} aria-label="Indoor live map to unit" />
      )}
      <p className="indoor-mini__legend">
        <span className="is-you">● You</span>
        <span className="is-focus">● Entrance</span>
        <span className="is-dest">● Unit (D)</span>
        Indoor GPS can be approximate — use the arrow for direction.
      </p>
    </div>
  )
}
