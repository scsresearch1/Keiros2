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
  opts?: { sidewalksOnly?: boolean },
): SiteWay[] {
  if (mode === 'DRIVE') {
    // Vehicle network only (roads / driveways / service).
    return extract.driveways
  }
  // Prefer pure sidewalks/footways to the entry door when available.
  if (opts?.sidewalksOnly) return extract.sidewalks
  // Fallback: sidewalks + service drives (apartment loops people walk on).
  return [...extract.sidewalks, ...extract.driveways]
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
    for (let i = 1; i < ids.length; i++) {
      const a = nodes.get(ids[i - 1])!
      const b = nodes.get(ids[i])!
      addEdge(ids[i - 1], ids[i], meters(a, b), way.id)
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
  const ways = waysForMode(extract, mode, opts)
  if (ways.length < 1) return null

  const graph = buildGraph(ways, mode === 'WALK' ? 12 : 10)
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

  // Attach true endpoints when within a short connector (stay honest — no long chords).
  const MAX_CONNECT = 28
  if (meters(origin, path[0]) <= MAX_CONNECT) path.unshift({ ...origin })
  if (meters(destination, path[path.length - 1]) <= MAX_CONNECT) path.push({ ...destination })

  return {
    path,
    distanceM: Math.round(solved.distanceM),
    mode,
    source: opts?.sidewalksOnly ? 'osm-sidewalks' : 'osm-site-graph',
  }
}
