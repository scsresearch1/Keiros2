import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import L from 'leaflet'

export type MapFocus = {
  latitude: number
  longitude: number
  label: string
}

type Props = {
  latitude: number | null
  longitude: number | null
  focus: MapFocus | null
  onPick: (latitude: number, longitude: number) => void
}

export type StartPickerMapHandle = {
  frame: () => void
}

function round6(value: number) {
  return Math.round(value * 1e6) / 1e6
}

const pinIcon = L.divIcon({
  className: 'start-pin-icon',
  html: '<span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

export const StartPickerMap = forwardRef<StartPickerMapHandle, Props>(function StartPickerMap(
  { latitude, longitude, focus, onPick },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const unitRef = useRef<L.CircleMarker | null>(null)
  const onPickRef = useRef(onPick)
  const skipFlyRef = useRef(false)
  const pointRef = useRef({ latitude, longitude })
  const focusRef = useRef(focus)

  onPickRef.current = onPick
  pointRef.current = { latitude, longitude }
  focusRef.current = focus

  useImperativeHandle(ref, () => ({
    frame() {
      const map = mapRef.current
      const point = pointRef.current
      const target = focusRef.current
      if (!map || point.latitude == null || point.longitude == null || !target) return
      map.fitBounds(
        L.latLngBounds(
          [point.latitude, point.longitude],
          [target.latitude, target.longitude],
        ).pad(0.25),
        { maxZoom: 15 },
      )
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const initial = pointRef.current
    const target = focusRef.current
    const center: L.LatLngExpression =
      initial.latitude != null && initial.longitude != null
        ? [initial.latitude, initial.longitude]
        : target
          ? [target.latitude, target.longitude]
          : [20, 0]
    const zoom = initial.latitude != null || target ? 14 : 2
    const map = L.map(host, { zoomControl: true }).setView(center, zoom)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', (event) => {
      skipFlyRef.current = true
      onPickRef.current(round6(event.latlng.lat), round6(event.latlng.lng))
      if (map.getZoom() < 13) map.flyTo(event.latlng, 14, { duration: 0.4 })
    })
    mapRef.current = map
    const frameId = requestAnimationFrame(() => map.invalidateSize())
    const timer = window.setTimeout(() => map.invalidateSize(), 200)
    return () => {
      cancelAnimationFrame(frameId)
      window.clearTimeout(timer)
      map.remove()
      mapRef.current = null
      markerRef.current = null
      unitRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (unitRef.current) {
      unitRef.current.remove()
      unitRef.current = null
    }
    if (!focus) return
    unitRef.current = L.circleMarker([focus.latitude, focus.longitude], {
      radius: 7,
      color: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.95,
      weight: 2,
    })
      .bindTooltip(focus.label, { direction: 'top' })
      .addTo(map)
    if (pointRef.current.latitude == null) map.setView([focus.latitude, focus.longitude], 14)
  }, [focus])

  useEffect(() => {
    const map = mapRef.current
    if (!map || latitude == null || longitude == null) return
    if (!markerRef.current) {
      const marker = L.marker([latitude, longitude], {
        icon: pinIcon,
        draggable: true,
        autoPan: true,
        zIndexOffset: 600,
      })
      marker.on('dragend', () => {
        const ll = marker.getLatLng()
        skipFlyRef.current = true
        onPickRef.current(round6(ll.lat), round6(ll.lng))
      })
      marker.bindTooltip('Start', { permanent: true, direction: 'top', offset: [0, -8] })
      marker.addTo(map)
      markerRef.current = marker
    } else {
      const current = markerRef.current.getLatLng()
      if (Math.abs(current.lat - latitude) > 1e-7 || Math.abs(current.lng - longitude) > 1e-7) {
        markerRef.current.setLatLng([latitude, longitude])
      }
    }
    if (skipFlyRef.current) {
      skipFlyRef.current = false
      return
    }
    map.flyTo([latitude, longitude], Math.max(map.getZoom(), 14), { duration: 0.45 })
  }, [latitude, longitude])

  return (
    <div className="demo-start-mapwrap">
      <div ref={hostRef} className="demo-start-map" aria-label="Map for choosing the starting point" />
      <p className="demo-start__map-hint">Click the map or drag the pin. That point is the drive start.</p>
    </div>
  )
})
