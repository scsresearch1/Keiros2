import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  type AdvMarker,
  createAdvancedMarker,
  latLngLiteral,
  loadGoogleMaps,
  mapOptions,
  markerLatLng,
} from '../googleMaps'

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

function startPinSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <path d="M18 1c-8.3 0-15 6.7-15 15 0 11.2 15 27 15 27s15-15.8 15-27C33 7.7 26.3 1 18 1z" fill="#ea4335" stroke="#fff" stroke-width="2"/>
  <circle cx="18" cy="16" r="7" fill="#fff"/>
  <text x="18" y="20" text-anchor="middle" font-size="11" font-family="Arial,sans-serif" font-weight="700" fill="#ea4335">S</text>
</svg>`
}

function unitDotSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <circle cx="9" cy="9" r="7" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/>
</svg>`
}

export const StartPickerMap = forwardRef<StartPickerMapHandle, Props>(function StartPickerMap(
  { latitude, longitude, focus, onPick },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<AdvMarker | null>(null)
  const unitRef = useRef<AdvMarker | null>(null)
  const onPickRef = useRef(onPick)
  const skipFlyRef = useRef(false)
  const pointRef = useRef({ latitude, longitude })
  const focusRef = useRef(focus)
  const [error, setError] = useState('')

  onPickRef.current = onPick
  pointRef.current = { latitude, longitude }
  focusRef.current = focus

  useImperativeHandle(ref, () => ({
    frame() {
      const map = mapRef.current
      const point = pointRef.current
      const target = focusRef.current
      if (!map || point.latitude == null || point.longitude == null || !target) return
      const bounds = new google.maps.LatLngBounds()
      bounds.extend(latLngLiteral(point.latitude, point.longitude))
      bounds.extend(latLngLiteral(target.latitude, target.longitude))
      map.fitBounds(bounds, 48)
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let clickListener: google.maps.MapsEventListener | null = null

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !hostRef.current) return
        const initial = pointRef.current
        const target = focusRef.current
        const center =
          initial.latitude != null && initial.longitude != null
            ? latLngLiteral(initial.latitude, initial.longitude)
            : target
              ? latLngLiteral(target.latitude, target.longitude)
              : latLngLiteral(20, 0)
        const zoom = initial.latitude != null || target ? 14 : 2
        const map = new google.maps.Map(
          hostRef.current,
          mapOptions(center, zoom, { fullscreenControl: false }),
        )
        mapRef.current = map
        setError('')
        clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return
          skipFlyRef.current = true
          onPickRef.current(round6(event.latLng.lat()), round6(event.latLng.lng()))
          if ((map.getZoom() ?? 0) < 13) map.setZoom(14)
          map.panTo(event.latLng)
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Google Maps failed to load')
      })

    return () => {
      cancelled = true
      clickListener?.remove()
      if (markerRef.current) markerRef.current.map = null
      if (unitRef.current) unitRef.current.map = null
      markerRef.current = null
      unitRef.current = null
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (unitRef.current) unitRef.current.map = null
    unitRef.current = null
    if (!focus) return
    const marker = createAdvancedMarker({
      map,
      position: latLngLiteral(focus.latitude, focus.longitude),
      title: focus.label,
      svg: unitDotSvg(),
    })
    marker.anchorTop = '50%'
    marker.anchorLeft = '50%'
    unitRef.current = marker
    if (pointRef.current.latitude == null) {
      map.setCenter(latLngLiteral(focus.latitude, focus.longitude))
      map.setZoom(14)
    }
  }, [focus])

  useEffect(() => {
    const map = mapRef.current
    if (!map || latitude == null || longitude == null) return
    const pos = latLngLiteral(latitude, longitude)
    if (!markerRef.current) {
      const marker = createAdvancedMarker({
        map,
        position: pos,
        title: 'Start',
        zIndex: 600,
        svg: startPinSvg(),
        gmpDraggable: true,
      })
      marker.addListener('dragend', () => {
        const ll = markerLatLng(marker)
        if (!ll) return
        skipFlyRef.current = true
        onPickRef.current(round6(ll.lat), round6(ll.lng))
      })
      markerRef.current = marker
    } else {
      const current = markerLatLng(markerRef.current)
      if (
        !current ||
        Math.abs(current.lat - latitude) > 1e-7 ||
        Math.abs(current.lng - longitude) > 1e-7
      ) {
        markerRef.current.position = pos
      }
    }
    if (skipFlyRef.current) {
      skipFlyRef.current = false
      return
    }
    map.panTo(pos)
    map.setZoom(Math.max(map.getZoom() ?? 14, 14))
  }, [latitude, longitude])

  return (
    <div className="demo-start-mapwrap">
      <div ref={hostRef} className="demo-start-map" aria-label="Google Map for choosing the starting point" />
      {error ? (
        <p className="demo-map-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="demo-start__map-hint">Click the map or drag the pin. That point is the drive start.</p>
      )}
    </div>
  )
})
