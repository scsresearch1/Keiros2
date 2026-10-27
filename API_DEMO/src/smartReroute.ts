import type { JourneyStep, NavigateResult } from './api'

type LatLng = { latitude: number; longitude: number }

type OsrmStep = {
  distance: number
  duration: number
  name?: string
  maneuver: { location: [number, number]; type: string; modifier?: string }
  geometry?: { coordinates: [number, number][] }
}

type OsrmRoute = {
  distance: number
  duration: number
  geometry: { coordinates: [number, number][] }
  legs?: { steps?: OsrmStep[] }[]
}

const DRIVING = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
]
const FOOT = [
  'https://router.project-osrm.org/route/v1/foot',
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  ...DRIVING,
]

async function fetchRoute(bases: string[], from: LatLng, to: LatLng) {
  let last: Error | null = null
  for (const base of bases) {
    try {
      const url =
        `${base}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
        `?overview=full&geometries=geojson&steps=true&continue_straight=true`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM ${res.status}`)
      const json = (await res.json()) as { routes?: OsrmRoute[]; message?: string }
      const route = json.routes?.[0]
      if (!route?.geometry?.coordinates?.length) throw new Error(json.message || 'No route')
      return route
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw last ?? new Error('Reroute failed')
}

function stepsFromOsrm(route: OsrmRoute, phase: 'drive' | 'walk', idPrefix: string): JourneyStep[] {
  const raw = route.legs?.[0]?.steps ?? []
  if (!raw.length) {
    const [lng, lat] = route.geometry.coordinates[0] ?? [0, 0]
    return [
      {
        id: `${idPrefix}-0`,
        phase,
        index: 0,
        instruction: phase === 'walk' ? 'Continue walking' : 'Continue driving',
        latitude: lat,
        longitude: lng,
        distanceM: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        geometry: route.geometry.coordinates,
      },
    ]
  }
  return raw.map((step, index) => {
    const [lng, lat] = step.maneuver.location
    const type = step.maneuver.type.replaceAll('_', ' ')
    const modifier = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : ''
    const road = step.name ? ` onto ${step.name}` : ''
    let instruction = `${type}${modifier}${road}`
    if (step.maneuver.type === 'depart') {
      instruction = phase === 'walk' ? 'Continue on foot' : 'Continue driving'
    }
    if (step.maneuver.type === 'arrive') {
      instruction =
        phase === 'walk'
          ? 'Arrive at building entrance — continue inside'
          : 'Arrive at parking — leave the car and walk'
    }
    return {
      id: `${idPrefix}-${index}`,
      phase,
      index,
      title: `${phase === 'walk' ? 'Walk' : 'Drive'} · Step ${index + 1}`,
      instruction,
      roadName: step.name || null,
      distanceM: Math.round(step.distance),
      durationSec: Math.round(step.duration),
      latitude: lat,
      longitude: lng,
      geometry: step.geometry?.coordinates ?? [],
    }
  })
}

/**
 * Recalculate the remaining outdoor path from the live GPS (Google Maps “recalculating…”).
 */
export async function rerouteFromLiveFix(
  result: NavigateResult,
  fix: LatLng,
): Promise<NavigateResult | null> {
  const indoor = result.journey.steps.filter((s) => s.phase === 'indoor')
  const phaseNow =
    result.journey.steps.find((s) => s.phase === 'drive' || s.phase === 'outdoor' || s.phase === 'walk')
      ?.phase ?? 'drive'
  const walking =
    phaseNow === 'walk' ||
    !result.outdoor.steps?.length ||
    /on-site|walk/i.test(result.outdoor.provider || '')

  const destination: LatLng = walking
    ? {
        latitude: result.entrance?.latitude ?? result.destination.latitude,
        longitude: result.entrance?.longitude ?? result.destination.longitude,
      }
    : {
        latitude: result.parking?.latitude ?? result.entrance?.latitude ?? result.destination.latitude,
        longitude:
          result.parking?.longitude ?? result.entrance?.longitude ?? result.destination.longitude,
      }

  try {
    if (walking) {
      const route = await fetchRoute(FOOT, fix, destination)
      const walkSteps = stepsFromOsrm(route, 'walk', 'wlk')
      const steps = [
        ...walkSteps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const })),
        ...indoor.map((s, i) => ({ ...s, index: walkSteps.length + i })),
      ]
      return {
        ...result,
        outdoor: {
          ...result.outdoor,
          provider: 'OSRM live recalculation',
          distanceM: 0,
          distanceMiles: 0,
          durationMinutes: 0,
          geometry: { type: 'LineString', coordinates: [[fix.longitude, fix.latitude]] },
          steps: [],
          traffic: {
            ...result.outdoor.traffic,
            note: 'Route recalculated from your live location (walking).',
            updatedAt: new Date().toISOString(),
          },
        },
        walk: {
          provider: 'OSRM live recalculation',
          distanceM: Math.round(route.distance),
          distanceMiles: Math.round((route.distance / 1609.344) * 10) / 10,
          durationMinutes: Math.round((route.duration / 60) * 10) / 10,
          geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
          steps: walkSteps,
        },
        journey: {
          ...result.journey,
          totalSteps: steps.length,
          driveSteps: 0,
          outdoorSteps: 0,
          walkSteps: walkSteps.length,
          steps,
          summary: 'Recalculated walking route from your location.',
        },
      }
    }

    const route = await fetchRoute(DRIVING, fix, destination)
    const driveSteps = stepsFromOsrm(route, 'drive', 'drv')
    const walkSteps = result.journey.steps.filter((s) => s.phase === 'walk')
    const steps = [
      ...driveSteps,
      ...walkSteps.map((s, i) => ({ ...s, index: driveSteps.length + i, phase: 'walk' as const })),
      ...indoor.map((s, i) => ({ ...s, index: driveSteps.length + walkSteps.length + i })),
    ]
    return {
      ...result,
      outdoor: {
        ...result.outdoor,
        provider: 'OSRM live recalculation',
        distanceM: Math.round(route.distance),
        distanceMiles: Math.round((route.distance / 1609.344) * 10) / 10,
        durationMinutes: Math.round((route.duration / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
        steps: driveSteps,
        traffic: {
          ...result.outdoor.traffic,
          note: 'Route recalculated from your live location (driving).',
          updatedAt: new Date().toISOString(),
        },
      },
      journey: {
        ...result.journey,
        totalSteps: steps.length,
        driveSteps: driveSteps.length,
        outdoorSteps: driveSteps.length,
        walkSteps: walkSteps.length,
        steps,
        summary: 'Recalculated driving route from your location.',
      },
    }
  } catch {
    return null
  }
}
