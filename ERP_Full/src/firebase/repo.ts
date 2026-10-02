import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
} from 'firebase/firestore'
import { getFirestoreDb } from './app'
import { COLLECTIONS } from './collections'
import { isFirebaseEnabled } from './config'

export type CollectionKey = keyof Omit<typeof COLLECTIONS, 'meta'>

const ARRAY_KEYS = [
  'organizations',
  'roles',
  'users',
  'complexes',
  'siteProperties',
  'buildings',
  'floors',
  'locations',
  'mappingQueue',
  'qualityIssues',
  'approvals',
  'corrections',
  'mapVersions',
  'routes',
  'propertyCodes',
  'codeUsage',
  'mapDownloads',
  'mobileSessions',
  'journeys',
  'dwellMetrics',
  'tours',
  'tenantActivity',
  'apiClients',
  'apiKeys',
  'apiUsageStats',
  'apiLogs',
  'navigationSessions',
  'alerts',
  'auditLogs',
  'systemHealthServices',
  'keriosaImports',
] as const satisfies readonly CollectionKey[]

export type ArrayCollectionKey = (typeof ARRAY_KEYS)[number]

function stripMeta<T extends Record<string, unknown>>(data: T): T {
  const { _seededAt: _a, ...rest } = data as T & { _seededAt?: unknown }
  return rest as T
}

/** Firestore rejects `undefined` field values */
export function sanitizeForFirestore(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitizeForFirestore)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = sanitizeForFirestore(v)
  }
  return out
}

export async function fetchArrayCollection<T extends { id?: string }>(
  key: ArrayCollectionKey,
  max = 5000,
): Promise<T[]> {
  const name = COLLECTIONS[key]
  const snap = await getDocs(query(collection(getFirestoreDb(), name), limit(max)))
  return snap.docs.map((d) => {
    const raw = stripMeta(d.data() as Record<string, unknown>)
    return { ...raw, id: String(raw.id ?? d.id) } as T
  })
}

export async function fetchDashboardKpis(): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(getFirestoreDb(), COLLECTIONS.dashboardKpis, 'current'))
  if (!snap.exists()) return null
  return stripMeta(snap.data() as Record<string, unknown>)
}

export async function fetchErpSettings(): Promise<Record<string, unknown> | null> {
  const snap = await getDoc(doc(getFirestoreDb(), COLLECTIONS.meta, 'erp_settings'))
  if (!snap.exists()) return null
  return stripMeta(snap.data() as Record<string, unknown>)
}

export async function upsertDoc(key: ArrayCollectionKey, data: { id: string } & Record<string, unknown>) {
  if (!isFirebaseEnabled()) return
  const id = String(data.id)
  const payload = sanitizeForFirestore({ ...data, id, _updatedAt: new Date().toISOString() }) as Record<
    string,
    unknown
  >
  await setDoc(doc(getFirestoreDb(), COLLECTIONS[key], id), payload, { merge: true })
}

export async function removeDoc(key: ArrayCollectionKey, id: string) {
  if (!isFirebaseEnabled()) return
  await deleteDoc(doc(getFirestoreDb(), COLLECTIONS[key], id))
}

export async function upsertSingleton(
  collectionName: string,
  docId: string,
  data: Record<string, unknown>,
) {
  if (!isFirebaseEnabled()) return
  const payload = sanitizeForFirestore({ ...data, id: docId, _updatedAt: new Date().toISOString() }) as Record<
    string,
    unknown
  >
  await setDoc(doc(getFirestoreDb(), collectionName, docId), payload, { merge: true })
}

export async function appendAuditLog(entry: {
  id: string
  timestamp: string
  actorUserId: string | null
  actor: string
  action: string
  target: string
  ip: string
}) {
  await upsertDoc('auditLogs', entry)
}

export { ARRAY_KEYS }
