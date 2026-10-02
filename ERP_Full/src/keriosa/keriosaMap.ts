import type {
  Building,
  Complex,
  Floor,
  KeriosaImport,
  LocationType,
  MapLocation,
  Organization,
} from '../data/schema'

export type KeriosaLockRaw = Record<string, string | undefined>

const LOCATION_TYPES: LocationType[] = [
  'Room',
  'Unit',
  'Door',
  'Amenity',
  'Entry',
  'Exit',
  'Stairs',
  'Elevator',
  'Corridor',
  'Pool',
  'Gym',
  'Lobby',
  'Parking',
]

export function normLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/@/g, '').replace(/\s+$/, '')
}

export function cleanField(value: string | undefined, fallback = ''): string {
  const v = (value ?? '').trim()
  if (!v || /^n\/?a$/i.test(v)) return fallback
  return v
}

export function formatFloorLabel(floorRaw: string): string {
  const n = Number.parseInt(floorRaw.replace(/\D/g, ''), 10)
  if (Number.isFinite(n) && n >= 0) {
    return n === 0 ? 'L00' : `L${String(n).padStart(2, '0')}`
  }
  const t = floorRaw.trim()
  return t ? (t.toUpperCase().startsWith('L') ? t.toUpperCase() : `L${t}`) : 'L01'
}

export function floorLevel(floorRaw: string): number {
  const n = Number.parseInt(floorRaw.replace(/\D/g, ''), 10)
  return Number.isFinite(n) ? n : 1
}

/** Map keriosa point_type + house hint → ERP location type. */
export function inferLocationType(pointType: string, house: string): LocationType {
  const pt = normLabel(pointType)
  const map: Record<string, LocationType> = {
    room: 'Room',
    unit: 'Unit',
    suite: 'Unit',
    apartment: 'Unit',
    door: 'Door',
    entry: 'Entry',
    exit: 'Exit',
    amenity: 'Amenity',
    corridor: 'Corridor',
    hallway: 'Corridor',
    stairs: 'Stairs',
    stair: 'Stairs',
    elevator: 'Elevator',
    lift: 'Elevator',
    lobby: 'Lobby',
    parking: 'Parking',
    pool: 'Pool',
    gym: 'Gym',
  }
  if (map[pt]) return map[pt]
  const houseNorm = normLabel(house)
  if (/^suite|^apt|^unit|^\d{2,4}$/.test(houseNorm)) return 'Unit'
  if (pt.includes('room')) return 'Room'
  return 'Unit'
}

export function inferUnitName(house: string, building: string, pointType: string): string {
  const h = cleanField(house)
  if (h) return h
  const b = cleanField(building)
  if (b) return b
  const pt = cleanField(pointType, 'Field point')
  return pt.charAt(0).toUpperCase() + pt.slice(1)
}

export function inferComplexName(propertyRaw: string): string {
  const p = propertyRaw.trim().replace(/\s+@\s*$/, '').trim()
  if (p) return p
  return 'Unnamed property'
}

export function importIdFromLockKey(lockKey: string): string {
  return `kimp-${lockKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function fuzzyNameMatch(a: string, b: string): boolean {
  const x = normLabel(a)
  const y = normLabel(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

export function matchHierarchy(
  complexes: Complex[],
  buildings: Building[],
  floors: Floor[],
  proposed: KeriosaImport['proposed'],
): Pick<KeriosaImport, 'matchComplexId' | 'matchBuildingId' | 'matchFloorId'> {
  const complex =
    complexes.find((c) => fuzzyNameMatch(c.name, proposed.complexName)) ??
    complexes.find((c) => normLabel(c.name) === normLabel(proposed.complexName)) ??
    null

  const scopedBuildings = complex
    ? buildings.filter((b) => b.complexId === complex.id)
    : buildings.filter((b) => fuzzyNameMatch(b.name, proposed.buildingName))

  const building =
    scopedBuildings.find((b) => fuzzyNameMatch(b.name, proposed.buildingName)) ?? null

  const scopedFloors = building ? floors.filter((f) => f.buildingId === building.id) : []
  const targetLevel = Number.parseInt(proposed.floorLabel.replace(/\D/g, ''), 10)
  const floor =
    scopedFloors.find(
      (f) =>
        f.label.toUpperCase() === proposed.floorLabel.toUpperCase() ||
        (Number.isFinite(targetLevel) && f.level === targetLevel),
    ) ?? null

  return {
    matchComplexId: complex?.id ?? null,
    matchBuildingId: building?.id ?? null,
    matchFloorId: floor?.id ?? null,
  }
}

export function buildKeriosaImport(
  lockKey: string,
  raw: KeriosaLockRaw,
  complexes: Complex[],
  buildings: Building[],
  floors: Floor[],
): KeriosaImport {
  const property = raw.property ?? ''
  const building = raw.building ?? ''
  const floor = raw.floor ?? ''
  const house = raw.house ?? ''
  const pointType = raw.point_type ?? raw.pointType ?? ''

  const complexName = inferComplexName(property)
  const buildingName = cleanField(building, 'Main building')
  const floorLabel = formatFloorLabel(floor || '1')
  const unitName = inferUnitName(house, building, pointType)
  const locationType = inferLocationType(pointType, house)

  const lat = Number.parseFloat(String(raw.latitude ?? ''))
  const lng = Number.parseFloat(String(raw.longitude ?? ''))
  const elev = Number.parseFloat(String(raw.altitude ?? ''))

  const proposed = {
    complexName,
    buildingName,
    floorLabel,
    unitName,
    locationType,
    latitude: Number.isFinite(lat) ? lat : 0,
    longitude: Number.isFinite(lng) ? lng : 0,
    elevation: Number.isFinite(elev) ? elev : 0,
    physicalAddress: [complexName, buildingName, `Floor ${floor || floorLabel}`, unitName]
      .filter(Boolean)
      .join(' · '),
  }

  const matches = matchHierarchy(complexes, buildings, floors, proposed)
  const now = new Date().toISOString()

  return {
    id: importIdFromLockKey(lockKey),
    lockKey,
    status: 'Pending',
    lockedAt: raw.locked_at ?? lockKey.replace(/_/g, ' ').replace(/-/g, ':'),
    deviceId: raw.device_id ?? '',
    source: {
      property,
      building,
      floor,
      house,
      pointType,
      latitude: String(raw.latitude ?? ''),
      longitude: String(raw.longitude ?? ''),
      altitude: String(raw.altitude ?? ''),
      confidence: String(raw.confidence ?? ''),
    },
    proposed,
    ...matches,
    resolvedLocationId: null,
    syncedAt: now,
    reviewedAt: null,
  }
}

export type ConfirmKeriosaContext = {
  organizations: Organization[]
  complexes: Complex[]
  buildings: Building[]
  floors: Floor[]
  siteProperties: { id: string; kind: string }[]
}

export type ConfirmKeriosaChoices = {
  complexId: string | 'new'
  buildingId: string | 'new'
  floorId: string | 'new'
  organizationId: string
  locationType: LocationType
  unitName: string
  mapped: boolean
  importRow: KeriosaImport
}

export type ConfirmKeriosaResult = {
  complex: Complex
  building: Building
  floor: Floor
  location: MapLocation
  siteProperty?: import('../data/schema').SiteProperty
  updatedImport: KeriosaImport
}

export function applyKeriosaImport(ctx: ConfirmKeriosaContext, choices: ConfirmKeriosaChoices): ConfirmKeriosaResult {
  const imp = choices.importRow
  const org =
    ctx.organizations.find((o) => o.id === choices.organizationId) ??
    ctx.organizations.find((o) => o.status === 'Active') ??
    ctx.organizations[0]
  if (!org) throw new Error('No organization available for new property records.')

  let complex: Complex
  if (choices.complexId === 'new') {
    complex = {
      id: `cpx-${Date.now()}`,
      name: imp.proposed.complexName,
      city: 'Field site',
      status: 'Draft',
      organizationId: org.id,
      organizationName: org.name,
      buildings: 1,
      floors: 1,
      readiness: 0,
      address: imp.proposed.physicalAddress,
    }
  } else {
    const found = ctx.complexes.find((c) => c.id === choices.complexId)
    if (!found) throw new Error('Selected complex not found.')
    complex = found
  }

  let building: Building
  if (choices.buildingId === 'new') {
    building = {
      id: `bld-${Date.now()}`,
      complexId: complex.id,
      complexName: complex.name,
      name: imp.proposed.buildingName,
      floors: 1,
      mappedFloors: 0,
      status: 'Active',
      city: complex.city,
      organizationId: org.id,
    }
  } else {
    const found = ctx.buildings.find((b) => b.id === choices.buildingId)
    if (!found) throw new Error('Selected building not found.')
    building = found
  }

  let floor: Floor
  if (choices.floorId === 'new') {
    const level = floorLevel(imp.source.floor || imp.proposed.floorLabel)
    floor = {
      id: `flr-${Date.now()}`,
      buildingId: building.id,
      buildingName: building.name,
      complexId: building.complexId,
      complexName: building.complexName,
      propertyId: building.complexId ?? building.id,
      label: imp.proposed.floorLabel,
      level,
      locations: 0,
      mappedPct: 0,
    }
  } else {
    const found = ctx.floors.find((f) => f.id === choices.floorId)
    if (!found) throw new Error('Selected floor not found.')
    floor = found
  }

  const location: MapLocation = {
    id: `loc-${Date.now()}`,
    floorId: floor.id,
    floorLabel: floor.label,
    buildingId: building.id,
    buildingName: building.name,
    complexId: floor.complexId,
    complexName: floor.complexName,
    propertyId: floor.propertyId,
    name: choices.unitName.trim() || imp.proposed.unitName,
    type: choices.locationType,
    code: '',
    mapped: choices.mapped,
    physicalAddress: imp.proposed.physicalAddress,
    latitude: imp.proposed.latitude,
    longitude: imp.proposed.longitude,
    elevation: imp.proposed.elevation,
  }

  const siteProperty =
    choices.complexId === 'new'
      ? {
          id: complex.id,
          kind: 'complex' as const,
          name: complex.name,
          city: complex.city,
          organizationId: complex.organizationId,
          organizationName: complex.organizationName,
          status: complex.status,
          complexId: complex.id,
          buildingId: null,
          readiness: complex.readiness,
          address: complex.address,
        }
      : undefined

  const updatedImport: KeriosaImport = {
    ...imp,
    status: 'Confirmed',
    matchComplexId: complex.id,
    matchBuildingId: building.id,
    matchFloorId: floor.id,
    resolvedLocationId: location.id,
    reviewedAt: new Date().toISOString(),
  }

  return { complex, building, floor, location, siteProperty, updatedImport }
}

export { LOCATION_TYPES as KERIOSA_LOCATION_TYPES }
