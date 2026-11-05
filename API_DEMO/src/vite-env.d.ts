/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  /** Google Maps JavaScript API key (Maps JS + Routes API) */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Optional Cloud Map ID. Leave unset for rich Google roadmap (DEMO_MAP_ID looks like sparse OSM). */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string
  /** Set to "1" to enable OSM Overpass extract (requires working /api/overpass proxy). */
  readonly VITE_OSM_EXTRACT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  google: typeof google
}
