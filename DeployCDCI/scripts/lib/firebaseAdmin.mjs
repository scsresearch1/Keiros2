import fs from 'node:fs'
import admin from 'firebase-admin'
import { requireEnv } from './paths.mjs'

let initialized = false

export function initAdmin() {
  if (initialized) return admin.app()

  requireEnv(['FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS'])
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!fs.existsSync(credPath)) {
    throw new Error(`Service account file not found: ${credPath}`)
  }

  // Corporate networks often block Firestore gRPC — prefer HTTPS REST.
  process.env.FIRESTORE_PREFER_REST = process.env.FIRESTORE_PREFER_REST || 'true'

  const sa = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  admin.initializeApp({
    credential: admin.credential.cert(sa),
    projectId: process.env.FIREBASE_PROJECT_ID,
  })
  initialized = true
  return admin.app()
}

export function getDb() {
  initAdmin()
  return admin.firestore()
}

export function getAuth() {
  initAdmin()
  return admin.auth()
}
