/**
 * Pedestrian routing — NEW strategy (not kerb-offset / not Google-centerline hacks).
 *
 * Industry approach (OSRM foot / ORS foot-walking / GraphHopper foot):
 * route on the OSM *pedestrian network* (footways, paths, residential with foot
 * access). Never invent sidewalks by shifting a drive polyline sideways — that
 * cuts through buildings (what we just saw).
 *
 * Primary: OSRM public foot profile (proven for Hyderabad).
 * Fallback: Google Routes WALK (beta — may still hug roads; no geometric offset).
 */

import type { JourneyStep } from './api'
import { fetchRoadRouteLive } from './googleRoute'

export type PedestrianRoute = {
  path: google.maps.LatLngLiteral[]
  distanceM: number
  durationSec: number
  steps: JourneyStep[]
  provider: string
}

type OsrmStep = {
  name?: string
  maneuver?: { type?: string; modifier?: string; location?: [number, number] }
  distance?: number
  duration?: number
  geometry?: { coordinates?: [number, number][] }
}

type OsrmRoute = {
  distance: number
  duration: number
  geometry: { coordinates: [number, number][] }
  legs?: { steps?: OsrmStep[] }[]
}

/** Foot-only bases — never fall back to driving profile. */
const FOOT_BASES = [
  'https://router.project-osrm.org/route/v1/foot',
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
]

function metersBetween(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function instructionFromOsrm(step: OsrmStep): string {
  const type = (step.maneuver?.type || '').toLowerCase()
  const mod = (step.maneuver?.modifier || '').toLowerCase()
  const road = step.name?.trim()
  const onto = road ? ` onto ${road}` : ''
  if (type === 'depart') return road ? `Walk along ${road}` : 'Start walking'
  if (type === 'arrive') return 'Arrive at your destination'
  if (type === 'turn' || type === 'end of road') {
    if (mod.includes('left')) return `Turn left${onto}`
    if (mod.includes('right')) return `Turn right${onto}`
    return `Continue${onto}`
  }
  if (type === 'new name' || type === 'continue') return road ? `Continue on ${road}` : 'Continue straight'
  if (type === 'fork') {
    if (mod.includes('left')) return `Keep left${onto}`
    if (mod.includes('right')) return `Keep right${onto}`
  }
  if (type === 'roundabout' || type === 'rotary') return `At the roundabout${onto}`
  return road ? `Walk on ${road}` : 'Continue on the footpath'
}

function stepsFromOsrm(route: OsrmRoute): JourneyStep[] {
  const raw = route.legs?.[0]?.steps ?? []
  if (!raw.length) {
    const start = route.geometry.coordinates[0]
    const end = route.geometry.coordinates[route.geometry.coordinates.length - 1]
    return [
      {
        id: 'osrm-foot-0',
        phase: 'walk',
        index: 0,
        instruction: 'Walk on pedestrian paths toward your destination',
        latitude: start?.[1] ?? 0,
        longitude: start?.[0] ?? 0,
        distanceM: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        geometry: route.geometry.coordinates,
      },
      {
        id: 'osrm-foot-arrive',
        phase: 'walk',
        index: 1,
        instruction: 'Arrive at your destination',
        latitude: end?.[1] ?? 0,
        longitude: end?.[0] ?? 0,
        distanceM: 0,
        durationSec: 0,
        geometry: end ? [end] : [],
      },
    ]
  }
  return raw.map((step, index) => {
    const loc = step.maneuver?.location
    const coords = step.geometry?.coordinates?.length
      ? step.geometry.coordinates
      : loc
        ? [loc]
        : []
    return {
      id: `osrm-foot-${index}`,
      phase: 'walk' as const,
      index,
      instruction: instructionFromOsrm(step),
      latitude: loc?.[1] ?? coords[0]?.[1] ?? 0,
      longitude: loc?.[0] ?? coords[0]?.[0] ?? 0,
      distanceM: Math.round(step.distance ?? 0),
      durationSec: Math.round(step.duration ?? 0),
      geometry: coords,
    }
  })
}

async function fetchOsrmFoot(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
): Promise<PedestrianRoute> {
  let lastErr: Error | null = null
  for (const base of FOOT_BASES) {
    try {
      const url =
        `${base}/` +
        `${from.lng},${from.lat};${to.lng},${to.lat}` +
        `?overview=full&geometries=geojson&steps=true`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM foot ${res.status}`)
      const json = (await res.json()) as { routes?: OsrmRoute[]; message?: string }
      const route = json.routes?.[0]
      if (!route?.geometry?.coordinates?.length) {
        throw new Error(json.message || 'No foot route')
      }
      const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
      if (path.length < 2) throw new Error('Foot route too short')
      // Reject absurd straight chords (engine failure) — prefer Google instead.
      const crow = metersBetween(from, to)
      if (crow > 40 && route.distance < crow * 0.85) {
        throw new Error('Foot route shorter than crow-flies — rejecting')
      }
      return {
        path,
        distanceM: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        steps: stepsFromOsrm(route),
        provider: 'OSRM foot (pedestrian network)',
      }
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastErr ?? new Error('OSRM foot unavailable')
}

/**
 * Route for walking: OSRM pedestrian network first, Google WALK only as fallback.
 * No geometric kerb offsets — those cut through buildings.
 */
export async function fetchPedestrianRoute(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
): Promise<PedestrianRoute> {
  try {
    return await fetchOsrmFoot(from, to)
  } catch {
    const g = await fetchRoadRouteLive(from, to, 'WALK')
    return {
      path: g.path,
      distanceM: g.distanceM,
      durationSec: g.durationSec,
      steps: g.steps.map((s) => ({ ...s, phase: 'walk' as const })),
      provider: 'Google Routes WALK (fallback)',
    }
  }
}
