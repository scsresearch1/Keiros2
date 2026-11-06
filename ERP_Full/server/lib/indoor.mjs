/**
 * Indoor wayfinding: graph route through building locations
 * (entry → corridors / vertical cores → unit) with turn-by-turn cues.
 */

import {
  enrichLocation,
  enrichLocations,
  filterBuildingOutliers,
  inferLocationType,
  isStairish,
  isVerticalish,
  stairChainOrder,
} from './locationLabels.mjs'

export function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const φ1 = toRad(a.latitude)
  const φ2 = toRad(b.latitude)
  const Δλ = toRad(b.longitude - a.longitude)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function turnWord(fromBearing, toBearing) {
  let d = ((toBearing - fromBearing + 540) % 360) - 180
  if (Math.abs(d) < 28) return 'straight'
  if (d >= 28 && d < 60) return 'slight-right'
  if (d >= 60 && d < 135) return 'right'
  if (d >= 135) return 'sharp-right'
  if (d <= -28 && d > -60) return 'slight-left'
  if (d <= -60 && d > -135) return 'left'
  return 'sharp-left'
}

const HUB_TYPES = new Set(['Corridor', 'Lobby', 'Entry', 'Exit', 'Elevator', 'Stairs', 'Door', 'Amenity'])
const VERTICAL_TYPES = new Set(['Elevator', 'Stairs'])

function effectiveType(loc) {
  return inferLocationType(loc)
}

function isHub(loc) {
  const type = effectiveType(loc)
  if (type === 'Unit' || type === 'Room') return false
  return HUB_TYPES.has(type) || /corridor|hall|lobby|elevator|stair|door|entry/i.test(loc.name || '')
}

function edgeCost(a, b) {
  let meters = haversineMeters(a, b)
  // Prefer corridors / hubs over cutting through random units
  if (!isHub(a) && !isHub(b)) meters *= 1.35
  if (VERTICAL_TYPES.has(effectiveType(a)) || VERTICAL_TYPES.has(effectiveType(b))) meters *= 0.92
  if (effectiveType(a) === 'Unit' && effectiveType(b) === 'Unit') meters *= 1.55
  meters += Math.abs((a.elevation || 0) - (b.elevation || 0)) * 0.4
  return meters
}

/** Same-floor kNN graph + Dijkstra. */
function dijkstraFloor(from, to, floorLocs) {
  if (from.id === to.id) return [from]
  const nodes = floorLocs.filter((l) => l.id)
  if (!nodes.find((n) => n.id === from.id) || !nodes.find((n) => n.id === to.id)) {
    return [from, to]
  }

  const k = Math.min(6, Math.max(3, nodes.length - 1))
  const adj = new Map()
  for (const n of nodes) adj.set(n.id, [])

  for (const a of nodes) {
    const ranked = nodes
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, d: haversineMeters(a, b) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, k)
    for (const { b, d } of ranked) {
      // Cap edge length so we do not jump across the whole floor in one hop
      const maxEdge = 90
      if (d > maxEdge && !isHub(a) && !isHub(b)) continue
      const cost = edgeCost(a, b)
      adj.get(a.id).push({ id: b.id, cost })
      adj.get(b.id).push({ id: a.id, cost })
    }
  }

  // Always connect start/end to their nearest hubs
  for (const endpoint of [from, to]) {
    const hubs = nodes.filter((n) => isHub(n) && n.id !== endpoint.id)
    hubs.sort((a, b) => haversineMeters(endpoint, a) - haversineMeters(endpoint, b))
    for (const h of hubs.slice(0, 3)) {
      const cost = edgeCost(endpoint, h)
      adj.get(endpoint.id).push({ id: h.id, cost })
      adj.get(h.id).push({ id: endpoint.id, cost })
    }
  }

  // Guarantee direct edge as fallback
  adj.get(from.id).push({ id: to.id, cost: edgeCost(from, to) * 1.2 })
  adj.get(to.id).push({ id: from.id, cost: edgeCost(from, to) * 1.2 })

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const dist = new Map(nodes.map((n) => [n.id, Infinity]))
  const prev = new Map()
  dist.set(from.id, 0)
  const open = new Set(nodes.map((n) => n.id))

  while (open.size) {
    let u = null
    let best = Infinity
    for (const id of open) {
      const d = dist.get(id)
      if (d < best) {
        best = d
        u = id
      }
    }
    if (u == null || best === Infinity) break
    open.delete(u)
    if (u === to.id) break
    for (const { id: v, cost } of adj.get(u) || []) {
      if (!open.has(v)) continue
      const alt = best + cost
      if (alt < dist.get(v)) {
        dist.set(v, alt)
        prev.set(v, u)
      }
    }
  }

  if (!prev.has(to.id) && from.id !== to.id) {
    return [from, to]
  }

  const path = []
  let cur = to.id
  path.push(byId.get(cur))
  while (prev.has(cur)) {
    cur = prev.get(cur)
    path.push(byId.get(cur))
  }
  path.reverse()
  return path.filter(Boolean)
}

function pickVertical(buildingLocs, fromFloorId, toFloorId, nearFrom, nearTo) {
  const cores = buildingLocs.filter((l) => isVerticalish(l) || VERTICAL_TYPES.has(effectiveType(l)))
  if (!cores.length) return null
  // Prefer elevator, then stairs; score by distance to both ends
  return [...cores].sort((a, b) => {
    const score = (c) => {
      const typeBias = effectiveType(c) === 'Elevator' ? 0 : 18
      return (
        typeBias +
        haversineMeters(nearFrom, c) +
        haversineMeters(nearTo, { ...c, floorId: toFloorId, latitude: nearTo.latitude, longitude: nearTo.longitude })
      )
    }
    return score(a) - score(b)
  })[0]
}

function floorRank(loc) {
  const label = String(loc?.floorLabel || '')
  if (/stair/i.test(label)) return 1.5
  const m = label.match(/L?\s*(\d+(?:\.\d+)?)/i)
  if (m) return Number(m[1])
  if (Number.isFinite(loc?.level)) return Number(loc.level)
  return 0
}

/**
 * Ordered vertical / stair chain between floors (Start → turn → Top),
 * inferred from labels when Keriosa locked a walkable stair sequence.
 */
function buildVerticalChain(buildingLocs, fromFloorId, toFloorId, nearFrom, nearTo) {
  const verticals = buildingLocs.filter((l) => isVerticalish(l))
  if (!verticals.length) return null

  const elevators = verticals.filter((l) => effectiveType(l) === 'Elevator')
  if (elevators.length && !verticals.some(isStairish)) {
    const core = pickVertical(buildingLocs, fromFloorId, toFloorId, nearFrom, nearTo)
    return core ? [core] : null
  }

  const stairs = verticals.filter(isStairish)
  if (!stairs.length) {
    const core = pickVertical(buildingLocs, fromFloorId, toFloorId, nearFrom, nearTo)
    return core ? [core] : null
  }

  // Prefer the stair cluster nearest the traveler (drops distant GPS outliers).
  const rankedClusters = [...stairs].sort(
    (a, b) =>
      haversineMeters(nearFrom, a) +
      haversineMeters(nearTo, a) -
      (haversineMeters(nearFrom, b) + haversineMeters(nearTo, b)),
  )
  const seed = rankedClusters[0]
  const cluster = stairs.filter((s) => haversineMeters(seed, s) <= 45)
  const ordered = [...cluster].sort((a, b) => {
    const o = stairChainOrder(a) - stairChainOrder(b)
    if (o !== 0) return o
    return floorRank(a) - floorRank(b)
  })

  // Use floor labels (L01/L02), not raw GPS elevation — Keriosa elev is often wrong.
  const ascending = floorRank(nearTo) >= floorRank(nearFrom)
  if (!ascending) ordered.reverse()
  return ordered.length ? ordered : null
}

function appendUnique(path, stop) {
  if (!stop) return
  if (path[path.length - 1]?.id === stop.id) return
  path.push(stop)
}

/**
 * Full indoor path: same-building multi-floor with corridor graph; cross-building via lobbies.
 */
export function routePath(from, to, locations) {
  if (from.id === to.id) return [from]

  if (from.buildingId !== to.buildingId) {
    const fromHub =
      locations.find(
        (location) =>
          location.buildingId === from.buildingId &&
          (location.type === 'Lobby' || location.type === 'Entry'),
      ) ?? from
    const toHub =
      locations.find(
        (location) =>
          location.buildingId === to.buildingId &&
          (location.type === 'Lobby' || location.type === 'Entry'),
      ) ?? to
    const buildingFrom = locations.filter((l) => l.buildingId === from.buildingId && l.floorId === from.floorId)
    const buildingTo = locations.filter((l) => l.buildingId === to.buildingId && l.floorId === to.floorId)
    const legA = dijkstraFloor(from, fromHub, buildingFrom.length ? buildingFrom : [from, fromHub])
    const legB = dijkstraFloor(toHub, to, buildingTo.length ? buildingTo : [toHub, to])
    const merged = [...legA]
    if (toHub.id !== fromHub.id) merged.push(toHub)
    for (const s of legB) {
      if (merged[merged.length - 1]?.id !== s.id) merged.push(s)
    }
    return merged
  }

  if (from.floorId !== to.floorId) {
    const buildingLocs = filterBuildingOutliers(
      locations.filter((l) => l.buildingId === from.buildingId),
    )
    const fromFloor = buildingLocs.filter((l) => l.floorId === from.floorId)
    const toFloor = buildingLocs.filter((l) => l.floorId === to.floorId)
    const chain = buildVerticalChain(buildingLocs, from.floorId, to.floorId, from, to)
    if (!chain?.length) {
      return [...dijkstraFloor(from, to, [...fromFloor, ...toFloor, from, to])]
    }

    const first = chain[0]
    const last = chain[chain.length - 1]
    // Approach first stair/elevator on the departure floor.
    const onFrom =
      fromFloor.find((l) => l.id === first.id) ||
      fromFloor.find((l) => isVerticalish(l)) ||
      {
        ...first,
        floorId: from.floorId,
        floorLabel: from.floorLabel,
        elevation: from.elevation,
      }
    const onTo =
      toFloor.find((l) => l.id === last.id) ||
      toFloor.find((l) => isVerticalish(l)) || {
        ...last,
        floorId: to.floorId,
        floorLabel: to.floorLabel,
        elevation: to.elevation ?? last.elevation,
        id: last.id,
        name: /L\d+/i.test(String(last.name)) ? last.name : `${last.name} (${to.floorLabel})`,
      }

    const legA = dijkstraFloor(from, onFrom, fromFloor.length ? [...fromFloor, onFrom] : [from, onFrom])
    const path = [...legA]
    // Walk the labeled stair chain once (Start → turn → Top), then finish on the destination floor.
    for (const node of chain) appendUnique(path, node)
    appendUnique(path, onTo)
    const legBNodes = toFloor.filter((l) => !isVerticalish(l) || l.id === onTo.id || l.id === to.id)
    const legB = dijkstraFloor(
      onTo,
      to,
      legBNodes.length ? [...legBNodes, onTo, to] : [onTo, to],
    )
    for (const s of legB) appendUnique(path, s)
    return path
  }

  const floorLocs = locations.filter(
    (l) => l.buildingId === from.buildingId && l.floorId === from.floorId,
  )
  return dijkstraFloor(from, to, floorLocs.length ? floorLocs : [from, to])
}

export function nearestEntry(locations, preferNear = null, preferFloorId = null) {
  let pool = locations.filter((l) => {
    const t = effectiveType(l)
    return t === 'Entry' || t === 'Lobby' || t === 'Door'
  })
  if (!pool.length) pool = locations.filter((l) => isHub(l))
  if (!pool.length && preferNear) {
    // No portals left — use the geographically nearest other stop as a synthetic start.
    pool = locations.filter((l) => l.id !== preferNear.id)
  }
  if (preferFloorId) {
    const sameFloor = pool.filter((l) => l.floorId === preferFloorId)
    if (sameFloor.length) pool = sameFloor
  }
  if (!pool.length) return locations[0] ?? null
  const scored = pool
    .map((l) => {
      const t = effectiveType(l)
      const typeScore = t === 'Entry' ? 0 : t === 'Lobby' ? 1 : t === 'Door' ? 2 : 3
      const dist = preferNear ? haversineMeters(preferNear, l) : 0
      return { l, score: typeScore * 40 + dist }
    })
    .sort((a, b) => a.score - b.score)
  return scored[0]?.l ?? locations[0] ?? null
}

export function pathDistanceMeters(stops) {
  let sum = 0
  for (let i = 1; i < stops.length; i += 1) {
    sum += haversineMeters(stops[i - 1], stops[i])
    sum += Math.abs((stops[i].elevation || 0) - (stops[i - 1].elevation || 0)) * 0.35
  }
  return sum
}

export function estimateWalkMinutes(distanceM, floorChanges) {
  const speedMps = 1.25
  return Math.round(((distanceM / speedMps) / 60 + floorChanges * 0.55) * 10) / 10
}

/** Google Maps–style indoor cues — short, one action. */
function instructionForStop(stops, i, destinationLabel) {
  const stop = stops[i]
  const prev = stops[i - 1]
  const next = stops[i + 1]
  const dist = prev ? Math.round(haversineMeters(prev, stop)) : 0
  const floor = stop.floorLabel || 'this floor'

  if (i === 0) {
    return {
      instruction: `Enter at ${stop.name}`,
      title: 'Inside · Enter',
      maneuver: 'enter',
    }
  }

  if (prev && prev.floorId !== stop.floorId) {
    const elev = /elevator/i.test(`${prev.type} ${prev.name}`)
    return {
      instruction: elev ? `Take the elevator to ${floor}` : `Take the stairs to ${floor}`,
      title: `Inside · ${floor}`,
      maneuver: 'vertical',
      distanceM: dist,
    }
  }

  if (i === stops.length - 1) {
    const turn = prev && stops[i - 2] ? turnWord(bearingDeg(stops[i - 2], prev), bearingDeg(prev, stop)) : 'straight'
    const label = stop.name || destinationLabel || 'destination'
    if (turn === 'left' || turn === 'sharp-left') {
      return { instruction: `Turn left to ${label}`, title: 'Inside · Arrive', maneuver: 'arrive', distanceM: dist }
    }
    if (turn === 'right' || turn === 'sharp-right') {
      return { instruction: `Turn right to ${label}`, title: 'Inside · Arrive', maneuver: 'arrive', distanceM: dist }
    }
    return { instruction: `Arrive at ${label}`, title: 'Inside · Arrive', maneuver: 'arrive', distanceM: dist }
  }

  if (VERTICAL_TYPES.has(effectiveType(stop)) || isVerticalish(stop)) {
    const elev = effectiveType(stop) === 'Elevator'
    const targetFloor = next?.floorLabel || floor
    return {
      instruction: elev ? `Elevator to ${targetFloor}` : `Stairs to ${targetFloor}`,
      title: `Inside · ${elev ? 'Elevator' : 'Stairs'}`,
      maneuver: elev ? 'elevator' : 'stairs',
      distanceM: dist,
    }
  }

  if (prev) {
    const brFrom = stops[i - 2] ? bearingDeg(stops[i - 2], prev) : bearingDeg(prev, stop)
    const brTo = bearingDeg(prev, stop)
    const turn = turnWord(brFrom, brTo)
    const place = stop.name || 'ahead'
    if (turn === 'left' || turn === 'sharp-left') {
      return { instruction: `Turn left to ${place}`, title: `Inside · Step ${i + 1}`, maneuver: turn, distanceM: dist }
    }
    if (turn === 'right' || turn === 'sharp-right') {
      return { instruction: `Turn right to ${place}`, title: `Inside · Step ${i + 1}`, maneuver: turn, distanceM: dist }
    }
    if (turn === 'slight-left') {
      return { instruction: `Bear left to ${place}`, title: `Inside · Step ${i + 1}`, maneuver: turn, distanceM: dist }
    }
    if (turn === 'slight-right') {
      return { instruction: `Bear right to ${place}`, title: `Inside · Step ${i + 1}`, maneuver: turn, distanceM: dist }
    }
    return { instruction: `Continue to ${place}`, title: `Inside · Step ${i + 1}`, maneuver: 'straight', distanceM: dist }
  }

  return {
    instruction: `Go to ${stop.name}`,
    title: `Inside · Step ${i + 1}`,
    maneuver: 'straight',
    distanceM: dist,
  }
}

export function buildIndoorJourney(destination, allLocations) {
  const enrichedAll = enrichLocations(allLocations)
  const dest = enrichLocation(destination)
  let buildingLocs = filterBuildingOutliers(
    enrichedAll.filter((l) => l.buildingId === dest.buildingId && l.mapped !== false),
  )
  if (!buildingLocs.length) {
    buildingLocs = enrichedAll.filter((l) => l.buildingId === dest.buildingId)
  }

  // Multi-floor units: start at a ground / nearest Entry, then climb via stairs/elevator.
  // (Preferring the destination floor wrongly skipped L01 doors when only L02 was mapped.)
  const entry =
    nearestEntry(buildingLocs, dest) ||
    nearestEntry(buildingLocs, dest, dest.floorId) ||
    buildingLocs[0] ||
    dest
  if (!entry || entry.id === dest.id) {
    const sameFloor = buildingLocs.filter((l) => l.floorId === dest.floorId)
    const neighbor =
      [...sameFloor]
        .filter((l) => l.id !== dest.id)
        .sort((a, b) => haversineMeters(dest, a) - haversineMeters(dest, b))[0] || null
    const stops = neighbor ? [neighbor, dest] : [dest]
    const distanceM = pathDistanceMeters(stops)
    const cues = stops.map((_, i) => instructionForStop(stops, i, dest.name))
    return {
      stops,
      distanceM: Math.round(distanceM),
      walkMinutes: estimateWalkMinutes(distanceM, 0),
      floorChanges: 0,
      entry: neighbor || dest,
      cues,
    }
  }
  const stops = routePath(entry, dest, buildingLocs)
  const floorChanges = Math.max(0, new Set(stops.map((s) => s.floorId)).size - 1)
  const distanceM = pathDistanceMeters(stops)
  const cues = stops.map((_, i) => instructionForStop(stops, i, dest.name))
  return {
    stops,
    distanceM: Math.round(distanceM),
    walkMinutes: estimateWalkMinutes(distanceM, floorChanges),
    floorChanges,
    entry,
    cues,
  }
}

/** Build journey step payloads for the navigate API response. */
export function buildIndoorSteps(indoor, destinationLabel, indexOffset = 0) {
  const stops = indoor.stops || []
  const cues = indoor.cues || stops.map((_, i) => instructionForStop(stops, i, destinationLabel))
  return stops.map((stop, i) => {
    const cue = cues[i] || {}
    const prev = stops[i - 1]
    const distanceM =
      cue.distanceM ??
      (prev
        ? Math.round(haversineMeters(prev, stop))
        : 0)
    return {
      id: `in-${i}`,
      phase: 'indoor',
      index: indexOffset + i,
      indoorIndex: i,
      instruction: cue.instruction || `Go to ${stop.name}`,
      title: cue.title || `Inside · Step ${i + 1}`,
      maneuver: cue.maneuver || 'straight',
      distanceM,
      durationSec: distanceM > 0 ? Math.round(distanceM / 1.25) : 0,
      latitude: stop.latitude,
      longitude: stop.longitude,
      floorLabel: stop.floorLabel,
      floorId: stop.floorId,
      stopId: stop.id,
      stopName: stop.name,
      stopType: stop.type,
    }
  })
}

export function serializeStop(loc) {
  const e = enrichLocation(loc)
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    code: e.code,
    floorId: e.floorId,
    floorLabel: e.floorLabel,
    buildingId: e.buildingId,
    buildingName: e.buildingName,
    latitude: e.latitude,
    longitude: e.longitude,
    elevation: e.elevation,
    physicalAddress: e.physicalAddress || e.address || e.labelSourceName || null,
  }
}
