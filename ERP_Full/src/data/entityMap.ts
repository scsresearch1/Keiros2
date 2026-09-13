/**
 * Runtime entity indexes & joins. Prefer IDs; *Name fields are display cache only.
 */
import {
  apiClients,
  apiKeys,
  codeUsage,
  floors,
  locations,
  mapVersions,
  organizations,
  propertyCodes,
  roles,
  routes,
  siteProperties,
  users,
  type Floor,
  type MapLocation,
  type MapVersion,
  type PropertyCode,
  type Route,
  type SiteProperty,
  type User,
} from './erpData'

export const sitePropertyById = Object.fromEntries(siteProperties.map((p) => [p.id, p])) as Record<
  string,
  SiteProperty
>
export const sitePropertyByName = Object.fromEntries(siteProperties.map((p) => [p.name, p])) as Record<
  string,
  SiteProperty
>
export const organizationById = Object.fromEntries(organizations.map((o) => [o.id, o]))
export const userById = Object.fromEntries(users.map((u) => [u.id, u])) as Record<string, User>
export const roleById = Object.fromEntries(roles.map((r) => [r.id, r]))
export const locationById = Object.fromEntries(locations.map((l) => [l.id, l])) as Record<string, MapLocation>
export const floorById = Object.fromEntries(floors.map((f) => [f.id, f])) as Record<string, Floor>
export const routeById = Object.fromEntries(routes.map((r) => [r.id, r])) as Record<string, Route>
export const mapVersionById = Object.fromEntries(mapVersions.map((v) => [v.id, v])) as Record<
  string,
  MapVersion
>
export const propertyCodeById = Object.fromEntries(propertyCodes.map((c) => [c.id, c])) as Record<
  string,
  PropertyCode
>
export const apiClientById = Object.fromEntries(apiClients.map((c) => [c.id, c]))

export function resolveSiteProperty(idOrName: string): SiteProperty | null {
  return sitePropertyById[idOrName] ?? sitePropertyByName[idOrName] ?? null
}

export function locationsForPropertyId(propertyId: string): MapLocation[] {
  return locations.filter((l) => l.propertyId === propertyId)
}

export function floorsForPropertyId(propertyId: string): Floor[] {
  return floors.filter((f) => f.propertyId === propertyId)
}

export function locationsForPropertyName(propertyName: string): MapLocation[] {
  const prop = sitePropertyByName[propertyName]
  return prop ? locationsForPropertyId(prop.id) : []
}

export function floorsForPropertyName(propertyName: string): Floor[] {
  const prop = sitePropertyByName[propertyName]
  return prop ? floorsForPropertyId(prop.id) : []
}

export function liveMapVersion(propertyId: string): MapVersion | undefined {
  return mapVersions.find((v) => v.propertyId === propertyId && v.status === 'Live')
}

export function currentMapVersion(propertyId: string): MapVersion | undefined {
  return (
    mapVersions.find((v) => v.propertyId === propertyId && v.status === 'Live') ??
    mapVersions.find((v) => v.propertyId === propertyId && v.status === 'Staging') ??
    mapVersions.find((v) => v.propertyId === propertyId && v.status === 'Draft')
  )
}

export function usageForCode(code: PropertyCode) {
  return codeUsage.find((u) => u.propertyCodeId === code.id || u.code === code.code)
}

export function routesForPropertyId(propertyId: string): Route[] {
  return routes.filter((r) => r.propertyId === propertyId)
}

export function usersInOrganization(organizationId: string): User[] {
  return users.filter((u) => u.organizationId === organizationId)
}

export function keysForClient(apiClientId: string) {
  return apiKeys.filter((k) => k.apiClientId === apiClientId)
}

/** Entity relationship summary for docs / debugging. */
export const entityRelations = [
  { from: 'Organization', to: 'Complex', via: 'Complex.organizationId' },
  { from: 'Organization', to: 'SiteProperty (independent)', via: 'Building.organizationId' },
  { from: 'Complex', to: 'Building', via: 'Building.complexId' },
  { from: 'Building', to: 'Floor', via: 'Floor.buildingId' },
  { from: 'Floor', to: 'MapLocation', via: 'MapLocation.floorId' },
  { from: 'SiteProperty', to: 'Floor / MapLocation / Route / PropertyCode / MapVersion / …', via: '*.propertyId' },
  { from: 'MapVersion', to: 'Approval / MapDownload', via: 'mapVersionId' },
  { from: 'PropertyCode', to: 'CodeUsage', via: 'propertyCodeId' },
  { from: 'Route', to: 'Journey', via: 'routeId' },
  { from: 'MapLocation', to: 'Route endpoints / Correction / Dwell / Tenant', via: 'locationId / from|toLocationId' },
  { from: 'User', to: 'Organization / Role', via: 'organizationId / roleId' },
  { from: 'ApiClient', to: 'Organization', via: 'organizationId' },
  { from: 'ApiClient', to: 'ApiKey / ApiUsageStat / ApiLog', via: 'apiClientId' },
] as const
