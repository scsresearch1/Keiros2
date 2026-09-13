import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Building, Floor, Location } from '../data/erpData'
import { boundsOf, buildingCentroids, footprintAround, type LatLng } from './geo'
import { OSM_ATTRIBUTION, OSM_DARK_URL, OSM_LIGHT_URL } from './osmTiles'

export type MapLevel = 'complex' | 'building' | 'floor' | 'unit'
export type ViewMode = '2D' | '3D'

export type WayfindingMapProps = {
  level: MapLevel
  mode: ViewMode
  darkBasemap: boolean
  showLabels: boolean
  showRoute: boolean
  complexId: string | null
  buildingId: string | null
  floorId: string | null
  unitId: string | null
  buildings: Building[]
  floors: Floor[]
  locations: Location[]
  routeStops: Location[]
  onSelectBuilding: (id: string) => void
  onSelectFloor: (id: string) => void
  onSelectUnit: (id: string) => void
}

const TYPE_COLOR: Record<string, string> = {
  Unit: '#5eead4',
  Room: '#7dd3fc',
  Lobby: '#fbbf24',
  Entry: '#34d399',
  Exit: '#fb7185',
  Elevator: '#a78bfa',
  Stairs: '#c4b5fd',
  Amenity: '#fdba74',
  Corridor: '#94a3b8',
  Parking: '#60a5fa',
  Pool: '#38bdf8',
  Gym: '#f472b6',
  Door: '#e2e8f0',
}

function fixDefaultIcons() {
  // Leaflet default marker assets break under Vite bundling; we use divIcons only.
  const proto = L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown }
  delete proto._getIconUrl
}

function roomRing(point: LatLng, type: string): LatLng[] {
  const size = type === 'Corridor' ? 18 : type === 'Lobby' ? 22 : type === 'Parking' ? 26 : 12
  return footprintAround(point, size)
}

export function WayfindingMap(props: WayfindingMapProps) {
  const {
    level,
    darkBasemap,
    showLabels,
    showRoute,
    complexId,
    buildingId,
    floorId,
    unitId,
    buildings,
    floors,
    locations,
    routeStops,
    onSelectBuilding,
    onSelectFloor,
    onSelectUnit,
  } = props

  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const baseRef = useRef<L.TileLayer | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const handlersRef = useRef({ onSelectBuilding, onSelectFloor, onSelectUnit })
  handlersRef.current = { onSelectBuilding, onSelectFloor, onSelectUnit }

  const scopedBuildings = useMemo(() => {
    if (buildingId) return buildings.filter((b) => b.id === buildingId)
    if (complexId) return buildings.filter((b) => b.complexId === complexId)
    return buildings.filter((b) => locations.some((l) => l.buildingId === b.id))
  }, [buildings, complexId, buildingId, locations])

  const scopedLocations = useMemo(() => {
    if (unitId) {
      const unit = locations.find((l) => l.id === unitId)
      if (!unit) return []
      return locations.filter((l) => l.floorId === unit.floorId)
    }
    if (floorId) return locations.filter((l) => l.floorId === floorId)
    if (buildingId) return locations.filter((l) => l.buildingId === buildingId)
    if (complexId) return locations.filter((l) => l.complexId === complexId)
    return locations
  }, [locations, complexId, buildingId, floorId, unitId])

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return
    fixDefaultIcons()
    const map = L.map(hostRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    })
    const tiles = L.tileLayer(OSM_DARK_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map)
    const overlay = L.layerGroup().addTo(map)
    mapRef.current = map
    baseRef.current = tiles
    layerRef.current = overlay
    map.setView([41.8954, -87.6243], 17)
    requestAnimationFrame(() => map.invalidateSize())
    return () => {
      map.remove()
      mapRef.current = null
      baseRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !baseRef.current) return
    map.removeLayer(baseRef.current)
    const tiles = L.tileLayer(darkBasemap ? OSM_DARK_URL : OSM_LIGHT_URL, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map)
    baseRef.current = tiles
  }, [darkBasemap])

  useEffect(() => {
    const map = mapRef.current
    const overlay = layerRef.current
    if (!map || !overlay) return
    overlay.clearLayers()

    const centroids = buildingCentroids(scopedBuildings, locations)
    const fitPoints: LatLng[] = []

    if (level === 'complex') {
      centroids.forEach((item, index) => {
        const color = `hsl(${198 + index * 28}, 72%, 58%)`
        const poly = L.polygon(
          item.ring.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.28,
            className: 'k-wf-building-foot',
          },
        )
        poly.on('click', () => handlersRef.current.onSelectBuilding(item.building.id))
        poly.bindTooltip(
          `<strong>${item.building.name}</strong><br/>${item.building.floors} floors · ${item.locations.length} mapped`,
          { sticky: true, className: 'k-wf-tip' },
        )
        poly.addTo(overlay)
        fitPoints.push(...item.ring)

        if (showLabels) {
          L.marker([item.center.lat, item.center.lng], {
            icon: L.divIcon({
              className: 'k-wf-label',
              html: `<span>${item.building.name}</span>`,
              iconSize: [120, 24],
              iconAnchor: [60, 12],
            }),
            interactive: false,
          }).addTo(overlay)
        }
      })

      // Building-to-building connectors (campus graph)
      for (let i = 0; i < centroids.length; i += 1) {
        for (let j = i + 1; j < centroids.length; j += 1) {
          L.polyline(
            [
              [centroids[i].center.lat, centroids[i].center.lng],
              [centroids[j].center.lat, centroids[j].center.lng],
            ],
            { color: '#5eead4', weight: 2, dashArray: '6 8', opacity: 0.75 },
          ).addTo(overlay)
        }
      }
    }

    // 2D map only — 3D mode uses BuildingBlueprint3D
    if (level === 'building' && buildingId) {
      const buildingFloors = floors
        .filter((f) => f.buildingId === buildingId)
        .sort((a, b) => a.level - b.level)
      const base = centroids[0]
      const baseCenter = base?.center ??
        (scopedLocations[0]
          ? { lat: scopedLocations[0].latitude, lng: scopedLocations[0].longitude }
          : null)

      if (baseCenter) {
        buildingFloors.forEach((floor) => {
          const center = baseCenter
          const ring = footprintAround(center, 32)
          const active = floor.id === floorId
          const poly = L.polygon(
            ring.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: active ? '#5eead4' : '#7dd3fc',
              weight: active ? 3 : 1.5,
              fillColor: active ? '#14b8a6' : '#0ea5e9',
              fillOpacity: active ? 0.35 : 0.18,
            },
          )
          poly.on('click', () => handlersRef.current.onSelectFloor(floor.id))
          poly.bindTooltip(`${floor.label} · Level ${floor.level}`, { sticky: true, className: 'k-wf-tip' })
          poly.addTo(overlay)
          fitPoints.push(...ring)

          if (showLabels) {
            L.marker([center.lat, center.lng], {
              icon: L.divIcon({
                className: 'k-wf-label k-wf-label--floor',
                html: `<span>${floor.label}</span>`,
                iconSize: [70, 20],
                iconAnchor: [35, 10],
              }),
              interactive: false,
            }).addTo(overlay)
          }
        })

        L.circleMarker([baseCenter.lat, baseCenter.lng], {
          radius: 6,
          color: '#fbbf24',
          fillColor: '#f59e0b',
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindTooltip('Vertical core', { className: 'k-wf-tip' })
          .addTo(overlay)
      }
    }

    if ((level === 'floor' || level === 'unit') && scopedLocations.length) {
      scopedLocations.forEach((loc) => {
        const point = { lat: loc.latitude, lng: loc.longitude }
        const ring = roomRing(point, loc.type)
        const color = TYPE_COLOR[loc.type] ?? '#94a3b8'
        const selected = loc.id === unitId
        const poly = L.polygon(
          ring.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: selected ? '#f8fafc' : color,
            weight: selected ? 3 : 1.5,
            fillColor: color,
            fillOpacity: selected ? 0.55 : 0.28,
            className: 'k-wf-room',
          },
        )
        poly.on('click', () => handlersRef.current.onSelectUnit(loc.id))
        poly.bindTooltip(
          `<strong>${loc.name}</strong><br/>${loc.type} · ${loc.code}<br/>${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)} · ${loc.elevation} m`,
          { sticky: true, className: 'k-wf-tip' },
        )
        poly.addTo(overlay)
        fitPoints.push(...ring)

        if (showLabels || selected) {
          L.marker([point.lat, point.lng], {
            icon: L.divIcon({
              className: selected ? 'k-wf-label k-wf-label--hot' : 'k-wf-label k-wf-label--unit',
              html: `<span>${loc.name}</span>`,
              iconSize: [110, 20],
              iconAnchor: [55, 10],
            }),
            interactive: false,
          }).addTo(overlay)
        }
      })
    }

    if (showRoute && routeStops.length > 1) {
      const latlngs = routeStops.map((stop) => [stop.latitude, stop.longitude] as [number, number])
      L.polyline(latlngs, {
        color: '#fbbf24',
        weight: 5,
        opacity: 0.95,
        className: 'k-wf-route',
      }).addTo(overlay)

      routeStops.forEach((stop, index) => {
        L.marker([stop.latitude, stop.longitude], {
          icon: L.divIcon({
            className: 'k-wf-step',
            html: `<span>${index + 1}</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          interactive: false,
        }).addTo(overlay)
        fitPoints.push({ lat: stop.latitude, lng: stop.longitude })
      })
    }

    const box = boundsOf(fitPoints.length ? fitPoints : scopedLocations.map((l) => ({ lat: l.latitude, lng: l.longitude })))
    if (box) {
      map.fitBounds(box, { padding: [48, 48], maxZoom: level === 'unit' ? 19 : 18 })
    }
  }, [
    level,
    showLabels,
    showRoute,
    complexId,
    buildingId,
    floorId,
    unitId,
    scopedBuildings,
    scopedLocations,
    floors,
    locations,
    routeStops,
  ])

  return (
    <div
      ref={hostRef}
      className={`k-wf-map${darkBasemap ? ' is-dark-basemap' : ''}`}
      role="application"
      aria-label="Wayfinding map"
    />
  )
}
