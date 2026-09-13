import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { assertFirebaseConfig, isFirebaseEnabled } from './config'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseEnabled()) {
    throw new Error('Firebase is disabled (VITE_USE_FIREBASE!=true)')
  }
  if (!app) {
    const cfg = assertFirebaseConfig()
    app = getApps().length ? getApps()[0]! : initializeApp(cfg)
  }
  return app
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp())
  return auth
}

export function getFirestoreDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp())
  return db
}
