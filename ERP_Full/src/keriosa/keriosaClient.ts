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
  const keys = await listKeriosaLockKeys()
  const rows: KeriosaLockedEntry[] = []
  for (const lockKey of keys) {
    const data = await fetchKeriosaLock(lockKey)
    if (data && typeof data === 'object') {
      rows.push({ lockKey, data })
    }
  }
  return rows
}
