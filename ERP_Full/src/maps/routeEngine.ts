import type { Location, Route, RouteStatus } from '../data/erpData'
import { routePath } from './geo'

export type ManagedRoute = Route & {
  fromLocationId: string
  toLocationId: string
}

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathDistanceMeters(stops: Location[]) {
  let sum = 0
  for (let i = 1; i < stops.length; i += 1) {
    sum += haversineMeters(stops[i - 1], stops[i])
    const elevDiff = Math.abs(stops[i].elevation - stops[i - 1].elevation)
    sum += elevDiff * 0.35
  }
  return sum
}

export function estimateWalkMinutes(distanceM: number, floorChanges: number, accessible: boolean) {
  const speedMps = accessible ? 1.05 : 1.25
  const floorPenalty = floorChanges * (accessible ? 0.85 : 0.55)
  return Math.round(((distanceM / speedMps) / 60 + floorPenalty) * 10) / 10
}

export function locationsForPropertyId(propertyId: string, all: Location[]): Location[] {
  return all.filter((loc) => loc.propertyId === propertyId)
}

export function locationsForProperty(propertyNameOrId: string, all: Location[]) {
  const byId = locationsForPropertyId(propertyNameOrId, all)
  if (byId.length) return byId
  const byName = all.filter(
    (loc) =>
      loc.complexName === propertyNameOrId ||
      (!loc.complexId && loc.buildingName === propertyNameOrId),
  )
  if (!byName.length) return byName
  const propertyIds = new Set(byName.map((loc) => loc.propertyId))
  return all.filter((loc) => propertyIds.has(loc.propertyId))
}

export function findLocationInProperty(propertyNameOrId: string, name: string, all: Location[]) {
  const pool = locationsForProperty(propertyNameOrId, all)
  return (
    pool.find((loc) => loc.name === name) ??
    pool.find((loc) => loc.name.toLowerCase().includes(name.toLowerCase())) ??
    all.find((loc) => loc.name === name) ??
    null
  )
}

export function resolveRouteEndpoints(route: Route, all: Location[]) {
  if (route.fromLocationId && route.toLocationId) {
    const from = all.find((loc) => loc.id === route.fromLocationId) ?? null
    const to = all.find((loc) => loc.id === route.toLocationId) ?? null
    if (from && to) return { from, to }
  }
  return { from: null, to: null }
}

export function accessibleRoutePath(from: Location, to: Location, all: Location[], accessible: boolean) {
  const path = routePath(from, to, all)
  if (!accessible) return path
  return path.map((stop) => {
    if (stop.type !== 'Stairs') return stop
    const elev =
      all.find(
        (loc) =>
          loc.buildingId === stop.buildingId &&
          loc.floorId === stop.floorId &&
          loc.type === 'Elevator',
      ) ??
      all.find((loc) => loc.buildingId === stop.buildingId && loc.type === 'Elevator')
    return elev ?? stop
  })
}

export function computeRouteStats(from: Location, to: Location, all: Location[], accessible = false) {
  const stops = accessibleRoutePath(from, to, all, accessible)
  const distanceM = pathDistanceMeters(stops)
  const floorCount = new Set(stops.map((s) => s.floorId)).size
  const floorChanges = Math.max(0, floorCount - 1)
  const durationMin = estimateWalkMinutes(distanceM, floorChanges, accessible)
  return {
    stops,
    waypoints: stops.length,
    distanceM: Math.round(distanceM),
    floors: floorCount,
    floorChanges,
    durationMin,
  }
}

export type { RouteStatus }

export function hydrateRoutes(seed: Route[], all: Location[]): ManagedRoute[] {
  return seed.map((route) => {
    const { from, to } = resolveRouteEndpoints(route, all)
    if (!from || !to) {
      return {
        ...route,
        fromLocationId: route.fromLocationId ?? '',
        toLocationId: route.toLocationId ?? '',
      }
    }
    const stats = computeRouteStats(from, to, all, false)
    return {
      ...route,
      fromLocationId: from.id,
      toLocationId: to.id,
      waypoints: stats.waypoints,
      avgDurationMin: route.status === 'Draft' && route.avgDurationMin === 0 ? 0 : stats.durationMin,
    }
  })
}

export function buildRouteName(from: Location, to: Location) {
  return `${from.name} to ${to.name}`
}

export function propertyLabelForLocation(loc: Location) {
  return loc.complexName ?? loc.buildingName ?? ''
}

export function nextRouteId(existing: Route[]) {
  const nums = existing.map((r) => Number(r.id.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n))
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `rt-${String(next).padStart(3, '0')}`
}

export const routeStatuses: RouteStatus[] = ['Active', 'Draft', 'Disabled']

