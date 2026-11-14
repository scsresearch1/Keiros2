import { useEffect, useMemo, useRef, useState } from 'react'
import type { JourneyStep, NavigateResult } from '../api'
import {
  type AdvMarker,
  createAdvancedMarker,
  geoJsonToLatLngs,
  latLngLiteral,
  loadGoogleMaps,
  mapOptions,
  setAdvancedMarkerSvg,
} from '../googleMaps'
import { planDrivePlusWalk, planWalkOnly } from '../driveWalkHandoff'
import { extractSiteWays, type SiteWaysExtract } from '../extractSiteWays'
import { pinPathToEndpoints } from '../googleRoute'
import { bearingDeg, resolvePuckPose, type LiveFix, type LiveProgress } from '../liveNavigation'
import { metersBetween, resolveOutdoorLegs, type OutdoorLeg } from '../outdoorLegs'

/** Highlight extracted site driveways so the visible driveway is obvious. */
const DRIVEWAY_LAYER = '#f59e0b'
const SIDEWALK_LAYER = '#14b8a6'
/** Firm drive line (closest driveable point). */
const ROUTE_DRIVE_BLUE = '#1a73e8'
/** Walk to entry door — round red dots on sidewalks. */
const ROUTE_WALK_DOT = '#ea4335'

type Props = {
  result: NavigateResult
  activeStep: JourneyStep | null
  weather: NavigateResult['weather']
  traffic: NavigateResult['outdoor']['traffic']
  liveFix?: LiveFix | null
  /** Live route match — enables Google-class stick-to-path puck heading. */
  liveProgress?: LiveProgress | null
  /** GPS auto-detect: walk → footpaths only; drive → roads/driveways only. */
  travelMode?: 'walk' | 'drive' | null
  followLive?: boolean
  /** Dense polylines actually drawn — used for Google-like off-route / reroute. */
  onRouteCorridor?: (corridor: {
    drive?: [number, number][]
    walk?: [number, number][]
  }) => void
  /** Turn-by-turn for the painted blue/red path (keeps left/right in sync with the map). */
  onRouteGuidance?: (steps: JourneyStep[]) => void
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function trafficColor(level?: string | null) {
  if (level === 'Severe') return '#ef4444'
  if (level === 'Heavy') return '#f97316'
  if (level === 'Moderate') return '#eab308'
  if (level === 'Light') return '#22c55e'
  return '#94a3b8'
}

const LIVE_BLUE = '#1a73e8'
/** Already-traveled corridor after recalculate (Google-style grey trail — not a 2nd active route). */
const ROUTE_RETAINED = '#94a3b8'

function metersBetweenLit(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Keep the portion of the painted corridor up to the live fix (actual path taken). */
function pathPrefixToPoint(
  path: google.maps.LatLngLiteral[],
  target: google.maps.LatLngLiteral,
): google.maps.LatLngLiteral[] {
  if (path.length < 2) return path.map((p) => ({ ...p }))
  let bestI = 0
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]
    const b = path[i + 1]
    const abx = b.lng - a.lng
    const aby = b.lat - a.lat
    const len2 = abx * abx + aby * aby
    const t =
      len2 > 0
        ? Math.max(0, Math.min(1, ((target.lng - a.lng) * abx + (target.lat - a.lat) * aby) / len2))
        : 0
    const snap = { lat: a.lat + aby * t, lng: a.lng + abx * t }
    const d = metersBetweenLit(target, snap)
    if (d < bestD) {
      bestD = d
      bestI = i
      bestT = t
    }
  }
  const out = path.slice(0, bestI + 1).map((p) => ({ ...p }))
  const a = path[bestI]
  const b = path[bestI + 1]
  const snap = {
    lat: a.lat + (b.lat - a.lat) * bestT,
    lng: a.lng + (b.lng - a.lng) * bestT,
  }
  if (metersBetweenLit(out[out.length - 1], snap) > 0.5) out.push(snap)
  return out
}

function mergeTraveledPath(
  prev: google.maps.LatLngLiteral[],
  prefix: google.maps.LatLngLiteral[],
): google.maps.LatLngLiteral[] {
  if (!prefix.length) return prev.map((p) => ({ ...p }))
  if (!prev.length) return prefix.map((p) => ({ ...p }))
  const end = prev[prev.length - 1]
  let startIdx = 0
  let best = Infinity
  for (let i = 0; i < prefix.length; i += 1) {
    const d = metersBetweenLit(end, prefix[i])
    if (d < best) {
      best = d
      startIdx = i
    }
  }
  if (best < 45) return [...prev, ...prefix.slice(startIdx + 1).map((p) => ({ ...p }))]
  return [...prev, ...prefix.map((p) => ({ ...p }))]
}

function readCollapsed(key: string) {
  try {
    return localStorage.getItem(`keiros_map_card_${key}`) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(`keiros_map_card_${key}`, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const MAP_TYPE_STORAGE = 'keiros_map_type_id'

function readStoredMapTypeId(): string {
  try {
    const v = localStorage.getItem(MAP_TYPE_STORAGE)
    if (v === 'roadmap' || v === 'hybrid' || v === 'satellite' || v === 'terrain') return v
  } catch {
    /* ignore */
  }
  return 'hybrid'
}

function writeStoredMapTypeId(id: string) {
  try {
    if (id === 'roadmap' || id === 'hybrid' || id === 'satellite' || id === 'terrain') {
      localStorage.setItem(MAP_TYPE_STORAGE, id)
    }
  } catch {
    /* ignore */
  }
}

function pinSvg(fill: string, label: string) {
  const safe = escapeHtml(label.slice(0, 1).toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <path d="M18 1c-8.3 0-15 6.7-15 15 0 11.2 15 27 15 27s15-15.8 15-27C33 7.7 26.3 1 18 1z" fill="${fill}" stroke="#fff" stroke-width="2"/>
  <circle cx="18" cy="16" r="7" fill="#fff"/>
  <text x="18" y="20" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="${fill}">${safe}</text>
</svg>`
}

/**
 * Google Maps–style “you are here” puck.
 * Circle is centered at (40,40) = map lat/lng. `rot` is clockwise from screen-up
 * (0 = arrow points to top of screen when map is heading-up).
 */
function livePuckSvg(rotDeg: number | null) {
  const hasHeading = rotDeg != null && Number.isFinite(rotDeg)
  const rot = hasHeading ? Number(rotDeg) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <defs>
    <filter id="keirosPuckShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0f172a" flood-opacity="0.45"/>
    </filter>
  </defs>
  <g transform="rotate(${rot.toFixed(1)} 40 40)" filter="url(#keirosPuckShadow)">
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

/** Shortest-path blend — snappy for phone turns, still damps GPS jitter. */
function blendHeading(prev: number | null, next: number): number {
  if (prev == null || !Number.isFinite(prev)) return next
  const delta = ((next - prev + 540) % 360) - 180
  // Large phone turns: catch up fast. Small noise: soften.
  const t = Math.abs(delta) > 35 ? 0.7 : 0.28
  return (prev + delta * t + 360) % 360
}

type SmoothPos = { lat: number; lng: number }

/**
 * Google-like GPS display filter: ignore tiny stationary noise, ease toward real movement.
 * Matching / re-route still use the raw LiveFix; only the puck + camera use this.
 */
function blendPosition(
  prev: SmoothPos | null,
  next: SmoothPos,
  opts: { speedMps: number | null; accuracyM: number },
): SmoothPos {
  if (!prev) return next
  const meters =
    Math.hypot(
      (next.lat - prev.lat) * 111_320,
      (next.lng - prev.lng) * 111_320 * Math.cos((next.lat * Math.PI) / 180),
    ) || 0
  const accuracy = Math.max(8, opts.accuracyM || 20)
  const speed = opts.speedMps != null && Number.isFinite(opts.speedMps) ? Math.max(0, opts.speedMps) : 0
  const stationary = speed < 0.6

  // Standing still: swallow GPS wobble inside the accuracy circle.
  if (stationary && meters < Math.max(4, accuracy * 0.45)) {
    return prev
  }
  // Slow walk: strong easing. Driving: catch up quicker so the puck stays ahead of the car.
  const alpha = stationary ? 0.12 : speed < 4 ? 0.22 : speed < 12 ? 0.38 : 0.55
  // Big real jumps (after a turn onto a new block) catch up faster.
  const boost = meters > Math.max(25, accuracy * 1.2) ? Math.min(0.85, alpha + 0.35) : alpha
  return {
    lat: prev.lat + (next.lat - prev.lat) * boost,
    lng: prev.lng + (next.lng - prev.lng) * boost,
  }
}

function headingDeltaDeg(a: number, b: number) {
  return Math.abs(((b - a + 540) % 360) - 180)
}

export function OutdoorMap({
  result,
  activeStep,
  weather,
  traffic,
  liveFix = null,
  liveProgress = null,
  travelMode = null,
  followLive = false,
  onRouteCorridor,
  onRouteGuidance,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<{ setMap?: (map: google.maps.Map | null) => void; map?: google.maps.Map | null }>>([])
  const liveMarkerRef = useRef<AdvMarker | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const lastLiveRef = useRef<LiveFix | null>(null)
  const smoothHeadingRef = useRef<number | null>(null)
  const smoothPosRef = useRef<SmoothPos | null>(null)
  const lastCameraHeadingRef = useRef<number | null>(null)
  const lastPuckRotRef = useRef<number | null>(null)
  const userPanningRef = useRef(false)
  const panTimerRef = useRef<number | null>(null)
  const routeSessionRef = useRef(0)
  /** Actual painted active corridor from the last draw (drive+walk). Used to retain path taken. */
  const lastActivePathRef = useRef<google.maps.LatLngLiteral[]>([])
  /** Accumulated traveled trail behind the puck after recalculates — never a 2nd Google route. */
  const traveledPathRef = useRef<google.maps.LatLngLiteral[]>([])
  /** After Navigate in Live mode, snap once to GPS at street zoom (don't wait on fitBounds). */
  const liveSnapDoneRef = useRef(false)
  const liveFixRef = useRef(liveFix)
  liveFixRef.current = liveFix
  const followLiveRef = useRef(followLive)
  followLiveRef.current = followLive
  /** User-selected basemap (Satellite/Hybrid/Map) — never overridden by Live / heading-up. */
  const userMapTypeRef = useRef(readStoredMapTypeId())

  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [siteNet, setSiteNet] = useState<{ driveways: number; sidewalks: number; routedOn: string } | null>(
    null,
  )
  const [collapsed, setCollapsed] = useState(() => ({
    legend: readCollapsed('legend'),
    weather: readCollapsed('weather'),
    traffic: readCollapsed('traffic'),
  }))
  /** Map camera heading (0 = north up). Used for compass chip. */
  const [mapHeading, setMapHeading] = useState(0)

  const outdoorPlan = useMemo(() => resolveOutdoorLegs(result), [result])

  function clearOverlays() {
    for (const item of overlaysRef.current) {
      if (typeof item.setMap === 'function') item.setMap(null)
      else item.map = null
    }
    overlaysRef.current = []
  }

  function track<T extends { setMap?: (map: google.maps.Map | null) => void; map?: google.maps.Map | null }>(
    obj: T,
    session?: number,
  ) {
    if (session != null && session !== routeSessionRef.current) {
      if (typeof obj.setMap === 'function') obj.setMap(null)
      else obj.map = null
      return obj
    }
    overlaysRef.current.push(obj)
    return obj
  }

  function toggleCard(key: keyof typeof collapsed) {
    setCollapsed((prev) => {
      const next = !prev[key]
      writeCollapsed(key, next)
      return { ...prev, [key]: next }
    })
  }

  // Create map once
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !hostRef.current) return
        const initialType = readStoredMapTypeId()
        userMapTypeRef.current = initialType
        const map = new google.maps.Map(
          hostRef.current,
          mapOptions(latLngLiteral(result.origin.latitude, result.origin.longitude), 17, {
            // Respect last user choice (Map / Satellite / Hybrid) across browsers incl. iOS Safari.
            mapTypeId: initialType,
            mapTypeControl: true,
            mapTypeControlOptions: {
              style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
              position: google.maps.ControlPosition.TOP_LEFT,
              mapTypeIds: ['roadmap', 'hybrid', 'satellite'],
            },
            // Helps iOS / Safari keep control clicks from being swallowed by gestures.
            gestureHandling: 'greedy',
            clickableIcons: false,
          }),
        )
        mapRef.current = map
        setMapReady(true)
        setMapError('')

        map.addListener('maptypeid_changed', () => {
          try {
            const id = String(map.getMapTypeId?.() || '')
            if (!id) return
            // Persist whatever the user (or Map/Satellite control) selected — incl. iOS Safari.
            if (id === 'roadmap' || id === 'hybrid' || id === 'satellite' || id === 'terrain') {
              userMapTypeRef.current = id
              writeStoredMapTypeId(id)
            }
          } catch {
            /* ignore */
          }
        })

        map.addListener('dragstart', () => {
          userPanningRef.current = true
          if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
        })
        map.addListener('dragend', () => {
          if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
          panTimerRef.current = window.setTimeout(() => {
            userPanningRef.current = false
          }, 8000)
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : 'Failed to load Google Maps')
          setMapReady(false)
        }
      })

    return () => {
      cancelled = true
      if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
      clearOverlays()
      if (liveMarkerRef.current) liveMarkerRef.current.map = null
      accuracyRef.current?.setMap(null)
      liveMarkerRef.current = null
      accuracyRef.current = null
      mapRef.current = null
      setMapReady(false)
    }
    // Map instance is created once; route effect redraws on result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Multi-leg Google Routes: drive on roads, walk on sidewalks/paths.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const gmap = map

    const session = ++routeSessionRef.current
    clearOverlays()

    const bounds = new google.maps.LatLngBounds()
    const origin = latLngLiteral(
      Number(result.origin.latitude),
      Number(result.origin.longitude),
    )
    // Retain the *actual* corridor already driven/walked. Never re-Google S→GPS
    // (that painted a second active blue fork next to the recalculated remaining route).
    const liveFrom = result.origin.liveFrom
    if (
      liveFrom &&
      Number.isFinite(liveFrom.latitude) &&
      Number.isFinite(liveFrom.longitude) &&
      lastActivePathRef.current.length > 1
    ) {
      const prefix = pathPrefixToPoint(lastActivePathRef.current, {
        lat: liveFrom.latitude,
        lng: liveFrom.longitude,
      })
      traveledPathRef.current = mergeTraveledPath(traveledPathRef.current, prefix)
    } else if (!liveFrom) {
      traveledPathRef.current = []
      lastActivePathRef.current = []
    }
    // D always sits on the unit / building destination (e.g. Fig Garden brown-roof Unit 202).
    // Entrance is a separate green waypoint — never steal the red D into a parking-lot entry pin.
    const unitDest = latLngLiteral(
      Number(result.destination.latitude ?? result.selection?.unit?.latitude),
      Number(result.destination.longitude ?? result.selection?.unit?.longitude),
    )
    const entranceDest = result.entrance
      ? latLngLiteral(Number(result.entrance.latitude), Number(result.entrance.longitude))
      : null
    const indoorContinues = Boolean(
      entranceDest &&
        ((result.map3d?.routeStops?.length ?? 0) > 1 ||
          Math.hypot(
            (unitDest.lat - entranceDest.lat) * 111_320,
            (unitDest.lng - entranceDest.lng) *
              111_320 *
              Math.cos((unitDest.lat * Math.PI) / 180),
          ) > 8),
    )
    const destination = unitDest
    if (
      !Number.isFinite(origin.lat) ||
      !Number.isFinite(origin.lng) ||
      !Number.isFinite(destination.lat) ||
      !Number.isFinite(destination.lng)
    ) {
      setMapError('Start or destination coordinates are missing from the navigate response.')
      return
    }

    const info = new google.maps.InfoWindow()
    track({
      setMap(m) {
        if (!m) info.close()
      },
    })

    function pinPopupHtml(opts: {
      kind: string
      name: string
      address?: string | null
      coords: google.maps.LatLngLiteral
    }) {
      const addr = opts.address
        ? escapeHtml(opts.address)
        : '<em style="opacity:.75">No address in backend data</em>'
      return `<div style="max-width:260px;font:13px/1.35 system-ui,sans-serif;color:#0f172a">
        <div style="font-weight:800;margin-bottom:4px">${escapeHtml(opts.kind)}</div>
        <div style="margin-bottom:6px">${escapeHtml(opts.name)}</div>
        <div style="margin-bottom:6px">${addr}</div>
        <div style="opacity:.65;font-size:11px">${opts.coords.lat.toFixed(5)}, ${opts.coords.lng.toFixed(5)}</div>
      </div>`
    }

    function openPinInfo(
      marker: AdvMarker,
      kind: string,
      name: string,
      backendAddress: string | null | undefined,
      coords: google.maps.LatLngLiteral,
    ) {
      info.close()
      info.setContent(
        pinPopupHtml({
          kind,
          name,
          address: backendAddress,
          coords,
        }),
      )
      // AdvancedMarker anchor (needs gmpClickable). Position fallback if anchor fails.
      try {
        info.open({ map: gmap, anchor: marker })
      } catch {
        info.setPosition(coords)
        info.open({ map: gmap })
      }
    }

    const startMarker = track(
      createAdvancedMarker({
        map: gmap,
        position: origin,
        title: `Start · ${result.origin.label}`,
        zIndex: 40,
        svg: pinSvg('#0ea5e9', 'S'),
      }),
    )
    const startAddress =
      result.origin.address ||
      result.selection?.complex?.address ||
      null
    startMarker.addEventListener('gmp-click', () => {
      openPinInfo(startMarker, 'Start', result.origin.label || 'Start', startAddress, origin)
    })
    bounds.extend(origin)

    const unitName =
      result.destination.label ||
      result.selection?.unit?.name ||
      'Destination'
    const destName = indoorContinues
      ? `${unitName} · enter via ${result.entrance?.label || 'entrance'}`
      : unitName
    const destAddress =
      result.destination.address ||
      result.selection?.unit?.physicalAddress ||
      result.selection?.complex?.address ||
      null
    const destMarker = track(
      createAdvancedMarker({
        map: gmap,
        position: destination,
        title: `Destination · ${destName}`,
        zIndex: 45,
        svg: pinSvg('#ea4335', 'D'),
      }),
    )
    destMarker.addEventListener('gmp-click', () => {
      openPinInfo(destMarker, 'Destination', destName, destAddress, destination)
    })
    bounds.extend(destination)

    // Outdoor target is D — do not plot Entry (E). Only parking when "Via parking" is on.
    for (const wp of outdoorPlan.waypoints) {
      if (wp.kind !== 'parking') continue
      const marker = track(
        createAdvancedMarker({
          map: gmap,
          position: wp.position,
          title: `Parking · ${wp.label}`,
          zIndex: 42,
          svg: pinSvg(wp.fill, 'P'),
        }),
      )
      marker.addEventListener('gmp-click', () => {
        openPinInfo(marker, 'Parking', wp.label, null, wp.position)
      })
      bounds.extend(wp.position)
    }

    // First Navigate only: frame the camera. Live walk↔drive recalculate must NOT
    // reset zoom (that caused the map to zoom in/out on every mode flip).
    const isLiveRecalc = Boolean(result.origin.liveFrom)
    if (!isLiveRecalc) {
      liveSnapDoneRef.current = false
      fitRouteView()
    }

    const trafficLayer = new google.maps.TrafficLayer()
    trafficLayer.setMap(gmap)
    track(trafficLayer)

    function drawPath(
      path: google.maps.LatLngLiteral[],
      from: google.maps.LatLngLiteral,
      to: google.maps.LatLngLiteral,
      style: 'drive' | 'walk-dots' | 'retained',
      zIndex: number,
    ) {
      if (session !== routeSessionRef.current) return
      // Drive: keep network end. Walk: always reach the real destination pin.
      const pinned =
        style === 'retained'
          ? path.map((p) => ({ ...p }))
          : style === 'drive'
            ? pinPathToEndpoints(path, from, path[path.length - 1] ?? to, 12, 8)
            : // Cap last-meter connect — unlimited alwaysReachEnd cut through buildings.
              pinPathToEndpoints(path, from, to, 18, 35, {
                alwaysReachEnd: true,
                maxAlwaysReachM: 45,
              })
      if (pinned.length < 2) return
      if (session !== routeSessionRef.current) return

      if (style === 'retained') {
        track(
          new google.maps.Polyline({
            map,
            path: pinned,
            strokeColor: '#ffffff',
            strokeOpacity: 0.45,
            strokeWeight: 10,
            zIndex: zIndex - 1,
            geodesic: false,
          }),
          session,
        )
        track(
          new google.maps.Polyline({
            map,
            path: pinned,
            strokeColor: ROUTE_RETAINED,
            strokeOpacity: 0.85,
            strokeWeight: 6,
            zIndex,
            geodesic: false,
          }),
          session,
        )
      } else if (style === 'walk-dots') {
        track(
          new google.maps.Polyline({
            map,
            path: pinned,
            strokeOpacity: 0,
            strokeWeight: 0,
            zIndex,
            geodesic: false,
            icons: [
              {
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  fillColor: ROUTE_WALK_DOT,
                  fillOpacity: 1,
                  strokeColor: '#ffffff',
                  strokeWeight: 1.5,
                  strokeOpacity: 1,
                  scale: 5,
                },
                offset: '0',
                repeat: '14px',
              },
            ],
          }),
          session,
        )
      } else {
        // Outer halo + firm blue core (reads better on satellite like Google Maps).
        track(
          new google.maps.Polyline({
            map,
            path: pinned,
            strokeColor: '#ffffff',
            strokeOpacity: 0.85,
            strokeWeight: 12,
            zIndex: zIndex - 1,
            geodesic: false,
          }),
          session,
        )
        track(
          new google.maps.Polyline({
            map,
            path: pinned,
            strokeColor: ROUTE_DRIVE_BLUE,
            strokeOpacity: 1,
            strokeWeight: 8,
            zIndex,
            geodesic: false,
          }),
          session,
        )
      }
      pinned.forEach((p) => bounds.extend(p))
    }

    function paintRetainedTrail() {
      const trail = traveledPathRef.current
      if (trail.length < 2) return
      drawPath(trail, trail[0], trail[trail.length - 1], 'retained', 16)
    }

    function drawExtractedNetworks(extract: SiteWaysExtract) {
      for (const way of extract.driveways) {
        const path = way.coordinates.map(([lng, lat]) => ({ lat, lng }))
        if (path.length < 2) continue
        track(
          new google.maps.Polyline({
            map,
            path,
            strokeColor: DRIVEWAY_LAYER,
            strokeOpacity: 0.9,
            strokeWeight: 5,
            zIndex: 8,
            geodesic: false,
          }),
        )
      }
      for (const way of extract.sidewalks) {
        const path = way.coordinates.map(([lng, lat]) => ({ lat, lng }))
        if (path.length < 2) continue
        track(
          new google.maps.Polyline({
            map,
            path,
            strokeColor: SIDEWALK_LAYER,
            strokeOpacity: 0.75,
            strokeWeight: 3,
            zIndex: 9,
            geodesic: false,
          }),
        )
      }
    }

    function serverFallbackForLeg(leg: OutdoorLeg) {
      if (leg.mode === 'DRIVE') {
        const outdoorPath = geoJsonToLatLngs(result.outdoor?.geometry?.coordinates)
        if (outdoorPath.length > 1) {
          drawPath(outdoorPath, leg.from, leg.to, 'drive', 20)
          return
        }
      }
      const walkPath = geoJsonToLatLngs(result.walk?.geometry?.coordinates)
      if (walkPath.length > 1) {
        drawPath(walkPath, leg.from, leg.to, 'walk-dots', 22)
        return
      }
    }

    function fitRouteView(opts?: { forceZoom?: boolean }) {
      const gmap = mapRef.current
      if (!gmap || bounds.isEmpty()) return

      // Phone Live: center once at street zoom. Later recalculates only pan — never re-zoom.
      if (followLiveRef.current) {
        const fix = liveFixRef.current
        const focus = fix
          ? latLngLiteral(fix.latitude, fix.longitude)
          : origin
        if (liveSnapDoneRef.current && !opts?.forceZoom) {
          gmap.panTo(focus)
          return
        }
        gmap.setCenter(focus)
        gmap.setZoom(17)
        liveSnapDoneRef.current = true
        return
      }

      gmap.fitBounds(bounds, { top: 56, right: 280, bottom: 56, left: 56 })
      google.maps.event.addListenerOnce(gmap, 'idle', () => {
        if (session !== routeSessionRef.current) return
        const z = gmap.getZoom() ?? 14
        // Campus / sidewalk detail needs high zoom; driveways show ~17–19.
        if (outdoorPlan.toEntranceM <= 2500 && z < 17) gmap.setZoom(17)
        if (outdoorPlan.toEntranceM <= 600 && z < 18) gmap.setZoom(18)
      })
    }

    void (async () => {
      const seedPoints = [
        origin,
        destination,
        ...outdoorPlan.waypoints.map((w) => w.position),
        ...outdoorPlan.legs.flatMap((l) => [l.from, l.to]),
      ]

      // OSM in background only — never block the Google path on Overpass 504s.
      const extractPromise = extractSiteWays(seedPoints).catch(() => null)
      void extractPromise.then((extract) => {
        if (session !== routeSessionRef.current || !extract) return
        drawExtractedNetworks(extract)
        setSiteNet({
          driveways: extract.driveways.length,
          sidewalks: extract.sidewalks.length,
          routedOn:
            extract.driveways.length || extract.sidewalks.length
              ? 'OSM layers (background)'
              : 'Google routing (OSM empty)',
        })
      })

      if (!outdoorPlan.legs.length && metersBetween(origin, destination) <= 25) {
        if (session !== routeSessionRef.current) return
        setMapError('')
        setSiteNet({ driveways: 0, sidewalks: 0, routedOn: 'at destination' })
        fitRouteView()
        return
      }

      const errors: string[] = []
      let driveWalkCount = 0
      const sources = new Set<string>()
      const corridorDrive: google.maps.LatLngLiteral[] = []
      const corridorWalk: google.maps.LatLngLiteral[] = []
      const guidanceAcc: JourneyStep[] = []

      // Prefer planned legs (drive → entrance). Fallback: Google drive to outdoor D.
      const legsToDraw: OutdoorLeg[] =
        outdoorPlan.legs.length > 0
          ? outdoorPlan.legs
          : [
              {
                id: 'drive-toward-destination',
                mode: 'DRIVE',
                from: origin,
                to: destination,
                label: indoorContinues
                  ? 'Drive to entrance (Google roads)'
                  : 'Drive toward destination (Google roads)',
                color: ROUTE_DRIVE_BLUE,
              },
            ]

      setSiteNet({
        driveways: 0,
        sidewalks: 0,
        routedOn: outdoorPlan.viaParking
          ? 'Drive to parking → walk pathways'
          : indoorContinues
            ? 'Google drive → walk to entrance'
            : 'Google drive → walk to D',
      })

      // Live recalculate (walk or drive): paint smartReroute geometry immediately.
      // Never re-fetch Google or wait on OSM — walking must feel faster than Google.
      const liveRecalc = Boolean(result.origin.liveFrom)
      // Exclusive active corridor from GPS auto-detect (stamped mode wins, else live prop).
      const exclusiveMode: 'walk' | 'drive' | null =
        result.origin.liveTravelMode === 'walk' || result.origin.liveTravelMode === 'drive'
          ? result.origin.liveTravelMode
          : followLive && (travelMode === 'walk' || travelMode === 'drive')
            ? travelMode
            : null
      if (liveRecalc) {
        paintRetainedTrail()
        const liveWalk = exclusiveMode === 'walk'
        const liveDrive = exclusiveMode !== 'walk'
        const drivePath = geoJsonToLatLngs(result.outdoor?.geometry?.coordinates)
        const walkPath = geoJsonToLatLngs(result.walk?.geometry?.coordinates)
        const liveOrigin = result.origin.liveFrom
          ? latLngLiteral(result.origin.liveFrom.latitude, result.origin.liveFrom.longitude)
          : origin

        if (liveWalk) {
          // Footpaths / walkways ONLY — never leave a blue drive line under the red dots.
          const path = walkPath.length > 1 ? walkPath : drivePath.length > 1 ? drivePath : []
          if (path.length > 1) {
            corridorWalk.push(...path)
            drawPath(path, path[0] ?? liveOrigin, destination, 'walk-dots', 22)
            sources.add('live-footpaths')
          }
          for (const step of result.walk?.steps?.length ? result.walk.steps : result.journey.steps) {
            if (step.phase !== 'walk') continue
            guidanceAcc.push({ ...step, index: guidanceAcc.length })
          }
        } else if (liveDrive && drivePath.length > 1) {
          // Roads / driveways ONLY — never paint walk dots alongside the blue line.
          corridorDrive.push(...drivePath)
          drawPath(
            drivePath,
            drivePath[0] ?? liveOrigin,
            drivePath[drivePath.length - 1] ?? destination,
            'drive',
            20,
          )
          sources.add('live-driveways')
          for (const step of result.outdoor?.steps?.length
            ? result.outdoor.steps
            : result.journey.steps) {
            if (step.phase !== 'drive' && step.phase !== 'outdoor') continue
            guidanceAcc.push({ ...step, index: guidanceAcc.length, phase: 'drive' })
          }
        }

        if (session !== routeSessionRef.current) return
        const activePath = liveWalk ? [...corridorWalk] : [...corridorDrive]
        if (activePath.length > 1) lastActivePathRef.current = activePath
        setSiteNet((prev) => ({
          driveways: prev?.driveways ?? 0,
          sidewalks: prev?.sidewalks ?? 0,
          routedOn: liveWalk
            ? 'Walking · footpaths / walkways'
            : 'Driving · roads / driveways',
        }))
        setMapError('')
        // Live recalc: keep current zoom (walk↔drive must not zoom in/out).
        if (!isLiveRecalc) fitRouteView()
        if (onRouteCorridor) {
          onRouteCorridor({
            drive: corridorDrive.length
              ? corridorDrive.map((p) => [p.lng, p.lat] as [number, number])
              : undefined,
            walk: corridorWalk.length
              ? corridorWalk.map((p) => [p.lng, p.lat] as [number, number])
              : undefined,
          })
        }
        if (onRouteGuidance && guidanceAcc.length) onRouteGuidance([...guidanceAcc])
        return
      }

      async function drawLegPlan(
        leg: OutdoorLeg,
        index: number,
        extract: SiteWaysExtract | null,
      ) {
        // Never Google-route a "from start" stub — retained trail owns history behind the puck.
        if (leg.id === 'from-session-start' || leg.skipGuidance) return
        // Live exclusive mode: ignore the other mode's legs entirely.
        if (exclusiveMode === 'walk' && leg.mode !== 'WALK') return
        if (exclusiveMode === 'drive' && leg.mode !== 'DRIVE') return

        // Drive → roads/driveways. Walk → sidewalks/footpaths.
        const plan =
          leg.mode === 'WALK'
            ? await planWalkOnly(leg.from, leg.to, extract)
            : await planDrivePlusWalk(leg.from, leg.to, extract)

        if (session !== routeSessionRef.current) return
        if (!plan.segments.length) {
          serverFallbackForLeg(leg)
          return
        }

        const segs =
          exclusiveMode === 'drive'
            ? plan.segments.filter((s) => s.mode === 'DRIVE')
            : exclusiveMode === 'walk'
              ? plan.segments.filter((s) => s.mode === 'WALK')
              : plan.segments

        if (!leg.skipGuidance && plan.guidanceSteps?.length) {
          for (const step of plan.guidanceSteps) {
            if (exclusiveMode === 'drive' && step.phase === 'walk') continue
            if (exclusiveMode === 'walk' && step.phase === 'drive') continue
            guidanceAcc.push({
              ...step,
              index: guidanceAcc.length,
              id: `${leg.id}-${step.id}`,
            })
          }
        }

        if (plan.label === 'drive+walk' && !exclusiveMode) driveWalkCount += 1
        for (const seg of segs) {
          // Via-parking drive leg: never paint a walk stub past the lot as "drive".
          if (
            outdoorPlan.viaParking &&
            leg.id === 'drive-to-parking' &&
            seg.mode === 'WALK'
          ) {
            continue
          }
          sources.add(seg.source)
          const pinFrom = seg.path[0] ?? leg.from
          const pinTo =
            seg.mode === 'WALK' ? leg.to : (seg.path[seg.path.length - 1] ?? leg.to)
          if (seg.mode === 'WALK') corridorWalk.push(...seg.path)
          else corridorDrive.push(...seg.path)
          drawPath(
            seg.path,
            pinFrom,
            pinTo,
            seg.mode === 'WALK' ? 'walk-dots' : 'drive',
            seg.mode === 'WALK' ? 22 : 20 + index,
          )
        }

        if (
          plan.handoff &&
          exclusiveMode !== 'drive' &&
          !(outdoorPlan.viaParking && leg.id === 'drive-to-parking')
        ) {
          track(
            createAdvancedMarker({
              map: gmap,
              position: plan.handoff,
              title: 'Leave vehicle — walk from here',
              zIndex: 50,
              svg: pinSvg('#f59e0b', 'W'),
            }),
          )
          bounds.extend(plan.handoff)
        }
      }

      // First Navigate only: brief OSM wait. Live walk/drive never reaches here.
      const needsSidewalks = legsToDraw.some((l) => l.mode === 'WALK' && !l.skipGuidance)
      let extractForDraw: SiteWaysExtract | null = null
      if (needsSidewalks) {
        extractForDraw = await Promise.race([
          extractPromise,
          new Promise<null>((resolve) => {
            window.setTimeout(() => resolve(null), 600)
          }),
        ])
      }

      // Path already taken stays muted behind the puck; only remaining corridor is active blue/red.
      paintRetainedTrail()

      await Promise.all(
        legsToDraw.map(async (leg, index) => {
          try {
            // Walk: use sidewalk extract when ready. Drive: Google first (OSM optional).
            await drawLegPlan(leg, index, leg.mode === 'WALK' ? extractForDraw : null)
          } catch (err) {
            if (session !== routeSessionRef.current) return
            serverFallbackForLeg(leg)
            errors.push(err instanceof Error ? err.message : String(err))
          }
        }),
      )

      if (session !== routeSessionRef.current) return
      const activePath = [...corridorDrive, ...corridorWalk]
      if (activePath.length > 1) lastActivePathRef.current = activePath
      const src = [...sources].join('+') || 'google'
      setSiteNet((prev) => ({
        driveways: prev?.driveways ?? extractForDraw?.driveways.length ?? 0,
        sidewalks: prev?.sidewalks ?? extractForDraw?.sidewalks.length ?? 0,
        routedOn: outdoorPlan.viaParking
          ? `Parking route · ${src}`
          : driveWalkCount
            ? `Drive + Walk · ${src}`
            : `routed · ${src}`,
      }))
      if (errors.some((m) => /REQUEST_DENIED|PERMISSION|API|403|Routes/i.test(m))) {
        setMapError(
          'Enable Routes API on your Google Cloud key (APIs & Services → enable “Routes API”), then hard-refresh. Showing fallback path for now.',
        )
      } else {
        setMapError('')
      }
      // After first frame, live follow must not re-fit zoom on redraws.
      if (!isLiveRecalc) fitRouteView()
      else if (followLiveRef.current) fitRouteView() // pan only — zoom held

      if (onRouteCorridor) {
        onRouteCorridor({
          drive: corridorDrive.length
            ? corridorDrive.map((p) => [p.lng, p.lat] as [number, number])
            : undefined,
          walk: corridorWalk.length
            ? corridorWalk.map((p) => [p.lng, p.lat] as [number, number])
            : undefined,
        })
      }
      if (onRouteGuidance && guidanceAcc.length) {
        onRouteGuidance(guidanceAcc)
      }

      // Late OSM: if walk painted without sidewalks, replace corridor once (no aisle+sidewalk stack).
      void extractPromise.then(async (extract) => {
        if (session !== routeSessionRef.current || !extract?.sidewalks.length) return
        if (extractForDraw?.sidewalks.length) return
        const walkLegs = legsToDraw.filter((l) => l.mode === 'WALK' && !l.skipGuidance)
        if (!walkLegs.length) return
        clearOverlays()
        // Restore S / D pins after clear (route redraw does not recreate them).
        track(
          createAdvancedMarker({
            map: gmap,
            position: origin,
            title: `Start · ${result.origin.label}`,
            zIndex: 40,
            svg: pinSvg('#0ea5e9', 'S'),
          }),
          session,
        )
        track(
          createAdvancedMarker({
            map: gmap,
            position: destination,
            title: `Destination · ${destName}`,
            zIndex: 45,
            svg: pinSvg('#ea4335', 'D'),
          }),
          session,
        )
        paintRetainedTrail()
        drawExtractedNetworks(extract)
        corridorDrive.length = 0
        corridorWalk.length = 0
        guidanceAcc.length = 0
        sources.clear()
        driveWalkCount = 0
        for (let i = 0; i < legsToDraw.length; i++) {
          try {
            await drawLegPlan(legsToDraw[i], i, extract)
          } catch {
            /* keep prior attempt */
          }
        }
        if (session !== routeSessionRef.current) return
        const rebuilt = [...corridorDrive, ...corridorWalk]
        if (rebuilt.length > 1) lastActivePathRef.current = rebuilt
        if (onRouteCorridor) {
          onRouteCorridor({
            drive: corridorDrive.length
              ? corridorDrive.map((p) => [p.lng, p.lat] as [number, number])
              : undefined,
            walk: corridorWalk.length
              ? corridorWalk.map((p) => [p.lng, p.lat] as [number, number])
              : undefined,
          })
        }
        if (onRouteGuidance && guidanceAcc.length) onRouteGuidance([...guidanceAcc])
      })
    })()
  }, [mapReady, result, outdoorPlan, travelMode, followLive])

  // Optional camera nudge for journey steps (no extra yellow waypoint markers)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !activeStep || activeStep.phase === 'indoor') return
    if (followLive && liveFix) return
    map.panTo(latLngLiteral(activeStep.latitude, activeStep.longitude))
  }, [activeStep, followLive, liveFix, mapReady])

  // Live GPS puck + follow (Google Maps–style heading-up navigation).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!liveFix) {
      if (liveMarkerRef.current) liveMarkerRef.current.map = null
      accuracyRef.current?.setMap(null)
      liveMarkerRef.current = null
      accuracyRef.current = null
      lastLiveRef.current = null
      smoothHeadingRef.current = null
      smoothPosRef.current = null
      lastCameraHeadingRef.current = null
      lastPuckRotRef.current = null
      return
    }

    const prev = lastLiveRef.current
    const speed = liveFix.speed != null && Number.isFinite(liveFix.speed) ? liveFix.speed : 0

    // Google-class pose: on-route → stick to corridor + point along look-ahead tangent.
    const pose = resolvePuckPose(liveFix, liveProgress, prev)
    let rawHeading = pose.heading
    // If off-route and we have a clear next step, keep a light pull toward it.
    if (
      !pose.onRoute &&
      rawHeading != null &&
      activeStep &&
      activeStep.phase !== 'indoor' &&
      Number.isFinite(activeStep.latitude) &&
      Number.isFinite(activeStep.longitude)
    ) {
      const toStep = bearingDeg(
        pose.lat,
        pose.lng,
        activeStep.latitude,
        activeStep.longitude,
      )
      const delta = ((toStep - rawHeading + 540) % 360) - 180
      if (Math.abs(delta) < 90) rawHeading = normalizeDeg(rawHeading + delta * 0.25)
    }

    // Route heading is high-trust → snappy blend; compass/GPS noise → heavier damp.
    if (rawHeading != null && Number.isFinite(rawHeading)) {
      const prevH = smoothHeadingRef.current
      if (prevH == null || pose.source === 'route') {
        const delta = prevH == null ? 180 : headingDeltaDeg(prevH, rawHeading)
        // Catch corners fast when following the painted path.
        const t = pose.source === 'route' ? (delta > 25 ? 0.85 : 0.55) : 0.28
        if (prevH == null) smoothHeadingRef.current = rawHeading
        else {
          const d = ((rawHeading - prevH + 540) % 360) - 180
          smoothHeadingRef.current = normalizeDeg(prevH + d * t)
        }
      } else {
        smoothHeadingRef.current = blendHeading(smoothHeadingRef.current, rawHeading)
      }
    }
    const heading = smoothHeadingRef.current
    lastLiveRef.current = liveFix

    // Stick-to-path position when on corridor; otherwise smooth raw GPS.
    const smoothed = blendPosition(
      smoothPosRef.current,
      { lat: pose.lat, lng: pose.lng },
      {
        speedMps: pose.onRoute ? Math.max(speed, 2) : liveFix.speed,
        accuracyM: pose.onRoute ? Math.min(liveFix.accuracy || 15, 10) : liveFix.accuracy,
      },
    )
    smoothPosRef.current = smoothed
    const pos = latLngLiteral(smoothed.lat, smoothed.lng)

    const shouldFollow = followLive && !userPanningRef.current
    // Hold zoom steady — never bounce 16↔18 when speed flips walk↔drive.
    const needStreetZoom = !liveSnapDoneRef.current || (map.getZoom() ?? 0) < 14
    const holdZoom = map.getZoom() ?? 17
    const zoom = needStreetZoom ? 17 : holdZoom

    // Keep the user's Map / Satellite / Hybrid choice (esp. iOS Safari).
    // Never force roadmap for heading-up — that was flipping Satellite → Map on Live.
    const preferredType = userMapTypeRef.current || readStoredMapTypeId()
    let mapTypeId = ''
    try {
      mapTypeId = String(map.getMapTypeId?.() || '')
      if (preferredType && mapTypeId && preferredType !== mapTypeId) {
        map.setMapTypeId(preferredType)
        mapTypeId = preferredType
      }
    } catch {
      /* ignore */
    }
    // Heading-up only works on vector Map. Satellite/Hybrid stay north-up (Google limitation).
    const canHeadingUp = mapTypeId === 'roadmap' || preferredType === 'roadmap'

    if (shouldFollow && heading != null && canHeadingUp) {
      const h = normalizeDeg(heading)
      try {
        // Pass current zoom only — do not change it on mode switches.
        map.moveCamera({ center: pos, zoom, heading: h, tilt: 0 })
      } catch {
        map.setCenter(pos)
        if (needStreetZoom) map.setZoom(zoom)
        if (typeof map.setHeading === 'function') map.setHeading(h)
      }
      try {
        const applied =
          typeof map.getHeading === 'function' && Number.isFinite(map.getHeading())
            ? normalizeDeg(map.getHeading() as number)
            : h
        if (headingDeltaDeg(applied, h) > 15 && typeof map.setHeading === 'function') {
          map.setHeading(h)
        }
      } catch {
        /* ignore */
      }
      lastCameraHeadingRef.current = h
      liveSnapDoneRef.current = true
    } else if (shouldFollow) {
      // Satellite / Hybrid / no heading: follow north-up only (do not call setHeading).
      if (typeof map.setHeading === 'function') {
        try {
          if ((map.getHeading?.() ?? 0) !== 0) map.setHeading(0)
        } catch {
          /* ignore */
        }
      }
      lastCameraHeadingRef.current = 0
      if (needStreetZoom) {
        map.setCenter(pos)
        map.setZoom(zoom)
        liveSnapDoneRef.current = true
      } else {
        map.panTo(pos)
      }
    }

    const appliedMapHeading =
      canHeadingUp &&
      typeof map.getHeading === 'function' &&
      Number.isFinite(map.getHeading())
        ? normalizeDeg(map.getHeading() as number)
        : lastCameraHeadingRef.current ?? 0
    setMapHeading(appliedMapHeading)
    // Heading-up Map → arrow stays screen-up. Satellite north-up → rotate puck by bearing.
    const puckRot =
      heading != null
        ? shouldFollow && canHeadingUp
          ? 0
          : normalizeDeg(heading - appliedMapHeading)
        : null
    const puckRotChanged =
      puckRot != null &&
      (lastPuckRotRef.current == null || headingDeltaDeg(lastPuckRotRef.current, puckRot) >= 2)

    if (!liveMarkerRef.current) {
      const puck = createAdvancedMarker({
        map,
        position: pos,
        zIndex: 1000,
        svg: livePuckSvg(puckRot),
        title: 'You (live)',
        anchor: 'center',
      })
      liveMarkerRef.current = puck
      lastPuckRotRef.current = puckRot
    } else {
      liveMarkerRef.current.position = pos
      if (puckRotChanged || lastPuckRotRef.current == null) {
        setAdvancedMarkerSvg(liveMarkerRef.current, livePuckSvg(puckRot), 'center')
        lastPuckRotRef.current = puckRot
      }
    }

    const accRadius = Math.max(8, Math.min(35, liveFix.accuracy || 15))
    if (!accuracyRef.current) {
      accuracyRef.current = new google.maps.Circle({
        map,
        center: pos,
        radius: accRadius,
        strokeColor: LIVE_BLUE,
        strokeOpacity: 0.45,
        strokeWeight: 1,
        fillColor: LIVE_BLUE,
        fillOpacity: 0.1,
        zIndex: 5,
      })
    } else {
      accuracyRef.current.setCenter(pos)
      accuracyRef.current.setRadius(accRadius)
    }
  }, [liveFix, liveProgress, followLive, mapReady, activeStep])

  // When Live GPS turns off, reset to north-up and re-assert the stored basemap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (followLive) return
    if (typeof map.setHeading === 'function') map.setHeading(0)
    setMapHeading(0)
    try {
      const preferred = userMapTypeRef.current || readStoredMapTypeId()
      const current = String(map.getMapTypeId?.() || '')
      if (preferred && preferred !== current) map.setMapTypeId(preferred)
    } catch {
      /* ignore */
    }
  }, [followLive, mapReady])

  return (
    <div className={`demo-map-shell${followLive && liveFix ? ' is-live' : ''}`}>
      <div className="demo-map" ref={hostRef} aria-label="Google Maps live navigation" />
      {mapError ? (
        <div className="demo-map-error" role="alert">
          {mapError}
        </div>
      ) : null}
      {mapReady ? (
        <button
          type="button"
          className="demo-map-compass"
          title="North — tap to reset north-up"
          aria-label="Compass — reset north up"
          onClick={() => {
            const map = mapRef.current
            if (!map) return
            userPanningRef.current = true
            if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
            panTimerRef.current = window.setTimeout(() => {
              userPanningRef.current = false
            }, 8000)
            if (typeof map.setHeading === 'function') map.setHeading(0)
            setMapHeading(0)
          }}
        >
          <span
            className="demo-map-compass__needle"
            style={{ transform: `rotate(${(-mapHeading).toFixed(1)}deg)` }}
            aria-hidden
          >
            <b>N</b>
          </span>
        </button>
      ) : null}
      {mapReady ? (
        <div className="demo-map-overlay">
          <div className={`demo-leaflet-card${collapsed.legend ? ' is-collapsed' : ''}`} data-card="legend">
            <button
              type="button"
              className="demo-leaflet-card__head"
              aria-expanded={!collapsed.legend}
              onClick={() => toggleCard('legend')}
            >
              <strong>Route legend</strong>
              <span className="demo-leaflet-card__chev" aria-hidden="true" />
            </button>
            <div className="demo-leaflet-card__body">
              <span style={{ color: DRIVEWAY_LAYER }}>━━</span> Extracted driveways (OSM)
              <br />
              <span style={{ color: SIDEWALK_LAYER }}>···</span> Extracted sidewalks (OSM)
              <br />
              <span style={{ color: ROUTE_DRIVE_BLUE }}>━━</span> Active drive (remaining)
              <br />
              <span style={{ color: ROUTE_RETAINED }}>━━</span> Path already taken (kept after reroute)
              <br />
              <span style={{ color: ROUTE_WALK_DOT }}>●●●</span> Walk (red dots) to actual destination
              <br />
              <span style={{ color: '#0ea5e9' }}>●</span> Start ·{' '}
              <span style={{ color: '#a855f7' }}>●</span> Parking ·{' '}
              <span style={{ color: '#22c55e' }}>●</span> Entrance ·{' '}
              <span style={{ color: '#ea4335' }}>●</span> Unit ·{' '}
              <span style={{ color: LIVE_BLUE }}>●</span> You
              <br />
              <span className="muted">
                {siteNet
                  ? `${siteNet.driveways} driveways · ${siteNet.sidewalks} sidewalks · ${siteNet.routedOn}`
                  : outdoorPlan.policy.replaceAll('-', ' ')}
              </span>
            </div>
          </div>

          <div className={`demo-leaflet-card${collapsed.weather ? ' is-collapsed' : ''}`} data-card="weather">
            <button
              type="button"
              className="demo-leaflet-card__head"
              aria-expanded={!collapsed.weather}
              onClick={() => toggleCard('weather')}
            >
              <strong>Weather · live</strong>
              <span className="demo-leaflet-card__chev" aria-hidden="true" />
            </button>
            <div className="demo-leaflet-card__body">
              {weather.summary ?? '—'} ·{' '}
              {weather.temperatureF != null ? `${weather.temperatureF}°F` : '—'}
              {weather.feelsLikeF != null ? ` (feels ${weather.feelsLikeF}°F)` : ''}
              <br />
              Humidity {weather.humidityPct ?? '—'}% · Wind {weather.windMph ?? '—'} mph
              <br />
              <span className="muted">
                {weather.provider}
                {weather.fetchedAt ? ` · ${weather.fetchedAt}` : ''}
              </span>
            </div>
          </div>

          <div className={`demo-leaflet-card${collapsed.traffic ? ' is-collapsed' : ''}`} data-card="traffic">
            <button
              type="button"
              className="demo-leaflet-card__head"
              aria-expanded={!collapsed.traffic}
              onClick={() => toggleCard('traffic')}
            >
              <strong>Traffic · drive leg</strong>
              <span className="demo-leaflet-card__chev" aria-hidden="true" />
            </button>
            <div className="demo-leaflet-card__body">
              Overall:{' '}
              <b style={{ color: trafficColor(traffic.level) }}>{traffic.level}</b> · index{' '}
              {traffic.congestionIndex}
              {traffic.averageSpeedMph != null ? ` · avg ${traffic.averageSpeedMph} mph` : ''}
              <br />
              <span className="muted">{traffic.note}</span>
            </div>
          </div>
        </div>
      ) : null}
      {followLive && liveFix ? (
        <button
          type="button"
          className="demo-recenter"
          aria-label="Recenter on my location"
          onClick={() => {
            userPanningRef.current = false
            liveSnapDoneRef.current = false
            const map = mapRef.current
            if (!map || !liveFix) return
            const pos = latLngLiteral(liveFix.latitude, liveFix.longitude)
            const h = smoothHeadingRef.current
            if (h != null && typeof map.moveCamera === 'function') {
              map.moveCamera({
                center: pos,
                zoom: Math.max(map.getZoom() ?? 17, 17),
                heading: normalizeDeg(h),
                tilt: 0,
              })
              setMapHeading(normalizeDeg(h))
            } else {
              map.setCenter(pos)
              map.setZoom(Math.max(map.getZoom() ?? 17, 17))
            }
          }}
        >
          <span className="demo-recenter__dot" />
        </button>
      ) : null}
    </div>
  )
}

