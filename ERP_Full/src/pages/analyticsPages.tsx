import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { PageId } from '../app/nav'
import type { DwellMetric, Tour } from '../data/erpData'
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
type Period = 'Today' | '7 days' | '30 days' | 'Sep 1-4'
type ChartMetric = 'Completion' | 'Sessions' | 'Duration'

const PREVIEW_ROUTE_KEY = 'keiros.previewRouteId'
const PERIODS: Period[] = ['Today', '7 days', '30 days', 'Sep 1-4']

function completionTone(value: number): Tone {
  if (value >= 90) return 'ok'
  if (value >= 75) return 'warn'
  return 'danger'
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
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function flash(setNotice: (v: string) => void, msg: string) {
  setNotice(msg)
  window.setTimeout(() => setNotice(''), 2600)
}

/** Excel-safe CSV: UTF-8 BOM + CRLF + RFC4180 quoting */
function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','))
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.replace(/[^\w.-]+/g, '_').toLowerCase()
  link.click()
  URL.revokeObjectURL(url)
}

function periodScale(period: string) {
  switch (period) {
    case 'Today':
    case '24 hours':
      return 0.12
    case '7 days':
      return 0.55
    case '30 days':
      return 1.35
    default:
      return 1
  }
}

function safeRate(completions: number, starts: number) {
  if (!starts) return 0
  return Math.round((completions / starts) * 100)
}

function nextId(prefix: string, items: { id: string }[]) {
  const nums = items.map((i) => Number(i.id.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n))
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
}

function setPreviewRoute(routeId: string) {
  try {
    sessionStorage.setItem(PREVIEW_ROUTE_KEY, routeId)
  } catch {
    /* ignore */
  }
}

/* ─── Journey Tracking ─── */
export function JourneyTrackingPage({ onNavigate }: PageProps) {
  const { data, upsert } = useErpData()
  const { sitePropertyById } = useEntityMap()
  const rows = data.journeys
  const [property, setProperty] = useState('All')
  const [period, setPeriod] = useState<Period>('Sep 1-4')
  const [query, setQuery] = useState('')
  const [minCompletion, setMinCompletion] = useState(0)
  const [metric, setMetric] = useState<ChartMetric>('Completion')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')

  const propertyOptions = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((j) => j.propertyName))).sort()],
    [rows],
  )

  const scale = periodScale(period)

  const shown = useMemo(() => {
    return rows
      .filter(
        (journey) =>
          (property === 'All' || journey.propertyName === property) &&
          journey.completionRate >= minCompletion &&
          `${journey.propertyName} ${journey.routeName} ${journey.routeId}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      )
      .map((journey) => ({
        ...journey,
        sessions: Math.max(1, Math.round(journey.sessions * scale)),
        avgDurationMin: Math.round(journey.avgDurationMin * (period === 'Today' ? 0.96 : 1) * 10) / 10,
      }))
  }, [rows, property, minCompletion, query, scale, period])

  const current = shown.find((j) => j.id === selected) ?? shown[0] ?? null
  const totalSessions = shown.reduce((sum, j) => sum + j.sessions, 0)
  const weightedCompletion = totalSessions
    ? Math.round(shown.reduce((sum, j) => sum + j.completionRate * j.sessions, 0) / totalSessions)
    : 0
  const avgDuration = shown.length
    ? shown.reduce((sum, j) => sum + j.avgDurationMin, 0) / shown.length
    : 0
  const atRisk = shown.filter((j) => j.completionRate < 80).length

  const chartValues = shown.map((item) => {
    if (metric === 'Sessions') return item.sessions
    if (metric === 'Duration') return item.avgDurationMin
    return item.completionRate
  })

  async function refresh() {
    const next = rows.map((item) => ({
      ...item,
      sessions: item.sessions + Math.floor(Math.random() * 12),
      completionRate: Math.min(99, Math.max(55, item.completionRate + (Math.random() > 0.5 ? 1 : -1))),
      avgDurationMin: Math.round((item.avgDurationMin + (Math.random() * 0.4 - 0.2)) * 10) / 10,
    }))
    try {
      await Promise.all(next.map((item) => upsert('journeys', item)))
      flash(setNotice, 'Journey metrics refreshed.')
    } catch {
      flash(setNotice, 'Refresh could not be saved.')
    }
  }

  function exportReport() {
    downloadCsv(
      `journey-tracking-${period}.csv`,
      ['Property ID', 'Property', 'Route ID', 'Route', 'Sessions', 'Completion %', 'Avg duration (min)', 'Period'],
      shown.map((j) => [
        j.propertyId,
        j.propertyName,
        j.routeId,
        j.routeName,
        j.sessions,
        j.completionRate,
        j.avgDurationMin,
        period,
      ]),
    )
    flash(setNotice, `Exported ${shown.length} journey rows.`)
  }

  const linkedRoute = current ? data.routes.find((r) => r.id === current.routeId) : null
  const site = current ? sitePropertyById[current.propertyId] : null

  return (
    <>
      <PageHeader
        title="Journey Tracking"
        subtitle="Route starts, completions, and duration."
        actions={
          <ActionBar>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => void refresh()}>
              Refresh
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportReport} disabled={!shown.length}>
              Export CSV
            </button>
          </ActionBar>
        }
      />
      <HelpNote title="Journey tracking">
        Measure how often published routes are started and finished. Low completion usually means a
        broken waypoint, unclear signage, or a Draft route still in the field. Export uses the
        filtered rows currently on screen.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Journeys', value: totalSessions.toLocaleString(), tone: 'info' },
          { label: 'Completion', value: `${weightedCompletion}%`, tone: completionTone(weightedCompletion) },
          { label: 'Avg duration', value: `${avgDuration.toFixed(1)} min` },
          { label: 'At risk', value: atRisk, tone: atRisk ? 'warn' : 'ok' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search property or route"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Property" value={property} onChange={setProperty} options={propertyOptions} />
        <Select label="Period" value={period} onChange={(v) => setPeriod(v as Period)} options={PERIODS} />
        <label className="k-range">
          Min completion
          <input
            type="range"
            min={0}
            max={95}
            step={5}
            value={minCompletion}
            onChange={(e) => setMinCompletion(Number(e.target.value))}
          />
          <strong>{minCompletion}%</strong>
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('routes')}>
          Routes
        </button>
      </Toolbar>

      <div className="k-page-grid k-page-grid--wide">
        <Panel
          title={`${metric} by route`}
          actions={
            <div className="k-segment">
              {(['Completion', 'Sessions', 'Duration'] as ChartMetric[]).map((option) => (
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
            <MiniBars
              values={chartValues}
              labels={shown.map((item) => item.routeName.split(' ')[0] || item.propertyName.split(' ')[0])}
            />
          ) : (
            <EmptyHint text="No journeys match the filters." />
          )}
        </Panel>
        <Panel title="Period snapshot">
          <div className="k-stat-stack">
            <div>
              <span>Window</span>
              <strong>{period}</strong>
            </div>
            <div>
              <span>Routes in view</span>
              <strong>{shown.length}</strong>
            </div>
            <div>
              <span>Scale factor</span>
              <strong>×{scale.toFixed(2)}</strong>
            </div>
          </div>
        </Panel>
      </div>

      <SplitView
        left={
          <Panel title="Journey detail">
            {shown.length === 0 ? (
              <EmptyHint text="No journeys match." />
            ) : (
              <DataTable
                columns={['Property', 'Route', 'Sessions', 'Completion', 'Avg duration', '']}
                rows={shown.map((journey) => [
                  journey.propertyName,
                  journey.routeName,
                  journey.sessions.toLocaleString(),
                  <Badge key={journey.id} tone={completionTone(journey.completionRate)}>
                    {journey.completionRate}%
                  </Badge>,
                  `${journey.avgDurationMin} min`,
                  <button
                    key={`o-${journey.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(journey.id)}
                  >
                    Open
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Selected journey">
            {!current ? (
              <EmptyHint text="Select a journey." />
            ) : (
              <>
                <div className="k-detail-list">
                  <div>
                    <span>Property</span>
                    <strong>{current.propertyName}</strong>
                  </div>
                  <div>
                    <span>Property ID</span>
                    <code className="k-code">{current.propertyId}</code>
                  </div>
                  <div>
                    <span>Route</span>
                    <strong>{current.routeName}</strong>
                  </div>
                  <div>
                    <span>Route ID</span>
                    <code className="k-code">{current.routeId}</code>
                  </div>
                  <div>
                    <span>Sessions</span>
                    <strong>{current.sessions.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Completion</span>
                    <Badge tone={completionTone(current.completionRate)}>{current.completionRate}%</Badge>
                  </div>
                  <div>
                    <span>Avg duration</span>
                    <strong>{current.avgDurationMin} min</strong>
                  </div>
                  <div>
                    <span>Route status</span>
                    <strong>{linkedRoute?.status ?? '—'}</strong>
                  </div>
                  <div>
                    <span>Site kind</span>
                    <strong>{site?.kind ?? '—'}</strong>
                  </div>
                </div>
                <ActionBar>
                  <button
                    type="button"
                    className="k-btn k-btn--primary"
                    onClick={() => {
                      setPreviewRoute(current.routeId)
                      onNavigate?.('route-preview')
                    }}
                  >
                    Route preview
                  </button>
                  <button
                    type="button"
                    className="k-btn k-btn--ghost"
                    onClick={() => {
                      setPreviewRoute(current.routeId)
                      onNavigate?.('routes')
                    }}
                  >
                    Edit route
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

/* ─── Dwell-Time ─── */
export function DwellTimePage({ onNavigate }: PageProps) {
  const { data, upsert, refresh, loading } = useErpData()
  const rows = data.dwellMetrics
  const [threshold, setThreshold] = useState(0)
  const [property, setProperty] = useState('All')
  const [period, setPeriod] = useState<Period>('7 days')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [configuring, setConfiguring] = useState(false)
  const [notice, setNotice] = useState('')
  const [liveOnly, setLiveOnly] = useState(false)
  const [lastRefresh, setLastRefresh] = useState('')

  useEffect(() => {
    const tick = window.setInterval(() => {
      void refresh().then(() => setLastRefresh(new Date().toLocaleTimeString()))
    }, 5000)
    return () => window.clearInterval(tick)
  }, [refresh])

  const propertyOptions = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.propertyName))).sort()],
    [rows],
  )
  const scale = periodScale(period)

  const liveCount = rows.filter((r) => (r.activeVisitors ?? 0) > 0 || r.source === 'TOUR_APP').length

  const shown = useMemo(() => {
    return rows
      .filter(
        (metric) =>
          metric.avgDwellMin >= threshold &&
          (property === 'All' || metric.propertyName === property) &&
          (!liveOnly || metric.source === 'TOUR_APP' || (metric.activeVisitors ?? 0) > 0) &&
          `${metric.zone} ${metric.propertyName} ${metric.locationId}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      )
      .map((metric) => ({
        ...metric,
        visits: Math.max(metric.visits || 0, metric.source === 'TOUR_APP' ? metric.visits : Math.max(1, Math.round(metric.visits * scale))),
      }))
      .sort((a, b) => {
        const aLive = a.activeVisitors ?? 0
        const bLive = b.activeVisitors ?? 0
        if (aLive !== bLive) return bLive - aLive
        const aTs = a.liveUpdatedAt ? Date.parse(a.liveUpdatedAt) : 0
        const bTs = b.liveUpdatedAt ? Date.parse(b.liveUpdatedAt) : 0
        return bTs - aTs
      })
  }, [rows, threshold, property, query, scale, liveOnly])

  const current = shown.find((m) => m.id === selected) ?? shown[0] ?? null
  const totalVisits = shown.reduce((sum, m) => sum + m.visits, 0)
  const avgDwell = shown.length
    ? shown.reduce((sum, m) => sum + m.avgDwellMin, 0) / shown.length
    : 0
  const longest = shown.length ? Math.max(...shown.map((m) => m.avgDwellMin)) : 0

  function exportCsv() {
    downloadCsv(
      `dwell-time-${period}.csv`,
      ['Property ID', 'Property', 'Location ID', 'Zone', 'Avg dwell (min)', 'Visits', 'Peak hour', 'Period', 'Min dwell filter'],
      shown.map((m) => [
        m.propertyId,
        m.propertyName,
        m.locationId,
        m.zone,
        m.avgDwellMin,
        m.visits,
        m.peakHour,
        period,
        threshold,
      ]),
    )
    flash(setNotice, `Exported ${shown.length} zone rows.`)
  }

  async function toggleZoneWatch(id: string) {
    const base = rows.find((item) => item.id === id)
    if (!base) return
    const next: DwellMetric = {
      ...base,
      zone: base.zone.endsWith(' ★') ? base.zone.replace(/ ★$/, '') : `${base.zone} ★`,
    }
    try {
      await upsert('dwellMetrics', next)
      flash(setNotice, 'Zone watchlist updated.')
    } catch {
      flash(setNotice, 'Watchlist update could not be saved.')
    }
  }

  async function renameZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('zone') ?? '').trim()
    if (!name) {
      flash(setNotice, 'Zone name is required.')
      return
    }
    const base = rows.find((item) => item.id === current.id)
    if (!base) return
    try {
      await upsert('dwellMetrics', { ...base, zone: name })
      flash(setNotice, 'Zone label saved.')
      setConfiguring(false)
    } catch {
      flash(setNotice, 'Zone label could not be saved.')
    }
  }

  return (
    <>
      <PageHeader
        title="Dwell-Time"
        subtitle="Zone occupancy and visit duration — includes live Tour App telemetry."
        actions={
          <ActionBar>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => void refresh()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh now'}
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={() => setConfiguring((v) => !v)}>
              {configuring ? 'Close zones' : 'Configure zones'}
            </button>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv} disabled={!shown.length}>
              Export CSV
            </button>
          </ActionBar>
        }
      />
      <HelpNote title="Dwell-time">
        Tour App posts dwell enter / heartbeat / leave to <code>POST /api/v1/tracking/dwell</code>. This page
        auto-refreshes every 5s from Firestore. Live rows show current zone dwell seconds and active visitors.
        {lastRefresh ? ` Last refresh ${lastRefresh}.` : ''}
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Tracked visits', value: totalVisits.toLocaleString(), tone: 'info' },
          { label: 'Avg dwell', value: `${avgDwell.toFixed(1)} min` },
          { label: 'Longest', value: `${longest} min`, tone: longest > 20 ? 'warn' : 'ok' },
          { label: 'Live tour zones', value: liveCount, tone: liveCount ? 'ok' : 'neutral' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search zone or property"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Property" value={property} onChange={setProperty} options={propertyOptions} />
        <Select label="Period" value={period} onChange={(v) => setPeriod(v as Period)} options={PERIODS} />
        <label className="k-range">
          Min dwell
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <strong>{threshold} min</strong>
        </label>
        <label className="k-check">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
          Tour App live only
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('locations')}>
          Locations
        </button>
      </Toolbar>

      {configuring && current ? (
        <Panel title="Configure selected zone">
          <form onSubmit={(event) => void renameZone(event)}>
            <FormGrid>
              <Field label="Zone label">
                <input name="zone" defaultValue={current.zone.replace(/ ★$/, '')} key={current.id} />
              </Field>
              <Field label="Location ID">
                <input value={current.locationId} readOnly />
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Save label
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => void toggleZoneWatch(current.id)}>
                {current.zone.includes('★') ? 'Unwatch' : 'Watch zone'}
              </button>
            </ActionBar>
          </form>
        </Panel>
      ) : null}

      <div className="k-page-grid k-page-grid--wide">
        <Panel title="Dwell by zone">
          {shown.length ? (
            <MiniBars
              values={shown.map((m) => m.avgDwellMin)}
              labels={shown.map((m) => m.zone.replace(/ ★$/, '').split(' ')[0])}
            />
          ) : (
            <EmptyHint text="No zones meet this threshold." />
          )}
        </Panel>
        <Panel title="Peak windows">
          <div className="k-stat-stack">
            {shown.slice(0, 4).map((metric) => (
              <div key={metric.id}>
                <span>{metric.zone}</span>
                <strong>{metric.peakHour}</strong>
              </div>
            ))}
            {!shown.length ? <EmptyHint text="No peak data." /> : null}
          </div>
        </Panel>
      </div>

      <SplitView
        left={
          <Panel title="Zones above threshold">
            {shown.length ? (
              <DataTable
                columns={['Property', 'Zone', 'Avg dwell', 'Live now', 'Visits', 'Peak hour', 'Flag', '']}
                rows={shown.map((metric) => [
                  metric.propertyName,
                  metric.zone,
                  `${metric.avgDwellMin} min`,
                  (metric.activeVisitors ?? 0) > 0 || metric.liveDwellSec != null ? (
                    <span key={`live-${metric.id}`}>
                      <Badge tone="ok">Live</Badge>{' '}
                      {Math.floor((metric.liveDwellSec ?? 0) / 60)}m {(metric.liveDwellSec ?? 0) % 60}s
                      {(metric.activeVisitors ?? 0) > 0 ? ` · ${metric.activeVisitors} active` : ''}
                    </span>
                  ) : (
                    '—'
                  ),
                  metric.visits.toLocaleString(),
                  metric.peakHour,
                  <Badge key={metric.id} tone={metric.avgDwellMin > 20 ? 'warn' : metric.source === 'TOUR_APP' ? 'ok' : 'info'}>
                    {metric.source === 'TOUR_APP' ? 'Tour' : metric.avgDwellMin > 20 ? 'Long' : 'Normal'}
                  </Badge>,
                  <button
                    key={`o-${metric.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(metric.id)}
                  >
                    Open
                  </button>,
                ])}
              />
            ) : (
              <EmptyHint text="No zones meet this threshold." />
            )}
          </Panel>
        }
        right={
          <Panel title="Selected zone">
            {!current ? (
              <EmptyHint text="Select a zone." />
            ) : (
              <>
                <div className="k-detail-list">
                  <div>
                    <span>Zone</span>
                    <strong>{current.zone}</strong>
                  </div>
                  <div>
                    <span>Property</span>
                    <strong>{current.propertyName}</strong>
                  </div>
                  <div>
                    <span>Location ID</span>
                    <code className="k-code">{current.locationId}</code>
                  </div>
                  <div>
                    <span>Live dwell</span>
                    <strong>
                      {current.liveDwellSec != null
                        ? `${Math.floor(current.liveDwellSec / 60)}m ${current.liveDwellSec % 60}s`
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>Active visitors</span>
                    <strong>{current.activeVisitors ?? 0}</strong>
                  </div>
                  <div>
                    <span>Last update</span>
                    <strong>
                      {current.liveUpdatedAt
                        ? new Date(current.liveUpdatedAt).toLocaleString()
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>Avg dwell</span>
                    <strong>{current.avgDwellMin} min</strong>
                  </div>
                  <div>
                    <span>Visits</span>
                    <strong>{current.visits.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Peak hour</span>
                    <strong>{current.peakHour}</strong>
                  </div>
                </div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => setConfiguring(true)}>
                    Configure
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('locations')}>
                    Open locations
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

/* ─── Tour Activity ─── */
export function TourActivityPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const rows = data.tours
  const siteProperties = data.siteProperties
  const [selected, setSelected] = useState('')
  const [property, setProperty] = useState('All')
  const [period, setPeriod] = useState<Period>('7 days')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    tourName: '',
    propertyId: siteProperties[0]?.id ?? '',
    avgSteps: 6,
  })

  const propertyOptions = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.propertyName))).sort()],
    [rows],
  )
  const scale = periodScale(period)

  const shown = useMemo(() => {
    return rows
      .filter(
        (tour) =>
          (property === 'All' || tour.propertyName === property) &&
          `${tour.tourName} ${tour.propertyName}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
      .map((tour) => ({
        ...tour,
        starts: Math.max(1, Math.round(tour.starts * scale)),
        completions: Math.max(0, Math.round(tour.completions * scale)),
      }))
  }, [rows, property, query, scale])

  const current = shown.find((t) => t.id === selected) ?? shown[0] ?? null
  const totalStarts = shown.reduce((sum, t) => sum + t.starts, 0)
  const totalCompletions = shown.reduce((sum, t) => sum + t.completions, 0)
  const avgSteps = shown.length
    ? Math.round(shown.reduce((sum, t) => sum + t.avgSteps, 0) / shown.length)
    : 0

  async function createTour(event: FormEvent) {
    event.preventDefault()
    const site = siteProperties.find((p) => p.id === form.propertyId)
    if (!form.tourName.trim() || !site) {
      flash(setNotice, 'Tour name and property are required.')
      return
    }
    const id = nextId('tr', rows)
    const item: Tour = {
      id,
      propertyId: site.id,
      propertyName: site.name,
      tourName: form.tourName.trim(),
      starts: 0,
      completions: 0,
      avgSteps: Math.max(1, form.avgSteps),
    }
    try {
      await upsert('tours', item)
      await logAudit({ actorUserId: null, actor: 'ERP operator', action: 'tour.create', target: item.id })
      setSelected(id)
      setCreating(false)
      setForm({ tourName: '', propertyId: siteProperties[0]?.id ?? '', avgSteps: 6 })
      flash(setNotice, `Tour “${item.tourName}” created.`)
    } catch {
      flash(setNotice, 'Tour could not be saved.')
    }
  }

  function exportCsv() {
    downloadCsv(
      `tour-activity-${period}.csv`,
      ['Tour ID', 'Tour', 'Property ID', 'Property', 'Starts', 'Completions', 'Completion %', 'Avg steps', 'Period'],
      shown.map((t) => [
        t.id,
        t.tourName,
        t.propertyId,
        t.propertyName,
        t.starts,
        t.completions,
        safeRate(t.completions, t.starts),
        t.avgSteps,
        period,
      ]),
    )
    flash(setNotice, `Exported ${shown.length} tour rows.`)
  }

  return (
    <>
      <PageHeader
        title="Tour Activity"
        subtitle="Guided tour starts and completion."
        actions={
          <ActionBar>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv} disabled={!shown.length}>
              Export CSV
            </button>
            <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
              Create tour
            </button>
          </ActionBar>
        }
      />
      <HelpNote title="Tour activity">
        Guided tours are curated paths (distinct from free-form routes). Track starts vs completions
        to spot drop-off; create a tour here for planning, then wire waypoints in Route Management.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Starts', value: totalStarts.toLocaleString(), tone: 'info' },
          { label: 'Completions', value: totalCompletions.toLocaleString(), tone: 'ok' },
          { label: 'Tours', value: shown.length },
          { label: 'Avg steps', value: avgSteps },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search tour or property"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Property" value={property} onChange={setProperty} options={propertyOptions} />
        <Select label="Period" value={period} onChange={(v) => setPeriod(v as Period)} options={PERIODS} />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('routes')}>
          Routes
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="Create tour">
          <form onSubmit={(event) => void createTour(event)}>
            <FormGrid>
              <Field label="Tour name">
                <input
                  value={form.tourName}
                  onChange={(e) => setForm((f) => ({ ...f, tourName: e.target.value }))}
                  placeholder="e.g. Amenity orientation"
                />
              </Field>
              <Field label="Property">
                <select
                  value={form.propertyId}
                  onChange={(e) => setForm((f) => ({ ...f, propertyId: e.target.value }))}
                >
                  {siteProperties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Avg steps">
                <input
                  type="number"
                  min={1}
                  value={form.avgSteps}
                  onChange={(e) => setForm((f) => ({ ...f, avgSteps: Number(e.target.value) || 1 }))}
                />
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Save tour
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
          <Panel title="Tour performance">
            {shown.length === 0 ? (
              <EmptyHint text="No tours match." />
            ) : (
              <DataTable
                columns={['Tour', 'Property', 'Starts', 'Completion', '']}
                rows={shown.map((item) => {
                  const rate = safeRate(item.completions, item.starts)
                  return [
                    item.tourName,
                    item.propertyName,
                    item.starts.toLocaleString(),
                    <Badge key={item.id} tone={completionTone(rate)}>
                      {rate}%
                    </Badge>,
                    <button
                      key={`v-${item.id}`}
                      type="button"
                      className="k-link-btn"
                      onClick={() => setSelected(item.id)}
                    >
                      Inspect
                    </button>,
                  ]
                })}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Tour summary">
            {!current ? (
              <EmptyHint text="Select a tour." />
            ) : (
              <>
                <div className="k-detail-list">
                  <div>
                    <span>Tour</span>
                    <strong>{current.tourName}</strong>
                  </div>
                  <div>
                    <span>Property</span>
                    <strong>{current.propertyName}</strong>
                  </div>
                  <div>
                    <span>Property ID</span>
                    <code className="k-code">{current.propertyId}</code>
                  </div>
                  <div>
                    <span>Starts</span>
                    <strong>{current.starts.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Completions</span>
                    <strong>{current.completions.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Completion</span>
                    <Badge tone={completionTone(safeRate(current.completions, current.starts))}>
                      {safeRate(current.completions, current.starts)}%
                    </Badge>
                  </div>
                  <div>
                    <span>Average steps</span>
                    <strong>{current.avgSteps}</strong>
                  </div>
                </div>
                <MiniBars values={[current.starts, current.completions]} labels={['Starts', 'Complete']} />
                <ActionBar>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('routes')}>
                    Manage routes
                  </button>
                  <button
                    type="button"
                    className="k-btn k-btn--ghost"
                    onClick={() => onNavigate?.('journey-tracking')}
                  >
                    Journey tracking
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

/* ─── Tenant Activity ─── */
export function TenantActivityPage({ onNavigate }: PageProps) {
  const { data } = useErpData()
  const rows = data.tenantActivity
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('7 days')
  const [property, setProperty] = useState('All')
  const [minVisits, setMinVisits] = useState(10)
  const [anonymization, setAnonymization] = useState<'Tenant only' | 'Full'>('Tenant only')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')

  const propertyOptions = useMemo(
    () => ['All', ...Array.from(new Set(rows.map((r) => r.propertyName))).sort()],
    [rows],
  )
  const scale = periodScale(period)

  const shown = useMemo(() => {
    return rows
      .filter(
        (item) =>
          (property === 'All' || item.propertyName === property) &&
          item.visits * scale >= minVisits &&
          `${item.tenant} ${item.propertyName} ${item.topDestination}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      )
      .map((item) => {
        const visits = Math.max(1, Math.round(item.visits * scale))
        const tenantLabel =
          anonymization === 'Full' ? `Tenant ${item.id.replace(/\D/g, '')}` : item.tenant
        return { ...item, visits, tenantLabel }
      })
  }, [rows, property, minVisits, query, scale, anonymization])

  const current = shown.find((t) => t.id === selected) ?? shown[0] ?? null
  const totalVisits = shown.reduce((sum, item) => sum + item.visits, 0)

  function exportCsv() {
    downloadCsv(
      `tenant-activity-${period}.csv`,
      [
        'Tenant ID',
        'Tenant',
        'Property ID',
        'Property',
        'Visits',
        'Last visit',
        'Top destination ID',
        'Top destination',
        'Period',
        'Anonymization',
      ],
      shown.map((item) => [
        item.id,
        item.tenantLabel,
        item.propertyId,
        item.propertyName,
        item.visits,
        item.lastVisit,
        item.topDestinationLocationId,
        item.topDestination,
        period,
        anonymization,
      ]),
    )
    flash(setNotice, `Exported ${shown.length} tenant rows.`)
  }

  function applyControls(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setMinVisits(Math.max(0, Number(data.get('minVisits')) || 0))
    setAnonymization((data.get('anonymization') as 'Tenant only' | 'Full') || 'Tenant only')
    flash(setNotice, 'Data controls applied.')
  }

  return (
    <>
      <PageHeader
        title="Tenant Activity"
        subtitle="Tenant visits and destination demand."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv} disabled={!shown.length}>
            Export CSV
          </button>
        }
      />
      <HelpNote title="Tenant activity">
        Demand by tenant and top indoor destination. Period scales visit volume; raise Minimum visits
        to hide noise. Full anonymization replaces tenant names in the UI and CSV.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Visits', value: totalVisits.toLocaleString(), tone: 'info' },
          { label: 'Tenants', value: shown.length },
          {
            label: 'Properties',
            value: new Set(shown.map((item) => item.propertyName)).size,
            tone: 'ok',
          },
          {
            label: 'Top volume',
            value: shown.length ? Math.max(...shown.map((item) => item.visits)).toLocaleString() : 0,
            tone: 'warn',
          },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search tenant or property"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select label="Property" value={property} onChange={setProperty} options={propertyOptions} />
        <Select
          label="Period"
          value={period}
          onChange={setPeriod}
          options={['24 hours', '7 days', '30 days']}
        />
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('properties')}>
          Properties
        </button>
      </Toolbar>

      <div className="k-page-grid k-page-grid--wide">
        <Panel title={`Visits · ${period}`}>
          {shown.length ? (
            <MiniBars
              values={shown.map((item) => item.visits)}
              labels={shown.map((item) => item.tenantLabel.split(' ')[0])}
            />
          ) : (
            <EmptyHint text="No tenants match." />
          )}
        </Panel>
        <Panel title="Destination share">
          <div className="k-stat-stack">
            {shown.slice(0, 4).map((item) => (
              <div key={item.id}>
                <span>{item.topDestination}</span>
                <strong>{Math.round((item.visits / Math.max(totalVisits, 1)) * 100)}%</strong>
              </div>
            ))}
            {!shown.length ? <EmptyHint text="No destination share." /> : null}
          </div>
        </Panel>
      </div>

      <SplitView
        left={
          <Panel title="Tenant directory">
            {shown.length ? (
              <DataTable
                columns={['Tenant', 'Property', 'Visits', 'Last visit', 'Top destination', '']}
                rows={shown.map((item) => [
                  item.tenantLabel,
                  item.propertyName,
                  item.visits.toLocaleString(),
                  item.lastVisit,
                  item.topDestination,
                  <button
                    key={`o-${item.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(item.id)}
                  >
                    Open
                  </button>,
                ])}
              />
            ) : (
              <EmptyHint text="No tenant activity found." />
            )}
          </Panel>
        }
        right={
          <Panel title="Selected tenant">
            {!current ? (
              <EmptyHint text="Select a tenant." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Tenant</span>
                  <strong>{current.tenantLabel}</strong>
                </div>
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Property ID</span>
                  <code className="k-code">{current.propertyId}</code>
                </div>
                <div>
                  <span>Visits</span>
                  <strong>{current.visits.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Last visit</span>
                  <strong>{current.lastVisit}</strong>
                </div>
                <div>
                  <span>Top destination</span>
                  <strong>{current.topDestination}</strong>
                </div>
                <div>
                  <span>Location ID</span>
                  <code className="k-code">{current.topDestinationLocationId}</code>
                </div>
              </div>
            )}
          </Panel>
        }
      />

      <Panel title="Data controls">
        <form onSubmit={applyControls}>
          <FormGrid>
            <Field label="Minimum visits">
              <input name="minVisits" type="number" min={0} defaultValue={minVisits} key={minVisits} />
            </Field>
            <Field label="Anonymization">
              <select name="anonymization" defaultValue={anonymization} key={anonymization}>
                <option>Tenant only</option>
                <option>Full</option>
              </select>
            </Field>
          </FormGrid>
          <ActionBar>
            <button type="submit" className="k-btn k-btn--primary">
              Apply
            </button>
          </ActionBar>
        </form>
      </Panel>
    </>
  )
}
