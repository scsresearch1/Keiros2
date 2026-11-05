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

/** Already at the entry door — outdoor done. */
export const AT_ENTRANCE_M = 40

export const DRIVE_COLOR = '#1a73e8'
export const WALK_COLOR = '#0d9488'

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
 * Outdoor rule (indoor aside):
 * One DRIVE request to the **entry door**.
 * OutdoorMap / planDrivePlusWalk then:
 *   1) Drive on roads/driveways to the **closest driveable point**
 *   2) Walk on sidewalks/paths from that handoff to the **entry door** coordinates
 */
export function resolveOutdoorLegs(result: NavigateResult): OutdoorPlan {
  const origin = lit(result.origin.latitude, result.origin.longitude)
  const unit = lit(
    Number(result.destination.latitude ?? result.selection?.unit?.latitude),
    Number(result.destination.longitude ?? result.selection?.unit?.longitude),
  )
  // Prefer real entry-door coordinates when the API provides them.
  const entrance = result.entrance
    ? lit(result.entrance.latitude, result.entrance.longitude)
    : unit

  const toEntranceM = Math.round(metersBetween(origin, entrance))

  const entranceWp: OutdoorWaypoint = {
    kind: 'entrance',
    position: entrance,
    label: result.entrance?.label || 'Entry door',
    fill: '#22c55e',
  }

  const waypoints: OutdoorWaypoint[] = [entranceWp]
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

  if (toEntranceM <= AT_ENTRANCE_M) {
    return {
      legs: [],
      waypoints,
      policy: 'at-entry-door',
      toEntranceM,
    }
  }

  return {
    legs: [
      {
        id: 'drive-closest-then-walk-to-door',
        mode: 'DRIVE',
        from: origin,
        to: entrance,
        label: 'Drive to closest drive → walk sidewalk to entry door',
        color: DRIVE_COLOR,
      },
    ],
    waypoints,
    policy: 'drive-closest-then-walk-sidewalk-to-door',
    toEntranceM,
  }
}
