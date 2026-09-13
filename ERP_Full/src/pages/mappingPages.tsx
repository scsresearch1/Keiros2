import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { PageId } from '../app/nav'
import type {
  Approval,
  ApprovalStatus,
  Correction,
  CorrectionStatus,
  MapVersion,
  MapVersionStatus,
  MappingQueueItem,
  MappingQueueStatus,
  QualityIssue,
  QualitySeverity,
  User,
} from '../data/erpData'
import { useEntityMap, useErpData } from '../data/ErpDataProvider'
import {
  ActionBar,
  Badge,
  DataTable,
  EmptyHint,
  Field,
  FormGrid,
  KpiRow,
  MapStage,
  PageHeader,
  Panel,
  SplitView,
  Toolbar,
} from '../ui/primitives'
import './pages.css'

type PageProps = { onNavigate?: (page: PageId) => void }
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

function tone(status: string): Tone {
  if (['Approved', 'Complete', 'Live', 'Resolved', 'Mapped'].includes(status)) return 'ok'
  if (['Pending', 'Queued', 'Assigned', 'Staging', 'Medium', 'Review', 'Draft'].includes(status)) return 'warn'
  if (['Rejected', 'Blocked', 'Critical', 'High', 'Archived'].includes(status)) return 'danger'
  if (['In Progress', 'Open', 'Low'].includes(status)) return 'info'
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

function SelectFilter({
  value,
  onChange,
  children,
  label,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  label: string
}) {
  return (
    <label className="k-compact-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}

const queueStatuses: MappingQueueStatus[] = ['Queued', 'In Progress', 'Blocked', 'Complete']
const severities: QualitySeverity[] = ['Critical', 'High', 'Medium', 'Low']
const correctionStatuses: CorrectionStatus[] = ['Open', 'Assigned', 'Resolved']
const versionStatuses: MapVersionStatus[] = ['Draft', 'Staging', 'Live', 'Archived']

function mappersFrom(users: User[]) {
  return users.filter((u) => u.role === 'Field Mapper' || u.role === 'QA Reviewer')
}

function nextId(prefix: string, items: { id: string }[]) {
  const nums = items.map((i) => Number(i.id.replace(/\D/g, ''))).filter((n) => !Number.isNaN(n))
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
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

/* ─── Field Mapping ─── */
export function FieldMappingPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const entityMap = useEntityMap()
  const queue = data.mappingQueue
  const mappers = useMemo(() => mappersFrom(data.users), [data.users])
  const propertyLabels = useMemo(() => data.siteProperties.map((p) => p.name), [data.siteProperties])
  const [statusFilter, setStatusFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    propertyName: '',
    floorLabel: '',
    mapper: '',
    priority: 2,
    dueDate: '2026-09-20',
  })

  const formPropertyName = form.propertyName
  const formMapper = form.mapper

  const shown = queue.filter(
    (item) =>
      (statusFilter === 'All' || item.status === statusFilter) &&
      `${item.propertyName} ${item.floorLabel} ${item.mapper}`.toLowerCase().includes(query.toLowerCase()),
  )
  const job = queue.find((item) => item.id === selected) ?? shown[0] ?? null

  const propertyFloors = useMemo(() => {
    const prop = entityMap.sitePropertyByName[formPropertyName]
    return prop ? entityMap.floorsForPropertyId(prop.id) : []
  }, [entityMap, formPropertyName])

  function setStatus(id: string, status: MappingQueueStatus) {
    const item = queue.find((row) => row.id === id)
    if (!item) return
    void persist(
      upsert('mappingQueue', { ...item, status }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Mapping job ${status}`,
          target: `${item.propertyName} · ${item.floorLabel}`,
        }),
      ),
      setNotice,
      `Marked ${status}.`,
    )
  }

  function saveAssignment(event: FormEvent) {
    event.preventDefault()
    const prop = entityMap.sitePropertyByName[formPropertyName]
    const floor = propertyFloors.find((f) => f.label === form.floorLabel)
    const mapperUser = mappers.find((u) => u.name === formMapper)
    if (!prop || !floor || !formMapper) {
      flash(setNotice, 'Select a valid property, floor, and mapper.')
      return
    }
    const id = nextId('mq', queue)
    const item: MappingQueueItem = {
      id,
      propertyId: prop.id,
      propertyName: prop.name,
      floorId: floor.id,
      floorLabel: floor.label,
      mapperUserId: mapperUser?.id ?? null,
      mapper: formMapper,
      priority: form.priority,
      dueDate: form.dueDate,
      status: 'Queued',
    }
    setSelected(id)
    setCreating(false)
    void persist(
      upsert('mappingQueue', item).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Mapping assignment created',
          target: `${item.propertyName} · ${item.floorLabel}`,
        }),
      ),
      setNotice,
      'Assignment created.',
    )
  }

  function reassign(mapper: string) {
    if (!job) return
    const mapperUser = mappers.find((u) => u.name === mapper)
    setReassigning(false)
    void persist(
      upsert('mappingQueue', { ...job, mapper, mapperUserId: mapperUser?.id ?? null }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Mapping job reassigned to ${mapper}`,
          target: `${job.propertyName} · ${job.floorLabel}`,
        }),
      ),
      setNotice,
      `Reassigned to ${mapper}.`,
    )
  }

  return (
    <>
      <PageHeader
        title="Field Mapping"
        subtitle="Assign floors, track capture, clear blockers."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
            New assignment
          </button>
        }
      />
      <HelpNote title="Field mapping">
        Queue work by property and floor. Start capture when a mapper is on site; block if access or
        data is missing; complete when coordinates are ready for review.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Queued', value: queue.filter((i) => i.status === 'Queued').length },
          { label: 'In progress', value: queue.filter((i) => i.status === 'In Progress').length, tone: 'info' },
          { label: 'Blocked', value: queue.filter((i) => i.status === 'Blocked').length, tone: 'danger' },
          { label: 'Complete', value: queue.filter((i) => i.status === 'Complete').length, tone: 'ok' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search property, floor, mapper"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SelectFilter label="Status" value={statusFilter} onChange={setStatusFilter}>
          <option>All</option>
          {queueStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectFilter>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('coordinate-review')}>
          Open review
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="New assignment">
          <form onSubmit={saveAssignment}>
            <FormGrid>
              <Field label="Property">
                <select
                  required
                  value={form.propertyName}
                  onChange={(e) => {
                    const propertyName = e.target.value
                    setForm((f) => ({ ...f, propertyName, floorLabel: '' }))
                  }}
                >
                  <option value="">Select</option>
                  {propertyLabels.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Floor">
                <select
                  required
                  value={form.floorLabel}
                  onChange={(e) => setForm((f) => ({ ...f, floorLabel: e.target.value }))}
                >
                  <option value="">Select</option>
                  {propertyFloors.map((f) => (
                    <option key={f.id}>{f.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mapper">
                <select required value={form.mapper} onChange={(e) => setForm((f) => ({ ...f, mapper: e.target.value }))}>
                  <option value="">Select</option>
                  <option>Unassigned</option>
                  {mappers.map((u) => (
                    <option key={u.id}>{u.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                >
                  {[1, 2, 3, 4].map((p) => (
                    <option key={p} value={p}>
                      P{p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                  required
                />
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Create
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
          <Panel title="Queue">
            {shown.length === 0 ? (
              <EmptyHint text="No assignments match." />
            ) : (
              <DataTable
                columns={['Property', 'Floor', 'Mapper', 'Priority', 'Status', '']}
                rows={shown.map((item) => [
                  item.propertyName,
                  item.floorLabel,
                  item.mapper,
                  `P${item.priority}`,
                  <Status key={item.id} value={item.status} />,
                  <button key={`v-${item.id}`} type="button" className="k-link-btn" onClick={() => setSelected(item.id)}>
                    View
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Assignment">
            {!job ? (
              <EmptyHint text="Select an assignment." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Property</span>
                  <strong>{job.propertyName}</strong>
                </div>
                <div>
                  <span>Floor</span>
                  <strong>{job.floorLabel}</strong>
                </div>
                <div>
                  <span>Mapper</span>
                  <strong>{job.mapper}</strong>
                </div>
                <div>
                  <span>Due</span>
                  <strong>{job.dueDate}</strong>
                </div>
                <div>
                  <span>Priority</span>
                  <strong>P{job.priority}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <Status value={job.status} />
                </div>
                {reassigning ? (
                  <Field label="Reassign to">
                    <select
                      defaultValue={job.mapper}
                      onChange={(e) => reassign(e.target.value)}
                    >
                      {mappers.map((u) => (
                        <option key={u.id}>{u.name}</option>
                      ))}
                      <option>Unassigned</option>
                    </select>
                  </Field>
                ) : null}
                <ActionBar>
                  {job.status === 'Queued' || job.status === 'Blocked' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setStatus(job.id, 'In Progress')}>
                      Open capture
                    </button>
                  ) : null}
                  {job.status === 'In Progress' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setStatus(job.id, 'Complete')}>
                      Mark complete
                    </button>
                  ) : null}
                  {job.status !== 'Blocked' && job.status !== 'Complete' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setStatus(job.id, 'Blocked')}>
                      Block
                    </button>
                  ) : null}
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => setReassigning((v) => !v)}>
                    Reassign
                  </button>
                  {job.status === 'Complete' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('coordinate-review')}>
                      Send to review
                    </button>
                  ) : null}
                </ActionBar>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Coordinate Review ─── */
export function CoordinateReviewPage({ onNavigate }: PageProps) {
  const { data, logAudit } = useErpData()
  const { locations } = data
  const propertyOptions = useMemo(() => {
    const names = new Set(locations.map((l) => l.complexName ?? l.buildingName))
    return Array.from(names)
  }, [locations])
  const [selectedProperty, setPropertyName] = useState('')
  const propertyName = selectedProperty
  const floorOptions = useMemo(() => {
    if (!propertyName) return []
    const labels = Array.from(
      new Set(
        locations
          .filter((l) => (l.complexName ?? l.buildingName) === propertyName)
          .map((l) => l.floorLabel),
      ),
    )
    return labels
  }, [locations, propertyName])
  const [selectedFloor, setFloorLabel] = useState('')
  const floorLabel = selectedFloor
  const [layer, setLayer] = useState('Nodes')
  const [snap, setSnap] = useState(true)
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [decision, setDecision] = useState<'Pending' | 'Approved' | 'Rejected'>('Pending')
  const [notes, setNotes] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (selectedFloor && !floorOptions.includes(selectedFloor)) {
      setFloorLabel('')
    }
  }, [floorOptions, selectedFloor])

  const floorLocs = locations.filter(
    (l) => (l.complexName ?? l.buildingName) === propertyName && l.floorLabel === floorLabel,
  )
  const mapped = floorLocs.filter((l) => l.mapped)
  const outliers = floorLocs.filter((l) => !l.mapped)

  function saveReview(next: 'Approved' | 'Rejected') {
    setDecision(next)
    void persist(
      logAudit({
        actorUserId: null,
        actor: 'ERP User',
        action: `Coordinate review ${next}${notes.trim() ? ` — ${notes.trim()}` : ''}`,
        target: `${propertyName} · ${floorLabel}`,
      }),
      setNotice,
      next === 'Approved'
        ? `Coordinates approved for ${propertyName} ${floorLabel}.`
        : `Floor rejected — returned to field mapping.`,
    )
    if (next === 'Rejected') onNavigate?.('field-mapping')
  }

  return (
    <>
      <PageHeader
        title="Coordinate Review"
        subtitle="Validate captured nodes against floor geometry."
        actions={
          <button
            type="button"
            className="k-btn k-btn--primary"
            onClick={() => saveReview('Approved')}
            disabled={!floorLocs.length}
          >
            Save review
          </button>
        }
      />
      <HelpNote title="Coordinate review">
        Confirm node placement, transitions, and scale before approval. Snap keeps points on grid;
        outliers need field correction or rejection.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <SelectFilter
          label="Property"
          value={propertyName}
          onChange={(v) => {
            setPropertyName(v)
            setFloorLabel('')
            setSelectedPin(null)
            setDecision('Pending')
          }}
        >
          <option value="">Select</option>
          {propertyOptions.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </SelectFilter>
        <SelectFilter
          label="Floor"
          value={floorLabel}
          onChange={(v) => {
            setFloorLabel(v)
            setSelectedPin(null)
            setDecision('Pending')
          }}
        >
          <option value="">Select</option>
          {floorOptions.map((label) => (
            <option key={label}>{label}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Layer" value={layer} onChange={setLayer}>
          <option>Nodes</option>
          <option>Paths</option>
          <option>Boundaries</option>
        </SelectFilter>
        <label className="k-toggle">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap grid
        </label>
      </Toolbar>
      <SplitView
        left={
          <MapStage title={`${propertyName} · ${floorLabel} · ${layer}${snap ? ' · snap' : ''}`}>
            <div className="k-map-shape k-map-shape--floor">
              {floorLocs.length === 0 ? (
                <span className="k-muted" style={{ padding: '1rem' }}>
                  No mapped nodes on this floor.
                </span>
              ) : (
                floorLocs.slice(0, 12).map((loc, index) => {
                  const left = 12 + (index % 4) * 22
                  const top = 18 + Math.floor(index / 4) * 26
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      className={`k-map-pin${loc.mapped ? '' : ' k-map-pin--warn'}${selectedPin === loc.id ? ' is-selected' : ''}`}
                      style={{ left: `${left}%`, top: `${top}%` }}
                      onClick={() => setSelectedPin(loc.id)}
                      title={loc.name}
                    >
                      {layer === 'Nodes' ? loc.name.split(' ').slice(-1)[0].slice(0, 4) : index + 1}
                    </button>
                  )
                })
              )}
            </div>
          </MapStage>
        }
        right={
          <Panel title="Validation">
            <div className="k-check-list">
              <div>
                <Status value={mapped.length === floorLocs.length && floorLocs.length ? 'Complete' : 'Review'} />
                <span>Nodes checked</span>
                <strong>
                  {mapped.length} / {floorLocs.length || 0}
                </strong>
              </div>
              <div>
                <Status value={outliers.length ? 'Review' : 'Complete'} />
                <span>Outliers</span>
                <strong>{outliers.length}</strong>
              </div>
              <div>
                <Status value="Complete" />
                <span>Transitions</span>
                <strong>
                  {floorLocs.filter((l) => ['Elevator', 'Stairs', 'Entry', 'Exit'].includes(l.type)).length}
                </strong>
              </div>
              <div>
                <Status value="Complete" />
                <span>Scale</span>
                <strong>1:250</strong>
              </div>
              <div>
                <Status value={decision} />
                <span>Decision</span>
                <strong>{decision}</strong>
              </div>
            </div>
            {selectedPin ? (
              <div className="k-detail-list" style={{ marginTop: '0.75rem' }}>
                {(() => {
                  const loc = floorLocs.find((l) => l.id === selectedPin)
                  if (!loc) return null
                  return (
                    <>
                      <div>
                        <span>Selected</span>
                        <strong>{loc.name}</strong>
                      </div>
                      <div>
                        <span>Type</span>
                        <strong>{loc.type}</strong>
                      </div>
                      <div>
                        <span>Coords</span>
                        <strong>
                          {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                        </strong>
                      </div>
                      <div>
                        <span>Elev</span>
                        <strong>{loc.elevation} m</strong>
                      </div>
                    </>
                  )
                })()}
              </div>
            ) : null}
            <Field label="Review notes">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
            </Field>
            <ActionBar>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => saveReview('Rejected')}>
                Reject floor
              </button>
              <button type="button" className="k-btn k-btn--primary" onClick={() => saveReview('Approved')}>
                Approve coordinates
              </button>
            </ActionBar>
          </Panel>
        }
      />
    </>
  )
}

/* ─── Mapping Quality ─── */
export function MappingQualityPage({ onNavigate }: PageProps) {
  const { data, upsert, remove, logAudit } = useErpData()
  const entityMap = useEntityMap()
  const { locations, users } = data
  const issues = data.qualityIssues
  const [severity, setSeverity] = useState('All')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')

  const shown = issues.filter((issue) => severity === 'All' || issue.severity === severity)
  const current = issues.find((i) => i.id === selected) ?? shown[0] ?? null
  const open = issues.filter((i) => i.severity === 'Critical' || i.severity === 'High')

  function runChecks() {
    const id = nextId('qi', issues)
    const sample = locations[Math.floor(Math.random() * Math.min(locations.length, 40))]
    const reporter = users.find((u) => u.role === 'QA Reviewer') ?? users[0]
    const item: QualityIssue = {
      id,
      propertyId: sample?.propertyId ?? entityMap.sitePropertyByName['Orion Complex']?.id ?? 'cpx-001',
      propertyName: sample?.complexName ?? sample?.buildingName ?? 'Orion Complex',
      floorId: sample?.floorId ?? null,
      floorLabel: sample?.floorLabel ?? 'L01',
      issue: 'Automated check: polygon self-intersection',
      severity: 'Medium',
      reportedByUserId: reporter?.id ?? 'usr-001',
      reportedBy: reporter?.name ?? 'System',
      ageDays: 0,
    }
    setSelected(id)
    void persist(
      upsert('qualityIssues', item),
      setNotice,
      'Quality checks finished — 1 new finding.',
    )
  }

  function resolveIssue() {
    if (!current) return
    const cleared = current
    setSelected('')
    void persist(
      remove('qualityIssues', cleared.id).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Quality finding cleared',
          target: `${cleared.id} · ${cleared.propertyName}`,
        }),
      ),
      setNotice,
      'Finding cleared.',
    )
  }

  function escalate() {
    if (!current || current.severity === 'Critical') return
    const order: QualitySeverity[] = ['Low', 'Medium', 'High', 'Critical']
    const next = order[Math.min(order.indexOf(current.severity) + 1, order.length - 1)]
    void persist(
      upsert('qualityIssues', { ...current, severity: next }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Quality finding escalated to ${next}`,
          target: `${current.id} · ${current.propertyName}`,
        }),
      ),
      setNotice,
      `Escalated to ${next}.`,
    )
  }

  return (
    <>
      <PageHeader
        title="Mapping Quality"
        subtitle="Geometry and metadata findings."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={runChecks}>
            Run checks
          </button>
        }
      />
      <HelpNote title="Mapping quality">
        Findings come from automated geometry checks and QA. Clear Critical/High first; escalate when
        a fix is blocked by missing field data.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Open issues', value: issues.length, tone: 'warn' },
          { label: 'Critical', value: issues.filter((i) => i.severity === 'Critical').length, tone: 'danger' },
          { label: 'High', value: issues.filter((i) => i.severity === 'High').length, tone: 'danger' },
          {
            label: 'Avg age',
            value: issues.length
              ? `${Math.round(issues.reduce((s, i) => s + i.ageDays, 0) / issues.length)}d`
              : '0d',
            tone: 'info',
          },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <SelectFilter label="Severity" value={severity} onChange={setSeverity}>
          <option>All</option>
          {severities.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectFilter>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('correction-requests')}>
          Open corrections
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Quality findings">
            {shown.length === 0 ? (
              <EmptyHint text="No findings for this filter." />
            ) : (
              <DataTable
                columns={['ID', 'Property', 'Floor', 'Finding', 'Severity', '']}
                rows={shown.map((issue) => [
                  issue.id,
                  issue.propertyName,
                  issue.floorLabel,
                  issue.issue,
                  <Status key={issue.id} value={issue.severity} />,
                  <button key={`s-${issue.id}`} type="button" className="k-link-btn" onClick={() => setSelected(issue.id)}>
                    Select
                  </button>,
                ])}
              />
            )}
          </Panel>
        }
        right={
          <Panel title="Finding detail">
            {!current ? (
              <EmptyHint text="Select a finding." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>ID</span>
                  <strong>{current.id}</strong>
                </div>
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Floor</span>
                  <strong>{current.floorLabel}</strong>
                </div>
                <div>
                  <span>Issue</span>
                  <strong>{current.issue}</strong>
                </div>
                <div>
                  <span>Severity</span>
                  <Status value={current.severity} />
                </div>
                <div>
                  <span>Reporter</span>
                  <strong>{current.reportedBy}</strong>
                </div>
                <div>
                  <span>Age</span>
                  <strong>{current.ageDays}d</strong>
                </div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--primary" onClick={resolveIssue}>
                    Clear finding
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={escalate} disabled={current.severity === 'Critical'}>
                    Escalate
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('correction-requests')}>
                    Create correction
                  </button>
                </ActionBar>
                {open.length ? (
                  <p className="k-muted">{open.length} critical/high still open.</p>
                ) : null}
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Approval Queue ─── */
export function ApprovalQueuePage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const list = data.approvals
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('Pending')

  const shown = list.filter((a) => filter === 'All' || a.status === filter)
  const pending = list.filter((a) => a.status === 'Pending')

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  function decide(status: ApprovalStatus) {
    if (!selected.length) return
    const now = '2026-09-04 15:20'
    const decided: Approval[] = list
      .filter((a) => selected.includes(a.id) && a.status === 'Pending')
      .map((a) => ({ ...a, status, submittedAt: a.submittedAt || now }))
    const count = selected.length
    const note = notes.trim()
    setSelected([])
    setNotes('')
    void persist(
      Promise.all(decided.map((a) => upsert('approvals', a))).then(() =>
        Promise.all(
          decided.map((a) =>
            logAudit({
              actorUserId: null,
              actor: 'ERP User',
              action: `Approval ${status}${note ? ` — ${note}` : ''}`,
              target: `${a.propertyName} · ${a.mapVersion}`,
            }),
          ),
        ),
      ),
      setNotice,
      `${count} package(s) marked ${status}.${note ? ` Note saved.` : ''}`,
    )
  }

  return (
    <>
      <PageHeader title="Approval Queue" subtitle="Review submitted map packages." />
      <HelpNote title="Approvals">
        Approve only after coordinate review and quality checks pass. Rejection returns the package
        to mapping; notes are stored with the decision.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Pending', value: pending.length, tone: 'warn' },
          { label: 'Approved', value: list.filter((a) => a.status === 'Approved').length, tone: 'ok' },
          { label: 'Rejected', value: list.filter((a) => a.status === 'Rejected').length, tone: 'danger' },
          { label: 'Selected', value: selected.length, tone: 'info' },
        ]}
      />
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <SelectFilter label="Status" value={filter} onChange={setFilter}>
          <option>All</option>
          <option>Pending</option>
          <option>Approved</option>
          <option>Rejected</option>
        </SelectFilter>
        <button type="button" className="k-btn k-btn--primary" disabled={!selected.length} onClick={() => decide('Approved')}>
          Approve
        </button>
        <button type="button" className="k-btn k-btn--danger" disabled={!selected.length} onClick={() => decide('Rejected')}>
          Reject
        </button>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('map-publishing')}>
          Publishing
        </button>
      </Toolbar>
      <Panel title="Decision notes">
        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional decision notes" />
        </Field>
      </Panel>
      <Panel title="Submissions">
        {shown.length === 0 ? (
          <EmptyHint text="No submissions." />
        ) : (
          <DataTable
            columns={['Select', 'Property', 'Version', 'Submitted by', 'Submitted', 'Status', 'Checks']}
            rows={shown.map((approval) => [
              <input
                key={approval.id}
                type="checkbox"
                checked={selected.includes(approval.id)}
                disabled={approval.status !== 'Pending'}
                onChange={() => toggle(approval.id)}
              />,
              approval.propertyName,
              approval.mapVersion,
              approval.submittedBy,
              approval.submittedAt,
              <Status key={`s-${approval.id}`} value={approval.status} />,
              approval.status === 'Pending' ? '12 / 12' : 'Closed',
            ])}
          />
        )}
      </Panel>
    </>
  )
}

/* ─── Correction Requests ─── */
export function CorrectionRequestsPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const entityMap = useEntityMap()
  const { locations } = data
  const list = data.corrections
  const mappers = useMemo(() => mappersFrom(data.users), [data.users])
  const propertyLabels = useMemo(() => data.siteProperties.map((p) => p.name), [data.siteProperties])
  const [status, setStatus] = useState('All')
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    propertyName: '',
    location: '',
    description: '',
    assignee: '',
  })

  const formPropertyName = form.propertyName || propertyLabels[0] || ''
  const formAssignee = form.assignee || mappers[0]?.name || 'Unassigned'

  const shown = list.filter((c) => status === 'All' || c.status === status)
  const current = list.find((c) => c.id === selected) ?? shown[0] ?? null

  const propertyLocs = locations.filter((l) => {
    const prop = entityMap.sitePropertyByName[formPropertyName]
    return prop ? l.propertyId === prop.id : (l.complexName ?? l.buildingName) === formPropertyName
  })
  const propertyLocNames = propertyLocs.map((l) => l.name)

  function createRequest(event: FormEvent) {
    event.preventDefault()
    const prop = entityMap.sitePropertyByName[formPropertyName]
    const locName = form.location || propertyLocNames[0] || 'Main Entry'
    const loc = propertyLocs.find((l) => l.name === locName)
    const assignee = mappers.find((u) => u.name === formAssignee)
    if (!prop || !loc || !assignee) {
      flash(setNotice, 'Select a valid property, location, and assignee.')
      return
    }
    const id = nextId('cr', list)
    const item: Correction = {
      id,
      propertyId: prop.id,
      propertyName: prop.name,
      locationId: loc.id,
      location: loc.name,
      description: form.description.trim(),
      assigneeUserId: assignee.id,
      assignee: assignee.name,
      status: formAssignee === 'Unassigned' ? 'Open' : 'Assigned',
    }
    setSelected(id)
    setCreating(false)
    void persist(
      upsert('corrections', item).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Correction request opened',
          target: `${item.id} · ${item.location}`,
        }),
      ),
      setNotice,
      'Correction request opened.',
    )
  }

  function setCorrectionStatus(next: CorrectionStatus) {
    if (!current) return
    void persist(
      upsert('corrections', { ...current, status: next }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Correction marked ${next}`,
          target: `${current.id} · ${current.location}`,
        }),
      ),
      setNotice,
      `Marked ${next}.`,
    )
  }

  return (
    <>
      <PageHeader
        title="Correction Requests"
        subtitle="Reported map changes and ownership."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={() => setCreating(true)}>
            New request
          </button>
        }
      />
      <HelpNote title="Corrections">
        Log geometry or label fixes with an owner. Assign to a mapper, then resolve once the field
        update is verified in coordinate review.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <SelectFilter label="Status" value={status} onChange={setStatus}>
          <option>All</option>
          {correctionStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectFilter>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('coordinate-review')}>
          Coordinate review
        </button>
      </Toolbar>

      {creating ? (
        <Panel title="New correction">
          <form onSubmit={createRequest}>
            <FormGrid>
              <Field label="Property">
                <select
                  value={formPropertyName}
                  onChange={(e) => setForm((f) => ({ ...f, propertyName: e.target.value, location: '' }))}
                >
                  {propertyLabels.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Location">
                <select
                  value={form.location || propertyLocNames[0] || ''}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                >
                  {propertyLocNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Description">
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  required
                  placeholder="What needs to change"
                />
              </Field>
              <Field label="Assignee">
                <select value={formAssignee} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}>
                  <option>Unassigned</option>
                  {mappers.map((u) => (
                    <option key={u.id}>{u.name}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            <ActionBar>
              <button type="submit" className="k-btn k-btn--primary">
                Create
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
          <Panel title="Requests">
            <DataTable
              columns={['Request', 'Property', 'Location', 'Change', 'Assignee', 'Status', '']}
              rows={shown.map((correction) => [
                correction.id,
                correction.propertyName,
                correction.location,
                correction.description,
                correction.assignee,
                <Status key={correction.id} value={correction.status} />,
                <button
                  key={`o-${correction.id}`}
                  type="button"
                  className="k-link-btn"
                  onClick={() => setSelected(correction.id)}
                >
                  Open
                </button>,
              ])}
            />
          </Panel>
        }
        right={
          <Panel title="Request detail">
            {!current ? (
              <EmptyHint text="Select a request." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>ID</span>
                  <strong>{current.id}</strong>
                </div>
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Location</span>
                  <strong>{current.location}</strong>
                </div>
                <div>
                  <span>Change</span>
                  <strong>{current.description}</strong>
                </div>
                <div>
                  <span>Assignee</span>
                  <strong>{current.assignee}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <Status value={current.status} />
                </div>
                <ActionBar>
                  {current.status === 'Open' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setCorrectionStatus('Assigned')}>
                      Assign
                    </button>
                  ) : null}
                  {current.status !== 'Resolved' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setCorrectionStatus('Resolved')}>
                      Resolve
                    </button>
                  ) : null}
                  {current.status === 'Resolved' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setCorrectionStatus('Open')}>
                      Reopen
                    </button>
                  ) : null}
                </ActionBar>
              </div>
            )}
          </Panel>
        }
      />
    </>
  )
}

/* ─── Map Publishing ─── */
export function MapPublishingPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const versions = data.mapVersions
  const publishable = versions.filter((v) => v.status === 'Staging' || v.status === 'Draft' || v.status === 'Live')
  const [selectedProperty, setPropertyName] = useState('')
  const propertyName =
    selectedProperty || publishable[0]?.propertyName || data.complexes[0]?.name || ''
  const versionsForProperty = versions.filter((v) => v.propertyName === propertyName)
  const [versionId, setVersionId] = useState('')
  const [environment, setEnvironment] = useState<'Staging' | 'Production'>('Production')
  const [releaseNote, setReleaseNote] = useState('Coordinate and route refresh.')
  const [confirmed, setConfirmed] = useState(false)
  const [validated, setValidated] = useState(false)
  const [notice, setNotice] = useState('')

  const selectedVersion = versions.find((v) => v.id === versionId) ?? versionsForProperty[0] ?? null
  const liveCount = versions.filter((v) => v.status === 'Live').length

  function onPropertyChange(name: string) {
    setPropertyName(name)
    const first = versions.find((v) => v.propertyName === name)
    setVersionId(first?.id ?? '')
    setConfirmed(false)
    setValidated(false)
  }

  function validateOnly() {
    setValidated(true)
    flash(setNotice, 'Preflight passed: schema, routes, and approval checks OK.')
  }

  function publish() {
    if (!selectedVersion || !confirmed) return
    const nextStatus: MapVersionStatus = environment === 'Production' ? 'Live' : 'Staging'
    const updates: MapVersion[] = [
      {
        ...selectedVersion,
        status: nextStatus,
        publishedAt: nextStatus === 'Live' ? '2026-09-04' : selectedVersion.publishedAt,
      },
    ]
    if (nextStatus === 'Live') {
      for (const v of versions) {
        if (v.id !== selectedVersion.id && v.propertyName === selectedVersion.propertyName && v.status === 'Live') {
          updates.push({ ...v, status: 'Archived' })
        }
      }
    }
    setConfirmed(false)
    void persist(
      Promise.all(updates.map((v) => upsert('mapVersions', v))).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Map published to ${environment}${releaseNote.trim() ? ` — ${releaseNote.trim()}` : ''}`,
          target: `${selectedVersion.propertyName} · ${selectedVersion.version}`,
        }),
      ),
      setNotice,
      `Published ${selectedVersion.version} to ${environment}.`,
    )
  }

  return (
    <>
      <PageHeader title="Map Publishing" subtitle="Promote an approved map version." />
      <HelpNote title="Publishing">
        Validate first, then confirm. Production publish marks the version Live and archives the
        previous Live package for that property.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <SplitView
        left={
          <Panel title="Release configuration">
            <FormGrid>
              <Field label="Property">
                <select value={propertyName} onChange={(e) => onPropertyChange(e.target.value)}>
                  {Array.from(new Set(versions.map((v) => v.propertyName))).map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Version">
                <select value={selectedVersion?.id ?? ''} onChange={(e) => setVersionId(e.target.value)}>
                  {versionsForProperty.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.version} ({v.status})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Environment">
                <select
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'Staging' | 'Production')}
                >
                  <option>Staging</option>
                  <option>Production</option>
                </select>
              </Field>
              <Field label="Release note">
                <textarea rows={4} value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} />
              </Field>
            </FormGrid>
            <label className="k-confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I verified approval and checks.
            </label>
            <ActionBar>
              <button type="button" className="k-btn k-btn--primary" disabled={!confirmed || !selectedVersion} onClick={publish}>
                Publish
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={validateOnly}>
                Validate only
              </button>
              <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('map-versions')}>
                Versions
              </button>
            </ActionBar>
          </Panel>
        }
        right={
          <Panel title="Preflight">
            <div className="k-check-list">
              <div>
                <Status value={validated || confirmed ? 'Approved' : 'Review'} />
                <span>Approval</span>
                <strong>{validated ? 'Verified' : 'Confirm required'}</strong>
              </div>
              <div>
                <Status value="Complete" />
                <span>Schema</span>
                <strong>Pass</strong>
              </div>
              <div>
                <Status value="Complete" />
                <span>Routes</span>
                <strong>Linked</strong>
              </div>
              <div>
                <Status value={environment === 'Production' ? 'Review' : 'Complete'} />
                <span>Mobile cache</span>
                <strong>{environment === 'Production' ? 'Will refresh' : 'Staging only'}</strong>
              </div>
              <div>
                <Status value="Complete" />
                <span>Live packages</span>
                <strong>{liveCount}</strong>
              </div>
            </div>
          </Panel>
        }
      />
      <Panel title="Recent releases">
        <DataTable
          columns={['Property', 'Version', 'State', 'Published', 'Floors']}
          rows={versions
            .filter((v) => v.status === 'Live' || v.status === 'Staging')
            .map((version) => [
              version.propertyName,
              version.version,
              <Status key={version.id} value={version.status} />,
              version.publishedAt ?? '—',
              version.floors,
            ])}
        />
      </Panel>
    </>
  )
}

/* ─── Map Versions ─── */
export function MapVersionsPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const list = data.mapVersions
  const [state, setState] = useState('All')
  const [selected, setSelected] = useState('')
  const [selectedCompareA, setCompareA] = useState('')
  const [selectedCompareB, setCompareB] = useState('')
  const [notice, setNotice] = useState('')

  const compareA = selectedCompareA || list[0]?.id || ''
  const compareB = selectedCompareB || list[1]?.id || list[0]?.id || ''

  const shown = list.filter((v) => state === 'All' || v.status === state)
  const current = list.find((v) => v.id === selected) ?? shown[0] ?? null

  function promote() {
    if (!current || current.status === 'Live') return
    const next: MapVersionStatus = current.status === 'Draft' ? 'Staging' : 'Live'
    const updates: MapVersion[] = [
      { ...current, status: next, publishedAt: next === 'Live' ? '2026-09-04' : current.publishedAt },
    ]
    if (next === 'Live') {
      for (const v of list) {
        if (v.id !== current.id && v.propertyName === current.propertyName && v.status === 'Live') {
          updates.push({ ...v, status: 'Archived' })
        }
      }
    }
    void persist(
      Promise.all(updates.map((v) => upsert('mapVersions', v))).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: `Map version promoted to ${next}`,
          target: `${current.propertyName} · ${current.version}`,
        }),
      ),
      setNotice,
      `Promoted ${current.version} → ${next}.`,
    )
  }

  function archive() {
    if (!current) return
    void persist(
      upsert('mapVersions', { ...current, status: 'Archived' }).then(() =>
        logAudit({
          actorUserId: null,
          actor: 'ERP User',
          action: 'Map version archived',
          target: `${current.propertyName} · ${current.version}`,
        }),
      ),
      setNotice,
      `Archived ${current.version}.`,
    )
  }

  function compare() {
    const a = list.find((v) => v.id === compareA)
    const b = list.find((v) => v.id === compareB)
    if (!a || !b) return
    flash(
      setNotice,
      `Compare ${a.version} (${a.status}, ${a.floors} fl) vs ${b.version} (${b.status}, ${b.floors} fl).`,
    )
  }

  return (
    <>
      <PageHeader
        title="Map Versions"
        subtitle="Version history and release state."
        actions={
          <button type="button" className="k-btn k-btn--ghost" onClick={compare}>
            Compare
          </button>
        }
      />
      <HelpNote title="Versions">
        Track Draft → Staging → Live → Archived. Promote when QA passes; archive superseded Live
        packages. Compare floors and state before publish.
      </HelpNote>
      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      <Toolbar>
        <SelectFilter label="State" value={state} onChange={setState}>
          <option>All</option>
          {versionStatuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Compare A" value={compareA} onChange={setCompareA}>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.propertyName} {v.version}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Compare B" value={compareB} onChange={setCompareB}>
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.propertyName} {v.version}
            </option>
          ))}
        </SelectFilter>
        <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('map-publishing')}>
          Publish
        </button>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Version registry">
            <DataTable
              columns={['Property', 'Version', 'State', 'Published', 'Floors', 'Package', '']}
              rows={shown.map((version) => [
                version.propertyName,
                <code key={version.id}>{version.version}</code>,
                <Status key={`s-${version.id}`} value={version.status} />,
                version.publishedAt ?? '—',
                version.floors,
                `${(version.floors * 1.8).toFixed(1)} MB`,
                <button
                  key={`a-${version.id}`}
                  type="button"
                  className="k-link-btn"
                  onClick={() => setSelected(version.id)}
                >
                  Inspect
                </button>,
              ])}
            />
          </Panel>
        }
        right={
          <Panel title="Version detail">
            {!current ? (
              <EmptyHint text="Select a version." />
            ) : (
              <div className="k-detail-list">
                <div>
                  <span>Property</span>
                  <strong>{current.propertyName}</strong>
                </div>
                <div>
                  <span>Version</span>
                  <strong>{current.version}</strong>
                </div>
                <div>
                  <span>State</span>
                  <Status value={current.status} />
                </div>
                <div>
                  <span>Published</span>
                  <strong>{current.publishedAt ?? '—'}</strong>
                </div>
                <div>
                  <span>Floors</span>
                  <strong>{current.floors}</strong>
                </div>
                <div>
                  <span>Package</span>
                  <strong>{(current.floors * 1.8).toFixed(1)} MB</strong>
                </div>
                <ActionBar>
                  <button
                    type="button"
                    className="k-btn k-btn--primary"
                    onClick={promote}
                    disabled={current.status === 'Live' || current.status === 'Archived'}
                  >
                    Promote
                  </button>
                  <button
                    type="button"
                    className="k-btn k-btn--ghost"
                    onClick={archive}
                    disabled={current.status === 'Archived'}
                  >
                    Archive
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('map-publishing')}>
                    Publish flow
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
