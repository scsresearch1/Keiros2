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
import {
  DRIVE_COLOR,
  WALK_COLOR,
  resolveOutdoorLegs,
  type OutdoorLeg,
} from '../outdoorLegs'

const DRIVEWAY_LAYER = '#64748b'
const SIDEWALK_LAYER = '#14b8a6'

type Props = {
  result: NavigateResult
  activeStep: JourneyStep | null
  weather: NavigateResult['weather']
  traffic: NavigateResult['outdoor']['traffic']
  liveFix?: LiveFix | null
  followLive?: boolean
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

function livePuckSvg(heading: number | null) {
  const rot = heading != null && Number.isFinite(heading) ? heading : 0
  const cone =
    heading != null && Number.isFinite(heading)
      ? `<path d="M24 6 L30 22 L18 22 Z" fill="rgba(26,115,232,0.35)"/>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <g transform="rotate(${rot} 24 24)">
    ${cone}
    <circle cx="24" cy="24" r="9" fill="#1a73e8" stroke="#fff" stroke-width="3"/>
  </g>
</svg>`
}

export function OutdoorMap({
  result,
  activeStep,
  weather,
  traffic,
  liveFix = null,
  followLive = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlaysRef = useRef<Array<{ setMap?: (map: google.maps.Map | null) => void; map?: google.maps.Map | null }>>([])
  const liveMarkerRef = useRef<AdvMarker | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const lastLiveRef = useRef<LiveFix | null>(null)
  const userPanningRef = useRef(false)
  const panTimerRef = useRef<number | null>(null)
  const routeSessionRef = useRef(0)

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
          mapOptions(latLngLiteral(result.origin.latitude, result.origin.longitude), 14),
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
      info.setContent(
        pinPopupHtml({
          kind,
          name,
          address: backendAddress,
          coords,
        }),
      )
      info.open({ map, anchor: marker })
    }

    const startMarker = track(
      createAdvancedMarker({
        map,
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
    startMarker.addListener('gmp-click', () => {
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
        map,
        position: destination,
        title: `Destination · ${destName}`,
        zIndex: 45,
        svg: pinSvg('#ea4335', 'D'),
      }),
    )
    destMarker.addListener('gmp-click', () => {
      openPinInfo(destMarker, 'Destination', destName, destAddress, destination)
    })
    bounds.extend(destination)

    for (const wp of outdoorPlan.waypoints) {
      const letter = wp.kind === 'parking' ? 'P' : 'E'
      const kindLabel = wp.kind === 'parking' ? 'Parking' : 'Entrance'
      const marker = track(
        createAdvancedMarker({
          map,
          position: wp.position,
          title: `${kindLabel} · ${wp.label}`,
          zIndex: wp.kind === 'parking' ? 42 : 43,
          svg: pinSvg(wp.fill, letter),
        }),
      )
      marker.addListener('gmp-click', () => {
        openPinInfo(marker, kindLabel, wp.label, null, wp.position)
      })
      bounds.extend(wp.position)
    }

    const trafficLayer = new google.maps.TrafficLayer()
    trafficLayer.setMap(map)
    track(trafficLayer)

    function drawPath(
      path: google.maps.LatLngLiteral[],
      from: google.maps.LatLngLiteral,
      to: google.maps.LatLngLiteral,
      color: string,
      zIndex: number,
      dashed = false,
    ) {
      const pinned = pinPathToEndpoints(path, from, to)
      if (pinned.length < 2) return
      track(
        new google.maps.Polyline({
          map,
          path: pinned,
          strokeColor: color,
          strokeOpacity: dashed ? 0 : 0.95,
          strokeWeight: 6,
          zIndex,
          geodesic: false,
          ...(dashed
            ? {
                icons: [
                  {
                    icon: {
                      path: 'M 0,-1 0,1',
                      strokeOpacity: 0.95,
                      strokeColor: color,
                      scale: 3,
                    },
                    offset: '0',
                    repeat: '14px',
                  },
                ],
              }
            : {}),
        }),
      )
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
            strokeOpacity: 0.55,
            strokeWeight: 4,
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
          drawPath(outdoorPath, leg.from, leg.to, leg.color, 20, false)
          return
        }
      }
      const walkPath = geoJsonToLatLngs(result.walk?.geometry?.coordinates)
      if (walkPath.length > 1) {
        drawPath(walkPath, leg.from, leg.to, WALK_COLOR, 22, true)
        return
      }
    }

    function fitRouteView() {
      const gmap = mapRef.current
      if (!gmap || bounds.isEmpty()) return
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

      let extract: SiteWaysExtract | null = null
      try {
        extract = await extractSiteWays(seedPoints)
        if (session !== routeSessionRef.current) return
        drawExtractedNetworks(extract)
        setSiteNet({
          driveways: extract.driveways.length,
          sidewalks: extract.sidewalks.length,
          routedOn: 'extracting…',
        })
      } catch {
        if (session !== routeSessionRef.current) return
        setSiteNet({ driveways: 0, sidewalks: 0, routedOn: 'OSM extract unavailable' })
      }

      if (!outdoorPlan.legs.length) {
        if (session !== routeSessionRef.current) return
        setMapError('')
        if (extract) {
          setSiteNet({
            driveways: extract.driveways.length,
            sidewalks: extract.sidewalks.length,
            routedOn: 'networks only',
          })
        }
        fitRouteView()
        return
      }

      const errors: string[] = []
      let driveWalkCount = 0
      const sources = new Set<string>()

      await Promise.all(
        outdoorPlan.legs.map(async (leg, index) => {
          try {
            // Google Maps pattern: DRIVE legs become Drive + Walk when the car can't reach the pin.
            const plan =
              leg.mode === 'DRIVE'
                ? await planDrivePlusWalk(leg.from, leg.to, extract)
                : await planWalkOnly(leg.from, leg.to, extract)

            if (session !== routeSessionRef.current) return
            if (!plan.segments.length) {
              serverFallbackForLeg(leg)
              return
            }

            if (plan.label === 'drive+walk') driveWalkCount += 1
            for (const seg of plan.segments) {
              sources.add(seg.source)
              drawPath(
                seg.path,
                seg.path[0],
                seg.path[seg.path.length - 1],
                seg.mode === 'WALK' ? WALK_COLOR : DRIVE_COLOR,
                seg.mode === 'WALK' ? 22 : 20 + index,
                seg.dashed,
              )
            }

            // Mark the leave-vehicle / start-walk handoff (like Google’s mode switch).
            if (plan.handoff) {
              track(
                createAdvancedMarker({
                  map,
                  position: plan.handoff,
                  title: 'Leave vehicle — walk from here',
                  zIndex: 50,
                  svg: pinSvg('#f59e0b', 'W'),
                }),
              )
              bounds.extend(plan.handoff)
            }
          } catch (err) {
            if (session !== routeSessionRef.current) return
            serverFallbackForLeg(leg)
            errors.push(err instanceof Error ? err.message : String(err))
          }
        }),
      )

      if (session !== routeSessionRef.current) return
      if (extract) {
        const src = [...sources].join('+') || 'none'
        setSiteNet({
          driveways: extract.driveways.length,
          sidewalks: extract.sidewalks.length,
          routedOn: driveWalkCount
            ? `Drive + Walk ×${driveWalkCount} · ${src}`
            : `routed · ${src}`,
        })
      }
      if (errors.some((m) => /REQUEST_DENIED|PERMISSION|API|403|Routes/i.test(m))) {
        setMapError(
          'Enable Routes API on your Google Cloud key (APIs & Services → enable “Routes API”), then hard-refresh. Showing fallback path for now.',
        )
      } else {
        setMapError('')
      }
      fitRouteView()
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
      return
    }

    let heading = liveFix.heading
    const prev = lastLiveRef.current
    if ((heading == null || !Number.isFinite(heading)) && prev) {
      const moved = Math.hypot(liveFix.latitude - prev.latitude, liveFix.longitude - prev.longitude)
      if (moved > 0.00002) {
        heading = bearingDeg(prev.latitude, prev.longitude, liveFix.latitude, liveFix.longitude)
      }
    }
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
      // Center the live puck on GPS (pins default to bottom-center).
      puck.anchorTop = '50%'
      puck.anchorLeft = '50%'
      liveMarkerRef.current = puck
    } else {
      liveMarkerRef.current.position = pos
      setAdvancedMarkerSvg(liveMarkerRef.current, livePuckSvg(heading))
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

    if (followLive && !userPanningRef.current) {
      const targetZoom = liveFix.speed != null && liveFix.speed > 8 ? 16 : 17
      if ((map.getZoom() ?? 0) < 15) map.setZoom(targetZoom)
      map.panTo(pos)
    }
  }, [liveFix, followLive, mapReady])

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
              <span style={{ color: DRIVE_COLOR }}>━━</span> Drive (to nearest road point)
              <br />
              <span style={{ color: WALK_COLOR }}>···</span> Walk last mile (dashed)
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
