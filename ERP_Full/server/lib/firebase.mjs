import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import admin from 'firebase-admin'
import { localSeedRows } from './localSeed.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(__dirname, '..')
const erpRoot = resolve(serverRoot, '..')
const deployEnv = resolve(erpRoot, '..', 'DeployCDCI', '.env')

dotenv.config({ path: resolve(serverRoot, '.env') })
if (existsSync(deployEnv)) dotenv.config({ path: deployEnv, override: false })

if (process.env.FIRESTORE_PREFER_REST === 'true') {
  process.env.FIRESTORE_PREFER_REST = 'true'
}

/** When Firestore is quota-limited, serve ERP seed data + in-memory writes. */
const FORCE_LOCAL = String(process.env.FIRESTORE_LOCAL_FALLBACK || '').toLowerCase() === 'true'
let useLocalFallback = FORCE_LOCAL
const memory = new Map() // collection -> Map(id -> row)

let app
let warnedFallback = false

function noteFallback(reason) {
  if (!useLocalFallback) {
    useLocalFallback = true
    console.warn(`[firebase] switching to local seed fallback: ${reason}`)
  } else if (!warnedFallback) {
    warnedFallback = true
    console.warn(`[firebase] using local seed fallback (${reason})`)
  }
}

function isQuotaError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  const code = err?.code
  return code === 8 || /quota exceeded/i.test(msg)
}

function memStore(collection) {
  if (!memory.has(collection)) {
    const rows = localSeedRows(collection)
    const map = new Map()
    for (const row of rows) {
      const id = String(row.id ?? '')
      if (id) map.set(id, row)
    }
    memory.set(collection, map)
  }
  return memory.get(collection)
}

export function getAdmin() {
  if (app) return app
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath || !existsSync(credPath)) {
    noteFallback('missing GOOGLE_APPLICATION_CREDENTIALS')
    return null
  }
  const sa = JSON.parse(readFileSync(credPath, 'utf8'))
  app = admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: process.env.FIREBASE_PROJECT_ID || sa.project_id,
  })
  return app
}

export function getDb() {
  const adminApp = getAdmin()
  if (!adminApp) return null
  return adminApp.firestore()
}

export function isUsingLocalFallback() {
  return useLocalFallback
}

export async function loadCollection(name) {
  if (useLocalFallback) {
    return [...memStore(name).values()]
  }

  const db = getDb()
  if (!db) {
    noteFallback('no firestore client')
    return [...memStore(name).values()]
  }

  try {
    const snap = await db.collection(name).limit(5000).get()
    const rows = snap.docs.map((d) => {
      const data = d.data()
      const { _seededAt, _updatedAt, ...rest } = data
      return { ...rest, id: String(rest.id ?? d.id) }
    })
    // warm memory cache for seamless fallback later
    const map = new Map()
    for (const row of rows) map.set(String(row.id), row)
    memory.set(name, map)
    return rows
  } catch (err) {
    if (isQuotaError(err)) {
      noteFallback(`quota exceeded reading ${name}`)
      return [...memStore(name).values()]
    }
    throw err
  }
}

export async function upsert(collection, id, data) {
  const payload = { ...data, id, _updatedAt: new Date().toISOString() }
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) delete payload[k]
  }

  // always mirror in memory
  memStore(collection).set(String(id), { ...payload })

  if (useLocalFallback) {
    return payload
  }

  const db = getDb()
  if (!db) {
    noteFallback('no firestore client on write')
    return payload
  }

  try {
    await db.collection(collection).doc(id).set(payload, { merge: true })
  } catch (err) {
    if (isQuotaError(err)) {
      noteFallback(`quota exceeded writing ${collection}`)
      return payload
    }
    throw err
  }
  return payload
}
