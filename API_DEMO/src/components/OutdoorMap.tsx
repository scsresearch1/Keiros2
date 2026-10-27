import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import type { JourneyStep, NavigateResult } from '../api'
import type { LiveFix } from '../liveNavigation'
import { bearingDeg } from '../liveNavigation'

type Props = {
  result: NavigateResult
  activeStep: JourneyStep | null
  weather: NavigateResult['weather']
  traffic: NavigateResult['outdoor']['traffic']
  /** Device GPS while live navigation is on */
  liveFix?: LiveFix | null
  /** Keep camera on the live puck (Google Maps–style) */
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

function livePuckIcon(heading: number | null) {
  const rot = heading != null && Number.isFinite(heading) ? heading : 0
  const showCone = heading != null && Number.isFinite(heading)
  const html = `
    <div class="demo-live-puck" style="transform:rotate(${rot}deg)">
      ${showCone ? '<span class="demo-live-puck__cone"></span>' : ''}
      <span class="demo-live-puck__dot"></span>
    </div>`
  return L.divIcon({
    className: 'demo-live-puck-wrap',
    html,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  })
}

export function OutdoorMap({
  result,
  activeStep,
  weather,
  traffic,
  liveFix = null,
  followLive = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)
  const liveMarkerRef = useRef<L.Marker | null>(null)
  const accuracyRef = useRef<L.Circle | null>(null)
  const lastLiveRef = useRef<LiveFix | null>(null)
  const userPanningRef = useRef(false)
  const panTimerRef = useRef<number | null>(null)

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
  const walkSteps = useMemo(
    () => result.journey.steps.filter((s) => s.phase === 'walk'),
    [result],
  )

  useEffect(() => {
    if (!ref.current) return
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }

    const map = L.map(ref.current, { zoomControl: true }).setView(
      [result.origin.latitude, result.origin.longitude],
      14,
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    const bounds: L.LatLngExpression[] = []

    const pushLine = (
      coordinates: [number, number][] | undefined | null,
      style: L.PolylineOptions,
    ) => {
      if (!coordinates || coordinates.length < 2) return
      const latlngs = coordinates.map(([lng, lat]) => [lat, lng] as [number, number])
      L.polyline(latlngs, style).addTo(map)
      bounds.push(...latlngs)
    }

    // Continuous full-route lines first (point-to-point). Step fragments alone leave gaps.
    const outdoorCoords = result.outdoor?.geometry?.coordinates
    const walkCoords = result.walk?.geometry?.coordinates
    const outdoorIsReal =
      Array.isArray(outdoorCoords) &&
      outdoorCoords.length > 1 &&
      !(
        outdoorCoords.length <= 2 &&
        outdoorCoords.every(
          ([lng, lat]) =>
            Math.abs(lng - result.origin.longitude) < 1e-7 &&
            Math.abs(lat - result.origin.latitude) < 1e-7,
        )
      )

    if (outdoorIsReal) {
      pushLine(outdoorCoords, {
        color: '#22c55e',
        weight: 7,
        opacity: 0.88,
        lineJoin: 'round',
        lineCap: 'round',
      })
    }

    const walkIsSameAsOutdoor =
      outdoorIsReal &&
      Array.isArray(walkCoords) &&
      walkCoords.length > 1 &&
      outdoorCoords!.length === walkCoords.length &&
      outdoorCoords![0][0] === walkCoords[0][0] &&
      outdoorCoords![0][1] === walkCoords[0][1] &&
      outdoorCoords![outdoorCoords!.length - 1][0] === walkCoords[walkCoords.length - 1][0] &&
      outdoorCoords![outdoorCoords!.length - 1][1] === walkCoords[walkCoords.length - 1][1]

    if (Array.isArray(walkCoords) && walkCoords.length > 1 && !walkIsSameAsOutdoor) {
      pushLine(walkCoords, {
        color: WALK_COLOR,
        weight: isPointToPoint && !outdoorIsReal ? 7 : 6,
        opacity: 0.95,
        dashArray: isPointToPoint && !outdoorIsReal ? undefined : '10 8',
        lineJoin: 'round',
        lineCap: 'round',
      })
    }

    // Traffic-colored overlays on drive steps (optional detail on top of full line)
    for (const step of driveSteps) {
      const geom = step.geometry
      if (geom && geom.length > 1) {
        pushLine(geom, {
          color: trafficColor(step.trafficLevel),
          weight: 4,
          opacity: outdoorIsReal ? 0.75 : 0.92,
        })
      }
    }

    for (const step of walkSteps) {
      const geom = step.geometry
      if (geom && geom.length > 1 && (!walkCoords || walkCoords.length < 2)) {
        pushLine(geom, {
          color: WALK_COLOR,
          weight: 5,
          opacity: 0.95,
          dashArray: '10 8',
        })
      }
    }

    L.circleMarker([result.origin.latitude, result.origin.longitude], {
      radius: 8,
      color: '#fff',
      fillColor: '#0ea5e9',
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>Start</strong><br/>${escapeHtml(result.origin.label)}`)
      .addTo(map)
    bounds.push([result.origin.latitude, result.origin.longitude])

    if (!isPointToPoint) {
      L.circleMarker([parking.latitude, parking.longitude], {
        radius: 10,
        color: '#fff',
        fillColor: PARKING_COLOR,
        fillOpacity: 1,
        weight: 2,
      })
        .bindPopup(
          `<strong>Nearest parking</strong><br/>${escapeHtml(parking.label)}<br/>${parking.offsetMeters} m walk to the entrance — leave the car here`,
        )
        .addTo(map)
      bounds.push([parking.latitude, parking.longitude])
    }

    L.circleMarker([entrance.latitude, entrance.longitude], {
      radius: 9,
      color: '#fff',
      fillColor: ENTRANCE_COLOR,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(
        isPointToPoint
          ? `<strong>Entrance</strong><br/>${escapeHtml(entrance.label)}<br/>End of outdoor · start indoor`
          : `<strong>Building entrance</strong><br/>${escapeHtml(entrance.label)}<br/>End of walk · start indoor`,
      )
      .addTo(map)
    bounds.push([entrance.latitude, entrance.longitude])

    L.circleMarker([result.destination.latitude, result.destination.longitude], {
      radius: 8,
      color: '#fff',
      fillColor: '#f59e0b',
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>Unit (indoor)</strong><br/>${escapeHtml(result.destination.label)}`)
      .addTo(map)
    bounds.push([result.destination.latitude, result.destination.longitude])

    const legendHtml = `
      <div class="demo-leaflet-card" data-card="legend">
        <button type="button" class="demo-leaflet-card__head" aria-expanded="true">
          <strong>Route legend</strong>
          <span class="demo-leaflet-card__chev" aria-hidden="true"></span>
        </button>
        <div class="demo-leaflet-card__body">
          ${
            isPointToPoint
              ? `<span style="color:#22c55e">━━</span> Point-to-point (start → entrance)<br/>
          <span style="color:${WALK_COLOR}">━━</span> Walk leg<br/>`
              : `<span style="color:${trafficColor('Light')}">━━</span> Drive (to parking)<br/>
          <span style="color:${WALK_COLOR}">- - -</span> Walk (parking → entrance)<br/>`
          }
          <span style="color:${LIVE_BLUE}">●</span> You (live) ·
          ${isPointToPoint ? '' : `<span style="color:${PARKING_COLOR}">●</span> Parking ·`}
          <span style="color:${ENTRANCE_COLOR}">●</span> Entrance ·
          <span style="color:#f59e0b">●</span> Unit
        </div>
      </div>`
    const weatherHtml = `
      <div class="demo-leaflet-card" data-card="weather">
        <button type="button" class="demo-leaflet-card__head" aria-expanded="true">
          <strong>Weather · live</strong>
          <span class="demo-leaflet-card__chev" aria-hidden="true"></span>
        </button>
        <div class="demo-leaflet-card__body">
          ${weather.summary ?? '—'} · ${weather.temperatureF != null ? `${weather.temperatureF}°F` : '—'}
          ${weather.feelsLikeF != null ? ` (feels ${weather.feelsLikeF}°F)` : ''}<br/>
          Humidity ${weather.humidityPct ?? '—'}% · Wind ${weather.windMph ?? '—'} mph<br/>
          <span class="muted">${weather.provider}${weather.fetchedAt ? ` · ${weather.fetchedAt}` : ''}</span>
        </div>
      </div>`
    const trafficHtml = `
      <div class="demo-leaflet-card" data-card="traffic">
        <button type="button" class="demo-leaflet-card__head" aria-expanded="true">
          <strong>Traffic · drive leg</strong>
          <span class="demo-leaflet-card__chev" aria-hidden="true"></span>
        </button>
        <div class="demo-leaflet-card__body">
          Overall: <b style="color:${trafficColor(traffic.level)}">${traffic.level}</b>
          · index ${traffic.congestionIndex}
          ${traffic.averageSpeedMph != null ? ` · avg ${traffic.averageSpeedMph} mph` : ''}<br/>
          <span class="muted">${traffic.note}</span>
        </div>
      </div>`

    const Overlay = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demo-map-overlay')
        div.innerHTML = legendHtml + weatherHtml + trafficHtml
        L.DomEvent.disableClickPropagation(div)
        L.DomEvent.disableScrollPropagation(div)
        div.querySelectorAll('.demo-leaflet-card__head').forEach((btn) => {
          const head = btn as HTMLButtonElement
          const card = head.closest('.demo-leaflet-card')
          if (!card) return
          const key = card.getAttribute('data-card') || 'card'
          const storageKey = `keiros_map_card_${key}`
          const collapsed = localStorage.getItem(storageKey) === '1'
          if (collapsed) {
            card.classList.add('is-collapsed')
            head.setAttribute('aria-expanded', 'false')
          }
          L.DomEvent.on(head, 'click', (ev) => {
            L.DomEvent.stop(ev)
            const next = !card.classList.contains('is-collapsed')
            card.classList.toggle('is-collapsed', next)
            head.setAttribute('aria-expanded', next ? 'false' : 'true')
            try {
              localStorage.setItem(storageKey, next ? '1' : '0')
            } catch {
              /* ignore quota */
            }
          })
        })
        return div
      },
    })
    map.addControl(new Overlay({ position: 'topright' }))

    map.on('dragstart', () => {
      userPanningRef.current = true
      if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
    })
    map.on('dragend', () => {
      if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
      panTimerRef.current = window.setTimeout(() => {
        userPanningRef.current = false
      }, 8000)
    })

    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.12))
    mapRef.current = map

    return () => {
      if (panTimerRef.current) window.clearTimeout(panTimerRef.current)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      liveMarkerRef.current = null
      accuracyRef.current = null
      lastLiveRef.current = null
    }
  }, [result, parking, entrance, driveSteps, walkSteps, weather, traffic])

  // Manual step highlight (optional Next / Previous) — skip camera when following live GPS
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeStep) return
    if (activeStep.phase === 'indoor') return

    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }

    const fill =
      activeStep.phase === 'walk' ? WALK_COLOR : trafficColor(activeStep.trafficLevel) || '#22c55e'
    markerRef.current = L.circleMarker([activeStep.latitude, activeStep.longitude], {
      radius: 9,
      color: '#fff',
      fillColor: fill,
      fillOpacity: 0.95,
      weight: 2,
      opacity: followLive && liveFix ? 0.55 : 1,
    })
      .bindPopup(
        `<strong>${activeStep.phase === 'walk' ? 'Walk' : 'Drive'}</strong><br/>${escapeHtml(activeStep.instruction)}`,
      )
      .addTo(map)

    if (followLive && liveFix) return

    markerRef.current.openPopup()
    // Pan to the step — avoid fitting a tiny segment (hides the full point-to-point line).
    map.panTo([activeStep.latitude, activeStep.longitude], { animate: true })
    const z = map.getZoom()
    if (activeStep.phase === 'walk' && z < 15) map.setZoom(16)
    else if (z < 13) map.setZoom(14)
  }, [activeStep, followLive, liveFix])

  // Live GPS puck + follow camera
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!liveFix) {
      liveMarkerRef.current?.remove()
      liveMarkerRef.current = null
      accuracyRef.current?.remove()
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

    const latlng: L.LatLngExpression = [liveFix.latitude, liveFix.longitude]
    const icon = livePuckIcon(heading)

    if (!liveMarkerRef.current) {
      liveMarkerRef.current = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map)
    } else {
      liveMarkerRef.current.setLatLng(latlng)
      liveMarkerRef.current.setIcon(icon)
    }

    if (!accuracyRef.current) {
      accuracyRef.current = L.circle(latlng, {
        radius: Math.max(8, liveFix.accuracy || 20),
        color: LIVE_BLUE,
        weight: 1,
        fillColor: LIVE_BLUE,
        fillOpacity: 0.12,
      }).addTo(map)
    } else {
      accuracyRef.current.setLatLng(latlng)
      accuracyRef.current.setRadius(Math.max(8, liveFix.accuracy || 20))
    }

    if (followLive && !userPanningRef.current) {
      const targetZoom = liveFix.speed != null && liveFix.speed > 8 ? 16 : 17
      if (map.getZoom() < 15) map.setZoom(targetZoom)
      map.panTo(latlng, { animate: true, duration: 0.35 })
    }
  }, [liveFix, followLive])

  return (
    <div className={`demo-map-shell${followLive && liveFix ? ' is-live' : ''}`}>
      <div className="demo-map" ref={ref} aria-label="Drive and walk navigation map" />
      {followLive && liveFix ? (
        <button
          type="button"
          className="demo-recenter"
          aria-label="Recenter on my location"
          onClick={() => {
            userPanningRef.current = false
            const map = mapRef.current
            if (!map || !liveFix) return
            map.setView([liveFix.latitude, liveFix.longitude], Math.max(map.getZoom(), 16), {
              animate: true,
            })
          }}
        >
          <span className="demo-recenter__dot" />
        </button>
      ) : null}
    </div>
  )
}
