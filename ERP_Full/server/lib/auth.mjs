import { createHash } from 'node:crypto'
import { loadCollection, upsert } from './firebase.mjs'

export function hashApiKey(rawKey) {
  return createHash('sha256').update(String(rawKey), 'utf8').digest('hex')
}

/**
 * Prefer exact SHA-256 match against `api_keys.keyHash` (real issued secrets).
 * Legacy Active rows without keyHash still accept prefix + ≥8 char suffix (demo keys).
 */
export async function authenticateApiKey(rawKey) {
  const key = String(rawKey ?? '').trim()
  if (!key || key.length < 12) {
    return { ok: false, status: 401, error: 'API key required' }
  }

  const keys = await loadCollection('api_keys')
  const digest = hashApiKey(key)

  let match =
    keys.find((row) => row.status === 'Active' && row.keyHash && row.keyHash === digest) ?? null

  if (!match) {
    match =
      keys.find(
        (row) =>
          row.status === 'Active' &&
          !row.keyHash &&
          typeof row.prefix === 'string' &&
          row.prefix.length > 0 &&
          key.startsWith(row.prefix) &&
          key.length >= row.prefix.length + 8,
      ) ?? null
  }

  if (!match) {
    return { ok: false, status: 401, error: 'Invalid or inactive API key' }
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  try {
    await upsert('api_keys', match.id, { ...match, lastUsed: now })
  } catch {
    /* quota / offline — auth still succeeds */
  }

  return {
    ok: true,
    apiKey: match,
    apiKeyId: match.id,
    apiClientId: match.apiClientId,
    clientName: match.clientName,
    scopes: String(match.scopes ?? ''),
    authMode: match.keyHash ? 'hash' : 'legacy-prefix',
  }
}

export function requireScope(auth, needed) {
  const scopes = auth.scopes.split(',').map((s) => s.trim()).filter(Boolean)
  if (!scopes.length) return true
  return scopes.some((s) => s === needed || s.startsWith(needed.split(':')[0]))
}

export function extractApiKey(req) {
  const header = req.headers.authorization || req.headers['x-api-key'] || ''
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  if (typeof header === 'string' && header && !header.toLowerCase().startsWith('bearer')) {
    return header.trim()
  }
  return String(req.query.apiKey || req.body?.apiKey || '').trim()
}
