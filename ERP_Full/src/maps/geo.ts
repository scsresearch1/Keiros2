import type { Building, Floor, Location } from '../data/erpData'

export type LatLng = { lat: number; lng: number }

export type GeoPoint = LatLng & {
  id: string
  label: string
  elevation: number
  meta?: Record<string, string>
}

export function boundsOf(points: LatLng[]): [[number, number], [number, number]] | null {
  if (!points.length) return null
  let minLat = points[0].lat
  let maxLat = points[0].lat
  let minLng = points[0].lng
  let maxLng = points[0].lng
  for (const point of points) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLng = Math.min(minLng, point.lng)
    maxLng = Math.max(maxLng, point.lng)
  }
  const padLat = Math.max((maxLat - minLat) * 0.2, 0.0008)
  const padLng = Math.max((maxLng - minLng) * 0.2, 0.0008)
  return [
    [minLat - padLat, minLng - padLng],
    [maxLat + padLat, maxLng + padLng],
  ]
}

export function centroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  )
  return { lat: sum.lat / points.length, lng: sum.lng / points.length }
}

/** Approximate rectangular footprint around a center for overlay grouping. */
export function footprintAround(center: LatLng, sizeMeters = 28): LatLng[] {
  const dLat = sizeMeters / 111_320
  const dLng = sizeMeters / (111_320 * Math.cos((center.lat * Math.PI) / 180))
  return [
    { lat: center.lat - dLat, lng: center.lng - dLng },
    { lat: center.lat - dLat, lng: center.lng + dLng },
    { lat: center.lat + dLat, lng: center.lng + dLng },
    { lat: center.lat + dLat, lng: center.lng - dLng },
  ]
}

export function buildingCentroids(buildings: Building[], locations: Location[]) {
  return buildings
    .map((building) => {
      const points = locations.filter((location) => location.buildingId === building.id)
      const center = centroid(points.map((point) => ({ lat: point.latitude, lng: point.longitude })))
      if (!center) return null
      const elev =
        points.reduce((sum, point) => sum + point.elevation, 0) / Math.max(points.length, 1)
      return {
        building,
        center,
        elevation: elev,
        locations: points,
        ring: footprintAround(center, 34 + building.floors * 0.4),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}

export function floorPoints(floor: Floor, locations: Location[]) {
  return locations.filter((location) => location.floorId === floor.id)
}

export function nearestEntry(locations: Location[]): Location | null {
  const entries = locations.filter((location) => location.type === 'Entry' || location.type === 'Lobby')
  return entries[0] ?? locations[0] ?? null
}

export function routePath(from: Location, to: Location, locations: Location[]): Location[] {
  if (from.id === to.id) return [from]

  const path: Location[] = [from]

  // Climb hierarchy when moving between buildings/complexes via lobby/entry hubs
  if (from.buildingId !== to.buildingId) {
    const fromHub =
      locations.find(
        (location) =>
          location.buildingId === from.buildingId &&
          (location.type === 'Lobby' || location.type === 'Entry'),
      ) ?? from
    const toHub =
      locations.find(
        (location) =>
          location.buildingId === to.buildingId &&
          (location.type === 'Lobby' || location.type === 'Entry'),
      ) ?? to
    if (fromHub.id !== from.id) path.push(fromHub)
    if (toHub.id !== fromHub.id) path.push(toHub)
    if (to.id !== toHub.id) path.push(to)
    return path
  }

  if (from.floorId !== to.floorId) {
    const elevator =
      locations.find(
        (location) =>
          location.buildingId === from.buildingId &&
          (location.type === 'Elevator' || location.type === 'Stairs'),
      ) ?? null
    if (elevator && elevator.id !== from.id) path.push(elevator)
    if (elevator && elevator.id !== to.id) {
      // same vertical core, then destination floor target
      path.push({ ...elevator, floorId: to.floorId, floorLabel: to.floorLabel, elevation: to.elevation })
    }
    path.push(to)
    return path
  }

  path.push(to)
  return path
}

export function formatCoord(value: number, digits = 5) {
  return value.toFixed(digits)
}
