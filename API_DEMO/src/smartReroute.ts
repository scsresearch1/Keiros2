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
      // Prefer real network; if routing fails, keep prior corridor so the line never vanishes.
      const ped = await fetchPedestrianRoute(fromLit, toLitDest).catch(() => null)
      const priorWalk = (result.walk?.geometry?.coordinates ?? []).map(([lng, lat]) => ({
        lat,
        lng,
      }))
      const priorDrive = (result.outdoor?.geometry?.coordinates ?? []).map(([lng, lat]) => ({
        lat,
        lng,
      }))
      const path =
        ped?.path && ped.path.length > 1 && !isLongCrowFliesPath(ped.path)
          ? ped.path
          : ped?.path && ped.path.length > 1
            ? ped.path
            : priorWalk.length > 1
              ? priorWalk
              : priorDrive.length > 1
                ? priorDrive
                : [fromLit, toLitDest]
      const distanceM = ped?.distanceM ?? Math.round(metersBetween(fromLit, toLitDest))
      const durationSec = ped?.durationSec ?? Math.max(60, Math.round(distanceM / 1.4))
      const walkSteps = (ped?.steps?.length
        ? ped.steps
        : [
            {
              id: 'walk-keep-0',
              phase: 'walk' as const,
              index: 0,
              instruction: 'Walk toward your destination',
              latitude: fix.latitude,
              longitude: fix.longitude,
              distanceM,
              durationSec,
              geometry: pathToGeoJson(path),
            },
          ]
      ).map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))
      const steps = [
        ...walkSteps,
        ...indoor.map((s, i) => ({ ...s, index: walkSteps.length + i })),
      ]
      const provider = ped?.provider || 'previous corridor (walk)'
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
            note: `Walking · ${provider}`,
            updatedAt: new Date().toISOString(),
          },
        },
        walk: {
          provider,
          distanceM,
          distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
          durationMinutes: Math.round((durationSec / 60) * 10) / 10,
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
          summary: 'Recalculated walk corridor.',
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
      if (osrm?.path && osrm.path.length > 1) {
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
    }
    if (!routePath) {
      // Keep prior road geometry so the blue line does not disappear mid-nav.
      const prior = (result.outdoor?.geometry?.coordinates ?? []).map(([lng, lat]) => ({
        lat,
        lng,
      }))
      if (prior.length > 1) {
        routePath = prior
        routeDistanceM = result.outdoor.distanceM || Math.round(metersBetween(fromLit, toLitDrive))
        routeDurationSec = Math.max(30, Math.round(routeDistanceM / 11))
        routeProvider = 'previous corridor (drive)'
        routeSteps = (result.outdoor.steps?.length
          ? result.outdoor.steps
          : [
              {
                id: 'drive-keep-0',
                phase: 'drive' as const,
                index: 0,
                instruction: 'Continue on the route',
                latitude: fix.latitude,
                longitude: fix.longitude,
                distanceM: routeDistanceM,
                durationSec: routeDurationSec,
                geometry: pathToGeoJson(prior),
              },
            ]) as JourneyStep[]
      } else {
        routePath = [fromLit, toLitDrive]
        routeDistanceM = Math.round(metersBetween(fromLit, toLitDrive))
        routeDurationSec = Math.max(30, Math.round(routeDistanceM / 11))
        routeProvider = 'direct visible (drive fallback)'
        routeSteps = [
          {
            id: 'drive-fallback-0',
            phase: 'drive',
            index: 0,
            instruction: 'Drive toward your destination',
            latitude: fix.latitude,
            longitude: fix.longitude,
            distanceM: routeDistanceM,
            durationSec: routeDurationSec,
            geometry: pathToGeoJson(routePath),
          },
        ]
      }
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
