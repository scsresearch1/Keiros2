import { useEffect, useState } from 'react'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { getFirestoreDb } from '../firebase/app'
import { isFirebaseEnabled } from '../firebase/config'
import {
  Badge,
  DataTable,
  PageHeader,
  Panel,
} from '../ui/primitives'
import './pages.css'

export {
  ApiClientsPage,
  ApiKeysPage,
  ApiUsagePage,
  ApiLogsPage,
  ApiNavigationLivePage,
  AccessIntegrationPage,
} from './apiIntegrationPages'

export {
  ReportsPage,
  AuditLogsPage,
  AlertsPage,
  SystemHealthPage,
  SettingsPage,
  HelpPage,
} from './systemPages'

type NotificationRule = {
  id: string
  name: string
  channel: string
  enabled: boolean
}

const initialRules: NotificationRule[] = [
  { id: 'nr-1', name: 'Map publish failure', channel: 'Email + ERS', enabled: true },
  { id: 'nr-2', name: 'API error spike', channel: 'ERS', enabled: true },
  { id: 'nr-3', name: 'Mapping SLA breach', channel: 'Email', enabled: false },
  { id: 'nr-4', name: 'Access reader offline', channel: 'ERS', enabled: true },
]

/** Notification rules are not part of the seeded ERP snapshot, so they persist directly. */
const NOTIFICATION_RULES = 'notification_rules'

async function persistRule(rule: NotificationRule) {
  if (!isFirebaseEnabled()) return
  await setDoc(
    doc(getFirestoreDb(), NOTIFICATION_RULES, rule.id),
    { ...rule, _updatedAt: new Date().toISOString() },
    { merge: true },
  )
}

export function NotificationsPage() {
  const [rules, setRules] = useState(initialRules)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!isFirebaseEnabled()) return
    let cancelled = false
    void (async () => {
      try {
        const snap = await getDocs(collection(getFirestoreDb(), NOTIFICATION_RULES))
        if (cancelled) return
        if (snap.empty) {
          await Promise.all(initialRules.map(persistRule))
          return
        }
        const loaded = snap.docs
          .map((entry) => {
            const raw = entry.data() as Partial<NotificationRule>
            return {
              id: String(raw.id ?? entry.id),
              name: String(raw.name ?? entry.id),
              channel: String(raw.channel ?? 'Email'),
              enabled: Boolean(raw.enabled),
            }
          })
          .sort((a, b) => a.id.localeCompare(b.id))
        setRules(loaded)
      } catch {
        if (!cancelled) setNotice('Could not load saved rules — showing defaults.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function toggleRule(id: string) {
    const base = rules.find((r) => r.id === id)
    if (!base) return
    const next = { ...base, enabled: !base.enabled }
    setRules((prev) => prev.map((r) => (r.id === id ? next : r)))
    try {
      await persistRule(next)
      setNotice('')
    } catch {
      setNotice('Rule change could not be saved.')
    }
  }

  return (
    <>
      <PageHeader title="Notifications / ERS" subtitle="Alert routing and delivery rules." />
      <aside className="k-help-note" aria-label="Notifications help">
        <strong>Notifications / ERS</strong>
        <div>
          Route operational alerts to Email and/or ERS. Disable a rule to mute that signal without
          deleting it; re-enable when the channel is ready again.
        </div>
      </aside>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Panel title="Alert rules">
        <DataTable
          columns={['Rule', 'Channel', 'Status', 'Actions']}
          rows={rules.map((r) => [
            r.name,
            r.channel,
            <Badge key={`b-${r.id}`} tone={r.enabled ? 'ok' : 'neutral'}>
              {r.enabled ? 'On' : 'Off'}
            </Badge>,
            <button
              key={`t-${r.id}`}
              type="button"
              className="k-btn k-btn--ghost"
              onClick={() => void toggleRule(r.id)}
            >
              {r.enabled ? 'Disable' : 'Enable'}
            </button>,
          ])}
        />
      </Panel>
    </>
  )
}
