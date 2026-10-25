export type StartPoint = {
  latitude: number
  longitude: number
  label: string
}

export type PlaceHit = StartPoint & {
  id: string
  detail?: string
}

type NominatimAddress = {
  display_name?: string
  name?: string
  address?: Record<string, string>
}

function validCoord(latitude: number, longitude: number): { latitude: number; longitude: number } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

/** Decimal degrees, `lat, lng`, or a maps URL that contains `@lat,lng` / `q=lat,lng`. */
export function parseLatLng(raw: string): { latitude: number; longitude: number } | null {
  const text = raw.trim()
  if (!text) return null
  const at = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  if (at) return validCoord(Number(at[1]), Number(at[2]))
  const query = text.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)(?:%2C|,|\s)+(-?\d+(?:\.\d+)?)/i)
  if (query) return validCoord(Number(query[1]), Number(query[2]))
  const labeled = text.match(
    /lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)[^\d.+-]+(?:lon|lng|long(?:itude)?)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i,
  )
  if (labeled) return validCoord(Number(labeled[1]), Number(labeled[2]))
  const pair = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (pair) return validCoord(Number(pair[1]), Number(pair[2]))
  return null
}

export function parseDecimalPair(
  latRaw: string,
  lngRaw: string,
): { latitude: number; longitude: number } | null {
  return validCoord(Number(latRaw.trim()), Number(lngRaw.trim()))
}

export function formatCoords(latitude: number, longitude: number) {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}

export function milesBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const R = 3958.7613
  const lat1 = (a.latitude * Math.PI) / 180
  const lat2 = (b.latitude * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function formatDistance(miles: number) {
  if (!Number.isFinite(miles)) return '—'
  if (miles < 0.1) return `${Math.max(1, Math.round(miles * 5280))} ft`
  if (miles < 10) return `${miles.toFixed(1)} mi`
  return `${Math.round(miles)} mi`
}

function shortPlace(json: NominatimAddress) {
  const address = json.address ?? {}
  const locality =
    address.city || address.town || address.village || address.hamlet || address.suburb || address.county
  const parts = [json.name || address.road || address.neighbourhood, locality, address.state || address.country]
  const unique: string[] = []
  for (const part of parts) {
    const trimmed = part?.trim()
    if (!trimmed) continue
    if (unique.some((item) => item.toLowerCase() === trimmed.toLowerCase())) continue
    unique.push(trimmed)
  }
  return unique.slice(0, 3).join(', ')
}

export async function reversePlace(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('lat', String(latitude))
  url.searchParams.set('lon', String(longitude))
  url.searchParams.set('zoom', '16')
  url.searchParams.set('addressdetails', '1')
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) return formatCoords(latitude, longitude)
  const json = (await res.json()) as NominatimAddress
  return shortPlace(json) || json.display_name || formatCoords(latitude, longitude)
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const q = query.trim().slice(0, 200)
  if (q.length < 3) return []
  const direct = parseLatLng(q)
  if (direct) {
    let label = formatCoords(direct.latitude, direct.longitude)
    try {
      label = await reversePlace(direct.latitude, direct.longitude, signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
    }
    return [{ id: 'coords', label, detail: formatCoords(direct.latitude, direct.longitude), ...direct }]
  }
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '6')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('q', q)
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('Place search is unavailable right now.')
  const json = (await res.json()) as Array<
    NominatimAddress & { place_id: number; lat: string; lon: string }
  >
  return json.flatMap((row) => {
    const latitude = Number(row.lat)
    const longitude = Number(row.lon)
    const coords = validCoord(latitude, longitude)
    if (!coords) return []
    const label = shortPlace(row) || row.display_name || formatCoords(coords.latitude, coords.longitude)
    return [
      {
        id: String(row.place_id),
        label,
        detail: row.display_name,
        latitude: coords.latitude,
        longitude: coords.longitude,
      },
    ]
  })
}
