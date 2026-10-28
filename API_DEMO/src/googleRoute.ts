import { googleMapsApiKey, latLngLiteral } from './googleMaps'

export type RouteTravelMode = 'DRIVE' | 'WALK'

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
    origin,
    destination,
    travelMode: mode === 'WALK' ? 'WALKING' : 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  }
  if (mode === 'DRIVE') {
    request.routingPreference = 'TRAFFIC_AWARE'
  }

  const { routes } = await RouteCtor.computeRoutes(request)
  const path = routes?.[0]?.path
  if (!path?.length) throw new Error('No route path returned')

  return path.map((p) => latLngLiteral(p.lat, p.lng))
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
  return decodePolyline(encoded)
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
  try {
    return await computeRoadPath(origin, destination, mode)
  } catch {
    return computeRoadPathRest(origin, destination, mode)
  }
}
