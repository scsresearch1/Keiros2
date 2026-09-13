import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { JourneyStep, NavigateResult } from '../api/client'
import './outdoor.css'

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
    label: 'Parking',
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

    const map = L.map(ref.current, { zoomControl: false, attributionControl: false }).setView(
      [parking.latitude, parking.longitude],
      14,
    )
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
    }).addTo(map)

    const bounds: L.LatLngExpression[] = []

    L.circleMarker([result.origin.latitude, result.origin.longitude], {
      radius: 7,
      color: '#38bdf8',
      fillColor: '#0ea5e9',
      fillOpacity: 0.9,
    })
      .bindPopup(`<strong>Start</strong><br/>${result.origin.label}`)
      .addTo(map)
    bounds.push([result.origin.latitude, result.origin.longitude])

    L.circleMarker([parking.latitude, parking.longitude], {
      radius: 10,
      color: '#fff',
      fillColor: PARKING_COLOR,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>Parking</strong><br/>${parking.label}`)
      .addTo(map)
    bounds.push([parking.latitude, parking.longitude])

    L.circleMarker([entrance.latitude, entrance.longitude], {
      radius: 9,
      color: '#fff',
      fillColor: ENTRANCE_COLOR,
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(`<strong>Entrance</strong><br/>${entrance.label}`)
      .addTo(map)
    bounds.push([entrance.latitude, entrance.longitude])

    L.circleMarker([result.destination.latitude, result.destination.longitude], {
      radius: 7,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.85,
    })
      .bindPopup(`<strong>Destination</strong><br/>${result.destination.label}`)
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

    const Overlay = L.Control.extend({
      onAdd() {
        const div = L.DomUtil.create('div', 'tour-map-chip')
        div.innerHTML = `<strong>${weather.summary ?? 'Conditions'}</strong> · ${
          weather.temperatureF != null ? `${weather.temperatureF}°F` : '—'
        } · Traffic <b style="color:${trafficColor(traffic.level)}">${traffic.level}</b>`
        L.DomEvent.disableClickPropagation(div)
        return div
      },
    })
    map.addControl(new Overlay({ position: 'bottomleft' }))

    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.14))
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
      .bindPopup(activeStep.instruction)
      .addTo(map)
      .openPopup()
    map.panTo([activeStep.latitude, activeStep.longitude], { animate: true })
  }, [activeStep])

  return <div className="tour-outdoor-map" ref={ref} aria-label="Outdoor route map" />
}
