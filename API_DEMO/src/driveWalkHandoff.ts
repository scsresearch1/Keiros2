/**
 * Outdoor: firm blue drive as far as the driveway/road network goes,
 * then red-dot walk only for the remaining gap to the entry door.
 *
 * Do NOT artificially peel ~55m of drive — that stopped blue early while driveway remained.
 */
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { routeOnSiteWays } from './siteGraphRoute'

/** Only switch to walk when the drive network ends this far from the entry door. */
export const LAST_MILE_WALK_M = 30

export type HandoffSegment = {
  mode: RouteTravelMode
  path: google.maps.LatLngLiteral[]
  dashed: boolean
  distanceM: number
  source: string
}

export type DriveWalkPlan = {
  segments: HandoffSegment[]
  handoff: google.maps.LatLngLiteral | null
  label: 'drive' | 'walk' | 'drive+walk'
}

function meters(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Stop the drive at the vertex closest to the entry door (no blue continuing past E). */
function truncateAtClosest(
  path: google.maps.LatLngLiteral[],
  target: google.maps.LatLngLiteral,
): google.maps.LatLngLiteral[] {
  if (path.length < 2) return path
  let bestI = 0
  let bestD = Infinity
  for (let i = 0; i < path.length; i++) {
    const d = meters(path[i], target)
    if (d < bestD) {
      bestD = d
      bestI = i
    }
  }
  const cut = Math.max(1, bestI)
  return path.slice(0, cut + 1)
}

async function bestDriveRoute(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<{ path: google.maps.LatLngLiteral[]; distanceM: number; source: string } | null> {
  const candidates: { path: google.maps.LatLngLiteral[]; distanceM: number; source: string; gap: number }[] =
    []

  if (extract?.driveways.length) {
    const site = routeOnSiteWays(extract, from, to, 'DRIVE')
    if (site && site.path.length >= 2) {
      candidates.push({
        path: site.path,
        distanceM: site.distanceM,
        source: 'osm-driveways',
        gap: pathEndGapM(site.path, to),
      })
    }
  }

  try {
    const g: RoadRoute = await fetchRoadRoute(from, to, 'DRIVE')
    if (g.path.length >= 2) {
      // Google often stops on the public road and never enters the visible site driveway.
      // Stitch OSM driveway from Google's end onto `to` (curb / driveway snap).
      let path = g.path
      let distanceM = g.distanceM
      let source = 'google-drive'
      let gap = pathEndGapM(g.path, to)

      if (extract?.driveways.length && gap > LAST_MILE_WALK_M) {
        const googleEnd = g.path[g.path.length - 1]
        const ontoDriveway = routeOnSiteWays(extract, googleEnd, to, 'DRIVE')
        if (ontoDriveway && ontoDriveway.path.length >= 2) {
          const stitchGap = pathEndGapM(ontoDriveway.path, to)
          if (stitchGap + 5 < gap) {
            path = [...g.path, ...ontoDriveway.path.slice(1)]
            distanceM = g.distanceM + ontoDriveway.distanceM
            source = 'google-drive+osm-driveway'
            gap = stitchGap
          }
        }
      }

      candidates.push({ path, distanceM, source, gap })
    }
  } catch {
    /* ignore */
  }

  if (!candidates.length) return null
  // Prefer the drive that gets closest to the site driveway / curb.
  candidates.sort((a, b) => {
    if (Math.abs(a.gap - b.gap) > 8) return a.gap - b.gap
    return a.distanceM - b.distanceM
  })
  return candidates[0]
}

async function bestSidewalkWalk(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<{ path: google.maps.LatLngLiteral[]; distanceM: number; source: string } | null> {
  const candidates: { path: google.maps.LatLngLiteral[]; distanceM: number; source: string; gap: number }[] =
    []

  if (extract) {
    const sidewalksOnly = routeOnSiteWays(extract, from, to, 'WALK', { sidewalksOnly: true })
    if (sidewalksOnly && sidewalksOnly.path.length >= 2) {
      candidates.push({
        path: sidewalksOnly.path,
        distanceM: sidewalksOnly.distanceM,
        source: 'osm-sidewalks',
        gap: pathEndGapM(sidewalksOnly.path, to),
      })
    }
    const mixed = routeOnSiteWays(extract, from, to, 'WALK')
    if (mixed && mixed.path.length >= 2) {
      candidates.push({
        path: mixed.path,
        distanceM: mixed.distanceM,
        source: 'osm-walk',
        gap: pathEndGapM(mixed.path, to),
      })
    }
  }

  try {
    const g: RoadRoute = await fetchRoadRoute(from, to, 'WALK')
    if (g.path.length >= 2) {
      candidates.push({
        path: g.path,
        distanceM: g.distanceM,
        source: 'google-walk',
        gap: pathEndGapM(g.path, to),
      })
    }
  } catch {
    /* ignore */
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const aSide = a.source === 'osm-sidewalks' ? 0 : a.source === 'google-walk' ? 1 : 2
    const bSide = b.source === 'osm-sidewalks' ? 0 : b.source === 'google-walk' ? 1 : 2
    if (aSide !== bSide && Math.abs(a.gap - b.gap) < 50) return aSide - bSide
    if (Math.abs(a.gap - b.gap) > 10) return a.gap - b.gap
    return a.distanceM - b.distanceM
  })
  return candidates[0]
}

/**
 * Drive the full driveway/road path Google (or OSM) returns toward the entry door.
 * Walk (red dots) only for the leftover gap after the vehicle network ends — never cut drive early.
 */
export async function planDrivePlusWalk(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  const drive = await bestDriveRoute(from, to, extract)

  if (!drive) {
    const walkOnly = await bestSidewalkWalk(from, to, extract)
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

  // Never let blue run past the entry door toward the unit / out the other side.
  const drivePath = truncateAtClosest(drive.path, to)
  const handoff = drivePath[drivePath.length - 1]
  const endGap = meters(handoff, to)

  // Vehicle network reaches the door — solid blue all the way to E.
  if (endGap <= LAST_MILE_WALK_M) {
    return {
      segments: [
        {
          mode: 'DRIVE',
          path: drivePath,
          dashed: false,
          distanceM: drive.distanceM,
          source: drive.source,
        },
      ],
      handoff: null,
      label: 'drive',
    }
  }

  // Closest driveable point → walk pathways to the entry door.
  const walk = await bestSidewalkWalk(handoff, to, extract)
  const segments: HandoffSegment[] = [
    {
      mode: 'DRIVE',
      path: drivePath,
      dashed: false,
      distanceM: drive.distanceM,
      source: drive.source,
    },
  ]

  if (walk && walk.path.length >= 2) {
    segments.push({
      mode: 'WALK',
      path: walk.path,
      dashed: true,
      distanceM: walk.distanceM,
      source: walk.source,
    })
    return { segments, handoff, label: 'drive+walk' }
  }

  return { segments, handoff, label: 'drive' }
}

/**
 * Walk-only (Entry → Unit). Never requests DRIVE — that was routing a car from E away from D.
 */
export async function planWalkOnly(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  const walk = await bestSidewalkWalk(from, to, extract)
  if (walk && walk.path.length >= 2) {
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
  // Short on-site connector when graphs have no path (still never DRIVE).
  const gap = meters(from, to)
  if (gap > 2 && gap < 250) {
    return {
      segments: [
        {
          mode: 'WALK',
          path: [from, to],
          dashed: true,
          distanceM: Math.round(gap),
          source: 'entry-to-unit-direct',
        },
      ],
      handoff: null,
      label: 'walk',
    }
  }
  return { segments: [], handoff: null, label: 'walk' }
}
