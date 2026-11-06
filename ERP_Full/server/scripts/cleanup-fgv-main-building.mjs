/**
 * One-shot: label-driven Firebase cleanup for Fig Garden Village · Main Building.
 * Run: node scripts/cleanup-fgv-main-building.mjs
 */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import {
  enrichLocation,
  inferLocationType,
  isStairish,
  shortLocationName,
} from '../lib/locationLabels.mjs'

const CRED =
  process.env.CRED ||
  'C:\\Users\\sdnil\\Downloads\\keiros-erp-firebase-adminsdk-fbsvc-3458fd48df.json'
const BLD = 'bld-1793890775603'
const CX = 'cpx-1793890493596'

process.env.FIRESTORE_PREFER_REST = 'true'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const sa = JSON.parse(readFileSync(CRED, 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id })
const db = admin.firestore()

function distM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)))
}

const [buildingSnap, floorSnap, locSnap] = await Promise.all([
  db.collection('buildings').doc(BLD).get(),
  db.collection('floors').where('buildingId', '==', BLD).get(),
  db.collection('locations').where('buildingId', '==', BLD).get(),
])

if (!buildingSnap.exists) {
  console.error('Main Building not found')
  process.exit(1)
}

const locs = locSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
const center = {
  latitude: locs.reduce((s, l) => s + Number(l.latitude), 0) / locs.length,
  longitude: locs.reduce((s, l) => s + Number(l.longitude), 0) / locs.length,
}

const L01 = floorSnap.docs.find((d) => d.data().label === 'L01')
const L02 = floorSnap.docs.find((d) => d.data().label === 'L02')
const stairFloors = floorSnap.docs.filter((d) => /stair/i.test(String(d.data().label || '')))

const batch = db.batch()
const changes = []

// Floors: normalize stair mid-level between L01 and L02.
if (L01) {
  batch.set(L01.ref, { level: 1, label: 'L01', _updatedAt: new Date().toISOString() }, { merge: true })
}
if (L02) {
  batch.set(L02.ref, { level: 2, label: 'L02', _updatedAt: new Date().toISOString() }, { merge: true })
}
for (const f of stairFloors) {
  batch.set(
    f.ref,
    {
      label: 'Stairs',
      level: 1.5,
      _updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
  changes.push({ floor: f.id, label: 'Stairs', level: 1.5 })
}

for (const loc of locs) {
  const enriched = enrichLocation(loc)
  const type = inferLocationType(loc)
  const short = shortLocationName(loc.name)
  const outlier = distM(center, loc) > 55 && type !== 'Unit' && type !== 'Room'
  const patch = {
    type,
    name: short,
    labelSourceName: loc.name,
    physicalAddress: loc.physicalAddress || loc.name,
    mapped: outlier ? false : loc.mapped !== false,
    _labelEnrichedAt: new Date().toISOString(),
    _updatedAt: new Date().toISOString(),
  }

  // Keep stair mid-landings on a Stairs floor when labeled as stair turns.
  if (isStairish(loc) && /turn|mid|landing/i.test(loc.name) && !/top|start/i.test(loc.name)) {
    const mid = stairFloors[0]
    if (mid) {
      patch.floorId = mid.id
      patch.floorLabel = 'Stairs'
    }
  }
  if (isStairish(loc) && /start|bottom|base/i.test(loc.name) && L01) {
    patch.floorId = L01.id
    patch.floorLabel = 'L01'
  }
  if (isStairish(loc) && /top|upper/i.test(loc.name) && L02) {
    patch.floorId = L02.id
    patch.floorLabel = 'L02'
  }
  if (type === 'Unit' && L02 && /202/.test(loc.name)) {
    patch.floorId = L02.id
    patch.floorLabel = 'L02'
  }
  if (type === 'Entry' && L01) {
    patch.floorId = L01.id
    patch.floorLabel = 'L01'
  }

  batch.set(db.collection('locations').doc(loc.id), patch, { merge: true })
  changes.push({
    id: loc.id,
    from: { name: loc.name, type: loc.type, floor: loc.floorLabel, mapped: loc.mapped },
    to: {
      name: short,
      type,
      floor: patch.floorLabel || loc.floorLabel,
      mapped: patch.mapped,
      outlier,
    },
  })
}

batch.set(
  buildingSnap.ref,
  {
    floors: 2,
    mappedFloors: 2,
    _updatedAt: new Date().toISOString(),
    _labelEnrichedAt: new Date().toISOString(),
  },
  { merge: true },
)

await batch.commit()
console.log(
  JSON.stringify(
    {
      complexId: CX,
      buildingId: BLD,
      updatedLocations: changes.length,
      changes,
    },
    null,
    2,
  ),
)
process.exit(0)
