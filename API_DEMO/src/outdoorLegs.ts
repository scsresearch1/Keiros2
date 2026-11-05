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

/** Already at the entry door — skip long outdoor drive. */
export const AT_ENTRANCE_M = 40
/** Entry door → unit pin: always walk (never drive onto the building). */
export const ENTRANCE_TO_UNIT_WALK_M = 6

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
 * Outdoor:
 * 1) Drive origin → entry door (closest driveable, then walk to door if needed)
 * 2) Walk entry door → unit pin when they differ (red dots) — never drive E→D
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

  const toEntranceM = Math.round(metersBetween(origin, entrance))
  const entranceToUnitM = Math.round(metersBetween(entrance, unit))

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

  const legs: OutdoorLeg[] = []

  if (toEntranceM > AT_ENTRANCE_M) {
    legs.push({
      id: 'drive-to-entry-door',
      mode: 'DRIVE',
      from: origin,
      to: entrance,
      label: 'Drive to entry door',
      color: DRIVE_COLOR,
    })
  }

  // Connect Entry (E) → Destination unit (D) on foot — this was missing / wrongly driven.
  if (entranceToUnitM > ENTRANCE_TO_UNIT_WALK_M) {
    legs.push({
      id: 'walk-entry-to-unit',
      mode: 'WALK',
      from: entrance,
      to: unit,
      label: 'Walk entry door → unit',
      color: WALK_COLOR,
    })
  }

  return {
    legs,
    waypoints,
    policy:
      legs.length === 0
        ? 'at-entry-door'
        : legs.some((l) => l.mode === 'DRIVE') && legs.some((l) => l.mode === 'WALK')
          ? 'drive-to-entry-then-walk-to-unit'
          : legs[0]?.mode === 'WALK'
            ? 'walk-entry-to-unit'
            : 'drive-to-entry-door',
    toEntranceM,
  }
}
