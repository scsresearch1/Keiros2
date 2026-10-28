import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

declare global {
  interface Window {
    __keirosGoogleMapsReady?: Promise<typeof google>
    google: typeof google
  }
}

export function googleMapsApiKey(): string {
  return String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
}

/** Load Maps JS API once (Map, Marker, Directions, Geometry). */
export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps requires a browser'))
  }
  if (window.google?.maps?.Map) return Promise.resolve(window.google)
  if (window.__keirosGoogleMapsReady) return window.__keirosGoogleMapsReady

  const apiKey = googleMapsApiKey()
  if (!apiKey) {
    return Promise.reject(
      new Error(
        'Missing VITE_GOOGLE_MAPS_API_KEY. Add a Google Maps JavaScript API key (with Directions API enabled) in Netlify / local .env.',
      ),
    )
  }

  setOptions({
    key: apiKey,
    v: 'weekly',
  })

  window.__keirosGoogleMapsReady = (async () => {
    await importLibrary('maps')
    await importLibrary('marker')
    await importLibrary('geometry')
    try {
      // New Routes library (legacy DirectionsService is blocked on many keys)
      await importLibrary('routes')
    } catch {
      /* REST Routes API fallback in googleRoute.ts */
    }
    return window.google
  })()

  return window.__keirosGoogleMapsReady
}

export function latLngLiteral(lat: number, lng: number): google.maps.LatLngLiteral {
  return { lat, lng }
}

/** GeoJSON [lng, lat][] → Google LatLngLiteral[] */
export function geoJsonToLatLngs(
  coordinates: [number, number][] | undefined | null,
): google.maps.LatLngLiteral[] {
  if (!coordinates?.length) return []
  return coordinates
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => ({ lat, lng }))
}
