/** Outdoor routing: Drive → Parking → Walk to entrance. Weather via Open-Meteo. */

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

async function fetchOsrm(profile, origin, destination, stepOpts) {
  const lon1 = origin.longitude
  const lat1 = origin.latitude
  const lon2 = destination.longitude
  const lat2 = destination.latitude
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/${lon1},${lat1};${lon2},${lat2}` +
    `?overview=full&geometries=geojson&steps=true&annotations=duration,distance&alternatives=3`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`OSRM ${res.status}`)
    const json = await res.json()
    const routes = json.routes || []
    const route = pickRoute(routes, profile)
    if (!route) throw new Error(json.message || 'No OSRM route')
    const distanceM = route.distance
    const durationS = route.duration
    const steps = extractSteps(route, stepOpts)
    const summary = overallTraffic(steps, distanceM, durationS)

    return {
      provider: `OSRM ${profile}`,
      profile,
      distanceM: Math.round(distanceM),
      distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
      durationMinutes: Math.round((durationS / 60) * 10) / 10,
      geometry: route.geometry,
      steps,
      traffic:
        profile === 'driving'
          ? {
              ...summary,
              updatedAt: new Date().toISOString(),
              note: 'Each segment is compared with a typical speed for its length. Lower speeds raise the index. Refresh recalculates the drive.',
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
              note: 'Walking segment from parking to building entrance (vehicles cannot drive to the door).',
              segments: [],
            },
    }
  } catch (err) {
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
        note: `Routing fallback (${err instanceof Error ? err.message : 'error'}).`,
        segments: [],
      },
      warning: String(err instanceof Error ? err.message : err),
    }
  }
}

function metersBetween(a, b) {
  return milesBetween(a, b) * 1609.344
}

function walkIsDirect(straightM, walkM) {
  if (walkM > 550) return false
  if (straightM < 30) return walkM < 180
  return walkM <= Math.max(straightM * 2.4, straightM + 90)
}

const parkingCache = new Map()

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
  url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`)
  url.searchParams.set('q', 'parking')
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Parking search ${res.status}`)
  const rows = await res.json()
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row) => row?.category === 'amenity' && row?.type === 'parking')
    .filter((row) => {
      const access = String(row.extratags?.access || '').toLowerCase()
      return access !== 'private' && access !== 'no'
    })
    .map((row) => ({
      latitude: Number(row.lat),
      longitude: Number(row.lon),
      label: row.name ? `${row.name} parking` : 'Nearest parking',
    }))
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

async function footDistance(spot, entrance) {
  const url =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${spot.longitude},${spot.latitude};${entrance.longitude},${entrance.latitude}` +
    `?overview=false&steps=false&alternatives=2`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`OSRM foot ${res.status}`)
  const json = await res.json()
  const route = pickRoute(json.routes || [], 'foot')
  if (!route) throw new Error('No walk')
  return route.distance
}

async function driveSeconds(origin, spot) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${spot.longitude},${spot.latitude}` +
    `?overview=false&steps=false&alternatives=2`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KeirosNavigation/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`OSRM drive ${res.status}`)
  const json = await res.json()
  const route = pickRoute(json.routes || [], 'driving')
  if (!route) throw new Error('No drive')
  return route.duration
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
  if (!spots.length) spots = curbCandidates(entrance)

  const ranked = spots
    .map((spot) => ({ ...spot, straightM: metersBetween(spot, entrance) }))
    .filter((spot) => spot.straightM <= 900)
    .sort((a, b) => a.straightM - b.straightM)
    .slice(0, 6)

  const scored = (
    await Promise.all(
      ranked.map(async (spot) => {
        try {
          const walkM = await footDistance(spot, entrance)
          return { spot, walkM }
        } catch {
          return null
        }
      }),
    )
  ).filter(Boolean)

  let direct = scored.filter((row) => walkIsDirect(row.spot.straightM, row.walkM))
  if (!direct.length) {
    const curbScored = (
      await Promise.all(
        curbCandidates(entrance).map(async (spot) => {
          const withStraight = { ...spot, straightM: metersBetween(spot, entrance) }
          try {
            return { spot: withStraight, walkM: await footDistance(withStraight, entrance) }
          } catch {
            return null
          }
        }),
      )
    ).filter(Boolean)
    direct = curbScored.filter((row) => walkIsDirect(row.spot.straightM, row.walkM))
    if (!direct.length && curbScored.length) scored.push(...curbScored)
  }
  const pool = (direct.length ? direct : scored).slice()
  pool.sort((a, b) => a.walkM - b.walkM || a.spot.straightM - b.spot.straightM)
  let chosenRow = pool[0]
  if (origin && pool.length > 1 && pool[1].walkM <= pool[0].walkM + 40) {
    const contenders = pool.filter((row) => row.walkM <= pool[0].walkM + 40).slice(0, 3)
    const timed = await Promise.all(
      contenders.map(async (row) => {
        try {
          return { ...row, driveS: await driveSeconds(origin, row.spot) }
        } catch {
          return { ...row, driveS: Number.POSITIVE_INFINITY }
        }
      }),
    )
    timed.sort((a, b) => a.driveS - b.driveS || a.walkM - b.walkM)
    chosenRow = timed[0]
  }
  const chosen = chosenRow?.spot || ranked[0] || {
    ...offsetMeters(entrance.latitude, entrance.longitude, 40, 180),
    label: 'Curbside nearest the entrance',
  }
  parkingCache.set(key, { at: Date.now(), spot: chosen })
  return chosen
}

/** Nearest reachable parking, then the fastest drive and shortest walk. */
export async function chooseArrival(entrance, origin) {
  const spot = await selectParking(entrance, origin)
  const [drive, walk] = await Promise.all([
    fetchDriveRoute(origin, spot),
    fetchWalkRoute(spot, entrance),
  ])
  return {
    parking: {
      latitude: spot.latitude,
      longitude: spot.longitude,
      label: spot.label || 'Nearest parking',
      offsetMeters: Math.round(walk.distanceM || metersBetween(spot, entrance)),
    },
    drive,
    walk,
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
    title: `Drive · Step ${i + 1}`,
  }))
  const walkSteps = (walk.steps || []).map((s, i) => ({
    ...s,
    phase: 'walk',
    index: driveSteps.length + i,
    title: `Walk · Step ${i + 1}`,
  }))
  const indoorStops = indoor.stops || []
  const base = driveSteps.length + walkSteps.length
  const indoorSteps = indoorStops.map((stop, i) => {
    const prev = indoorStops[i - 1]
    let instruction = `Go to ${stop.name} (${stop.floorLabel})`
    if (i === 0) instruction = `Enter building at ${stop.name} (${stop.floorLabel}) — indoor navigation`
    else if (prev && prev.floorId !== stop.floorId) {
      instruction = `Take vertical access to ${stop.floorLabel}, then to ${stop.name}`
    } else if (i === indoorStops.length - 1) {
      instruction = `Arrive at ${stop.name} · ${destinationLabel}`
    }
    return {
      id: `in-${i}`,
      phase: 'indoor',
      index: base + i,
      indoorIndex: i,
      instruction,
      title: `Inside · Step ${i + 1}`,
      distanceM: prev
        ? Math.round(
            Math.hypot(
              (stop.latitude - prev.latitude) * 111320,
              (stop.longitude - prev.longitude) * 111320 * Math.cos((stop.latitude * Math.PI) / 180),
            ),
          )
        : 0,
      durationSec: null,
      latitude: stop.latitude,
      longitude: stop.longitude,
      floorLabel: stop.floorLabel,
      floorId: stop.floorId,
      stopId: stop.id,
      stopName: stop.name,
      stopType: stop.type,
    }
  })
  return [...driveSteps, ...walkSteps, ...indoorSteps]
}

export { MILES_START, PARKING_OFFSET_METERS }
