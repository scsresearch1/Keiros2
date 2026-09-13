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

export type JourneyStep = {
  id: string
  phase: JourneyPhase
  index: number
  indoorIndex?: number
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
    }
  }
  origin: { latitude: number; longitude: number; label: string; offsetMiles: number }
  parking?: { latitude: number; longitude: number; label: string; offsetMeters: number }
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
  return parse<{ ok: boolean; service: string }>(res)
}

export async function fetchHierarchy(apiKey: string) {
  const res = await fetch(`${API_BASE}/api/v1/hierarchy`, { headers: headers(apiKey) })
  return parse<Hierarchy & { requestId: string }>(res)
}

export async function navigate(
  apiKey: string,
  body: { complexId: string | null; buildingId: string; floorId: string; unitId: string },
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
  const steps = raw.journey?.steps ?? []
  return {
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
}

export async function refreshConditions(
  apiKey: string,
  lat: number,
  lng: number,
  originMiles = 20,
) {
  const qs = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    originMiles: String(originMiles),
  })
  const res = await fetch(`${API_BASE}/api/v1/conditions?${qs}`, { headers: headers(apiKey) })
  return parse<{
    weather: NavigateResult['weather']
    outdoor: { traffic: NavigateResult['outdoor']['traffic']; steps?: JourneyStep[]; provider: string }
    refreshedAt: string
  }>(res)
}

export function phaseLabel(phase: JourneyPhase) {
  if (phase === 'drive' || phase === 'outdoor') return 'Drive'
  if (phase === 'walk') return 'Walk'
  return 'Inside'
}
