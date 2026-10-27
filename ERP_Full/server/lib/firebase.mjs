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

/** When true, never call Firestore (explicit ops mode). */
const FORCE_LOCAL = String(process.env.FIRESTORE_LOCAL_FALLBACK || '').toLowerCase() === 'true'
/** How long to serve cache/seed after a quota error before retrying Firestore. */
const QUOTA_COOLDOWN_MS = Number(process.env.FIRESTORE_QUOTA_COOLDOWN_MS || 60_000)

let useLocalFallback = FORCE_LOCAL
let fallbackUntil = 0
let firestoreWarmed = false
const memory = new Map() // collection -> Map(id -> row)
const fromFirestore = new Set() // collections last filled from Firestore

let app
let warnedFallback = false

function noteFallback(reason) {
  useLocalFallback = true
  fallbackUntil = Date.now() + QUOTA_COOLDOWN_MS
  if (!warnedFallback) {
    warnedFallback = true
    console.warn(`[firebase] temporary local fallback: ${reason} (retry Firestore after ${QUOTA_COOLDOWN_MS}ms)`)
  } else {
    console.warn(`[firebase] fallback still active: ${reason}`)
  }
}

function clearFallback() {
  if (useLocalFallback && !FORCE_LOCAL) {
    useLocalFallback = false
    warnedFallback = false
    console.info('[firebase] restored Firestore reads')
  }
}

function isQuotaError(err) {
  const msg = err instanceof Error ? err.message : String(err)
  const code = err?.code
  return code === 8 || /quota exceeded|resource.?exhausted/i.test(msg)
}

function seedStore(collection) {
  const rows = localSeedRows(collection)
  const map = new Map()
  for (const row of rows) {
    const id = String(row.id ?? '')
    if (id) map.set(id, row)
  }
  memory.set(collection, map)
  fromFirestore.delete(collection)
  return map
}

function memStore(collection) {
  if (!memory.has(collection)) return seedStore(collection)
  return memory.get(collection)
}

function cachedRows(collection) {
  if (memory.has(collection) && fromFirestore.has(collection)) {
    return [...memory.get(collection).values()]
  }
  return [...memStore(collection).values()]
}

export function getAdmin() {
  if (app) return app

  let sa = null
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  if (inline) {
    try {
      sa = JSON.parse(inline)
    } catch {
      try {
        sa = JSON.parse(Buffer.from(inline, 'base64').toString('utf8'))
      } catch {
        noteFallback('invalid FIREBASE_SERVICE_ACCOUNT_JSON')
        return null
      }
    }
  } else {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (!credPath || !existsSync(credPath)) {
      noteFallback('missing GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON')
      return null
    }
    sa = JSON.parse(readFileSync(credPath, 'utf8'))
  }

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
  return FORCE_LOCAL || (useLocalFallback && Date.now() < fallbackUntil)
}

export function dataSourceLabel() {
  if (FORCE_LOCAL) return 'local-seed'
  if (useLocalFallback && Date.now() < fallbackUntil) {
    return firestoreWarmed ? 'firestore-cache' : 'local-seed'
  }
  return firestoreWarmed ? 'firestore' : 'firestore'
}

export async function loadCollection(name) {
  if (FORCE_LOCAL) {
    return [...memStore(name).values()]
  }

  const now = Date.now()
  const cooling = useLocalFallback && now < fallbackUntil
  if (cooling) {
    return cachedRows(name)
  }

  const db = getDb()
  if (!db) {
    noteFallback('no firestore client')
    return cachedRows(name)
  }

  try {
    const snap = await db.collection(name).limit(5000).get()
    const rows = snap.docs.map((d) => {
      const data = d.data()
      const { _seededAt, _updatedAt, ...rest } = data
      return { ...rest, id: String(rest.id ?? d.id) }
    })
    const map = new Map()
    for (const row of rows) map.set(String(row.id), row)
    memory.set(name, map)
    fromFirestore.add(name)
    firestoreWarmed = true
    clearFallback()
    return rows
  } catch (err) {
    if (isQuotaError(err)) {
      noteFallback(`quota exceeded reading ${name}`)
      return cachedRows(name)
    }
    throw err
  }
}

export async function upsert(collection, id, data) {
  const payload = { ...data, id, _updatedAt: new Date().toISOString() }
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) delete payload[k]
  }

  memStore(collection).set(String(id), { ...payload })
  if (fromFirestore.has(collection) || firestoreWarmed) {
    fromFirestore.add(collection)
  }

  if (FORCE_LOCAL || (useLocalFallback && Date.now() < fallbackUntil)) {
    return payload
  }

  const db = getDb()
  if (!db) {
    noteFallback('no firestore client on write')
    return payload
  }

  try {
    await db.collection(collection).doc(id).set(payload, { merge: true })
    clearFallback()
  } catch (err) {
    if (isQuotaError(err)) {
      noteFallback(`quota exceeded writing ${collection}`)
      return payload
    }
    throw err
  }
  return payload
}
