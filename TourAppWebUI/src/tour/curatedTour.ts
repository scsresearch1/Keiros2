import type { Hierarchy } from '../api/client'

export type TourUnit = Hierarchy['units'][number]

export type TourStop = {
  id: string
  unit: TourUnit
  title: string
  blurb: string
  category: string
  order: number
  floorId: string
  floorLabel: string
  floorLevel: number
  /** First stop gets you into the building; later stops are floor walk-through. */
  role: 'entry' | 'inside'
}

function isInfrastructure(unit: TourUnit) {
  const hay = `${unit.type} ${unit.name}`.toLowerCase()
  return (
    hay.includes('stair') ||
    hay.includes('elevator') ||
    hay.includes('corridor') ||
    hay.includes('hall') ||
    hay.includes('park') ||
    hay.includes('shaft')
  )
}

function categorize(unit: TourUnit): string {
  const hay = `${unit.type} ${unit.name}`.toLowerCase()
  if (hay.includes('lobby') || hay.includes('entry') || hay.includes('reception')) return 'lobby'
  if (hay.includes('leas') || hay.includes('office')) return 'leasing'
  if (hay.includes('club')) return 'clubhouse'
  if (hay.includes('pool')) return 'pool'
  if (hay.includes('gym') || hay.includes('fitness')) return 'gym'
  if (hay.includes('unit') || hay.includes('apt') || hay.includes('suite') || hay.includes('room')) return 'unit'
  return 'place'
}

function blurbFor(unit: TourUnit, floorLabel: string, index: number, totalOnFloor: number): string {
  const cat = categorize(unit)
  if (index === 0) return `Enter on ${floorLabel}, then we’ll visit every space floor by floor.`
  if (cat === 'unit') return `${floorLabel} · home ${index + 1} of ${totalOnFloor} on this floor.`
  return `${floorLabel} · stop ${index + 1} of ${totalOnFloor} on this level.`
}

function pickPrimaryBuilding(units: TourUnit[]): string | null {
  const scores = new Map<string, number>()
  for (const u of units) {
    if (isInfrastructure(u)) continue
    let score = 1
    const hay = `${u.type} ${u.name}`.toLowerCase()
    if (hay.includes('lobby') || hay.includes('entry')) score += 6
    if (hay.includes('unit') || hay.includes('apt')) score += 3
    scores.set(u.buildingId, (scores.get(u.buildingId) ?? 0) + score)
  }
  let best: string | null = null
  let bestScore = -1
  for (const [id, score] of scores) {
    if (score > bestScore) {
      best = id
      bestScore = score
    }
  }
  return best
}

/**
 * Lowest floor first → every unit on that floor → next floor up → …
 * All visitable units in the primary building are included.
 */
export function buildGuidedTour(
  hierarchy: Hierarchy,
  complexId: string | null,
  maxStops = 48,
): TourStop[] {
  const complexUnits = hierarchy.units.filter((u) => !complexId || u.complexId === complexId)
  const buildingId = pickPrimaryBuilding(complexUnits)
  const buildingUnits = (buildingId
    ? complexUnits.filter((u) => u.buildingId === buildingId)
    : complexUnits
  ).filter((u) => !isInfrastructure(u))

  const floors = hierarchy.floors
    .filter((f) => !buildingId || f.buildingId === buildingId)
    .slice()
    .sort((a, b) => a.level - b.level)

  const floorMeta = new Map(floors.map((f) => [f.id, f]))

  // Group units by floor, ordered by floor level ascending
  const byFloor = new Map<string, TourUnit[]>()
  for (const unit of buildingUnits) {
    const list = byFloor.get(unit.floorId) ?? []
    list.push(unit)
    byFloor.set(unit.floorId, list)
  }

  const orderedFloorIds = [
    ...floors.map((f) => f.id).filter((id) => byFloor.has(id)),
    ...[...byFloor.keys()].filter((id) => !floorMeta.has(id)),
  ]

  const stops: TourStop[] = []
  for (const floorId of orderedFloorIds) {
    const floor = floorMeta.get(floorId)
    const floorLabel = floor?.label || 'Floor'
    const floorLevel = floor?.level ?? 0
    const units = (byFloor.get(floorId) ?? []).slice().sort((a, b) => {
      // Lobby/entry first on a floor, then amenities, then unit names
      const rank = (u: TourUnit) => {
        const c = categorize(u)
        if (c === 'lobby') return 0
        if (c === 'leasing') return 1
        if (c === 'clubhouse' || c === 'gym' || c === 'pool') return 2
        return 3
      }
      const d = rank(a) - rank(b)
      return d !== 0 ? d : a.name.localeCompare(b.name)
    })

    units.forEach((unit, index) => {
      if (stops.length >= maxStops) return
      const cat = categorize(unit)
      stops.push({
        id: unit.id,
        unit,
        title: unit.name,
        blurb: blurbFor(unit, floorLabel, stops.length, units.length),
        category: cat,
        order: stops.length + 1,
        floorId,
        floorLabel,
        floorLevel,
        role: stops.length === 0 ? 'entry' : 'inside',
      })
    })
  }

  // Fallback: if somehow empty, use any non-infra units
  if (!stops.length) {
    return complexUnits
      .filter((u) => !isInfrastructure(u))
      .slice(0, maxStops)
      .map((unit, index) => ({
        id: unit.id,
        unit,
        title: unit.name,
        blurb: index === 0 ? 'Enter the building, then visit each space.' : `Next: ${unit.name}`,
        category: categorize(unit),
        order: index + 1,
        floorId: unit.floorId,
        floorLabel: unit.floorLabel,
        floorLevel: 0,
        role: index === 0 ? ('entry' as const) : ('inside' as const),
      }))
  }

  return stops
}

export function estimateTourMinutes(stopCount: number) {
  return Math.max(20, Math.round(stopCount * 2.5) + 8)
}

export function groupStopsByFloor(stops: TourStop[]) {
  const groups: { floorId: string; floorLabel: string; floorLevel: number; stops: TourStop[] }[] = []
  for (const stop of stops) {
    const last = groups[groups.length - 1]
    if (last && last.floorId === stop.floorId) last.stops.push(stop)
    else {
      groups.push({
        floorId: stop.floorId,
        floorLabel: stop.floorLabel,
        floorLevel: stop.floorLevel,
        stops: [stop],
      })
    }
  }
  return groups
}
