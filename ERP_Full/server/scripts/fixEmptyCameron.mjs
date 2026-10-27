/**
 * Minimal quota-safe repairs (known empty duplicate + Entry→Unit for dwellings).
 *   node scripts/fixEmptyCameron.mjs
 */
import admin from 'firebase-admin'
import { readFileSync } from 'node:fs'

process.env.FIRESTORE_PREFER_REST = 'true'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const sa = JSON.parse(
  readFileSync('C:/Users/sdnil/Downloads/keiros-erp-firebase-adminsdk-fbsvc-3458fd48df.json', 'utf8'),
)
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id })
const db = admin.firestore()

function looksLikeDwelling(label) {
  return /\b(unit|suite|apt\.?|apartment)\s*[#-]?\s*[a-z0-9-]+\b/i.test(String(label || ''))
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function retry(fn, label) {
  for (let i = 0; i < 12; i++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!/quota|resource.?exhausted|code:?\s*8/i.test(msg) && err?.code !== 8) throw err
      const wait = Math.min(180000, 15000 * (i + 1))
      console.warn(`${label}: quota, wait ${Math.round(wait / 1000)}s`)
      await sleep(wait)
    }
  }
  throw new Error(`${label} failed after retries`)
}

console.log('Wait 60s…')
await sleep(60000)

const EMPTY_COMPLEX = 'cpx-1793030264077'
console.log('Delete empty Cameron Crossing', EMPTY_COMPLEX)
await retry(() => db.collection('complexes').doc(EMPTY_COMPLEX).delete(), 'delete complex')
try {
  await retry(() => db.collection('site_properties').doc(EMPTY_COMPLEX).delete(), 'delete site_prop')
} catch {
  /* may not exist */
}

console.log('Scan Entry locations…')
let last = null
let retyped = 0
let promotedBuildings = new Set()
const byBuilding = new Map()

for (let page = 0; page < 40; page++) {
  const snap = await retry(async () => {
    let q = db.collection('locations').where('type', '==', 'Entry').orderBy(admin.firestore.FieldPath.documentId()).limit(40)
    if (last) q = q.startAfter(last)
    return q.get()
  }, `entries page ${page + 1}`)
  if (snap.empty) break
  for (const doc of snap.docs) {
    const data = doc.data()
    const loc = { id: doc.id, ...data }
    if (looksLikeDwelling(loc.name)) {
      await retry(
        () => doc.ref.set({ type: 'Unit', mapped: true }, { merge: true }),
        `retype ${doc.id}`,
      )
      retyped += 1
      console.log('Unit ← Entry', loc.name)
      loc.type = 'Unit'
    }
    if (loc.buildingId) {
      byBuilding.set(loc.buildingId, [...(byBuilding.get(loc.buildingId) || []), loc])
    }
  }
  last = snap.docs[snap.docs.length - 1]
  await sleep(800)
  if (snap.size < 40) break
}

// Also load non-Entry for buildings that lost all portals — light pass: query Unit count per building from byBuilding only for buildings we touched
// Promote one hub per building that has zero Entry left among scanned set — incomplete.
// Full promote: for each buildingId in byBuilding, if no Entry remains, promote nearest Unit.
for (const [buildingId, locs] of byBuilding) {
  if (locs.some((l) => l.type === 'Entry' || l.type === 'Lobby')) continue
  const units = locs.filter((l) => l.type === 'Unit')
  if (!units.length) continue
  const mid = {
    latitude: units.reduce((s, l) => s + Number(l.latitude || 0), 0) / units.length,
    longitude: units.reduce((s, l) => s + Number(l.longitude || 0), 0) / units.length,
  }
  const pick = [...units].sort((a, b) => {
    const da = (a.latitude - mid.latitude) ** 2 + (a.longitude - mid.longitude) ** 2
    const db = (b.latitude - mid.latitude) ** 2 + (b.longitude - mid.longitude) ** 2
    return da - db
  })[0]
  await retry(
    () =>
      db
        .collection('locations')
        .doc(pick.id)
        .set(
          {
            type: 'Entry',
            mapped: true,
            name: /entry/i.test(pick.name) ? pick.name : `${pick.name} · Entry`,
          },
          { merge: true },
        ),
    `promote ${pick.id}`,
  )
  promotedBuildings.add(buildingId)
  console.log('Entry hub', buildingId, pick.name)
  await sleep(200)
}

console.log('DONE', { retyped, promoted: promotedBuildings.size })
process.exit(0)
