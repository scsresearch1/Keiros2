/**
 * Outdoor: firm blue drive as far as the driveway/road network goes,
 * then red-dot walk only for the remaining gap to the entry door.
 *
 * Do NOT artificially peel ~55m of drive — that stopped blue early while driveway remained.
 */
import type { JourneyStep } from './api'
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { routeOnSiteWays, snapPathToSidewalks } from './siteGraphRoute'

/** Only switch to walk when the drive network ends this far from the entry door. */
export const LAST_MILE_WALK_M = 30

export type HandoffSegment = {
  mode: RouteTravelMode
  path: google.maps.LatLngLiteral[]
  dashed: boolean
  distanceM: number
  source: string
  /** Turn-by-turn for THIS drawn path (same Google route as the blue/red line). */
  steps?: JourneyStep[]
}

export type DriveWalkPlan = {
  segments: HandoffSegment[]
  handoff: google.maps.LatLngLiteral | null
  label: 'drive' | 'walk' | 'drive+walk'
  /** Flattened guidance steps matching the painted corridor. */
  guidanceSteps?: JourneyStep[]
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
): Promise<{
  path: google.maps.LatLngLiteral[]
  distanceM: number
  source: string
  steps?: JourneyStep[]
} | null> {
  const candidates: {
    path: google.maps.LatLngLiteral[]
    distanceM: number
    source: string
    gap: number
    steps?: JourneyStep[]
  }[] = []

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
      let steps = g.steps

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

      candidates.push({ path, distanceM, source, gap, steps })
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

/** Always land on the real destination coordinate. */
function forceReach(
  path: google.maps.LatLngLiteral[],
  target: google.maps.LatLngLiteral,
): google.maps.LatLngLiteral[] {
  if (!path.length) return [{ ...target }]
  const end = path[path.length - 1]
  if (meters(end, target) <= 1.5) {
    const out = path.map((p) => ({ ...p }))
    out[out.length - 1] = { ...target }
    return out
  }
  return [...path.map((p) => ({ ...p })), { ...target }]
}

/**
 * Pedestrian route: prefer OSM sidewalks/footways. Google WALK often follows
 * parking aisles — only use it when sidewalks cannot reach the destination.
 */
export async function bestSidewalkWalk(
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  extract: SiteWaysExtract | null,
): Promise<{
  path: google.maps.LatLngLiteral[]
  distanceM: number
  source: string
  steps?: JourneyStep[]
} | null> {
  const candidates: {
    path: google.maps.LatLngLiteral[]
    distanceM: number
    source: string
    gap: number
    steps?: JourneyStep[]
  }[] = []

  if (extract?.sidewalks?.length) {
    const sidewalksOnly = routeOnSiteWays(extract, from, to, 'WALK', { sidewalksOnly: true })
    if (sidewalksOnly && sidewalksOnly.path.length >= 2) {
      candidates.push({
        path: sidewalksOnly.path,
        distanceM: sidewalksOnly.distanceM,
        source: 'osm-sidewalks',
        gap: pathEndGapM(sidewalksOnly.path, to),
      })
    }
  }

  // Sidewalk graph reached the destination closely enough — never fall back to aisle routing.
  const sidewalkHit = candidates.find((c) => c.source === 'osm-sidewalks' && c.gap <= 45)
  if (sidewalkHit) {
    return {
      ...sidewalkHit,
      path: forceReach(sidewalkHit.path, to),
    }
  }

  try {
    const g: RoadRoute = await fetchRoadRoute(from, to, 'WALK')
    if (g.path.length >= 2) {
      // Google walk often follows the road / grass verge — snap onto kerb sidewalks.
      const snapped =
        extract?.sidewalks?.length
          ? snapPathToSidewalks(g.path, extract.sidewalks, 20)
          : g.path
      candidates.push({
        path: snapped,
        distanceM: g.distanceM,
        source: snapped !== g.path ? 'google-walk-snapped-sidewalk' : 'google-walk',
        gap: pathEndGapM(snapped, to),
        steps: g.steps,
      })
    }
  } catch {
    /* ignore */
  }

  if (!candidates.length) return null
  // Prefer OSM sidewalks even if a bit longer / slightly larger end gap than Google aisles.
  candidates.sort((a, b) => {
    const rank = (s: string) =>
      s === 'osm-sidewalks' ? 0 : s === 'google-walk-snapped-sidewalk' ? 1 : 2
    const ra = rank(a.source)
    const rb = rank(b.source)
    if (ra !== rb) {
      if (ra < rb && a.gap <= Math.max(55, b.gap + 25)) return -1
      if (rb < ra && b.gap <= Math.max(55, a.gap + 25)) return 1
    }
    if (Math.abs(a.gap - b.gap) > 12) return a.gap - b.gap
    return a.distanceM - b.distanceM
  })
  const best = candidates[0]
  return { ...best, path: forceReach(best.path, to) }
}

function collectGuidance(segments: HandoffSegment[]): JourneyStep[] {
  const out: JourneyStep[] = []
  for (const seg of segments) {
    if (!seg.steps?.length) continue
    for (const step of seg.steps) {
      out.push({ ...step, phase: seg.mode === 'WALK' ? 'walk' : 'drive', index: out.length })
    }
  }
  return out
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
      const path = forceReach(walkOnly.path, to)
      const segments: HandoffSegment[] = [
        {
          mode: 'WALK',
          path,
          dashed: true,
          distanceM: Math.round(walkOnly.distanceM + meters(walkOnly.path[walkOnly.path.length - 1], to)),
          source: walkOnly.source,
          steps: walkOnly.steps,
        },
      ]
      return {
        segments,
        handoff: null,
        label: 'walk',
        guidanceSteps: collectGuidance(segments),
      }
    }
    const segments: HandoffSegment[] = [
      {
        mode: 'WALK',
        path: forceReach([from], to),
        dashed: true,
        distanceM: Math.round(meters(from, to)),
        source: 'direct-to-destination',
      },
    ]
    return { segments, handoff: null, label: 'walk', guidanceSteps: [] }
  }

  // Never let blue run past the destination pin.
  const drivePath = truncateAtClosest(drive.path, to)
  const handoff = drivePath[drivePath.length - 1]
  const endGap = meters(handoff, to)

  const driveSeg: HandoffSegment = {
    mode: 'DRIVE',
    path: drivePath,
    dashed: false,
    distanceM: drive.distanceM,
    source: drive.source,
    steps: drive.steps,
  }

  // Vehicle network close enough — still walk any leftover meters to exact D.
  if (endGap <= LAST_MILE_WALK_M) {
    if (endGap <= 2) {
      return {
        segments: [driveSeg],
        handoff: null,
        label: 'drive',
        guidanceSteps: collectGuidance([driveSeg]),
      }
    }
    const segments: HandoffSegment[] = [
      driveSeg,
      {
        mode: 'WALK',
        path: forceReach([handoff], to),
        dashed: true,
        distanceM: Math.round(endGap),
        source: 'last-meters-to-destination',
      },
    ]
    return {
      segments,
      handoff,
      label: 'drive+walk',
      guidanceSteps: collectGuidance(segments),
    }
  }

  // Closest driveable point → walk pathways all the way to destination.
  const walk = await bestSidewalkWalk(handoff, to, extract)
  const walkPath = forceReach(walk && walk.path.length >= 2 ? walk.path : [handoff], to)
  const segments: HandoffSegment[] = [
    driveSeg,
    {
      mode: 'WALK',
      path: walkPath,
      dashed: true,
      distanceM: walk?.distanceM ?? Math.round(meters(handoff, to)),
      source: walk?.source ?? 'walk-to-destination',
      steps: walk?.steps,
    },
  ]
  return {
    segments,
    handoff,
    label: 'drive+walk',
    guidanceSteps: collectGuidance(segments),
  }
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
    const segments: HandoffSegment[] = [
      {
        mode: 'WALK',
        path: forceReach(walk.path, to),
        dashed: true,
        distanceM: walk.distanceM,
        source: walk.source,
        steps: walk.steps,
      },
    ]
    return {
      segments,
      handoff: null,
      label: 'walk',
      guidanceSteps: collectGuidance(segments),
    }
  }
  const gap = meters(from, to)
  if (gap > 2) {
    return {
      segments: [
        {
          mode: 'WALK',
          path: forceReach([from], to),
          dashed: true,
          distanceM: Math.round(gap),
          source: 'direct-to-destination',
        },
      ],
      handoff: null,
      label: 'walk',
      guidanceSteps: [],
    }
  }
  return { segments: [], handoff: null, label: 'walk', guidanceSteps: [] }
}
