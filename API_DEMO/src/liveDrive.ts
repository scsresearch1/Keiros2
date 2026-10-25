import type { JourneyStep, NavigateResult } from './api'

type LatLng = { latitude: number; longitude: number }

type OsrmStep = {
  distance: number
  duration: number
  name?: string
  maneuver: { location: [number, number]; type: string; modifier?: string }
  geometry?: { coordinates: [number, number][] }
}

type OsrmRoute = {
  distance: number
  duration: number
  geometry: { coordinates: [number, number][] }
  legs?: { steps?: OsrmStep[] }[]
}

function serverUsedOrigin(result: NavigateResult, origin: LatLng) {
  if (result.origin.startMode === 'demo') return false
  // The API sometimes keeps the chosen point but falls back to a straight line.
  // Let the browser try a road route before accepting that.
  if (/fallback/i.test(result.outdoor.provider || '')) return false
  const dLat = result.origin.latitude - origin.latitude
  const dLng = result.origin.longitude - origin.longitude
  return dLat * dLat + dLng * dLng <= 0.0025
}

function milesBetween(a: LatLng, b: LatLng) {
  const R = 3958.7613
  const lat1 = (a.latitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function instructionFor(step: OsrmStep) {
  const type = step.maneuver.type.replaceAll('_', ' ')
  const modifier = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : ''
  const road = step.name ? ` onto ${step.name}` : ''
  if (step.maneuver.type === 'depart') return `Start driving${road}`
  if (step.maneuver.type === 'arrive') return 'Arrive at visitor / garage parking'
  return `${type}${modifier}${road}`
}

function stepsFromRoute(route: OsrmRoute): JourneyStep[] {
  const raw = route.legs?.[0]?.steps ?? []
  if (!raw.length) {
    const [lng, lat] = route.geometry.coordinates[0] ?? [0, 0]
    return [
      {
        id: 'drv-0',
        phase: 'drive',
        index: 0,
        title: 'Drive · Step 1',
        instruction: 'Start driving toward visitor / garage parking',
        latitude: lat,
        longitude: lng,
        distanceM: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        geometry: route.geometry.coordinates,
      },
    ]
  }
  return raw.map((step, index) => {
    const [lng, lat] = step.maneuver.location
    const mph = step.duration > 0 ? (step.distance / 1609.344) / (step.duration / 3600) : 0
    const expected = step.distance >= 1500 ? 62 : step.distance >= 400 ? 38 : 26
    const congestion = Math.max(0, Math.min(1, 1 - mph / expected))
    const level = congestion < 0.15 ? 'Light' : congestion < 0.35 ? 'Moderate' : congestion < 0.6 ? 'Heavy' : 'Severe'
    return {
      id: `drv-${index}`,
      phase: 'drive' as const,
      index,
      title: `Drive · Step ${index + 1}`,
      instruction: instructionFor(step),
      roadName: step.name || null,
      distanceM: Math.round(step.distance),
      durationSec: Math.round(step.duration),
      speedMph: Math.round(mph * 10) / 10,
      trafficLevel: level,
      congestionIndex: Math.round(congestion * 100) / 100,
      latitude: lat,
      longitude: lng,
      geometry: step.geometry?.coordinates ?? [],
    }
  })
}

async function fetchDrive(origin: LatLng, parking: LatLng) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${parking.longitude},${parking.latitude}` +
    `?overview=full&geometries=geojson&steps=true&alternatives=3`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not route from the starting location (OSRM ${res.status})`)
  const json = (await res.json()) as { routes?: OsrmRoute[] }
  const route = [...(json.routes ?? [])].sort(
    (a, b) => a.duration - b.duration || a.distance - b.distance,
  )[0]
  if (!route) throw new Error('No driving route from the starting location')
  const steps = stepsFromRoute(route)
  const distanceM = Math.round(route.distance)
  const durationS = route.duration
  const avgMph = durationS > 0 ? (distanceM / 1609.344) / (durationS / 3600) : 0
  const weighted = steps.reduce(
    (sum, step) => ({
      dist: sum.dist + (step.distanceM ?? 0),
      delay: sum.delay + (step.distanceM ?? 0) * (step.congestionIndex ?? 0),
    }),
    { dist: 0, delay: 0 },
  )
  const congestion = weighted.dist > 0 ? weighted.delay / weighted.dist : 0
  const level =
    congestion < 0.15 ? 'Light' : congestion < 0.35 ? 'Moderate' : congestion < 0.6 ? 'Heavy' : 'Severe'
  return {
    steps,
    distanceM,
    durationMinutes: Math.round((durationS / 60) * 10) / 10,
      geometry: { type: 'LineString', coordinates: route.geometry.coordinates },
    provider: 'OSRM driving',
    traffic: {
      level,
      congestionIndex: Math.round(congestion * 100) / 100,
      averageSpeedMph: Math.round(avgMph * 10) / 10,
      updatedAt: new Date().toISOString(),
      note: 'Each segment is compared with a typical speed for its length. Lower speeds raise the index.',
      segments: steps.map((step) => ({
        id: step.id,
        trafficLevel: step.trafficLevel ?? 'Unknown',
        speedMph: step.speedMph ?? 0,
        distanceM: step.distanceM ?? 0,
      })),
    },
  }
}

/** Keep walk and indoor legs. Replace the drive when the API still used the simulated start. */
export async function withLiveDrive(
  result: NavigateResult,
  origin: LatLng,
  options?: { label?: string; startMode?: 'live' | 'custom' },
): Promise<NavigateResult> {
  if (serverUsedOrigin(result, origin)) return result
  const keepServerOnFailure = result.origin.startMode !== 'demo'
  const startMode = options?.startMode ?? 'live'
  const parking = result.parking ?? {
    latitude: result.destination.latitude,
    longitude: result.destination.longitude,
    label: 'Parking',
    offsetMeters: 0,
  }
  let drive: Awaited<ReturnType<typeof fetchDrive>>
  try {
    drive = await fetchDrive(origin, parking)
  } catch (err) {
    if (keepServerOnFailure) return result
    throw err
  }
  const walkSteps = result.journey.steps.filter((step) => step.phase === 'walk')
  const indoorSteps = result.journey.steps.filter((step) => step.phase === 'indoor')
  const steps = [
    ...drive.steps,
    ...walkSteps.map((step, index) => ({ ...step, index: drive.steps.length + index })),
    ...indoorSteps.map((step, index) => ({
      ...step,
      index: drive.steps.length + walkSteps.length + index,
    })),
  ]
  const miles = Math.round(milesBetween(origin, parking) * 10) / 10
  const coordLabel = `${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}`
  const label =
    options?.label?.trim() ||
    (startMode === 'custom' ? `Chosen start (${coordLabel})` : `Current location (${coordLabel})`)
  return {
    ...result,
    origin: {
      latitude: origin.latitude,
      longitude: origin.longitude,
      label,
      offsetMiles: miles,
      startMode,
    },
    outdoor: {
      ...result.outdoor,
      provider: drive.provider,
      distanceM: drive.distanceM,
      distanceMiles: Math.round((drive.distanceM / 1609.344) * 10) / 10,
      durationMinutes: drive.durationMinutes,
      geometry: drive.geometry,
      steps: drive.steps,
      traffic: {
        ...drive.traffic,
        note:
          startMode === 'custom'
            ? 'Drive from the chosen start to the nearest parking. Segment index is delay versus a typical speed.'
            : 'Drive from the current location to the nearest parking. Segment index is delay versus a typical speed.',
      },
    },
    journey: {
      ...result.journey,
      totalSteps: steps.length,
      driveSteps: drive.steps.length,
      outdoorSteps: drive.steps.length,
      steps,
    },
  }
}
