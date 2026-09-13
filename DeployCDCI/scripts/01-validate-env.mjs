import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, requireEnv, ROOT, log } from './lib/paths.mjs'

loadEnv()

const required = [
  'FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'SEED_DEFAULT_USER_PASSWORD',
]

requireEnv(required)

const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!fs.existsSync(cred)) {
  throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file missing: ${cred}`)
}

const sa = JSON.parse(fs.readFileSync(cred, 'utf8'))
if (sa.project_id && sa.project_id !== process.env.FIREBASE_PROJECT_ID) {
  console.warn(
    `[warn] Service account project_id (${sa.project_id}) != FIREBASE_PROJECT_ID (${process.env.FIREBASE_PROJECT_ID})`,
  )
}

if (process.env.VITE_FIREBASE_PROJECT_ID !== process.env.FIREBASE_PROJECT_ID) {
  throw new Error('VITE_FIREBASE_PROJECT_ID must match FIREBASE_PROJECT_ID')
}

log('validate', `OK — project ${process.env.FIREBASE_PROJECT_ID}`)
log('validate', `Service account: ${path.basename(cred)}`)
log('validate', `Admin user: ${process.env.SEED_ADMIN_EMAIL}`)
log('validate', `Env file: ${path.join(ROOT, '.env')}`)
