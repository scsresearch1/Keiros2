/**
 * Google Maps–style “Drive + Walk” last mile:
 * drive as far as the road/driveway network allows, then walk the remainder.
 */
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { routeOnSiteWays } from './siteGraphRoute'

/** If the drive path ends farther than this from the pin, add a walk leg (like Google Maps). */
export const LAST_MILE_WALK_M = 35

export type HandoffSegment = {
  mode: RouteTravelMode
  path: google.maps.LatLngLiteral[]
  /** Match Google Maps: solid = drive, dashed = walk last mile */
  dashed: boolean
  distanceM: number
  source: string
}

export type DriveWalkPlan = {
  segments: HandoffSegment[]
  /** Where the user leaves the car / ends the drive network. */
  handoff: google.maps.LatLngLiteral | null
  label: 'drive' | 'walk' | 'drive+walk'
}

function meters(
  a: google.maps.LatLngLiteral,
  b: google.maps.LatLngLiteral,
) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

async function bestNetworkRoute(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
  extract: SiteWaysExtract | null,
): Promise<{ path: google.maps.LatLngLiteral[]; distanceM: number; source: string } | null> {
  const candidates: { path: google.maps.LatLngLiteral[]; distanceM: number; source: string; gap: number }[] =
    []

  if (extract) {
    const site = routeOnSiteWays(extract, from, to, mode)
    if (site?.path.length && site.path.length >= 2) {
      candidates.push({
        path: site.path,
        distanceM: site.distanceM,
        source: 'osm',
        gap: pathEndGapM(site.path, to),
      })
    }
  }

  try {
    const g: RoadRoute = await fetchRoadRoute(from, to, mode)
    if (g.path.length >= 2) {
      candidates.push({
        path: g.path,
        distanceM: g.distanceM,
        source: 'google',
        gap: pathEndGapM(g.path, to),
      })
    }
  } catch {
    /* ignore */
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (Math.abs(a.gap - b.gap) > 12) return a.gap - b.gap
    return a.distanceM - b.distanceM
  })
  const best = candidates[0]
  return { path: best.path, distanceM: best.distanceM, source: best.source }
}

/**
 * For a DRIVE request to a pin that may be off-road:
 * solid drive to nearest on-network point, then dashed walk to the pin (Google Maps pattern).
 */
export async function planDrivePlusWalk(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  const drive = await bestNetworkRoute(from, to, 'DRIVE', extract)

  // No drive network → walk the whole way if possible.
  if (!drive) {
    const walkOnly = await bestNetworkRoute(from, to, 'WALK', extract)
    if (walkOnly) {
      return {
        segments: [
          {
            mode: 'WALK',
            path: walkOnly.path,
            dashed: true,
            distanceM: walkOnly.distanceM,
            source: walkOnly.source,
          },
        ],
        handoff: null,
        label: 'walk',
      }
    }
    return { segments: [], handoff: null, label: 'walk' }
  }

  const gap = pathEndGapM(drive.path, to)
  const handoff = drive.path[drive.path.length - 1]

  // Drive reaches the pin (on or very near the network).
  if (gap <= LAST_MILE_WALK_M) {
    return {
      segments: [
        {
          mode: 'DRIVE',
          path: drive.path,
          dashed: false,
          distanceM: drive.distanceM,
          source: drive.source,
        },
      ],
      handoff: null,
      label: 'drive',
    }
  }

  // Last mile: walk from end of drive network to the pin.
  let walk = await bestNetworkRoute(handoff, to, 'WALK', extract)
  if (!walk || walk.path.length < 2) {
    // Pedestrian graph may also be empty off-road — short honest connector only if small.
    if (gap <= 120) {
      walk = {
        path: [handoff, to],
        distanceM: Math.round(gap),
        source: 'direct-last-mile',
      }
    }
  }

  const segments: HandoffSegment[] = [
    {
      mode: 'DRIVE',
      path: drive.path,
      dashed: false,
      distanceM: drive.distanceM,
      source: drive.source,
    },
  ]

  if (walk && walk.path.length >= 2 && meters(handoff, to) > 5) {
    segments.push({
      mode: 'WALK',
      path: walk.path,
      dashed: true,
      distanceM: walk.distanceM,
      source: walk.source,
    })
    return { segments, handoff, label: 'drive+walk' }
  }

  return {
    segments,
    handoff,
    label: 'drive',
  }
}

/** Walk-only leg (no drive+walk split). */
export async function planWalkOnly(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  const walk = await bestNetworkRoute(from, to, 'WALK', extract)
  if (!walk) return { segments: [], handoff: null, label: 'walk' }
  return {
    segments: [
      {
        mode: 'WALK',
        path: walk.path,
        dashed: true,
        distanceM: walk.distanceM,
        source: walk.source,
      },
    ],
    handoff: null,
    label: 'walk',
  }
}
