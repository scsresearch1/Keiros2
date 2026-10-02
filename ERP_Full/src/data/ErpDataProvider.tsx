import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  alerts as seedAlerts,
  apiClients as seedApiClients,
  apiKeys as seedApiKeys,
  apiLogs as seedApiLogs,
  navigationSessions as seedNavSessions,
  apiUsageStats as seedApiUsage,
  approvals as seedApprovals,
  auditLogs as seedAudit,
  buildings as seedBuildings,
  codeUsage as seedCodeUsage,
  complexes as seedComplexes,
  corrections as seedCorrections,
  dashboardKpis as seedDashboardKpis,
  dwellMetrics as seedDwell,
  floors as seedFloors,
  journeys as seedJourneys,
  locations as seedLocations,
  mapDownloads as seedDownloads,
  mappingQueue as seedMappingQueue,
  mapVersions as seedMapVersions,
  mobileSessions as seedSessions,
  organizations as seedOrgs,
  propertyCodes as seedCodes,
  qualityIssues as seedQuality,
  roles as seedRoles,
  routes as seedRoutes,
  siteProperties as seedSiteProperties,
  systemHealthServices as seedHealth,
  tenantActivity as seedTenants,
  tours as seedTours,
  users as seedUsers,
  type Alert,
  type ApiClient,
  type ApiKey,
  type ApiLog,
  type ApiUsageStat,
  type NavigationSession,
  type Approval,
  type AuditLog,
  type Building,
  type CodeUsage,
  type Complex,
  type Correction,
  type DwellMetric,
  type Floor,
  type Journey,
  type MapDownload,
  type MapLocation,
  type MappingQueueItem,
  type MapVersion,
  type MobileSession,
  type Organization,
  type PropertyCode,
  type QualityIssue,
  type Role,
  type Route,
  type SiteProperty,
  type SystemHealthService,
  type TenantActivity,
  type Tour,
  type User,
  type KeriosaImport,
} from './erpData'
import { isFirebaseEnabled } from '../firebase/config'
import {
  ARRAY_KEYS,
  fetchArrayCollection,
  fetchDashboardKpis,
  fetchErpSettings,
  removeDoc,
  upsertDoc,
  upsertSingleton,
  type ArrayCollectionKey,
} from '../firebase/repo'
import { COLLECTIONS } from '../firebase/collections'

export type ErpSettings = {
  id: string
  codePrefixFormat: string
  defaultCodeExpiryDays: number
  allowCodeReuse: boolean
  sessionTimeoutMin: number
  dwellThresholdMin: number
  anonymizeDeviceIds: boolean
  apiRateLimitPerMin: number
  apiBurstLimit: number
  keyRotationDays: number
  defaultSender: string
  ersWebhookUrl: string
  digestFrequency: 'hourly' | 'daily' | 'weekly'
}

export type ErpSnapshot = {
  organizations: Organization[]
  roles: Role[]
  users: User[]
  complexes: Complex[]
  siteProperties: SiteProperty[]
  buildings: Building[]
  floors: Floor[]
  locations: MapLocation[]
  mappingQueue: MappingQueueItem[]
  qualityIssues: QualityIssue[]
  approvals: Approval[]
  corrections: Correction[]
  mapVersions: MapVersion[]
  routes: Route[]
  propertyCodes: PropertyCode[]
  codeUsage: CodeUsage[]
  mapDownloads: MapDownload[]
  mobileSessions: MobileSession[]
  journeys: Journey[]
  dwellMetrics: DwellMetric[]
  tours: Tour[]
  tenantActivity: TenantActivity[]
  apiClients: ApiClient[]
  apiKeys: ApiKey[]
  apiUsageStats: ApiUsageStat[]
  apiLogs: ApiLog[]
  navigationSessions: NavigationSession[]
  alerts: Alert[]
  auditLogs: AuditLog[]
  systemHealthServices: SystemHealthService[]
  keriosaImports: KeriosaImport[]
  dashboardKpis: typeof seedDashboardKpis
  erpSettings: ErpSettings
}

const DEFAULT_SETTINGS: ErpSettings = {
  id: 'erp_settings',
  codePrefixFormat: '{PROP}-{CITY}-{YEAR}',
  defaultCodeExpiryDays: 365,
  allowCodeReuse: false,
  sessionTimeoutMin: 30,
  dwellThresholdMin: 5,
  anonymizeDeviceIds: true,
  apiRateLimitPerMin: 1200,
  apiBurstLimit: 200,
  keyRotationDays: 90,
  defaultSender: 'alerts@keiros.ai',
  ersWebhookUrl: 'https://ers.keiros.ai/hook/demo',
  digestFrequency: 'daily',
}

function seedSnapshot(): ErpSnapshot {
  return {
    organizations: structuredClone(seedOrgs),
    roles: structuredClone(seedRoles),
    users: structuredClone(seedUsers),
    complexes: structuredClone(seedComplexes),
    siteProperties: structuredClone(seedSiteProperties),
    buildings: structuredClone(seedBuildings),
    floors: structuredClone(seedFloors),
    locations: structuredClone(seedLocations),
    mappingQueue: structuredClone(seedMappingQueue),
    qualityIssues: structuredClone(seedQuality),
    approvals: structuredClone(seedApprovals),
    corrections: structuredClone(seedCorrections),
    mapVersions: structuredClone(seedMapVersions),
    routes: structuredClone(seedRoutes),
    propertyCodes: structuredClone(seedCodes),
    codeUsage: structuredClone(seedCodeUsage),
    mapDownloads: structuredClone(seedDownloads),
    mobileSessions: structuredClone(seedSessions),
    journeys: structuredClone(seedJourneys),
    dwellMetrics: structuredClone(seedDwell),
    tours: structuredClone(seedTours),
    tenantActivity: structuredClone(seedTenants),
    apiClients: structuredClone(seedApiClients),
    apiKeys: structuredClone(seedApiKeys),
    apiUsageStats: structuredClone(seedApiUsage),
    apiLogs: structuredClone(seedApiLogs),
    navigationSessions: structuredClone(seedNavSessions),
    alerts: structuredClone(seedAlerts),
    auditLogs: structuredClone(seedAudit),
    systemHealthServices: structuredClone(seedHealth),
    keriosaImports: [],
    dashboardKpis: { ...seedDashboardKpis },
    erpSettings: { ...DEFAULT_SETTINGS },
  }
}

type ErpDataContextValue = {
  ready: boolean
  loading: boolean
  error: string | null
  source: 'firebase' | 'seed'
  data: ErpSnapshot
  refresh: () => Promise<void>
  upsert: <K extends ArrayCollectionKey>(key: K, item: ErpSnapshot[K][number] & { id: string }) => Promise<void>
  remove: (key: ArrayCollectionKey, id: string) => Promise<void>
  saveSettings: (settings: ErpSettings) => Promise<void>
  logAudit: (partial: Omit<AuditLog, 'id' | 'timestamp' | 'ip'> & { id?: string; timestamp?: string; ip?: string }) => Promise<void>
}

const ErpDataContext = createContext<ErpDataContextValue | null>(null)

async function loadFromFirebase(): Promise<ErpSnapshot> {
  const base = seedSnapshot()
  const entries = await Promise.all(
    ARRAY_KEYS.map(async (key) => [key, await fetchArrayCollection(key)] as const),
  )
  for (const [key, rows] of entries) {
    if (rows.length) {
      ;(base as Record<string, unknown>)[key] = rows
    }
  }
  const kpis = await fetchDashboardKpis()
  if (kpis) {
    base.dashboardKpis = {
      properties: Number(kpis.properties ?? base.dashboardKpis.properties),
      published: Number(kpis.published ?? base.dashboardKpis.published),
      inReview: Number(kpis.inReview ?? base.dashboardKpis.inReview),
      avgReadiness: Number(kpis.avgReadiness ?? base.dashboardKpis.avgReadiness),
      activeUsers: Number(kpis.activeUsers ?? base.dashboardKpis.activeUsers),
      pendingApprovals: Number(kpis.pendingApprovals ?? base.dashboardKpis.pendingApprovals),
      openCorrections: Number(kpis.openCorrections ?? base.dashboardKpis.openCorrections),
      activeSessions: Number(kpis.activeSessions ?? base.dashboardKpis.activeSessions),
      siteProperties: Number(kpis.siteProperties ?? base.dashboardKpis.siteProperties),
    }
  }
  const settings = await fetchErpSettings()
  if (settings) {
    base.erpSettings = { ...DEFAULT_SETTINGS, ...settings, id: 'erp_settings' } as ErpSettings
  }
  // derived convenience
  base.complexes = base.complexes.length ? base.complexes : base.complexes
  return base
}

export function ErpDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<ErpSnapshot>(() => seedSnapshot())
  const [ready, setReady] = useState(!isFirebaseEnabled())
  const [loading, setLoading] = useState(isFirebaseEnabled())
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<'firebase' | 'seed'>(isFirebaseEnabled() ? 'firebase' : 'seed')

  const bootstrapped = useRef(false)

  const refresh = useCallback(async () => {
    if (!isFirebaseEnabled()) {
      setData(seedSnapshot())
      setSource('seed')
      setReady(true)
      setLoading(false)
      bootstrapped.current = true
      return
    }
    // Only block the UI on the first Firestore fetch — later syncs must stay silent
    // so page navigation and in-progress form state are preserved.
    if (!bootstrapped.current) {
      setLoading(true)
    }
    setError(null)
    try {
      const snap = await loadFromFirebase()
      setData(snap)
      setSource('firebase')
      setReady(true)
      bootstrapped.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Firestore data')
      setData(seedSnapshot())
      setSource('seed')
      setReady(true)
      bootstrapped.current = true
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const upsert = useCallback(
    async <K extends ArrayCollectionKey>(key: K, item: ErpSnapshot[K][number] & { id: string }) => {
      setData((prev) => {
        const list = prev[key] as Array<{ id: string }>
        const idx = list.findIndex((row) => row.id === item.id)
        const nextList =
          idx >= 0 ? list.map((row, i) => (i === idx ? item : row)) : [item, ...list]
        return { ...prev, [key]: nextList }
      })
      try {
        await upsertDoc(key, item as { id: string } & Record<string, unknown>)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
        throw err
      }
    },
    [],
  )

  const remove = useCallback(async (key: ArrayCollectionKey, id: string) => {
    setData((prev) => ({
      ...prev,
      [key]: (prev[key] as Array<{ id: string }>).filter((row) => row.id !== id),
    }))
    try {
      await removeDoc(key, id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      throw err
    }
  }, [])

  const saveSettings = useCallback(async (settings: ErpSettings) => {
    setData((prev) => ({ ...prev, erpSettings: settings }))
    await upsertSingleton(COLLECTIONS.meta, 'erp_settings', settings as unknown as Record<string, unknown>)
  }, [])

  const logAudit = useCallback(
    async (
      partial: Omit<AuditLog, 'id' | 'timestamp' | 'ip'> & {
        id?: string
        timestamp?: string
        ip?: string
      },
    ) => {
      const entry: AuditLog = {
        id: partial.id ?? `aud-${Date.now()}`,
        timestamp: partial.timestamp ?? new Date().toISOString().replace('T', ' ').slice(0, 19),
        actorUserId: partial.actorUserId,
        actor: partial.actor,
        action: partial.action,
        target: partial.target,
        ip: partial.ip ?? '10.0.0.1',
      }
      await upsert('auditLogs', entry)
    },
    [upsert],
  )

  const value = useMemo<ErpDataContextValue>(
    () => ({
      ready,
      loading,
      error,
      source,
      data,
      refresh,
      upsert,
      remove,
      saveSettings,
      logAudit,
    }),
    [ready, loading, error, source, data, refresh, upsert, remove, saveSettings, logAudit],
  )

  return <ErpDataContext.Provider value={value}>{children}</ErpDataContext.Provider>
}

export function useErpData(): ErpDataContextValue {
  const ctx = useContext(ErpDataContext)
  if (!ctx) throw new Error('useErpData must be used within ErpDataProvider')
  return ctx
}

/** Build ID indexes from a live snapshot (prefer over static entityMap). */
export function buildEntityMap(data: ErpSnapshot) {
  return {
    sitePropertyById: Object.fromEntries(data.siteProperties.map((p) => [p.id, p])),
    sitePropertyByName: Object.fromEntries(data.siteProperties.map((p) => [p.name, p])),
    organizationById: Object.fromEntries(data.organizations.map((o) => [o.id, o])),
    userById: Object.fromEntries(data.users.map((u) => [u.id, u])),
    roleById: Object.fromEntries(data.roles.map((r) => [r.id, r])),
    locationById: Object.fromEntries(data.locations.map((l) => [l.id, l])),
    floorById: Object.fromEntries(data.floors.map((f) => [f.id, f])),
    routeById: Object.fromEntries(data.routes.map((r) => [r.id, r])),
    mapVersionById: Object.fromEntries(data.mapVersions.map((v) => [v.id, v])),
    propertyCodeById: Object.fromEntries(data.propertyCodes.map((c) => [c.id, c])),
    apiClientById: Object.fromEntries(data.apiClients.map((c) => [c.id, c])),
    locationsForPropertyId: (propertyId: string) =>
      data.locations.filter((l) => l.propertyId === propertyId),
    floorsForPropertyId: (propertyId: string) => data.floors.filter((f) => f.propertyId === propertyId),
    liveMapVersion: (propertyId: string) =>
      data.mapVersions.find((v) => v.propertyId === propertyId && v.status === 'Live'),
    keysForClient: (apiClientId: string) => data.apiKeys.filter((k) => k.apiClientId === apiClientId),
  }
}

export function useEntityMap() {
  const { data } = useErpData()
  return useMemo(() => buildEntityMap(data), [data])
}
