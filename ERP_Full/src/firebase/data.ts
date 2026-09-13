import { collection, doc, getDoc, getDocs, limit, query } from 'firebase/firestore'
import { getFirestoreDb } from './app'
import { COLLECTIONS } from './collections'

export async function fetchCollection<T extends { id?: string }>(
  name: string,
  max = 2000,
): Promise<T[]> {
  const q = query(collection(getFirestoreDb(), name), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T)
}

export async function fetchMetaSchema() {
  const snap = await getDoc(doc(getFirestoreDb(), COLLECTIONS.meta, 'schema'))
  return snap.exists() ? snap.data() : null
}

/** Lightweight connection probe after login */
export async function probeFirebaseConnection(): Promise<{
  ok: boolean
  projectHint: string
  schemaVersion: number | null
  orgCount: number
  message: string
}> {
  try {
    const schema = await fetchMetaSchema()
    const orgs = await fetchCollection(COLLECTIONS.organizations, 50)
    return {
      ok: true,
      projectHint: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || ''),
      schemaVersion: typeof schema?.version === 'number' ? schema.version : null,
      orgCount: orgs.length,
      message: schema
        ? `Connected · ${orgs.length} organizations · schema v${schema.version ?? '?'}`
        : `Connected · ${orgs.length} organizations · schema meta missing (re-run seed)`,
    }
  } catch (err) {
    return {
      ok: false,
      projectHint: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || ''),
      schemaVersion: null,
      orgCount: 0,
      message: err instanceof Error ? err.message : 'Firestore probe failed',
    }
  }
}
