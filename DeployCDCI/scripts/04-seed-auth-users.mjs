import fs from 'node:fs'
import { SAMPLE_DATA_PATH, loadEnv, log, requireEnv } from './lib/paths.mjs'
import { getAuth } from './lib/firebaseAdmin.mjs'

loadEnv()
requireEnv(['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_DEFAULT_USER_PASSWORD'])

const auth = getAuth()
const adminEmail = process.env.SEED_ADMIN_EMAIL.trim().toLowerCase()
const adminPassword = process.env.SEED_ADMIN_PASSWORD
const defaultPassword = process.env.SEED_DEFAULT_USER_PASSWORD

async function upsertUser({ email, password, displayName, uidHint }) {
  const normalized = email.trim().toLowerCase()
  try {
    const existing = await auth.getUserByEmail(normalized)
    await auth.updateUser(existing.uid, {
      password,
      displayName: displayName || existing.displayName,
      emailVerified: true,
      disabled: false,
    })
    log('auth', `updated ${normalized}`)
    return existing.uid
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
    const created = await auth.createUser({
      uid: uidHint && /^[a-zA-Z0-9]{1,128}$/.test(uidHint) ? uidHint : undefined,
      email: normalized,
      password,
      displayName,
      emailVerified: true,
      disabled: false,
    })
    log('auth', `created ${normalized}`)
    return created.uid
  }
}

async function main() {
  await upsertUser({
    email: adminEmail,
    password: adminPassword,
    displayName: 'Keiros Admin',
    uidHint: 'usr-admin',
  })

  if (!fs.existsSync(SAMPLE_DATA_PATH)) {
    log('auth', 'No sample-data.json — admin only')
    return
  }

  const payload = JSON.parse(fs.readFileSync(SAMPLE_DATA_PATH, 'utf8'))
  const users = payload.collections.users
  if (!Array.isArray(users)) {
    log('auth', 'No users array in sample data')
    return
  }

  let n = 0
  for (const user of users) {
    if (!user?.email) continue
    const email = String(user.email).toLowerCase()
    if (email === adminEmail) continue
    // Skip clearly fictional locked/demo-only patterns if desired — seed all Active users
    try {
      await upsertUser({
        email,
        password: defaultPassword,
        displayName: user.name || email,
        uidHint: user.id,
      })
      n += 1
    } catch (err) {
      console.warn(`[auth] skip ${email}: ${err.message}`)
    }
  }

  log('auth', `Seeded ${n} ERP users (+ admin). Default password: ${defaultPassword}`)
  log('auth', `Admin login: ${adminEmail} / (SEED_ADMIN_PASSWORD)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
