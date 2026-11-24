/**
 * Outdoor: firm blue drive as far as the driveway/road network goes,
 * then red-dot walk only for the remaining gap to the entry door.
 *
 * Do NOT artificially peel ~55m of drive — that stopped blue early while driveway remained.
 */
import type { JourneyStep } from './api'
import type { SiteWaysExtract } from './extractSiteWays'
import { fetchRoadRoute, pathEndGapM, type RoadRoute, type RouteTravelMode } from './googleRoute'
import { fetchOsrmDrivingRoute, fetchPedestrianRoute, isLongCrowFliesPath } from './pedestrianRoute'
import { routeOnSiteWays } from './siteGraphRoute'

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
    if (g.path.length >= 2 && !isLongCrowFliesPath(g.path)) {
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

  try {
    const osrm = await fetchOsrmDrivingRoute(from, to)
    if (osrm.path.length >= 2 && !isLongCrowFliesPath(osrm.path)) {
      candidates.push({
        path: osrm.path,
        distanceM: osrm.distanceM,
        source: 'osrm-driving',
        gap: pathEndGapM(osrm.path, to),
        steps: osrm.steps,
      })
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

/**
 * Snap/connect to the real destination for a short/medium gap.
 * Caps long campus chords; last-mile to a rooftop D may pass maxConnectM explicitly.
 */
function forceReach(
  path: google.maps.LatLngLiteral[],
  target: google.maps.LatLngLiteral,
  maxConnectM = 22,
): google.maps.LatLngLiteral[] {
  if (!path.length) return [{ ...target }]
  const end = path[path.length - 1]
  const gap = meters(end, target)
  if (gap <= 1.5) {
    const out = path.map((p) => ({ ...p }))
    out[out.length - 1] = { ...target }
    return out
  }
  if (gap <= maxConnectM) return [...path.map((p) => ({ ...p })), { ...target }]
  return path.map((p) => ({ ...p }))
}

/**
 * Pedestrian route: Google/OSRM first (fetchPedestrianRoute), then local OSM
 * sidewalks only when they clearly reach closer to the door.
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
  let network: {
    path: google.maps.LatLngLiteral[]
    distanceM: number
    source: string
    steps?: JourneyStep[]
  } | null = null

  try {
    const ped = await fetchPedestrianRoute(from, to)
    if (ped.path.length >= 2 && !isLongCrowFliesPath(ped.path)) {
      network = {
        path: forceReach(ped.path, to),
        distanceM: ped.distanceM,
        source: ped.provider.includes('OSRM') ? 'osrm-foot' : 'google-walk',
        steps: ped.steps,
      }
    }
  } catch {
    /* try local / fail */
  }

  // Campus extract: real mapped footways only (no synthetic kerbs for routing).
  if (extract?.sidewalks?.length) {
    const real = extract.sidewalks.filter((w) => !String(w.id).includes('osm-kerb-'))
    if (real.length) {
      const local = routeOnSiteWays({ ...extract, sidewalks: real }, from, to, 'WALK', {
        sidewalksOnly: true,
      })
      if (local && local.path.length >= 2 && pathEndGapM(local.path, to) <= 25) {
        const localPath = forceReach(local.path, to)
        const localGap = pathEndGapM(localPath, to)
        const netGap = network ? pathEndGapM(network.path, to) : Number.POSITIVE_INFINITY
        // Prefer site sidewalks only when they land meaningfully closer to D.
        if (!network || localGap + 8 < netGap) {
          return {
            path: localPath,
            distanceM: local.distanceM,
            source: 'osm-sidewalks',
          }
        }
      }
    }
  }

  return network
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
    if (walkOnly && walkOnly.path.length >= 2) {
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
    // Last resort: OSRM street network — never a crow-flies chord across lots/yards.
    try {
      const osrm = await fetchOsrmDrivingRoute(from, to)
      if (osrm.path.length >= 2 && !isLongCrowFliesPath(osrm.path)) {
        const path = forceReach(osrm.path, to)
        return {
          segments: [
            {
              mode: 'DRIVE',
              path,
              dashed: false,
              distanceM: osrm.distanceM,
              source: 'osrm-driving',
              steps: osrm.steps,
            },
          ],
          handoff: null,
          label: 'drive',
          guidanceSteps: collectGuidance([
            {
              mode: 'DRIVE',
              path,
              dashed: false,
              distanceM: osrm.distanceM,
              source: 'osrm-driving',
              steps: osrm.steps,
            },
          ]),
        }
      }
    } catch {
      /* fall through */
    }
    return { segments: [], handoff: null, label: 'walk', guidanceSteps: [] }
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

  // Already at D — drive only.
  if (endGap <= 2) {
    return {
      segments: [driveSeg],
      handoff: null,
      label: 'drive',
      guidanceSteps: collectGuidance([driveSeg]),
    }
  }

  // Any leftover gap → pedestrian last mile (always mark steps to D).
  const walk = await bestSidewalkWalk(handoff, to, extract)
  let walkPath =
    walk && walk.path.length >= 2 ? forceReach(walk.path, to, 45) : null
  // If routers fail or stop short, still mark the last steps to D.
  if (!walkPath || walkPath.length < 2) {
    walkPath = forceReach([handoff], to, Math.max(45, endGap + 1))
  } else if (meters(walkPath[walkPath.length - 1], to) > 2.5) {
    walkPath = forceReach(walkPath, to, 45)
  }
  const segments: HandoffSegment[] = [
    driveSeg,
    {
      mode: 'WALK',
      path: walkPath,
      dashed: true,
      distanceM: walk?.distanceM ?? Math.round(endGap),
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
    try {
      const osrm = await fetchOsrmDrivingRoute(from, to)
      if (osrm.path.length >= 2 && !isLongCrowFliesPath(osrm.path)) {
        const path = forceReach(osrm.path, to)
        const segments: HandoffSegment[] = [
          {
            mode: 'WALK',
            path,
            dashed: true,
            distanceM: osrm.distanceM,
            source: 'osrm-driving-as-walk',
            steps: osrm.steps,
          },
        ]
        return {
          segments,
          handoff: null,
          label: 'walk',
          guidanceSteps: collectGuidance(segments),
        }
      }
    } catch {
      /* short gap only */
    }
  }
  // Short last meters only — never a long roof chord as the “path”.
  if (gap > 2 && gap <= 40) {
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
