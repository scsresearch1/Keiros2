/** Free basemap tiles — no API key, no payment. */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'

/** Standard OSM raster (no key). */
export const OSM_LIGHT_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/**
 * Dark look without a paid basemap vendor: same OSM tiles,
 * inverted via CSS on the tile pane (see WayfindingPage.css).
 */
export const OSM_DARK_URL = OSM_LIGHT_URL
