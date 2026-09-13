/**
 * Keiros ERP — canonical entity schema (IDs are authoritative; *Name fields are display cache).
 *
 * Hierarchy:
 *   Organization ──< Complex ──< Building ──< Floor ──< Location
 *                        └───── independent Building (complexId null) also acts as a SiteProperty
 *
 * SiteProperty (ops join root):
 *   kind 'complex'     → id = complex.id
 *   kind 'independent' → id = building.id (standalone)
 *
 * Cross-domain:
 *   SiteProperty ──< MapVersion ──< Approval / MapDownload
 *   SiteProperty ──< Route ──< Journey
 *   SiteProperty ──< PropertyCode ──< CodeUsage
 *   SiteProperty ──< MobileSession / Tour / DwellMetric / TenantActivity
 *   SiteProperty ──< MappingQueueItem / QualityIssue / Correction
 *   Organization ──< User / ApiClient ──< ApiKey / ApiUsageStat / ApiLog
 *   Role ──< User
 */

export type PropertyStatus = 'Mapped' | 'Review' | 'Published' | 'Draft'
export type OrgType = 'Owner' | 'PMC' | 'Customer'
export type UserStatus = 'Active' | 'Inactive'
export type LocationType =
  | 'Room'
  | 'Unit'
  | 'Door'
  | 'Amenity'
  | 'Entry'
  | 'Exit'
  | 'Stairs'
  | 'Elevator'
  | 'Corridor'
  | 'Pool'
  | 'Gym'
  | 'Lobby'
  | 'Parking'

export type ComplexStatus = PropertyStatus
export type BuildingStatus = 'Active' | 'Draft' | 'Inactive'
export type OrgStatus = 'Active' | 'Suspended' | 'Pending'
export type MappingQueueStatus = 'Queued' | 'In Progress' | 'Blocked' | 'Complete'
export type QualitySeverity = 'Low' | 'Medium' | 'High' | 'Critical'
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected'
export type CorrectionStatus = 'Open' | 'Assigned' | 'Resolved'
export type MapVersionStatus = 'Draft' | 'Staging' | 'Live' | 'Archived'
export type RouteStatus = 'Active' | 'Draft' | 'Disabled'
export type CodeStatus = 'Active' | 'Expired' | 'Revoked'
export type SessionStatus = 'Active' | 'Idle' | 'Ended'
export type AlertSeverity = 'Info' | 'Warning' | 'Critical'
export type ServiceHealth = 'Healthy' | 'Degraded' | 'Down'
export type PropertyKind = 'complex' | 'independent'

/** Portfolio complex (campus). Dashboard KPIs still key off this set. */
export type Complex = {
  id: string
  name: string
  city: string
  status: ComplexStatus
  organizationId: string
  organizationName: string
  buildings: number
  floors: number
  readiness: number
  address?: string
}

/** @deprecated Prefer SiteProperty for ops joins; kept for dashboard readiness charts. */
export type Property = Complex

/** Unified property used by mapping / mobile / routes / analytics. */
export type SiteProperty = {
  id: string
  kind: PropertyKind
  name: string
  city: string
  organizationId: string
  organizationName: string
  status: string
  complexId: string | null
  buildingId: string | null
  readiness: number
  address?: string
}

export type Organization = {
  id: string
  name: string
  type: OrgType
  properties: number
  status: OrgStatus
}

export type User = {
  id: string
  name: string
  email: string
  roleId: string
  role: string
  organizationId: string
  org: string
  status: UserStatus
}

export type Role = {
  id: string
  name: string
  permissions: string
  usersCount: number
}

export type Building = {
  id: string
  complexId: string | null
  complexName: string | null
  name: string
  floors: number
  mappedFloors: number
  status: BuildingStatus
  city?: string
  /** Owning org for independent buildings; otherwise inherit from complex. */
  organizationId?: string | null
}

export type Floor = {
  id: string
  buildingId: string
  buildingName: string
  complexId: string | null
  complexName: string | null
  /** SiteProperty.id for this floor's property scope. */
  propertyId: string
  label: string
  level: number
  locations: number
  mappedPct: number
}

/** Indoor map node (avoid name `Location` — conflicts with DOM Location). */
export type MapLocation = {
  id: string
  floorId: string
  floorLabel: string
  buildingId: string
  buildingName: string
  complexId: string | null
  complexName: string | null
  propertyId: string
  name: string
  type: LocationType
  code: string
  mapped: boolean
  physicalAddress: string
  latitude: number
  longitude: number
  elevation: number
}

/** @deprecated Prefer MapLocation */
export type Location = MapLocation

export type MappingQueueItem = {
  id: string
  propertyId: string
  propertyName: string
  floorId: string
  floorLabel: string
  mapperUserId: string | null
  mapper: string
  status: MappingQueueStatus
  priority: number
  dueDate: string
}

export type QualityIssue = {
  id: string
  propertyId: string
  propertyName: string
  floorId: string | null
  floorLabel: string
  issue: string
  severity: QualitySeverity
  reportedByUserId: string
  reportedBy: string
  ageDays: number
}

export type Approval = {
  id: string
  propertyId: string
  propertyName: string
  mapVersionId: string
  mapVersion: string
  submittedByUserId: string
  submittedBy: string
  submittedAt: string
  status: ApprovalStatus
}

export type Correction = {
  id: string
  propertyId: string
  propertyName: string
  locationId: string
  location: string
  description: string
  assigneeUserId: string
  assignee: string
  status: CorrectionStatus
}

export type MapVersion = {
  id: string
  propertyId: string
  propertyName: string
  version: string
  status: MapVersionStatus
  publishedAt: string | null
  floors: number
}

export type Route = {
  id: string
  propertyId: string
  propertyName: string
  name: string
  waypoints: number
  status: RouteStatus
  avgDurationMin: number
  fromLocationId: string
  toLocationId: string
}

export type PropertyCode = {
  id: string
  propertyId: string
  propertyName: string
  code: string
  label: string
  status: CodeStatus
  expiresAt: string | null
}

export type CodeUsage = {
  id: string
  propertyCodeId: string
  propertyId: string
  code: string
  propertyName: string
  scans: number
  uniqueDevices: number
  lastUsed: string
}

export type MapDownload = {
  id: string
  propertyId: string
  propertyName: string
  mapVersionId: string
  platform: 'iOS' | 'Android'
  version: string
  downloads: number
  lastSync: string
}

export type MobileSession = {
  id: string
  propertyId: string
  propertyName: string
  deviceId: string
  userLabel: string
  startedAt: string
  status: SessionStatus
}

export type Journey = {
  id: string
  propertyId: string
  propertyName: string
  routeId: string
  routeName: string
  sessions: number
  completionRate: number
  avgDurationMin: number
}

export type DwellMetric = {
  id: string
  propertyId: string
  propertyName: string
  locationId: string
  zone: string
  avgDwellMin: number
  visits: number
  peakHour: string
  /** Live tour telemetry (optional) */
  liveDwellSec?: number
  liveUpdatedAt?: string
  activeVisitors?: number
  source?: string
  lastSessionId?: string | null
  lastEvent?: string
}

export type Tour = {
  id: string
  propertyId: string
  propertyName: string
  tourName: string
  starts: number
  completions: number
  avgSteps: number
}

export type TenantActivity = {
  id: string
  propertyId: string
  propertyName: string
  tenant: string
  visits: number
  lastVisit: string
  topDestinationLocationId: string
  topDestination: string
}

export type ApiClient = {
  id: string
  name: string
  organizationId: string
  org: string
  environment: 'Production' | 'Staging' | 'Development'
  createdAt: string
  status: 'Active' | 'Disabled'
}

export type ApiKey = {
  id: string
  apiClientId: string
  clientName: string
  /** Public identifier shown in lists (not the secret). */
  prefix: string
  /** SHA-256 hex of the full API key. Never store the plaintext secret. */
  keyHash?: string | null
  /** Last 4 characters of the issued secret for operator recognition. */
  lastFour?: string | null
  scopes: string
  lastUsed: string
  createdAt?: string
  status: 'Active' | 'Rotated' | 'Revoked'
}

export type ApiUsageStat = {
  id: string
  apiClientId: string
  clientName: string
  endpoint: string
  requests: number
  errors: number
  p95Ms: number
}

export type ApiLog = {
  id: string
  timestamp: string
  apiClientId: string
  clientName: string
  method: string
  path: string
  status: number
  durationMs: number
  apiKeyId?: string | null
  /** Optional metadata written by the ERP navigation API server */
  meta?: Record<string, unknown> | null
}

/** Live navigation requests from API_DEMO → ERP API server */
export type NavigationSession = {
  id: string
  createdAt: string
  status: 'Active' | 'Completed' | 'Failed'
  source: string
  apiClientId: string
  clientName: string
  complexId: string | null
  complexName: string | null
  buildingId: string
  buildingName: string
  floorId: string
  floorLabel: string
  unitId: string
  unitName: string
  unitCode: string
  originMiles: number
  outdoorDistanceMiles: number
  outdoorDurationMin: number
  indoorWalkMin: number
  trafficLevel: string
  weatherSummary: string | null
  temperatureF: number | null
  requestPath: string
}

export type Alert = {
  id: string
  title: string
  source: string
  serviceId?: string | null
  severity: AlertSeverity
  triggeredAt: string
  acknowledged: boolean
}

export type AuditLog = {
  id: string
  timestamp: string
  actorUserId: string | null
  actor: string
  action: string
  target: string
  ip: string
}

export type SystemHealthService = {
  id: string
  name: string
  health: ServiceHealth
  latencyMs: number
  uptimePct: number
}
