import { getApiKey, validateAccessCode, type ValidatedProperty } from '../api/client'

export type PropertyMeta = {
  code: string
  propertyId: string
  complexId: string
  name: string
  city: string
  state: string
  address: string
  label?: string | null
}

/** Example ERP codes (Property Codes page) — used only for Simulate QR. */
export const DEMO_CODES = ['OC-CHI-2026', 'HM-BOS-RETAIL', 'SMC-DEN-PAT']

export function normalizeCode(raw: string) {
  const text = raw.trim()
  if (!text) return ''

  try {
    if (/^https?:\/\//i.test(text) || /^keiros:\/\//i.test(text)) {
      const normalized = text.replace(/^keiros:\/\//i, 'https://keiros.local/')
      const url = new URL(normalized)
      const fromQuery = url.searchParams.get('code')
      if (fromQuery?.trim()) return fromQuery.trim().toUpperCase().replace(/\s+/g, '-')
      const pathParts = url.pathname.split('/').filter(Boolean)
      const last = pathParts[pathParts.length - 1]
      if (last && last.toUpperCase() !== 'ACCESS') {
        return last.trim().toUpperCase().replace(/\s+/g, '-')
      }
    }
  } catch {
    /* plain code */
  }

  const codeMatch = text.match(/[?&]code=([^&\s#]+)/i)
  if (codeMatch?.[1]) {
    try {
      return decodeURIComponent(codeMatch[1]).trim().toUpperCase().replace(/\s+/g, '-')
    } catch {
      return codeMatch[1].trim().toUpperCase().replace(/\s+/g, '-')
    }
  }

  return text.toUpperCase().replace(/\s+/g, '-')
}

function toMeta(p: ValidatedProperty): PropertyMeta {
  return {
    code: p.code,
    propertyId: p.propertyId,
    complexId: p.complexId || p.propertyId,
    name: p.name,
    city: p.city || '',
    state: p.state || '',
    address: p.address || '',
    label: p.label,
  }
}

/** Live validation against ERP `POST /api/v1/access/validate`. */
export async function validatePropertyCode(raw: string): Promise<PropertyMeta> {
  const code = normalizeCode(raw)
  if (!code) throw new Error('Enter a property code')

  try {
    const result = await validateAccessCode(getApiKey(), code)
    return toMeta(result.property)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Validation failed'
    if (/failed to fetch|network|HTTP 5/i.test(msg) || msg === 'Failed to fetch') {
      throw new Error('Cannot reach ERP API (port 8787). Start the server and try again.')
    }
    if (/quota exceeded|503|temporarily unavailable/i.test(msg)) {
      throw new Error('ERP backend is rate-limited (Firestore quota). Retry in a minute — server will use local seed.')
    }
    if (/HTTP 401|invalid.?key|unauthorized/i.test(msg)) {
      throw new Error('API key rejected. Check VITE_API_KEY / ERP API Keys.')
    }
    throw new Error(
      msg.includes('property code') || msg.includes('revoked') || msg.includes('expired')
        ? msg
        : `Invalid or inactive property code. (${msg})`,
    )
  }
}

export async function simulateMapDownload(
  onProgress: (pct: number, label: string) => void,
): Promise<void> {
  const stages = [
    [12, 'Authorizing map package…'],
    [28, 'Downloading floors & units…'],
    [48, 'Loading amenities & routes…'],
    [68, 'Syncing Keiros coordinates…'],
    [86, 'Building indoor model…'],
    [100, 'Map ready'],
  ] as const
  for (const [pct, label] of stages) {
    await delay(380 + Math.random() * 220)
    onProgress(pct, label)
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
