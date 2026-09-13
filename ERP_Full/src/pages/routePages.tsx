import { useMemo, useState, type FormEvent } from 'react'
import type { PageId } from '../app/nav'
import type { MapLocation, RouteStatus } from '../data/erpData'
import { useErpData } from '../data/ErpDataProvider'
import { BuildingBlueprint3D } from '../maps/BuildingBlueprint3D'
import {
  buildRouteName,
  computeRouteStats,
  hydrateRoutes,
  locationsForProperty,
  nextRouteId,
  propertyLabelForLocation,
  routeStatuses,
  type ManagedRoute,
} from '../maps/routeEngine'
import { RoutePreviewMap } from '../maps/RoutePreviewMap'
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
import './routePages.css'

type PageProps = { onNavigate?: (page: PageId) => void }

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

function tone(status: string): Tone {
  if (status === 'Active') return 'ok'
  if (status === 'Draft') return 'warn'
  if (status === 'Disabled') return 'danger'
  return 'neutral'
}

function Status({ value }: { value: string }) {
  return <Badge tone={tone(value)}>{value}</Badge>
}

function locLabel(locations: MapLocation[], id: string) {
  const loc = locations.find((l) => l.id === id)
  if (!loc) return id
  return `${loc.name} · ${loc.buildingName} · ${loc.floorLabel}`
}

export function RoutesPage({ onNavigate }: PageProps) {
  const { data, upsert, remove, logAudit } = useErpData()
  const { locations } = data
  const propertyOptions = useMemo(
    () => [
      ...data.complexes.map((c) => c.name),
      ...Array.from(new Set(locations.filter((l) => !l.complexId).map((l) => l.buildingName))),
    ],
    [data.complexes, locations],
  )
  const list = useMemo(() => hydrateRoutes(data.routes, locations), [data.routes, locations])
  const [status, setStatus] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    name: '',
    propertyName: '',
    fromLocationId: '',
    toLocationId: '',
    status: 'Draft' as RouteStatus,
  })

  const locOptionLabel = (id: string) => locLabel(locations, id)

  const shown = list.filter(
    (route) =>
      (status === 'All' || route.status === status) &&
      `${route.name} ${route.propertyName}`.toLowerCase().includes(query.toLowerCase()),
  )

  const active = list.filter((route) => route.status === 'Active')
  const avgDuration =
    active.length === 0
      ? 0
      : active.reduce((sum, route) => sum + route.avgDurationMin, 0) / active.length

  const current =
    (selected ? list.find((route) => route.id === selected) : null) ?? list[0] ?? null
  const currentStats = useMemo(() => {
    if (!current?.fromLocationId || !current?.toLocationId) return null
    const from = locations.find((l) => l.id === current.fromLocationId)
    const to = locations.find((l) => l.id === current.toLocationId)
    if (!from || !to) return null
    return computeRouteStats(from, to, locations, false)
  }, [current, locations])

  const propertyLocs = locationsForProperty(form.propertyName, locations)

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 2400)
  }

  async function persist(op: Promise<unknown>, okMsg: string) {
    try {
      await op
      flash(okMsg)
    } catch {
      flash('Saved locally — Firestore sync failed.')
    }
  }

  function openCreate() {
    setForm({
      name: 'New route',
      propertyName: '',
      fromLocationId: '',
      toLocationId: '',
      status: 'Draft',
    })
    setCreating(true)
    setEditing(false)
  }

  function openEdit() {
    if (!current) return
    setForm({
      name: current.name,
      propertyName: current.propertyName,
      fromLocationId: current.fromLocationId,
      toLocationId: current.toLocationId,
      status: current.status,
    })
    setEditing(true)
    setCreating(false)
  }

  function saveForm(event: FormEvent) {
    event.preventDefault()
    const from = locations.find((l) => l.id === form.fromLocationId)
    const to = locations.find((l) => l.id === form.toLocationId)
    if (!from || !to) {
      flash('Pick valid from and to locations.')
      return
    }
    if (from.id === to.id) {
      flash('From and to must differ.')
      return
    }
    const stats = computeRouteStats(from, to, locations, false)
    const propertyName = propertyLabelForLocation(from)
    const name = form.name.trim() || buildRouteName(from, to)

    if (creating) {
      const id = nextRouteId(list)
      const next: ManagedRoute = {
        id,
        propertyId: from.propertyId,
        propertyName,
        name,
        status: form.status,
        fromLocationId: from.id,
        toLocationId: to.id,
        waypoints: stats.waypoints,
        avgDurationMin: form.status === 'Draft' ? 0 : stats.durationMin,
      }
      setSelected(id)
      setCreating(false)
      void persist(
        upsert('routes', next).then(() =>
          logAudit({ actorUserId: null, actor: 'ERP User', action: 'Route created', target: name }),
        ),
        'Route created.',
      )
      return
    }

    if (editing && current) {
      const next: ManagedRoute = {
        ...current,
        name,
        propertyId: from.propertyId,
        propertyName,
        status: form.status,
        fromLocationId: from.id,
        toLocationId: to.id,
        waypoints: stats.waypoints,
        avgDurationMin: form.status === 'Draft' ? 0 : stats.durationMin,
      }
      setEditing(false)
      void persist(
        upsert('routes', next).then(() =>
          logAudit({ actorUserId: null, actor: 'ERP User', action: 'Route updated', target: name }),
        ),
        'Route updated.',
      )
    }
  }

  function recomputeAll() {
    const updates = list.flatMap((route) => {
      const from = locations.find((l) => l.id === route.fromLocationId)
      const to = locations.find((l) => l.id === route.toLocationId)
      if (!from || !to) return []
      const stats = computeRouteStats(from, to, locations, false)
      return [
        {
          ...route,
          waypoints: stats.waypoints,
          avgDurationMin: route.status === 'Draft' ? route.avgDurationMin : stats.durationMin,
        },
      ]
    })
    void persist(
      Promise.all(updates.map((route) => upsert('routes', route))),
      'All routes recomputed from coordinates.',
    )
  }

  function setRouteStatus(next: RouteStatus) {
    if (!current) return
    const from = locations.find((l) => l.id === current.fromLocationId)
    const to = locations.find((l) => l.id === current.toLocationId)
    const stats = from && to ? computeRouteStats(from, to, locations, false) : null
    const updated: ManagedRoute = {
      ...current,
      status: next,
      avgDurationMin: next === 'Draft' ? 0 : stats?.durationMin ?? current.avgDurationMin,
      waypoints: stats?.waypoints ?? current.waypoints,
    }
    void persist(
      upsert('routes', updated).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Route marked ${next}`,
          target: current.name,
        }),
      ),
      `Marked ${next}.`,
    )
  }

  function removeRoute() {
    if (!current) return
    const removed = current
    setSelected(null)
    setEditing(false)
    void persist(
      remove('routes', removed.id).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Route deleted',
          target: removed.name,
        }),
      ),
      'Route deleted.',
    )
  }

  return (
    <>
      <PageHeader
        title="Route Management"
        subtitle="Named paths built from unit coordinates."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={openCreate}>
            Create route
          </button>
        }
      />
      <aside className="k-help-note" aria-label="Route management help">
        <strong>Dynamic routes</strong>
        <div>
          Pick From / To locations. Waypoints and duration recompute from lat / lng / elevation.
          Preview opens the live step map for the selected route.
        </div>
      </aside>
      <KpiRow
        items={[
          { label: 'Routes', value: list.length },
          { label: 'Active', value: active.length, tone: 'ok' },
          { label: 'Draft', value: list.filter((r) => r.status === 'Draft').length, tone: 'warn' },
          { label: 'Avg duration', value: `${avgDuration.toFixed(1)} min`, tone: 'info' },
          { label: 'Waypoints', value: list.reduce((sum, r) => sum + r.waypoints, 0) },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search routes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="k-compact-field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {['All', ...routeStatuses].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <button type="button" className="k-btn k-btn--ghost" onClick={recomputeAll}>
          Validate all
        </button>
      </Toolbar>

      {(creating || editing) && (
        <Panel title={creating ? 'Create route' : 'Edit route'}>
          <form onSubmit={saveForm}>
            <FormGrid>
              <Field label="Property">
                <select
                  required
                  value={form.propertyName}
                  onChange={(event) => {
                    const propertyName = event.target.value
                    setForm({
                      propertyName,
                      fromLocationId: '',
                      toLocationId: '',
                      name: form.name === 'New route' || !form.name ? 'New route' : form.name,
                      status: form.status,
                    })
                  }}
                >
                  <option value="">Select</option>
                  {propertyOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Route name">
                <input
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                  required
                />
              </Field>
              <Field label="From">
                <select
                  required
                  value={form.fromLocationId}
                  onChange={(event) => {
                    const fromLocationId = event.target.value
                    const from = locations.find((l) => l.id === fromLocationId)
                    const to = locations.find((l) => l.id === form.toLocationId)
                    setForm((f) => ({
                      ...f,
                      fromLocationId,
                      name: from && to ? buildRouteName(from, to) : f.name,
                    }))
                  }}
                >
                  <option value="">Select</option>
                  {propertyLocs.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {locOptionLabel(loc.id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To">
                <select
                  required
                  value={form.toLocationId}
                  onChange={(event) => {
                    const toLocationId = event.target.value
                    const from = locations.find((l) => l.id === form.fromLocationId)
                    const to = locations.find((l) => l.id === toLocationId)
                    setForm((f) => ({
                      ...f,
                      toLocationId,
                      name: from && to ? buildRouteName(from, to) : f.name,
                    }))
                  }}
                >
                  <option value="">Select</option>
                  {propertyLocs.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {locOptionLabel(loc.id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={form.status}
                  onChange={(event) => setForm((f) => ({ ...f, status: event.target.value as RouteStatus }))}
                >
                  {routeStatuses.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            {form.fromLocationId && form.toLocationId ? (
              <p className="k-muted">
                {(() => {
                  const from = locations.find((l) => l.id === form.fromLocationId)
                  const to = locations.find((l) => l.id === form.toLocationId)
                  if (!from || !to) return 'Select endpoints.'
                  const stats = computeRouteStats(from, to, locations, false)
                  return `Computed: ${stats.waypoints} waypoints · ${stats.distanceM} m · ~${stats.durationMin} min`
                })()}
              </p>
            ) : null}
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Save
              </button>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                onClick={() => {
                  setCreating(false)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </ActionBar>
          </form>
        </Panel>
      )}

      <SplitView
        left={
          <Panel title="Route registry">
            {shown.length === 0 ? (
              <EmptyHint text="No routes match." />
            ) : (
              <DataTable
                columns={['Property', 'Route', 'Nodes', 'State', 'Duration', '']}
                rows={shown.map((route) => [
                  route.propertyName,
                  route.name,
                  route.waypoints,
                  <Status key={route.id} value={route.status} />,
                  route.avgDurationMin ? `${route.avgDurationMin} min` : '—',
                  <button
                    key={`o-${route.id}`}
                    type="button"
                    className="k-link-btn"
                    onClick={() => setSelected(route.id)}
                  >
                    Select
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Selected route">
            {!current ? (
              <EmptyHint text="Select a route." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Name</span>
                  <strong>{current.name}</strong>
                </div>
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>From</span>
                  <strong>{locOptionLabel(current.fromLocationId)}</strong>
                </div>
                <div>
                  <span>To</span>
                  <strong>{locOptionLabel(current.toLocationId)}</strong>
                </div>
                <div>
                  <span>Waypoints</span>
                  <strong>{currentStats?.waypoints ?? current.waypoints}</strong>
                </div>
                <div>
                  <span>Distance</span>
                  <strong>{currentStats ? `${currentStats.distanceM} m` : '—'}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>
                    {current.avgDurationMin
                      ? `${current.avgDurationMin} min`
                      : currentStats
                        ? `~${currentStats.durationMin} min`
                        : '—'}
                  </strong>
                </div>
                <div>
                  <span>Status</span>
                  <Status value={current.status} />
                </div>
                {currentStats ? (
                  <ol className="k-route-mini-steps">
                    {currentStats.stops.map((stop, index) => (
                      <li key={`${stop.id}-${index}`}>
                        {index + 1}. {stop.name}
                        <small>
                          {stop.buildingName} · {stop.floorLabel}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="k-muted">Endpoints not resolved for this route.</p>
                )}
                <ActionBar>
                  <button
                    type="button"
                    className="k-btn k-btn--primary"
                    onClick={() => {
                      sessionStorage.setItem('keiros.previewRouteId', current.id)
                      onNavigate?.('route-preview')
                    }}
                    disabled={!current.fromLocationId}
                  >
                    Preview
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={openEdit}>
                    Edit
                  </button>
                  {current.status !== 'Active' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setRouteStatus('Active')}>
                      Activate
                    </button>
                  ) : (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setRouteStatus('Disabled')}>
                      Disable
                    </button>
                  )}
                  <button type="button" className="k-link-btn k-link-btn--danger" onClick={removeRoute}>
                    Delete
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

export function RoutePreviewPage({ onNavigate }: PageProps) {
  const { data } = useErpData()
  const { buildings, floors, locations } = data
  const hydrated = useMemo(() => hydrateRoutes(data.routes, locations), [data.routes, locations])
  const [routeId, setRouteId] = useState(() => sessionStorage.getItem('keiros.previewRouteId') ?? '')
  const [accessible, setAccessible] = useState(false)
  const [step, setStep] = useState(0)
  const [tick, setTick] = useState(0)
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('3D')

  const route = hydrated.find((item) => item.id === routeId) ?? hydrated[0]

  const stats = useMemo(() => {
    if (!route?.fromLocationId || !route?.toLocationId) return null
    const from = locations.find((l) => l.id === route.fromLocationId)
    const to = locations.find((l) => l.id === route.toLocationId)
    if (!from || !to) return null
    return computeRouteStats(from, to, locations, accessible)
    // tick forces recompute button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, accessible, tick, locations])

  const stops = stats?.stops ?? []
  const activeStop = stops[Math.min(step, Math.max(stops.length - 1, 0))]
  const previewBuilding = useMemo(() => {
    if (!activeStop) return buildings[0]
    return buildings.find((b) => b.id === activeStop.buildingId) ?? buildings[0]
  }, [activeStop, buildings])

  function exportSteps() {
    if (!route || !stats) return
    const lines = [
      `Route: ${route.name}`,
      `Property: ${route.propertyName}`,
      `Mode: ${accessible ? 'Accessible' : 'Standard'}`,
      `Distance: ${stats.distanceM} m`,
      `Estimate: ${stats.durationMin} min`,
      '',
      ...stops.map(
        (stop, index) =>
          `${index + 1}. ${stop.name} (${stop.buildingName}, ${stop.floorLabel}, ${stop.type}) [${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}]`,
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${route.id}-steps.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!route) {
    return (
      <>
        <PageHeader title="Route Preview" subtitle="Step through a saved route." />
        <EmptyHint text="No routes available. Create one in Route Management." />
        <button type="button" className="k-btn" onClick={() => onNavigate?.('routes')}>
          Open Route Management
        </button>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Route Preview"
        subtitle="Walk the path in 3D blueprint or 2D map."
        actions={
          <div className="k-route-preview-actions">
            <div className="k-segment">
              <button
                type="button"
                className={viewMode === '2D' ? 'is-active' : ''}
                onClick={() => setViewMode('2D')}
              >
                2D
              </button>
              <button
                type="button"
                className={viewMode === '3D' ? 'is-active' : ''}
                onClick={() => setViewMode('3D')}
              >
                3D
              </button>
            </div>
            <button type="button" className="k-btn k-btn--ghost" onClick={exportSteps} disabled={!stats}>
              Export steps
            </button>
          </div>
        }
      />
      <aside className="k-help-note" aria-label="Route preview help">
        <strong>3D route preview</strong>
        <div>
          Default view is the building blueprint with the yellow path through floors. Drag to orbit,
          scroll to zoom. Switch to 2D for the OSM overlay. Accessible mode prefers elevators.
        </div>
      </aside>
      <Toolbar>
        <label className="k-compact-field">
          <span>Route</span>
          <select
            value={route.id}
            onChange={(event) => {
              setRouteId(event.target.value)
              setStep(0)
            }}
          >
            {hydrated.map((item) => (
              <option key={item.id} value={item.id}>
                {item.propertyName} — {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="k-toggle">
          <input
            type="checkbox"
            checked={accessible}
            onChange={(event) => {
              setAccessible(event.target.checked)
              setStep(0)
            }}
          />
          Accessible
        </label>
        <button
          type="button"
          className="k-btn k-btn--primary"
          onClick={() => {
            setTick((n) => n + 1)
            setStep(0)
          }}
        >
          Recompute
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('routes')}>
          Manage routes
        </button>
      </Toolbar>

      <SplitView
        left={
          <Panel
            title={`${route.propertyName} · ${viewMode} · ${previewBuilding?.name ?? 'Building'}`}
            className="k-route-map-panel"
          >
            {!stops.length ? (
              <EmptyHint text="Could not resolve endpoints for this route." />
            ) : viewMode === '3D' && previewBuilding ? (
              <BuildingBlueprint3D
                key={`${previewBuilding.id}-${route.id}`}
                building={previewBuilding}
                floors={floors}
                locations={locations}
                selectedFloorId={activeStop?.floorId ?? null}
                selectedUnitId={activeStop?.id ?? null}
                showLabels
                routeStops={stops}
                activeRouteIndex={Math.min(step, stops.length - 1)}
                onSelectRouteStep={setStep}
                onSelectFloor={(floorId) => {
                  const idx = stops.findIndex((s) => s.floorId === floorId)
                  if (idx >= 0) setStep(idx)
                }}
                onSelectUnit={(unitId) => {
                  const idx = stops.findIndex((s) => s.id === unitId)
                  if (idx >= 0) setStep(idx)
                }}
              />
            ) : (
              <RoutePreviewMap stops={stops} activeIndex={Math.min(step, stops.length - 1)} />
            )}
          </Panel>
        }
        right={
          <Panel title="Directions">
            <div className="k-route-summary">
              <div>
                <span>Distance</span>
                <strong>{stats ? `${stats.distanceM} m` : '—'}</strong>
              </div>
              <div>
                <span>Estimate</span>
                <strong>{stats ? `${stats.durationMin} min` : '—'}</strong>
              </div>
              <div>
                <span>Floors</span>
                <strong>{stats?.floors ?? '—'}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>{accessible ? 'Accessible' : 'Standard'}</strong>
              </div>
            </div>
            {stops.length === 0 ? (
              <EmptyHint text="No steps." />
            ) : (
              <ol className="k-step-list">
                {stops.map((item, index) => {
                  const next = stops[index + 1]
                  const segmentM = next
                    ? Math.round(
                        Math.hypot(
                          (next.latitude - item.latitude) * 111320,
                          (next.longitude - item.longitude) *
                            111320 *
                            Math.cos((item.latitude * Math.PI) / 180),
                        ),
                      )
                    : 0
                  return (
                    <li
                      key={`${item.id}-${index}`}
                      className={index === step ? 'is-active' : ''}
                      onClick={() => setStep(index)}
                    >
                      <span>{index + 1}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {index === stops.length - 1
                            ? 'Destination'
                            : `${segmentM} m · ${item.buildingName} · ${item.floorLabel}`}
                        </small>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            <ActionBar>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                disabled={step <= 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={step >= stops.length - 1}
                onClick={() => setStep((s) => Math.min(stops.length - 1, s + 1))}
              >
                Next
              </button>
            </ActionBar>
          </Panel>
        }
      />
    </>
  )
}
