import { useState } from 'react'
import keirosLogo from '../../assets/keiros-logo.png'
import './WorkspacePage.css'

type WorkspacePageProps = {
  email: string
  onSignOut: () => void
  onSessionExpired?: () => void
}

export function WorkspacePage({ email, onSignOut, onSessionExpired }: WorkspacePageProps) {
  const [confirmOut, setConfirmOut] = useState(false)

  return (
    <div className="workspace">
      <header className="workspace-bar">
        <span className="logo-plate">
          <img src={keirosLogo} alt="Keiros" />
        </span>
        <div className="workspace-meta">
          <span>{email}</span>
          {onSessionExpired ? (
            <button type="button" className="ghost-action" onClick={onSessionExpired}>
              Session expired
            </button>
          ) : null}
          <button type="button" onClick={() => setConfirmOut(true)}>
            Sign out
          </button>
        </div>
      </header>
      <main className="workspace-main">
        <h1>Keiros ERP</h1>
        <p>Signed in.</p>
      </main>

      {confirmOut ? (
        <div className="logout-overlay" role="dialog" aria-modal="true" aria-labelledby="logout-title">
          <div className="logout-modal">
            <h2 id="logout-title">Sign out?</h2>
            <p>You will need to sign in again to continue.</p>
            <div className="logout-actions">
              <button type="button" className="btn quiet" onClick={() => setConfirmOut(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setConfirmOut(false)
                  onSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
