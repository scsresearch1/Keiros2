/** Outdoor routing: Drive → Parking → Walk to entrance. Weather via Open-Meteo. */

const MILES_START = 20
/** Typical curb / garage distance from building entrance (cannot drive to the door). */
const PARKING_OFFSET_METERS = 160

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

function trafficLevelFromSpeedMph(mph) {
  if (mph >= 45) return 'Light'
  if (mph >= 28) return 'Moderate'
  if (mph >= 15) return 'Heavy'
  return 'Severe'
}

function congestionFromSpeed(mph) {
  return Math.max(0, Math.min(1, 1 - mph / 55))
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
      const mph = distanceM > 0 ? (distanceM / 1609.344) / (durationS / 3600) : 0
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
        speedMph: isWalk ? Math.round((distanceM / Math.max(durationS, 0.1)) * 2.237 * 10) / 10 : Math.round(mph * 10) / 10,
        trafficLevel: isWalk ? null : trafficLevelFromSpeedMph(mph),
        congestionIndex: isWalk ? null : Math.round(congestionFromSpeed(mph) * 100) / 100,
        latitude: loc?.[1] ?? mid?.[1],
        longitude: loc?.[0] ?? mid?.[0],
        geometry: coords,
      })
      seq += 1
    }
  }
  return steps
}

async function fetchOsrm(profile, origin, destination, stepOpts) {
  const lon1 = origin.longitude
  const lat1 = origin.latitude
  const lon2 = destination.longitude
  const lat2 = destination.latitude
  const url = `https://router.project-osrm.org/route/v1/${profile}/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson&steps=true&annotations=duration,distance`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`OSRM ${res.status}`)
    const json = await res.json()
    const route = json.routes?.[0]
    if (!route) throw new Error('No OSRM route')
    const distanceM = route.distance
    const durationS = route.duration
    const steps = extractSteps(route, stepOpts)
    const freeFlowS = distanceM / (profile === 'foot' ? 1.35 : 13.4)
    const congestion = Math.max(0, Math.min(1, (durationS - freeFlowS) / Math.max(freeFlowS, 1)))
    const level =
      congestion < 0.15 ? 'Light' : congestion < 0.4 ? 'Moderate' : congestion < 0.7 ? 'Heavy' : 'Severe'
    const avgMph = distanceM > 0 ? (distanceM / 1609.344) / (durationS / 3600) : 0

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
              level,
              congestionIndex: Math.round(congestion * 100) / 100,
              averageSpeedMph: Math.round(avgMph * 10) / 10,
              updatedAt: new Date().toISOString(),
              note: 'Live segment speeds from OSRM travel times. Drive legs colored by congestion.',
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
              averageSpeedMph: Math.round(avgMph * 10) / 10,
              updatedAt: new Date().toISOString(),
              note: 'Walking segment from parking to building entrance (vehicles cannot drive to the door).',
              segments: [],
            },
    }
  } catch (err) {
    const coords = straightLineCoords(origin, destination)
    const approxM =
      profile === 'foot'
        ? Math.round(
            Math.hypot(
              (destination.latitude - origin.latitude) * 111320,
              (destination.longitude - origin.longitude) *
                111320 *
                Math.cos((origin.latitude * Math.PI) / 180),
            ),
          )
        : Math.round(MILES_START * 1609.344)
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

export async function fetchDriveRoute(origin, parking) {
  return fetchOsrm('driving', origin, parking, {
    phase: 'drive',
    idPrefix: 'drv',
    departLabel: 'Start driving toward visitor / garage parking',
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

export async function fetchWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`)
    const json = await res.json()
    const c = json.current
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
  } catch (err) {
    return {
      provider: 'unavailable',
      summary: 'Weather unavailable',
      error: String(err instanceof Error ? err.message : err),
      fetchedAt: new Date().toISOString(),
      latitude: lat,
      longitude: lng,
    }
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
