/** Feature flags from Vite env (set by DeployCDCI → ERP_Full/.env.local) */

export function isFirebaseEnabled(): boolean {
  return String(import.meta.env.VITE_USE_FIREBASE || '').toLowerCase() === 'true'
}

export function getFirebaseWebConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
      ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string }
      : {}),
  }
}

export function assertFirebaseConfig() {
  const cfg = getFirebaseWebConfig()
  const missing = Object.entries(cfg)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(`Missing Firebase web config: ${missing.join(', ')}. Run DeployCDCI setup.`)
  }
  return cfg
}
