/** Indoor path helpers (mirrors ERP_Full/src/maps/geo.ts + routeEngine). */

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

export function routePath(from, to, locations) {
  if (from.id === to.id) return [from]
  const path = [from]

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
    if (fromHub.id !== from.id) path.push(fromHub)
    if (toHub.id !== fromHub.id) path.push(toHub)
    if (to.id !== toHub.id) path.push(to)
    return path
  }

  if (from.floorId !== to.floorId) {
    const elevator =
      locations.find(
        (location) =>
          location.buildingId === from.buildingId &&
          (location.type === 'Elevator' || location.type === 'Stairs'),
      ) ?? null
    if (elevator && elevator.id !== from.id) path.push(elevator)
    if (elevator && elevator.id !== to.id) {
      path.push({
        ...elevator,
        floorId: to.floorId,
        floorLabel: to.floorLabel,
        elevation: to.elevation,
        id: `${elevator.id}→${to.floorId}`,
        name: `${elevator.name} (${to.floorLabel})`,
      })
    }
    path.push(to)
    return path
  }

  path.push(to)
  return path
}

export function nearestEntry(locations) {
  return (
    locations.find((l) => l.type === 'Entry' || l.type === 'Lobby') ??
    locations[0] ??
    null
  )
}

export function pathDistanceMeters(stops) {
  let sum = 0
  for (let i = 1; i < stops.length; i += 1) {
    sum += haversineMeters(stops[i - 1], stops[i])
    sum += Math.abs(stops[i].elevation - stops[i - 1].elevation) * 0.35
  }
  return sum
}

export function estimateWalkMinutes(distanceM, floorChanges) {
  const speedMps = 1.25
  return Math.round(((distanceM / speedMps) / 60 + floorChanges * 0.55) * 10) / 10
}

export function buildIndoorJourney(destination, allLocations) {
  const buildingLocs = allLocations.filter((l) => l.buildingId === destination.buildingId)
  const entry = nearestEntry(buildingLocs)
  if (!entry) {
    return { stops: [destination], distanceM: 0, walkMinutes: 0, floorChanges: 0 }
  }
  const stops = routePath(entry, destination, allLocations)
  const floorChanges = new Set(stops.map((s) => s.floorId)).size - 1
  const distanceM = pathDistanceMeters(stops)
  return {
    stops,
    distanceM: Math.round(distanceM),
    walkMinutes: estimateWalkMinutes(distanceM, Math.max(0, floorChanges)),
    floorChanges: Math.max(0, floorChanges),
    entry,
  }
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
  }
}
