/// <reference types="vite/client" />
/// <reference types="google.maps" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  /** Google Maps JavaScript API key (Maps JS + Routes API) */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Cloud Map ID for vector map + Advanced Markers (defaults to DEMO_MAP_ID) */
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  google: typeof google
}
