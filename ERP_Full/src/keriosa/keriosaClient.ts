import { getKeriosaRtdbUrl } from '../firebase/config'
import type { KeriosaLockRaw } from './keriosaMap'

export type KeriosaLockedEntry = { lockKey: string; data: KeriosaLockRaw }

async function fetchJson<T>(path: string): Promise<T> {
  const base = getKeriosaRtdbUrl()
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Keriosa RTDB ${res.status}: ${url}`)
  }
  const text = await res.text()
  if (!text || text === 'null') return null as T
  return JSON.parse(text) as T
}

/** List lock timestamp keys under keiros/locked. */
export async function listKeriosaLockKeys(): Promise<string[]> {
  const shallow = await fetchJson<Record<string, true> | null>('/keiros/locked.json?shallow=true')
  if (!shallow || typeof shallow !== 'object') return []
  return Object.keys(shallow).sort().reverse()
}

export async function fetchKeriosaLock(lockKey: string): Promise<KeriosaLockRaw | null> {
  const encoded = encodeURIComponent(lockKey)
  return fetchJson<KeriosaLockRaw | null>(`/keiros/locked/${encoded}.json`)
}

export async function fetchAllKeriosaLocks(): Promise<KeriosaLockedEntry[]> {
  const tree = await fetchJson<Record<string, KeriosaLockRaw> | null>('/keiros/locked.json')
  if (!tree || typeof tree !== 'object') return []
  return Object.entries(tree)
    .filter((entry): entry is [string, KeriosaLockRaw] => Boolean(entry[1]) && typeof entry[1] === 'object')
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([lockKey, data]) => ({ lockKey, data }))
}
