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

/**
 * Map ID is required for AdvancedMarkerElement (no deprecated google.maps.Marker).
 * Prefer your Cloud Map ID (JavaScript / Roadmap, no custom style) for the full Google look.
 * DEMO_MAP_ID is only the Google-supported fallback when unset.
 */
export function googleMapsMapId(): string {
  return String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID').trim() || 'DEMO_MAP_ID'
}

/** Load Maps JS API once (Map, Advanced Markers, Geometry, Routes). */
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
        'Missing VITE_GOOGLE_MAPS_API_KEY. Add a Google Maps JavaScript API key (Maps JS + Routes API) in Netlify / local .env.',
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

/** Vector Google map + Advanced Markers (mapId required). */
export function mapOptions(
  center: google.maps.LatLngLiteral,
  zoom: number,
  extra: google.maps.MapOptions = {},
): google.maps.MapOptions {
  return {
    center,
    zoom,
    mapId: googleMapsMapId(),
    mapTypeId: 'roadmap',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    ...extra,
  }
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

function htmlFromSvg(svg: string, anchor: 'bottom' | 'center' = 'bottom') {
  const wrap = document.createElement('div')
  wrap.innerHTML = svg
  wrap.style.display = 'flex'
  wrap.style.alignItems = 'center'
  wrap.style.justifyContent = 'center'
  wrap.style.pointerEvents = 'none'
  // Default Advanced Marker anchor is bottom-center (correct for teardrop pins).
  // Live puck must sit on the accuracy-circle center → shift content up by 50%.
  if (anchor === 'center') {
    wrap.style.transform = 'translateY(50%)'
    wrap.style.transformOrigin = 'center center'
  }
  return wrap
}

export type AdvMarker = google.maps.marker.AdvancedMarkerElement

/** Always AdvancedMarkerElement — never deprecated google.maps.Marker. */
export function createAdvancedMarker(opts: {
  map: google.maps.Map
  position: google.maps.LatLngLiteral
  title?: string
  zIndex?: number
  svg?: string
  content?: HTMLElement
  gmpDraggable?: boolean
  /** Required for gmp-click / InfoWindow on Advanced Markers (default true). */
  gmpClickable?: boolean
  /** `center` for the live GPS puck; `bottom` (default) for pin markers. */
  anchor?: 'bottom' | 'center'
}): AdvMarker {
  const AdvancedMarkerElement = google.maps.marker.AdvancedMarkerElement
  const content =
    opts.content ?? (opts.svg ? htmlFromSvg(opts.svg, opts.anchor ?? 'bottom') : undefined)
  return new AdvancedMarkerElement({
    map: opts.map,
    position: opts.position,
    title: opts.title,
    zIndex: opts.zIndex,
    content,
    gmpDraggable: opts.gmpDraggable,
    gmpClickable: opts.gmpClickable !== false,
  })
}

export function setAdvancedMarkerSvg(
  marker: AdvMarker,
  svg: string,
  anchor: 'bottom' | 'center' = 'bottom',
) {
  marker.content = htmlFromSvg(svg, anchor)
}

export function markerLatLng(marker: AdvMarker): google.maps.LatLngLiteral | null {
  const pos = marker.position
  if (!pos) return null
  if (typeof (pos as google.maps.LatLng).lat === 'function') {
    const ll = pos as google.maps.LatLng
    return { lat: ll.lat(), lng: ll.lng() }
  }
  const lit = pos as google.maps.LatLngLiteral
  if (Number.isFinite(lit.lat) && Number.isFinite(lit.lng)) return { lat: lit.lat, lng: lit.lng }
  return null
}
