/**
 * TEMPORARY — peek data from both DBs (delete when done).
 *
 * A) keiros-erp Cloud Firestore  → REST + service account JWT
 * B) keriosa Realtime Database   → public REST (rules currently open)
 *
 * Run:
 *   node temp-dual-db-peek.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'
import https from 'node:https'

// TEMP only: corporate TLS MITM breaks Node cert verify on this PC.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const insecureAgent = new https.Agent({ rejectUnauthorized: false })

const RTDB_URL = 'https://keriosa-default-rtdb.firebaseio.com'
const SA_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  'C:\\Users\\sdnil\\Downloads\\keiros-erp-firebase-adminsdk-fbsvc-3458fd48df.json'

const FIRESTORE_COLLECTIONS = [
  'organizations',
  'complexes',
  'buildings',
  'floors',
  'locations',
  'users',
  'dashboard_kpis',
  'alerts',
  'tours',
  'api_clients',
]

function banner(title) {
  console.log('\n' + '='.repeat(72))
  console.log(title)
  console.log('='.repeat(72))
}

function preview(value, max = 1000) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (s.length <= max) return s
  return s.slice(0, max) + `\n… (${s.length - max} more chars truncated)`
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const unsigned = `${header}.${claim}`
  const sign = createSign('RSA-SHA256')
  sign.update(unsigned)
  sign.end()
  const signature = b64url(sign.sign(sa.private_key))
  const assertion = `${unsigned}.${signature}`

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString()
  const json = await fetchJson(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body,
  })
  return json.access_token
}

/** Convert Firestore REST field values → plain JS */
function decodeValue(v) {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('timestampValue' in v) return v.timestampValue
  if ('geoPointValue' in v) return v.geoPointValue
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in v) {
    const out = {}
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      out[k] = decodeValue(val)
    }
    return out
  }
  if ('referenceValue' in v) return v.referenceValue
  return v
}

function docToPlain(doc) {
  const id = doc.name?.split('/').pop()
  const fields = {}
  for (const [k, v] of Object.entries(doc.fields || {})) {
    fields[k] = decodeValue(v)
  }
  return { id, ...fields }
}

async function fetchJson(url, opts = {}) {
  // Prefer https module so we can pass rejectUnauthorized:false reliably
  if (url.startsWith('https://')) {
    const { method = 'GET', headers = {}, body } = opts
    const text = await new Promise((resolve, reject) => {
      const u = new URL(url)
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method,
          headers,
          agent: insecureAgent,
        },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode} ${url}\n${data.slice(0, 300)}`))
            } else {
              resolve(data)
            }
          })
        },
      )
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
    return text ? JSON.parse(text) : null
  }
  const res = await fetch(url, opts)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function peekFirestore() {
  banner('A) keiros-erp — Cloud Firestore (REST)')

  if (!existsSync(SA_PATH)) {
    console.error(`Missing SA JSON: ${SA_PATH}`)
    return
  }
  const sa = JSON.parse(readFileSync(SA_PATH, 'utf8'))
  console.log(`Project: ${sa.project_id}`)
  console.log(`SA:      ${sa.client_email}`)

  const token = await getAccessToken(sa)
  console.log('Auth:    access token OK')

  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`

  for (const name of FIRESTORE_COLLECTIONS) {
    try {
      const url = `${base}/${encodeURIComponent(name)}?pageSize=3`
      const data = await fetchJson(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const docs = data?.documents || []
      console.log(`\n[${name}] sample≤3: ${docs.length}`)
      if (!docs.length) {
        console.log('  (empty or missing)')
        continue
      }
      for (const doc of docs) {
        console.log('  —', preview(docToPlain(doc), 380).replace(/\n/g, '\n    '))
      }
    } catch (err) {
      console.log(`\n[${name}] ERROR: ${err.message.split('\n')[0]}`)
    }
  }
}

async function peekRtdb() {
  banner('B) keriosa — Realtime Database (REST, public rules)')
  console.log(`URL: ${RTDB_URL}`)

  const shallow = await fetchJson(`${RTDB_URL}/.json?shallow=true`)
  console.log('\nRoot keys (shallow):')
  console.log(preview(shallow, 800))

  const liveShallow = await fetchJson(`${RTDB_URL}/keiros/live.json?shallow=true`)
  const liveKeys = liveShallow && typeof liveShallow === 'object' ? Object.keys(liveShallow) : []
  console.log(`\nkeiros/live children: ${liveKeys.length}`)
  if (liveKeys.length) {
    console.log('  sample keys:', liveKeys.slice(0, 8).join(', '))
    const sampleKey = liveKeys[0]
    const sample = await fetchJson(
      `${RTDB_URL}/keiros/live/${encodeURIComponent(sampleKey)}.json`,
    )
    console.log(`\nSample live/${sampleKey}:`)
    console.log(preview(sample, 900))
  } else {
    console.log('  (no live children, or null)')
  }

  const locked = await fetchJson(`${RTDB_URL}/keiros/locked.json?shallow=true`)
  const lockedKeys =
    locked && typeof locked === 'object'
      ? Object.keys(locked).sort().reverse()
      : []
  console.log(`\nkeiros/locked children: ${lockedKeys.length}`)
  if (lockedKeys.length) {
    console.log('  newest keys:', lockedKeys.slice(0, 5).join(', '))
    const newest = lockedKeys[0]
    const sample = await fetchJson(
      `${RTDB_URL}/keiros/locked/${encodeURIComponent(newest)}.json`,
    )
    console.log(`\nSample locked/${newest}:`)
    console.log(preview(sample, 900))
  } else {
    console.log('  (no locked children, or null)')
  }
}

async function main() {
  console.log('TEMP dual-DB peek — keiros-erp Firestore + keriosa RTDB')
  console.log(`Time: ${new Date().toISOString()}`)

  try {
    await peekFirestore()
  } catch (err) {
    console.error('\nFirestore peek failed:', err.message)
  }

  try {
    await peekRtdb()
  } catch (err) {
    console.error('\nRTDB peek failed:', err.message)
  }

  banner('Done (temporary script — safe to delete: temp-dual-db-peek.mjs)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
