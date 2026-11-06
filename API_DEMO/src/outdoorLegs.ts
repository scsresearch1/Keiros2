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
  /** True when Navigate used Via parking and a real parking stop exists. */
  viaParking: boolean
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

function isRealParkingStop(result: NavigateResult, origin: LatLngLit): LatLngLit | null {
  const p = result.parking
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
  const label = p.label || ''
  // Client on-site shortcuts — not a drive-to-parking stop.
  if (/already on site|start here|walk to entrance/i.test(label)) return null
  const pos = lit(p.latitude, p.longitude)
  if (metersBetween(origin, pos) <= 40) return null
  // Only when Navigate "Via parking" is on (stamped on origin by the demo app).
  if (result.origin.viaParking !== true) return null
  // Prefer Keiros DB parking (mode=database); still accept server parking when stamped viaParking.
  return pos
}

/**
 * Outdoor legs:
 * - Via parking: drive → lot, then walk pathways to the unit/building
 * - Indoor continues: drive → entrance/curb, then WALK to the unit (brown-building D)
 * - Otherwise: drive toward the unit pin
 *
 * Walk must stay a separate leg whenever indoor continues — otherwise Google drive
 * snaps onto the unit pin on asphalt and the red walk dots disappear.
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

  const indoorContinues = Boolean(
    result.entrance &&
      ((result.map3d?.routeStops?.length ?? 0) > 1 || metersBetween(entrance, unit) > 8),
  )

  const toEntranceM = Math.round(metersBetween(origin, unit))
  const parking = isRealParkingStop(result, origin)
  const viaParking = Boolean(parking)

  const waypoints: OutdoorWaypoint[] = []
  if (parking) {
    waypoints.push({
      kind: 'parking',
      position: parking,
      label: result.parking?.label || 'Parking',
      fill: '#a855f7',
    })
  }
  if (indoorContinues && metersBetween(entrance, unit) > 5) {
    waypoints.push({
      kind: 'entrance',
      position: entrance,
      label: result.entrance?.label || 'Entry door',
      fill: '#22c55e',
    })
  }

  const legs: OutdoorLeg[] = []

  if (viaParking && parking) {
    legs.push({
      id: 'drive-to-parking',
      mode: 'DRIVE',
      from: origin,
      to: parking,
      label: 'Drive to parking',
      color: DRIVE_COLOR,
    })
    if (metersBetween(parking, unit) > 8) {
      legs.push({
        id: 'walk-parking-to-destination',
        mode: 'WALK',
        from: parking,
        to: unit,
        label: 'Walk pathways to destination',
        color: WALK_COLOR,
      })
    }
  } else if (indoorContinues) {
    // Drive to the door approach, then always walk to the unit pin (brown building).
    if (metersBetween(origin, entrance) > AT_DESTINATION_M) {
      legs.push({
        id: 'drive-to-entrance',
        mode: 'DRIVE',
        from: origin,
        to: entrance,
        label: 'Drive to entrance',
        color: DRIVE_COLOR,
      })
    } else if (metersBetween(origin, entrance) > 8) {
      legs.push({
        id: 'walk-to-entrance',
        mode: 'WALK',
        from: origin,
        to: entrance,
        label: 'Walk to entrance',
        color: WALK_COLOR,
      })
    }
    if (metersBetween(entrance, unit) > 5) {
      legs.push({
        id: 'walk-entrance-to-unit',
        mode: 'WALK',
        from: entrance,
        to: unit,
        label: 'Walk to door / unit',
        color: WALK_COLOR,
      })
    } else if (!legs.some((l) => l.mode === 'WALK') && metersBetween(origin, unit) > 8) {
      // Entrance ≈ unit — still force a short walk finish onto the building pin.
      legs.push({
        id: 'walk-to-destination',
        mode: 'WALK',
        from: legs.length ? legs[legs.length - 1].to : origin,
        to: unit,
        label: 'Walk to destination',
        color: WALK_COLOR,
      })
    }
  } else if (metersBetween(origin, unit) > AT_DESTINATION_M) {
    legs.push({
      id: 'drive-to-destination',
      mode: 'DRIVE',
      from: origin,
      to: unit,
      label: 'Drive toward destination',
      color: DRIVE_COLOR,
    })
  } else if (metersBetween(origin, unit) > 8) {
    legs.push({
      id: 'walk-to-destination',
      mode: 'WALK',
      from: origin,
      to: unit,
      label: 'Walk to destination',
      color: WALK_COLOR,
    })
  }

  return {
    legs,
    waypoints,
    viaParking,
    policy: viaParking
      ? 'drive-to-parking-then-walk-pathways'
      : legs.length === 0
        ? 'at-destination'
        : indoorContinues
          ? 'drive-to-entrance-then-walk-to-unit'
          : 'drive-then-walk-to-destination',
    toEntranceM,
  }
}
