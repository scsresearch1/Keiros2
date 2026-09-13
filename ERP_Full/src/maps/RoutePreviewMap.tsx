import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Location } from '../data/erpData'
import { boundsOf } from './geo'
import { OSM_ATTRIBUTION, OSM_DARK_URL } from './osmTiles'

type Props = {
  stops: Location[]
  activeIndex: number
  title?: string
}

export function RoutePreviewMap({ stops, activeIndex }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return
    const map = L.map(hostRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    })
    L.tileLayer(OSM_DARK_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map)
    const overlay = L.layerGroup().addTo(map)
    mapRef.current = map
    layerRef.current = overlay
    requestAnimationFrame(() => map.invalidateSize())
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const overlay = layerRef.current
    if (!map || !overlay) return
    overlay.clearLayers()
    if (!stops.length) return

    const latlngs = stops.map((s) => [s.latitude, s.longitude] as [number, number])
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#fbbf24', weight: 5, opacity: 0.95 }).addTo(overlay)
    }

    stops.forEach((stop, index) => {
      const active = index === activeIndex
      L.marker([stop.latitude, stop.longitude], {
        icon: L.divIcon({
          className: active ? 'k-wf-step is-active-step' : 'k-wf-step',
          html: `<span>${index + 1}</span>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        interactive: false,
      }).addTo(overlay)

      if (active) {
        L.circleMarker([stop.latitude, stop.longitude], {
          radius: 14,
          color: '#5eead4',
          weight: 2,
          fillOpacity: 0.15,
        }).addTo(overlay)
      }
    })

    const box = boundsOf(stops.map((s) => ({ lat: s.latitude, lng: s.longitude })))
    if (box) map.fitBounds(box, { padding: [40, 40], maxZoom: 19 })
    if (stops[activeIndex]) {
      map.panTo([stops[activeIndex].latitude, stops[activeIndex].longitude])
    }
  }, [stops, activeIndex])

  return <div ref={hostRef} className="k-route-preview-map is-dark-basemap" role="application" aria-label="Route preview map" />
}

export function useRouteStopLabels(stops: Location[]) {
  return useMemo(
    () =>
      stops.map((stop, index) => ({
        id: `${stop.id}-${index}`,
        index,
        name: stop.name,
        detail: `${stop.buildingName} · ${stop.floorLabel} · ${stop.type}`,
        location: stop,
      })),
    [stops],
  )
}
