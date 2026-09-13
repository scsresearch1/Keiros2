import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import type { JourneyStep, NavigateResult } from '../api'

type Props = {
  result: NavigateResult
  activeStep: JourneyStep | null
  weather: NavigateResult['weather']
  traffic: NavigateResult['outdoor']['traffic']
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

export function OutdoorMap({ result, activeStep, weather, traffic }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.CircleMarker | null>(null)

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
      [parking.latitude, parking.longitude],
      14,
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)

    const bounds: L.LatLngExpression[] = []

    L.circleMarker([result.origin.latitude, result.origin.longitude], {
      radius: 7,
      color: '#38bdf8',
      fillColor: '#0ea5e9',
      fillOpacity: 0.9,
    })
      .bindPopup(`<strong>Drive start</strong><br/>${result.origin.label}`)
      .addTo(map)
    bounds.push([result.origin.latitude, result.origin.longitude])

    L.circleMarker([parking.latitude, parking.longitude], {
      radius: 10,
      color: '#fff',
      fillColor: PARKING_COLOR,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(
        `<strong>Parking</strong><br/>${parking.label}<br/>~${parking.offsetMeters} m from entrance — leave the car here`,
      )
      .addTo(map)
    bounds.push([parking.latitude, parking.longitude])

    L.circleMarker([entrance.latitude, entrance.longitude], {
      radius: 9,
      color: '#fff',
      fillColor: ENTRANCE_COLOR,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>Building entrance</strong><br/>${entrance.label}<br/>End of walk · start indoor`)
      .addTo(map)
    bounds.push([entrance.latitude, entrance.longitude])

    L.circleMarker([result.destination.latitude, result.destination.longitude], {
      radius: 7,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.85,
    })
      .bindPopup(`<strong>Unit (indoor)</strong><br/>${result.destination.label}`)
      .addTo(map)

    for (const step of driveSteps) {
      const geom = step.geometry
      if (geom && geom.length > 1) {
        const latlngs = geom.map(([lng, lat]) => [lat, lng] as [number, number])
        L.polyline(latlngs, {
          color: trafficColor(step.trafficLevel),
          weight: 5,
          opacity: 0.9,
        }).addTo(map)
        bounds.push(...latlngs)
      }
    }

    for (const step of walkSteps) {
      const geom = step.geometry
      if (geom && geom.length > 1) {
        const latlngs = geom.map(([lng, lat]) => [lat, lng] as [number, number])
        L.polyline(latlngs, {
          color: WALK_COLOR,
          weight: 5,
          opacity: 0.95,
          dashArray: '10 8',
        }).addTo(map)
        bounds.push(...latlngs)
      }
    }

    if (walkSteps.length === 0 && result.walk?.geometry?.coordinates?.length) {
      const latlngs = result.walk.geometry.coordinates.map(
        ([lng, lat]) => [lat, lng] as [number, number],
      )
      L.polyline(latlngs, { color: WALK_COLOR, weight: 5, dashArray: '10 8', opacity: 0.95 }).addTo(map)
      bounds.push(...latlngs)
    }

    const legendHtml = `
      <div class="demo-leaflet-card">
        <strong>Route legend</strong><br/>
        <span style="color:${trafficColor('Light')}">━━</span> Drive (to parking)<br/>
        <span style="color:${WALK_COLOR}">- - -</span> Walk (parking → entrance)<br/>
        <span style="color:${PARKING_COLOR}">●</span> Parking ·
        <span style="color:${ENTRANCE_COLOR}">●</span> Entrance ·
        Inside = 3D view
      </div>`
    const weatherHtml = `
      <div class="demo-leaflet-card">
        <strong>Weather · live</strong><br/>
        ${weather.summary ?? '—'} · ${weather.temperatureF != null ? `${weather.temperatureF}°F` : '—'}
        ${weather.feelsLikeF != null ? ` (feels ${weather.feelsLikeF}°F)` : ''}<br/>
        Humidity ${weather.humidityPct ?? '—'}% · Wind ${weather.windMph ?? '—'} mph<br/>
        <span class="muted">${weather.provider}${weather.fetchedAt ? ` · ${weather.fetchedAt}` : ''}</span>
      </div>`
    const trafficHtml = `
      <div class="demo-leaflet-card">
        <strong>Traffic · drive leg</strong><br/>
        Overall: <b style="color:${trafficColor(traffic.level)}">${traffic.level}</b>
        · index ${traffic.congestionIndex}
        ${traffic.averageSpeedMph != null ? ` · avg ${traffic.averageSpeedMph} mph` : ''}<br/>
        <span class="muted">${traffic.note}</span>
      </div>`

    const Overlay = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'demo-map-overlay')
        div.innerHTML = legendHtml + weatherHtml + trafficHtml
        L.DomEvent.disableClickPropagation(div)
        return div
      },
    })
    map.addControl(new Overlay({ position: 'topright' }))

    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.12))
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [result, parking, entrance, driveSteps, walkSteps, weather, traffic])

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
      radius: 11,
      color: '#fff',
      fillColor: fill,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>${activeStep.phase === 'walk' ? 'Walk' : 'Drive'}</strong><br/>${activeStep.instruction}`)
      .addTo(map)
      .openPopup()
    map.panTo([activeStep.latitude, activeStep.longitude], { animate: true })
    if (activeStep.geometry && activeStep.geometry.length > 1) {
      const latlngs = activeStep.geometry.map(([lng, lat]) => [lat, lng] as [number, number])
      map.fitBounds(L.latLngBounds(latlngs).pad(0.4), { maxZoom: activeStep.phase === 'walk' ? 17 : 14 })
    } else if (activeStep.phase === 'walk') {
      map.setZoom(17)
    }
  }, [activeStep])

  return <div className="demo-map" ref={ref} aria-label="Drive and walk navigation map" />
}
