import type { JourneyStep, NavigateResult } from './api'
import { fetchRoadRouteLive } from './googleRoute'
import { AT_ENTRANCE_M, metersBetween } from './outdoorLegs'
import {
  fetchOsrmDrivingRoute,
  fetchPedestrianRoute,
  isLongCrowFliesPath,
} from './pedestrianRoute'

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
  /** GPS-inferred travel mode (preferred over journey phase when set). */
  travelMode?: 'walk' | 'drive' | null
}

/**
 * Google-class recalculation from live GPS:
 * - Drive: traffic-aware roads to parking (if Via parking) or destination
 * - Walk: pedestrian / sidewalk paths when the phone is walking
 * - Keeps session origin (S pin); stamps liveFrom so remaining corridor starts at GPS
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
  // Re-route toward the unit/building pin (same as outdoor D) — not a parking-lot entry.
  const dest: LatLng = unitDest
  const parking = isDbParking(result)
    ? {
        latitude: result.parking!.latitude,
        longitude: result.parking!.longitude,
      }
    : null

  const atDoor = metersBetween(toLit(fix), toLit(entrance)) <= AT_ENTRANCE_M
  const pastParking =
    parking != null && metersBetween(toLit(fix), toLit(parking)) <= 55 && phaseNow === 'walk'
  // GPS travel mode wins: walking must not keep a blue drive corridor.
  const travelMode = opts?.travelMode
  const walking =
    travelMode === 'walk' ||
    (travelMode !== 'drive' &&
      (atDoor ||
        phaseNow === 'walk' ||
        pastParking ||
        (!result.outdoor.steps?.length && phaseNow !== 'drive' && phaseNow !== 'outdoor')))

  // Never move session start (S). Route APIs still use `fix`; outdoor legs use liveFrom.
  const stampedOrigin = {
    ...result.origin,
    liveTravelMode: (walking ? 'walk' : 'drive') as 'walk' | 'drive',
    liveFrom: { latitude: fix.latitude, longitude: fix.longitude },
  }

  try {
    if (walking) {
      const walkTarget = dest
      const fromLit = toLit(fix)
      const toLitDest = toLit(walkTarget)
      // Real network only — never invent a GPS→dest crow-flies chord.
      const ped = await fetchPedestrianRoute(fromLit, toLitDest).catch(() => null)
      if (!ped?.path || isLongCrowFliesPath(ped.path)) return null
      const path = ped.path
      const distanceM = ped.distanceM
      const walkSteps = ped.steps.map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      const steps = [
        ...walkSteps,
        ...indoor.map((s, i) => ({ ...s, index: walkSteps.length + i })),
      ]
      return {
        ...result,
        origin: stampedOrigin,
        outdoor: {
          ...result.outdoor,
          provider: 'live recalculate · walk',
          distanceM: 0,
          distanceMiles: 0,
          durationMinutes: 0,
          geometry: { type: 'LineString', coordinates: [[fix.longitude, fix.latitude]] },
          steps: [],
          traffic: {
            ...result.outdoor.traffic,
            note: `Walking · ${ped.provider}`,
            updatedAt: new Date().toISOString(),
          },
        },
        walk: {
          provider: ped.provider,
          distanceM,
          distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
          durationMinutes: Math.round((ped.durationSec / 60) * 10) / 10,
          geometry: { type: 'LineString', coordinates: pathToGeoJson(path) },
          steps: walkSteps,
        },
        journey: {
          ...result.journey,
          totalSteps: steps.length,
          driveSteps: 0,
          outdoorSteps: 0,
          walkSteps: walkSteps.length,
          steps,
          summary: 'Recalculated on the pedestrian / street network.',
        },
      }
    }

    const driveTarget: LatLng = parking ?? dest
    const fromLit = toLit(fix)
    const toLitDrive = toLit(driveTarget)
    // Google roads first, OSRM driving if Google fails or returns a chord.
    let routePath: { lat: number; lng: number }[] | null = null
    let routeDistanceM = 0
    let routeDurationSec = 0
    let routeSteps: JourneyStep[] = []
    let routeProvider = 'Google Routes (live recalculate · drive)'
    try {
      const g = await fetchRoadRouteLive(fromLit, toLitDrive, 'DRIVE')
      if (g.path.length > 1 && !isLongCrowFliesPath(g.path)) {
        routePath = g.path
        routeDistanceM = g.distanceM
        routeDurationSec = g.durationSec
        routeSteps = g.steps.map((s, i) => ({
          ...s,
          index: i,
          phase: 'drive' as const,
        }))
      }
    } catch {
      /* OSRM below */
    }
    if (!routePath) {
      const osrm = await fetchOsrmDrivingRoute(fromLit, toLitDrive).catch(() => null)
      if (!osrm || isLongCrowFliesPath(osrm.path)) return null
      routePath = osrm.path
      routeDistanceM = osrm.distanceM
      routeDurationSec = osrm.durationSec
      routeProvider = 'OSRM driving (live recalculate · drive)'
      routeSteps = osrm.steps.map((s, i) => ({
        ...s,
        index: i,
        phase: 'drive' as const,
        instruction: s.instruction?.replace(/^Walk/i, 'Drive') || s.instruction,
      }))
    }

    const driveSteps = routeSteps
    const steps = [
      ...driveSteps,
      ...indoor.map((s, i) => ({ ...s, index: driveSteps.length + i })),
    ]

    return {
      ...result,
      origin: stampedOrigin,
      outdoor: {
        ...result.outdoor,
        provider: routeProvider,
        distanceM: routeDistanceM,
        distanceMiles: Math.round((routeDistanceM / 1609.344) * 10) / 10,
        durationMinutes: Math.round((routeDurationSec / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates: pathToGeoJson(routePath) },
        steps: driveSteps,
        traffic: {
          ...result.outdoor.traffic,
          note: parking
            ? `Driving on roads to ${result.parking?.label || 'parking'}.`
            : 'Driving on roads / driveways.',
          updatedAt: new Date().toISOString(),
        },
      },
      walk: {
        provider: 'deferred until walk',
        distanceM: 0,
        distanceMiles: 0,
        durationMinutes: 0,
        geometry: { type: 'LineString', coordinates: [] },
        steps: [],
      },
      journey: {
        ...result.journey,
        totalSteps: steps.length,
        driveSteps: driveSteps.length,
        outdoorSteps: driveSteps.length,
        walkSteps: 0,
        steps,
        summary: parking
          ? 'Driving on roads to parking (walk pathways after you leave the car).'
          : 'Driving on roads / driveways from your location.',
      },
    }
  } catch {
    return null
  }
}
