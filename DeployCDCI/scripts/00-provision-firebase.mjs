/**
 * Provision Firebase project services that the Console wizard normally does:
 * - Enable required Google Cloud APIs
 * - Create Firestore database (default)
 * - Enable Authentication Email/Password
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (service account with Editor
 * or Firebase Admin + Service Usage Admin).
 */
import { GoogleAuth } from 'google-auth-library'
import { loadEnv, log, requireEnv } from './lib/paths.mjs'

loadEnv()
requireEnv(['FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIRESTORE_LOCATION'])

const projectId = process.env.FIREBASE_PROJECT_ID
const location = process.env.FIRESTORE_LOCATION || 'asia-south1'
const skip = String(process.env.PROVISION_FIREBASE || 'true').toLowerCase() === 'false'

async function getClient() {
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  return auth.getClient()
}

async function request(client, method, url, body) {
  const res = await client.request({
    method,
    url,
    data: body,
    validateStatus: () => true,
  })
  return res
}

async function enableApis(client) {
  const apis = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'firebase.googleapis.com',
    'cloudresourcemanager.googleapis.com',
  ]
  for (const api of apis) {
    const name = `projects/${projectId}/services/${api}`
    const url = `https://serviceusage.googleapis.com/v1/${name}:enable`
    const res = await request(client, 'POST', url, {})
    if (res.status === 200 || res.status === 201) {
      log('provision', `Enabled API ${api}`)
    } else if (res.status === 400 && /already enabled/i.test(JSON.stringify(res.data))) {
      log('provision', `API already enabled: ${api}`)
    } else if (res.status === 409) {
      log('provision', `API already enabled: ${api}`)
    } else if (res.status === 200 || (res.data && res.data.name)) {
      log('provision', `Enable requested: ${api} (operation started)`)
    } else {
      log('provision', `API ${api} status ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`)
    }
  }
  // brief wait for enable operations
  await new Promise((r) => setTimeout(r, 4000))
}

async function ensureFirestore(client) {
  const dbName = `projects/${projectId}/databases/(default)`
  const getUrl = `https://firestore.googleapis.com/v1/${dbName}`
  const getRes = await request(client, 'GET', getUrl)
  if (getRes.status === 200) {
    log('provision', `Firestore already exists (${getRes.data?.locationId || 'ok'})`)
    return
  }

  const createUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`
  const createRes = await request(client, 'POST', createUrl, {
    locationId: location,
    type: 'FIRESTORE_NATIVE',
    concurrencyMode: 'PESSIMISTIC',
  })

  if (createRes.status === 200 || createRes.status === 201) {
    log('provision', `Firestore create started in ${location}`)
    // wait for DB ready
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const check = await request(client, 'GET', getUrl)
      if (check.status === 200) {
        log('provision', 'Firestore is ready')
        return
      }
      log('provision', `Waiting for Firestore… (${i + 1}/30)`)
    }
    throw new Error('Firestore create timed out — check Console → Firestore')
  }

  if (createRes.status === 409) {
    log('provision', 'Firestore already exists (409)')
    return
  }

  throw new Error(`Firestore create failed (${createRes.status}): ${JSON.stringify(createRes.data)}`)
}

async function enableEmailPassword(client) {
  // Identity Platform / Identity Toolkit project config
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`
  const getRes = await request(client, 'GET', configUrl)

  const updateUrl = `${configUrl}?updateMask=signIn.email`
  const body = {
    signIn: {
      email: {
        enabled: true,
        passwordRequired: true,
      },
    },
  }

  // Prefer PATCH; some projects need POST to initialize Identity Toolkit first
  let res = await request(client, 'PATCH', updateUrl, body)
  if (res.status >= 400) {
    // Initialize Identity Toolkit / Firebase Auth if needed
    const initUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/identityPlatform:initializeAuth`
    await request(client, 'POST', initUrl, {})
    res = await request(client, 'PATCH', updateUrl, body)
  }

  if (res.status >= 200 && res.status < 300) {
    log('provision', 'Email/Password authentication enabled')
    return
  }

  // Fallback: Firebase Auth config via Identity Toolkit legacy
  const legacyUrl = `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/config?updateMask=signIn.email`
  const legacy = await request(client, 'PATCH', legacyUrl, body)
  if (legacy.status >= 200 && legacy.status < 300) {
    log('provision', 'Email/Password authentication enabled (legacy API)')
    return
  }

  throw new Error(
    `Failed to enable Email/Password (${res.status}): ${JSON.stringify(res.data)}\n` +
      `Legacy: (${legacy.status}) ${JSON.stringify(legacy.data)}\n` +
      `Prior GET: (${getRes.status})`,
  )
}

async function main() {
  if (skip) {
    log('provision', 'Skipped (PROVISION_FIREBASE=false)')
    return
  }

  log('provision', `Project ${projectId} · location ${location}`)
  try {
    const client = await getClient()
    await enableApis(client)
    await ensureFirestore(client)
    await enableEmailPassword(client)
    log('provision', 'Done — Auth Email/Password + Firestore ready')
  } catch (err) {
    const msg = String(err?.message || err)
    if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('SERVICE_DISABLED')) {
      console.error(`
[provision] Service account cannot enable APIs / create Firestore automatically.
Do these once in Console (you are logged in as project Owner), then re-run:

  1) Create Firestore
     https://console.firebase.google.com/project/keiros-erp/firestore
     → Create database → production mode → location asia-south1 (or your region)

  2) Enable Email/Password Auth
     https://console.firebase.google.com/project/keiros-erp/authentication/providers
     → Email/Password → Enable → Save

  3) (Optional) Grant the service account "Service Usage Admin" + "Firebase Admin"
     so future provision runs are fully automated.

Then:
  cd f:\\KeirosPhase2All\\DeployCDCI
  $env:NODE_TLS_REJECT_UNAUTHORIZED='0'
  npm run setup
`)
    }
    throw err
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
