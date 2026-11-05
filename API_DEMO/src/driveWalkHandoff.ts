/**
 * Outdoor: firm blue drive to closest driveable point, then red-dot walk on pathways to entry door.
 */
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { routeOnSiteWays } from './siteGraphRoute'

/** Peel the last approach off the drive so walk (red dots) is always visible to the door. */
export const APPROACH_WALK_M = 55
export const LAST_MILE_WALK_M = 8

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

/** Handoff = last drive point still outside the final approach radius to the door. */
function findHandoff(
  path: google.maps.LatLngLiteral[],
  door: google.maps.LatLngLiteral,
  walkRadiusM: number,
): { handoff: google.maps.LatLngLiteral; drivePath: google.maps.LatLngLiteral[] } {
  if (path.length < 2) {
    return { handoff: path[0] ?? door, drivePath: path }
  }
  let cut = path.length - 1
  for (let i = 0; i < path.length; i++) {
    if (meters(path[i], door) <= walkRadiusM) {
      cut = Math.max(0, i - 1)
      break
    }
  }
  const drivePath = path.slice(0, cut + 1)
  if (drivePath.length < 2) {
    return { handoff: path[0], drivePath: path.slice(0, Math.min(2, path.length)) }
  }
  return { handoff: drivePath[drivePath.length - 1], drivePath }
}

async function bestDriveRoute(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<{ path: google.maps.LatLngLiteral[]; distanceM: number; source: string } | null> {
  const candidates: { path: google.maps.LatLngLiteral[]; distanceM: number; source: string; gap: number }[] =
    []

  if (extract) {
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
      candidates.push({
        path: g.path,
        distanceM: g.distanceM,
        source: 'google-drive',
        gap: pathEndGapM(g.path, to),
      })
    }
  } catch {
    /* ignore */
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (Math.abs(a.gap - b.gap) > 10) return a.gap - b.gap
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
 * Drive (blue) to closest driveable point, then walk (red dots) pathways to entry door.
 * Always peels a final approach walk when the door is not on the drive network.
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

  const endGap = pathEndGapM(drive.path, to)
  // Peel last ~55m (or whatever remains) so red-dot walk always shows to the door.
  const { handoff, drivePath } =
    endGap <= LAST_MILE_WALK_M
      ? findHandoff(drive.path, to, APPROACH_WALK_M)
      : {
          handoff: drive.path[drive.path.length - 1],
          drivePath: drive.path,
        }

  // If peel collapsed everything, keep a short drive stub then walk.
  const usableDrive =
    drivePath.length >= 2 ? drivePath : drive.path.slice(0, Math.max(2, Math.floor(drive.path.length * 0.85)))

  const walkFrom = usableDrive[usableDrive.length - 1] ?? handoff
  const walk = await bestSidewalkWalk(walkFrom, to, extract)

  const segments: HandoffSegment[] = [
    {
      mode: 'DRIVE',
      path: usableDrive,
      dashed: false,
      distanceM: drive.distanceM,
      source: drive.source,
    },
  ]

  if (walk && walk.path.length >= 2 && meters(walkFrom, to) > LAST_MILE_WALK_M) {
    segments.push({
      mode: 'WALK',
      path: walk.path,
      dashed: true,
      distanceM: walk.distanceM,
      source: walk.source,
    })
    return { segments, handoff: walkFrom, label: 'drive+walk' }
  }

  // Walk graph missing — still show handoff; drive stops short of door (no fake blue into the building).
  if (meters(walkFrom, to) > LAST_MILE_WALK_M) {
    return { segments, handoff: walkFrom, label: 'drive' }
  }

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

export async function planWalkOnly(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  return planDrivePlusWalk(from, to, extract)
}
