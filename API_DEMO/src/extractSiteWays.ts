/**
 * Extract driveways + sidewalks from OpenStreetMap via same-origin Overpass proxy.
 * Never blocks Google routing — caller should not await this before drawing the path.
 *
 * Important for India / sparse OSM: many streets have NO separate footway ways.
 * We synthesize kerb-offset sidewalk lines from road centerlines so walk routing
 * can leave the middle of the carriageway.
 */

export type SiteWayKind = 'driveway' | 'sidewalk'

export type SiteWay = {
  id: string
  kind: SiteWayKind
  coordinates: [number, number][]
  name?: string
  highway?: string
  /**
   * Walk quality: 1 = kerb sidewalk / pedestrian street (use these),
   * 2 = generic footway, 3 = path (often grass / desire lines — last resort).
   */
  walkPriority?: number
}

export type SiteWaysExtract = {
  driveways: SiteWay[]
  sidewalks: SiteWay[]
  bbox: [number, number, number, number]
  source: 'openstreetmap'
  fetchedAt: string
}

type OverpassElement = {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: { lat: number; lon: number }[]
}

/** Single proxy path — function already races mirrors. */
const OVERPASS_URL = '/api/overpass'
const CLIENT_TIMEOUT_MS = 6000
/** Typical kerb offset from road centerline (meters). */
const KERB_OFFSET_M = 4.8
const cache = new Map<string, Promise<SiteWaysExtract>>()

function padBbox(
  points: { lat: number; lng: number }[],
  padDeg = 0.0035,
): [number, number, number, number] {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
  }
  if (!Number.isFinite(south)) return [0, 0, 0, 0]
  return [south - padDeg, west - padDeg, north + padDeg, east + padDeg]
}

function emptyExtract(bbox: [number, number, number, number]): SiteWaysExtract {
  return {
    driveways: [],
    sidewalks: [],
    bbox,
    source: 'openstreetmap',
    fetchedAt: new Date().toISOString(),
  }
}

function walkPriorityFromTags(tags: Record<string, string>): number {
  const highway = tags.highway || ''
  const footway = tags.footway || ''
  if (footway === 'sidewalk' || highway === 'pedestrian') return 1
  if (footway === 'crossing' || highway === 'crossing' || highway === 'steps') return 1
  if (highway === 'footway') return 2
  if (highway === 'cycleway') return 2
  if (highway === 'path') return 3
  return 2
}

function classify(tags: Record<string, string> | undefined): SiteWayKind | null {
  if (!tags) return null
  const highway = tags.highway || ''
  const service = tags.service || ''
  const footway = tags.footway || ''

  if (
    highway === 'footway' ||
    highway === 'path' ||
    highway === 'pedestrian' ||
    highway === 'steps' ||
    highway === 'crossing' ||
    footway === 'sidewalk' ||
    footway === 'crossing' ||
    (highway === 'cycleway' && /yes|designated|permissive/i.test(tags.foot || 'yes'))
  ) {
    return 'sidewalk'
  }

  if (
    service === 'driveway' ||
    service === 'parking_aisle' ||
    highway === 'service' ||
    highway === 'living_street' ||
    highway === 'residential' ||
    highway === 'unclassified' ||
    highway === 'tertiary' ||
    highway === 'secondary' ||
    highway === 'primary'
  ) {
    return 'driveway'
  }

  return null
}

/** Offset a polyline left/right of travel by meters (builds synthetic kerbs). */
function offsetPolyline(
  coords: [number, number][],
  side: 'left' | 'right',
  offsetM: number,
): [number, number][] {
  if (coords.length < 2) return coords.map((c) => [...c] as [number, number])
  const sign = side === 'left' ? 1 : -1
  const out: [number, number][] = []
  for (let i = 0; i < coords.length; i += 1) {
    const prev = coords[Math.max(0, i - 1)]
    const next = coords[Math.min(coords.length - 1, i + 1)]
    const [lng0, lat0] = coords[i]
    const dLat = next[1] - prev[1]
    const dLng = next[0] - prev[0]
    const midLat = ((lat0 + next[1] + prev[1]) / 3) * (Math.PI / 180)
    // meters → degrees (local)
    const mLat = 1 / 111_320
    const mLng = 1 / (111_320 * Math.max(0.2, Math.cos(midLat)))
    const len = Math.hypot(dLat / mLat, dLng / mLng) || 1
    // Perpendicular (left of forward = (-dy, dx) in meters frame)
    const nx = (-(dLng / mLng) / len) * sign
    const ny = ((dLat / mLat) / len) * sign
    out.push([lng0 + nx * offsetM * mLng, lat0 + ny * offsetM * mLat])
  }
  return out
}

function sidewalkSidesFromTags(tags: Record<string, string>): Array<'left' | 'right'> {
  const raw = (tags.sidewalk || tags['sidewalk:both'] || '').toLowerCase()
  if (raw === 'left') return ['left']
  if (raw === 'right') return ['right']
  if (raw === 'both' || raw === 'yes' || raw === 'separate') return ['left', 'right']
  // No tag — still synthesize both kerbs for local streets (India: footways rarely mapped).
  const highway = tags.highway || ''
  if (
    highway === 'residential' ||
    highway === 'living_street' ||
    highway === 'unclassified' ||
    highway === 'service' ||
    highway === 'tertiary' ||
    highway === 'secondary'
  ) {
    return ['left', 'right']
  }
  return []
}

function buildQuery(south: number, west: number, north: number, east: number) {
  const b = `${south},${west},${north},${east}`
  return `
[out:json][timeout:8];
(
  way["highway"="service"](${b});
  way["service"="driveway"](${b});
  way["service"="parking_aisle"](${b});
  way["highway"="living_street"](${b});
  way["highway"="residential"](${b});
  way["highway"="unclassified"](${b});
  way["highway"="tertiary"](${b});
  way["highway"="secondary"](${b});
  way["highway"="primary"](${b});
  way["highway"="footway"](${b});
  way["highway"="path"](${b});
  way["highway"="pedestrian"](${b});
  way["highway"="steps"](${b});
  way["highway"="crossing"](${b});
  way["highway"="cycleway"](${b});
  way["footway"="sidewalk"](${b});
  way["footway"="crossing"](${b});
  way["sidewalk"](${b});
  way["foot"="designated"](${b});
);
out geom;
`.trim()
}

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: '*/*',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Overpass ${res.status}`)
    const json = (await res.json()) as { elements?: OverpassElement[] }
    return json.elements ?? []
  } finally {
    clearTimeout(timer)
  }
}

function elementToWay(el: OverpassElement): SiteWay | null {
  if (el.type !== 'way' || !el.geometry?.length) return null
  const kind = classify(el.tags)
  if (!kind) return null
  const coordinates = el.geometry
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
    .map((g) => [g.lon, g.lat] as [number, number])
  if (coordinates.length < 2) return null
  return {
    id: `osm-way-${el.id}`,
    kind,
    coordinates,
    name: el.tags?.name,
    highway: el.tags?.highway || el.tags?.service || el.tags?.footway,
    ...(kind === 'sidewalk' && el.tags ? { walkPriority: walkPriorityFromTags(el.tags) } : {}),
  }
}

function synthesizeKerbSidewalks(el: OverpassElement): SiteWay[] {
  if (el.type !== 'way' || !el.geometry?.length || !el.tags) return []
  // Real footways already classified as sidewalk — don't double-offset them.
  if (classify(el.tags) === 'sidewalk') return []
  const sides = sidewalkSidesFromTags(el.tags)
  if (!sides.length) return []
  const coordinates = el.geometry
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
    .map((g) => [g.lon, g.lat] as [number, number])
  if (coordinates.length < 2) return []
  return sides.map((side) => ({
    id: `osm-kerb-${el.id}-${side}`,
    kind: 'sidewalk' as const,
    coordinates: offsetPolyline(coordinates, side, KERB_OFFSET_M),
    name: el.tags?.name ? `${el.tags.name} (${side} kerb)` : undefined,
    highway: 'sidewalk',
    walkPriority: 1,
  }))
}

/** Always resolves (empty on failure). Safe to fire-and-forget beside Google routing. */
export function extractSiteWays(points: { lat: number; lng: number }[]): Promise<SiteWaysExtract> {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const bbox = padBbox(valid.length ? valid : [{ lat: 0, lng: 0 }])
  if (valid.length < 1) return Promise.resolve(emptyExtract(bbox))

  const key = bbox.map((n) => n.toFixed(5)).join(',')
  const hit = cache.get(key)
  if (hit) return hit

  const pending = (async () => {
    try {
      const [south, west, north, east] = bbox
      const elements = await fetchOverpass(buildQuery(south, west, north, east))
      const driveways: SiteWay[] = []
      const sidewalks: SiteWay[] = []
      for (const el of elements) {
        const way = elementToWay(el)
        if (way) {
          if (way.kind === 'driveway') driveways.push(way)
          else sidewalks.push(way)
        }
        // Pull walk off road centerlines even when OSM has no separate footway.
        for (const kerb of synthesizeKerbSidewalks(el)) sidewalks.push(kerb)
      }
      return {
        driveways,
        sidewalks,
        bbox,
        source: 'openstreetmap' as const,
        fetchedAt: new Date().toISOString(),
      }
    } catch {
      return emptyExtract(bbox)
    }
  })()

  cache.set(key, pending)
  return pending
}
