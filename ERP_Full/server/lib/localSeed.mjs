import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const erpDataPath = resolve(__dirname, '..', '..', 'src', 'data', 'erpData.ts')

/** Map Firestore collection names → erpData.ts export names */
const COLLECTION_EXPORT = {
  complexes: 'complexes',
  buildings: 'buildings',
  floors: 'floors',
  locations: 'locations',
  routes: 'routes',
  property_codes: 'propertyCodes',
  code_usage: 'codeUsage',
  api_keys: 'apiKeys',
  api_clients: 'apiClients',
  api_usage_stats: 'apiUsageStats',
  api_logs: 'apiLogs',
  journeys: 'journeys',
  dwell_metrics: 'dwellMetrics',
  navigation_sessions: 'navigationSessions',
  map_downloads: 'mapDownloads',
  mobile_sessions: 'mobileSessions',
  tours: 'tours',
  tenant_activity: 'tenantActivity',
  site_properties: 'siteProperties',
}

let cache = null

function extractExportArray(src, exportName) {
  const marker = `export const ${exportName}`
  const i = src.indexOf(marker)
  if (i < 0) return []
  const eq = src.indexOf('=', i)
  const start = src.indexOf('[', eq)
  if (start < 0) return []
  let depth = 0
  for (let j = start; j < src.length; j += 1) {
    const ch = src[j]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        const raw = src.slice(start, j + 1)
        // erpData arrays are JSON-compatible object literals
        // eslint-disable-next-line no-new-func
        return Function(`"use strict"; return (${raw});`)()
      }
    }
  }
  return []
}

export function getLocalSeed() {
  if (cache) return cache
  cache = {}
  if (!existsSync(erpDataPath)) {
    console.warn(`[localSeed] erpData.ts not found at ${erpDataPath}`)
    return cache
  }
  const src = readFileSync(erpDataPath, 'utf8')
  for (const [collection, exportName] of Object.entries(COLLECTION_EXPORT)) {
    try {
      cache[collection] = extractExportArray(src, exportName)
    } catch (err) {
      console.warn(`[localSeed] failed to parse ${exportName}:`, err instanceof Error ? err.message : err)
      cache[collection] = []
    }
  }
  console.log(
    `[localSeed] loaded fallback from erpData.ts (${Object.keys(cache)
      .map((k) => `${k}:${cache[k].length}`)
      .join(', ')})`,
  )
  return cache
}

export function localSeedRows(collection) {
  const seed = getLocalSeed()
  return structuredClone(seed[collection] || [])
}
