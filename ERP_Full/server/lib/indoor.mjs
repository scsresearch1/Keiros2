/**
 * Indoor wayfinding: graph route through building locations
 * (entry → corridors / vertical cores → unit) with turn-by-turn cues.
 */

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

/** Keriosa often stored dwellings as type Entry — treat those as units for routing. */
function looksLikeDwelling(label) {
  const t = String(label || '').trim()
  if (!t) return false
  if (/\b(unit|suite|apt\.?|apartment)\s*[#-]?\s*[a-z0-9-]+\b/i.test(t)) return true
  if (/#\s*\d{1,4}[a-z]?\b/i.test(t)) return true
  return false
}

function effectiveType(loc) {
  if (loc?.type === 'Entry' && looksLikeDwelling(loc.name)) return 'Unit'
  return loc?.type
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
  const cores = buildingLocs.filter((l) => VERTICAL_TYPES.has(l.type))
  if (!cores.length) return null
  // Prefer elevator, then stairs; score by distance to both ends
  return [...cores].sort((a, b) => {
    const score = (c) => {
      const typeBias = c.type === 'Elevator' ? 0 : 18
      return (
        typeBias +
        haversineMeters(nearFrom, c) +
        haversineMeters(nearTo, { ...c, floorId: toFloorId, latitude: nearTo.latitude, longitude: nearTo.longitude })
      )
    }
    return score(a) - score(b)
  })[0]
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
    const buildingLocs = locations.filter((l) => l.buildingId === from.buildingId)
    const fromFloor = buildingLocs.filter((l) => l.floorId === from.floorId)
    const toFloor = buildingLocs.filter((l) => l.floorId === to.floorId)
    const vertical = pickVertical(buildingLocs, from.floorId, to.floorId, from, to)
    if (!vertical) {
      return [...dijkstraFloor(from, to, [...fromFloor, ...toFloor, from, to])]
    }
    const vertOnFrom = {
      ...vertical,
      floorId: from.floorId,
      floorLabel: from.floorLabel,
      elevation: from.elevation,
    }
    // Prefer a vertical core that exists on this floor listing; else use the building core coords
    const onFrom =
      fromFloor.find((l) => l.type === vertical.type && /elevator|stair/i.test(`${l.type}${l.name}`)) ||
      fromFloor.find((l) => l.id === vertical.id) ||
      vertOnFrom
    const onTo = {
      ...(toFloor.find((l) => l.type === vertical.type) || vertical),
      floorId: to.floorId,
      floorLabel: to.floorLabel,
      elevation: to.elevation,
      id: `${vertical.id}→${to.floorId}`,
      name: `${vertical.name} (${to.floorLabel})`,
    }
    const legA = dijkstraFloor(from, onFrom, fromFloor.length ? [...fromFloor, onFrom] : [from, onFrom])
    const legB = dijkstraFloor(onTo, to, toFloor.length ? [...toFloor, onTo] : [onTo, to])
    const path = [...legA]
    if (path[path.length - 1]?.id !== onTo.id) path.push(onTo)
    for (const s of legB) {
      if (path[path.length - 1]?.id !== s.id) path.push(s)
    }
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

function instructionForStop(stops, i, destinationLabel) {
  const stop = stops[i]
  const prev = stops[i - 1]
  const next = stops[i + 1]
  const dist = prev ? Math.round(haversineMeters(prev, stop)) : 0

  if (i === 0) {
    return {
      instruction: `Enter at ${stop.name} (${stop.floorLabel}) and start indoor navigation`,
      title: 'Inside · Enter',
      maneuver: 'enter',
    }
  }

  if (prev && prev.floorId !== stop.floorId) {
    const via = /elevator/i.test(`${prev.type} ${prev.name}`)
      ? 'Take the elevator'
      : /stair/i.test(`${prev.type} ${prev.name}`)
        ? 'Take the stairs'
        : 'Change floors'
    return {
      instruction: `${via} to ${stop.floorLabel}, then continue toward ${next?.name || destinationLabel}`,
      title: `Inside · ${stop.floorLabel}`,
      maneuver: 'vertical',
      distanceM: dist,
    }
  }

  if (i === stops.length - 1) {
    const turn = prev && stops[i - 2] ? turnWord(bearingDeg(stops[i - 2], prev), bearingDeg(prev, stop)) : 'straight'
    const cue =
      turn === 'left' || turn === 'sharp-left'
        ? 'Turn left and '
        : turn === 'right' || turn === 'sharp-right'
          ? 'Turn right and '
          : turn === 'slight-left'
            ? 'Bear left and '
            : turn === 'slight-right'
              ? 'Bear right and '
              : ''
    const arriveLine = `${cue}arrive at ${stop.name}${destinationLabel ? ` · ${destinationLabel}` : ''}`
    return {
      instruction: arriveLine.charAt(0).toUpperCase() + arriveLine.slice(1),
      title: 'Inside · Arrive',
      maneuver: 'arrive',
      distanceM: dist,
    }
  }

  if (VERTICAL_TYPES.has(stop.type) || /elevator|stair/i.test(stop.name || '')) {
    const goingUp = next && (next.elevation || 0) > (stop.elevation || 0)
    return {
      instruction: `Go to the ${stop.type === 'Elevator' ? 'elevator' : 'stairs'} (${stop.name}) for ${next?.floorLabel || 'the next floor'}${goingUp ? ' · up' : ''}`,
      title: `Inside · ${stop.type}`,
      maneuver: stop.type === 'Elevator' ? 'elevator' : 'stairs',
      distanceM: dist,
    }
  }

  if (prev) {
    const brFrom = stops[i - 2] ? bearingDeg(stops[i - 2], prev) : bearingDeg(prev, stop)
    const brTo = bearingDeg(prev, stop)
    const turn = turnWord(brFrom, brTo)
    const place =
      stop.type === 'Corridor'
        ? `the corridor toward ${stop.name}`
        : stop.type === 'Door'
          ? `the door at ${stop.name}`
          : stop.name
    const verb =
      turn === 'left' || turn === 'sharp-left'
        ? `Turn left toward ${place}`
        : turn === 'right' || turn === 'sharp-right'
          ? `Turn right toward ${place}`
          : turn === 'slight-left'
            ? `Bear left toward ${place}`
            : turn === 'slight-right'
              ? `Bear right toward ${place}`
              : `Continue to ${place}`
    const meters = dist >= 8 ? ` (${dist} m)` : ''
    return {
      instruction: `${verb}${meters}`,
      title: `Inside · Step ${i + 1}`,
      maneuver: turn,
      distanceM: dist,
    }
  }

  return {
    instruction: `Go to ${stop.name} (${stop.floorLabel})`,
    title: `Inside · Step ${i + 1}`,
    maneuver: 'straight',
    distanceM: dist,
  }
}

export function buildIndoorJourney(destination, allLocations) {
  const buildingLocs = allLocations.filter((l) => l.buildingId === destination.buildingId)
  // Prefer an entrance on the destination floor so indoor nav starts where the unit lives.
  const entry =
    nearestEntry(buildingLocs, destination, destination.floorId) ||
    nearestEntry(buildingLocs, destination) ||
    buildingLocs[0] ||
    destination
  if (!entry || entry.id === destination.id) {
    const sameFloor = buildingLocs.filter((l) => l.floorId === destination.floorId)
    const neighbor =
      [...sameFloor]
        .filter((l) => l.id !== destination.id)
        .sort((a, b) => haversineMeters(destination, a) - haversineMeters(destination, b))[0] || null
    const stops = neighbor ? [neighbor, destination] : [destination]
    const distanceM = pathDistanceMeters(stops)
    const cues = stops.map((_, i) => instructionForStop(stops, i, destination.name))
    return {
      stops,
      distanceM: Math.round(distanceM),
      walkMinutes: estimateWalkMinutes(distanceM, 0),
      floorChanges: 0,
      entry: neighbor || destination,
      cues,
    }
  }
  const stops = routePath(entry, destination, allLocations)
  const floorChanges = Math.max(0, new Set(stops.map((s) => s.floorId)).size - 1)
  const distanceM = pathDistanceMeters(stops)
  const cues = stops.map((_, i) => instructionForStop(stops, i, destination.name))
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
  return {
    id: loc.id,
    name: loc.name,
    type: loc.type,
    code: loc.code,
    floorId: loc.floorId,
    floorLabel: loc.floorLabel,
    buildingId: loc.buildingId,
    buildingName: loc.buildingName,
    latitude: loc.latitude,
    longitude: loc.longitude,
    elevation: loc.elevation,
    physicalAddress: loc.physicalAddress || loc.address || null,
  }
}
