import fs from 'node:fs'
import {
  SAMPLE_DATA_PATH,
  loadEnv,
  log,
  readCollectionsConfig,
} from './lib/paths.mjs'
import { getDb } from './lib/firebaseAdmin.mjs'

loadEnv()

if (!fs.existsSync(SAMPLE_DATA_PATH)) {
  throw new Error(`Missing ${SAMPLE_DATA_PATH} — run npm run export-data first`)
}

const clear = String(process.env.CLEAR_COLLECTIONS_BEFORE_SEED || 'false').toLowerCase() === 'true'
const cfg = readCollectionsConfig()
const payload = JSON.parse(fs.readFileSync(SAMPLE_DATA_PATH, 'utf8'))
const db = getDb()

async function deleteCollection(name) {
  const snap = await db.collection(name).limit(400).get()
  if (snap.empty) return 0
  const batch = db.batch()
  snap.docs.forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
  return snap.size + (await deleteCollection(name))
}

async function writeBatchDocs(collectionName, docs) {
  const chunkSize = 400
  let written = 0
  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize)
    const batch = db.batch()
    for (const doc of chunk) {
      const id = String(doc.id ?? `${collectionName}-${i}`)
      const ref = db.collection(collectionName).doc(id)
      batch.set(ref, { ...doc, _seededAt: new Date().toISOString() }, { merge: true })
    }
    await batch.commit()
    written += chunk.length
  }
  return written
}

async function main() {
  const ordered = [...cfg.collections].sort((a, b) => a.order - b.order)
  let total = 0

  for (const entry of ordered) {
    const raw = payload.collections[entry.firestore]
    if (raw === undefined) {
      log('seed', `skip ${entry.firestore} (no export)`)
      continue
    }

    if (clear) {
      const deleted = await deleteCollection(entry.firestore)
      if (deleted) log('seed', `cleared ${entry.firestore}: ${deleted} docs`)
    }

    if (entry.singletonDocId) {
      const ref = db.collection(entry.firestore).doc(entry.singletonDocId)
      await ref.set({ ...raw, id: entry.singletonDocId, _seededAt: new Date().toISOString() }, { merge: true })
      log('seed', `${entry.firestore}/${entry.singletonDocId}`)
      total += 1
      continue
    }

    if (!Array.isArray(raw)) {
      log('seed', `skip ${entry.firestore} (not an array)`)
      continue
    }

    const count = await writeBatchDocs(entry.firestore, raw)
    log('seed', `${entry.firestore}: ${count} docs`)
    total += count
  }

  await db.collection(cfg.metaCollection).doc('schema').set(
    {
      id: 'schema',
      version: 1,
      seededAt: new Date().toISOString(),
      source: payload.source,
      exportedAt: payload.exportedAt,
      collections: ordered.map((c) => ({
        name: c.firestore,
        exportName: c.exportName,
        order: c.order,
      })),
      notes:
        'Firestore is schemaless; this document records the Keiros collection map from DeployCDCI.',
    },
    { merge: true },
  )

  await db.collection(cfg.metaCollection).doc('erp_settings').set(
    {
      id: 'erp_settings',
      codePrefixFormat: '{PROP}-{CITY}-{YEAR}',
      defaultCodeExpiryDays: 365,
      allowCodeReuse: false,
      sessionTimeoutMin: 30,
      dwellThresholdMin: 5,
      anonymizeDeviceIds: true,
      apiRateLimitPerMin: 1200,
      apiBurstLimit: 200,
      keyRotationDays: 90,
      defaultSender: 'alerts@keiros.ai',
      ersWebhookUrl: 'https://ers.keiros.ai/hook/demo',
      digestFrequency: 'daily',
      _seededAt: new Date().toISOString(),
    },
    { merge: true },
  )

  log('seed', `Done — ${total} documents + _meta/schema + _meta/erp_settings`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
