import type { NavigateResult } from './api'
import type { RouteTravelMode } from './googleRoute'

export type LatLngLit = { lat: number; lng: number }

export type OutdoorLeg = {
  id: string
  mode: RouteTravelMode
  from: LatLngLit
  to: LatLngLit
  label: string
  color: string
}

export type OutdoorWaypoint = {
  kind: 'parking' | 'entrance'
  position: LatLngLit
  label: string
  fill: string
}

export type OutdoorPlan = {
  legs: OutdoorLeg[]
  waypoints: OutdoorWaypoint[]
  policy: string
  toEntranceM: number
}

/** Already at the destination pin — no outdoor route. */
export const AT_DESTINATION_M = 25

export const DRIVE_COLOR = '#1a73e8'
export const WALK_COLOR = '#0d9488'

/** @deprecated use AT_DESTINATION_M — kept for smartReroute import */
export const AT_ENTRANCE_M = 40

export function metersBetween(a: LatLngLit, b: LatLngLit) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function lit(lat: number, lng: number): LatLngLit {
  return { lat: Number(lat), lng: Number(lng) }
}

/**
 * Outdoor goal = the actual destination coordinate (unit / D).
 *
 * Default plan (before OSM driveway extract):
 * walk origin → D. Driveway drive is decided in OutdoorMap after extract:
 *   driveway near D → drive onto it, then walk to exact D
 *   no driveway → walk to D
 *
 * Entry door (E) is shown as a waypoint only — never the drive target that
 * sends the blue line away from D.
 */
export function resolveOutdoorLegs(result: NavigateResult): OutdoorPlan {
  const origin = lit(result.origin.latitude, result.origin.longitude)
  const unit = lit(
    Number(result.destination.latitude ?? result.selection?.unit?.latitude),
    Number(result.destination.longitude ?? result.selection?.unit?.longitude),
  )
  const entrance = result.entrance
    ? lit(result.entrance.latitude, result.entrance.longitude)
    : unit

  const toDestM = Math.round(metersBetween(origin, unit))
  const toEntranceM = Math.round(metersBetween(origin, entrance))

  const waypoints: OutdoorWaypoint[] = [
    {
      kind: 'entrance',
      position: entrance,
      label: result.entrance?.label || 'Entry door',
      fill: '#22c55e',
    },
  ]

  if (
    result.parking &&
    Number.isFinite(result.parking.latitude) &&
    Number.isFinite(result.parking.longitude) &&
    metersBetween(origin, lit(result.parking.latitude, result.parking.longitude)) > 40
  ) {
    waypoints.unshift({
      kind: 'parking',
      position: lit(result.parking.latitude, result.parking.longitude),
      label: result.parking.label || 'Parking',
      fill: '#a855f7',
    })
  }

  const legs: OutdoorLeg[] = []
  if (toDestM > AT_DESTINATION_M) {
    legs.push({
      id: 'walk-to-destination',
      mode: 'WALK',
      from: origin,
      to: unit,
      label: 'Walk to destination (no driveway yet)',
      color: WALK_COLOR,
    })
  }

  return {
    legs,
    waypoints,
    policy: legs.length === 0 ? 'at-destination' : 'walk-to-destination',
    toEntranceM,
  }
}
