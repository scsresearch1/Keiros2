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
  /** How legs were structured (journey / parking — not crow-fly distance). */
  policy: string
  /** Crow-fly meters origin → entrance (zoom hint only, not mode choice). */
  toEntranceM: number
}

/** GPS noise / “already at the door” only — not a walk-vs-drive rule. */
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

function samePoint(a: LatLngLit, b: LatLngLit, tolM = 25) {
  return metersBetween(a, b) <= tolM
}

function driveLeg(from: LatLngLit, to: LatLngLit, id: string): OutdoorLeg {
  return {
    id,
    mode: 'DRIVE',
    from,
    to,
    // Google Routes DRIVE snaps to the map road / driveway graph.
    label: 'Drive on map roads / driveways',
    color: DRIVE_COLOR,
  }
}

function walkLeg(from: LatLngLit, b: LatLngLit, id: string): OutdoorLeg {
  return {
    id,
    mode: 'WALK',
    from,
    to: b,
    // Google Routes WALK snaps to the map sidewalk / footpath graph.
    label: 'Walk on map sidewalks / paths',
    color: WALK_COLOR,
  }
}

/**
 * Build outdoor legs from the journey + parking/entrance on the map.
 *
 * Mode is NOT chosen by crow-fly distance (no “≤900 m → walk”).
 * - DRIVE legs → Google Routes follows roads & driveways on the basemap
 * - WALK legs → Google Routes follows sidewalks & pedestrian paths on the basemap
 *
 * Structure follows navigate phases / parking stop when present.
 */
export function resolveOutdoorLegs(result: NavigateResult): OutdoorPlan {
  const origin = lit(result.origin.latitude, result.origin.longitude)
  const destination = lit(
    Number(result.destination.latitude ?? result.selection?.unit?.latitude),
    Number(result.destination.longitude ?? result.selection?.unit?.longitude),
  )
  const entrance = result.entrance
    ? lit(result.entrance.latitude, result.entrance.longitude)
    : destination
  const parking =
    result.parking &&
    Number.isFinite(result.parking.latitude) &&
    Number.isFinite(result.parking.longitude)
      ? lit(result.parking.latitude, result.parking.longitude)
      : null

  const toEntranceM = Math.round(metersBetween(origin, entrance))
  const arrival = String(result.outdoor.arrivalMode || result.parking?.mode || '').toLowerCase()
  const provider = String(result.outdoor.provider || '')
  const hasDriveSteps = result.journey.steps.some((s) => s.phase === 'drive' || s.phase === 'outdoor')
  const hasWalkSteps =
    result.journey.steps.some((s) => s.phase === 'walk') ||
    (result.walk?.geometry?.coordinates?.length ?? 0) > 1
  const viaParking = Boolean(result.origin.viaParking)

  const entranceWp: OutdoorWaypoint = {
    kind: 'entrance',
    position: entrance,
    label: result.entrance?.label || 'Building entrance',
    fill: '#22c55e',
  }

  // Already at the door (GPS / arrival flag) — no outdoor polyline needed.
  if (arrival.includes('at-entrance') || toEntranceM <= AT_ENTRANCE_M) {
    return {
      legs: [],
      waypoints: [entranceWp],
      policy: 'at-entrance',
      toEntranceM,
    }
  }

  const parkingIsRealStop =
    parking &&
    !samePoint(parking, origin, 40) &&
    (viaParking ||
      arrival.includes('drive-park') ||
      (hasDriveSteps && hasWalkSteps) ||
      (hasDriveSteps && Boolean(parking)))

  // Drive on map roads/driveways to parking, then walk map pathways to the door.
  if (parking && parkingIsRealStop) {
    return {
      legs: [
        driveLeg(origin, parking, 'drive-to-parking'),
        walkLeg(parking, entrance, 'walk-to-entrance'),
      ],
      waypoints: [
        {
          kind: 'parking',
          position: parking,
          label: result.parking?.label || 'Parking',
          fill: '#a855f7',
        },
        entranceWp,
      ],
      policy: 'drive-park-walk-map',
      toEntranceM,
    }
  }

  // Journey / server says pedestrian only — walk the map pathway network.
  const walkOnly =
    arrival.includes('walk-from-origin') ||
    arrival.includes('on-site') ||
    /on-site/i.test(provider) ||
    (!hasDriveSteps && hasWalkSteps)

  if (walkOnly) {
    return {
      legs: [walkLeg(origin, entrance, 'walk-to-entrance')],
      waypoints: [entranceWp],
      policy: 'walk-map-paths',
      toEntranceM,
    }
  }

  // Drive-only outdoor journey — follow map roads to the entrance.
  if (hasDriveSteps && !hasWalkSteps) {
    return {
      legs: [driveLeg(origin, entrance, 'drive-to-entrance')],
      waypoints: [entranceWp],
      policy: 'drive-map-roads',
      toEntranceM,
    }
  }

  // Ambiguous point-to-point: still use map networks — drive roads to entrance.
  // (OutdoorMap may refine with Google DRIVE vs WALK comparison from routed lengths.)
  return {
    legs: [driveLeg(origin, entrance, 'drive-to-entrance')],
    waypoints: [entranceWp],
    policy: 'drive-map-roads',
    toEntranceM,
  }
}
