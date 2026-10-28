import { googleMapsApiKey, latLngLiteral } from './googleMaps'

export type RouteTravelMode = 'DRIVE' | 'WALK'

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

/** Ensure polyline starts at origin and ends at destination (exact unit / start pins). */
export function pinPathToEndpoints(
  path: google.maps.LatLngLiteral[],
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  snapMeters = 8,
): google.maps.LatLngLiteral[] {
  if (!path.length) return [origin, destination]
  const out = path.map((p) => ({ ...p }))
  if (metersBetween(out[0], origin) > snapMeters) out.unshift(origin)
  else out[0] = origin
  if (metersBetween(out[out.length - 1], destination) > snapMeters) out.push(destination)
  else out[out.length - 1] = destination
  return out
}

/**
 * Road-snapped path via the new Routes library (replaces legacy DirectionsService).
 * Requires Routes API enabled on the Google Cloud key.
 */
export async function computeRoadPath(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<google.maps.LatLngLiteral[]> {
  const maps = await google.maps.importLibrary('routes')
  const RouteCtor = (maps as google.maps.RoutesLibrary).Route
  if (!RouteCtor?.computeRoutes) {
    throw new Error('Routes library unavailable — enable Routes API on your Google Cloud key')
  }

  const request: google.maps.routes.ComputeRoutesRequest = {
    // Explicit lat/lng literals — exact coordinates from navigate result
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
  const raw = routes?.[0]?.path
  if (!raw?.length) throw new Error('No route path returned')

  const path = raw.map((p) => asLiteral(p))
  return pinPathToEndpoints(path, origin, destination)
}

/** REST fallback if JS Routes library is blocked. */
export async function computeRoadPathRest(
  origin: google.maps.LatLngLiteral,
  destination: google.maps.LatLngLiteral,
  mode: RouteTravelMode,
): Promise<google.maps.LatLngLiteral[]> {
  const key = googleMapsApiKey()
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: {
        location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
      },
      travelMode: mode === 'WALK' ? 'WALK' : 'DRIVE',
      routingPreference: mode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
      polylineQuality: 'HIGH_QUALITY',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Routes API ${res.status}: ${text.slice(0, 180)}`)
  }
  const json = (await res.json()) as {
    routes?: { polyline?: { encodedPolyline?: string } }[]
  }
  const encoded = json.routes?.[0]?.polyline?.encodedPolyline
  if (!encoded) throw new Error('Routes API returned no polyline')
  return pinPathToEndpoints(decodePolyline(encoded), origin, destination)
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
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    throw new Error('Start coordinates are missing')
  }
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new Error('Destination coordinates are missing')
  }
  try {
    return await computeRoadPath(origin, destination, mode)
  } catch (first) {
    try {
      return await computeRoadPathRest(origin, destination, mode)
    } catch (second) {
      const a = first instanceof Error ? first.message : String(first)
      const b = second instanceof Error ? second.message : String(second)
      throw new Error(`${a} | ${b}`)
    }
  }
}
