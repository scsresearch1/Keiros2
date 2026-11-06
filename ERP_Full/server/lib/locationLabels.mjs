/**
 * Label-driven location cleanup for Keriosa / field locks.
 * Infers type, short name, and stair-chain role from human labels.
 */

const ADDR_PREFIX =
  /^(?:\d+\s+)?(?:[A-Za-z0-9.'\-\s]+(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Drive|Dr|Way|Ln|Lane)\b[^,]*)?(?:,?\s*(?:Fresno|CA|California)\b[^,]*)*,?\s*(?:CA\s*)?\d{5}?\s*/i

export function shortLocationName(raw) {
  const full = String(raw || '').trim()
  if (!full) return 'Stop'
  // "… Unit 202" / "… North Entrance" / "… Stair Case Top"
  const unit = full.match(/\b(Unit|Suite|Apt\.?|Apartment)\s*#?\s*([A-Za-z0-9-]+)\b/i)
  if (unit) return `${unit[1][0].toUpperCase()}${unit[1].slice(1).toLowerCase()} ${unit[2]}`
  const entrance = full.match(/\b((?:North|South|East|West|Main|Front|Rear|Side)\s+)?(Entrance|Entry|Lobby|Door)\b/i)
  if (entrance) {
    const side = (entrance[1] || '').trim()
    const kind = entrance[2].replace(/^entry$/i, 'Entrance')
    return side ? `${side} ${kind}` : kind
  }
  const stair = full.match(/\bStair(?:s|case)?\b(.*)$/i)
  if (stair) {
    const rest = String(stair[1] || '')
      .replace(/^(?:\s*case)?\s*/i, '')
      .trim()
    if (/start|bottom|base/i.test(full)) return 'Stairs · Start'
    if (/top|upper|landing\s*top/i.test(full)) return 'Stairs · Top'
    if (/left\s*turn|right\s*turn|turn|mid|landing/i.test(full)) {
      if (/left/i.test(full)) return 'Stairs · Left turn'
      if (/right/i.test(full)) return 'Stairs · Right turn'
      return 'Stairs · Turn'
    }
    return rest ? `Stairs · ${rest}` : 'Stairs'
  }
  const stripped = full.replace(ADDR_PREFIX, '').replace(/^[\s,·\-]+/, '').trim()
  return stripped || full
}

export function inferLocationType(loc) {
  const name = String(loc?.name || '')
  const current = String(loc?.type || '')
  if (/\b(Unit|Suite|Apt\.?|Apartment)\s*#?\s*[A-Za-z0-9-]+\b/i.test(name)) return 'Unit'
  if (/\b(Entrance|Entry)\b/i.test(name)) return 'Entry'
  if (/\bLobby\b/i.test(name)) return 'Lobby'
  if (/\bElevator\b/i.test(name)) return 'Elevator'
  if (/\bStair/i.test(name)) return 'Stairs'
  if (/\bCorridor|Hallway|Hall\b/i.test(name)) return 'Corridor'
  if (/\bDoor\b/i.test(name)) return 'Door'
  if (/\bParking\b/i.test(name)) return 'Parking'
  return current || 'Amenity'
}

/** Order key for stair / vertical chain: start → turns → top. */
export function stairChainOrder(loc) {
  const name = String(loc?.name || '')
  if (/start|bottom|base/i.test(name)) return 10
  if (/left\s*turn/i.test(name)) return 40
  if (/right\s*turn/i.test(name)) return 45
  if (/turn|mid|landing/i.test(name) && !/top/i.test(name)) return 50
  if (/top|upper/i.test(name)) return 90
  if (/\bStair/i.test(name) || loc?.type === 'Stairs') return 60
  if (loc?.type === 'Elevator' || /\bElevator\b/i.test(name)) return 55
  return 70
}

export function isStairish(loc) {
  const t = inferLocationType(loc)
  return t === 'Stairs' || /\bStair/i.test(String(loc?.name || ''))
}

export function isElevatorish(loc) {
  const t = inferLocationType(loc)
  return t === 'Elevator' || /\bElevator\b/i.test(String(loc?.name || ''))
}

export function isVerticalish(loc) {
  return isStairish(loc) || isElevatorish(loc)
}

/** Normalize a location in memory (does not write to Firestore). */
export function enrichLocation(loc) {
  if (!loc || typeof loc !== 'object') return loc
  const type = inferLocationType(loc)
  const short = shortLocationName(loc.name)
  const next = {
    ...loc,
    type,
    name: short,
    labelSourceName: loc.labelSourceName || loc.name,
  }
  // Dwelling kept as Unit even if Keriosa stored Corridor/Entry.
  if (type === 'Unit' && loc.type !== 'Unit') {
    next.type = 'Unit'
  }
  return next
}

export function enrichLocations(list) {
  return (list || []).map(enrichLocation)
}

/**
 * Drop GPS outliers that sit far from the building cluster (bad Keriosa locks).
 * Keeps destinations even if slightly off — only drops non-destination hubs.
 */
export function filterBuildingOutliers(buildingLocs, opts = {}) {
  const maxM = opts.maxM ?? 55
  const locs = (buildingLocs || []).filter(
    (l) => l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude),
  )
  if (locs.length < 3) return locs
  const destIds = new Set(
    locs.filter((l) => inferLocationType(l) === 'Unit' || inferLocationType(l) === 'Room').map((l) => l.id),
  )
  const lat = locs.reduce((s, l) => s + l.latitude, 0) / locs.length
  const lng = locs.reduce((s, l) => s + l.longitude, 0) / locs.length
  const toRad = (d) => (d * Math.PI) / 180
  const distM = (a, b) => {
    const dLat = toRad(b.latitude - a.latitude)
    const dLng = toRad(b.longitude - a.longitude)
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)))
  }
  const center = { latitude: lat, longitude: lng }
  return locs.filter((l) => {
    if (destIds.has(l.id)) return true
    if (l.mapped === false) return false
    return distM(center, l) <= maxM
  })
}
