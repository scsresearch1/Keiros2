/**
 * Outdoor rule: drive to the closest driveable point, then walk sidewalks to the entry door.
 */
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { routeOnSiteWays } from './siteGraphRoute'

/** If drive ends farther than this from the entry door → add sidewalk walk leg. */
export const LAST_MILE_WALK_M = 25

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
  // Prefer the drive path that gets closest to the entry door on the vehicle network.
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
  // Prefer sidewalk-tagged OSM, then closest gap to the door.
  candidates.sort((a, b) => {
    const aSide = a.source === 'osm-sidewalks' ? 0 : 1
    const bSide = b.source === 'osm-sidewalks' ? 0 : 1
    if (aSide !== bSide && Math.abs(a.gap - b.gap) < 40) return aSide - bSide
    if (Math.abs(a.gap - b.gap) > 10) return a.gap - b.gap
    return a.distanceM - b.distanceM
  })
  return candidates[0]
}

/**
 * Drive as far as roads/driveways allow toward the entry door,
 * then walk on sidewalks from that handoff to the door coordinates.
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

  const gap = pathEndGapM(drive.path, to)
  const handoff = drive.path[drive.path.length - 1]

  // Drive network reaches the door.
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

  // Closest driveable point → real sidewalk / pedestrian network to entry door.
  // Never invent a curved chord across dirt — only mapped sidewalks / Google walk graph.
  const walk = await bestSidewalkWalk(handoff, to, extract)

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

  // Drive drawn; walk omitted if no sidewalk/pedestrian path exists in the graphs.
  return { segments, handoff, label: 'drive' }
}

/** @deprecated Outdoor always uses planDrivePlusWalk to the entry door. */
export async function planWalkOnly(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<DriveWalkPlan> {
  return planDrivePlusWalk(from, to, extract)
}
