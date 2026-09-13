import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { PageId } from '../app/nav'
import type { ApiClient, ApiKey, NavigationSession } from '../data/erpData'
import { buildKeyPrefix, issueApiKeySecret, sha256Hex } from '../lib/apiKeys'
import { useEntityMap, useErpData } from '../data/ErpDataProvider'
import {
  ActionBar,
  Badge,
  DataTable,
  EmptyHint,
  Field,
  FormGrid,
  KpiRow,
  MiniBars,
  PageHeader,
  Panel,
  SplitView,
  Toolbar,
} from '../ui/primitives'
import './pages.css'

type PageProps = { onNavigate?: (page: PageId) => void }
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

function statusTone(status: string): Tone {
  if (status === 'Active' || status === 'Healthy' || status === 'Production') return 'ok'
  if (status === 'Disabled' || status === 'Revoked' || status === 'Down') return 'danger'
  if (status === 'Rotated' || status === 'Degraded' || status === 'Staging') return 'warn'
  if (status === 'Development') return 'info'
  return 'neutral'
}

function httpTone(status: number): Tone {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warn'
  return 'ok'
}

function HelpNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="k-help-note" aria-label={`${title} help`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <label className="k-compact-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function flash(setNotice: (v: string) => void, msg: string) {
  setNotice(msg)
  window.setTimeout(() => setNotice(''), 2600)
}

function nextId(prefix: string, items: { id: string }[]) {
  const nums = items.map((i) => Number(i.id.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n))
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
}

const ENVIRONMENTS = ['Production', 'Staging', 'Development'] as const
const SCOPE_PRESETS = [
  'maps:read',
  'maps:read, routes:read',
  'maps:read, routes:read, codes:read',
  'locations:read, analytics:read',
  'maps:read, locations:read',
]

/* ─── API Clients ─── */
export function ApiClientsPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const { keysForClient } = useEntityMap()
  const clients = data.apiClients
  const organizations = data.organizations
  const [env, setEnv] = useState('All')
  const [status, setStatus] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    name: '',
    organizationId: '',
    environment: 'Production' as ApiClient['environment'],
  })

  const shown = clients.filter(
    (c) =>
      (env === 'All' || c.environment === env) &&
      (status === 'All' || c.status === status) &&
      `${c.name} ${c.org} ${c.environment}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = clients.find((c) => c.id === selected) ?? shown[0] ?? null
  const clientKeys = current ? keysForClient(current.id) : []

  async function createClient(event: FormEvent) {
    event.preventDefault()
    const org = organizations.find((o) => o.id === form.organizationId)
    if (!form.name.trim() || !org) {
      flash(setNotice, 'Name and organization are required.')
      return
    }
    const id = nextId('ac', clients)
    const item: ApiClient = {
      id,
      name: form.name.trim(),
      organizationId: org.id,
      org: org.name,
      environment: form.environment,
      createdAt: '2026-09-04',
      status: 'Active',
    }
    try {
      await upsert('apiClients', item)
      await logAudit({ actorUserId: null, actor: 'ERP operator', action: 'api_client.create', target: item.id })
      setSelected(id)
      setCreating(false)
      setForm({ name: '', organizationId: '', environment: 'Production' })
      flash(setNotice, `Client ${item.name} registered.`)
    } catch {
      flash(setNotice, 'Client could not be saved.')
    }
  }

  async function setClientStatus(id: string, next: ApiClient['status']) {
    const base = clients.find((c) => c.id === id)
    if (!base) return
    try {
      await upsert('apiClients', { ...base, status: next })
      await logAudit({
        actorUserId: null,
        actor: 'ERP operator',
        action: next === 'Active' ? 'api_client.activate' : 'api_client.disable',
        target: id,
      })
      flash(setNotice, next === 'Active' ? 'Client activated.' : 'Client disabled.')
    } catch {
      flash(setNotice, 'Client status could not be saved.')
    }
  }

  return (
    <>
      <PageHeader
        title="API Clients"
        subtitle="Registered integrations by org."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
            Register client
          </button>
        }
      />
      <HelpNote title="API clients">
        Each client is an app or service that calls Keiros APIs under one organization. Disable a
        client to revoke all of its keys at once; issue keys from API Keys after registration.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Clients', value: clients.length },
          { label: 'Active', value: clients.filter((c) => c.status === 'Active').length, tone: 'ok' },
          { label: 'Production', value: clients.filter((c) => c.environment === 'Production').length, tone: 'info' },
          { label: 'Disabled', value: clients.filter((c) => c.status === 'Disabled').length, tone: 'warn' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search client or org"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Environment" value={env} onChange={setEnv} options={['All', ...ENVIRONMENTS]} />
        <Select label="Status" value={status} onChange={setStatus} options={['All', 'Active', 'Disabled']} />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-keys')}>
          API keys
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="Register client">
          <form onSubmit={(event) => void createClient(event)}>
            <FormGrid>
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Mobile app or integration"
                  required
                />
              </Field>
              <Field label="Organization">
                <select
                  required
                  value={form.organizationId}
                  onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
                >
                  <option value="">Select</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Environment">
                <select
                  value={form.environment}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, environment: e.target.value as ApiClient['environment'] }))
                  }
                >
                  {ENVIRONMENTS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Register
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </ActionBar>
          </form>
        </Panel>
      ) : null}

      <SplitView
        left={
          <Panel title="Clients">
            {shown.length === 0 ? (
              <EmptyHint text="No clients match." />
            ) : (
              <DataTable
                columns={['Name', 'Org', 'Environment', 'Created', 'Status', '']}
                rows={shown.map((c) => [
                  c.name,
                  c.org,
                  <Badge key={`e-${c.id}`} tone={statusTone(c.environment)}>
                    {c.environment}
                  </Badge>,
                  c.createdAt,
                  <Badge key={`s-${c.id}`} tone={statusTone(c.status)}>
                    {c.status}
                  </Badge>,
                  <button key={`o-${c.id}`} type="button" className="k-link-btn" onClick={() => setSelected(c.id)}>
                    Open
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Client detail">
            {!current ? (
              <EmptyHint text="Select a client." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Name</span>
                  <strong>{current.name}</strong>
                </div>
                <div>
                  <span>Client ID</span>
                  <code className="k-code">{current.id}</code>
                </div>
                <div>
                  <span>Organization</span>
                  <strong>{current.org}</strong>
                </div>
                <div>
                  <span>Org ID</span>
                  <code className="k-code">{current.organizationId}</code>
                </div>
                <div>
                  <span>Environment</span>
                  <Badge tone={statusTone(current.environment)}>{current.environment}</Badge>
                </div>
                <div>
                  <span>Status</span>
                  <Badge tone={statusTone(current.status)}>{current.status}</Badge>
                </div>
                <div>
                  <span>Keys</span>
                  <strong>{clientKeys.length}</strong>
                </div>
                <ActionBar>
                  {current.status === 'Active' ? (
                    <button
                      type="button"
                      className="k-btn k-btn--danger"
                      onClick={() => void setClientStatus(current.id, 'Disabled')}
                    >
                      Disable
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="k-btn k-btn--primary"
                      onClick={() => void setClientStatus(current.id, 'Active')}
                    >
                      Activate
                    </button>
                  )}
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-keys')}>
                    Manage keys
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-usage')}>
                    Usage
                  </button>
                </ActionBar>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── API Keys ─── */
export function ApiKeysPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit, refresh } = useErpData()
  const { apiClientById } = useEntityMap()
  const keys = data.apiKeys
  const clients = data.apiClients
  const [clientFilter, setClientFilter] = useState('All')
  const [status, setStatus] = useState('All')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [revealed, setRevealed] = useState<{ keyId: string; fullKey: string; reason: 'create' | 'rotate' } | null>(
    null,
  )
  const [form, setForm] = useState({
    apiClientId: '',
    scopes: SCOPE_PRESETS[1],
  })

  const clientNames = useMemo(() => ['All', ...clients.map((c) => c.name)], [clients])
  const shown = keys.filter(
    (k) =>
      (clientFilter === 'All' || k.clientName === clientFilter) &&
      (status === 'All' || k.status === status),
  )
  const current = keys.find((k) => k.id === selected) ?? shown[0] ?? null

  async function createKey(event: FormEvent) {
    event.preventDefault()
    const client = clients.find((c) => c.id === form.apiClientId) ?? apiClientById[form.apiClientId]
    if (!client) {
      flash(setNotice, 'Select a client.')
      return
    }
    if (client.status === 'Disabled') {
      flash(setNotice, 'Cannot issue keys for a disabled client.')
      return
    }
    const id = nextId('ak', keys)
    const prefix = buildKeyPrefix(client.name, client.environment)
    const issued = issueApiKeySecret(prefix)
    const keyHash = await sha256Hex(issued.fullKey)
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const item: ApiKey = {
      id,
      apiClientId: client.id,
      clientName: client.name,
      prefix,
      keyHash,
      lastFour: issued.lastFour,
      scopes: form.scopes,
      lastUsed: '—',
      createdAt: now,
      status: 'Active',
    }
    try {
      await upsert('apiKeys', item)
      await logAudit({ actorUserId: null, actor: 'ERP operator', action: 'api_key.create', target: item.id })
      setSelected(id)
      setCreating(false)
      setForm({ apiClientId: '', scopes: SCOPE_PRESETS[1] })
      setRevealed({ keyId: id, fullKey: issued.fullKey, reason: 'create' })
      flash(setNotice, 'Key created — copy the secret now. It will not be shown again.')
    } catch {
      flash(setNotice, 'Key could not be saved.')
    }
  }

  async function rotateKey(id: string) {
    const base = keys.find((k) => k.id === id)
    if (!base || base.status === 'Revoked') return
    const prefix = base.prefix.endsWith('_') ? base.prefix : `${base.prefix}_`
    const issued = issueApiKeySecret(prefix)
    const keyHash = await sha256Hex(issued.fullKey)
    const next: ApiKey = {
      ...base,
      prefix,
      keyHash,
      lastFour: issued.lastFour,
      lastUsed: '—',
      status: 'Active',
    }
    try {
      await upsert('apiKeys', next)
      await logAudit({ actorUserId: null, actor: 'ERP operator', action: 'api_key.rotate', target: id })
      setRevealed({ keyId: id, fullKey: issued.fullKey, reason: 'rotate' })
      flash(setNotice, 'Key rotated — old secret no longer works. Copy the new secret now.')
    } catch {
      flash(setNotice, 'Key rotation could not be saved.')
    }
  }

  async function revokeKey(id: string) {
    const base = keys.find((k) => k.id === id)
    if (!base) return
    try {
      await upsert('apiKeys', { ...base, status: 'Revoked', keyHash: null })
      await logAudit({ actorUserId: null, actor: 'ERP operator', action: 'api_key.revoke', target: id })
      if (revealed?.keyId === id) setRevealed(null)
      flash(setNotice, 'Key revoked.')
    } catch {
      flash(setNotice, 'Key revocation could not be saved.')
    }
  }

  return (
    <>
      <PageHeader
        title="API Keys"
        subtitle="Issue real secrets once, store only a hash, track usage from live API calls."
        actions={
          <>
            <button
              type="button"
              className="k-btn k-btn--ghost"
              onClick={() => {
                void refresh().then(() => flash(setNotice, 'Synced from Firestore.'))
              }}
            >
              Sync
            </button>
            <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
              Create key
            </button>
          </>
        }
      />
      <HelpNote title="API keys">
        Create a client first, then issue a key. The full secret is shown <strong>once</strong>; Firestore stores
        SHA-256 only. Paste the secret into API_DEMO as Bearer token. Usage updates appear under API Usage / Logs.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Keys', value: keys.length },
          { label: 'Active', value: keys.filter((k) => k.status === 'Active').length, tone: 'ok' },
          {
            label: 'Hashed secrets',
            value: keys.filter((k) => Boolean(k.keyHash)).length,
            tone: 'info',
          },
          { label: 'Revoked', value: keys.filter((k) => k.status === 'Revoked').length, tone: 'danger' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}

      {revealed ? (
        <Panel title={revealed.reason === 'rotate' ? 'New API secret (rotation)' : 'New API secret'}>
          <p className="k-muted" style={{ marginTop: 0 }}>
            Copy and store this secret now. Keiros will not show it again.
          </p>
          <code className="k-code" style={{ display: 'block', wordBreak: 'break-all', padding: '0.75rem' }}>
            {revealed.fullKey}
          </code>
          <ActionBar>
            <button
              type="button"
              className="k-btn k-btn--primary"
              onClick={() => {
                void navigator.clipboard?.writeText(revealed.fullKey)
                flash(setNotice, 'Full API key copied.')
              }}
            >
              Copy secret
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setRevealed(null)}>
              I saved it — dismiss
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-usage')}>
              Open usage
            </button>
          </ActionBar>
        </Panel>
      ) : null}

      <Toolbar>
        <Select label="Client" value={clientFilter} onChange={setClientFilter} options={clientNames} />
        <Select label="Status" value={status} onChange={setStatus} options={['All', 'Active', 'Rotated', 'Revoked']} />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-clients')}>
          Clients
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="Create key">
          <form onSubmit={(event) => void createKey(event)}>
            <FormGrid>
              <Field label="Client">
                <select
                  required
                  value={form.apiClientId}
                  onChange={(e) => setForm((f) => ({ ...f, apiClientId: e.target.value }))}
                >
                  <option value="">Select</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.environment})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Scopes">
                <select value={form.scopes} onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}>
                  {SCOPE_PRESETS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Issue secret
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </ActionBar>
          </form>
        </Panel>
      ) : null}

      <SplitView
        left={
          <Panel title="Keys">
            {shown.length === 0 ? (
              <EmptyHint text="No keys match." />
            ) : (
              <DataTable
                columns={['Client', 'Key', 'Scopes', 'Last used', 'Status', '']}
                rows={shown.map((k) => [
                  k.clientName,
                  <code key={`p-${k.id}`} className="k-code">
                    {k.prefix}…{k.lastFour ?? '••••'}
                    {k.keyHash ? '' : ' (legacy)'}
                  </code>,
                  k.scopes,
                  k.lastUsed,
                  <Badge key={`s-${k.id}`} tone={statusTone(k.status)}>
                    {k.status}
                  </Badge>,
                  <button key={`o-${k.id}`} type="button" className="k-link-btn" onClick={() => setSelected(k.id)}>
                    Open
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Key detail">
            {!current ? (
              <EmptyHint text="Select a key." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Client</span>
                  <strong>{current.clientName}</strong>
                </div>
                <div>
                  <span>Client ID</span>
                  <code className="k-code">{current.apiClientId}</code>
                </div>
                <div>
                  <span>Display</span>
                  <code className="k-code">
                    {current.prefix}…{current.lastFour ?? '••••'}
                  </code>
                </div>
                <div>
                  <span>Auth</span>
                  <strong>{current.keyHash ? 'SHA-256 hash (real secret)' : 'Legacy prefix match'}</strong>
                </div>
                <div>
                  <span>Scopes</span>
                  <strong>{current.scopes}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <Badge tone={statusTone(current.status)}>{current.status}</Badge>
                </div>
                <div>
                  <span>Created</span>
                  <strong>{current.createdAt ?? '—'}</strong>
                </div>
                <div>
                  <span>Last used</span>
                  <strong>{current.lastUsed}</strong>
                </div>
                <ActionBar>
                  {current.status !== 'Revoked' ? (
                    <>
                      <button type="button" className="k-btn k-btn--ghost" onClick={() => void rotateKey(current.id)}>
                        Rotate secret
                      </button>
                      <button type="button" className="k-btn k-btn--danger" onClick={() => void revokeKey(current.id)}>
                        Revoke
                      </button>
                    </>
                  ) : (
                    <span className="k-toolbar__meta">Revoked keys cannot be restored.</span>
                  )}
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-logs')}>
                    Logs
                  </button>
                </ActionBar>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── API Usage ─── */
export function ApiUsagePage({ onNavigate }: PageProps) {
  const { data, refresh } = useErpData()
  const usage = data.apiUsageStats
  const [client, setClient] = useState('All')
  const [metric, setMetric] = useState<'Requests' | 'Errors' | 'p95'>('Requests')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      void refresh()
    }, 5000)
    return () => window.clearInterval(id)
  }, [autoRefresh, refresh])

  const clientOptions = useMemo(
    () => ['All', ...Array.from(new Set(usage.map((u) => u.clientName)))],
    [usage],
  )
  const shown = usage
    .filter((u) => client === 'All' || u.clientName === client)
    .slice()
    .sort((a, b) => b.requests - a.requests)
  const current = shown.find((u) => u.id === selected) ?? shown[0] ?? null

  const totalRequests = shown.reduce((s, r) => s + r.requests, 0)
  const totalErrors = shown.reduce((s, r) => s + r.errors, 0)
  const totals = {
    requests: totalRequests,
    errors: totalErrors,
    avgP95: shown.length ? Math.round(shown.reduce((s, r) => s + r.p95Ms, 0) / shown.length) : 0,
    errorRate: totalRequests ? ((totalErrors / totalRequests) * 100).toFixed(2) : '0.00',
  }

  async function syncUsage() {
    try {
      await refresh()
      flash(setNotice, 'Usage synced from Firestore.')
    } catch {
      flash(setNotice, 'Could not sync usage.')
    }
  }

  function exportCsv() {
    const rows = [
      ['Client ID', 'Client', 'Endpoint', 'Requests', 'Errors', 'p95 ms'],
      ...shown.map((u) => [
        u.apiClientId,
        u.clientName,
        u.endpoint,
        String(u.requests),
        String(u.errors),
        String(u.p95Ms),
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'api-usage.csv'
    a.click()
    URL.revokeObjectURL(url)
    flash(setNotice, 'CSV exported.')
  }

  const chartValues = shown.map((r) => (metric === 'Requests' ? r.requests : metric === 'Errors' ? r.errors : r.p95Ms))

  return (
    <>
      <PageHeader
        title="API Usage"
        subtitle="Live request volume from the ERP API server (Firestore)."
        actions={
          <>
            <Badge tone={autoRefresh ? 'ok' : 'neutral'}>{autoRefresh ? 'Live' : 'Paused'}</Badge>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => void syncUsage()}>
              Sync
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv}>
              Export
            </button>
          </>
        }
      />
      <HelpNote title="API usage">
        Counters increment when API_DEMO (or any client) calls authenticated endpoints with a valid key. Use Sync /
        Auto refresh after Navigate to see updates.
      </HelpNote>
      <HelpNote title="API usage">
        Watch volume, errors, and p95 latency per client endpoint. Rising error rate or p95 usually
        means a bad deploy, rate limits, or a disabled downstream service — check API Logs next.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Requests', value: totals.requests.toLocaleString(), tone: 'info' },
          { label: 'Errors', value: totals.errors, tone: totals.errors > 50 ? 'warn' : 'ok' },
          { label: 'Error rate', value: `${totals.errorRate}%` },
          { label: 'Avg p95', value: `${totals.avgP95} ms`, tone: 'info' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <Select label="Client" value={client} onChange={setClient} options={clientOptions} />
        <label className="k-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto refresh
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-logs')}>
          Logs
        </button>
      </Toolbar>
      <div className="k-page-grid k-page-grid--wide">
        <Panel
          title={`${metric} by endpoint`}
          actions={
            <div className="k-segment">
              {(['Requests', 'Errors', 'p95'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={metric === option ? 'is-active' : ''}
                  onClick={() => setMetric(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          }
        >
          {shown.length ? (
            <MiniBars values={chartValues} labels={shown.map((r) => r.endpoint.split('/').pop() || r.clientName.split(' ')[0])} />
          ) : (
            <EmptyHint text="No usage rows." />
          )}
        </Panel>
        <Panel title="Selected endpoint">
          {!current ? (
            <EmptyHint text="Select a row." />
          ) : (
            <div className="k-detail-list">
              <div>
                <span>Client</span>
                <strong>{current.clientName}</strong>
              </div>
              <div>
                <span>Endpoint</span>
                <code className="k-code">{current.endpoint}</code>
              </div>
              <div>
                <span>Requests</span>
                <strong>{current.requests.toLocaleString()}</strong>
              </div>
              <div>
                <span>Errors</span>
                <strong>{current.errors}</strong>
              </div>
              <div>
                <span>p95</span>
                <strong>{current.p95Ms} ms</strong>
              </div>
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Usage detail">
        <DataTable
          columns={['Client', 'Endpoint', 'Requests', 'Errors', 'Error rate', 'p95', '']}
          rows={shown.map((row) => [
            row.clientName,
            <code key={row.id} className="k-code">
              {row.endpoint}
            </code>,
            row.requests.toLocaleString(),
            row.errors,
            `${((row.errors / Math.max(row.requests, 1)) * 100).toFixed(2)}%`,
            `${row.p95Ms} ms`,
            <button key={`o-${row.id}`} type="button" className="k-link-btn" onClick={() => setSelected(row.id)}>
              Open
            </button>,
          ])}
        />
      </Panel>
    </>
  )
}

/* ─── API Logs ─── */
export function ApiLogsPage({ onNavigate }: PageProps) {
  const { data, refresh: refreshStore } = useErpData()
  const logs = data.apiLogs
  const [client, setClient] = useState('All')
  const [method, setMethod] = useState('All')
  const [statusBand, setStatusBand] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      void refreshStore()
    }, 5000)
    return () => window.clearInterval(id)
  }, [autoRefresh, refreshStore])

  const clientOptions = useMemo(
    () => ['All', ...Array.from(new Set(logs.map((l) => l.clientName)))],
    [logs],
  )

  const shown = logs
    .filter((log) => {
      if (client !== 'All' && log.clientName !== client) return false
      if (method !== 'All' && log.method !== method) return false
      if (statusBand === '2xx' && (log.status < 200 || log.status >= 300)) return false
      if (statusBand === '4xx' && (log.status < 400 || log.status >= 500)) return false
      if (statusBand === '5xx' && log.status < 500) return false
      if (query && !`${log.path} ${log.clientName} ${log.method}`.toLowerCase().includes(query.toLowerCase())) {
        return false
      }
      return true
    })
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 60)
  const current = shown.find((l) => l.id === selected) ?? shown[0] ?? null
  const errorCount = shown.filter((l) => l.status >= 400).length

  async function refresh() {
    try {
      await refreshStore()
      flash(setNotice, 'Logs synced from Firestore.')
    } catch {
      flash(setNotice, 'Could not refresh logs.')
    }
  }

  function exportCsv() {
    const rows = [
      ['Time', 'Client ID', 'Client', 'Method', 'Path', 'Status', 'Duration ms'],
      ...shown.map((l) => [
        l.timestamp,
        l.apiClientId,
        l.clientName,
        l.method,
        l.path,
        String(l.status),
        String(l.durationMs),
      ]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'api-logs.csv'
    a.click()
    URL.revokeObjectURL(url)
    flash(setNotice, 'CSV exported.')
  }

  return (
    <>
      <PageHeader
        title="API Logs"
        subtitle="Recent request and response records — including API_DEMO navigation calls."
        actions={
          <>
            <Badge tone={autoRefresh ? 'ok' : 'neutral'}>{autoRefresh ? 'Live' : 'Paused'}</Badge>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => void refresh()}>
              Refresh
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv}>
              Export
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-navigation')}>
              Navigation live
            </button>
          </>
        }
      />
      <HelpNote title="API logs">
        Live traffic from the ERP API server (<code>POST /api/v1/navigate</code>,{' '}
        <code>GET /api/v1/hierarchy</code>) lands here when API_DEMO calls with a valid key prefix
        (example: <code>keiros_live_ot_demo_map_nav_2026</code>). Enable Auto refresh to watch updates.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Events', value: shown.length, tone: 'info' },
          { label: 'Errors', value: errorCount, tone: errorCount ? 'warn' : 'ok' },
          {
            label: 'Avg duration',
            value: shown.length
              ? `${Math.round(shown.reduce((s, l) => s + l.durationMs, 0) / shown.length)} ms`
              : '—',
          },
          { label: 'Clients', value: new Set(shown.map((l) => l.apiClientId)).size, tone: 'ok' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search path or client"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Client" value={client} onChange={setClient} options={clientOptions} />
        <Select label="Method" value={method} onChange={setMethod} options={['All', 'GET', 'POST', 'PUT', 'DELETE']} />
        <Select label="Status" value={statusBand} onChange={setStatusBand} options={['All', '2xx', '4xx', '5xx']} />
        <label className="k-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto refresh
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-usage')}>
          Usage
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Logs">
            {shown.length === 0 ? (
              <EmptyHint text="No logs match." />
            ) : (
              <DataTable
                columns={['Time', 'Client', 'Method', 'Path', 'Status', 'Duration', '']}
                rows={shown.map((log) => [
                  log.timestamp,
                  log.clientName,
                  log.method,
                  <code key={log.id} className="k-code">
                    {log.path}
                  </code>,
                  <Badge key={`st-${log.id}`} tone={httpTone(log.status)}>
                    {log.status}
                  </Badge>,
                  `${log.durationMs} ms`,
                  <button
                    key={`o-${log.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(log.id)}
                  >
                    Open
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Log detail">
            {!current ? (
              <EmptyHint text="Select a log." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Time</span>
                  <strong>{current.timestamp}</strong>
                </div>
                <div>
                  <span>Client</span>
                  <strong>{current.clientName}</strong>
                </div>
                <div>
                  <span>Client ID</span>
                  <code className="k-code">{current.apiClientId}</code>
                </div>
                <div>
                  <span>Request</span>
                  <strong>
                    {current.method} {current.path}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <Badge tone={httpTone(current.status)}>{current.status}</Badge>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{current.durationMs} ms</strong>
                </div>
                {current.meta ? (
                  <div>
                    <span>Meta</span>
                    <pre className="k-code" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                      {JSON.stringify(current.meta, null, 2)}
                    </pre>
                  </div>
                ) : null}
                <ActionBar>
                  <button
                    type="button"
                    className="k-btn k-btn--ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${current.method} ${current.path}`)
                      flash(setNotice, 'Request line copied.')
                    }}
                  >
                    Copy request
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-clients')}>
                    Clients
                  </button>
                </ActionBar>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── API Navigation Live (API_DEMO feed) ─── */
export function ApiNavigationLivePage({ onNavigate }: PageProps) {
  const { data, refresh } = useErpData()
  const sessions = data.navigationSessions
  const [selected, setSelected] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      void refresh()
    }, 4000)
    return () => window.clearInterval(id)
  }, [autoRefresh, refresh])

  const shown = useMemo(
    () =>
      [...sessions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40),
    [sessions],
  )
  const current: NavigationSession | null = shown.find((s) => s.id === selected) ?? shown[0] ?? null

  return (
    <>
      <PageHeader
        title="API Navigation Live"
        subtitle="Outdoor + indoor navigation sessions created by API_DEMO via the ERP API."
        actions={
          <>
            <Badge tone={autoRefresh ? 'ok' : 'neutral'}>{autoRefresh ? 'Polling' : 'Paused'}</Badge>
            <button
              type="button"
              className="k-btn k-btn--ghost"
              onClick={() => {
                void refresh().then(() => flash(setNotice, 'Synced.'))
              }}
            >
              Sync now
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-logs')}>
              API Logs
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('journey-tracking')}>
              Journeys
            </button>
          </>
        }
      />
      <HelpNote title="Cross-app updates">
        When API_DEMO authenticates with an Active key prefix and calls{' '}
        <code>POST /api/v1/navigate</code>, this page and API Logs / Usage / Journey Tracking update from
        Firestore. Demo key: <code>keiros_live_ot_demo_map_nav_2026</code> (Orion Mobile App prefix).
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <KpiRow
        items={[
          { label: 'Sessions', value: shown.length, tone: 'info' },
          {
            label: 'Active',
            value: shown.filter((s) => s.status === 'Active').length,
            tone: 'ok',
          },
          {
            label: 'Avg outdoor mi',
            value: shown.length
              ? (shown.reduce((sum, r) => sum + (r.outdoorDistanceMiles || 0), 0) / shown.length).toFixed(1)
              : '—',
          },
          {
            label: 'Clients',
            value: new Set(shown.map((s) => s.apiClientId)).size,
            tone: 'ok',
          },
        ]}
      />
      <Toolbar>
        <label className="k-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto refresh
        </label>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Navigation sessions">
            {shown.length === 0 ? (
              <EmptyHint text="No API_DEMO navigation sessions yet. Start the ERP API server and run a navigate call." />
            ) : (
              <DataTable
                columns={['Time', 'Client', 'Destination', 'Traffic', 'Weather', '']}
                rows={shown.map((s) => [
                  s.createdAt,
                  s.clientName,
                  `${s.buildingName} · ${s.floorLabel} · ${s.unitName}`,
                  s.trafficLevel,
                  s.weatherSummary ?? '—',
                  <button
                    key={s.id}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(s.id)}
                  >
                    Open
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Session detail">
            {!current ? (
              <EmptyHint text="Select a session." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Session</span>
                  <code className="k-code">{current.id}</code>
                </div>
                <div>
                  <span>Client</span>
                  <strong>{current.clientName}</strong>
                </div>
                <div>
                  <span>Complex</span>
                  <strong>{current.complexName ?? '—'}</strong>
                </div>
                <div>
                  <span>Building / Floor / Unit</span>
                  <strong>
                    {current.buildingName} / {current.floorLabel} / {current.unitName} (
                    {current.unitCode})
                  </strong>
                </div>
                <div>
                  <span>Start offset</span>
                  <strong>{current.originMiles} miles</strong>
                </div>
                <div>
                  <span>Outdoor</span>
                  <strong>
                    {current.outdoorDistanceMiles} mi · {current.outdoorDurationMin} min
                  </strong>
                </div>
                <div>
                  <span>Indoor walk</span>
                  <strong>{current.indoorWalkMin} min</strong>
                </div>
                <div>
                  <span>Traffic</span>
                  <Badge tone={current.trafficLevel === 'Heavy' || current.trafficLevel === 'Severe' ? 'warn' : 'ok'}>
                    {current.trafficLevel}
                  </Badge>
                </div>
                <div>
                  <span>Weather</span>
                  <strong>
                    {current.weatherSummary ?? '—'}
                    {current.temperatureF != null ? ` · ${current.temperatureF}°F` : ''}
                  </strong>
                </div>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Access Integration ─── */
export function AccessIntegrationPage({ onNavigate }: PageProps) {
  const { data } = useErpData()
  const siteProperties = data.siteProperties
  const [rfidEnabled, setRfidEnabled] = useState(true)
  const [readerMode, setReaderMode] = useState('passive')
  const [syncInterval, setSyncInterval] = useState('5')
  const [defaultPropertyId, setDefaultPropertyId] = useState(siteProperties[0]?.id ?? '')
  const [pendingEvents, setPendingEvents] = useState(3)
  const [lastSync, setLastSync] = useState('2 min ago')
  const [notice, setNotice] = useState('')
  const [testing, setTesting] = useState(false)

  const readersOnline = rfidEnabled ? (readerMode === 'active' ? 14 : 12) : 0
  const defaultProperty = siteProperties.find((p) => p.id === defaultPropertyId)

  function saveSettings() {
    const mins = Math.max(1, Number(syncInterval) || 1)
    setSyncInterval(String(mins))
    setLastSync('Just now')
    flash(setNotice, 'Access settings saved.')
  }

  function syncNow() {
    setTesting(true)
    window.setTimeout(() => {
      setTesting(false)
      setLastSync('Just now')
      setPendingEvents((n) => Math.max(0, n - 1))
      flash(setNotice, 'Readers synchronized.')
    }, 700)
  }

  function flushEvents() {
    setPendingEvents(0)
    flash(setNotice, 'Pending access events cleared.')
  }

  return (
    <>
      <PageHeader
        title="Access Integration"
        subtitle="RFID and door access settings."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={syncNow} disabled={testing || !rfidEnabled}>
            {testing ? 'Syncing…' : 'Sync now'}
          </button>
        }
      />
      <HelpNote title="Access integration">
        Connect RFID readers to property codes and door controllers. Passive mode polls on the sync
        interval; Active mode pushes events immediately. Pick a default site property for unmatched
        badges.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <div className="k-two-col">
        <Panel title="Settings">
          <FormGrid>
            <Field label="RFID enabled">
              <select
                value={rfidEnabled ? 'yes' : 'no'}
                onChange={(e) => setRfidEnabled(e.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="Reader mode">
              <select
                value={readerMode}
                disabled={!rfidEnabled}
                onChange={(e) => setReaderMode(e.target.value)}
              >
                <option value="passive">Passive</option>
                <option value="active">Active</option>
              </select>
            </Field>
            <Field label="Sync interval (min)">
              <input
                type="number"
                min={1}
                max={60}
                disabled={!rfidEnabled || readerMode === 'active'}
                value={syncInterval}
                onChange={(e) => setSyncInterval(e.target.value)}
              />
            </Field>
            <Field label="Default property">
              <select
                value={defaultPropertyId}
                onChange={(e) => setDefaultPropertyId(e.target.value)}
                disabled={!rfidEnabled}
              >
                {siteProperties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>
          <ActionBar>
            <button type="button" className="k-btn k-btn--primary" onClick={saveSettings}>
              Save settings
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('property-codes')}>
              Property codes
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('mobile-sessions')}>
              Sessions
            </button>
          </ActionBar>
        </Panel>
        <Panel title="Status">
          <KpiRow
            items={[
              { label: 'Readers online', value: readersOnline, tone: rfidEnabled ? 'ok' : 'neutral' },
              { label: 'Last sync', value: lastSync, tone: 'info' },
              { label: 'Pending events', value: pendingEvents, tone: pendingEvents ? 'warn' : 'ok' },
            ]}
          />
          <div className="k-detail-list" style={{ marginTop: '0.75rem' }}>
            <div>
              <span>Default site</span>
              <strong>{defaultProperty?.name ?? '—'}</strong>
            </div>
            <div>
              <span>Property ID</span>
              <code className="k-code">{defaultPropertyId || '—'}</code>
            </div>
            <div>
              <span>Mode</span>
              <strong>{rfidEnabled ? readerMode : 'offline'}</strong>
            </div>
          </div>
          <ul className="k-status-list">
            <li>
              <Badge tone={rfidEnabled ? 'ok' : 'neutral'}>
                Door controller A — {rfidEnabled ? 'online' : 'offline'}
              </Badge>
            </li>
            <li>
              <Badge tone={rfidEnabled ? 'ok' : 'neutral'}>
                Door controller B — {rfidEnabled ? 'online' : 'offline'}
              </Badge>
            </li>
            <li>
              <Badge tone={rfidEnabled ? 'warn' : 'neutral'}>
                Reader L02-N — {rfidEnabled ? 'lag' : 'offline'}
              </Badge>
            </li>
          </ul>
          <ActionBar>
            <button
              type="button"
              className="k-btn k-btn--ghost"
              onClick={flushEvents}
              disabled={!pendingEvents}
            >
              Clear pending
            </button>
          </ActionBar>
        </Panel>
      </div>
    </>
  )
}
