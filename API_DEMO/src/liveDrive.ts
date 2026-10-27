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

const DRIVING_BASES = [
  'https://router.project-osrm.org/route/v1/driving',
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
]
const FOOT_BASES = [
  'https://router.project-osrm.org/route/v1/foot',
  'https://routing.openstreetmap.de/routed-foot/route/v1/foot',
  ...DRIVING_BASES,
]

async function fetchOsrmRoute(bases: string[], origin: LatLng, destination: LatLng) {
  let lastErr: Error | null = null
  for (const base of bases) {
    try {
      const url =
        `${base}/` +
        `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}` +
        `?overview=full&geometries=geojson&steps=true&alternatives=3&continue_straight=true`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`OSRM ${res.status}`)
      const json = (await res.json()) as { routes?: OsrmRoute[]; message?: string }
      const route = [...(json.routes ?? [])].sort(
        (a, b) => a.duration - b.duration || a.distance - b.distance,
      )[0]
      if (!route?.geometry?.coordinates?.length) throw new Error(json.message || 'No route')
      return route
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastErr ?? new Error('No road route')
}

function isStraightWalk(result: NavigateResult) {
  const provider = result.walk?.provider || ''
  if (/fallback|nearest parking walk/i.test(provider)) return true
  const coords = result.walk?.geometry?.coordinates ?? []
  if (coords.length <= 2) return true
  const walkSteps = result.journey.steps.filter((s) => s.phase === 'walk')
  const flat = walkSteps.flatMap((s) => s.geometry ?? [])
  return flat.length > 0 && flat.length <= 2
}

function walkStepsFromRoute(route: OsrmRoute): JourneyStep[] {
  const raw = route.legs?.[0]?.steps ?? []
  if (!raw.length) {
    return [
      {
        id: 'wlk-0',
        phase: 'walk',
        index: 0,
        instruction: 'Leave the car and walk to the entrance',
        latitude: route.geometry.coordinates[0]?.[1] ?? 0,
        longitude: route.geometry.coordinates[0]?.[0] ?? 0,
        distanceM: Math.round(route.distance),
        durationSec: Math.round(route.duration),
        geometry: route.geometry.coordinates,
      },
    ]
  }
  return raw.map((step, index) => {
    const [lng, lat] = step.maneuver.location
    let instruction = step.name ? `Walk via ${step.name}` : 'Continue walking'
    if (step.maneuver.type === 'depart') instruction = 'Leave the car and walk to the entrance'
    if (step.maneuver.type === 'arrive') instruction = 'Arrive at building entrance — continue inside'
    else if (step.maneuver.modifier) {
      instruction = `${step.maneuver.type.replaceAll('_', ' ')} ${step.maneuver.modifier}${step.name ? ` onto ${step.name}` : ''}`
    }
    return {
      id: `wlk-${index}`,
      phase: 'walk' as const,
      index,
      title: `Walk · Step ${index + 1}`,
      instruction,
      roadName: step.name || null,
      distanceM: Math.round(step.distance),
      durationSec: Math.round(step.duration),
      speedMph: 3,
      trafficLevel: null,
      congestionIndex: null,
      latitude: lat,
      longitude: lng,
      geometry: step.geometry?.coordinates ?? [],
    }
  })
}

async function fetchDrive(origin: LatLng, parking: LatLng) {
  const route = await fetchOsrmRoute(DRIVING_BASES, origin, parking)
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
    geometry: { type: 'LineString' as const, coordinates: route.geometry.coordinates },
    provider: 'OSRM driving (road-snapped)',
    traffic: {
      level,
      congestionIndex: Math.round(congestion * 100) / 100,
      averageSpeedMph: Math.round(avgMph * 10) / 10,
      updatedAt: new Date().toISOString(),
      note: 'Road-snapped OpenStreetMap drive. Segment index is delay versus a typical speed.',
      segments: steps.map((step) => ({
        id: step.id,
        trafficLevel: step.trafficLevel ?? 'Unknown',
        speedMph: step.speedMph ?? 0,
        distanceM: step.distanceM ?? 0,
      })),
    },
  }
}

async function fetchWalkAlongRoads(parking: LatLng, entrance: LatLng) {
  const route = await fetchOsrmRoute(FOOT_BASES, parking, entrance)
  const steps = walkStepsFromRoute(route)
  const distanceM = Math.round(route.distance)
  return {
    steps,
    distanceM,
    durationMinutes: Math.round((route.duration / 60) * 10) / 10,
    geometry: { type: 'LineString' as const, coordinates: route.geometry.coordinates },
    provider: 'OSRM foot (road-snapped)',
  }
}

function meters(a: LatLng, b: LatLng) {
  return milesBetween(a, b) * 1609.344
}

function lineMeters(coords: [number, number][]) {
  let total = 0
  for (let i = 1; i < coords.length; i += 1) {
    total += meters(
      { latitude: coords[i - 1][1], longitude: coords[i - 1][0] },
      { latitude: coords[i][1], longitude: coords[i][0] },
    )
  }
  return total
}

function closestPoint(coords: [number, number][], point: LatLng) {
  let index = 0
  let distance = Infinity
  for (let i = 0; i < coords.length; i += 1) {
    const d = meters({ latitude: coords[i][1], longitude: coords[i][0] }, point)
    if (d < distance) {
      distance = d
      index = i
    }
  }
  return { index, distance }
}

const LOT_INSTRUCTION = 'Drive into the nearest parking and leave the car'

function driveEnd(coords: [number, number][] | undefined): LatLng | null {
  const last = coords?.[coords.length - 1]
  return last ? { latitude: last[1], longitude: last[0] } : null
}

function walkLine(steps: JourneyStep[], geometry?: [number, number][]) {
  if (geometry && geometry.length > 1) return geometry
  const fromSteps = steps.flatMap((step) => step.geometry ?? [])
  return fromSteps.length > 1 ? fromSteps : []
}

/**
 * The driving route stops on the public road. The turn off that road into the lot
 * is still a drive — move it off the walk leg so the map says so.
 */
export function pullDriveIntoLot(
  driveSteps: JourneyStep[],
  driveCoords: [number, number][],
  walkSteps: JourneyStep[],
  walkCoords: [number, number][] | undefined,
  spot: LatLng,
): { driveSteps: JourneyStep[]; driveCoords: [number, number][]; walkSteps: JourneyStep[]; addedMeters: number } {
  const end = driveEnd(driveCoords)
  const line = walkLine(walkSteps, walkCoords)
  if (!end || line.length < 2) return { driveSteps, driveCoords, walkSteps, addedMeters: 0 }
  const already = driveSteps.some((step) => /drive into the nearest parking/i.test(step.instruction))
  const gap = meters(end, spot)
  const startsAtRoad = meters({ latitude: line[0][1], longitude: line[0][0] }, end) <= 50
  const near = closestPoint(line, spot)
  const approach = startsAtRoad && near.distance <= 80 && near.index >= 2 ? line.slice(0, near.index + 1) : []
  const approachM = lineMeters(approach)
  const straight = approach.length ? meters({ latitude: approach[0][1], longitude: approach[0][0] }, spot) : 0
  const usable =
    approachM >= 25 && approachM <= 700 && approachM <= Math.max(straight * 2.4, straight + 90)

  let nextDrive = driveSteps
  let nextCoords = driveCoords
  let addedMeters = 0
  if (!already && usable && gap > 40) {
    const softened = driveSteps.map((step, index) =>
      index === driveSteps.length - 1 && /park|leave the vehicle|arrive/i.test(step.instruction)
        ? { ...step, instruction: 'Continue to the parking lot entrance' }
        : step,
    )
    nextDrive = [
      ...softened,
      {
        id: `drv-lot-${softened.length}`,
        phase: 'drive',
        index: softened.length,
        title: `Drive · Step ${softened.length + 1}`,
        instruction: LOT_INSTRUCTION,
        roadName: null,
        distanceM: Math.round(approachM),
        durationSec: Math.max(8, Math.round(approachM / 4.5)),
        speedMph: 10,
        trafficLevel: 'Light',
        congestionIndex: 0,
        latitude: approach[0][1],
        longitude: approach[0][0],
        geometry: approach,
      },
    ]
    const tail = meters(end, { latitude: approach[0][1], longitude: approach[0][0] }) < 35 ? approach.slice(1) : approach
    nextCoords = [...driveCoords, ...tail]
    addedMeters = approachM
  }

  if (!usable) return { driveSteps: nextDrive, driveCoords: nextCoords, walkSteps, addedMeters }
  const rest = line.slice(near.index)
  const split = { latitude: line[near.index][1], longitude: line[near.index][0] }
  const kept: JourneyStep[] = []
  for (const step of walkSteps) {
    const geom = step.geometry ?? []
    if (geom.length < 2) continue
    const start = closestPoint(line, { latitude: geom[0][1], longitude: geom[0][0] })
    const finish = closestPoint(line, { latitude: geom[geom.length - 1][1], longitude: geom[geom.length - 1][0] })
    if (finish.index <= near.index) continue
    if (start.index >= near.index) {
      kept.push(step)
      continue
    }
    const clipped = geom.filter((coord) => closestPoint(line, { latitude: coord[1], longitude: coord[0] }).index >= near.index)
    if (clipped.length < 2) continue
    kept.push({
      ...step,
      instruction: 'Leave the car and walk to the entrance',
      latitude: split.latitude,
      longitude: split.longitude,
      distanceM: Math.round(lineMeters(clipped)),
      geometry: clipped,
    })
  }
  if (!kept.length && rest.length > 1) {
    kept.push({
      id: 'wlk-0',
      phase: 'walk',
      index: 0,
      instruction: 'Leave the car and walk to the entrance',
      latitude: split.latitude,
      longitude: split.longitude,
      distanceM: Math.round(lineMeters(rest)),
      durationSec: Math.round(lineMeters(rest) / 1.35),
      geometry: rest,
    })
  } else if (kept.length && meters({ latitude: kept[0].latitude, longitude: kept[0].longitude }, split) < 30) {
    if (/depart|turn|continue|leave parking/i.test(kept[0].instruction)) {
      kept[0] = { ...kept[0], instruction: 'Leave the car and walk to the entrance' }
    }
  }
  return { driveSteps: nextDrive, driveCoords: nextCoords, walkSteps: kept, addedMeters }
}

async function fetchLotApproach(from: LatLng, spot: LatLng) {
  const gap = meters(from, spot)
  if (gap <= 40 || gap > 700) return null
  const url =
    `https://router.project-osrm.org/route/v1/foot/` +
    `${from.longitude},${from.latitude};${spot.longitude},${spot.latitude}` +
    `?overview=full&geometries=geojson&steps=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] }
  const route = json.routes?.[0]
  if (!route?.geometry?.coordinates || route.distance < 20 || route.distance > 700) return null
  if (route.distance > Math.max(gap * 2.4, gap + 90)) return null
  return route.geometry.coordinates
}

export async function attachLotToResult(result: NavigateResult): Promise<NavigateResult> {
  const parking = result.parking
  if (!parking) return result
  const entrance = {
    latitude: result.entrance?.latitude ?? result.destination.latitude,
    longitude: result.entrance?.longitude ?? result.destination.longitude,
  }
  // Server already decided walk-from-origin / on-site — do not invent a parking approach.
  if (
    /already on site|walk to entrance|start here/i.test(parking.label || '') ||
    result.outdoor?.provider === 'on-site' ||
    !(result.outdoor?.steps?.length)
  ) {
    return result
  }
  let base = result

  // Replace building-cutting chords with OSM road/path geometry (Google Maps–style).
  if (isStraightWalk(base)) {
    try {
      const foot = await fetchWalkAlongRoads(parking, entrance)
      const driveSteps0 = base.journey.steps.filter((s) => s.phase === 'drive' || s.phase === 'outdoor')
      const indoor0 = base.journey.steps.filter((s) => s.phase === 'indoor')
      const rebuilt = [
        ...driveSteps0,
        ...foot.steps.map((step, index) => ({
          ...step,
          index: driveSteps0.length + index,
          phase: 'walk' as const,
        })),
        ...indoor0.map((step, index) => ({
          ...step,
          index: driveSteps0.length + foot.steps.length + index,
        })),
      ]
      base = {
        ...base,
        walk: {
          ...(base.walk ?? {
            distanceMiles: 0,
            durationMinutes: 0,
            steps: [],
            geometry: { type: 'LineString', coordinates: [] },
          }),
          provider: foot.provider,
          distanceM: foot.distanceM,
          distanceMiles: Math.round((foot.distanceM / 1609.344) * 10) / 10,
          durationMinutes: foot.durationMinutes,
          geometry: foot.geometry,
          steps: foot.steps,
        },
        parking: { ...parking, offsetMeters: foot.distanceM },
        journey: {
          ...base.journey,
          totalSteps: rebuilt.length,
          walkSteps: foot.steps.length,
          steps: rebuilt,
        },
      }
    } catch {
      /* keep server walk if routers are down */
    }
  }

  const driveSteps = base.journey.steps.filter((step) => step.phase === 'drive' || step.phase === 'outdoor')
  const walkSteps = base.journey.steps.filter((step) => step.phase === 'walk')
  const indoorSteps = base.journey.steps.filter((step) => step.phase === 'indoor')
  const driveCoords = base.outdoor.geometry?.coordinates?.length
    ? base.outdoor.geometry.coordinates
    : driveSteps.flatMap((step) => step.geometry ?? [])
  let nextDrive = driveSteps
  let nextCoords = driveCoords
  let nextWalk = walkSteps
  let addedMeters = 0
  const pulled = pullDriveIntoLot(driveSteps, driveCoords, walkSteps, base.walk?.geometry?.coordinates, parking)
  nextDrive = pulled.driveSteps
  nextCoords = pulled.driveCoords
  nextWalk = pulled.walkSteps
  addedMeters = pulled.addedMeters
  if (addedMeters === 0 && !nextDrive.some((step) => /drive into the nearest parking/i.test(step.instruction))) {
    const end = driveEnd(nextCoords)
    const approach = end ? await fetchLotApproach(end, parking) : null
    if (approach && end && approach.length > 2) {
      const approachM = lineMeters(approach)
      const softened = nextDrive.map((step, index) =>
        index === nextDrive.length - 1 && /park|leave the vehicle|arrive/i.test(step.instruction)
          ? { ...step, instruction: 'Continue to the parking lot entrance' }
          : step,
      )
      nextDrive = [
        ...softened,
        {
          id: `drv-lot-${softened.length}`,
          phase: 'drive',
          index: softened.length,
          title: `Drive · Step ${softened.length + 1}`,
          instruction: LOT_INSTRUCTION,
          roadName: null,
          distanceM: Math.round(approachM),
          durationSec: Math.max(8, Math.round(approachM / 4.5)),
          speedMph: 10,
          trafficLevel: 'Light',
          congestionIndex: 0,
          latitude: approach[0][1],
          longitude: approach[0][0],
          geometry: approach,
        },
      ]
      const tail = meters(end, { latitude: approach[0][1], longitude: approach[0][0] }) < 35 ? approach.slice(1) : approach
      nextCoords = [...nextCoords, ...tail]
      addedMeters = approachM
    }
  }
  const parkedAt = driveEnd(nextCoords)
  if (parkedAt && meters(parkedAt, parking) <= 45) {
    const line = walkLine(nextWalk, base.walk?.geometry?.coordinates)
    if (line.length > 1 && meters({ latitude: line[0][1], longitude: line[0][0] }, parking) > 45) {
      const trimmed = pullDriveIntoLot([], [line[0]], nextWalk, line, parking)
      if (trimmed.walkSteps.length) nextWalk = trimmed.walkSteps
    }
  }
  const walkChanged = nextWalk.some((step, index) => step.instruction !== walkSteps[index]?.instruction)
  const walkProviderChanged = base.walk?.provider !== result.walk?.provider
  if (addedMeters === 0 && nextWalk.length === walkSteps.length && !walkChanged && !walkProviderChanged) {
    return base
  }
  const steps = [
    ...nextDrive,
    ...nextWalk.map((step, index) => ({ ...step, index: nextDrive.length + index, phase: 'walk' as const })),
    ...indoorSteps.map((step, index) => ({
      ...step,
      index: nextDrive.length + nextWalk.length + index,
    })),
  ]
  const distanceM = Math.round((base.outdoor.distanceM || 0) + addedMeters)
  const walkDistance = nextWalk.reduce((sum, step) => sum + (step.distanceM ?? 0), 0)
  return {
    ...base,
    parking: { ...parking, offsetMeters: Math.round(walkDistance) },
    outdoor: {
      ...base.outdoor,
      distanceM,
      distanceMiles: Math.round((distanceM / 1609.344) * 10) / 10,
      durationMinutes: Math.round(((base.outdoor.durationMinutes || 0) + addedMeters / 4.5 / 60) * 10) / 10,
      geometry: { type: 'LineString', coordinates: nextCoords },
      steps: nextDrive,
    },
    walk: base.walk
      ? {
          ...base.walk,
          distanceM: Math.round(walkDistance),
          distanceMiles: Math.round((walkDistance / 1609.344) * 10) / 10,
          durationMinutes: Math.round((walkDistance / 1.35 / 60) * 10) / 10,
          geometry: {
            type: 'LineString',
            coordinates: nextWalk.flatMap((step) => step.geometry ?? []),
          },
          steps: nextWalk,
        }
      : base.walk,
    journey: {
      ...base.journey,
      totalSteps: steps.length,
      driveSteps: nextDrive.length,
      walkSteps: nextWalk.length,
      outdoorSteps: nextDrive.length,
      steps,
    },
  }
}

const AT_ENTRANCE_M = 100
const WALK_FROM_HERE_M = 700

/** Keep walk and indoor legs. Replace the drive when the API still used the simulated start. */
export async function withLiveDrive(
  result: NavigateResult,
  origin: LatLng,
  options?: { label?: string; startMode?: 'live' | 'custom' },
): Promise<NavigateResult> {
  const entrance = {
    latitude: result.entrance?.latitude ?? result.destination.latitude,
    longitude: result.entrance?.longitude ?? result.destination.longitude,
  }
  const toEntrance = meters(origin, entrance)
  const startMode = options?.startMode ?? 'live'
  const coordLabel = `${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}`
  const label =
    options?.label?.trim() ||
    (startMode === 'custom' ? `Chosen start (${coordLabel})` : `Current location (${coordLabel})`)

  // Already on site or nearby — never send the user to parking and walk back.
  if (toEntrance <= WALK_FROM_HERE_M) {
    const indoorSteps = result.journey.steps.filter((step) => step.phase === 'indoor')
    let walkSteps: JourneyStep[] = []
    let walkGeom: [number, number][] = [[origin.longitude, origin.latitude]]
    let walkDistance = Math.round(toEntrance)
    if (toEntrance <= AT_ENTRANCE_M) {
      walkSteps = [
        {
          id: 'wlk-0',
          phase: 'walk',
          index: 0,
          instruction: "You're already at the entrance — continue inside",
          latitude: entrance.latitude,
          longitude: entrance.longitude,
          distanceM: 0,
          durationSec: 0,
          geometry: [[entrance.longitude, entrance.latitude]],
        },
      ]
      walkDistance = 0
      walkGeom = [[entrance.longitude, entrance.latitude]]
    } else {
      try {
        const foot = await fetchWalkAlongRoads(origin, entrance)
        walkSteps = foot.steps
        walkDistance = foot.distanceM
        walkGeom = foot.geometry.coordinates
      } catch {
        walkSteps = [
          {
            id: 'wlk-0',
            phase: 'walk',
            index: 0,
            instruction: 'Walk to the building entrance',
            latitude: origin.latitude,
            longitude: origin.longitude,
            distanceM: walkDistance,
            durationSec: Math.round(walkDistance / 1.35),
            geometry: [
              [origin.longitude, origin.latitude],
              [entrance.longitude, entrance.latitude],
            ],
          },
        ]
        walkGeom = walkSteps[0].geometry ?? walkGeom
      }
    }
    const steps = [
      ...walkSteps.map((step, index) => ({ ...step, index, phase: 'walk' as const })),
      ...indoorSteps.map((step, index) => ({
        ...step,
        index: walkSteps.length + index,
      })),
    ]
    return {
      ...result,
      origin: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        label,
        offsetMiles: Math.round(milesBetween(origin, entrance) * 10) / 10,
        startMode,
      },
      parking: {
        latitude: origin.latitude,
        longitude: origin.longitude,
        label: toEntrance <= AT_ENTRANCE_M ? 'Already on site' : 'Start here — walk to entrance',
        offsetMeters: walkDistance,
      },
      outdoor: {
        ...result.outdoor,
        provider: 'on-site',
        distanceM: 0,
        distanceMiles: 0,
        durationMinutes: 0,
        geometry: { type: 'LineString', coordinates: [[origin.longitude, origin.latitude]] },
        steps: [],
        traffic: {
          level: 'None',
          congestionIndex: 0,
          averageSpeedMph: 0,
          updatedAt: new Date().toISOString(),
          note:
            toEntrance <= AT_ENTRANCE_M
              ? 'You are already at the building — skip driving to parking.'
              : 'Close enough to walk — no drive to parking.',
          segments: [],
        },
      },
      walk: {
        provider: 'on-site walk',
        distanceM: walkDistance,
        distanceMiles: Math.round((walkDistance / 1609.344) * 10) / 10,
        durationMinutes: Math.round((walkDistance / 1.35 / 60) * 10) / 10,
        geometry: { type: 'LineString', coordinates: walkGeom },
        steps: walkSteps,
      },
      journey: {
        ...result.journey,
        totalSteps: steps.length,
        driveSteps: 0,
        outdoorSteps: 0,
        walkSteps: walkSteps.length,
        steps,
        summary:
          toEntrance <= AT_ENTRANCE_M
            ? 'Already at the entrance — continue inside.'
            : 'Walk to the entrance, then continue inside.',
      },
    }
  }

  if (serverUsedOrigin(result, origin)) return attachLotToResult(result)
  const keepServerOnFailure = result.origin.startMode !== 'demo'
  const parking = result.parking ?? {
    latitude: result.destination.latitude,
    longitude: result.destination.longitude,
    label: 'Parking',
    offsetMeters: 0,
  }

  // Parking farther away than the entrance → walk instead of a out-and-back detour.
  if (meters(origin, parking) > meters(origin, entrance) + 80 && toEntrance <= 1200) {
    try {
      const foot = await fetchWalkAlongRoads(origin, entrance)
      const indoorSteps = result.journey.steps.filter((step) => step.phase === 'indoor')
      const steps = [
        ...foot.steps.map((step, index) => ({ ...step, index, phase: 'walk' as const })),
        ...indoorSteps.map((step, index) => ({
          ...step,
          index: foot.steps.length + index,
        })),
      ]
      return {
        ...result,
        origin: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          label,
          offsetMiles: Math.round(milesBetween(origin, entrance) * 10) / 10,
          startMode,
        },
        parking: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          label: 'Start here — walk to entrance',
          offsetMeters: foot.distanceM,
        },
        outdoor: {
          ...result.outdoor,
          provider: 'on-site',
          distanceM: 0,
          distanceMiles: 0,
          durationMinutes: 0,
          geometry: { type: 'LineString', coordinates: [[origin.longitude, origin.latitude]] },
          steps: [],
          traffic: {
            level: 'None',
            congestionIndex: 0,
            averageSpeedMph: 0,
            updatedAt: new Date().toISOString(),
            note: 'Nearest parking was farther than the entrance — walking instead.',
            segments: [],
          },
        },
        walk: {
          provider: foot.provider,
          distanceM: foot.distanceM,
          distanceMiles: Math.round((foot.distanceM / 1609.344) * 10) / 10,
          durationMinutes: foot.durationMinutes,
          geometry: foot.geometry,
          steps: foot.steps,
        },
        journey: {
          ...result.journey,
          totalSteps: steps.length,
          driveSteps: 0,
          outdoorSteps: 0,
          walkSteps: foot.steps.length,
          steps,
          summary: 'Walk to the entrance, then continue inside.',
        },
      }
    } catch {
      /* fall through to normal drive */
    }
  }

  let drive: Awaited<ReturnType<typeof fetchDrive>>
  try {
    drive = await fetchDrive(origin, parking)
  } catch (err) {
    if (keepServerOnFailure) return attachLotToResult(result)
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
  return attachLotToResult({
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
  })
}
