/** Browser-side API key material. Full secret is never persisted after create/rotate. */

export function buildKeyPrefix(clientName: string, environment: string) {
  const slug = clientName
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 4) || 'app'
  const env = environment === 'Production' ? 'live' : environment === 'Staging' ? 'stg' : 'dev'
  return `keiros_${env}_${slug}_`
}

export function randomSecret(bytes = 24) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function issueApiKeySecret(prefix: string) {
  const secret = randomSecret(24)
  const fullKey = `${prefix}${secret}`
  return {
    fullKey,
    prefix,
    lastFour: fullKey.slice(-4),
  }
}

export async function sha256Hex(value: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}
