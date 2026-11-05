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
import type { LiveFix } from '../liveNavigation'
import { bearingDeg } from '../liveNavigation'
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
  followLive?: boolean
  /** Dense polylines actually drawn — used for Google-like off-route / reroute. */
  onRouteCorridor?: (corridor: {
    drive?: [number, number][]
    walk?: [number, number][]
  }) => void
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
 * Arrow points to top of SVG (= north) before rotation; GPS heading is degrees clockwise from north.
 */
function livePuckSvg(heading: number | null) {
  const hasHeading = heading != null && Number.isFinite(heading)
  const rot = hasHeading ? Number(heading) : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <defs>
    <filter id="keirosPuckShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0f172a" flood-opacity="0.45"/>
    </filter>
  </defs>
  <g transform="rotate(${rot.toFixed(1)} 40 40)" filter="url(#keirosPuckShadow)">
    ${
      hasHeading
        ? `<path d="M40 6 L54 32 L40 27 L26 32 Z" fill="#1a73e8" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>`
        : ''
    }
    <circle cx="40" cy="42" r="18" fill="#1a73e8" stroke="#ffffff" stroke-width="5"/>
    <circle cx="40" cy="42" r="6.5" fill="#ffffff"/>
  </g>
</svg>`
}

/** Shortest-path blend so the arrow doesn't spin wildly on noisy GPS. */
function blendHeading(prev: number | null, next: number): number {
  if (prev == null || !Number.isFinite(prev)) return next
  const delta = ((next - prev + 540) % 360) - 180
  return (prev + delta * 0.4 + 360) % 360
}

export function OutdoorMap({
  result,
  activeStep,
  weather,
  traffic,
  liveFix = null,
  followLive = false,
  onRouteCorridor,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<{ setMap?: (map: google.maps.Map | null) => void; map?: google.maps.Map | null }>>([])
  const liveMarkerRef = useRef<AdvMarker | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const lastLiveRef = useRef<LiveFix | null>(null)
  const smoothHeadingRef = useRef<number | null>(null)
  const userPanningRef = useRef(false)
  const panTimerRef = useRef<number | null>(null)
  const routeSessionRef = useRef(0)
  /** After Navigate in Live mode, snap once to GPS at street zoom (don't wait on fitBounds). */
  const liveSnapDoneRef = useRef(false)
  const liveFixRef = useRef(liveFix)
  liveFixRef.current = liveFix
  const followLiveRef = useRef(followLive)
  followLiveRef.current = followLive

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

  const outdoorPlan = useMemo(() => resolveOutdoorLegs(result), [result])

  function clearOverlays() {
    for (const item of overlaysRef.current) {
      if (typeof item.setMap === 'function') item.setMap(null)
      else item.map = null
    }
    overlaysRef.current = []
  }

  function track<T extends { setMap?: (map: google.maps.Map | null) => void; map?: google.maps.Map | null }>(obj: T) {
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
        const map = new google.maps.Map(
          hostRef.current,
          mapOptions(latLngLiteral(result.origin.latitude, result.origin.longitude), 17, {
            // Match Google Maps consumer look: satellite + labels (switchable).
            mapTypeId: 'hybrid',
            mapTypeControl: true,
            mapTypeControlOptions: {
              style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
              position: google.maps.ControlPosition.TOP_LEFT,
              mapTypeIds: ['hybrid', 'roadmap', 'satellite'],
            },
          }),
        )
        mapRef.current = map
        setMapReady(true)
        setMapError('')

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
    const destination = latLngLiteral(
      Number(result.destination.latitude ?? result.selection?.unit?.latitude),
      Number(result.destination.longitude ?? result.selection?.unit?.longitude),
    )
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

    const destName =
      result.destination.label ||
      result.selection?.unit?.name ||
      'Destination'
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

    // Frame start immediately (Live = GPS street zoom; Demo = route bounds after paths).
    liveSnapDoneRef.current = false
    fitRouteView()

    const trafficLayer = new google.maps.TrafficLayer()
    trafficLayer.setMap(gmap)
    track(trafficLayer)

    function drawPath(
      path: google.maps.LatLngLiteral[],
      from: google.maps.LatLngLiteral,
      to: google.maps.LatLngLiteral,
      style: 'drive' | 'walk-dots',
      zIndex: number,
    ) {
      // Drive: keep network end. Walk: always reach the real destination pin.
      const pinned =
        style === 'drive'
          ? pinPathToEndpoints(path, from, path[path.length - 1] ?? to, 12, 8)
          : pinPathToEndpoints(path, from, to, 18, 80, { alwaysReachEnd: true })
      if (pinned.length < 2) return

      if (style === 'walk-dots') {
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
        )
      }
      pinned.forEach((p) => bounds.extend(p))
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

    function fitRouteView() {
      const gmap = mapRef.current
      if (!gmap || bounds.isEmpty()) return

      // Phone Live: jump to start/GPS at street zoom immediately — don't fit the whole trip
      // (that left the camera zoomed out for a long time).
      if (followLiveRef.current) {
        const fix = liveFixRef.current
        const focus = fix
          ? latLngLiteral(fix.latitude, fix.longitude)
          : origin
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

      // Via parking: drive → lot, then walk pathways to entrance.
      // Otherwise: Google drive toward D (may add last-meter walk).
      const legsToDraw: OutdoorLeg[] = outdoorPlan.viaParking
        ? outdoorPlan.legs
        : [
            {
              id: 'drive-toward-destination',
              mode: 'DRIVE',
              from: origin,
              to: destination,
              label: 'Drive toward destination (Google roads)',
              color: ROUTE_DRIVE_BLUE,
            },
          ]

      setSiteNet({
        driveways: 0,
        sidewalks: 0,
        routedOn: outdoorPlan.viaParking
          ? 'Drive to parking → walk pathways'
          : 'Google drive → walk to D',
      })

      async function drawLegPlan(
        leg: OutdoorLeg,
        index: number,
        extract: SiteWaysExtract | null,
      ) {
        // Drive legs stay on roads. Walk legs prefer sidewalks/pathways when OSM is ready.
        const plan =
          leg.mode === 'WALK'
            ? await planWalkOnly(leg.from, leg.to, extract)
            : await planDrivePlusWalk(leg.from, leg.to, extract)

        if (session !== routeSessionRef.current) return
        if (!plan.segments.length) {
          serverFallbackForLeg(leg)
          return
        }

        if (plan.label === 'drive+walk') driveWalkCount += 1
        for (const seg of plan.segments) {
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

        if (plan.handoff && !(outdoorPlan.viaParking && leg.id === 'drive-to-parking')) {
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

      // Fast first paint with Google only (no Overpass wait).
      await Promise.all(
        legsToDraw.map(async (leg, index) => {
          try {
            await drawLegPlan(leg, index, null)
          } catch (err) {
            if (session !== routeSessionRef.current) return
            serverFallbackForLeg(leg)
            errors.push(err instanceof Error ? err.message : String(err))
          }
        }),
      )

      if (session !== routeSessionRef.current) return
      const src = [...sources].join('+') || 'google'
      setSiteNet((prev) => ({
        driveways: prev?.driveways ?? 0,
        sidewalks: prev?.sidewalks ?? 0,
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
      fitRouteView()

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

      // When OSM pathways arrive, redraw walk legs on sidewalks/footways.
      void extractPromise.then(async (extract) => {
        if (session !== routeSessionRef.current || !extract) return
        const walkLegs = legsToDraw.filter((l) => l.mode === 'WALK')
        if (!walkLegs.length || !extract.sidewalks.length) return
        for (let i = 0; i < walkLegs.length; i++) {
          try {
            await drawLegPlan(walkLegs[i], 30 + i, extract)
          } catch {
            /* keep Google walk */
          }
        }
      })
    })()
  }, [mapReady, result, outdoorPlan])

  // Optional camera nudge for journey steps (no extra yellow waypoint markers)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !activeStep || activeStep.phase === 'indoor') return
    if (followLive && liveFix) return
    map.panTo(latLngLiteral(activeStep.latitude, activeStep.longitude))
  }, [activeStep, followLive, liveFix, mapReady])

  // Live GPS puck + follow
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
      return
    }

    // Prefer device compass/GPS heading; fall back to movement bearing when walking/driving.
    let rawHeading: number | null =
      liveFix.heading != null && Number.isFinite(liveFix.heading) ? liveFix.heading : null
    const prev = lastLiveRef.current
    const movedM =
      prev != null
        ? Math.hypot(
            (liveFix.latitude - prev.latitude) * 111_320,
            (liveFix.longitude - prev.longitude) *
              111_320 *
              Math.cos((liveFix.latitude * Math.PI) / 180),
          )
        : 0
    const moving = movedM > 2.5 || (liveFix.speed != null && liveFix.speed > 0.8)
    if ((rawHeading == null || !moving) && prev && movedM > 2.5) {
      rawHeading = bearingDeg(prev.latitude, prev.longitude, liveFix.latitude, liveFix.longitude)
    }
    if (rawHeading != null && Number.isFinite(rawHeading)) {
      smoothHeadingRef.current = blendHeading(smoothHeadingRef.current, rawHeading)
    }
    const heading = smoothHeadingRef.current
    lastLiveRef.current = liveFix
    const pos = latLngLiteral(liveFix.latitude, liveFix.longitude)

    if (!liveMarkerRef.current) {
      const puck = createAdvancedMarker({
        map,
        position: pos,
        zIndex: 1000,
        svg: livePuckSvg(heading),
        title: 'You (live)',
      })
      // Center the puck on GPS (default Advanced Marker anchor is bottom-center).
      puck.anchorTop = '50%'
      puck.anchorLeft = '50%'
      liveMarkerRef.current = puck
    } else {
      liveMarkerRef.current.position = pos
      setAdvancedMarkerSvg(liveMarkerRef.current, livePuckSvg(heading))
      liveMarkerRef.current.anchorTop = '50%'
      liveMarkerRef.current.anchorLeft = '50%'
    }

    if (!accuracyRef.current) {
      accuracyRef.current = new google.maps.Circle({
        map,
        center: pos,
        radius: Math.max(8, liveFix.accuracy || 20),
        strokeColor: LIVE_BLUE,
        strokeOpacity: 0.55,
        strokeWeight: 1,
        fillColor: LIVE_BLUE,
        fillOpacity: 0.12,
        zIndex: 5,
      })
    } else {
      accuracyRef.current.setCenter(pos)
      accuracyRef.current.setRadius(Math.max(8, liveFix.accuracy || 20))
    }

    // Follow GPS when near the planned start (same metro). Snap hard on first fix.
    const routeLat = Number(result.origin.latitude)
    const routeLng = Number(result.origin.longitude)
    const nearRouteM = Math.hypot(
      (liveFix.latitude - routeLat) * 111_320,
      (liveFix.longitude - routeLng) * 111_320 * Math.cos((routeLat * Math.PI) / 180),
    )
    if (followLive && !userPanningRef.current && nearRouteM < 8000) {
      const driving = liveFix.speed != null && liveFix.speed > 8
      const targetZoom = driving ? 16 : 18
      if (!liveSnapDoneRef.current || (map.getZoom() ?? 0) < 16) {
        map.setCenter(pos)
        map.setZoom(targetZoom)
        liveSnapDoneRef.current = true
      } else {
        map.panTo(pos)
        if ((map.getZoom() ?? 0) < targetZoom - 0.5) map.setZoom(targetZoom)
      }
    }
  }, [liveFix, followLive, mapReady, result.origin.latitude, result.origin.longitude])

  return (
    <div className={`demo-map-shell${followLive && liveFix ? ' is-live' : ''}`}>
      <div className="demo-map" ref={hostRef} aria-label="Google Maps live navigation" />
      {mapError ? (
        <div className="demo-map-error" role="alert">
          {mapError}
        </div>
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
              <span style={{ color: ROUTE_DRIVE_BLUE }}>━━</span> Drive on driveway toward destination
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
            const map = mapRef.current
            if (!map || !liveFix) return
            map.setCenter(latLngLiteral(liveFix.latitude, liveFix.longitude))
            map.setZoom(Math.max(map.getZoom() ?? 16, 16))
          }}
        >
          <span className="demo-recenter__dot" />
        </button>
      ) : null}
    </div>
  )
}

