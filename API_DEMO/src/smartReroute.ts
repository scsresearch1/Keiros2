import type { JourneyStep, NavigateResult } from './api'
import { fetchRoadRoute } from './googleRoute'
import { AT_ENTRANCE_M, metersBetween, resolveOutdoorLegs } from './outdoorLegs'

type LatLng = { latitude: number; longitude: number }

function toLit(p: LatLng) {
  return { lat: p.latitude, lng: p.longitude }
}

function pathToGeoJson(path: { lat: number; lng: number }[]): [number, number][] {
  return path.map((p) => [p.lng, p.lat])
}

/**
 * Recalculate from live GPS using Google Routes map networks:
 * DRIVE → roads / driveways, WALK → sidewalks / paths.
 * Mode follows the current journey phase + outdoor plan (not crow-fly distance).
 */
export async function rerouteFromLiveFix(
  result: NavigateResult,
  fix: LatLng,
): Promise<NavigateResult | null> {
  const indoor = result.journey.steps.filter((s) => s.phase === 'indoor')
  const phaseNow =
    result.journey.steps.find((s) => s.phase === 'drive' || s.phase === 'outdoor' || s.phase === 'walk')
      ?.phase ?? 'drive'

  const plan = resolveOutdoorLegs({
    ...result,
    origin: {
      ...result.origin,
      latitude: fix.latitude,
      longitude: fix.longitude,
    },
  })

  const entrance: LatLng = {
    latitude: result.entrance?.latitude ?? result.destination.latitude,
    longitude: result.entrance?.longitude ?? result.destination.longitude,
  }
  const parking: LatLng | null = result.parking
    ? { latitude: result.parking.latitude, longitude: result.parking.longitude }
    : null

  const atDoor = metersBetween(toLit(fix), toLit(entrance)) <= AT_ENTRANCE_M
  const walking =
    atDoor ||
    phaseNow === 'walk' ||
    plan.policy.includes('walk') ||
    !result.outdoor.steps?.length ||
    /on-site/i.test(result.outdoor.provider || '')

  try {
    if (walking) {
      const route = await fetchRoadRoute(toLit(fix), toLit(entrance), 'WALK')
      const walkSteps = route.steps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      const steps = [
        ...walkSteps,
        ...indoor.map((s, i) => ({ ...s, index: walkSteps.length + i })),
      ]
      return {
        ...result,
        outdoor: {
          ...result.outdoor,
          provider: 'Google Routes map (walk paths)',
          distanceM: 0,
          distanceMiles: 0,
          durationMinutes: 0,
          geometry: { type: 'LineString', coordinates: [[fix.longitude, fix.latitude]] },
          steps: [],
          traffic: {
            ...result.outdoor.traffic,
            note: 'Recalculated on Google pedestrian paths / sidewalks.',
            updatedAt: new Date().toISOString(),
          },
        },
        walk: {
          provider: 'Google Routes',
          distanceM: route.distanceM,
          distanceMiles: Math.round((route.distanceM / 1609.344) * 10) / 10,
          durationMinutes: Math.round((route.durationSec / 60) * 10) / 10,
          geometry: { type: 'LineString', coordinates: pathToGeoJson(route.path) },
          steps: walkSteps,
        },
        journey: {
          ...result.journey,
          totalSteps: steps.length,
          driveSteps: 0,
          outdoorSteps: 0,
          walkSteps: walkSteps.length,
          steps,
          summary: 'Recalculated walking route on map pathways.',
        },
      }
    }

    const driveTarget: LatLng =
      plan.legs.find((l) => l.mode === 'DRIVE') != null && parking
        ? parking
        : entrance
    const route = await fetchRoadRoute(toLit(fix), toLit(driveTarget), 'DRIVE')
    const driveSteps = route.steps.map((s, i) => ({
      ...s,
      index: i,
      phase: 'drive' as const,
    })) as JourneyStep[]

    let walkSteps = result.journey.steps.filter((s) => s.phase === 'walk')
    if (parking && metersBetween(toLit(driveTarget), toLit(entrance)) > 25) {
      try {
        const foot = await fetchRoadRoute(toLit(parking), toLit(entrance), 'WALK')
        walkSteps = foot.steps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      } catch {
        /* keep previous walk steps */
      }
    }

    const steps = [
      ...driveSteps,
      ...walkSteps.map((s, i) => ({ ...s, index: driveSteps.length + i, phase: 'walk' as const })),
      ...indoor.map((s, i) => ({ ...s, index: driveSteps.length + walkSteps.length + i })),
    ]

    return {
      ...result,
      outdoor: {
        ...result.outdoor,
        provider: 'Google Routes map (roads)',
        distanceM: route.distanceM,
        distanceMiles: Math.round((route.distanceM / 1609.344) * 10) / 10,
        durationMinutes: Math.round((route.durationSec / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates: pathToGeoJson(route.path) },
        steps: driveSteps,
        traffic: {
          ...result.outdoor.traffic,
          note: 'Recalculated on Google roads / driveways.',
          updatedAt: new Date().toISOString(),
        },
      },
      walk: walkSteps.length
        ? {
            provider: 'Google Routes',
            distanceM: walkSteps.reduce((n, s) => n + (s.distanceM || 0), 0),
            distanceMiles: 0,
            durationMinutes: 0,
            geometry: {
              type: 'LineString',
              coordinates: walkSteps.flatMap((s) => s.geometry ?? []),
            },
            steps: walkSteps,
          }
        : result.walk,
      journey: {
        ...result.journey,
        totalSteps: steps.length,
        driveSteps: driveSteps.length,
        outdoorSteps: driveSteps.length,
        walkSteps: walkSteps.length,
        steps,
        summary: 'Recalculated driving route on map roads.',
      },
    }
  } catch {
    return null
  }
}
