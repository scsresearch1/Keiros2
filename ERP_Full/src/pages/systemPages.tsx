import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { PageId } from '../app/nav'
import type { AlertSeverity, ServiceHealth, SystemHealthService } from '../data/erpData'
import { useErpData, type ErpSettings } from '../data/ErpDataProvider'
import {
  ActionBar,
  Badge,
  DataTable,
  EmptyHint,
  Field,
  FormGrid,
  KpiRow,
  PageHeader,
  Panel,
  SplitView,
  Toolbar,
} from '../ui/primitives'
import './pages.css'

type PageProps = { onNavigate?: (page: PageId) => void }
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

function healthTone(health: ServiceHealth): Tone {
  if (health === 'Healthy') return 'ok'
  if (health === 'Degraded') return 'warn'
  return 'danger'
}

function alertTone(severity: AlertSeverity): Tone {
  if (severity === 'Critical') return 'danger'
  if (severity === 'Warning') return 'warn'
  if (severity === 'Info') return 'info'
  return 'neutral'
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
  window.setTimeout(() => setNotice(''), 2800)
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const body = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n')
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ─── Reports ─── */
const REPORT_TYPES = [
  { id: 'mapping', label: 'Mapping progress', desc: 'Floor coverage and queue status.', page: 'mapping-quality' as PageId },
  { id: 'routing', label: 'Routing performance', desc: 'Route completion and duration.', page: 'journey-tracking' as PageId },
  { id: 'mobile', label: 'Mobile usage', desc: 'Downloads, sessions, code scans.', page: 'mobile-sessions' as PageId },
  { id: 'dwell', label: 'Dwell time', desc: 'Zone visits and peak hours.', page: 'dwell-time' as PageId },
  { id: 'api', label: 'API usage', desc: 'Requests, errors, latency.', page: 'api-usage' as PageId },
  { id: 'readiness', label: 'Property readiness', desc: 'Readiness scores by property.', page: 'properties' as PageId },
] as const

type ReportJob = {
  id: string
  reportType: (typeof REPORT_TYPES)[number]['id']
  label: string
  propertyId: string
  propertyName: string
  period: string
  status: 'Queued' | 'Running' | 'Ready' | 'Failed'
  createdAt: string
}

const PERIODS = ['Today', 'Last 7 days', 'Last 30 days', 'Sep 1–4, 2026']

export function ReportsPage({ onNavigate }: PageProps) {
  const { data } = useErpData()
  const siteProperties = data.siteProperties
  const [propertyId, setPropertyId] = useState('all')
  const [period, setPeriod] = useState(PERIODS[2])
  const [jobs, setJobs] = useState<ReportJob[]>([
    {
      id: 'rj-001',
      reportType: 'api',
      label: 'API usage',
      propertyId: 'all',
      propertyName: 'All properties',
      period: 'Last 7 days',
      status: 'Ready',
      createdAt: '2026-09-04 06:10',
    },
    {
      id: 'rj-002',
      reportType: 'mapping',
      label: 'Mapping progress',
      propertyId: siteProperties[0]?.id ?? 'all',
      propertyName: siteProperties[0]?.name ?? 'Portfolio',
      period: 'Last 30 days',
      status: 'Ready',
      createdAt: '2026-09-03 18:42',
    },
  ])
  const [selected, setSelected] = useState(jobs[0]?.id ?? '')
  const [notice, setNotice] = useState('')

  const current = jobs.find((j) => j.id === selected) ?? jobs[0] ?? null
  const readyCount = jobs.filter((j) => j.status === 'Ready').length

  function queueReport(typeId: (typeof REPORT_TYPES)[number]['id']) {
    const meta = REPORT_TYPES.find((r) => r.id === typeId)!
    const prop =
      propertyId === 'all'
        ? { id: 'all', name: 'All properties' }
        : siteProperties.find((p) => p.id === propertyId) ?? { id: 'all', name: 'All properties' }
    const id = `rj-${String(jobs.length + 1).padStart(3, '0')}`
    const job: ReportJob = {
      id,
      reportType: typeId,
      label: meta.label,
      propertyId: prop.id,
      propertyName: prop.name,
      period,
      status: 'Running',
      createdAt: '2026-09-04 07:40',
    }
    setJobs((list) => [job, ...list])
    setSelected(id)
    flash(setNotice, `${meta.label} queued.`)
    window.setTimeout(() => {
      setJobs((list) => list.map((j) => (j.id === id ? { ...j, status: 'Ready' } : j)))
      flash(setNotice, `${meta.label} ready to download.`)
    }, 900)
  }

  function downloadJob(job: ReportJob) {
    if (job.status !== 'Ready') {
      flash(setNotice, 'Wait until the job is Ready.')
      return
    }
    downloadCsv(
      `keiros-${job.reportType}-${job.period.replace(/\s+/g, '-').toLowerCase()}.csv`,
      ['Metric', 'Value', 'Property', 'Period'],
      [
        ['Report', job.label, job.propertyName, job.period],
        ['Sample rows', '12', job.propertyName, job.period],
        ['Generated', job.createdAt, job.propertyName, job.period],
      ],
    )
    flash(setNotice, `Downloaded ${job.label}.`)
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate exports by category." />
      <HelpNote title="Reports">
        Pick a scope and period, then generate. Jobs stay listed until you download; open the related
        live page when you need interactive drill-down instead of a static export.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Templates', value: REPORT_TYPES.length },
          { label: 'Jobs', value: jobs.length },
          { label: 'Ready', value: readyCount, tone: 'ok' },
          { label: 'Running', value: jobs.filter((j) => j.status === 'Running').length, tone: 'info' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <label className="k-compact-field">
          <span>Property</span>
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="all">All properties</option>
            {siteProperties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Select label="Period" value={period} onChange={setPeriod} options={[...PERIODS]} />
      </Toolbar>
      <div className="k-report-grid">
        {REPORT_TYPES.map((r) => (
          <article key={r.id} className="k-report-card">
            <h3>{r.label}</h3>
            <p>{r.desc}</p>
            <ActionBar>
              <button type="button" className="k-btn k-btn--primary" onClick={() => queueReport(r.id)}>
                Generate
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.(r.page)}>
                Open live
              </button>
            </ActionBar>
          </article>
        ))}
      </div>
      <SplitView
        left={
          <Panel title="Job history">
            {jobs.length === 0 ? (
              <EmptyHint text="No report jobs yet." />
            ) : (
              <DataTable
                columns={['Report', 'Scope', 'Period', 'Status', 'Created']}
                rows={jobs.map((j) => [
                  <button key={j.id} type="button" className="k-link-btn" onClick={() => setSelected(j.id)}>
                    {j.label}
                  </button>,
                  j.propertyName,
                  j.period,
                  <Badge
                    key={`s-${j.id}`}
                    tone={j.status === 'Ready' ? 'ok' : j.status === 'Failed' ? 'danger' : 'info'}
                  >
                    {j.status}
                  </Badge>,
                  j.createdAt,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Selected job">
            {!current ? (
              <EmptyHint text="Select a job." />
            ) : (
              <>
                <div className="k-detail-list">
                  <div>
                    <span>Report</span>
                    <p>{current.label}</p>
                  </div>
                  <div>
                    <span>Scope</span>
                    <p>{current.propertyName}</p>
                  </div>
                  <div>
                    <span>Period</span>
                    <p>{current.period}</p>
                  </div>
                  <div>
                    <span>Status</span>
                    <p>{current.status}</p>
                  </div>
                </div>
                <ActionBar>
                  <button
                    type="button"
                    className="k-btn k-btn--primary"
                    disabled={current.status !== 'Ready'}
                    onClick={() => downloadJob(current)}
                  >
                    Download CSV
                  </button>
                </ActionBar>
              </>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Audit Logs ─── */
export function AuditLogsPage({ onNavigate }: PageProps) {
  const { data } = useErpData()
  const logs = data.auditLogs
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('All')
  const [actor, setActor] = useState('All')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')

  const actions = useMemo(
    () => ['All', ...Array.from(new Set(logs.map((l) => l.action))).sort()],
    [logs],
  )
  const actors = useMemo(
    () => ['All', ...Array.from(new Set(logs.map((l) => l.actor))).sort()],
    [logs],
  )

  const shown = logs.filter(
    (l) =>
      (action === 'All' || l.action === action) &&
      (actor === 'All' || l.actor === actor) &&
      `${l.actor} ${l.action} ${l.target} ${l.ip}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = logs.find((l) => l.id === selected) ?? shown[0] ?? null

  function exportLogs() {
    downloadCsv(
      'keiros-audit-logs.csv',
      ['Time', 'Actor', 'Action', 'Target', 'IP', 'ActorUserId'],
      shown.map((l) => [l.timestamp, l.actor, l.action, l.target, l.ip, l.actorUserId ?? '']),
    )
    flash(setNotice, `Exported ${shown.length} audit rows.`)
  }

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="User actions and system changes."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={exportLogs}>
            Export CSV
          </button>
        }
      />
      <HelpNote title="Audit logs">
        Immutable trail of privileged and configuration changes. Filter by actor or action, then
        export the filtered set for compliance reviews. Actor names resolve from user records when
        available.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Events', value: logs.length },
          { label: 'Shown', value: shown.length, tone: 'info' },
          { label: 'Actors', value: actors.length - 1 },
          { label: 'Actions', value: actions.length - 1 },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search actor, action, target, IP"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Action" value={action} onChange={setAction} options={actions} />
        <Select label="Actor" value={actor} onChange={setActor} options={actors} />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('users')}>
          Users
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Recent activity">
            {shown.length === 0 ? (
              <EmptyHint text="No events match the filters." />
            ) : (
              <DataTable
                columns={['Time', 'Actor', 'Action', 'Target', 'IP']}
                rows={shown.map((log) => [
                  <button
                    key={log.id}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(log.id)}
                  >
                    {log.timestamp}
                  </button>,
                  log.actor,
                  log.action,
                  log.target,
                  log.ip,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Event detail">
            {!current ? (
              <EmptyHint text="Select an event." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Time</span>
                  <p>{current.timestamp}</p>
                </div>
                <div>
                  <span>Actor</span>
                  <p>{current.actor}</p>
                </div>
                <div>
                  <span>User id</span>
                  <p>{current.actorUserId ?? '—'}</p>
                </div>
                <div>
                  <span>Action</span>
                  <p>{current.action}</p>
                </div>
                <div>
                  <span>Target</span>
                  <p>{current.target}</p>
                </div>
                <div>
                  <span>IP</span>
                  <p>{current.ip}</p>
                </div>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Alerts ─── */
export function AlertsPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const items = data.alerts
  const [severity, setSeverity] = useState('All')
  const [ack, setAck] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => items.find((a) => !a.acknowledged)?.id ?? '')
  const [notice, setNotice] = useState('')

  const shown = items.filter(
    (a) =>
      (severity === 'All' || a.severity === severity) &&
      (ack === 'All' || (ack === 'Open' ? !a.acknowledged : a.acknowledged)) &&
      `${a.title} ${a.source}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = items.find((a) => a.id === selected) ?? shown[0] ?? null
  const openCritical = items.filter((a) => !a.acknowledged && a.severity === 'Critical').length
  const openWarn = items.filter((a) => !a.acknowledged && a.severity === 'Warning').length

  async function setAckState(id: string, acknowledged: boolean) {
    const base = items.find((a) => a.id === id)
    if (!base) return
    try {
      await upsert('alerts', { ...base, acknowledged })
      await logAudit({
        actorUserId: null,
        actor: 'ERP operator',
        action: acknowledged ? 'alert.acknowledge' : 'alert.reopen',
        target: id,
      })
      flash(setNotice, acknowledged ? 'Alert acknowledged.' : 'Alert reopened.')
    } catch {
      flash(setNotice, 'Alert state could not be saved.')
    }
  }

  async function ackAllOpen() {
    const open = items.filter((a) => !a.acknowledged)
    if (!open.length) {
      flash(setNotice, 'No open alerts.')
      return
    }
    try {
      await Promise.all(open.map((a) => upsert('alerts', { ...a, acknowledged: true })))
      await logAudit({
        actorUserId: null,
        actor: 'ERP operator',
        action: 'alert.acknowledge_all',
        target: `${open.length} alerts`,
      })
      flash(setNotice, 'All open alerts acknowledged.')
    } catch {
      flash(setNotice, 'Bulk acknowledge could not be saved.')
    }
  }

  const relatedService = current?.serviceId
    ? data.systemHealthServices.find((s) => s.id === current.serviceId)
    : null

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Active system alerts by severity."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={() => void ackAllOpen()}>
            Ack all open
          </button>
        }
      />
      <HelpNote title="Alerts">
        Operational signals from services and mapping jobs. Acknowledge only after the underlying
        issue is owned; Critical items should be reviewed against System Health before closing.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Open', value: items.filter((a) => !a.acknowledged).length, tone: 'warn' },
          { label: 'Critical', value: openCritical, tone: openCritical ? 'danger' : 'ok' },
          { label: 'Warning', value: openWarn, tone: openWarn ? 'warn' : 'ok' },
          { label: 'Shown', value: shown.length, tone: 'info' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search title or source"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          label="Severity"
          value={severity}
          onChange={setSeverity}
          options={['All', 'Critical', 'Warning', 'Info']}
        />
        <Select label="State" value={ack} onChange={setAck} options={['All', 'Open', 'Acknowledged']} />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('system-health')}>
          System health
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Alerts">
            {shown.length === 0 ? (
              <EmptyHint text="No alerts match the filters." />
            ) : (
              <DataTable
                columns={['Title', 'Source', 'Severity', 'Triggered', 'Ack']}
                rows={shown.map((a) => [
                  <button key={a.id} type="button" className="k-link-btn" onClick={() => setSelected(a.id)}>
                    {a.title}
                  </button>,
                  a.source,
                  <Badge key={`sev-${a.id}`} tone={alertTone(a.severity)}>
                    {a.severity}
                  </Badge>,
                  a.triggeredAt,
                  a.acknowledged ? 'Yes' : 'No',
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Alert detail">
            {!current ? (
              <EmptyHint text="Select an alert." />
            ) : (
              <>
                <div className="k-detail-list">
                  <div>
                    <span>Title</span>
                    <p>{current.title}</p>
                  </div>
                  <div>
                    <span>Source</span>
                    <p>{current.source}</p>
                  </div>
                  <div>
                    <span>Severity</span>
                    <p>{current.severity}</p>
                  </div>
                  <div>
                    <span>Triggered</span>
                    <p>{current.triggeredAt}</p>
                  </div>
                  <div>
                    <span>Service</span>
                    <p>{relatedService?.name ?? '—'}</p>
                  </div>
                  <div>
                    <span>State</span>
                    <p>{current.acknowledged ? 'Acknowledged' : 'Open'}</p>
                  </div>
                </div>
                <ActionBar>
                  {current.acknowledged ? (
                    <button
                      type="button"
                      className="k-btn k-btn--ghost"
                      onClick={() => void setAckState(current.id, false)}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="k-btn k-btn--primary"
                      onClick={() => void setAckState(current.id, true)}
                    >
                      Acknowledge
                    </button>
                  )}
                  {current.serviceId ? (
                    <button
                      type="button"
                      className="k-btn k-btn--ghost"
                      onClick={() => onNavigate?.('system-health')}
                    >
                      View service
                    </button>
                  ) : null}
                </ActionBar>
              </>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── System Health ─── */
export function SystemHealthPage({ onNavigate }: PageProps) {
  const { data, upsert } = useErpData()
  const services = data.systemHealthServices
  const [selected, setSelected] = useState(() => services.find((s) => s.health !== 'Healthy')?.id ?? '')
  const [notice, setNotice] = useState('')
  const [auto, setAuto] = useState(false)

  const current = services.find((s) => s.id === selected) ?? services[0] ?? null
  const relatedAlerts = data.alerts.filter((a) => a.serviceId === current?.id)

  async function refresh() {
    const next = services
      .filter((s) => s.health !== 'Down')
      .map<SystemHealthService>((s) => {
        const jitter = Math.round((Math.random() - 0.4) * 18)
        return {
          ...s,
          latencyMs: Math.max(8, s.latencyMs + jitter),
          uptimePct: Number(Math.min(99.99, Math.max(90, s.uptimePct + (Math.random() - 0.5) * 0.04)).toFixed(2)),
        }
      })
    try {
      await Promise.all(next.map((s) => upsert('systemHealthServices', s)))
      flash(setNotice, 'Health metrics refreshed.')
    } catch {
      flash(setNotice, 'Health refresh could not be saved.')
    }
  }

  function toggleAuto() {
    setAuto((v) => !v)
    flash(setNotice, !auto ? 'Auto-refresh on (simulated).' : 'Auto-refresh off.')
  }

  return (
    <>
      <PageHeader
        title="System Health"
        subtitle="Service status and uptime."
        actions={
          <ActionBar>
            <button type="button" className="k-btn k-btn--ghost" onClick={toggleAuto}>
              {auto ? 'Auto: On' : 'Auto: Off'}
            </button>
            <button type="button" className="k-btn k-btn--primary" onClick={() => void refresh()}>
              Refresh
            </button>
          </ActionBar>
        }
      />
      <HelpNote title="System health">
        Live posture of core platform services. Degraded or Down entries usually correlate with open
        Alerts—refresh to sample latency, then open Alerts for ownership.
      </HelpNote>
      <KpiRow
        items={[
          {
            label: 'Healthy',
            value: services.filter((s) => s.health === 'Healthy').length,
            tone: 'ok',
          },
          {
            label: 'Degraded',
            value: services.filter((s) => s.health === 'Degraded').length,
            tone: 'warn',
          },
          {
            label: 'Down',
            value: services.filter((s) => s.health === 'Down').length,
            tone: 'danger',
          },
          {
            label: 'Avg latency',
            value: `${Math.round(services.reduce((n, s) => n + s.latencyMs, 0) / Math.max(1, services.length))} ms`,
            tone: 'info',
          },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <div className="k-health-grid">
        {services.map((svc) => (
          <article
            key={svc.id}
            className={`k-health-card k-health-card--${healthTone(svc.health)}${selected === svc.id ? ' k-health-card--selected' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(svc.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setSelected(svc.id)
            }}
          >
            <div className="k-health-card__head">
              <h3>{svc.name}</h3>
              <Badge tone={healthTone(svc.health)}>{svc.health}</Badge>
            </div>
            <dl className="k-health-card__stats">
              <div>
                <dt>Latency</dt>
                <dd>{svc.latencyMs} ms</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{svc.uptimePct}%</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <Panel title="Service detail">
        {!current ? (
          <EmptyHint text="Select a service." />
        ) : (
          <>
            <div className="k-detail-list">
              <div>
                <span>Service</span>
                <p>{current.name}</p>
              </div>
              <div>
                <span>Health</span>
                <p>{current.health}</p>
              </div>
              <div>
                <span>Latency</span>
                <p>{current.latencyMs} ms</p>
              </div>
              <div>
                <span>Uptime</span>
                <p>{current.uptimePct}%</p>
              </div>
              <div>
                <span>Linked alerts</span>
                <p>{relatedAlerts.length}</p>
              </div>
            </div>
            {relatedAlerts.length > 0 ? (
              <ul className="k-tip-list">
                {relatedAlerts.map((a) => (
                  <li key={a.id}>
                    {a.severity}: {a.title}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyHint text="No linked alerts for this service." />
            )}
            <ActionBar>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('alerts')}>
                Open alerts
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-logs')}>
                API logs
              </button>
            </ActionBar>
          </>
        )}
      </Panel>
    </>
  )
}

/* ─── Settings ─── */
export function SettingsPage({ onNavigate }: PageProps) {
  const { data, saveSettings, logAudit } = useErpData()
  const saved = data.erpSettings
  const [form, setForm] = useState<ErpSettings>(saved)
  const [notice, setNotice] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  function patch<K extends keyof ErpSettings>(key: K, value: ErpSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function saveAll() {
    if (!form.codePrefixFormat.trim()) {
      flash(setNotice, 'Code prefix format is required.')
      return
    }
    if (form.defaultCodeExpiryDays < 1 || form.sessionTimeoutMin < 1) {
      flash(setNotice, 'Expiry and session timeout must be at least 1.')
      return
    }
    if (!form.defaultSender.includes('@')) {
      flash(setNotice, 'Default sender must be a valid email.')
      return
    }
    try {
      await saveSettings({ ...form, id: saved.id })
      await logAudit({
        actorUserId: null,
        actor: 'ERP operator',
        action: 'settings.update',
        target: 'erp_settings',
      })
      flash(setNotice, 'Settings saved.')
    } catch {
      flash(setNotice, 'Settings could not be saved.')
    }
  }

  function reset() {
    setForm(saved)
    flash(setNotice, 'Unsaved changes discarded.')
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="ERP configuration."
        actions={
          <ActionBar>
            <button type="button" className="k-btn k-btn--ghost" disabled={!dirty} onClick={reset}>
              Reset
            </button>
            <button type="button" className="k-btn k-btn--primary" disabled={!dirty} onClick={() => void saveAll()}>
              Save all
            </button>
          </ActionBar>
        }
      />
      <HelpNote title="Settings">
        Org-wide defaults for codes, tracking privacy, API limits, and notification delivery. Save
        applies the whole form; Reset restores the last saved snapshot. Changes here do not rewrite
        historical jobs.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      {dirty ? <p className="k-inline-notice">Unsaved changes.</p> : null}
      <Panel title="Property code rules">
        <FormGrid>
          <Field label="Code prefix format">
            <input
              value={form.codePrefixFormat}
              onChange={(e) => patch('codePrefixFormat', e.target.value)}
            />
          </Field>
          <Field label="Default expiry (days)">
            <input
              type="number"
              min={1}
              value={form.defaultCodeExpiryDays}
              onChange={(e) => patch('defaultCodeExpiryDays', Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Allow reuse">
            <select
              value={form.allowCodeReuse ? 'yes' : 'no'}
              onChange={(e) => patch('allowCodeReuse', e.target.value === 'yes')}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </Field>
        </FormGrid>
        <ActionBar>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('property-codes')}>
            Property codes
          </button>
        </ActionBar>
      </Panel>
      <Panel title="Tracking rules">
        <FormGrid>
          <Field label="Session timeout (min)">
            <input
              type="number"
              min={1}
              value={form.sessionTimeoutMin}
              onChange={(e) => patch('sessionTimeoutMin', Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Dwell threshold (min)">
            <input
              type="number"
              min={1}
              value={form.dwellThresholdMin}
              onChange={(e) => patch('dwellThresholdMin', Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Anonymize device IDs">
            <select
              value={form.anonymizeDeviceIds ? 'yes' : 'no'}
              onChange={(e) => patch('anonymizeDeviceIds', e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </FormGrid>
        <ActionBar>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('mobile-sessions')}>
            Mobile sessions
          </button>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('dwell-time')}>
            Dwell-time
          </button>
        </ActionBar>
      </Panel>
      <Panel title="API limits">
        <FormGrid>
          <Field label="Rate limit (req/min)">
            <input
              type="number"
              min={1}
              value={form.apiRateLimitPerMin}
              onChange={(e) => patch('apiRateLimitPerMin', Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Burst limit">
            <input
              type="number"
              min={1}
              value={form.apiBurstLimit}
              onChange={(e) => patch('apiBurstLimit', Number(e.target.value) || 1)}
            />
          </Field>
          <Field label="Key rotation (days)">
            <input
              type="number"
              min={1}
              value={form.keyRotationDays}
              onChange={(e) => patch('keyRotationDays', Number(e.target.value) || 1)}
            />
          </Field>
        </FormGrid>
        <ActionBar>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('api-keys')}>
            API keys
          </button>
        </ActionBar>
      </Panel>
      <Panel title="Notifications">
        <FormGrid>
          <Field label="Default sender">
            <input value={form.defaultSender} onChange={(e) => patch('defaultSender', e.target.value)} />
          </Field>
          <Field label="ERS webhook URL">
            <input value={form.ersWebhookUrl} onChange={(e) => patch('ersWebhookUrl', e.target.value)} />
          </Field>
          <Field label="Digest frequency">
            <select
              value={form.digestFrequency}
              onChange={(e) => patch('digestFrequency', e.target.value as ErpSettings['digestFrequency'])}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
        </FormGrid>
        <ActionBar>
          <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('notifications')}>
            Notifications / ERS
          </button>
        </ActionBar>
      </Panel>
    </>
  )
}

/* ─── Help / Support ─── */
const FAQ = [
  {
    q: 'How do I add a property?',
    a: 'Open Complexes → Add property. Independent buildings use the same SiteProperty model without a parent complex.',
    page: 'properties' as PageId,
  },
  {
    q: 'How do I publish a map?',
    a: 'Clear Approval Queue items, then publish from Map Publishing. Version history stays under Map Versions.',
    page: 'map-publishing' as PageId,
  },
  {
    q: 'How do I rotate an API key?',
    a: 'API Keys → select an active key → Rotate. The previous prefix is marked Rotated; share the new secret once.',
    page: 'api-keys' as PageId,
  },
  {
    q: 'Where are audit logs?',
    a: 'System → Audit Logs. Filter by actor/action and export CSV for compliance packs.',
    page: 'audit-logs' as PageId,
  },
  {
    q: 'Why is mobile access failing?',
    a: 'Check Property Codes expiry and Mobile Sessions. Confirm Settings → session timeout and code reuse policy.',
    page: 'property-codes' as PageId,
  },
]

const TIPS = [
  'Clear browser cache if the map viewer is blank.',
  'Check API Logs for 4xx/5xx errors before contacting support.',
  'Verify property code expiry if mobile access fails.',
  'Confirm reader sync interval if access events are delayed.',
  'Acknowledge Critical alerts only after System Health looks stable.',
]

type Ticket = { id: string; subject: string; topic: string; status: 'Queued' | 'Sent'; createdAt: string }

export function HelpPage({ onNavigate }: PageProps) {
  const [query, setQuery] = useState('')
  const [openFaq, setOpenFaq] = useState<string | null>(FAQ[0]?.q ?? null)
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('Account')
  const [message, setMessage] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [notice, setNotice] = useState('')

  const faqs = FAQ.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(query.toLowerCase()))
  const tips = TIPS.filter((t) => t.toLowerCase().includes(query.toLowerCase()) || !query)

  function submitTicket(event: FormEvent) {
    event.preventDefault()
    if (!subject.trim() || !message.trim()) {
      flash(setNotice, 'Subject and message are required.')
      return
    }
    const id = `tkt-${String(tickets.length + 1).padStart(3, '0')}`
    setTickets((list) => [
      { id, subject: subject.trim(), topic, status: 'Sent', createdAt: '2026-09-04 07:42' },
      ...list,
    ])
    setSubject('')
    setMessage('')
    flash(setNotice, 'Support ticket queued to support@keiros.ai.')
  }

  return (
    <>
      <PageHeader title="Help / Support" subtitle="FAQ and contact." />
      <HelpNote title="Help / Support">
        Search FAQ and troubleshooting first. If you still need help, submit a ticket with topic and
        context—include property id or API client when relevant.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search FAQ or tips"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('settings')}>
          Settings
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('system-health')}>
          System health
        </button>
      </Toolbar>
      <div className="k-page-grid">
        <Panel title="FAQ">
          {faqs.length === 0 ? (
            <EmptyHint text="No FAQ matches." />
          ) : (
            <ul className="k-faq-list">
              {faqs.map((item) => (
                <li key={item.q}>
                  <button
                    type="button"
                    className="k-link-btn"
                    onClick={() => setOpenFaq((q) => (q === item.q ? null : item.q))}
                  >
                    <strong>{item.q}</strong>
                  </button>
                  {openFaq === item.q ? (
                    <>
                      <span>{item.a}</span>
                      <ActionBar>
                        <button
                          type="button"
                          className="k-btn k-btn--ghost"
                          onClick={() => onNavigate?.(item.page)}
                        >
                          Open page
                        </button>
                      </ActionBar>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Contact support">
          <form onSubmit={submitTicket}>
            <FormGrid>
              <Field label="Topic">
                <select value={topic} onChange={(e) => setTopic(e.target.value)}>
                  <option>Account</option>
                  <option>Mapping</option>
                  <option>Mobile access</option>
                  <option>API / integrations</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Subject">
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
              </Field>
              <Field label="Message">
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What happened, property or client id, and steps already tried"
                />
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Submit ticket
              </button>
            </ActionBar>
          </form>
          <p className="k-help-contact">
            Or email <a href="mailto:support@keiros.ai">support@keiros.ai</a>.
          </p>
          {tickets.length > 0 ? (
            <DataTable
              columns={['Ticket', 'Topic', 'Subject', 'Status']}
              rows={tickets.map((t) => [t.id, t.topic, t.subject, t.status])}
            />
          ) : null}
        </Panel>
      </div>
      <Panel title="Troubleshooting">
        <ul className="k-tip-list">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </Panel>
    </>
  )
}
