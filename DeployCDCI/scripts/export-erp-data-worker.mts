/**
 * Worker: run via tsx from ERP_Full context to import erpData.ts
 * Args: <outJsonPath> <collectionsJsonPath>
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const outPath = process.argv[2]
const collectionsPath = process.argv[3]

if (!outPath || !collectionsPath) {
  console.error('Usage: export-erp-data-worker.mts <outJson> <collections.json>')
  process.exit(1)
}

const erpDataUrl = pathToFileURL(path.resolve(process.cwd(), 'src/data/erpData.ts')).href
const erp = await import(erpDataUrl)
const cfg = JSON.parse(fs.readFileSync(collectionsPath, 'utf8'))

const collections: Record<string, unknown> = {}
for (const entry of cfg.collections) {
  const value = (erp as Record<string, unknown>)[entry.exportName]
  if (value === undefined) {
    console.warn(`[export] Missing export: ${entry.exportName}`)
    continue
  }
  collections[entry.firestore] = value
}

const payload = {
  exportedAt: new Date().toISOString(),
  source: 'ERP_Full/src/data/erpData.ts',
  collections,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log(`[export] ${Object.keys(collections).length} collections → ${outPath}`)
