import { useEffect, useMemo, useRef, useState } from 'react'
import type { JourneyStep, NavigateResult } from '../api'
import { geoJsonToLatLngs, latLngLiteral, loadGoogleMaps } from '../googleMaps'
import type { LiveFix } from '../liveNavigation'
import { bearingDeg } from '../liveNavigation'

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

const WALK_COLOR = '#38bdf8'
const PARKING_COLOR = '#a78bfa'
const ENTRANCE_COLOR = '#fbbf24'
const LIVE_BLUE = '#1a73e8'
const ROUTE_GREEN = '#1a73e8'

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
  const overlaysRef = useRef<Array<google.maps.MVCObject | google.maps.DirectionsRenderer>>([])
  const stepMarkerRef = useRef<google.maps.Marker | null>(null)
  const liveMarkerRef = useRef<google.maps.Marker | null>(null)
  const accuracyRef = useRef<google.maps.Circle | null>(null)
  const lastLiveRef = useRef<LiveFix | null>(null)
  const userPanningRef = useRef(false)
  const panTimerRef = useRef<number | null>(null)
  const routeSessionRef = useRef(0)

  const [mapError, setMapError] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [collapsed, setCollapsed] = useState(() => ({
    legend: readCollapsed('legend'),
    weather: readCollapsed('weather'),
    traffic: readCollapsed('traffic'),
  }))

  const parking = result.parking ?? {
    latitude: result.destination.latitude,
    longitude: result.destination.longitude,
    label: 'Parking (near destination)',
    offsetMeters: 0,
  }
  const entrance = result.entrance ?? {
    latitude: result.destination.latitude,
    longitude: result.destination.longitude,
    label: 'Building entrance',
  }
  const isPointToPoint =
    parking.mode === 'point-to-point' ||
    result.outdoor.arrivalMode === 'point-to-point' ||
    result.outdoor.arrivalMode === 'walk-from-origin' ||
    result.outdoor.arrivalMode === 'at-entrance'

  const driveSteps = useMemo(
    () => result.journey.steps.filter((s) => s.phase === 'drive' || s.phase === 'outdoor'),
    [result],
  )

  function clearOverlays() {
    for (const item of overlaysRef.current) {
      const anyItem = item as { setMap?: (map: google.maps.Map | null) => void }
      anyItem.setMap?.(null)
    }
    overlaysRef.current = []
  }

  function track(obj: google.maps.MVCObject | google.maps.DirectionsRenderer) {
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
        const map = new google.maps.Map(hostRef.current, {
          center: latLngLiteral(result.origin.latitude, result.origin.longitude),
          zoom: 14,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
          styles: undefined,
        })
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
      stepMarkerRef.current?.setMap(null)
      liveMarkerRef.current?.setMap(null)
      accuracyRef.current?.setMap(null)
      stepMarkerRef.current = null
      liveMarkerRef.current = null
      accuracyRef.current = null
      mapRef.current = null
      setMapReady(false)
    }
    // Map instance is created once; route effect redraws on result changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw start, destination, Google Directions route (+ fallback polylines)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const session = ++routeSessionRef.current
    clearOverlays()

    const bounds = new google.maps.LatLngBounds()
    const origin = latLngLiteral(result.origin.latitude, result.origin.longitude)
    const entranceLl = latLngLiteral(entrance.latitude, entrance.longitude)
    const destination = latLngLiteral(result.destination.latitude, result.destination.longitude)
    const parkingLl = latLngLiteral(parking.latitude, parking.longitude)

    const startMarker = new google.maps.Marker({
      map,
      position: origin,
      title: `Start · ${result.origin.label}`,
      zIndex: 40,
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg('#0ea5e9', 'S'))}`,
        scaledSize: new google.maps.Size(36, 44),
        anchor: new google.maps.Point(18, 44),
      },
    })
    track(startMarker)
    bounds.extend(origin)

    const destMarker = new google.maps.Marker({
      map,
      position: destination,
      title: `Destination · ${result.destination.label}`,
      zIndex: 45,
      icon: {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(pinSvg('#ea4335', 'D'))}`,
        scaledSize: new google.maps.Size(36, 44),
        anchor: new google.maps.Point(18, 44),
      },
    })
    track(destMarker)
    bounds.extend(destination)

    if (
      Math.abs(entrance.latitude - result.destination.latitude) > 1e-5 ||
      Math.abs(entrance.longitude - result.destination.longitude) > 1e-5
    ) {
      const entranceMarker = new google.maps.Marker({
        map,
        position: entranceLl,
        title: `Entrance · ${entrance.label}`,
        zIndex: 35,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: ENTRANCE_COLOR,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      })
      track(entranceMarker)
      bounds.extend(entranceLl)
    }

    if (!isPointToPoint) {
      const parkingMarker = new google.maps.Marker({
        map,
        position: parkingLl,
        title: `Parking · ${parking.label}`,
        zIndex: 30,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: PARKING_COLOR,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      })
      track(parkingMarker)
      bounds.extend(parkingLl)
    }

    const trafficLayer = new google.maps.TrafficLayer()
    trafficLayer.setMap(map)
    track(trafficLayer)

    const outdoorPath = geoJsonToLatLngs(result.outdoor?.geometry?.coordinates)
    const walkPath = geoJsonToLatLngs(result.walk?.geometry?.coordinates)
    const outdoorIsReal =
      outdoorPath.length > 1 &&
      !(
        outdoorPath.length <= 2 &&
        outdoorPath.every(
          (p) =>
            Math.abs(p.lng - result.origin.longitude) < 1e-7 &&
            Math.abs(p.lat - result.origin.latitude) < 1e-7,
        )
      )

    function drawFallbackPolylines() {
      if (outdoorIsReal) {
        const line = new google.maps.Polyline({
          map,
          path: outdoorPath,
          strokeColor: ROUTE_GREEN,
          strokeOpacity: 0.92,
          strokeWeight: 6,
          zIndex: 10,
        })
        track(line)
        outdoorPath.forEach((p) => bounds.extend(p))
      }
      const walkSame =
        outdoorIsReal &&
        walkPath.length > 1 &&
        outdoorPath.length === walkPath.length &&
        outdoorPath[0].lat === walkPath[0].lat &&
        outdoorPath[0].lng === walkPath[0].lng
      if (walkPath.length > 1 && !walkSame) {
        const line = new google.maps.Polyline({
          map,
          path: walkPath,
          strokeColor: WALK_COLOR,
          strokeOpacity: isPointToPoint ? 0.95 : 0,
          strokeWeight: 5,
          zIndex: 11,
          icons: isPointToPoint
            ? undefined
            : [
                {
                  icon: {
                    path: 'M 0,-1 0,1',
                    strokeOpacity: 1,
                    strokeColor: WALK_COLOR,
                    scale: 3,
                  },
                  offset: '0',
                  repeat: '14px',
                },
              ],
        })
        track(line)
        walkPath.forEach((p) => bounds.extend(p))
      }
      for (const step of driveSteps) {
        const path = geoJsonToLatLngs(step.geometry)
        if (path.length < 2 || outdoorIsReal) continue
        const line = new google.maps.Polyline({
          map,
          path,
          strokeColor: trafficColor(step.trafficLevel),
          strokeOpacity: 0.9,
          strokeWeight: 5,
          zIndex: 12,
        })
        track(line)
        path.forEach((p) => bounds.extend(p))
      }
    }

    // Point-to-point goes all the way to the unit (D), not only the entrance pin.
    const routeEnd = isPointToPoint ? destination : parkingLl
    const preferWalk =
      isPointToPoint &&
      (driveSteps.length === 0 ||
        (result.outdoor.distanceM ?? 0) <= 0 ||
        /foot|walk|on-site/i.test(
          `${result.outdoor.provider || ''} ${result.outdoor.profile || ''}`,
        ))

    function extendRouteToDestination(from: google.maps.LatLngLiteral) {
      if (
        Math.abs(from.lat - destination.lat) < 1e-6 &&
        Math.abs(from.lng - destination.lng) < 1e-6
      ) {
        return
      }
      const stub = new google.maps.Polyline({
        map,
        path: [from, destination],
        strokeColor: preferWalk || isPointToPoint ? WALK_COLOR : ROUTE_GREEN,
        strokeOpacity: 0.9,
        strokeWeight: 5,
        zIndex: 22,
      })
      track(stub)
      bounds.extend(destination)
    }

    const canDirections = typeof google.maps.DirectionsService === 'function'
    if (!canDirections) {
      drawFallbackPolylines()
      extendRouteToDestination(entranceLl)
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 48, right: 280, bottom: 48, left: 48 })
      }
    } else {
      const directions = new google.maps.DirectionsService()
      const renderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: true,
        polylineOptions: {
          strokeColor: preferWalk ? WALK_COLOR : ROUTE_GREEN,
          strokeOpacity: 0.95,
          strokeWeight: 6,
          zIndex: 20,
        },
      })
      track(renderer)

      directions.route(
        {
          origin,
          destination: routeEnd,
          travelMode: preferWalk ? google.maps.TravelMode.WALKING : google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false,
          drivingOptions: preferWalk
            ? undefined
            : {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS,
              },
        },
        (response, status) => {
          if (session !== routeSessionRef.current) return
          if (status === google.maps.DirectionsStatus.OK && response) {
            renderer.setDirections(response)
            const route = response.routes[0]
            route?.overview_path?.forEach((p) => bounds.extend(p))
            const last = route?.overview_path?.[route.overview_path.length - 1]
            if (isPointToPoint && last) {
              extendRouteToDestination({ lat: last.lat(), lng: last.lng() })
            }
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { top: 48, right: 280, bottom: 48, left: 48 })
            }
            if (!isPointToPoint) {
              directions.route(
                {
                  origin: parkingLl,
                  destination: destination,
                  travelMode: google.maps.TravelMode.WALKING,
                  waypoints:
                    Math.abs(entrance.latitude - result.destination.latitude) > 1e-5 ||
                    Math.abs(entrance.longitude - result.destination.longitude) > 1e-5
                      ? [{ location: entranceLl, stopover: true }]
                      : undefined,
                },
                (walkRes, walkStatus) => {
                  if (session !== routeSessionRef.current) return
                  if (walkStatus !== google.maps.DirectionsStatus.OK || !walkRes) {
                    extendRouteToDestination(entranceLl)
                    return
                  }
                  const walkPathPts = walkRes.routes[0]?.overview_path
                  if (!walkPathPts?.length) {
                    extendRouteToDestination(entranceLl)
                    return
                  }
                  const walkLine = new google.maps.Polyline({
                    map,
                    path: walkPathPts,
                    strokeColor: WALK_COLOR,
                    strokeOpacity: 0,
                    strokeWeight: 5,
                    zIndex: 21,
                    icons: [
                      {
                        icon: {
                          path: 'M 0,-1 0,1',
                          strokeOpacity: 1,
                          scale: 3,
                          strokeColor: WALK_COLOR,
                        },
                        offset: '0',
                        repeat: '14px',
                      },
                    ],
                  })
                  track(walkLine)
                  walkPathPts.forEach((p) => bounds.extend(p))
                  map.fitBounds(bounds, { top: 48, right: 280, bottom: 48, left: 48 })
                },
              )
            }
          } else {
            renderer.setMap(null)
            drawFallbackPolylines()
            extendRouteToDestination(entranceLl)
            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { top: 48, right: 280, bottom: 48, left: 48 })
            }
          }
        },
      )
    }

    return () => {
      // Next effect run / unmount clears via clearOverlays at start or unmount.
    }
  }, [
    mapReady,
    result,
    parking,
    entrance,
    isPointToPoint,
    driveSteps,
  ])

  // Active journey step marker
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !activeStep || activeStep.phase === 'indoor') {
      stepMarkerRef.current?.setMap(null)
      stepMarkerRef.current = null
      return
    }
    const pos = latLngLiteral(activeStep.latitude, activeStep.longitude)
    const fill =
      activeStep.phase === 'walk' ? WALK_COLOR : trafficColor(activeStep.trafficLevel) || '#22c55e'
    if (!stepMarkerRef.current) {
      stepMarkerRef.current = new google.maps.Marker({
        map,
        position: pos,
        zIndex: 50,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: fill,
          fillOpacity: followLive && liveFix ? 0.55 : 0.95,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        title: activeStep.instruction,
      })
    } else {
      stepMarkerRef.current.setPosition(pos)
      stepMarkerRef.current.setIcon({
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: fill,
        fillOpacity: followLive && liveFix ? 0.55 : 0.95,
        strokeColor: '#fff',
        strokeWeight: 2,
      })
    }
    if (followLive && liveFix) return
    map.panTo(pos)
    const z = map.getZoom() ?? 14
    if (activeStep.phase === 'walk' && z < 15) map.setZoom(16)
    else if (z < 13) map.setZoom(14)
  }, [activeStep, followLive, liveFix, mapReady])

  // Live GPS puck + follow
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!liveFix) {
      liveMarkerRef.current?.setMap(null)
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
      liveMarkerRef.current = new google.maps.Marker({
        map,
        position: pos,
        zIndex: 1000,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(livePuckSvg(heading))}`,
          scaledSize: new google.maps.Size(48, 48),
          anchor: new google.maps.Point(24, 24),
        },
        title: 'You (live)',
      })
    } else {
      liveMarkerRef.current.setPosition(pos)
      liveMarkerRef.current.setIcon({
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(livePuckSvg(heading))}`,
        scaledSize: new google.maps.Size(48, 48),
        anchor: new google.maps.Point(24, 24),
      })
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
              {isPointToPoint ? (
                <>
                  <span style={{ color: ROUTE_GREEN }}>━━</span> Point-to-point → destination
                  <br />
                  <span style={{ color: WALK_COLOR }}>━━</span> Walk to unit
                  <br />
                </>
              ) : (
                <>
                  <span style={{ color: trafficColor('Light') }}>━━</span> Drive (to parking)
                  <br />
                  <span style={{ color: WALK_COLOR }}>- - -</span> Walk (parking → entrance)
                  <br />
                </>
              )}
              <span style={{ color: LIVE_BLUE }}>●</span> You (live) ·{' '}
              {!isPointToPoint ? (
                <>
                  <span style={{ color: PARKING_COLOR }}>●</span> Parking ·{' '}
                </>
              ) : null}
              <span style={{ color: ENTRANCE_COLOR }}>●</span> Entrance ·{' '}
              <span style={{ color: '#ea4335' }}>●</span> Destination
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
