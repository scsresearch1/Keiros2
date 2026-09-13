import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckSquare,
  ClipboardCheck,
  LayoutDashboard,
  Map,
  Smartphone,
  Users,
  Wrench,
} from 'lucide-react'
import type { PageId } from '../app/nav'
import type { Organization, Role, User } from '../data/erpData'
import { useErpData } from '../data/ErpDataProvider'
import { ChartBars, DonutChart, ProgressMeter, Sparkline, TrendColumns } from '../ui/charts'
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
import { ComplexesPage } from './propertyHierarchy'
import './pages.css'

export type PageProps = { onNavigate?: (page: PageId) => void }
export { ComplexesPage, PropertiesPage, BuildingsPage, FloorsPage, LocationsPage } from './propertyHierarchy'
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

/** Firestore writes are fire-and-forget; the provider surfaces failures in the app shell. */
function persist(work: () => Promise<unknown>) {
  void work().catch(() => {})
}

function tone(status: string): Tone {
  if (['Published', 'Active', 'Approved', 'Complete', 'Live', 'Resolved', 'Mapped'].includes(status)) return 'ok'
  if (['Review', 'Pending', 'Queued', 'Assigned', 'Staging', 'Medium'].includes(status)) return 'warn'
  if (['Suspended', 'Rejected', 'Blocked', 'Critical', 'High'].includes(status)) return 'danger'
  if (['In Progress', 'Open', 'Draft', 'Low'].includes(status)) return 'info'
  return 'neutral'
}

function Status({ value }: { value: string }) {
  return <Badge tone={tone(value)}>{value}</Badge>
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

export function DashboardPage() {
  const { data } = useErpData()
  const {
    dashboardKpis,
    complexes,
    mappingQueue,
    qualityIssues,
    approvals,
    corrections,
    journeys,
    apiUsageStats,
  } = data
  const readiness = complexes.map((property) => property.readiness)
  const openMapping = mappingQueue.filter((item) => item.status !== 'Complete')
  const inReviewHint = `${mappingQueue.filter((item) => item.status === 'In Progress').length} awaiting QA`
  const openCorrections = corrections.filter((item) => item.status !== 'Resolved')
  const priorityMapping = openMapping[0] ?? mappingQueue[0] ?? null
  const priorityQuality =
    qualityIssues.find((item) => item.severity === 'Critical' || item.severity === 'High') ??
    qualityIssues[0] ??
    null
  const priorityApproval = approvals.find((item) => item.status === 'Pending') ?? approvals[0] ?? null
  const priorityCorrection = openCorrections[0] ?? corrections[0] ?? null
  const priorityRows: ReactNode[][] = []
  if (priorityMapping) {
    priorityRows.push([
      'Mapping',
      priorityMapping.propertyName,
      priorityMapping.floorLabel,
      priorityMapping.mapper,
      <Status key="mq" value={priorityMapping.status} />,
    ])
  }
  if (priorityQuality) {
    priorityRows.push([
      'Quality',
      priorityQuality.propertyName,
      priorityQuality.issue,
      priorityQuality.reportedBy,
      <Status key="qi" value={priorityQuality.severity} />,
    ])
  }
  if (priorityApproval) {
    priorityRows.push([
      'Approval',
      priorityApproval.propertyName,
      priorityApproval.mapVersion,
      priorityApproval.submittedBy,
      <Status key="ap" value={priorityApproval.status} />,
    ])
  }
  if (priorityCorrection) {
    priorityRows.push([
      'Correction',
      priorityCorrection.propertyName,
      priorityCorrection.location,
      priorityCorrection.assignee,
      <Status key="cr" value={priorityCorrection.status} />,
    ])
  }
  const publishedPct = Math.round((dashboardKpis.published / Math.max(dashboardKpis.properties, 1)) * 100)
  const snapshotDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date())

  const mappingStatusMix = useMemo(() => {
    const counts = { Complete: 0, 'In Progress': 0, Queued: 0, Blocked: 0 }
    for (const item of mappingQueue) {
      if (item.status === 'Complete') counts.Complete += 1
      else if (item.status === 'In Progress') counts['In Progress'] += 1
      else if (item.status === 'Queued') counts.Queued += 1
      else if (item.status === 'Blocked') counts.Blocked += 1
    }
    return [
      { label: 'Complete', value: counts.Complete, tone: 'ok' as const },
      { label: 'In progress', value: counts['In Progress'], tone: 'info' as const },
      { label: 'Queued', value: counts.Queued, tone: 'warn' as const },
      { label: 'Blocked', value: counts.Blocked, tone: 'danger' as const },
    ].filter((seg) => seg.value > 0)
  }, [mappingQueue])

  const journeySessions = useMemo(
    () => journeys.slice(0, 8).map((j) => j.sessions),
    [journeys],
  )
  const journeyLabels = useMemo(
    () => journeys.slice(0, 8).map((j) => j.propertyName.split(' ')[0]),
    [journeys],
  )
  const apiRequestSeries = useMemo(
    () => apiUsageStats.slice(0, 8).map((row) => row.requests),
    [apiUsageStats],
  )
  const queueMax = Math.max(
    openMapping.length,
    qualityIssues.length,
    dashboardKpis.activeUsers,
    dashboardKpis.activeSessions,
    1,
  )

  return (
    <>
      <PageHeader
        title="Home Dashboard"
        subtitle={`Operations snapshot · ${snapshotDate}`}
        icon={LayoutDashboard}
        actions={<button className="k-btn k-btn--ghost">Export</button>}
      />
      <aside className="k-help-note" aria-label="Home dashboard help">
        <strong>Home dashboard</strong>
        <div>
          Portfolio snapshot for mapping readiness, approvals, and field activity. Use Work queue
          and Priority activity to jump into the hottest items; KPIs reflect the full managed set.
        </div>
      </aside>
      <KpiRow
        items={[
          { label: 'Properties', value: dashboardKpis.properties, hint: `${dashboardKpis.properties} managed complexes`, icon: Building2 },
          { label: 'Published', value: dashboardKpis.published, tone: 'ok', hint: `${publishedPct}% of portfolio`, icon: CheckSquare },
          { label: 'In review', value: dashboardKpis.inReview, tone: 'warn', hint: inReviewHint, icon: ClipboardCheck },
          { label: 'Readiness', value: `${dashboardKpis.avgReadiness}%`, tone: 'info', hint: 'Portfolio average', icon: Activity },
          { label: 'Approvals', value: dashboardKpis.pendingApprovals, tone: 'warn', hint: `${dashboardKpis.pendingApprovals} pending`, icon: CheckSquare },
          { label: 'Corrections', value: dashboardKpis.openCorrections, tone: 'danger', hint: `${openCorrections.length} unresolved`, icon: AlertTriangle },
        ]}
      />
      <div className="k-page-grid k-page-grid--wide">
        <Panel title="Portfolio readiness" icon={Building2} actions={<Badge tone="info">Live</Badge>}>
          <ChartBars
            items={complexes.map((property) => ({
              label: property.name,
              value: property.readiness,
              hint: property.status,
            }))}
            unit="%"
          />
          <div className="k-dash-trend" style={{ marginTop: '1rem' }}>
            <TrendColumns
              values={readiness}
              labels={complexes.map((property) => property.name.split(' ')[0])}
              unit="%"
            />
          </div>
        </Panel>
        <Panel title="Work queue" icon={ClipboardCheck}>
          <ProgressMeter label="Field mapping" value={openMapping.length} max={queueMax} icon={Map} tone="info" />
          <ProgressMeter label="Quality issues" value={qualityIssues.length} max={queueMax} icon={AlertTriangle} tone="warn" />
          <ProgressMeter label="Active users" value={dashboardKpis.activeUsers} max={queueMax} icon={Users} tone="ok" />
          <ProgressMeter label="Mobile sessions" value={dashboardKpis.activeSessions} max={queueMax} icon={Smartphone} tone="info" />
          {mappingStatusMix.length ? (
            <div style={{ marginTop: '1rem' }}>
              <DonutChart
                segments={mappingStatusMix}
                centerValue={mappingQueue.length}
                centerLabel="Jobs"
              />
            </div>
          ) : null}
        </Panel>
      </div>
      <div className="k-dash-viz-grid">
        <Panel title="Journey sessions" icon={Activity} actions={<Badge tone="neutral">Routes</Badge>}>
          <TrendColumns values={journeySessions} labels={journeyLabels} />
        </Panel>
        <Panel title="API request volume" icon={Activity} actions={<Badge tone="info">Usage</Badge>}>
          <Sparkline values={apiRequestSeries} tone="info" />
        </Panel>
      </div>
      <Panel title="Priority activity" icon={Wrench}>
        {priorityRows.length ? (
          <DataTable columns={['Area', 'Property', 'Item', 'Owner', 'Status']} rows={priorityRows} />
        ) : (
          <EmptyHint text="No priority activity right now." />
        )}
      </Panel>
    </>
  )
}

type OrgRecord = Organization & {
  contactEmail: string
  notes: string
}

type OrgMember = {
  id: string
  name: string
  email: string
  role: string
  status: 'Active' | 'Inactive'
}

/** contactEmail / notes are not in the canonical schema but round-trip through Firestore. */
function toOrgRecord(org: Organization): OrgRecord {
  const stored = org as Partial<OrgRecord>
  return { ...org, contactEmail: stored.contactEmail ?? '', notes: stored.notes ?? '' }
}

function deriveOrgMembers(orgs: Organization[], users: User[]): Record<string, OrgMember[]> {
  const map: Record<string, OrgMember[]> = {}
  for (const org of orgs) {
    map[org.id] = users
      .filter((user) => user.org === org.name)
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      }))
  }
  return map
}

export function OrganizationsPage() {
  const { data, upsert, logAudit } = useErpData()
  const roles = data.roles
  const [orgs, setOrgs] = useState<OrgRecord[]>(() => data.organizations.map(toOrgRecord))
  const [membersByOrg, setMembersByOrg] = useState<Record<string, OrgMember[]>>(() =>
    deriveOrgMembers(data.organizations, data.users),
  )
  const [type, setType] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(data.organizations[0]?.id ?? null)
  const [modal, setModal] = useState<'add' | 'edit' | 'members' | null>(null)
  const [name, setName] = useState('')
  const [orgType, setOrgType] = useState<'Owner' | 'PMC' | 'Customer'>('Owner')
  const [status, setStatus] = useState<'Active' | 'Pending' | 'Suspended'>('Pending')
  const [contactEmail, setContactEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState(roles[1]?.name ?? 'Property Manager')

  useEffect(() => {
    setOrgs(data.organizations.map(toOrgRecord))
    setSelected((prev) =>
      prev && data.organizations.some((org) => org.id === prev) ? prev : data.organizations[0]?.id ?? null,
    )
  }, [data.organizations])

  // Members are a UI-only projection of users; keep manually added rows across snapshot refreshes.
  useEffect(() => {
    setMembersByOrg((prev) => {
      const next = deriveOrgMembers(data.organizations, data.users)
      for (const [orgId, list] of Object.entries(prev)) {
        const manual = list.filter((member) => member.id.startsWith('mem-'))
        if (manual.length) next[orgId] = [...manual, ...(next[orgId] ?? [])]
      }
      return next
    })
  }, [data.organizations, data.users])

  const shown = orgs.filter((org) => {
    const matchType = type === 'All' || org.type === type
    const matchStatus = statusFilter === 'All' || org.status === statusFilter
    const matchQuery = `${org.name} ${org.id} ${org.contactEmail}`.toLowerCase().includes(query.toLowerCase())
    return matchType && matchStatus && matchQuery
  })
  const selectedOrg = orgs.find((item) => item.id === selected) ?? null
  const members = selected ? membersByOrg[selected] ?? [] : []

  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  function resetForm() {
    setName('')
    setOrgType('Owner')
    setStatus('Pending')
    setContactEmail('')
    setNotes('')
    setError('')
  }

  function fillForm(org: OrgRecord) {
    setName(org.name)
    setOrgType(org.type)
    setStatus(org.status)
    setContactEmail(org.contactEmail)
    setNotes(org.notes)
    setError('')
  }

  function openAdd() {
    resetForm()
    setModal('add')
  }

  function openEdit() {
    if (!selectedOrg) return
    fillForm(selectedOrg)
    setModal('edit')
  }

  function openMembers() {
    if (!selectedOrg) return
    setMemberName('')
    setMemberEmail('')
    setMemberRole(roles[1]?.name ?? 'Property Manager')
    setError('')
    setModal('members')
  }

  function closeModal() {
    setModal(null)
    setError('')
  }

  function validateOrgFields() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return null
    }
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      setError('Enter a valid contact email.')
      return null
    }
    return trimmed
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = validateOrgFields()
    if (!trimmed) return
    const id = `org-${String(Date.now()).slice(-6)}`
    const next: OrgRecord = {
      id,
      name: trimmed,
      type: orgType,
      properties: 0,
      status,
      contactEmail: contactEmail.trim(),
      notes: notes.trim(),
    }
    setOrgs((list) => [next, ...list])
    setMembersByOrg((map) => ({ ...map, [id]: [] }))
    setSelected(id)
    setModal(null)
    resetForm()
    flash('Organization created.')
    persist(async () => {
      await upsert('organizations', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'organization.create',
        target: next.name,
      })
    })
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrg) return
    const trimmed = validateOrgFields()
    if (!trimmed) return
    const next: OrgRecord = {
      ...selectedOrg,
      name: trimmed,
      type: orgType,
      status,
      contactEmail: contactEmail.trim(),
      notes: notes.trim(),
    }
    setOrgs((list) => list.map((org) => (org.id === next.id ? next : org)))
    setModal(null)
    flash('Organization updated.')
    persist(async () => {
      await upsert('organizations', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'organization.update',
        target: next.name,
      })
    })
  }

  function setOrgStatus(nextStatus: 'Active' | 'Pending' | 'Suspended') {
    if (!selectedOrg) return
    const next: OrgRecord = { ...selectedOrg, status: nextStatus }
    setOrgs((list) => list.map((org) => (org.id === next.id ? next : org)))
    flash(`Status set to ${nextStatus}.`)
    persist(async () => {
      await upsert('organizations', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: `organization.status.${nextStatus.toLowerCase()}`,
        target: next.name,
      })
    })
  }

  function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedOrg) return
    const trimmedName = memberName.trim()
    const trimmedEmail = memberEmail.trim().toLowerCase()
    if (!trimmedName || !trimmedEmail) {
      setError('Member name and email are required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid member email.')
      return
    }
    const existing = membersByOrg[selectedOrg.id] ?? []
    if (existing.some((member) => member.email === trimmedEmail)) {
      setError('That email is already a member.')
      return
    }
    const member: OrgMember = {
      id: `mem-${Date.now()}`,
      name: trimmedName,
      email: trimmedEmail,
      role: memberRole,
      status: 'Active',
    }
    setMembersByOrg((map) => ({ ...map, [selectedOrg.id]: [member, ...existing] }))
    setMemberName('')
    setMemberEmail('')
    setError('')
    flash('Member added.')
  }

  function toggleMember(memberId: string) {
    if (!selectedOrg) return
    setMembersByOrg((map) => ({
      ...map,
      [selectedOrg.id]: (map[selectedOrg.id] ?? []).map((member) =>
        member.id === memberId
          ? { ...member, status: member.status === 'Active' ? 'Inactive' : 'Active' }
          : member,
      ),
    }))
  }

  function removeMember(memberId: string) {
    if (!selectedOrg) return
    setMembersByOrg((map) => ({
      ...map,
      [selectedOrg.id]: (map[selectedOrg.id] ?? []).filter((member) => member.id !== memberId),
    }))
    flash('Member removed.')
  }

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="Owners, operators, and customers."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={openAdd}>
            Add org
          </button>
        }
      />

      <aside className="k-help-note" aria-label="Organizations help">
        <strong>Organizations</strong>
        <div>
          Register Owner, PMC, or Customer accounts. Activate before linking properties; Members
          manages people for that org. Suspended blocks new access links without deleting history.
        </div>
      </aside>

      {notice ? <p className="k-inline-notice">{notice}</p> : null}

      <KpiRow
        items={[
          { label: 'Organizations', value: orgs.length },
          { label: 'Active', value: orgs.filter((org) => org.status === 'Active').length, tone: 'ok' },
          { label: 'Pending', value: orgs.filter((org) => org.status === 'Pending').length, tone: 'warn' },
          { label: 'Managed properties', value: orgs.reduce((sum, org) => sum + org.properties, 0), tone: 'info' },
        ]}
      />
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search name, ID, or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectFilter label="Type" value={type} onChange={setType}>
          <option>All</option>
          <option>Owner</option>
          <option>PMC</option>
          <option>Customer</option>
        </SelectFilter>
        <SelectFilter label="Status" value={statusFilter} onChange={setStatusFilter}>
          <option>All</option>
          <option>Active</option>
          <option>Pending</option>
          <option>Suspended</option>
        </SelectFilter>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Directory">
            <DataTable
              columns={['Organization', 'Type', 'Properties', 'Status', '']}
              rows={shown.map((org) => [
                org.name,
                org.type,
                org.properties,
                <Status key={org.id} value={org.status} />,
                <button key={`o-${org.id}`} type="button" className="k-link-btn" onClick={() => setSelected(org.id)}>
                  Select
                </button>,
              ])}
            />
          </Panel>
        }
        right={
          <Panel title="Account summary">
            {selectedOrg ? (
              <div className="k-detail-list">
                <div>
                  <span>Name</span>
                  <strong>{selectedOrg.name}</strong>
                </div>
                <div>
                  <span>Account ID</span>
                  <code>{selectedOrg.id}</code>
                </div>
                <div>
                  <span>Classification</span>
                  <Status value={selectedOrg.type} />
                </div>
                <div>
                  <span>Status</span>
                  <Status value={selectedOrg.status} />
                </div>
                <div>
                  <span>Properties</span>
                  <strong>{selectedOrg.properties}</strong>
                </div>
                <div>
                  <span>Contact</span>
                  <strong>{selectedOrg.contactEmail || '—'}</strong>
                </div>
                <div>
                  <span>Members</span>
                  <strong>{members.length}</strong>
                </div>
                {selectedOrg.notes ? (
                  <div>
                    <span>Notes</span>
                    <strong>{selectedOrg.notes}</strong>
                  </div>
                ) : null}
                <ActionBar>
                  <button type="button" className="k-btn k-btn--ghost" onClick={openEdit}>
                    Edit
                  </button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={openMembers}>
                    Members
                  </button>
                </ActionBar>
                <ActionBar>
                  {selectedOrg.status !== 'Active' ? (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setOrgStatus('Active')}>
                      Activate
                    </button>
                  ) : null}
                  {selectedOrg.status !== 'Pending' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setOrgStatus('Pending')}>
                      Set pending
                    </button>
                  ) : null}
                  {selectedOrg.status !== 'Suspended' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setOrgStatus('Suspended')}>
                      Suspend
                    </button>
                  ) : null}
                </ActionBar>
              </div>
            ) : (
              <EmptyHint text="Select an organization." />
            )}
          </Panel>
        }
      />

      {modal === 'add' || modal === 'edit' ? (
        <div className="k-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="org-form-title">
          <form className="k-modal" onSubmit={modal === 'add' ? handleCreate : handleSaveEdit}>
            <div className="k-modal__head">
              <h2 id="org-form-title">{modal === 'add' ? 'Add organization' : 'Edit organization'}</h2>
              <button type="button" className="k-modal__close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
              <FormGrid>
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Organization name"
                    autoFocus
                    required
                  />
                </Field>
                <Field label="Type">
                  <select value={orgType} onChange={(event) => setOrgType(event.target.value as 'Owner' | 'PMC' | 'Customer')}>
                    <option value="Owner">Owner</option>
                    <option value="PMC">PMC</option>
                    <option value="Customer">Customer</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select value={status} onChange={(event) => setStatus(event.target.value as 'Active' | 'Pending' | 'Suspended')}>
                    <option value="Pending">Pending</option>
                    <option value="Active">Active</option>
                    <option value="Suspended">Suspended</option>
                  </select>
                </Field>
                <Field label="Contact email">
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="contact@organization.com"
                  />
                </Field>
                <Field label="Notes">
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional notes"
                  />
                </Field>
              </FormGrid>
              {error ? (
                <p className="k-inline-notice k-inline-notice--warn" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className="k-btn k-btn--primary">
                {modal === 'add' ? 'Create organization' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {modal === 'members' && selectedOrg ? (
        <div className="k-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="org-members-title">
          <div className="k-modal k-modal--wide">
            <div className="k-modal__head">
              <h2 id="org-members-title">Members · {selectedOrg.name}</h2>
              <button type="button" className="k-modal__close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
              <form className="k-member-form" onSubmit={handleAddMember}>
                <FormGrid>
                  <Field label="Name">
                    <input value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Full name" />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="user@organization.com"
                    />
                  </Field>
                  <Field label="Role">
                    <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}>
                      {roles.map((role) => (
                        <option key={role.id} value={role.name}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </FormGrid>
                <ActionBar>
                  <button type="submit" className="k-btn k-btn--primary">
                    Add member
                  </button>
                </ActionBar>
                {error ? (
                  <p className="k-inline-notice k-inline-notice--warn" role="alert">
                    {error}
                  </p>
                ) : null}
              </form>
              <Panel title={`Directory (${members.length})`}>
                {members.length ? (
                  <DataTable
                    columns={['Name', 'Email', 'Role', 'Status', '']}
                    rows={members.map((member) => [
                      member.name,
                      member.email,
                      member.role,
                      <Status key={`${member.id}-s`} value={member.status} />,
                      <span key={`${member.id}-a`} className="k-row-actions">
                        <button type="button" className="k-link-btn" onClick={() => toggleMember(member.id)}>
                          {member.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                        <button type="button" className="k-link-btn" onClick={() => removeMember(member.id)}>
                          Remove
                        </button>
                      </span>,
                    ])}
                  />
                ) : (
                  <EmptyHint text="No members yet." />
                )}
              </Panel>
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

type UserRecord = User & {
  lastAccess: string
}

/** lastAccess is display-only; it round-trips through Firestore when present. */
function toUserRecord(user: User, index: number): UserRecord {
  const stored = user as Partial<UserRecord>
  return {
    ...user,
    lastAccess: stored.lastAccess ?? (index < 3 ? 'Today' : index < 6 ? 'Sep 3' : 'Aug 28'),
  }
}

export function UsersPage() {
  const { data, upsert, logAudit } = useErpData()
  const organizations = data.organizations
  const roles = data.roles
  const [list, setList] = useState<UserRecord[]>(() => data.users.map(toUserRecord))
  const [status, setStatus] = useState('All')
  const [roleFilter, setRoleFilter] = useState('All')
  const [orgFilter, setOrgFilter] = useState('All')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(data.users[0]?.id ?? null)
  const [modal, setModal] = useState<'invite' | 'edit' | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [org, setOrg] = useState('')
  const [userStatus, setUserStatus] = useState<'Active' | 'Inactive'>('Active')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setList(data.users.map(toUserRecord))
    setSelected((prev) => (prev && data.users.some((user) => user.id === prev) ? prev : data.users[0]?.id ?? null))
  }, [data.users])

  const orgOptions = useMemo(
    () => Array.from(new Set([...organizations.map((item) => item.name), ...list.map((user) => user.org)])).sort(),
    [organizations, list],
  )
  const roleOptions = useMemo(() => roles.map((item) => item.name), [roles])

  const shown = list.filter((user) => {
    const matchStatus = status === 'All' || user.status === status
    const matchRole = roleFilter === 'All' || user.role === roleFilter
    const matchOrg = orgFilter === 'All' || user.org === orgFilter
    const matchQuery = `${user.name} ${user.email} ${user.org} ${user.role}`.toLowerCase().includes(query.toLowerCase())
    return matchStatus && matchRole && matchOrg && matchQuery
  })
  const selectedUser = list.find((user) => user.id === selected) ?? null

  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  function resetForm() {
    setName('')
    setEmail('')
    setRole(roles[0]?.name ?? 'Viewer')
    setOrg(organizations[0]?.name ?? orgOptions[0] ?? '')
    setUserStatus('Active')
    setError('')
  }

  function fillForm(user: UserRecord) {
    setName(user.name)
    setEmail(user.email)
    setRole(user.role)
    setOrg(user.org)
    setUserStatus(user.status)
    setError('')
  }

  function openInvite() {
    resetForm()
    setModal('invite')
  }

  function openEdit() {
    if (!selectedUser) return
    fillForm(selectedUser)
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setError('')
  }

  function validateUserFields(requireUniqueEmail: boolean) {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedName || !trimmedEmail) {
      setError('Name and email are required.')
      return null
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email.')
      return null
    }
    if (!org.trim()) {
      setError('Organization is required.')
      return null
    }
    const duplicate = list.some(
      (user) => user.email.toLowerCase() === trimmedEmail && (modal !== 'edit' || user.id !== selectedUser?.id),
    )
    if (requireUniqueEmail && duplicate) {
      setError('That email is already in use.')
      return null
    }
    return { trimmedName, trimmedEmail }
  }

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const valid = validateUserFields(true)
    if (!valid) return
    const id = `usr-${String(Date.now()).slice(-6)}`
    const next: UserRecord = {
      id,
      name: valid.trimmedName,
      email: valid.trimmedEmail,
      roleId: roles.find((r) => r.name === role)?.id ?? roles[0]?.id ?? '',
      role,
      organizationId: organizations.find((o) => o.name === org.trim())?.id ?? organizations[0]?.id ?? '',
      org: org.trim(),
      status: userStatus,
      lastAccess: 'Never',
    }
    setList((items) => [next, ...items])
    setSelected(id)
    setModal(null)
    resetForm()
    flash('Invite created.')
    persist(async () => {
      await upsert('users', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'user.invite',
        target: next.email,
      })
    })
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedUser) return
    const valid = validateUserFields(true)
    if (!valid) return
    const next: UserRecord = {
      ...selectedUser,
      name: valid.trimmedName,
      email: valid.trimmedEmail,
      roleId: roles.find((r) => r.name === role)?.id ?? selectedUser.roleId,
      role,
      organizationId: organizations.find((o) => o.name === org.trim())?.id ?? selectedUser.organizationId,
      org: org.trim(),
      status: userStatus,
    }
    setList((items) => items.map((user) => (user.id === next.id ? next : user)))
    setModal(null)
    flash('User updated.')
    persist(async () => {
      await upsert('users', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'user.update',
        target: next.email,
      })
    })
  }

  function setStatusForSelected(nextStatus: 'Active' | 'Inactive') {
    if (!selectedUser) return
    const next: UserRecord = { ...selectedUser, status: nextStatus }
    setList((items) => items.map((user) => (user.id === next.id ? next : user)))
    flash(nextStatus === 'Active' ? 'User activated.' : 'User deactivated.')
    persist(async () => {
      await upsert('users', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: nextStatus === 'Active' ? 'user.activate' : 'user.deactivate',
        target: next.email,
      })
    })
  }

  function exportCsv() {
    const header = ['Name', 'Email', 'Role', 'Organization', 'Status', 'Last access']
    const rows = shown.map((user) => [user.name, user.email, user.role, user.org, user.status, user.lastAccess])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `keiros-users-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    flash('CSV exported.')
  }

  return (
    <>
      <PageHeader
        title="User Management"
        subtitle="Identity, access, and membership."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={openInvite}>
            Invite user
          </button>
        }
      />

      <aside className="k-help-note" aria-label="User management help">
        <strong>User management</strong>
        <div>
          Invite with a unique email, role, and organization. Activate or deactivate controls login
          without deleting history. Export CSV downloads only the current filtered list.
        </div>
      </aside>

      {notice ? <p className="k-inline-notice">{notice}</p> : null}

      <KpiRow
        items={[
          { label: 'Users', value: list.length },
          { label: 'Active', value: list.filter((user) => user.status === 'Active').length, tone: 'ok' },
          { label: 'Inactive', value: list.filter((user) => user.status === 'Inactive').length, tone: 'neutral' },
          { label: 'Organizations', value: new Set(list.map((user) => user.org)).size, tone: 'info' },
        ]}
      />
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search name, email, role, or org"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectFilter label="Status" value={status} onChange={setStatus}>
          <option>All</option>
          <option>Active</option>
          <option>Inactive</option>
        </SelectFilter>
        <SelectFilter label="Role" value={roleFilter} onChange={setRoleFilter}>
          <option>All</option>
          {roleOptions.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Organization" value={orgFilter} onChange={setOrgFilter}>
          <option>All</option>
          {orgOptions.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectFilter>
        <button type="button" className="k-btn k-btn--ghost" onClick={exportCsv}>
          Export CSV
        </button>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>

      <SplitView
        left={
          <Panel title="User directory">
            <DataTable
              columns={['User', 'Email', 'Role', 'Organization', 'Status', '']}
              rows={shown.map((user) => [
                user.name,
                user.email,
                user.role,
                user.org,
                <Status key={user.id} value={user.status} />,
                <button key={`s-${user.id}`} type="button" className="k-link-btn" onClick={() => setSelected(user.id)}>
                  Select
                </button>,
              ])}
            />
          </Panel>
        }
        right={
          <Panel title="User summary">
            {selectedUser ? (
              <div className="k-detail-list">
                <div>
                  <span>Name</span>
                  <strong>{selectedUser.name}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{selectedUser.email}</strong>
                </div>
                <div>
                  <span>User ID</span>
                  <code>{selectedUser.id}</code>
                </div>
                <div>
                  <span>Role</span>
                  <strong>{selectedUser.role}</strong>
                </div>
                <div>
                  <span>Organization</span>
                  <strong>{selectedUser.org}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <Status value={selectedUser.status} />
                </div>
                <div>
                  <span>Last access</span>
                  <strong>{selectedUser.lastAccess}</strong>
                </div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--ghost" onClick={openEdit}>
                    Edit
                  </button>
                  {selectedUser.status === 'Active' ? (
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setStatusForSelected('Inactive')}>
                      Deactivate
                    </button>
                  ) : (
                    <button type="button" className="k-btn k-btn--primary" onClick={() => setStatusForSelected('Active')}>
                      Activate
                    </button>
                  )}
                </ActionBar>
              </div>
            ) : (
              <EmptyHint text="Select a user." />
            )}
          </Panel>
        }
      />

      {modal ? (
        <div className="k-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="user-form-title">
          <form className="k-modal" onSubmit={modal === 'invite' ? handleInvite : handleSaveEdit}>
            <div className="k-modal__head">
              <h2 id="user-form-title">{modal === 'invite' ? 'Invite user' : 'Edit user'}</h2>
              <button type="button" className="k-modal__close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
              <FormGrid>
                <Field label="Name">
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" autoFocus required />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="user@organization.com"
                    required
                  />
                </Field>
                <Field label="Role">
                  <select required value={role} onChange={(event) => setRole(event.target.value)}>
                    <option value="">Select</option>
                    {roleOptions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Organization">
                  <select required value={org} onChange={(event) => setOrg(event.target.value)}>
                    <option value="">Select</option>
                    {orgOptions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={userStatus} onChange={(event) => setUserStatus(event.target.value as 'Active' | 'Inactive')}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </Field>
              </FormGrid>
              {error ? (
                <p className="k-inline-notice k-inline-notice--warn" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className="k-btn k-btn--primary">
                {modal === 'invite' ? 'Send invite' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}

type MatrixCell = 'Allow' | 'Deny' | 'N/A'
type MatrixRow = { view: MatrixCell; edit: MatrixCell; approve: MatrixCell }
type AccessMatrix = Record<string, MatrixRow>

const ROLE_MODULES = ['Properties', 'Mapping', 'Analytics', 'Publishing', 'API', 'Users'] as const

function defaultMatrix(roleName: string): AccessMatrix {
  const full = (view: MatrixCell, edit: MatrixCell, approve: MatrixCell): MatrixRow => ({ view, edit, approve })
  const isAdmin = roleName.includes('Admin')
  const isViewer = roleName === 'Viewer'
  const isReviewer = roleName.includes('Reviewer')
  const isMapper = roleName.includes('Mapper')
  const isApi = roleName.includes('API')
  const isManager = roleName.includes('Manager') || roleName.includes('Operations')

  return {
    Properties: full('Allow', isAdmin || isManager ? 'Allow' : 'Deny', isAdmin || isReviewer ? 'Allow' : 'Deny'),
    Mapping: full('Allow', isAdmin || isMapper || isManager ? 'Allow' : 'Deny', isAdmin || isReviewer ? 'Allow' : 'Deny'),
    Analytics: full('Allow', isAdmin ? 'Allow' : 'Deny', 'N/A'),
    Publishing: full(isViewer || isApi ? 'Deny' : 'Allow', isAdmin || isManager ? 'Allow' : 'Deny', isAdmin || isReviewer ? 'Allow' : 'Deny'),
    API: full(isAdmin || isApi ? 'Allow' : 'Deny', isAdmin || isApi ? 'Allow' : 'Deny', 'N/A'),
    Users: full(isAdmin || isManager ? 'Allow' : 'Deny', isAdmin ? 'Allow' : 'Deny', 'N/A'),
  }
}

function matrixSummary(matrix: AccessMatrix): string {
  const allowed = ROLE_MODULES.filter((module) => {
    const row = matrix[module]
    return row.view === 'Allow' || row.edit === 'Allow' || row.approve === 'Allow'
  })
  return allowed.length ? `Access: ${allowed.join(', ')}` : 'No module access'
}

function cellTone(value: MatrixCell): Tone {
  if (value === 'Allow') return 'ok'
  if (value === 'Deny') return 'danger'
  return 'neutral'
}

type RoleRecord = Role & {
  matrix: AccessMatrix
  description: string
}

/** matrix / description are stored alongside the canonical role fields in Firestore. */
function toRoleRecord(role: Role): RoleRecord {
  const stored = role as Partial<RoleRecord>
  return {
    ...role,
    matrix: stored.matrix ?? defaultMatrix(role.name),
    description: stored.description ?? role.permissions,
  }
}

export function RolesPage() {
  const { data, upsert, remove, logAudit } = useErpData()
  const [list, setList] = useState<RoleRecord[]>(() => data.roles.map(toRoleRecord))
  const [selected, setSelected] = useState<string | null>(data.roles[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setList(data.roles.map(toRoleRecord))
    setSelected((prev) => (prev && data.roles.some((role) => role.id === prev) ? prev : data.roles[0]?.id ?? null))
  }, [data.roles])

  const shown = list.filter((role) =>
    `${role.name} ${role.description}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = list.find((role) => role.id === selected) ?? null

  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  function openCreate() {
    setName('')
    setDescription('')
    setError('')
    setModal('create')
  }

  function openEdit() {
    if (!current) return
    setName(current.name)
    setDescription(current.description)
    setError('')
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setError('')
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Role name is required.')
      return
    }
    if (list.some((role) => role.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('That role name already exists.')
      return
    }
    const id = `role-${String(Date.now()).slice(-6)}`
    const matrix = defaultMatrix(trimmed)
    const next: RoleRecord = {
      id,
      name: trimmed,
      description: description.trim() || matrixSummary(matrix),
      permissions: description.trim() || matrixSummary(matrix),
      usersCount: 0,
      matrix,
    }
    setList((items) => [next, ...items])
    setSelected(id)
    setModal(null)
    flash('Role created.')
    persist(async () => {
      await upsert('roles', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'role.create',
        target: next.name,
      })
    })
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Role name is required.')
      return
    }
    if (list.some((role) => role.id !== current.id && role.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('That role name already exists.')
      return
    }
    const next: RoleRecord = {
      ...current,
      name: trimmed,
      description: description.trim() || current.description,
      permissions: description.trim() || current.permissions,
    }
    setList((items) => items.map((role) => (role.id === next.id ? next : role)))
    setModal(null)
    flash('Role updated.')
    persist(async () => {
      await upsert('roles', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'role.update',
        target: next.name,
      })
    })
  }

  function duplicateRole() {
    if (!current) return
    const id = `role-${String(Date.now()).slice(-6)}`
    let copyName = `${current.name} copy`
    let n = 2
    while (list.some((role) => role.name.toLowerCase() === copyName.toLowerCase())) {
      copyName = `${current.name} copy ${n}`
      n += 1
    }
    const next: RoleRecord = {
      ...current,
      id,
      name: copyName,
      usersCount: 0,
      matrix: Object.fromEntries(
        Object.entries(current.matrix).map(([key, row]) => [key, { ...row }]),
      ) as AccessMatrix,
    }
    setList((items) => [next, ...items])
    setSelected(id)
    flash('Role duplicated.')
    persist(async () => {
      await upsert('roles', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'role.duplicate',
        target: next.name,
      })
    })
  }

  function deleteRole() {
    if (!current) return
    if (current.usersCount > 0) {
      setError('Reassign users before deleting this role.')
      setConfirmDelete(false)
      flash('Role has assigned users.')
      return
    }
    const removed = current
    setList((items) => items.filter((role) => role.id !== removed.id))
    setSelected(() => {
      const remaining = list.filter((role) => role.id !== removed.id)
      return remaining[0]?.id ?? null
    })
    setConfirmDelete(false)
    flash('Role deleted.')
    persist(async () => {
      await remove('roles', removed.id)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'role.delete',
        target: removed.name,
      })
    })
  }

  function cycleCell(module: string, key: keyof MatrixRow) {
    if (!current) return
    const row = current.matrix[module]
    if (row[key] === 'N/A') return
    const nextValue: MatrixCell = row[key] === 'Allow' ? 'Deny' : 'Allow'
    const matrix: AccessMatrix = { ...current.matrix, [module]: { ...row, [key]: nextValue } }
    const next: RoleRecord = {
      ...current,
      matrix,
      permissions: matrixSummary(matrix),
      description: current.description.startsWith('Access:') ? matrixSummary(matrix) : current.description,
    }
    setList((items) => items.map((role) => (role.id === next.id ? next : role)))
    persist(() => upsert('roles', next))
  }

  function MatrixBadge({
    module,
    field,
    value,
  }: {
    module: string
    field: keyof MatrixRow
    value: MatrixCell
  }) {
    const clickable = value !== 'N/A'
    return (
      <button
        type="button"
        className={`k-matrix-btn${clickable ? '' : ' k-matrix-btn--static'}`}
        onClick={() => clickable && cycleCell(module, field)}
        disabled={!clickable}
        title={clickable ? 'Click to toggle Allow / Deny' : 'Not applicable'}
      >
        <Badge tone={cellTone(value)}>{value}</Badge>
      </button>
    )
  }

  return (
    <>
      <PageHeader
        title="Role Management"
        subtitle="Permission bundles and assignments."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={openCreate}>
            Create role
          </button>
        }
      />

      <aside className="k-help-note" aria-label="Role management help">
        <strong>Role management</strong>
        <div>
          Permission bundles for menus and actions. Toggle View / Edit / Approve in the matrix;
          Duplicate copies access with zero users. Delete only when no one is assigned.
        </div>
      </aside>

      {notice ? <p className="k-inline-notice">{notice}</p> : null}
      {error && !modal ? (
        <p className="k-inline-notice k-inline-notice--warn" role="alert">
          {error}
        </p>
      ) : null}

      <Toolbar>
        <input
          className="k-search"
          placeholder="Search roles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="k-toolbar__meta">{shown.length} roles</span>
      </Toolbar>

      <div className="k-role-grid">
        {shown.map((role) => (
          <button
            key={role.id}
            type="button"
            className={`k-role-card${selected === role.id ? ' k-role-card--selected' : ''}`}
            onClick={() => {
              setSelected(role.id)
              setConfirmDelete(false)
              setError('')
            }}
          >
            <span>{role.name}</span>
            <strong>{role.usersCount}</strong>
            <small>users</small>
          </button>
        ))}
      </div>

      {current ? (
        <SplitView
          left={
            <Panel title="Role details">
              <div className="k-detail-list">
                <div>
                  <span>Role</span>
                  <strong>{current.name}</strong>
                </div>
                <div>
                  <span>Role ID</span>
                  <code>{current.id}</code>
                </div>
                <div>
                  <span>Assignments</span>
                  <strong>{current.usersCount}</strong>
                </div>
                <div>
                  <span>Description</span>
                  <strong>{current.description}</strong>
                </div>
                <div>
                  <span>Permissions</span>
                  <p>{current.permissions}</p>
                </div>
              </div>
              <ActionBar>
                <button type="button" className="k-btn k-btn--ghost" onClick={openEdit}>
                  Edit
                </button>
                <button type="button" className="k-btn k-btn--ghost" onClick={duplicateRole}>
                  Duplicate
                </button>
                {!confirmDelete ? (
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </button>
                ) : (
                  <>
                    <button type="button" className="k-btn k-btn--primary" onClick={deleteRole}>
                      Confirm delete
                    </button>
                    <button type="button" className="k-btn k-btn--ghost" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                  </>
                )}
              </ActionBar>
            </Panel>
          }
          right={
            <Panel title="Access matrix" actions={<span className="k-toolbar__meta">Click cells to toggle</span>}>
              <DataTable
                columns={['Module', 'View', 'Edit', 'Approve']}
                rows={ROLE_MODULES.map((module) => {
                  const row = current.matrix[module]
                  return [
                    module,
                    <MatrixBadge key={`${module}-v`} module={module} field="view" value={row.view} />,
                    <MatrixBadge key={`${module}-e`} module={module} field="edit" value={row.edit} />,
                    <MatrixBadge key={`${module}-a`} module={module} field="approve" value={row.approve} />,
                  ]
                })}
              />
            </Panel>
          }
        />
      ) : (
        <EmptyHint text="Select or create a role." />
      )}

      {modal ? (
        <div className="k-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="role-form-title">
          <form className="k-modal" onSubmit={modal === 'create' ? handleCreate : handleSaveEdit}>
            <div className="k-modal__head">
              <h2 id="role-form-title">{modal === 'create' ? 'Create role' : 'Edit role'}</h2>
              <button type="button" className="k-modal__close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
              <FormGrid>
                <Field label="Role name">
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Role name" autoFocus required />
                </Field>
                <Field label="Description">
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What this role can do"
                  />
                </Field>
              </FormGrid>
              {error ? (
                <p className="k-inline-notice k-inline-notice--warn" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={closeModal}>
                Cancel
              </button>
              <button type="submit" className="k-btn k-btn--primary">
                {modal === 'create' ? 'Create role' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}

export function PropertyFormPage({ onNavigate }: PageProps) {
  return <ComplexesPage onNavigate={onNavigate} />
}

export function PropertyDetailPage({ onNavigate }: PageProps) {
  return <ComplexesPage onNavigate={onNavigate} />
}

export {
  FieldMappingPage,
  CoordinateReviewPage,
  MappingQualityPage,
  ApprovalQueuePage,
  CorrectionRequestsPage,
  MapPublishingPage,
  MapVersionsPage,
} from './mappingPages'

import { WayfindingPage } from './WayfindingPage'

/** @deprecated name retained for AppShell import — use WayfindingPage */
export function MapViewerPage() {
  return <WayfindingPage />
}
