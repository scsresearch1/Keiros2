/**
 * Repair Firestore location hierarchy for indoor nav.
 * Targeted + quota-safe (sequential, paged, long backoff).
 *
 *   node scripts/fixLocationEntries.mjs
 *   node scripts/fixLocationEntries.mjs --dry-run
 */
import admin from 'firebase-admin'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(__dirname, '..')
const erpRoot = resolve(serverRoot, '..')
dotenv.config({ path: resolve(serverRoot, '.env') })
dotenv.config({ path: resolve(erpRoot, '..', 'DeployCDCI', '.env'), override: false })

process.env.FIRESTORE_PREFER_REST = 'true'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0'

const DRY = process.argv.includes('--dry-run')

function looksLikeDwelling(label) {
  const t = String(label || '').trim()
  if (!t) return false
  if (/\b(unit|suite|apt\.?|apartment)\s*[#-]?\s*[a-z0-9-]+\b/i.test(t)) return true
  if (/#\s*\d{1,4}[a-z]?\b/i.test(t)) return true
  const norm = t.trim().toLowerCase().replace(/\s+/g, ' ')
  return /^(suite|apt|apartment|unit)\b/.test(norm) || /^\d{2,4}[a-z]?$/.test(norm)
}

function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function withRetry(fn, label, attempts = 10) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      const msg = err instanceof Error ? err.message : String(err)
      const quota = /quota exceeded|resource.?exhausted|code:?\s*8/i.test(msg) || err?.code === 8
      if (!quota || i === attempts - 1) throw err
      const wait = Math.min(120000, 8000 * 2 ** i)
      console.warn(`[retry] ${label}: quota — waiting ${Math.round(wait / 1000)}s (${i + 1}/${attempts})`)
      await sleep(wait)
    }
  }
  throw last
}

function loadCred() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inline) {
    try {
      return JSON.parse(inline)
    } catch {
      return JSON.parse(Buffer.from(inline, 'base64').toString('utf8'))
    }
  }
  const path =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    'C:\\Users\\sdnil\\Downloads\\keiros-erp-firebase-adminsdk-fbsvc-3458fd48df.json'
  if (!existsSync(path)) throw new Error(`Missing service account JSON at ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

const sa = loadCred()
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id })
const db = admin.firestore()

async function loadPaged(name, pageSize = 100) {
  const rows = []
  let last = null
  let page = 0
  for (;;) {
    page += 1
    const snap = await withRetry(async () => {
      let q = db.collection(name).orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
      if (last) q = q.startAfter(last)
      return q.get()
    }, `${name} page ${page}`)
    if (snap.empty) break
    for (const d of snap.docs) rows.push({ id: d.id, ...d.data() })
    last = snap.docs[snap.docs.length - 1]
    console.log(`  loaded ${name}: ${rows.length}`)
    if (snap.size < pageSize) break
    await sleep(1500)
  }
  return rows
}

async function writeOne(col, id, data) {
  if (DRY) return
  await withRetry(() => db.collection(col).doc(id).set(data, { merge: true }), `set ${col}/${id}`)
  await sleep(120)
}

async function deleteOne(col, id) {
  if (DRY) return
  await withRetry(() => db.collection(col).doc(id).delete(), `del ${col}/${id}`)
  await sleep(120)
}

console.log(DRY ? 'DRY RUN — no writes' : 'APPLYING Firestore repairs…')
console.log('Cooling 20s before reads…')
await sleep(20000)

console.log('Loading complexes…')
const complexes = await loadPaged('complexes', 50)
await sleep(2000)
console.log('Loading buildings…')
const buildings = await loadPaged('buildings', 50)
await sleep(2000)
console.log('Loading floors…')
const floors = await loadPaged('floors', 50)
await sleep(2000)
console.log('Loading locations…')
const locations = await loadPaged('locations', 80)
await sleep(2000)
console.log('Loading site_properties…')
const siteProperties = await loadPaged('site_properties', 50)

console.log({
  complexes: complexes.length,
  buildings: buildings.length,
  floors: floors.length,
  locations: locations.length,
  siteProperties: siteProperties.length,
})

const stats = {
  deletedEmptyComplexes: 0,
  deletedEmptySiteProps: 0,
  retypedToUnit: 0,
  promotedToEntry: 0,
}

const buildingCount = new Map()
const locationCount = new Map()
for (const b of buildings) {
  if (b.complexId) buildingCount.set(b.complexId, (buildingCount.get(b.complexId) || 0) + 1)
}
for (const l of locations) {
  if (l.complexId) locationCount.set(l.complexId, (locationCount.get(l.complexId) || 0) + 1)
}

const byName = new Map()
for (const c of complexes) {
  const key = String(c.name || '')
    .trim()
    .toLowerCase()
  byName.set(key, [...(byName.get(key) || []), c])
}

const keepComplex = new Set()
for (const [, group] of byName) {
  const ranked = [...group].sort((a, b) => {
    const sa = (buildingCount.get(a.id) || 0) * 1000 + (locationCount.get(a.id) || 0)
    const sb = (buildingCount.get(b.id) || 0) * 1000 + (locationCount.get(b.id) || 0)
    return sb - sa
  })
  keepComplex.add(ranked[0].id)
  for (const extra of ranked.slice(1)) {
    const b = buildingCount.get(extra.id) || 0
    const l = locationCount.get(extra.id) || 0
    if (b === 0 && l === 0) {
      console.log(`delete empty duplicate complex ${extra.id} (${extra.name})`)
      await deleteOne('complexes', extra.id)
      stats.deletedEmptyComplexes += 1
    } else {
      keepComplex.add(extra.id)
    }
  }
}

for (const sp of siteProperties) {
  const cid = sp.complexId || (sp.kind === 'complex' ? sp.id : null)
  if (
    cid &&
    !keepComplex.has(cid) &&
    (buildingCount.get(cid) || 0) === 0 &&
    (locationCount.get(cid) || 0) === 0
  ) {
    console.log(`delete empty site_property ${sp.id} (${sp.name})`)
    await deleteOne('site_properties', sp.id)
    stats.deletedEmptySiteProps += 1
  }
}

const nextLocations = locations.map((l) => ({ ...l }))
for (const loc of nextLocations) {
  if (loc.type === 'Entry' && looksLikeDwelling(loc.name)) {
    console.log(`retype Unit ← Entry: ${loc.name}`)
    loc.type = 'Unit'
    await writeOne('locations', loc.id, { type: 'Unit', mapped: loc.mapped !== false })
    stats.retypedToUnit += 1
  }
}

const byBuilding = new Map()
for (const loc of nextLocations) {
  if (!loc.buildingId) continue
  byBuilding.set(loc.buildingId, [...(byBuilding.get(loc.buildingId) || []), loc])
}

for (const [buildingId, locs] of byBuilding) {
  const hasEntry = locs.some((l) => l.type === 'Entry' || l.type === 'Lobby')
  if (hasEntry) continue
  const floorsHere = [...new Set(locs.map((l) => l.floorId).filter(Boolean))]
  const floorMeta = floorsHere
    .map((id) => floors.find((f) => f.id === id))
    .filter(Boolean)
    .sort((a, b) => (a.level ?? 99) - (b.level ?? 99))
  const preferFloorId = floorMeta[0]?.id || locs[0]?.floorId
  const pool = locs.filter((l) => l.floorId === preferFloorId)
  const use = pool.length ? pool : locs
  const mid = {
    latitude: use.reduce((s, l) => s + Number(l.latitude || 0), 0) / use.length,
    longitude: use.reduce((s, l) => s + Number(l.longitude || 0), 0) / use.length,
  }
  const pick = [...use].sort((a, b) => haversineMeters(mid, a) - haversineMeters(mid, b))[0]
  if (!pick) continue
  pick.type = 'Entry'
  const name = /entry|lobby|door/i.test(pick.name) ? pick.name : `${pick.name} · Entry`
  console.log(`promote Entry hub ${pick.id} in building ${buildingId}`)
  await writeOne('locations', pick.id, { type: 'Entry', mapped: true, name })
  stats.promotedToEntry += 1
}

console.log('DONE', stats)
process.exit(0)
