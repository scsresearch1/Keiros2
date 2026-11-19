export type Hierarchy = {
  complexes: { id: string; name: string; city?: string; address?: string; status?: string }[]
  buildings: {
    id: string
    name: string
    complexId: string | null
    complexName: string | null
    floors: number
    status: string
  }[]
  floors: {
    id: string
    label: string
    level: number
    buildingId: string
    buildingName: string
    complexId: string | null
  }[]
  units: {
    id: string
    name: string
    type: string
    code: string
    floorId: string
    floorLabel: string
    buildingId: string
    buildingName: string
    complexId: string | null
    complexName: string | null
    latitude: number
    longitude: number
    elevation: number
  }[]
}

export type JourneyPhase = 'drive' | 'walk' | 'indoor' | 'outdoor'

export type IndoorKind = 'exit' | 'enter'

export type JourneyStep = {
  id: string
  phase: JourneyPhase
  index: number
  indoorIndex?: number
  /** exit = leave start building; enter = arrive at destination unit */
  indoorKind?: IndoorKind
  title?: string
  instruction: string
  roadName?: string | null
  distanceM?: number
  durationSec?: number | null
  speedMph?: number
  trafficLevel?: string | null
  congestionIndex?: number | null
  latitude: number
  longitude: number
  geometry?: [number, number][]
  floorLabel?: string
  floorId?: string
  stopId?: string
  stopName?: string
  stopType?: string
}

export type NavigateResult = {
  requestId: string
  sessionId: string
  selection: {
    complex: { id: string; name: string; city?: string; address?: string } | null
    building: { id: string; name: string; floors: number; status: string }
    floor: { id: string; label: string; level: number }
    unit: {
      id: string
      name: string
      type: string
      code: string
      floorId: string
      floorLabel: string
      latitude: number
      longitude: number
      elevation: number
      physicalAddress?: string | null
    }
  }
  origin: {
    latitude: number
    longitude: number
    label: string
    /** Property / complex address from backend (not reverse-geocoded) */
    address?: string | null
    offsetMiles: number
    startMode?: 'demo' | 'live' | 'custom'
    viaParking?: boolean
    /** Live GPS travel mode used for the last recalculation (walk → sidewalks). */
    liveTravelMode?: 'walk' | 'drive'
    /**
     * Current GPS used as the corridor start for live recalculation.
     * Session start pin (S) stays on latitude/longitude — only set on new Navigate.
     */
    liveFrom?: { latitude: number; longitude: number }
  }
  parking?: {
    latitude: number
    longitude: number
    label: string
    offsetMeters: number
    mode?: string
  }
  entrance?: { latitude: number; longitude: number; label: string; type?: string }
  destination: { latitude: number; longitude: number; label: string; address?: string }
  outdoor: {
    provider: string
    distanceM: number
    distanceMiles: number
    durationMinutes: number
    geometry: { type: string; coordinates: [number, number][] }
    steps?: JourneyStep[]
    note?: string
    arrivalMode?: string
    profile?: string
    walk?: NavigateResult['walk']
    parking?: NavigateResult['parking']
    entrance?: NavigateResult['entrance']
    traffic: {
      level: string
      congestionIndex: number
      averageSpeedMph?: number
      updatedAt?: string
      note: string
      segments?: { id: string; trafficLevel: string; speedMph: number; distanceM: number }[]
    }
    warning?: string
  }
  walk?: {
    provider: string
    distanceM: number
    distanceMiles: number
    durationMinutes: number
    geometry: { type: string; coordinates: [number, number][] }
    steps?: JourneyStep[]
  }
  weather: {
    provider: string
    temperatureF?: number
    feelsLikeF?: number
    humidityPct?: number
    windMph?: number
    windDirectionDeg?: number
    precipitationIn?: number
    summary?: string
    fetchedAt?: string
    error?: string
  }
  journey: {
    totalSteps: number
    driveSteps?: number
    walkSteps?: number
    indoorSteps?: number
    outdoorSteps?: number
    phases?: string[]
    summary?: string
    steps: JourneyStep[]
  }
  indoor: {
    distanceM: number
    walkMinutes: number
    floorChanges: number
    entry: Record<string, unknown> | null
    stops: {
      id: string
      name: string
      type: string
      floorId: string
      floorLabel: string
      latitude: number
      longitude: number
      elevation: number
    }[]
    exit?: {
      distanceM: number
      walkMinutes: number
      floorChanges: number
      entry: Record<string, unknown> | null
      start: Record<string, unknown> | null
      stops: {
        id: string
        name: string
        type: string
        floorId: string
        floorLabel: string
        latitude: number
        longitude: number
        elevation: number
      }[]
    } | null
  }
  map3d: {
    building: { id: string; name: string; floors: number; complexId: string | null }
    floors: { id: string; label: string; level: number; buildingId: string }[]
    locations: {
      id: string
      name: string
      type: string
      floorId: string
      latitude: number
      longitude: number
      elevation: number
    }[]
    selectedFloorId: string
    selectedUnitId: string
    routeStops: {
      id: string
      name: string
      floorId: string
      latitude: number
      longitude: number
      elevation: number
    }[]
    /** Origin-building exit path when start is indoors (may be empty). */
    exitRouteStops?: {
      id: string
      name: string
      floorId: string
      latitude: number
      longitude: number
      elevation: number
    }[]
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || ''

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `HTTP ${res.status}`)
  }
  return json as T
}

export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/api/health`)
  return parse<{
    ok: boolean
    service: string
    dataMode?: string
    firestoreLive?: boolean
  }>(res)
}

export async function fetchHierarchy(apiKey: string) {
  const res = await fetch(`${API_BASE}/api/v1/hierarchy`, { headers: headers(apiKey) })
  return parse<Hierarchy & { requestId: string }>(res)
}

export async function navigate(
  apiKey: string,
  body: {
    complexId: string | null
    buildingId: string
    floorId: string
    unitId: string
    startMode?: 'demo' | 'live' | 'custom'
    /** When true, include drive → parking → walk. Default is direct indoor to the unit. */
    viaParking?: boolean
    /** Keiros DB Parking location (not Google/OSM amenity parking). */
    parkingId?: string
    parkingLatitude?: number
    parkingLongitude?: number
    parkingLabel?: string
    originLatitude?: number
    originLongitude?: number
    originLabel?: string
  },
) {
  const res = await fetch(`${API_BASE}/api/v1/navigate`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
  })
  const raw = await parse<NavigateResult & { outdoor?: NavigateResult['outdoor'] & { walk?: NavigateResult['walk'] } }>(
    res,
  )
  // Normalize older server payloads that nest walk under outdoor or omit fields.
  const walk = raw.walk ?? raw.outdoor?.walk
  const parking = raw.parking ?? (raw.outdoor as { parking?: NavigateResult['parking'] } | undefined)?.parking
  const entrance =
    raw.entrance ?? (raw.outdoor as { entrance?: NavigateResult['entrance'] } | undefined)?.entrance
  const steps = (raw.journey?.steps ?? []).map((step) =>
    step.phase === 'indoor' && !step.indoorKind
      ? ({ ...step, indoorKind: 'enter' as const })
      : step,
  )
  const result = {
    ...raw,
    walk,
    parking,
    entrance,
    journey: {
      totalSteps: raw.journey?.totalSteps ?? steps.length,
      driveSteps:
        raw.journey?.driveSteps ??
        steps.filter((s) => s.phase === 'drive' || s.phase === 'outdoor').length,
      walkSteps: raw.journey?.walkSteps ?? steps.filter((s) => s.phase === 'walk').length,
      indoorSteps: raw.journey?.indoorSteps ?? steps.filter((s) => s.phase === 'indoor').length,
      outdoorSteps: raw.journey?.outdoorSteps,
      phases: raw.journey?.phases ?? ['drive', 'walk', 'indoor'],
      summary:
        raw.journey?.summary ??
        'Drive to parking → walk to building entrance → navigate inside to the unit.',
      steps,
    },
  } as NavigateResult
  result.weather = await ensureWeather(
    result.weather,
    result.destination.latitude,
    result.destination.longitude,
  )
  return ensureOriginExitIndoor(result)
}

const INSIDE_START_M = 45

function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const R = 6371000
  const p = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * p
  const dLng = (b.longitude - a.longitude) * p
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * p) * Math.cos(b.latitude * p) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Client fallback when the API has not yet shipped origin-exit indoor:
 * if the start pin sits on a mapped floor location, synthesize exit steps
 * (start → entrance) and keep enter indoor after outdoor.
 */
function ensureOriginExitIndoor(result: NavigateResult): NavigateResult {
  if (result.journey.steps.some((s) => s.phase === 'indoor' && s.indoorKind === 'exit')) {
    return result
  }
  if (result.origin.startMode === 'demo') return result
  const locs = result.map3d?.locations ?? []
  if (!locs.length) return result
  const origin = { latitude: result.origin.latitude, longitude: result.origin.longitude }
  const nearest = [...locs]
    .map((loc) => ({ loc, d: metersBetween(origin, loc) }))
    .sort((a, b) => a.d - b.d)[0]
  if (!nearest || nearest.d > INSIDE_START_M) return result

  const entryStop =
    (result.indoor?.entry as { id?: string; name?: string; type?: string; floorId?: string; latitude?: number; longitude?: number } | null) ||
    null
  const entryFromLocs =
    locs.find((l) => /entry|lobby|door|exit/i.test(`${l.type} ${l.name}`)) ||
    locs.find((l) => entryStop && l.id === entryStop.id) ||
    null
  const exitPin =
    entryFromLocs ||
    (entryStop && Number.isFinite(entryStop.latitude) && Number.isFinite(entryStop.longitude)
      ? {
          id: String(entryStop.id || 'exit'),
          name: String(entryStop.name || 'Exit'),
          type: String(entryStop.type || 'Entry'),
          floorId: String(entryStop.floorId || nearest.loc.floorId),
          latitude: entryStop.latitude as number,
          longitude: entryStop.longitude as number,
          elevation: 0,
        }
      : null)
  if (!exitPin || exitPin.id === nearest.loc.id) return result

  const exitStops = [
    {
      id: nearest.loc.id,
      name: nearest.loc.name,
      type: nearest.loc.type,
      floorId: nearest.loc.floorId,
      floorLabel: '',
      latitude: nearest.loc.latitude,
      longitude: nearest.loc.longitude,
      elevation: nearest.loc.elevation,
    },
    {
      id: exitPin.id,
      name: exitPin.name,
      type: exitPin.type || 'Entry',
      floorId: exitPin.floorId,
      floorLabel: '',
      latitude: exitPin.latitude,
      longitude: exitPin.longitude,
      elevation: 0,
    },
  ]
  const exitSteps: JourneyStep[] = exitStops.map((stop, i) => ({
    id: `in-exit-${i}`,
    phase: 'indoor',
    index: i,
    indoorIndex: i,
    indoorKind: 'exit',
    instruction:
      i === 0
        ? `Start inside at ${stop.name} — head toward the exit`
        : `Exit at ${stop.name} — continue outdoors`,
    title: i === 0 ? 'Inside · Exit building' : 'Inside · Exit',
    latitude: stop.latitude,
    longitude: stop.longitude,
    floorId: stop.floorId,
    stopId: stop.id,
    stopName: stop.name,
    stopType: stop.type,
    distanceM: i === 0 ? 0 : Math.round(metersBetween(exitStops[0], exitStops[1])),
  }))

  const outdoor = result.journey.steps.filter((s) => s.phase !== 'indoor')
  const enter = result.journey.steps
    .filter((s) => s.phase === 'indoor')
    .map((s) => ({ ...s, indoorKind: (s.indoorKind || 'enter') as IndoorKind }))
  const steps = stitchOutdoorWithIndoor(
    outdoor.map((s, i) => ({ ...s, index: i })),
    [...exitSteps, ...enter],
  )

  return {
    ...result,
    map3d: {
      ...result.map3d,
      exitRouteStops: exitStops.map(({ id, name, floorId, latitude, longitude, elevation }) => ({
        id,
        name,
        floorId,
        latitude,
        longitude,
        elevation,
      })),
    },
    indoor: {
      ...result.indoor,
      exit: {
        distanceM: exitSteps.reduce((sum, s) => sum + (s.distanceM || 0), 0),
        walkMinutes: 1,
        floorChanges: 0,
        entry: exitPin,
        start: nearest.loc,
        stops: exitStops,
      },
    },
    journey: {
      ...result.journey,
      totalSteps: steps.length,
      indoorSteps: exitSteps.length + enter.length,
      phases: ['indoor', ...(result.journey.phases || []).filter((p) => p !== 'indoor'), 'indoor'],
      summary: `Exit building → outdoors → ${result.journey.summary || 'to unit'}`,
      steps,
    },
  }
}

const WMO: Record<number, string> = {
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

export async function ensureWeather(
  weather: NavigateResult['weather'],
  latitude: number,
  longitude: number,
): Promise<NavigateResult['weather']> {
  if (weather?.temperatureF != null && weather.summary && weather.summary !== 'Weather unavailable') {
    return weather
  }
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', String(latitude))
    url.searchParams.set('longitude', String(longitude))
    url.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation',
    )
    url.searchParams.set('temperature_unit', 'fahrenheit')
    url.searchParams.set('wind_speed_unit', 'mph')
    url.searchParams.set('precipitation_unit', 'inch')
    const res = await fetch(url)
    if (!res.ok) return weather
    const json = (await res.json()) as { current?: Record<string, number | string> }
    const current = json.current
    if (!current) return weather
    const code = Number(current.weather_code)
    return {
      provider: 'Open-Meteo (live)',
      temperatureF: Number(current.temperature_2m),
      feelsLikeF: Number(current.apparent_temperature),
      humidityPct: Number(current.relative_humidity_2m),
      windMph: Number(current.wind_speed_10m),
      windDirectionDeg: Number(current.wind_direction_10m),
      precipitationIn: Number(current.precipitation),
      summary: WMO[code] ?? `Code ${code}`,
      fetchedAt: String(current.time || new Date().toISOString()),
    }
  } catch {
    return weather
  }
}

export type RefreshedConditions = {
  weather: NavigateResult['weather']
  outdoor: {
    traffic: NavigateResult['outdoor']['traffic']
    steps?: JourneyStep[]
    provider: string
    distanceM?: number
    distanceMiles?: number
    durationMinutes?: number
    geometry?: NavigateResult['outdoor']['geometry']
  }
  refreshedAt: string
}

export async function refreshConditions(
  apiKey: string,
  input: {
    latitude: number
    longitude: number
    originMiles?: number
    origin?: { latitude: number; longitude: number }
    parking?: { latitude: number; longitude: number }
  },
) {
  const qs = new URLSearchParams({
    lat: String(input.latitude),
    lng: String(input.longitude),
    originMiles: String(input.originMiles ?? 20),
  })
  if (input.origin) {
    qs.set('originLat', String(input.origin.latitude))
    qs.set('originLng', String(input.origin.longitude))
  }
  if (input.parking) {
    qs.set('parkLat', String(input.parking.latitude))
    qs.set('parkLng', String(input.parking.longitude))
  }
  const res = await fetch(`${API_BASE}/api/v1/conditions?${qs}`, { headers: headers(apiKey) })
  const live = await parse<RefreshedConditions>(res)
  live.weather = await ensureWeather(live.weather, input.latitude, input.longitude)
  return live
}

/** Keep exit indoor before outdoor and enter indoor after — never flatten all indoor to the end. */
export function splitIndoorByKind(steps: JourneyStep[]) {
  const exit = steps.filter((step) => step.phase === 'indoor' && step.indoorKind === 'exit')
  const enter = steps.filter((step) => step.phase === 'indoor' && step.indoorKind !== 'exit')
  return { exit, enter }
}

export function stitchOutdoorWithIndoor(
  outdoor: JourneyStep[],
  prevSteps: JourneyStep[],
): JourneyStep[] {
  const { exit, enter } = splitIndoorByKind(prevSteps)
  const mid = outdoor.map((step, index) => ({ ...step, index: exit.length + index }))
  return [
    ...exit.map((step, index) => ({ ...step, index })),
    ...mid,
    ...enter.map((step, index) => ({ ...step, index: exit.length + mid.length + index })),
  ]
}

export function applyDriveRefresh(prev: NavigateResult, live: RefreshedConditions): NavigateResult {
  const drive = (live.outdoor.steps ?? []).map((step, index) => ({
    ...step,
    phase: 'drive' as const,
    index,
    title: step.title || `Drive · Step ${index + 1}`,
  }))
  const useDrive = drive.length > 0
  const walk = prev.journey.steps.filter((step) => step.phase === 'walk')
  const outdoor = [
    ...drive,
    ...walk.map((step, index) => ({ ...step, index: drive.length + index })),
  ]
  const steps = useDrive ? stitchOutdoorWithIndoor(outdoor, prev.journey.steps) : prev.journey.steps
  return {
    ...prev,
    weather: live.weather,
    outdoor: {
      ...prev.outdoor,
      provider: live.outdoor.provider || prev.outdoor.provider,
      distanceM: live.outdoor.distanceM ?? prev.outdoor.distanceM,
      distanceMiles: live.outdoor.distanceMiles ?? prev.outdoor.distanceMiles,
      durationMinutes: live.outdoor.durationMinutes ?? prev.outdoor.durationMinutes,
      geometry: live.outdoor.geometry ?? prev.outdoor.geometry,
      steps: useDrive ? drive : prev.outdoor.steps,
      traffic: live.outdoor.traffic,
    },
    journey: useDrive
      ? {
          ...prev.journey,
          totalSteps: steps.length,
          driveSteps: drive.length,
          outdoorSteps: drive.length,
          steps,
        }
      : prev.journey,
  }
}

export function phaseLabel(phase: JourneyPhase) {
  if (phase === 'drive' || phase === 'outdoor') return 'Drive'
  if (phase === 'walk') return 'Walk'
  return 'Inside'
}
