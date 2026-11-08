import type { SiteWay, SiteWaysExtract } from './extractSiteWays'

export type GraphMode = 'DRIVE' | 'WALK'

type NodeId = string

type Graph = {
  nodes: Map<NodeId, { lat: number; lng: number }>
  /** adjacency: node -> [{ to, meters, viaWayId }] */
  edges: Map<NodeId, { to: NodeId; meters: number; wayId: string }[]>
}

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function nodeKey(lat: number, lng: number, precision = 5) {
  return `${lat.toFixed(precision)},${lng.toFixed(precision)}`
}

function waysForMode(
  extract: SiteWaysExtract,
  mode: GraphMode,
  opts?: { sidewalksOnly?: boolean; maxWalkPriority?: number },
): SiteWay[] {
  if (mode === 'DRIVE') {
    // Vehicle network only (roads / driveways / service).
    return extract.driveways
  }
  // Prefer real kerb sidewalks; drop grass/desire `path` unless nothing better exists.
  const maxP = opts?.maxWalkPriority ?? 2
  const ranked = extract.sidewalks.filter((w) => (w.walkPriority ?? 2) <= maxP)
  if (ranked.length) return ranked
  return extract.sidewalks
}

function buildGraph(ways: SiteWay[], linkMeters = 10): Graph {
  const nodes = new Map<NodeId, { lat: number; lng: number }>()
  const edges = new Map<NodeId, { to: NodeId; meters: number; wayId: string }[]>()
  const endpoints = new Set<NodeId>()

  function addNode(lat: number, lng: number) {
    const id = nodeKey(lat, lng)
    if (!nodes.has(id)) nodes.set(id, { lat, lng })
    if (!edges.has(id)) edges.set(id, [])
    return id
  }

  function addEdge(a: NodeId, b: NodeId, dist: number, wayId: string) {
    if (a === b || dist <= 0) return
    edges.get(a)!.push({ to: b, meters: dist, wayId })
    edges.get(b)!.push({ to: a, meters: dist, wayId })
  }

  for (const way of ways) {
    const ids: NodeId[] = []
    for (const [lng, lat] of way.coordinates) {
      ids.push(addNode(lat, lng))
    }
    if (ids.length) {
      endpoints.add(ids[0])
      endpoints.add(ids[ids.length - 1])
    }
    // Cost: kerb sidewalks cheap; grass paths expensive so Dijkstra avoids them.
    const pri = way.walkPriority ?? 2
    const costMul = pri <= 1 ? 1 : pri === 2 ? 1.35 : 3.2
    for (let i = 1; i < ids.length; i++) {
      const a = nodes.get(ids[i - 1])!
      const b = nodes.get(ids[i])!
      addEdge(ids[i - 1], ids[i], meters(a, b) * costMul, way.id)
    }
  }

  // Link nearby way endpoints so OSM fragments connect (not every vertex — too costly).
  const ends = [...endpoints]
  for (let i = 0; i < ends.length; i++) {
    const a = nodes.get(ends[i])!
    for (let j = i + 1; j < ends.length; j++) {
      const b = nodes.get(ends[j])!
      const d = meters(a, b)
      if (d > 0 && d <= linkMeters) addEdge(ends[i], ends[j], d, 'link')
    }
  }

  return { nodes, edges }
}

function nearestNode(
  graph: Graph,
  point: { lat: number; lng: number },
  maxMeters = 75,
): NodeId | null {
  let best: NodeId | null = null
  let bestD = Infinity
  for (const [id, n] of graph.nodes) {
    const d = meters(point, n)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  if (best == null || bestD > maxMeters) return null
  return best
}

function dijkstra(
  graph: Graph,
  start: NodeId,
  end: NodeId,
): { path: NodeId[]; distanceM: number } | null {
  const dist = new Map<NodeId, number>()
  const prev = new Map<NodeId, NodeId>()
  const open = new Set<NodeId>([start])
  dist.set(start, 0)

  while (open.size) {
    let u: NodeId | null = null
    let best = Infinity
    for (const id of open) {
      const d = dist.get(id) ?? Infinity
      if (d < best) {
        best = d
        u = id
      }
    }
    if (u == null) break
    open.delete(u)
    if (u === end) break
    for (const e of graph.edges.get(u) ?? []) {
      const nd = best + e.meters
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd)
        prev.set(e.to, u)
        open.add(e.to)
      }
    }
  }

  if (!dist.has(end)) return null
  const path: NodeId[] = [end]
  for (let cur = end; cur !== start; ) {
    const p = prev.get(cur)
    if (!p) return null
    path.push(p)
    cur = p
  }
  path.reverse()
  return { path, distanceM: dist.get(end) ?? 0 }
}

export type SiteRouteResult = {
  path: google.maps.LatLngLiteral[]
  distanceM: number
  mode: GraphMode
  source: 'osm-site-graph' | 'osm-sidewalks'
}

function routeOnce(
  ways: SiteWay[],
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: GraphMode,
): { path: google.maps.LatLngLiteral[]; distanceM: number } | null {
  if (ways.length < 1) return null
  const graph = buildGraph(ways, mode === 'WALK' ? 14 : 10)
  if (graph.nodes.size < 2) return null
  const start = nearestNode(graph, origin, mode === 'WALK' ? 90 : 80)
  const end = nearestNode(graph, destination, mode === 'WALK' ? 90 : 80)
  if (!start || !end) return null
  const solved = dijkstra(graph, start, end)
  if (!solved || solved.path.length < 2) return null
  const path: google.maps.LatLngLiteral[] = solved.path.map((id) => {
    const n = graph.nodes.get(id)!
    return { lat: n.lat, lng: n.lng }
  })
  const MAX_CONNECT = 28
  if (meters(origin, path[0]) <= MAX_CONNECT) path.unshift({ ...origin })
  if (meters(destination, path[path.length - 1]) <= MAX_CONNECT) path.push({ ...destination })
  return { path, distanceM: Math.round(solved.distanceM) }
}

/**
 * Project a point onto the nearest sidewalk segment (building-side kerb preferred).
 * Used to pull Google walk polylines off road medians / grass verges onto real sidewalks.
 */
export function snapPointToSidewalks(
  point: { lat: number; lng: number },
  sidewalks: SiteWay[],
  maxMeters = 18,
): { lat: number; lng: number; distM: number } | null {
  const preferred = sidewalks.filter((w) => (w.walkPriority ?? 2) <= 2)
  const pool = preferred.length ? preferred : sidewalks
  let best: { lat: number; lng: number; distM: number } | null = null
  for (const way of pool) {
    const pri = way.walkPriority ?? 2
    // Slightly prefer priority-1 sidewalks when distances are similar.
    const priBias = pri <= 1 ? 0 : pri === 2 ? 1.5 : 4
    const coords = way.coordinates
    for (let i = 0; i < coords.length - 1; i++) {
      const a = { lat: coords[i][1], lng: coords[i][0] }
      const b = { lat: coords[i + 1][1], lng: coords[i + 1][0] }
      const abx = b.lng - a.lng
      const aby = b.lat - a.lat
      const len2 = abx * abx + aby * aby
      const t =
        len2 > 0
          ? Math.max(0, Math.min(1, ((point.lng - a.lng) * abx + (point.lat - a.lat) * aby) / len2))
          : 0
      const lat = a.lat + aby * t
      const lng = a.lng + abx * t
      const distM = meters(point, { lat, lng }) + priBias
      if (!best || distM < best.distM) best = { lat, lng, distM }
    }
  }
  if (!best) return null
  const raw = meters(point, { lat: best.lat, lng: best.lng })
  if (raw > maxMeters) return null
  return { lat: best.lat, lng: best.lng, distM: raw }
}

/** Pull an entire walk polyline onto kerb sidewalks when OSM has them nearby. */
export function snapPathToSidewalks(
  path: google.maps.LatLngLiteral[],
  sidewalks: SiteWay[],
  maxMeters = 18,
): google.maps.LatLngLiteral[] {
  if (!path.length || !sidewalks.length) return path
  const kerb = sidewalks.filter((w) => (w.walkPriority ?? 2) <= 2)
  const pool = kerb.length ? kerb : sidewalks
  let snapped = 0
  const out = path.map((p) => {
    const hit = snapPointToSidewalks(p, pool, maxMeters)
    if (!hit) return { ...p }
    snapped += 1
    return { lat: hit.lat, lng: hit.lng }
  })
  // Only keep snap if enough vertices moved onto sidewalks (avoid jittering a good path).
  if (snapped < Math.max(2, Math.floor(path.length * 0.35))) return path
  return out
}

/**
 * Route on extracted OSM driveway / sidewalk linework (separate graphs by mode).
 */
export function routeOnSiteWays(
  extract: SiteWaysExtract,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: GraphMode,
  opts?: { sidewalksOnly?: boolean },
): SiteRouteResult | null {
  if (mode === 'WALK') {
    // Try kerb sidewalks first, then footways, then any pedestrian way.
    for (const maxWalkPriority of [1, 2, 3]) {
      const ways = waysForMode(extract, mode, { ...opts, maxWalkPriority })
      const solved = routeOnce(ways, origin, destination, mode)
      if (solved) {
        return {
          path: solved.path,
          distanceM: solved.distanceM,
          mode,
          source: 'osm-sidewalks',
        }
      }
    }
    return null
  }

  const ways = waysForMode(extract, mode, opts)
  const solved = routeOnce(ways, origin, destination, mode)
  if (!solved) return null
  return {
    path: solved.path,
    distanceM: solved.distanceM,
    mode,
    source: opts?.sidewalksOnly ? 'osm-sidewalks' : 'osm-site-graph',
  }
}
