import type { SiteWaysExtract } from './extractSiteWays'

export type LatLng = { lat: number; lng: number }

function meters(a: LatLng, b: LatLng) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Prefer the site driveway you see on satellite over the main road out front. */
function wayRank(highway?: string): number {
  const h = (highway || '').toLowerCase()
  if (h === 'driveway') return 0
  if (h === 'parking_aisle') return 1
  if (h === 'service') return 2
  if (h === 'living_street') return 3
  return 6
}

/**
 * Closest useful point on extracted driveway / service ways to the actual destination.
 * Prefers tagged driveways over residential frontage roads.
 */
export function nearestDrivewayPointTo(
  extract: SiteWaysExtract | null | undefined,
  target: LatLng,
  maxMeters = 160,
): LatLng | null {
  if (!extract?.driveways.length) return null

  let best: LatLng | null = null
  let bestScore = Infinity

  for (const way of extract.driveways) {
    const rank = wayRank(way.highway)
    for (const [lng, lat] of way.coordinates) {
      const p = { lat, lng }
      const d = meters(p, target)
      if (d > maxMeters) continue
      // Rank dominates within ~40m so a true driveway beats a closer main road.
      const score = rank * 40 + d
      if (score < bestScore) {
        bestScore = score
        best = p
      }
    }
  }
  return best
}
