/** Outdoor routing: Drive → Parking → Walk to entrance. Weather via Open-Meteo. */
import { buildIndoorSteps } from './indoor.mjs'

const MILES_START = 20
/** Typical curb / garage distance from building entrance (cannot drive to the door). */
const PARKING_OFFSET_METERS = 160

export function milesBetween(a, b) {
  const R = 3958.7613
  const lat1 = (a.latitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function offsetMiles(lat, lng, miles = MILES_START, bearingDeg = 315) {
  const R = 3958.7613
  const brng = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lng1 = (lng * Math.PI) / 180
  const ang = miles / R
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI }
}

/** Offset a lat/lng by meters at a bearing (degrees). */
export function offsetMeters(lat, lng, meters, bearingDeg = 135) {
  const R = 6371000
  const brng = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lng1 = (lng * Math.PI) / 180
  const ang = meters / R
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI }
}

function straightLineCoords(from, to, steps = 24) {
  const coords = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    coords.push([
      from.longitude + (to.longitude - from.longitude) * t,
      from.latitude + (to.latitude - from.latitude) * t,
    ])
  }
  return coords
}

/** Typical uncongested speed: local street, arterial, or highway-length segment. */
function expectedMph(distanceM) {
  if (distanceM >= 1500) return 62
  if (distanceM >= 400) return 38
  return 26
}

function segmentTraffic(distanceM, durationS) {
  const mph = durationS > 0 ? (distanceM / 1609.344) / (durationS / 3600) : 0
  const expected = expectedMph(distanceM)
  const congestion = Math.max(0, Math.min(1, 1 - mph / expected))
  const level =
    congestion < 0.15 ? 'Light' : congestion < 0.35 ? 'Moderate' : congestion < 0.6 ? 'Heavy' : 'Severe'
  return {
    mph: Math.round(mph * 10) / 10,
    congestion: Math.round(congestion * 100) / 100,
    level,
  }
}

function overallTraffic(steps, distanceM, durationS) {
  let dist = 0
  let delayed = 0
  for (const step of steps) {
    const d = step.distanceM || 0
    dist += d
    delayed += d * (step.congestionIndex || 0)
  }
  const congestion = dist > 0 ? delayed / dist : 0
  const avgMph = durationS > 0 ? (distanceM / 1609.344) / (durationS / 3600) : 0
  const level =
    congestion < 0.15 ? 'Light' : congestion < 0.35 ? 'Moderate' : congestion < 0.6 ? 'Heavy' : 'Severe'
  return {
    level,
    congestionIndex: Math.round(congestion * 100) / 100,
    averageSpeedMph: Math.round(avgMph * 10) / 10,
  }
}

function bearingInstruction(modifier, name) {
  const road = name ? ` onto ${name}` : ''
  const map = {
    uturn: `Make a U-turn${road}`,
    'sharp right': `Turn sharp right${road}`,
    right: `Turn right${road}`,
    'slight right': `Bear right${road}`,
    straight: name ? `Continue on ${name}` : 'Continue straight',
    'slight left': `Bear left${road}`,
    left: `Turn left${road}`,
    'sharp left': `Turn sharp left${road}`,
  }
  return map[modifier] || (name ? `Continue toward ${name}` : 'Continue')
}

function extractSteps(route, { phase, idPrefix, arriveLabel, departLabel }) {
  const steps = []
  const legs = route.legs || []
  let seq = 0
  for (const leg of legs) {
    for (const step of leg.steps || []) {
      const coords = step.geometry?.coordinates || []
      const mid = coords[Math.floor(coords.length / 2)] || coords[0]
      const distanceM = step.distance || 0
      const durationS = Math.max(step.duration || 0, 0.1)
      const pace = segmentTraffic(distanceM, durationS)
      const maneuver = step.maneuver || {}
      const loc = maneuver.location || mid
      const name = step.name || ''
      const type = maneuver.type || 'turn'
      let instruction = ''
      if (type === 'depart') instruction = departLabel || (name ? `Depart via ${name}` : 'Depart')
      else if (type === 'arrive') instruction = arriveLabel || 'Arrive'
      else if (type === 'roundabout' || type === 'rotary') {
        instruction = `Enter roundabout${name ? ` toward ${name}` : ''}`
      } else instruction = bearingInstruction(maneuver.modifier || 'straight', name)

      const isWalk = phase === 'walk'
      steps.push({
        id: `${idPrefix}-${seq}`,
        phase,
        index: seq,
        instruction,
        roadName: name || null,
        distanceM: Math.round(distanceM),
        durationSec: Math.round(durationS),
        speedMph: pace.mph,
        trafficLevel: isWalk ? null : pace.level,
        congestionIndex: isWalk ? null : pace.congestion,
        latitude: loc?.[1] ?? mid?.[1],
        longitude: loc?.[0] ?? mid?.[0],
        geometry: coords,
      })
      seq += 1
    }
  }
  return steps
}

function pickRoute(routes, profile) {
  if (!routes.length) return null
  return [...routes].sort((a, b) => {
    if (profile === 'foot') return a.distance - b.distance || a.duration - b.duration
    return a.duration - b.duration || a.distance - b.distance
  })[0]
}

/** Public OSM road routers (same data Google-style turn-by-turn is built from). Never invent cross-building lines. */
function osrmEndpointCandidates(profile) {
  const envBase = String(process.env.OSRM_BASE_URL || '').replace(/\/$/, '')
  const list = []
  if (envBase) list.push(`${envBase}/route/v1/${profile}`)
  if (profile === 'driving' || profile === 'car') {
    list.push(
      'https://router.project-osrm.org/route/v1/driving',
      'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    )
  } else {
    list.push(
      'https://router.project-osrm.org/route/v1/foot',
      'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
      // Last resort: car network still follows roads (better than cutting through buildings)
      'https://router.project-osrm.org/route/v1/driving',
      'https://routing.openstreetmap.de/routed-car/route/v1/driving',
    )
  }
  return [...new Set(list)]
}

function packageOsrmRoute(route, profile, stepOpts, providerLabel) {
  const distanceM = route.distance
  const durationS = route.duration
  const steps = extractSteps(route, stepOpts)
  const summary = overallTraffic(steps, distanceM, durationS)
  return {
    provider: providerLabel,
    profile,
    distanceM: Math.round(distanceM),
    distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
    durationMinutes: Math.round((durationS / 60) * 10) / 10,
    geometry: route.geometry,
    steps,
    traffic:
      profile === 'driving' || profile === 'car'
        ? {
            ...summary,
            updatedAt: new Date().toISOString(),
            note: 'Road-snapped route from OpenStreetMap (OSRM). Each segment is compared with a typical speed for its length.',
            segments: steps.map((s) => ({
              id: s.id,
              trafficLevel: s.trafficLevel,
              speedMph: s.speedMph,
              distanceM: s.distanceM,
            })),
          }
        : {
            level: 'Pedestrian',
            congestionIndex: 0,
            averageSpeedMph: summary.averageSpeedMph,
            updatedAt: new Date().toISOString(),
            note: 'Pedestrian path snapped to OSM roads/paths from parking to the entrance.',
            segments: [],
          },
  }
}

async function fetchOsrmOnce(baseUrl, profile, origin, destination, stepOpts) {
  const lon1 = origin.longitude
  const lat1 = origin.latitude
  const lon2 = destination.longitude
  const lat2 = destination.latitude
  const url =
    `${baseUrl}/${lon1},${lat1};${lon2},${lat2}` +
    `?overview=full&geometries=geojson&steps=true&annotations=duration,distance&alternatives=3&continue_straight=true`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(18000),
  })
  if (!res.ok) throw new Error(`OSRM ${res.status}`)
  const json = await res.json()
  const routes = json.routes || []
  const route = pickRoute(routes, profile === 'car' ? 'driving' : profile)
  if (!route?.geometry?.coordinates?.length) throw new Error(json.message || 'No OSRM route')
  const host = baseUrl.replace(/^https?:\/\//, '').split('/')[0]
  return packageOsrmRoute(route, profile, stepOpts, `OSRM ${profile} · ${host}`)
}

async function fetchOsrm(profile, origin, destination, stepOpts) {
  const errors = []
  for (const base of osrmEndpointCandidates(profile)) {
    try {
      return await fetchOsrmOnce(base, profile, origin, destination, stepOpts)
    } catch (err) {
      errors.push(`${base}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Absolute last resort only — mark clearly; callers should prefer rejecting over drawing this.
  const coords = straightLineCoords(origin, destination)
  const approxM = Math.round(milesBetween(origin, destination) * 1609.344)
  const durationS = profile === 'foot' ? approxM / 1.35 : approxM / 13.4
  const phase = stepOpts.phase
  const steps = [
    {
      id: `${stepOpts.idPrefix}-0`,
      phase,
      index: 0,
      instruction: stepOpts.departLabel || 'Start',
      roadName: null,
      distanceM: Math.round(approxM / 2),
      durationSec: Math.round(durationS / 2),
      speedMph: profile === 'foot' ? 3 : 30,
      trafficLevel: profile === 'foot' ? null : 'Unknown',
      congestionIndex: profile === 'foot' ? null : 0,
      latitude: origin.latitude,
      longitude: origin.longitude,
      geometry: coords.slice(0, Math.ceil(coords.length / 2)),
    },
    {
      id: `${stepOpts.idPrefix}-1`,
      phase,
      index: 1,
      instruction: stepOpts.arriveLabel || 'Arrive',
      roadName: null,
      distanceM: Math.round(approxM / 2),
      durationSec: Math.round(durationS / 2),
      speedMph: profile === 'foot' ? 3 : 30,
      trafficLevel: profile === 'foot' ? null : 'Unknown',
      congestionIndex: profile === 'foot' ? null : 0,
      latitude: destination.latitude,
      longitude: destination.longitude,
      geometry: coords.slice(Math.floor(coords.length / 2)),
    },
  ]
  return {
    provider: 'geodesic-fallback',
    profile,
    distanceM: approxM,
    distanceMiles: Math.round((approxM / 1609.344) * 10) / 10,
    durationMinutes: Math.round((durationS / 60) * 10) / 10,
    geometry: { type: 'LineString', coordinates: coords },
    steps,
    traffic: {
      level: profile === 'foot' ? 'Pedestrian' : 'Unknown',
      congestionIndex: 0,
      averageSpeedMph: profile === 'foot' ? 3 : 30,
      updatedAt: new Date().toISOString(),
      note: `Road routers unavailable (${errors.slice(0, 2).join('; ')}). Straight line is NOT for navigation.`,
      segments: [],
    },
    warning: errors.join(' | '),
    isStraightLine: true,
  }
}

function isRoadSnapped(route) {
  if (!route || route.isStraightLine) return false
  if (/fallback|nearest parking walk/i.test(route.provider || '')) return false
  const n = route.geometry?.coordinates?.length || 0
  return n > 2
}

function metersBetween(a, b) {
  return milesBetween(a, b) * 1609.344
}

const parkingCache = new Map()

function toLocalMeters(origin, point) {
  const cos = Math.cos((origin.latitude * Math.PI) / 180) || 1
  return {
    x: (point.longitude - origin.longitude) * 111320 * cos,
    y: (point.latitude - origin.latitude) * 111320,
  }
}

function fromLocalMeters(origin, xy) {
  const cos = Math.cos((origin.latitude * Math.PI) / 180) || 1
  return {
    latitude: origin.latitude + xy.y / 111320,
    longitude: origin.longitude + xy.x / (111320 * cos),
  }
}

function ringContains(ring, entrance) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i][1]
    const yj = ring[j][1]
    const xi = ring[i][0]
    const xj = ring[j][0]
    const intersect =
      yi > entrance.latitude !== yj > entrance.latitude &&
      entrance.longitude < ((xj - xi) * (entrance.latitude - yi)) / (yj - yi || 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Closest place on a parking outline, not the middle of a lot that stretches down the block. */
function closestPointOnRing(ring, entrance) {
  let best = null
  let bestD = Infinity
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = toLocalMeters(entrance, { longitude: ring[i][0], latitude: ring[i][1] })
    const b = toLocalMeters(entrance, { longitude: ring[i + 1][0], latitude: ring[i + 1][1] })
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby
    const t = len2 > 0 ? Math.max(0, Math.min(1, (-a.x * abx + -a.y * aby) / len2)) : 0
    const x = a.x + abx * t
    const y = a.y + aby * t
    const d = Math.hypot(x, y)
    if (d < bestD) {
      bestD = d
      best = fromLocalMeters(entrance, { x, y })
    }
  }
  return best ? { ...best, meters: bestD } : null
}

function bboxRing(bbox) {
  if (!Array.isArray(bbox) || bbox.length < 4) return null
  const south = Number(bbox[0])
  const north = Number(bbox[1])
  const west = Number(bbox[2])
  const east = Number(bbox[3])
  if (![south, north, west, east].every(Number.isFinite)) return null
  return {
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  }
}

function ringsOf(geojson) {
  if (!geojson) return []
  if (geojson.type === 'Polygon') return geojson.coordinates?.[0] ? [geojson.coordinates[0]] : []
  if (geojson.type === 'MultiPolygon') return (geojson.coordinates || []).map((poly) => poly[0]).filter(Boolean)
  return []
}

function nearestStall(geojson, entrance, fallback) {
  const rings = ringsOf(geojson)
  if (!rings.length) return { ...fallback, meters: metersBetween(fallback, entrance) }
  let best = null
  for (const ring of rings) {
    const edge = closestPointOnRing(ring, entrance)
    if (!edge) continue
    const inside = ringContains(ring, entrance)
    let spot = edge
    if (inside && edge.meters > 20) {
      const step = Math.min(28, edge.meters - 8) / edge.meters
      spot = {
        latitude: entrance.latitude + (edge.latitude - entrance.latitude) * step,
        longitude: entrance.longitude + (edge.longitude - entrance.longitude) * step,
        meters: metersBetween(
          {
            latitude: entrance.latitude + (edge.latitude - entrance.latitude) * step,
            longitude: entrance.longitude + (edge.longitude - entrance.longitude) * step,
          },
          entrance,
        ),
      }
    }
    if (!best || spot.meters < best.meters) best = spot
  }
  return best || { ...fallback, meters: metersBetween(fallback, entrance) }
}

async function searchParkingLots(entrance, radiusM) {
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos((entrance.latitude * Math.PI) / 180) || 1)
  const left = entrance.longitude - dLng
  const right = entrance.longitude + dLng
  const top = entrance.latitude + dLat
  const bottom = entrance.latitude - dLat
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '12')
  url.searchParams.set('dedupe', '1')
  url.searchParams.set('bounded', '1')
  url.searchParams.set('extratags', '1')
  url.searchParams.set('polygon_geojson', '1')
  url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`)
  url.searchParams.set('q', 'parking')
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Parking search ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  const ids = rows
    .filter((row) => row?.osm_type && row?.osm_id)
    .map((row) => `${String(row.osm_type)[0].toUpperCase()}${row.osm_id}`)
    .join(',')
  let outlines = new Map()
  if (ids) {
    try {
      const lookupUrl = new URL('https://nominatim.openstreetmap.org/lookup')
      lookupUrl.searchParams.set('format', 'jsonv2')
      lookupUrl.searchParams.set('polygon_geojson', '1')
      lookupUrl.searchParams.set('osm_ids', ids)
      const lookup = await fetch(lookupUrl, {
        headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (lookup.ok) {
        const detailed = await lookup.json()
        if (Array.isArray(detailed)) {
          outlines = new Map(detailed.map((row) => [`${row.osm_type}:${row.osm_id}`, row.geojson]))
        }
      }
    } catch {
      outlines = new Map()
    }
  }
  return rows
    .filter((row) => row?.category === 'amenity' && row?.type === 'parking')
    .filter((row) => {
      const access = String(row.extratags?.access || '').toLowerCase()
      return access !== 'private' && access !== 'no'
    })
    .map((row) => {
      const fallback = { latitude: Number(row.lat), longitude: Number(row.lon) }
      const outline = outlines.get(`${row.osm_type}:${row.osm_id}`) || bboxRing(row.boundingbox)
      const stall = nearestStall(outline, entrance, fallback)
      return {
        latitude: stall.latitude,
        longitude: stall.longitude,
        straightM: stall.meters,
        label: row.name ? `${row.name} parking` : 'Nearest parking',
      }
    })
    .filter((spot) => Number.isFinite(spot.latitude) && Number.isFinite(spot.longitude))
}

function curbCandidates(entrance) {
  const spots = []
  for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
    spots.push({
      ...offsetMeters(entrance.latitude, entrance.longitude, 40, bearing),
      label: 'Curbside nearest the entrance',
    })
  }
  return spots
}

async function selectParking(entrance, origin) {
  const originKey = origin ? `${origin.latitude.toFixed(2)},${origin.longitude.toFixed(2)}` : 'none'
  const key = `${entrance.latitude.toFixed(4)},${entrance.longitude.toFixed(4)}|${originKey}`
  const cached = parkingCache.get(key)
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.spot

  let spots = []
  try {
    spots = await searchParkingLots(entrance, 420)
    if (spots.length < 2) {
      const wider = await searchParkingLots(entrance, 800)
      const seen = new Set(spots.map((s) => `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`))
      for (const spot of wider) {
        const id = `${spot.latitude.toFixed(5)},${spot.longitude.toFixed(5)}`
        if (!seen.has(id)) spots.push(spot)
      }
    }
  } catch {
    spots = []
  }
  if (!spots.length) spots = curbCandidates(entrance).map((spot) => ({ ...spot, straightM: 40 }))

  const nearest = spots
    .filter((spot) => spot.straightM <= 220)
    .sort((a, b) => a.straightM - b.straightM)[0]
  const chosen = nearest || spots.sort((a, b) => a.straightM - b.straightM)[0] || {
    ...offsetMeters(entrance.latitude, entrance.longitude, 35, 180),
    straightM: 35,
    label: 'Curbside nearest the entrance',
  }
  parkingCache.set(key, { at: Date.now(), spot: chosen })
  return chosen
}

function asLatLng(coord) {
  return { longitude: coord[0], latitude: coord[1] }
}

function polylineMeters(coords) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) total += metersBetween(asLatLng(coords[i - 1]), asLatLng(coords[i]))
  return total
}

function closestIndex(coords, point) {
  let index = 0
  let meters = Infinity
  for (let i = 0; i < coords.length; i += 1) {
    const d = metersBetween(asLatLng(coords[i]), point)
    if (d < meters) {
      meters = d
      index = i
    }
  }
  return { index, meters }
}

function routeEndpoint(route) {
  const coords = route?.geometry?.coordinates || []
  const last = coords[coords.length - 1]
  return last ? asLatLng(last) : null
}

/** Driving routers snap a lot to the public road, so the turn into the lot comes back as a walk. */
function walkSplitAtLot(walk, spot) {
  const coords = walk?.geometry?.coordinates || []
  if (coords.length < 2) return null
  const near = closestIndex(coords, spot)
  if (near.meters > 80 || near.index < 2) return null
  if (metersBetween(asLatLng(coords[0]), spot) <= 45) return null
  const approachM = polylineMeters(coords.slice(0, near.index + 1))
  if (approachM < 25 || approachM > 700) return null
  return near.index
}

function lotApproach(walk, driveEnd, spot) {
  const coords = walk?.geometry?.coordinates || []
  if (coords.length < 2 || !driveEnd) return null
  if (metersBetween(asLatLng(coords[0]), driveEnd) > 50) return null
  const near = closestIndex(coords, spot)
  if (near.meters > 80 || near.index < 2) return null
  const approach = coords.slice(0, near.index + 1)
  const approachM = polylineMeters(approach)
  if (approachM < 25 || approachM > 700) return null
  const straight = metersBetween(asLatLng(approach[0]), spot)
  if (approachM > Math.max(straight * 2.4, straight + 90)) return null
  return { approach, splitIndex: near.index }
}

function appendLotDrive(drive, approach) {
  const approachM = polylineMeters(approach)
  const steps = (drive.steps || []).map((step) => ({ ...step }))
  const previous = steps[steps.length - 1]
  if (previous && /park|leave the vehicle|arrive/i.test(previous.instruction || '')) {
    previous.instruction = 'Continue to the parking lot entrance'
  }
  const step = {
    id: `drv-lot-${steps.length}`,
    phase: 'drive',
    index: steps.length,
    instruction: 'Drive into the nearest parking and leave the car',
    roadName: null,
    distanceM: Math.round(approachM),
    durationSec: Math.max(8, Math.round(approachM / 4.5)),
    speedMph: 10,
    trafficLevel: 'Light',
    congestionIndex: 0,
    latitude: approach[0][1],
    longitude: approach[0][0],
    geometry: approach,
  }
  steps.push(step)
  const driveCoords = [...(drive.geometry?.coordinates || [])]
  const end = driveCoords[driveCoords.length - 1]
  const tail = end && metersBetween(asLatLng(end), asLatLng(approach[0])) < 35 ? approach.slice(1) : approach
  driveCoords.push(...tail)
  const distanceM = Math.round((drive.distanceM || 0) + approachM)
  return {
    ...drive,
    steps,
    geometry: { type: 'LineString', coordinates: driveCoords },
    distanceM,
    distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
    durationMinutes: Math.round(((drive.durationMinutes || 0) + approachM / 4.5 / 60) * 10) / 10,
    traffic: drive.traffic
      ? {
          ...drive.traffic,
          segments: [
            ...(drive.traffic.segments || []),
            { id: step.id, trafficLevel: 'Light', speedMph: 10, distanceM: Math.round(approachM) },
          ],
        }
      : drive.traffic,
  }
}

function trimWalkAtLot(walk, splitIndex) {
  const coords = walk.geometry?.coordinates || []
  const rest = coords.slice(splitIndex)
  if (rest.length < 2) return walk
  const restM = polylineMeters(rest)
  const splitPoint = asLatLng(coords[splitIndex])
  const kept = []
  for (const step of walk.steps || []) {
    const geom = step.geometry || []
    if (!geom.length) continue
    const start = closestIndex(coords, asLatLng(geom[0]))
    const end = closestIndex(coords, asLatLng(geom[geom.length - 1]))
    if (end.index <= splitIndex) continue
    if (start.index >= splitIndex) {
      kept.push({ ...step })
      continue
    }
    const clipped = geom.filter((coord) => closestIndex(coords, asLatLng(coord)).index >= splitIndex)
    if (clipped.length < 2) continue
    kept.push({
      ...step,
      instruction: 'Leave the car and walk to the entrance',
      latitude: splitPoint.latitude,
      longitude: splitPoint.longitude,
      distanceM: Math.round(polylineMeters(clipped)),
      geometry: clipped,
    })
  }
  if (!kept.length) {
    kept.push({
      id: 'wlk-0',
      phase: 'walk',
      index: 0,
      instruction: 'Leave the car and walk to the entrance',
      roadName: null,
      distanceM: Math.round(restM),
      durationSec: Math.round(restM / 1.35),
      speedMph: 3,
      trafficLevel: null,
      congestionIndex: null,
      latitude: splitPoint.latitude,
      longitude: splitPoint.longitude,
      geometry: rest,
    })
  } else {
    const first = kept[0]
    const atLot = metersBetween({ latitude: first.latitude, longitude: first.longitude }, splitPoint) < 30
    if (atLot && /depart|turn|continue|leave parking/i.test(first.instruction || '')) {
      kept[0] = { ...first, instruction: 'Leave the car and walk to the entrance' }
    }
  }
  return {
    ...walk,
    distanceM: Math.round(restM),
    distanceMiles: Math.round((restM / 1609.344) * 10) / 10,
    durationMinutes: Math.round((restM / 1.35 / 60) * 10) / 10,
    geometry: { type: 'LineString', coordinates: rest },
    steps: kept.map((step, index) => ({ ...step, index, phase: 'walk' })),
  }
}

/**
 * Keep the driveway into the lot on the drive leg.
 * The car can follow that path; only the walk from the parking pin to the door stays a walk.
 */
export async function alignDriveWithParking(drive, walk, spot) {
  if (!drive || !spot?.latitude || !spot?.longitude) return { drive, walk }
  const already = (drive.steps || []).some((step) => /drive into the nearest parking/i.test(step.instruction || ''))
  const driveEnd = routeEndpoint(drive)
  if (!driveEnd) return { drive, walk }
  const gap = metersBetween(driveEnd, spot)
  const approach = walk ? lotApproach(walk, driveEnd, spot) : null
  if (already) {
    return approach ? { drive, walk: trimWalkAtLot(walk, approach.splitIndex) } : { drive, walk }
  }
  if (approach && gap > 40) {
    return { drive: appendLotDrive(drive, approach.approach), walk: trimWalkAtLot(walk, approach.splitIndex) }
  }
  if (approach) return { drive, walk: trimWalkAtLot(walk, approach.splitIndex) }
  if (gap <= 40) {
    const steps = (drive.steps || []).map((step) => ({ ...step }))
    const last = steps[steps.length - 1]
    if (last && /arrive|park|leave the vehicle/i.test(last.instruction || '')) {
      last.instruction = 'Arrive at the nearest parking — leave the car here'
    }
    const parked = { ...drive, steps }
    const split = walkSplitAtLot(walk, spot)
    return split == null ? { drive: parked, walk } : { drive: parked, walk: trimWalkAtLot(walk, split) }
  }
  if (gap > 700) return { drive, walk }
  try {
    const foot = await fetchOsrm('foot', driveEnd, spot, {
      phase: 'walk',
      idPrefix: 'lot',
      departLabel: 'Drive into the nearest parking and leave the car',
      arriveLabel: 'Drive into the nearest parking and leave the car',
    })
    if (!foot?.geometry?.coordinates || /fallback/i.test(foot.provider || '')) return { drive, walk }
    if (foot.distanceM < 20 || foot.distanceM > 700) return { drive, walk }
    if (foot.distanceM > Math.max(gap * 2.4, gap + 90)) return { drive, walk }
    const extended = appendLotDrive(drive, foot.geometry.coordinates)
    const split = walkSplitAtLot(walk, spot)
    return { drive: extended, walk: split == null ? walk : trimWalkAtLot(walk, split) }
  } catch {
    return { drive, walk }
  }
}

/** Empty drive leg when the traveler is already on site. */
function emptyDrive(origin, note) {
  const lat = origin.latitude
  const lng = origin.longitude
  return {
    provider: 'on-site',
    profile: 'driving',
    distanceM: 0,
    distanceMiles: 0,
    durationMinutes: 0,
    geometry: { type: 'LineString', coordinates: [[lng, lat]] },
    steps: [],
    traffic: {
      level: 'None',
      congestionIndex: 0,
      averageSpeedMph: 0,
      updatedAt: new Date().toISOString(),
      note: note || 'Already near the building — no drive needed.',
      segments: [],
    },
  }
}

function atEntranceWalk(entrance) {
  return {
    provider: 'on-site',
    profile: 'foot',
    distanceM: 0,
    distanceMiles: 0,
    durationMinutes: 0,
    geometry: {
      type: 'LineString',
      coordinates: [[entrance.longitude, entrance.latitude]],
    },
    steps: [
      {
        id: 'wlk-0',
        phase: 'walk',
        index: 0,
        instruction: "You're already at the entrance — continue inside",
        roadName: null,
        distanceM: 0,
        durationSec: 0,
        speedMph: 3,
        trafficLevel: null,
        congestionIndex: null,
        latitude: entrance.latitude,
        longitude: entrance.longitude,
        geometry: [[entrance.longitude, entrance.latitude]],
      },
    ],
    traffic: {
      level: 'Pedestrian',
      congestionIndex: 0,
      averageSpeedMph: 3,
      updatedAt: new Date().toISOString(),
      note: 'Start is already at the building entrance.',
      segments: [],
    },
  }
}

/** Within this distance of the door → skip outdoor entirely. */
const AT_ENTRANCE_M = 100
/** Within this distance → walk from here; do not send the user to parking and back. */
const WALK_FROM_HERE_M = 700

/**
 * Arrival plan:
 * - Already at entrance → no drive / no parking loop
 * - Nearby → walk from current position to entrance (road-snapped)
 * - Far away → drive to nearest parking, then walk
 */
export async function chooseArrival(entrance, origin) {
  const toEntrance = metersBetween(origin, entrance)

  if (toEntrance <= AT_ENTRANCE_M) {
    return {
      parking: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        label: 'Already on site',
        offsetMeters: Math.round(toEntrance),
        mode: 'on-site',
      },
      drive: emptyDrive(origin, 'You are already at the building — skip driving to parking.'),
      walk: atEntranceWalk(entrance),
      arrivalMode: 'at-entrance',
    }
  }

  if (toEntrance <= WALK_FROM_HERE_M) {
    let walk = await fetchOsrm('foot', origin, entrance, {
      phase: 'walk',
      idPrefix: 'wlk',
      departLabel: 'Walk to the building entrance',
      arriveLabel: 'Arrive at building entrance — continue inside',
    })
    if (!isRoadSnapped(walk)) {
      const viaRoads = await fetchOsrm('driving', origin, entrance, {
        phase: 'walk',
        idPrefix: 'wlk',
        departLabel: 'Walk to the building entrance',
        arriveLabel: 'Arrive at building entrance — continue inside',
      })
      if (isRoadSnapped(viaRoads)) walk = { ...viaRoads, profile: 'foot' }
    }
    // Still refuse a parking detour if it would send the user farther away.
    return {
      parking: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        label: 'Start here — walk to entrance',
        offsetMeters: Math.round(walk.distanceM || toEntrance),
        mode: 'walk-from-origin',
      },
      drive: emptyDrive(origin, 'Close enough to walk — no drive to parking.'),
      walk,
      arrivalMode: 'walk-from-origin',
    }
  }

  const spot = await selectParking(entrance, origin)
  const [drive, walk] = await Promise.all([
    fetchDriveRoute(origin, spot),
    fetchWalkRoute(spot, entrance),
  ])

  // If driving to parking then walking is worse than walking straight from here, walk instead.
  const parkThenWalkM = (drive.distanceM || 0) + (walk.distanceM || 0)
  if (toEntrance < parkThenWalkM * 0.55 && toEntrance < 1200) {
    let direct = await fetchOsrm('foot', origin, entrance, {
      phase: 'walk',
      idPrefix: 'wlk',
      departLabel: 'Walk to the building entrance',
      arriveLabel: 'Arrive at building entrance — continue inside',
    })
    if (!isRoadSnapped(direct)) {
      const viaRoads = await fetchOsrm('driving', origin, entrance, {
        phase: 'walk',
        idPrefix: 'wlk',
        departLabel: 'Walk to the building entrance',
        arriveLabel: 'Arrive at building entrance — continue inside',
      })
      if (isRoadSnapped(viaRoads)) direct = { ...viaRoads, profile: 'foot' }
    }
    if (isRoadSnapped(direct) && (direct.distanceM || toEntrance) < parkThenWalkM) {
      return {
        parking: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          label: 'Start here — walk to entrance',
          offsetMeters: Math.round(direct.distanceM || toEntrance),
          mode: 'walk-from-origin',
        },
        drive: emptyDrive(origin, 'Walking is shorter than driving to parking and back.'),
        walk: direct,
        arrivalMode: 'walk-from-origin',
      }
    }
  }

  let aligned = await alignDriveWithParking(drive, walk, spot)

  // If walk geometry does not start at the parking pin, re-route on OSM roads — do NOT draw a straight line.
  if (!walkStartsBeside(aligned.walk, spot) || !isRoadSnapped(aligned.walk)) {
    const end = routeEndpoint(aligned.drive)
    if (end && metersBetween(end, spot) > 40 && metersBetween(end, spot) <= 220) {
      try {
        const lot = await fetchOsrm('foot', end, spot, {
          phase: 'walk',
          idPrefix: 'lot',
          departLabel: 'Drive into the nearest parking and leave the car',
          arriveLabel: 'Drive into the nearest parking and leave the car',
        })
        if (isRoadSnapped(lot) && lot.distanceM >= 20 && lot.distanceM <= 700) {
          aligned = {
            drive: appendLotDrive(aligned.drive, lot.geometry.coordinates),
            walk: aligned.walk,
          }
        }
      } catch {
        /* keep drive as-is */
      }
    }
    const foot = await fetchWalkRoute(spot, entrance)
    if (isRoadSnapped(foot)) {
      aligned = { drive: aligned.drive, walk: foot }
    } else if (isRoadSnapped(aligned.walk)) {
      /* keep existing road walk */
    } else if (isRoadSnapped(walk)) {
      aligned = { drive: aligned.drive, walk }
    } else {
      const viaRoads = await fetchOsrm('driving', spot, entrance, {
        phase: 'walk',
        idPrefix: 'wlk',
        departLabel: 'Leave parking and walk toward the building entrance',
        arriveLabel: 'Arrive at building entrance — continue inside',
      })
      aligned = {
        drive: aligned.drive,
        walk: isRoadSnapped(viaRoads) ? { ...viaRoads, profile: 'foot' } : foot,
      }
    }
  }

  return {
    parking: {
      latitude: spot.latitude,
      longitude: spot.longitude,
      label: spot.label || 'Nearest parking',
      offsetMeters: Math.round(aligned.walk?.distanceM || metersBetween(spot, entrance)),
      mode: 'drive-park-walk',
    },
    drive: aligned.drive,
    walk: aligned.walk,
    arrivalMode: 'drive-park-walk',
  }
}

function walkStartsBeside(walk, spot) {
  const first = walk?.geometry?.coordinates?.[0]
  return Boolean(first) && metersBetween(asLatLng(first), spot) <= 50
}

function directWalk(spot, entrance) {
  const distanceM = Math.round(metersBetween(spot, entrance))
  const coordinates = [
    [spot.longitude, spot.latitude],
    [entrance.longitude, entrance.latitude],
  ]
  return {
    provider: 'Nearest parking walk',
    profile: 'foot',
    distanceM,
    distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
    durationMinutes: Math.round((distanceM / 1.35 / 60) * 10) / 10,
    geometry: { type: 'LineString', coordinates },
    steps: [
      {
        id: 'wlk-0',
        phase: 'walk',
        index: 0,
        instruction: 'Leave the car and walk to the entrance',
        roadName: null,
        distanceM,
        durationSec: Math.max(8, Math.round(distanceM / 1.35)),
        speedMph: 3,
        trafficLevel: null,
        congestionIndex: null,
        latitude: spot.latitude,
        longitude: spot.longitude,
        geometry: coordinates,
      },
    ],
    traffic: {
      level: 'Pedestrian',
      congestionIndex: 0,
      averageSpeedMph: 3,
      updatedAt: new Date().toISOString(),
      note: 'Short walk from the nearest parking stall to the entrance.',
      segments: [],
    },
  }
}

export async function fetchDriveRoute(origin, parking) {
  return fetchOsrm('driving', origin, parking, {
    phase: 'drive',
    idPrefix: 'drv',
    departLabel: 'Start driving toward the nearest parking',
    arriveLabel: 'Park and leave the vehicle — walk the rest of the way',
  })
}

export async function fetchWalkRoute(parking, entrance) {
  return fetchOsrm('foot', parking, entrance, {
    phase: 'walk',
    idPrefix: 'wlk',
    departLabel: 'Leave parking and walk toward the building entrance',
    arriveLabel: 'Arrive at building entrance — continue inside',
  })
}

/** @deprecated use fetchDriveRoute — kept for conditions endpoint */
export async function fetchOutdoorRoute(origin, destination) {
  return fetchDriveRoute(origin, destination)
}

const WMO = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

async function readJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchOpenMeteo(lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`
  const json = await readJson(url, 12000)
  const c = json.current
  if (!c) throw new Error('Open-Meteo returned no current conditions')
  const code = Number(c.weather_code)
  return {
    provider: 'Open-Meteo (live)',
    temperatureF: c.temperature_2m,
    feelsLikeF: c.apparent_temperature,
    humidityPct: c.relative_humidity_2m,
    windMph: c.wind_speed_10m,
    windDirectionDeg: c.wind_direction_10m,
    precipitationIn: c.precipitation,
    weatherCode: code,
    summary: WMO[code] ?? `Code ${code}`,
    fetchedAt: c.time || new Date().toISOString(),
    latitude: lat,
    longitude: lng,
  }
}

function metSummary(symbol) {
  const code = String(symbol || '').toLowerCase()
  if (code.includes('thunder')) return 'Thunderstorm'
  if (code.includes('snow')) return 'Snow'
  if (code.includes('sleet')) return 'Sleet'
  if (code.includes('rain') || code.includes('drizzle')) return 'Rain'
  if (code.includes('fog')) return 'Fog'
  if (code.includes('cloud')) return code.includes('partly') || code.includes('fair') ? 'Partly cloudy' : 'Overcast'
  if (code.includes('clear') || code.includes('fair')) return 'Clear'
  return 'Current conditions'
}

async function fetchMetNo(lat, lng) {
  const json = await readJson(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lng}`,
    12000,
  )
  const now = json.properties?.timeseries?.[0]
  const details = now?.data?.instant?.details
  if (!details) throw new Error('MET Norway returned no current conditions')
  const celsius = Number(details.air_temperature)
  const feels = Number(details.air_temperature)
  const wind = Number(details.wind_speed)
  const precip = Number(now.data.next_1_hours?.details?.precipitation_amount ?? 0)
  return {
    provider: 'MET Norway (live)',
    temperatureF: Math.round(((celsius * 9) / 5 + 32) * 10) / 10,
    feelsLikeF: Math.round(((feels * 9) / 5 + 32) * 10) / 10,
    humidityPct: details.relative_humidity,
    windMph: Math.round(wind * 2.23694 * 10) / 10,
    windDirectionDeg: details.wind_from_direction,
    precipitationIn: Math.round((precip / 25.4) * 100) / 100,
    summary: metSummary(now.data.next_1_hours?.summary?.symbol_code),
    fetchedAt: now.time || new Date().toISOString(),
    latitude: lat,
    longitude: lng,
  }
}

export async function fetchWeather(lat, lng) {
  const errors = []
  for (const load of [fetchOpenMeteo, fetchMetNo]) {
    try {
      return await load(lat, lng)
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  return {
    provider: 'unavailable',
    summary: 'Weather unavailable',
    error: errors.join('; '),
    fetchedAt: new Date().toISOString(),
    latitude: lat,
    longitude: lng,
  }
}

export function buildJourneySteps(drive, walk, indoor, destinationLabel) {
  const driveSteps = (drive.steps || []).map((s, i) => ({
    ...s,
    phase: 'drive',
    index: i,
    title: s.title || `Drive · Step ${i + 1}`,
  }))
  const walkSteps = (walk.steps || []).map((s, i) => ({
    ...s,
    phase: 'walk',
    index: driveSteps.length + i,
    title: s.title || `Walk · Step ${i + 1}`,
  }))
  const indoorSteps = buildIndoorSteps(indoor, destinationLabel, driveSteps.length + walkSteps.length)
  return [...driveSteps, ...walkSteps, ...indoorSteps]
}

export { MILES_START, PARKING_OFFSET_METERS }
