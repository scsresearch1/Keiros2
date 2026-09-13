import type { ReactNode } from 'react'
import { ErpDataProvider, useErpData } from '../data/ErpDataProvider'

export function FirebaseBootGate({ children }: { children: ReactNode }) {
  const { ready, loading, error, source } = useErpData()

  // Only gate the *initial* boot. Background refreshes must not unmount the shell,
  // or users lose the current page and any in-progress work.
  if (!ready) {
    return (
      <div className="app-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '0.35rem', fontWeight: 700 }}>
            Loading Keiros data…
          </p>
          <p style={{ fontSize: '0.8rem' }}>Connecting to Firestore</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {error ? (
        <div className="app-data-banner app-data-banner--error">
          Firestore sync warning: {error} — showing {source} data.
        </div>
      ) : source === 'firebase' ? (
        <div className="app-data-banner app-data-banner--live" aria-live="polite">
          Live data · Firebase
          {loading ? <span className="app-data-banner__sync"> · Syncing…</span> : null}
        </div>
      ) : null}
      {children}
    </>
  )
}

export function AppDataRoot({ children }: { children: ReactNode }) {
  return (
    <ErpDataProvider>
      <FirebaseBootGate>{children}</FirebaseBootGate>
    </ErpDataProvider>
  )
}
