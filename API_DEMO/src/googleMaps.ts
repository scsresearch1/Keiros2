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
 * Optional Cloud Map ID for Advanced Markers.
 * Do NOT default to DEMO_MAP_ID — that ID uses a sparse gray basemap that looks like OSM.
 * Leave unset → classic rich Google roadmap + Marker pins.
 */
export function googleMapsMapId(): string {
  return String(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '').trim()
}

export function useAdvancedMarkers(): boolean {
  return Boolean(googleMapsMapId())
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

/** Rich Google roadmap by default; mapId only when you set a real Cloud Map ID. */
export function mapOptions(
  center: google.maps.LatLngLiteral,
  zoom: number,
  extra: google.maps.MapOptions = {},
): google.maps.MapOptions {
  const mapId = googleMapsMapId()
  return {
    center,
    zoom,
    mapTypeId: 'roadmap',
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
    ...(mapId ? { mapId } : {}),
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

function htmlFromSvg(svg: string) {
  const wrap = document.createElement('div')
  wrap.innerHTML = svg
  wrap.style.display = 'flex'
  wrap.style.alignItems = 'center'
  wrap.style.justifyContent = 'center'
  return wrap
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

/** Pin handle used by OutdoorMap / StartPicker (Advanced or classic Marker). */
export type AdvMarker = {
  map: google.maps.Map | null
  position: google.maps.LatLng | google.maps.LatLngLiteral | null | google.maps.LatLngAltitude
  title?: string
  zIndex?: number
  content?: HTMLElement | null
  anchorTop?: string
  anchorLeft?: string
  gmpDraggable?: boolean
  addEventListener: (type: string, fn: () => void) => void
  addListener?: (type: string, fn: () => void) => google.maps.MapsEventListener
  /** Internal classic marker when not using Advanced Markers */
  __classic?: google.maps.Marker
}

function wrapClassicMarker(marker: google.maps.Marker): AdvMarker {
  const handle: AdvMarker = {
    __classic: marker,
    get map() {
      return (marker.getMap() as google.maps.Map | null) ?? null
    },
    set map(m: google.maps.Map | null) {
      marker.setMap(m)
    },
    get position() {
      return marker.getPosition() ?? null
    },
    set position(p) {
      if (!p) return
      marker.setPosition(p as google.maps.LatLng | google.maps.LatLngLiteral)
    },
    addEventListener(type: string, fn: () => void) {
      if (type === 'gmp-click' || type === 'click') marker.addListener('click', fn)
      if (type === 'dragend') marker.addListener('dragend', fn)
    },
  }
  return handle
}

/** Create a map pin (Advanced Marker if Map ID set; else classic Marker on rich roadmap). */
export function createAdvancedMarker(opts: {
  map: google.maps.Map
  position: google.maps.LatLngLiteral
  title?: string
  zIndex?: number
  svg?: string
  content?: HTMLElement
  gmpDraggable?: boolean
}): AdvMarker {
  if (useAdvancedMarkers()) {
    const AdvancedMarkerElement = google.maps.marker.AdvancedMarkerElement
    const content = opts.content ?? (opts.svg ? htmlFromSvg(opts.svg) : undefined)
    return new AdvancedMarkerElement({
      map: opts.map,
      position: opts.position,
      title: opts.title,
      zIndex: opts.zIndex,
      content,
      gmpDraggable: opts.gmpDraggable,
    }) as unknown as AdvMarker
  }

  const marker = new google.maps.Marker({
    map: opts.map,
    position: opts.position,
    title: opts.title,
    zIndex: opts.zIndex,
    draggable: opts.gmpDraggable,
    icon: opts.svg
      ? {
          url: svgDataUrl(opts.svg),
          scaledSize: new google.maps.Size(36, 44),
          anchor: new google.maps.Point(18, 44),
        }
      : undefined,
  })
  return wrapClassicMarker(marker)
}

export function setAdvancedMarkerSvg(marker: AdvMarker, svg: string) {
  if (marker.__classic) {
    marker.__classic.setIcon({
      url: svgDataUrl(svg),
      scaledSize: new google.maps.Size(48, 48),
      anchor: new google.maps.Point(24, 24),
    })
    return
  }
  marker.content = htmlFromSvg(svg)
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
