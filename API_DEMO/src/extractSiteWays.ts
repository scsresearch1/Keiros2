/**
 * Extract real driveway vs sidewalk geometries from OpenStreetMap (Overpass).
 * Google Maps does not expose these as separate layers — OSM is the practical source.
 */

export type SiteWayKind = 'driveway' | 'sidewalk'

export type SiteWay = {
  id: string
  kind: SiteWayKind
  /** [lng, lat] rings matching GeoJSON order */
  coordinates: [number, number][]
  name?: string
  highway?: string
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

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

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
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
  }
  if (!Number.isFinite(south)) {
    return [0, 0, 0, 0]
  }
  return [south - padDeg, west - padDeg, north + padDeg, east + padDeg]
}

function classify(tags: Record<string, string> | undefined): SiteWayKind | null {
  if (!tags) return null
  const highway = tags.highway || ''
  const service = tags.service || ''
  const footway = tags.footway || ''

  // Explicit pedestrian / sidewalk network
  if (
    highway === 'footway' ||
    highway === 'path' ||
    highway === 'pedestrian' ||
    highway === 'steps' ||
    highway === 'crossing' ||
    footway === 'sidewalk' ||
    footway === 'crossing' ||
    (highway === 'cycleway' && /yes|designated|permissive/i.test(tags.foot || ''))
  ) {
    return 'sidewalk'
  }

  // Driveways, parking aisles, private service roads (apartment loops)
  if (
    service === 'driveway' ||
    service === 'parking_aisle' ||
    highway === 'service' ||
    highway === 'living_street' ||
    highway === 'residential' ||
    highway === 'unclassified' ||
    highway === 'tertiary' ||
    highway === 'secondary' ||
    highway === 'primary' ||
    highway === 'trunk' ||
    highway === 'motorway' ||
    highway === 'motorway_link' ||
    highway === 'primary_link' ||
    highway === 'secondary_link' ||
    highway === 'tertiary_link'
  ) {
    return 'driveway'
  }

  return null
}

function buildQuery(south: number, west: number, north: number, east: number) {
  // bbox order in Overpass: south,west,north,east
  const b = `${south},${west},${north},${east}`
  return `
[out:json][timeout:25];
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
  way["footway"="sidewalk"](${b});
  way["footway"="crossing"](${b});
  way["highway"="cycleway"]["foot"~"yes|designated|permissive"](${b});
);
out geom;
`.trim()
}

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  let lastErr: Error | null = null
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (!res.ok) throw new Error(`Overpass ${res.status}`)
      const json = (await res.json()) as { elements?: OverpassElement[]; remark?: string }
      return json.elements ?? []
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastErr ?? new Error('Overpass failed')
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
  }
}

/**
 * Pull driveway + sidewalk linework around the route points from OpenStreetMap.
 */
export function extractSiteWays(points: { lat: number; lng: number }[]): Promise<SiteWaysExtract> {
  const bbox = padBbox(points)
  const key = bbox.map((n) => n.toFixed(5)).join(',')
  const hit = cache.get(key)
  if (hit) return hit

  const pending = (async () => {
    const [south, west, north, east] = bbox
    const elements = await fetchOverpass(buildQuery(south, west, north, east))
    const driveways: SiteWay[] = []
    const sidewalks: SiteWay[] = []
    for (const el of elements) {
      const way = elementToWay(el)
      if (!way) continue
      if (way.kind === 'driveway') driveways.push(way)
      else sidewalks.push(way)
    }
    return {
      driveways,
      sidewalks,
      bbox,
      source: 'openstreetmap' as const,
      fetchedAt: new Date().toISOString(),
    }
  })()

  cache.set(key, pending)
  pending.catch(() => cache.delete(key))
  return pending
}
