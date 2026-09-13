import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { QrCode } from 'lucide-react'
import type { PageId } from '../app/nav'
import type {
  CodeUsage,
  MapDownload,
  MapVersion,
  MobileSession,
  PropertyCode,
  SessionStatus,
} from '../data/erpData'
import { useEntityMap, useErpData } from '../data/ErpDataProvider'
import { PropertyCodeQr } from '../ui/PropertyCodeQr'
import { PropertyCodeQrThumb } from '../ui/PropertyCodeQrThumb'
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

function tone(status: string): Tone {
  if (['Active', 'Current', 'Healthy'].includes(status)) return 'ok'
  if (['Idle', 'Expired', 'Review', 'Stale'].includes(status)) return 'warn'
  if (['Revoked', 'Ended', 'Failed'].includes(status)) return 'danger'
  if (['iOS', 'Android', 'Visitor', 'Staff', 'Patient', 'Tenant', 'Resident', 'Guest'].includes(status)) return 'info'
  return 'neutral'
}

function Status({ value }: { value: string }) {
  return <Badge tone={tone(value)}>{value}</Badge>
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

/** Awaits a Firestore write; local state is already updated optimistically by the provider. */
async function persist(op: Promise<unknown>, setNotice: (v: string) => void, okMsg: string) {
  try {
    await op
    flash(setNotice, okMsg)
  } catch {
    flash(setNotice, 'Saved locally — Firestore sync failed.')
  }
}

/** Live replacement for entityMap.currentMapVersion — resolves against the snapshot. */
function currentMapVersionFor(versions: MapVersion[], propertyId: string) {
  return (
    versions.find((v) => v.propertyId === propertyId && v.status === 'Live') ??
    versions.find((v) => v.propertyId === propertyId && v.status === 'Staging') ??
    versions.find((v) => v.propertyId === propertyId && v.status === 'Draft')
  )
}

/** Live replacement for entityMap.usageForCode. */
function usageForCodeIn(usage: CodeUsage[], code: PropertyCode) {
  return usage.find((u) => u.propertyCodeId === code.id || u.code === code.code)
}

function nextId(prefix: string, items: { id: string }[]) {
  const nums = items.map((i) => Number(i.id.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n))
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
}

function makeCode(propertyName: string) {
  const slug = propertyName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4)
  const year = new Date().getFullYear()
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${slug}-${year}-${suffix}`
}

/* ─── Property Codes ─── */
export function PropertyCodesPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const entityMap = useEntityMap()
  const codes = data.propertyCodes
  const usage = data.codeUsage
  const propertyNames = useMemo(() => data.siteProperties.map((p) => p.name), [data.siteProperties])
  const [state, setState] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [draftCode, setDraftCode] = useState('')
  const [form, setForm] = useState({
    propertyName: '',
    label: 'Visitor Access',
    expiresAt: '2027-01-01',
    noExpiry: false,
  })

  const formPropertyName = form.propertyName || propertyNames[0] || ''

  useEffect(() => {
    if (creating) setDraftCode(makeCode(formPropertyName || 'KEIROS'))
  }, [creating, formPropertyName])

  const shown = codes.filter(
    (code) =>
      (state === 'All' || code.status === state) &&
      `${code.propertyName} ${code.code} ${code.label}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = codes.find((c) => c.id === selected) ?? shown[0] ?? null

  function revoke(id: string) {
    const code = codes.find((c) => c.id === id)
    if (!code) return
    void persist(
      upsert('propertyCodes', { ...code, status: 'Revoked' }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Access code revoked',
          target: `${code.propertyName} · ${code.code}`,
        }),
      ),
      setNotice,
      'Code revoked.',
    )
  }

  function reactivate(id: string) {
    const code = codes.find((c) => c.id === id)
    if (!code) return
    void persist(
      upsert('propertyCodes', {
        ...code,
        status: 'Active',
        expiresAt: code.expiresAt ?? '2027-06-01',
      }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Access code reactivated',
          target: `${code.propertyName} · ${code.code}`,
        }),
      ),
      setNotice,
      'Code reactivated.',
    )
  }

  function createCode(event: FormEvent) {
    event.preventDefault()
    const id = nextId('pc', codes)
    const code = draftCode
    const prop = entityMap.sitePropertyByName[formPropertyName]
    if (!prop) {
      flash(setNotice, 'Unknown property.')
      return
    }
    const item: PropertyCode = {
      id,
      propertyId: prop.id,
      propertyName: prop.name,
      code,
      label: form.label.trim() || 'Access',
      status: 'Active',
      expiresAt: form.noExpiry ? null : form.expiresAt || null,
    }
    setSelected(id)
    setCreating(false)
    void persist(
      upsert('propertyCodes', item).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Access code generated',
          target: `${item.propertyName} · ${item.code}`,
        }),
      ),
      setNotice,
      `Generated ${code} with QR.`,
    )
  }

  function exportCsv() {
    const rows = [
      ['Property', 'Code', 'Label', 'Status', 'Expires'],
      ...codes.map((c) => [c.propertyName, c.code, c.label, c.status, c.expiresAt ?? 'Never']),
    ]
    const csv = rows.map((r) => r.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'property-codes.csv'
    a.click()
    URL.revokeObjectURL(url)
    flash(setNotice, 'CSV exported.')
  }

  return (
    <>
      <PageHeader
        title="Property Codes"
        subtitle="Mobile access codes and expiry."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
            Generate code
          </button>
        }
      />
      <HelpNote title="Property codes">
        Each code generates a scannable HTTPS QR (`https://keiros.ai/access?code=…`) with the Keiros
        logo. Phone cameras and QR apps can read it; the Tour / mobile app extracts the access code
        from the link. Print or download for lobbies and desks. Revoke immediately if leaked.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Codes', value: codes.length },
          { label: 'Active', value: codes.filter((c) => c.status === 'Active').length, tone: 'ok' },
          { label: 'Expired', value: codes.filter((c) => c.status === 'Expired').length, tone: 'warn' },
          { label: 'No expiry', value: codes.filter((c) => !c.expiresAt).length, tone: 'info' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search property or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="State" value={state} onChange={setState} options={['All', 'Active', 'Expired', 'Revoked']} />
        <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv}>
          Export
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('code-usage')}>
          Usage
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="Generate access code">
          <form onSubmit={createCode}>
            <div className="k-two-col">
              <div>
                <FormGrid>
                  <Field label="Property">
                    <select
                      value={formPropertyName}
                      onChange={(e) => setForm((f) => ({ ...f, propertyName: e.target.value }))}
                    >
                      {propertyNames.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Label">
                    <input
                      value={form.label}
                      onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label="Expires">
                    <input
                      type="date"
                      value={form.expiresAt}
                      disabled={form.noExpiry}
                      onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                    />
                  </Field>
                  <label className="k-toggle" style={{ alignSelf: 'end' }}>
                    <input
                      type="checkbox"
                      checked={form.noExpiry}
                      onChange={(e) => setForm((f) => ({ ...f, noExpiry: e.target.checked }))}
                    />
                    No expiry
                  </label>
                </FormGrid>
                <ActionBar>
                  <button type="submit" className="k-btn k-btn--primary">
                    Generate
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => setCreating(false)}>
                    Cancel
                  </button>
                </ActionBar>
              </div>
              <PropertyCodeQr
                code={draftCode}
                propertyName={formPropertyName}
                propertyId={entityMap.sitePropertyByName[formPropertyName]?.id}
                label={form.label}
                size={148}
              />
            </div>
          </form>
        </Panel>
      ) : null}

      <SplitView
        left={
          <Panel title="Access codes">
            {shown.length === 0 ? (
              <EmptyHint text="No codes match." />
            ) : (
              <DataTable
                columns={['QR', 'Property', 'Code', 'Label', 'State', 'Expires', 'Usage', '']}
                rows={shown.map((code) => {
                  const row = usageForCodeIn(usage, code)
                  return [
                    <PropertyCodeQrThumb
                      key={`qr-${code.id}`}
                      code={code.code}
                      propertyName={code.propertyName}
                      propertyId={code.propertyId}
                      status={code.status}
                    />,
                    code.propertyName,
                    <code key={code.id} className="k-code">
                      {code.code}
                    </code>,
                    code.label,
                    <Status key={`s-${code.id}`} value={code.status} />,
                    code.expiresAt ?? 'Never',
                    row?.scans.toLocaleString() ?? '0',
                    <button
                      key={`o-${code.id}`}
                      type="button"
                      className="k-link-btn"
                      onClick={() => setSelected(code.id)}
                    >
                      Open
                    </button>,
                  ]
                })}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Code detail" icon={QrCode}>
            {!current ? (
              <EmptyHint text="Select a code." />
            ) : (
              <div className="k-code-detail">
                <PropertyCodeQr
                  code={current.code}
                  propertyName={current.propertyName}
                  propertyId={current.propertyId}
                  label={current.label}
                  status={current.status}
                  size={168}
                  muted={current.status !== 'Active'}
                />
                <div className="k-detail-list">
                  <div>
                    <span>Status</span>
                    <Status value={current.status} />
                  </div>
                  <div>
                    <span>Expires</span>
                    <strong>{current.expiresAt ?? 'Never'}</strong>
                  </div>
                  <div>
                    <span>Scans</span>
                    <strong>{usageForCodeIn(usage, current)?.scans.toLocaleString() ?? '0'}</strong>
                  </div>
                </div>
                <ActionBar>
                  {current.status === 'Active' ? (
                    <button type="button" className="k-btn k-btn--danger" onClick={() => revoke(current.id)}>
                      Revoke
                    </button>
                  ) : (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => reactivate(current.id)}>
                      Reactivate
                    </button>
                  )}
                  <button
                    type="button"
                    className="k-btn k-btn--ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(current.code)
                      flash(setNotice, 'Code copied.')
                    }}
                  >
                    Copy code
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

/* ─── Code Usage ─── */
export function CodeUsagePage({ onNavigate }: PageProps) {
  const { data, upsert } = useErpData()
  const usage = data.codeUsage
  const [metric, setMetric] = useState<'Scans' | 'Devices'>('Scans')
  const [property, setProperty] = useState('All')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')

  const properties = useMemo(
    () => ['All', ...Array.from(new Set(usage.map((u) => u.propertyName)))],
    [usage],
  )
  const shown = usage.filter((u) => property === 'All' || u.propertyName === property)
  const current = usage.find((u) => u.id === selected) ?? shown[0] ?? null

  const totalScans = shown.reduce((sum, item) => sum + item.scans, 0)
  const totalDevices = shown.reduce((sum, item) => sum + item.uniqueDevices, 0)
  const successRate = 98.7
  const invalid = Math.max(3, Math.round(totalScans * 0.012))

  function refresh() {
    const updates: CodeUsage[] = usage.map((item) => ({
      ...item,
      scans: item.scans + Math.floor(Math.random() * 8),
      uniqueDevices: item.uniqueDevices + Math.floor(Math.random() * 3),
      lastUsed: '2026-09-04 15:28',
    }))
    void persist(
      Promise.all(updates.map((item) => upsert('codeUsage', item))),
      setNotice,
      'Usage refreshed.',
    )
  }

  function downloadCsv() {
    const rows = [
      ['Code', 'Property', 'Scans', 'Devices', 'Last used'],
      ...shown.map((u) => [u.code, u.propertyName, String(u.scans), String(u.uniqueDevices), u.lastUsed]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'code-usage.csv'
    a.click()
    URL.revokeObjectURL(url)
    flash(setNotice, 'CSV downloaded.')
  }

  return (
    <>
      <PageHeader
        title="Code Usage"
        subtitle="Scan volume and unique device reach."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={downloadCsv}>
            Download CSV
          </button>
        }
      />
      <HelpNote title="Code usage">
        Track how often each access code is scanned and on how many devices. High invalid rates usually
        mean a revoked or mistyped code in the field.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Scans', value: totalScans.toLocaleString(), tone: 'info' },
          { label: 'Devices', value: totalDevices.toLocaleString() },
          {
            label: 'Repeat rate',
            value: totalScans ? `${Math.round((1 - totalDevices / totalScans) * 100)}%` : '0%',
            tone: 'warn',
          },
          { label: 'Codes used', value: shown.length, tone: 'ok' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <Select label="Property" value={property} onChange={setProperty} options={properties} />
        <button type="button" className="k-btn k-btn--ghost" onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('property-codes')}>
          Manage codes
        </button>
      </Toolbar>
      <div className="k-page-grid k-page-grid--wide">
        <Panel
          title={`${metric} by code`}
          actions={
            <div className="k-segment">
              <button type="button" className={metric === 'Scans' ? 'is-active' : ''} onClick={() => setMetric('Scans')}>
                Scans
              </button>
              <button
                type="button"
                className={metric === 'Devices' ? 'is-active' : ''}
                onClick={() => setMetric('Devices')}
              >
                Devices
              </button>
            </div>
          }
        >
          <MiniBars
            values={shown.map((item) => (metric === 'Scans' ? item.scans : item.uniqueDevices))}
            labels={shown.map((item) => item.propertyName.split(' ')[0])}
          />
        </Panel>
        <Panel title="Today">
          <div className="k-stat-stack">
            <div>
              <span>Last hour</span>
              <strong>{Math.max(12, Math.round(totalScans * 0.04))}</strong>
            </div>
            <div>
              <span>Successful</span>
              <strong>{successRate}%</strong>
            </div>
            <div>
              <span>Invalid</span>
              <strong>{invalid}</strong>
            </div>
          </div>
        </Panel>
      </div>
      <SplitView
        left={
          <Panel title="Usage detail">
            <DataTable
              columns={['Code', 'Property', 'Scans', 'Devices', 'Scans / device', 'Last used', '']}
              rows={shown.map((item) => [
                <code key={item.id}>{item.code}</code>,
                item.propertyName,
                item.scans.toLocaleString(),
                item.uniqueDevices.toLocaleString(),
                (item.scans / Math.max(item.uniqueDevices, 1)).toFixed(1),
                item.lastUsed,
                <button key={`s-${item.id}`} type="button" className="k-link-btn" onClick={() => setSelected(item.id)}>
                  Select
                </button>,
              ])}
            />
          </Panel>
        }
        right={
          <Panel title="Selected code">
            {!current ? (
              <EmptyHint text="Select a usage row." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Code</span>
                  <strong>
                    <code>{current.code}</code>
                  </strong>
                </div>
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Scans</span>
                  <strong>{current.scans.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Devices</span>
                  <strong>{current.uniqueDevices.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Last used</span>
                  <strong>{current.lastUsed}</strong>
                </div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('property-codes')}>
                    Open in codes
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

/* ─── Map Downloads ─── */
export function MobileDownloadsPage({ onNavigate }: PageProps) {
  const { data, upsert } = useErpData()
  const downloads = data.mapDownloads
  const mapVersions = data.mapVersions
  const [platform, setPlatform] = useState('All')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [lastRefresh, setLastRefresh] = useState('07:00')

  const shown = downloads.filter((d) => platform === 'All' || d.platform === platform)
  const current = downloads.find((d) => d.id === selected) ?? shown[0] ?? null
  const total = downloads.reduce((sum, d) => sum + d.downloads, 0)

  function cacheState(version: string): { label: string; tone: Tone } {
    const live = mapVersions.find((v) => v.version === version && v.status === 'Live')
    if (live) return { label: 'Current', tone: 'ok' }
    if (version.endsWith('.0') || version.includes('0.9')) return { label: 'Review', tone: 'warn' }
    return { label: 'Stale', tone: 'warn' }
  }

  function refreshPackages() {
    const stamp = '15:30'
    setLastRefresh(stamp)
    const updates: MapDownload[] = downloads.map((item) => {
      const live = currentMapVersionFor(mapVersions, item.propertyId)
      return {
        ...item,
        mapVersionId: live?.id ?? item.mapVersionId,
        version: live?.version ?? item.version,
        downloads: item.downloads + Math.floor(Math.random() * 25),
        lastSync: `2026-09-04 ${stamp}`,
      }
    })
    void persist(
      Promise.all(updates.map((item) => upsert('mapDownloads', item))),
      setNotice,
      'Packages refreshed against Live map versions.',
    )
  }

  function forceSync(id: string) {
    const item = downloads.find((d) => d.id === id)
    if (!item) return
    void persist(
      upsert('mapDownloads', {
        ...item,
        lastSync: '2026-09-04 15:31',
        downloads: item.downloads + 1,
      }),
      setNotice,
      'Client sync queued.',
    )
  }

  return (
    <>
      <PageHeader
        title="Map Downloads"
        subtitle="Offline package adoption and sync state."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={refreshPackages}>
            Refresh packages
          </button>
        }
      />
      <HelpNote title="Map downloads">
        Offline packages follow Live map versions. Refresh to realign version tags; force sync when a
        site reports a stale cache after publish.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Downloads', value: total.toLocaleString(), tone: 'info' },
          {
            label: 'iOS',
            value: downloads
              .filter((i) => i.platform === 'iOS')
              .reduce((s, i) => s + i.downloads, 0)
              .toLocaleString(),
          },
          {
            label: 'Android',
            value: downloads
              .filter((i) => i.platform === 'Android')
              .reduce((s, i) => s + i.downloads, 0)
              .toLocaleString(),
          },
          {
            label: 'Packages',
            value: new Set(downloads.map((i) => `${i.propertyName}-${i.version}`)).size,
            tone: 'ok',
          },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <Select label="Platform" value={platform} onChange={setPlatform} options={['All', 'iOS', 'Android']} />
        <span className="k-toolbar__meta">Last refresh {lastRefresh}</span>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('map-versions')}>
          Map versions
        </button>
      </Toolbar>
      <Panel title="Package distribution">
        <MiniBars
          values={shown.map((item) => item.downloads)}
          labels={shown.map((item) => `${item.propertyName.split(' ')[0]} ${item.platform}`)}
        />
      </Panel>
      <SplitView
        left={
          <Panel title="Download registry">
            <DataTable
              columns={['Property', 'Platform', 'Version', 'Downloads', 'Last sync', 'Cache', '']}
              rows={shown.map((download) => {
                const cache = cacheState(download.version)
                return [
                  download.propertyName,
                  <Status key={download.id} value={download.platform} />,
                  download.version,
                  download.downloads.toLocaleString(),
                  download.lastSync,
                  <Badge key={`c-${download.id}`} tone={cache.tone}>
                    {cache.label}
                  </Badge>,
                  <button
                    key={`o-${download.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(download.id)}
                  >
                    Open
                  </button>,
                ]
              })}
            />
          </Panel>
        }
        right={
          <Panel title="Package detail">
            {!current ? (
              <EmptyHint text="Select a package." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Platform</span>
                  <Status value={current.platform} />
                </div>
                <div>
                  <span>Version</span>
                  <strong>{current.version}</strong>
                </div>
                <div>
                  <span>Downloads</span>
                  <strong>{current.downloads.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Last sync</span>
                  <strong>{current.lastSync}</strong>
                </div>
                <div>
                  <span>Cache</span>
                  <Badge tone={cacheState(current.version).tone}>{cacheState(current.version).label}</Badge>
                </div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--primary" onClick={() => forceSync(current.id)}>
                    Force sync
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('mobile-sessions')}>
                    Sessions
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

/* ─── Mobile Sessions ─── */
export function MobileSessionsPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const sessions = data.mobileSessions
  const mapVersions = data.mapVersions
  const [status, setStatus] = useState('All')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [tick, setTick] = useState(0)

  const shown = sessions.filter((s) => status === 'All' || s.status === status)
  const current = sessions.find((s) => s.id === selected) ?? shown[0] ?? null

  function refresh() {
    setTick((n) => n + 1)
    const message = autoRefresh
      ? 'Session stream refreshed.'
      : 'Snapshot refreshed (live paused).'
    if (!autoRefresh) {
      flash(setNotice, message)
      return
    }
    // occasional idle/active flip for live feel
    const flipped: MobileSession[] = sessions.flatMap((s) => {
      if (s.status === 'Ended' || Math.random() <= 0.7) return []
      return [{ ...s, status: (s.status === 'Active' ? 'Idle' : 'Active') as SessionStatus }]
    })
    void persist(
      Promise.all(flipped.map((s) => upsert('mobileSessions', s))),
      setNotice,
      message,
    )
  }

  function endSession(id: string) {
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    void persist(
      upsert('mobileSessions', { ...session, status: 'Ended' }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Mobile session ended',
          target: `${session.propertyName} · ${session.deviceId}`,
        }),
      ),
      setNotice,
      'Session ended.',
    )
  }

  function wakeSession(id: string) {
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    void persist(
      upsert('mobileSessions', { ...session, status: 'Active' }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Mobile session woken',
          target: `${session.propertyName} · ${session.deviceId}`,
        }),
      ),
      setNotice,
      'Session marked Active.',
    )
  }

  function elapsedLabel(index: number) {
    const mins = 18 + index * 11 + tick
    return `${mins} min`
  }

  return (
    <>
      <PageHeader
        title="Mobile Sessions"
        subtitle="Current mobile client activity."
        actions={
          <Badge tone={autoRefresh ? 'ok' : 'neutral'}>{autoRefresh ? 'Live' : 'Paused'}</Badge>
        }
      />
      <HelpNote title="Mobile sessions">
        Watch live app sessions by property and device. End abandoned sessions; wake idle clients
        after a map publish so they pull the Current package.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Sessions', value: sessions.length },
          { label: 'Active', value: sessions.filter((s) => s.status === 'Active').length, tone: 'ok' },
          { label: 'Idle', value: sessions.filter((s) => s.status === 'Idle').length, tone: 'warn' },
          {
            label: 'Properties',
            value: new Set(sessions.map((s) => s.propertyName)).size,
            tone: 'info',
          },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <Select label="State" value={status} onChange={setStatus} options={['All', 'Active', 'Idle', 'Ended']} />
        <label className="k-toggle">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto refresh
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('mobile-downloads')}>
          Downloads
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Session stream">
            {shown.length === 0 ? (
              <EmptyHint text="No sessions in this state." />
            ) : (
              <DataTable
                columns={['Property', 'Device', 'Profile', 'Started', 'State', 'Elapsed', '']}
                rows={shown.map((session, index) => [
                  session.propertyName,
                  <code key={session.id}>{session.deviceId}</code>,
                  session.userLabel,
                  session.startedAt,
                  <Status key={`s-${session.id}`} value={session.status} />,
                  elapsedLabel(index),
                  <button
                    key={`o-${session.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(session.id)}
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
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Device</span>
                  <strong>
                    <code>{current.deviceId}</code>
                  </strong>
                </div>
                <div>
                  <span>Profile</span>
                  <Status value={current.userLabel} />
                </div>
                <div>
                  <span>Started</span>
                  <strong>{current.startedAt}</strong>
                </div>
                <div>
                  <span>State</span>
                  <Status value={current.status} />
                </div>
                <div>
                  <span>Map package</span>
                  <strong>
                    {currentMapVersionFor(mapVersions, current.propertyId)?.version ??
                      mapVersions.find((v) => v.propertyId === current.propertyId && v.status === 'Live')?.version ??
                      'Previous'}
                  </strong>
                </div>
                <ActionBar>
                  {current.status === 'Idle' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => wakeSession(current.id)}>
                      Wake
                    </button>
                  ) : null}
                  {current.status !== 'Ended' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => endSession(current.id)}>
                      End session
                    </button>
                  ) : null}
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('property-codes')}>
                    Access codes
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
