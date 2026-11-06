import type { JourneyStep, NavigateResult } from './api'
import { fetchRoadRoute } from './googleRoute'
import { AT_ENTRANCE_M, metersBetween } from './outdoorLegs'

type LatLng = { latitude: number; longitude: number }

function toLit(p: LatLng) {
  return { lat: p.latitude, lng: p.longitude }
}

function pathToGeoJson(path: { lat: number; lng: number }[]): [number, number][] {
  return path.map((p) => [p.lng, p.lat])
}

function isDbParking(result: NavigateResult) {
  const p = result.parking
  if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return false
  if (/already on site|start here|walk to entrance/i.test(p.label || '')) return false
  return result.origin.viaParking === true || p.mode === 'database' || p.mode === 'drive-park-walk'
}

export type RerouteOptions = {
  /** Current journey step phase — more reliable than first outdoor step. */
  phaseHint?: string | null
}

/**
 * Google-class recalculation from live GPS:
 * - Drive: traffic-aware roads to parking (if Via parking) or destination
 * - Walk: pedestrian paths for the last mile
 * - Always stamps new origin so the outdoor map redraws the blue/red path
 */
export async function rerouteFromLiveFix(
  result: NavigateResult,
  fix: LatLng,
  opts?: RerouteOptions,
): Promise<NavigateResult | null> {
  const indoor = result.journey.steps.filter((s) => s.phase === 'indoor')
  const phaseHint = opts?.phaseHint
  const phaseNow =
    phaseHint === 'walk' || phaseHint === 'drive' || phaseHint === 'outdoor'
      ? phaseHint
      : (result.journey.steps.find((s) => s.phase === 'drive' || s.phase === 'outdoor' || s.phase === 'walk')
          ?.phase ?? 'drive')

  const entrance: LatLng = {
    latitude: result.entrance?.latitude ?? result.destination.latitude,
    longitude: result.entrance?.longitude ?? result.destination.longitude,
  }
  const unitDest: LatLng = {
    latitude: result.destination.latitude,
    longitude: result.destination.longitude,
  }
  // Outdoor re-route aims at the door when indoor continues (Fig Garden / Orion style).
  const indoorContinues =
    Boolean(result.entrance) &&
    ((result.map3d?.routeStops?.length ?? 0) > 1 ||
      metersBetween(toLit(entrance), toLit(unitDest)) > 8)
  const dest: LatLng = indoorContinues ? entrance : unitDest
  const parking = isDbParking(result)
    ? {
        latitude: result.parking!.latitude,
        longitude: result.parking!.longitude,
      }
    : null

  const atDoor = metersBetween(toLit(fix), toLit(entrance)) <= AT_ENTRANCE_M
  const pastParking =
    parking != null && metersBetween(toLit(fix), toLit(parking)) <= 55 && phaseNow === 'walk'
  const walking =
    atDoor ||
    phaseNow === 'walk' ||
    pastParking ||
    (!result.outdoor.steps?.length && phaseNow !== 'drive' && phaseNow !== 'outdoor')

  const stampedOrigin = {
    ...result.origin,
    latitude: fix.latitude,
    longitude: fix.longitude,
    label: result.origin.label || 'Current location',
  }

  try {
    if (walking) {
      const walkTarget = dest
      const route = await fetchRoadRoute(toLit(fix), toLit(walkTarget), 'WALK')
      const walkSteps = route.steps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      const steps = [
        ...walkSteps,
        ...indoor.map((s, i) => ({ ...s, index: walkSteps.length + i })),
      ]
      return {
        ...result,
        origin: stampedOrigin,
        outdoor: {
          ...result.outdoor,
          provider: 'Google Routes (live recalculate · walk)',
          distanceM: 0,
          distanceMiles: 0,
          durationMinutes: 0,
          geometry: { type: 'LineString', coordinates: [[fix.longitude, fix.latitude]] },
          steps: [],
          traffic: {
            ...result.outdoor.traffic,
            note: 'Recalculated — walking on map pathways.',
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
          summary: 'Recalculated walking route from your location.',
        },
      }
    }

    const driveTarget: LatLng = parking ?? dest
    const route = await fetchRoadRoute(toLit(fix), toLit(driveTarget), 'DRIVE')
    const driveSteps = route.steps.map((s, i) => ({
      ...s,
      index: i,
      phase: 'drive' as const,
    })) as JourneyStep[]

    let walkSteps: JourneyStep[] = []
    const walkFrom: LatLng = parking ?? {
      latitude: route.path[route.path.length - 1]?.lat ?? fix.latitude,
      longitude: route.path[route.path.length - 1]?.lng ?? fix.longitude,
    }
    if (metersBetween(toLit(walkFrom), toLit(dest)) > 20) {
      try {
        const foot = await fetchRoadRoute(toLit(walkFrom), toLit(dest), 'WALK')
        walkSteps = foot.steps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      } catch {
        walkSteps = result.journey.steps.filter((s) => s.phase === 'walk')
      }
    }

    const steps = [
      ...driveSteps,
      ...walkSteps.map((s, i) => ({ ...s, index: driveSteps.length + i, phase: 'walk' as const })),
      ...indoor.map((s, i) => ({ ...s, index: driveSteps.length + walkSteps.length + i })),
    ]

    return {
      ...result,
      origin: stampedOrigin,
      outdoor: {
        ...result.outdoor,
        provider: 'Google Routes (live recalculate · drive)',
        distanceM: route.distanceM,
        distanceMiles: Math.round((route.distanceM / 1609.344) * 10) / 10,
        durationMinutes: Math.round((route.durationSec / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates: pathToGeoJson(route.path) },
        steps: driveSteps,
        traffic: {
          ...result.outdoor.traffic,
          note: parking
            ? `Recalculated drive to ${result.parking?.label || 'parking'}.`
            : 'Recalculated drive on map roads.',
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
        summary: parking
          ? 'Recalculated: drive to parking, then walk pathways.'
          : 'Recalculated driving route from your location.',
      },
    }
  } catch {
    return null
  }
}
