import { googleMapsApiKey, latLngLiteral } from './googleMaps'
import type { JourneyStep } from './api'

export type RouteTravelMode = 'DRIVE' | 'WALK'

export type RoadRoute = {
  path: google.maps.LatLngLiteral[]
  distanceM: number
  durationSec: number
  mode: RouteTravelMode
  steps: JourneyStep[]
}

function asLiteral(
  p: google.maps.LatLngLiteral | google.maps.LatLng | google.maps.LatLngAltitude | { lat: number | (() => number); lng: number | (() => number) },
): google.maps.LatLngLiteral {
  const latRaw = p.lat as number | (() => number)
  const lngRaw = p.lng as number | (() => number)
  const lat = typeof latRaw === 'function' ? latRaw.call(p) : Number(latRaw)
  const lng = typeof lngRaw === 'function' ? lngRaw.call(p) : Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid path point: ${String(latRaw)}, ${String(lngRaw)}`)
  }
  return latLngLiteral(lat, lng)
}

function metersBetween(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Keep Google's road / pathway snap.
 * Drive: only nudge nearby endpoints (don't invent long off-road chords).
 * Walk: always finish at the destination pin (user must reach the real coordinate).
 */
export function pinPathToEndpoints(
  path: google.maps.LatLngLiteral[],
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  snapMeters = 12,
  maxConnectMeters = 28,
  opts?: { alwaysReachEnd?: boolean },
): google.maps.LatLngLiteral[] {
  if (!path.length) return []
  const out = path.map((p) => ({ ...p }))

  const startGap = metersBetween(out[0], origin)
  if (startGap <= snapMeters) out[0] = origin
  else if (startGap <= maxConnectMeters) out.unshift(origin)
  // else: leave first point on the mapped network

  const end = out[out.length - 1]
  const endGap = metersBetween(end, destination)
  if (endGap <= snapMeters) out[out.length - 1] = destination
  else if (endGap <= maxConnectMeters || opts?.alwaysReachEnd) out.push(destination)
  // else (drive): leave last point on the mapped network

  return out
}

/** How far the routed path ends from the requested target (meters). */
export function pathEndGapM(
  path: google.maps.LatLngLiteral[],
  target: google.maps.LatLngLiteral,
): number {
  if (!path.length) return Number.POSITIVE_INFINITY
  return metersBetween(path[path.length - 1], target)
}

function parseDurationSec(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // JS library may return millis
    return value > 10_000 ? Math.round(value / 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    const m = value.match(/^(\d+(?:\.\d+)?)s$/i)
    if (m) return Math.round(Number(m[1]))
    const n = Number(value)
    if (Number.isFinite(n)) return Math.round(n)
  }
  return 0
}

function phaseFor(mode: RouteTravelMode): 'drive' | 'walk' {
  return mode === 'WALK' ? 'walk' : 'drive'
}

function fallbackSteps(
  path: google.maps.LatLngLiteral[],
  mode: RouteTravelMode,
  distanceM: number,
  durationSec: number,
  idPrefix: string,
): JourneyStep[] {
  const start = path[0] ?? { lat: 0, lng: 0 }
  const end = path[path.length - 1] ?? start
  const phase = phaseFor(mode)
  return [
    {
      id: `${idPrefix}-0`,
      phase,
      index: 0,
      instruction: mode === 'WALK' ? 'Walk along the path' : 'Drive along the route',
      latitude: start.lat,
      longitude: start.lng,
      distanceM,
      durationSec,
      geometry: path.map((p) => [p.lng, p.lat] as [number, number]),
    },
    {
      id: `${idPrefix}-arrive`,
      phase,
      index: 1,
      instruction:
        mode === 'WALK'
          ? 'Arrive at building entrance — continue inside'
          : 'Arrive at parking — leave the car and walk',
      latitude: end.lat,
      longitude: end.lng,
      distanceM: 0,
      durationSec: 0,
      geometry: [[end.lng, end.lat]],
    },
  ]
}

/** Bearing degrees [0,360) along a short segment. */
function bearingOf(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δλ = toRad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Infer left / right / straight from the step polyline (source of truth for the blue path).
 * Positive turn = right (clockwise from north).
 */
export function turnSideFromGeometry(
  geometry: [number, number][],
): 'left' | 'right' | 'straight' | null {
  if (!geometry || geometry.length < 3) return null
  const pts = geometry.map(([lng, lat]) => ({ lat, lng }))
  // Use early segment vs late segment around the bend.
  const i1 = Math.min(1, pts.length - 1)
  const i2 = Math.max(i1 + 1, Math.floor(pts.length * 0.35))
  const i3 = Math.max(i2 + 1, Math.floor(pts.length * 0.7))
  const i4 = pts.length - 1
  if (i2 >= i4) return null
  const inB = bearingOf(pts[0], pts[Math.min(i2, pts.length - 1)])
  const outB = bearingOf(pts[Math.min(i3, pts.length - 1)], pts[i4])
  let delta = ((outB - inB + 540) % 360) - 180
  if (Math.abs(delta) < 28) return 'straight'
  return delta > 0 ? 'right' : 'left'
}

/** Fix Google/OSRM wording when the drawn geometry clearly turns the other way. */
export function alignTurnInstruction(
  instruction: string,
  geometry?: [number, number][] | null,
): string {
  const side = geometry ? turnSideFromGeometry(geometry) : null
  if (!side || side === 'straight') return instruction
  const t = instruction
  if (side === 'left' && /\bright\b/i.test(t) && !/\bleft\b/i.test(t)) {
    return t.replace(/\bright\b/gi, (m) => (m[0] === 'R' ? 'Left' : 'left'))
  }
  if (side === 'right' && /\bleft\b/i.test(t) && !/\bright\b/i.test(t)) {
    return t.replace(/\bleft\b/gi, (m) => (m[0] === 'L' ? 'Right' : 'right'))
  }
  return instruction
}

function stepsFromGoogleRest(
  steps: Array<{
    navigationInstruction?: { maneuver?: string; instructions?: string }
    distanceMeters?: number
    staticDuration?: string
    startLocation?: { latLng?: { latitude?: number; longitude?: number } }
    polyline?: { encodedPolyline?: string }
  }>,
  mode: RouteTravelMode,
  idPrefix: string,
): JourneyStep[] {
  const phase = phaseFor(mode)
  return steps.map((step, index) => {
    const lat = Number(step.startLocation?.latLng?.latitude)
    const lng = Number(step.startLocation?.latLng?.longitude)
    const rawInstr =
      step.navigationInstruction?.instructions?.trim() ||
      (mode === 'WALK' ? 'Continue walking' : 'Continue driving')
    const poly = step.polyline?.encodedPolyline
      ? decodePolyline(step.polyline.encodedPolyline).map((p) => [p.lng, p.lat] as [number, number])
      : Number.isFinite(lat) && Number.isFinite(lng)
        ? [[lng, lat] as [number, number]]
        : []
    // Prefer geometry for left/right — matches the blue line the user sees.
    const instr = alignTurnInstruction(rawInstr, poly)
    const maneuver = step.navigationInstruction?.maneuver || undefined
    return {
      id: `${idPrefix}-${index}`,
      phase,
      index,
      title: `${mode === 'WALK' ? 'Walk' : 'Drive'} · Step ${index + 1}`,
      instruction: instr,
      roadName: null,
      distanceM: Math.round(step.distanceMeters ?? 0),
      durationSec: parseDurationSec(step.staticDuration),
      latitude: Number.isFinite(lat) ? lat : 0,
      longitude: Number.isFinite(lng) ? lng : 0,
      geometry: poly,
      ...(maneuver ? { maneuver } : {}),
    }
  })
}

/**
 * Road / sidewalk path via the Routes library (replaces legacy DirectionsService).
 */
export async function computeRoadPath(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<google.maps.LatLngLiteral[]> {
  const route = await computeRoadRouteJs(origin, destination, mode)
  return route.path
}

async function computeRoadRouteJs(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<RoadRoute> {
  const maps = await google.maps.importLibrary('routes')
  const RouteCtor = (maps as google.maps.RoutesLibrary).Route
  if (!RouteCtor?.computeRoutes) {
    throw new Error('Routes library unavailable — enable Routes API on your Google Cloud key')
  }

  const request: google.maps.routes.ComputeRoutesRequest = {
    origin: { lat: origin.lat, lng: origin.lng },
    destination: { lat: destination.lat, lng: destination.lng },
    travelMode: mode === 'WALK' ? 'WALKING' : 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
    polylineQuality: 'HIGH_QUALITY',
  }
  if (mode === 'DRIVE') {
    request.routingPreference = 'TRAFFIC_AWARE'
  }

  const { routes } = await RouteCtor.computeRoutes(request)
  const first = routes?.[0]
  const raw = first?.path
  if (!raw?.length) throw new Error('No route path returned')

  // Snap only if already on-network near the pin — never stretch a drive line to the door.
  const path = pinPathToEndpoints(
    raw.map((p) => asLiteral(p)),
    origin,
    destination,
    8,
    5,
  )
  const distanceM = Math.round(
    Number((first as { distanceMeters?: number }).distanceMeters) ||
      path.reduce((sum, p, i) => (i === 0 ? 0 : sum + metersBetween(path[i - 1], p)), 0),
  )
  const durationSec = parseDurationSec((first as { durationMillis?: number }).durationMillis)
  return {
    path,
    distanceM,
    durationSec: durationSec || Math.round(distanceM / (mode === 'WALK' ? 1.35 : 11)),
    mode,
    steps: fallbackSteps(path, mode, distanceM, durationSec, mode === 'WALK' ? 'wlk' : 'drv'),
  }
}

/** REST fallback — includes turn-by-turn steps when available. */
export async function computeRoadPathRest(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<google.maps.LatLngLiteral[]> {
  const route = await computeRoadRouteRest(origin, destination, mode)
  return route.path
}

async function computeRoadRouteRest(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<RoadRoute> {
  const key = googleMapsApiKey()
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.legs.steps.polyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: {
        location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
      },
      travelMode: mode === 'WALK' ? 'WALK' : 'DRIVE',
      routingPreference: mode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'en-US',
      units: 'IMPERIAL',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Routes API ${res.status}: ${text.slice(0, 180)}`)
  }
  const json = (await res.json()) as {
    routes?: {
      polyline?: { encodedPolyline?: string }
      distanceMeters?: number
      duration?: string
      legs?: {
        steps?: Array<{
          navigationInstruction?: { maneuver?: string; instructions?: string }
          distanceMeters?: number
          staticDuration?: string
          startLocation?: { latLng?: { latitude?: number; longitude?: number } }
          polyline?: { encodedPolyline?: string }
        }>
      }[]
    }[]
  }
  const route = json.routes?.[0]
  const encoded = route?.polyline?.encodedPolyline
  if (!encoded) throw new Error('Routes API returned no polyline')
  const path = pinPathToEndpoints(decodePolyline(encoded), origin, destination, 8, 5)
  const distanceM = Math.round(route?.distanceMeters ?? 0)
  const durationSec = parseDurationSec(route?.duration)
  const rawSteps = route?.legs?.[0]?.steps ?? []
  const steps = rawSteps.length
    ? stepsFromGoogleRest(rawSteps, mode, mode === 'WALK' ? 'wlk' : 'drv')
    : fallbackSteps(path, mode, distanceM, durationSec, mode === 'WALK' ? 'wlk' : 'drv')
  return {
    path,
    distanceM: distanceM || Math.round(
      path.reduce((sum, p, i) => (i === 0 ? 0 : sum + metersBetween(path[i - 1], p)), 0),
    ),
    durationSec: durationSec || Math.round(distanceM / (mode === 'WALK' ? 1.35 : 11)),
    mode,
    steps,
  }
}

function decodePolyline(encoded: string): google.maps.LatLngLiteral[] {
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0
  const path: google.maps.LatLngLiteral[] = []
  while (index < len) {
    let b: number
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat
    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng
    path.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return path
}

export async function fetchRoadPath(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<google.maps.LatLngLiteral[]> {
  const route = await fetchRoadRoute(origin, destination, mode)
  return route.path
}

/** Full Google road/sidewalk route (path + distance + turn steps). */
export async function fetchRoadRoute(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<RoadRoute> {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    throw new Error('Start coordinates are missing')
  }
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new Error('Destination coordinates are missing')
  }
  // Prefer REST first — richer turn-by-turn for navigation guidance.
  try {
    return await computeRoadRouteRest(origin, destination, mode)
  } catch (first) {
    try {
      return await computeRoadRouteJs(origin, destination, mode)
    } catch (second) {
      const a = first instanceof Error ? first.message : String(first)
      const b = second instanceof Error ? second.message : String(second)
      throw new Error(`${a} | ${b}`)
    }
  }
}

/**
 * Live nav recalculate — race REST + JS Routes and take the first success.
 * Walking/driving both need sub-second response; waiting on one slow channel feels broken.
 */
export async function fetchRoadRouteLive(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<RoadRoute> {
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    throw new Error('Start coordinates are missing')
  }
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new Error('Destination coordinates are missing')
  }
  const rest = computeRoadRouteRest(origin, destination, mode)
  const js = computeRoadRouteJs(origin, destination, mode)
  try {
    return await Promise.any([rest, js])
  } catch {
    // Promise.any aggregates — surface something useful.
    try {
      return await rest
    } catch (a) {
      try {
        return await js
      } catch (b) {
        const am = a instanceof Error ? a.message : String(a)
        const bm = b instanceof Error ? b.message : String(b)
        throw new Error(`${am} | ${bm}`)
      }
    }
  }
}
