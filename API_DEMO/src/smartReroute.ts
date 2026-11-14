import type { JourneyStep, NavigateResult } from './api'
import { bestSidewalkWalk } from './driveWalkHandoff'
import { extractSiteWays } from './extractSiteWays'
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
      // Google-speed: one WALK Routes call only — never block on Overpass/OSM.
      const googleWalk = await fetchRoadRoute(fromLit, toLitDest, 'WALK').catch(() => null)
      // Optional OSM refine in background (map may upgrade later on next paint).
      void extractSiteWays([fromLit, toLitDest])
        .then((extract) => bestSidewalkWalk(fromLit, toLitDest, extract))
        .catch(() => null)
      const path = googleWalk?.path ?? null
      if (!path?.length) return null
      const distanceM =
        googleWalk?.distanceM ??
        Math.round(
          path.reduce((sum, p, i) => {
            if (i === 0) return 0
            return sum + metersBetween(path[i - 1], p)
          }, 0),
        )
      const walkSteps =
        googleWalk?.steps?.map((s, i) => ({ ...s, index: i, phase: 'walk' as const })) ??
        [
          {
            id: 'live-walk-1',
            phase: 'walk' as const,
            index: 0,
            instruction: 'Walk on walkways / footpaths toward your destination',
            latitude: fix.latitude,
            longitude: fix.longitude,
            distanceM,
            geometry: pathToGeoJson(path),
          },
        ]
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
            note: 'Recalculated — Google walk on walkways / footpaths.',
            updatedAt: new Date().toISOString(),
          },
        },
        walk: {
          provider: 'Google Routes WALK',
          distanceM,
          distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
          durationMinutes: Math.round((distanceM / 1.35 / 60) * 10) / 10,
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
          summary: 'Recalculated Google walking route on walkways / footpaths.',
        },
      }
    }

    const driveTarget: LatLng = parking ?? dest
    // One DRIVE call only — second WALK fetch was doubling latency at 10–40 mph.
    // Keep prior walk steps for after parking; OutdoorMap paints drive geometry immediately.
    const route = await fetchRoadRoute(toLit(fix), toLit(driveTarget), 'DRIVE')
    const driveSteps = route.steps.map((s, i) => ({
      ...s,
      index: i,
      phase: 'drive' as const,
    })) as JourneyStep[]

    const walkSteps: JourneyStep[] = result.journey.steps
      .filter((s) => s.phase === 'walk')
      .map((s, i) => ({ ...s, index: i, phase: 'walk' as const }))

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
