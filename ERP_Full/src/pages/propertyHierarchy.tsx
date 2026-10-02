import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { PageId } from '../app/nav'
import type {
  Building,
  BuildingStatus,
  Complex,
  ComplexStatus,
  Floor,
  Location,
  LocationType,
  SiteProperty,
} from '../data/erpData'
import { useErpData } from '../data/ErpDataProvider'
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
import { KeriosaImportPanel } from '../components/keriosa/KeriosaImportPanel'
import './pages.css'

type PageProps = { onNavigate?: (page: PageId) => void }
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const complexStatuses: ComplexStatus[] = ['Draft', 'Mapped', 'Review', 'Published']
const buildingStatuses: BuildingStatus[] = ['Active', 'Draft', 'Inactive']
const locationTypes: LocationType[] = [
  'Room',
  'Unit',
  'Door',
  'Amenity',
  'Entry',
  'Exit',
  'Stairs',
  'Elevator',
  'Corridor',
  'Pool',
  'Gym',
  'Lobby',
  'Parking',
]

/** Firestore writes are fire-and-forget; the provider surfaces failures in the app shell. */
function persist(work: () => Promise<unknown>) {
  void work().catch(() => {})
}

/** Local editable copy of a Firestore-backed collection, resynced whenever the snapshot changes. */
function useCollectionState<T extends { id: string }>(source: T[]) {
  const [items, setItems] = useState<T[]>(() => source.map((item) => ({ ...item })))
  const [selectedId, setSelectedId] = useState(source[0]?.id ?? '')

  useEffect(() => {
    setItems(source.map((item) => ({ ...item })))
    setSelectedId((prev) =>
      prev && source.some((item) => item.id === prev) ? prev : source[0]?.id ?? '',
    )
  }, [source])

  return { items, setItems, selectedId, setSelectedId }
}

function statusTone(value: string): Tone {
  if (['Active', 'Published', 'Mapped'].includes(value)) return 'ok'
  if (['Review', 'Draft'].includes(value)) return 'warn'
  if (value === 'Inactive') return 'danger'
  return 'neutral'
}

function Status({ value }: { value: string }) {
  return <Badge tone={statusTone(value)}>{value}</Badge>
}

function SelectFilter({
  value,
  onChange,
  children,
  label,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  label: string
  disabled?: boolean
}) {
  return (
    <label className="k-compact-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  )
}

function HelpNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="k-help-note" aria-label={`${label} help`}>
      <strong>Help</strong>
      {children}
    </aside>
  )
}

function ModalForm({
  title,
  submitLabel,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  submitLabel: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return (
    <div className="k-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <form className="k-modal" onSubmit={onSubmit}>
        <div className="k-modal__head">
          <h2>{title}</h2>
          <button type="button" className="k-modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="k-modal__body">{children}</div>
        <div className="k-modal__actions">
          <button type="button" className="k-btn k-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="k-btn k-btn--primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

function Progress({ value }: { value: number }) {
  const bounded = Math.max(0, Math.min(100, value))
  return (
    <div className="k-progress" title={`${bounded}%`}>
      <span className="k-progress__bar" style={{ width: `${bounded}%` }} />
      <small>{bounded}%</small>
    </div>
  )
}

export function ComplexesPage({ onNavigate }: PageProps) {
  const { data, upsert, logAudit } = useErpData()
  const organizations = data.organizations
  const { items, setItems, selectedId, setSelectedId } = useCollectionState(data.complexes)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [status, setStatus] = useState<ComplexStatus>('Draft')

  const selected = items.find((item) => item.id === selectedId) ?? null
  const shown = items.filter(
    (item) =>
      (statusFilter === 'All' || item.status === statusFilter) &&
      `${item.name} ${item.city} ${item.address ?? ''} ${item.organizationName}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )

  function resetForm() {
    setName('')
    setCity('')
    setAddress('')
    setOrganizationName('')
    setStatus('Draft')
  }

  function openAdd() {
    resetForm()
    setModal('add')
  }

  function openEdit() {
    if (!selected) return
    setName(selected.name)
    setCity(selected.city)
    setAddress(selected.address ?? '')
    setOrganizationName(selected.organizationName)
    setStatus(selected.status)
    setModal('edit')
  }

  /** A complex is also a SiteProperty (kind 'complex', sharing the complex id). */
  function siteFromComplex(complex: Complex): SiteProperty {
    const existing = data.siteProperties.find((item) => item.id === complex.id)
    return {
      ...(existing ?? {}),
      id: complex.id,
      kind: 'complex',
      name: complex.name,
      city: complex.city,
      organizationId: complex.organizationId,
      organizationName: complex.organizationName,
      status: complex.status,
      complexId: complex.id,
      buildingId: null,
      readiness: complex.readiness,
      address: complex.address,
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !city.trim() || !organizationName) return
    const org = organizations.find((o) => o.name === organizationName)
    if (modal === 'edit' && selected) {
      const next: Complex = {
        ...selected,
        name: name.trim(),
        city: city.trim(),
        address: address.trim(),
        organizationId: org?.id ?? selected.organizationId,
        organizationName,
        status,
      }
      setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
      persist(async () => {
        await upsert('complexes', next)
        await upsert('siteProperties', siteFromComplex(next))
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'complex.update',
          target: next.name,
        })
      })
    } else {
      const next: Complex = {
        id: `cpx-${Date.now()}`,
        name: name.trim(),
        city: city.trim(),
        address: address.trim(),
        organizationId: org?.id ?? organizations[0]?.id ?? '',
        organizationName,
        status,
        buildings: 0,
        floors: 0,
        readiness: 0,
      }
      setItems((list) => [next, ...list])
      setSelectedId(next.id)
      persist(async () => {
        await upsert('complexes', next)
        await upsert('siteProperties', siteFromComplex(next))
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'complex.create',
          target: next.name,
        })
      })
    }
    setModal(null)
  }

  return (
    <>
      <PageHeader
        title="Complexes"
        subtitle="Portfolio hierarchy and mapping readiness."
        actions={
          <button type="button" className="k-btn k-btn--primary" onClick={openAdd}>
            Add complex
          </button>
        }
      />
      <HelpNote label="Complexes">
        Hierarchy is <b>Complex → Building → Floor → Unit</b>. A complex groups related buildings and
        tracks aggregate floor coverage and readiness across the campus.
      </HelpNote>
      <KpiRow
        items={[
          { label: 'Complexes', value: items.length },
          { label: 'Buildings', value: items.reduce((sum, item) => sum + item.buildings, 0), tone: 'info' },
          { label: 'Published', value: items.filter((item) => item.status === 'Published').length, tone: 'ok' },
          {
            label: 'Avg readiness',
            value: `${items.length ? Math.round(items.reduce((sum, item) => sum + item.readiness, 0) / items.length) : 0}%`,
            tone: 'info',
          },
        ]}
      />
      <Toolbar>
        <input
          className="k-search"
          placeholder="Search complex, city, or organization"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectFilter label="Status" value={statusFilter} onChange={setStatusFilter}>
          <option>All</option>
          {complexStatuses.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </SelectFilter>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Complex directory">
            {shown.length ? (
              <DataTable
                columns={['Complex', 'City', 'Organization', 'Status', '']}
                rows={shown.map((item) => [
                  item.name,
                  item.city,
                  item.organizationName,
                  <Status key={item.id} value={item.status} />,
                  <button type="button" key={`select-${item.id}`} className="k-link-btn" onClick={() => setSelectedId(item.id)}>
                    Select
                  </button>,
                ])}
              />
            ) : (
              <EmptyHint text="No complexes match the current filters." />
            )}
          </Panel>
        }
        right={
          <Panel title="Complex summary">
            {selected ? (
              <div className="k-detail-list">
                <div><span>Name</span><strong>{selected.name}</strong></div>
                <div><span>Address</span><strong>{selected.address || '—'}</strong></div>
                <div><span>Buildings</span><strong>{selected.buildings}</strong></div>
                <div><span>Floors</span><strong>{selected.floors}</strong></div>
                <div><span>Readiness</span><Progress value={selected.readiness} /></div>
                <div><span>Status</span><Status value={selected.status} /></div>
                <ActionBar>
                  <button type="button" className="k-btn k-btn--primary" onClick={openEdit}>Edit</button>
                  <button type="button" className="k-btn k-btn--ghost" onClick={() => onNavigate?.('buildings')}>
                    Open buildings
                  </button>
                </ActionBar>
              </div>
            ) : (
              <EmptyHint text="Select a complex to view its summary." />
            )}
          </Panel>
        }
      />
      {modal ? (
        <ModalForm
          title={modal === 'add' ? 'Add complex' : 'Edit complex'}
          submitLabel={modal === 'add' ? 'Create complex' : 'Save changes'}
          onClose={() => setModal(null)}
          onSubmit={save}
        >
          <FormGrid>
            <Field label="Name"><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="City"><input required value={city} onChange={(event) => setCity(event.target.value)} /></Field>
            <Field label="Address"><input value={address} onChange={(event) => setAddress(event.target.value)} /></Field>
            <Field label="Organization">
              <select required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)}>
                <option value="">Select</option>
                {organizations.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as ComplexStatus)}>
                {complexStatuses.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
          </FormGrid>
        </ModalForm>
      ) : null}
    </>
  )
}

export const PropertiesPage = ComplexesPage

export function BuildingsPage() {
  const { data, upsert, remove, logAudit } = useErpData()
  const complexes = data.complexes
  const { items, setItems, selectedId, setSelectedId } = useCollectionState(data.buildings)
  const [query, setQuery] = useState('')
  const [affiliationFilter, setAffiliationFilter] = useState('All')
  const [complexFilter, setComplexFilter] = useState('All')
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [name, setName] = useState('')
  const [affiliation, setAffiliation] = useState<'Complex' | 'Independent'>('Complex')
  const [complexId, setComplexId] = useState('')
  const [status, setStatus] = useState<BuildingStatus>('Draft')
  const [floorCount, setFloorCount] = useState('1')

  const selected = items.find((item) => item.id === selectedId) ?? null
  const shown = items.filter((item) => {
    const affiliationMatches =
      affiliationFilter === 'All' ||
      (affiliationFilter === 'In complex' ? item.complexId !== null : item.complexId === null)
    const complexMatches =
      complexFilter === 'All' ||
      (complexFilter === 'Independent' ? item.complexId === null : item.complexId === complexFilter)
    return affiliationMatches && complexMatches && `${item.name} ${item.complexName ?? 'Independent'} ${item.city ?? ''}`.toLowerCase().includes(query.toLowerCase())
  })

  function openAdd() {
    setName('')
    setAffiliation('Complex')
    setComplexId('')
    setStatus('Draft')
    setFloorCount('1')
    setModal('add')
  }

  function openEdit() {
    if (!selected) return
    setName(selected.name)
    setAffiliation(selected.complexId ? 'Complex' : 'Independent')
    setComplexId(selected.complexId ?? '')
    setStatus(selected.status)
    setFloorCount(String(selected.floors))
    setModal('edit')
  }

  /** Independent buildings double as SiteProperty roots (kind 'independent'). */
  function siteFromBuilding(building: Building): SiteProperty {
    const existing = data.siteProperties.find((item) => item.id === building.id)
    const org = building.organizationId
      ? data.organizations.find((item) => item.id === building.organizationId)
      : undefined
    return {
      ...(existing ?? {}),
      id: building.id,
      kind: 'independent',
      name: building.name,
      city: building.city ?? '',
      organizationId: building.organizationId ?? existing?.organizationId ?? '',
      organizationName: org?.name ?? existing?.organizationName ?? '',
      status: building.status,
      complexId: null,
      buildingId: building.id,
      readiness: building.floors ? Math.round((building.mappedFloors / building.floors) * 100) : 0,
    }
  }

  function saveBuilding(next: Building, action: string) {
    persist(async () => {
      await upsert('buildings', next)
      if (next.complexId === null) {
        await upsert('siteProperties', siteFromBuilding(next))
      } else {
        const stale = data.siteProperties.find((item) => item.id === next.id)
        if (stale?.kind === 'independent') {
          await remove('siteProperties', next.id)
        }
      }
      await logAudit({ actorUserId: null, actor: 'ERP Console', action, target: next.name })
    })
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const complex = affiliation === 'Complex' ? complexes.find((item) => item.id === complexId) : undefined
    const floors = Math.max(0, Number.parseInt(floorCount, 10) || 0)
    const relation = {
      complexId: affiliation === 'Complex' ? complex?.id ?? null : null,
      complexName: affiliation === 'Complex' ? complex?.name ?? null : null,
      city: affiliation === 'Complex' ? complex?.city : selected?.city,
    }
    if (modal === 'edit' && selected) {
      const next: Building = {
        ...selected,
        ...relation,
        name: name.trim(),
        status,
        floors,
        mappedFloors: Math.min(selected.mappedFloors, floors),
      }
      setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
      saveBuilding(next, 'building.update')
    } else {
      const next: Building = {
        id: `bld-${Date.now()}`,
        ...relation,
        name: name.trim(),
        status,
        floors,
        mappedFloors: 0,
      }
      setItems((list) => [next, ...list])
      setSelectedId(next.id)
      saveBuilding(next, 'building.create')
    }
    setModal(null)
  }

  function setSelectedStatus(nextStatus: BuildingStatus) {
    if (!selected) return
    const next: Building = { ...selected, status: nextStatus }
    setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
    saveBuilding(next, 'building.status')
  }

  return (
    <>
      <PageHeader
        title="Buildings"
        subtitle="Complex-affiliated and independent structures."
        actions={<button type="button" className="k-btn k-btn--primary" onClick={openAdd}>Add building</button>}
      />
      <HelpNote label="Buildings">
        An <b>independent building</b> has no parent complex but still contains floors and locations. Assign a complex when buildings share a managed campus.
      </HelpNote>
      <KpiRow items={[
        { label: 'Buildings', value: items.length },
        { label: 'In complexes', value: items.filter((item) => item.complexId).length, tone: 'info' },
        { label: 'Independent', value: items.filter((item) => !item.complexId).length, tone: 'warn' },
        { label: 'Active', value: items.filter((item) => item.status === 'Active').length, tone: 'ok' },
      ]} />
      <Toolbar>
        <input className="k-search" placeholder="Search building or complex" value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="Affiliation" value={affiliationFilter} onChange={setAffiliationFilter}>
          <option>All</option><option>In complex</option><option>Independent</option>
        </SelectFilter>
        <SelectFilter label="Complex" value={complexFilter} onChange={setComplexFilter}>
          <option>All</option><option>Independent</option>
          {complexes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectFilter>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>
      <SplitView
        left={
          <Panel title="Building directory">
            {shown.length ? <DataTable columns={['Building', 'Affiliation', 'Floors', 'Status', '']} rows={shown.map((item) => [
              item.name,
              item.complexName ?? 'Independent',
              item.floors,
              <Status key={item.id} value={item.status} />,
              <button type="button" key={`select-${item.id}`} className="k-link-btn" onClick={() => setSelectedId(item.id)}>Select</button>,
            ])} /> : <EmptyHint text="No buildings match the current filters." />}
          </Panel>
        }
        right={
          <Panel title="Building summary">
            {selected ? <div className="k-detail-list">
              <div><span>Name</span><strong>{selected.name}</strong></div>
              <div><span>Affiliation</span><strong>{selected.complexName ?? 'Independent'}</strong></div>
              <div><span>Floors</span><strong>{selected.floors}</strong></div>
              <div><span>Mapped floors</span><strong>{selected.mappedFloors} / {selected.floors}</strong></div>
              <div><span>Status</span><Status value={selected.status} /></div>
              <ActionBar>
                <button type="button" className="k-btn k-btn--primary" onClick={openEdit}>Edit</button>
                {selected.status !== 'Active' ? <button type="button" className="k-btn k-btn--ghost" onClick={() => setSelectedStatus('Active')}>Activate</button> : null}
                {selected.status !== 'Inactive' ? <button type="button" className="k-btn k-btn--ghost" onClick={() => setSelectedStatus('Inactive')}>Set inactive</button> : null}
              </ActionBar>
            </div> : <EmptyHint text="Select a building to view its summary." />}
          </Panel>
        }
      />
      {modal ? (
        <ModalForm title={modal === 'add' ? 'Add building' : 'Edit building'} submitLabel={modal === 'add' ? 'Create building' : 'Save changes'} onClose={() => setModal(null)} onSubmit={save}>
          <FormGrid>
            <Field label="Name"><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Affiliation">
              <select value={affiliation} onChange={(event) => setAffiliation(event.target.value as 'Complex' | 'Independent')}>
                <option>Complex</option><option>Independent</option>
              </select>
            </Field>
            <Field label="Complex">
              <select
                required={affiliation === 'Complex'}
                disabled={affiliation === 'Independent'}
                value={complexId}
                onChange={(event) => setComplexId(event.target.value)}
              >
                <option value="">Select</option>
                {complexes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(event) => setStatus(event.target.value as BuildingStatus)}>
                {buildingStatuses.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Floor count"><input required min="0" type="number" value={floorCount} onChange={(event) => setFloorCount(event.target.value)} /></Field>
          </FormGrid>
        </ModalForm>
      ) : null}
    </>
  )
}

export function FloorsPage() {
  const { data, upsert, logAudit } = useErpData()
  const buildings = data.buildings
  const complexes = data.complexes
  const { items, setItems, selectedId, setSelectedId } = useCollectionState(data.floors)
  const [query, setQuery] = useState('')
  const [buildingFilter, setBuildingFilter] = useState('All')
  const [complexFilter, setComplexFilter] = useState('All')
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [buildingId, setBuildingId] = useState('')
  const [label, setLabel] = useState('')
  const [level, setLevel] = useState('1')
  const [mappedPct, setMappedPct] = useState('')

  const selected = items.find((item) => item.id === selectedId) ?? null
  const shown = items.filter((item) => {
    const complexMatches =
      complexFilter === 'All' ||
      (complexFilter === 'Independent' ? item.complexId === null : item.complexId === complexFilter)
    return (buildingFilter === 'All' || item.buildingId === buildingFilter) && complexMatches &&
      `${item.label} ${item.buildingName} ${item.complexName ?? 'Independent'}`.toLowerCase().includes(query.toLowerCase())
  })

  function openAdd() {
    setBuildingId('')
    setLabel('')
    setLevel('1')
    setMappedPct('')
    setModal('add')
  }

  function openEdit() {
    if (!selected) return
    setBuildingId(selected.buildingId)
    setLabel(selected.label)
    setLevel(String(selected.level))
    setMappedPct(String(selected.mappedPct))
    setModal('edit')
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const building = buildings.find((item) => item.id === buildingId)
    if (!building) return
    const relation = {
      buildingId: building.id,
      buildingName: building.name,
      complexId: building.complexId,
      complexName: building.complexName,
    }
    const values = {
      ...relation,
      propertyId: building.complexId ?? building.id,
      label: label.trim(),
      level: Number.parseInt(level, 10) || 0,
      mappedPct: mappedPct === '' ? 0 : Math.max(0, Math.min(100, Number.parseInt(mappedPct, 10) || 0)),
    }
    if (modal === 'edit' && selected) {
      const next: Floor = { ...selected, ...values }
      setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
      persist(async () => {
        await upsert('floors', next)
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'floor.update',
          target: `${next.buildingName} · ${next.label}`,
        })
      })
    } else {
      const next: Floor = { id: `flr-${Date.now()}`, ...values, locations: 0 }
      setItems((list) => [next, ...list])
      setSelectedId(next.id)
      persist(async () => {
        await upsert('floors', next)
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'floor.create',
          target: `${next.buildingName} · ${next.label}`,
        })
      })
    }
    setModal(null)
  }

  return (
    <>
      <PageHeader title="Floors" subtitle="Floor inventory and mapping coverage." actions={<button type="button" className="k-btn k-btn--primary" onClick={openAdd}>Add floor</button>} />
      <HelpNote label="Floors">
        Floors always belong to a building. Their complex is inherited from that building; floors in standalone buildings display <b>Independent</b>.
      </HelpNote>
      <KpiRow items={[
        { label: 'Floors', value: items.length },
        { label: 'Locations', value: items.reduce((sum, item) => sum + item.locations, 0), tone: 'info' },
        { label: 'Fully mapped', value: items.filter((item) => item.mappedPct === 100).length, tone: 'ok' },
        { label: 'Independent', value: items.filter((item) => !item.complexId).length, tone: 'warn' },
      ]} />
      <Toolbar>
        <input className="k-search" placeholder="Search floor, building, or complex" value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="Building" value={buildingFilter} onChange={setBuildingFilter}>
          <option>All</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectFilter>
        <SelectFilter label="Complex" value={complexFilter} onChange={setComplexFilter}>
          <option>All</option><option>Independent</option>
          {complexes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectFilter>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>
      <SplitView
        left={<Panel title="Floor directory">
          {shown.length ? <DataTable columns={['Complex', 'Building', 'Floor', 'Level', 'Mapped', '']} rows={shown.map((item) => [
            item.complexName ?? 'Independent',
            item.buildingName,
            item.label,
            item.level,
            <Progress key={item.id} value={item.mappedPct} />,
            <button type="button" key={`select-${item.id}`} className="k-link-btn" onClick={() => setSelectedId(item.id)}>Select</button>,
          ])} /> : <EmptyHint text="No floors match the current filters." />}
        </Panel>}
        right={<Panel title="Floor summary">
          {selected ? <div className="k-detail-list">
            <div><span>Floor</span><strong>{selected.label}</strong></div>
            <div><span>Building</span><strong>{selected.buildingName}</strong></div>
            <div><span>Complex</span><strong>{selected.complexName ?? 'Independent'}</strong></div>
            <div><span>Level</span><strong>{selected.level}</strong></div>
            <div><span>Locations</span><strong>{selected.locations}</strong></div>
            <div><span>Mapped</span><Progress value={selected.mappedPct} /></div>
            <ActionBar><button type="button" className="k-btn k-btn--primary" onClick={openEdit}>Edit</button></ActionBar>
          </div> : <EmptyHint text="Select a floor to view its summary." />}
        </Panel>}
      />
      {modal ? (
        <ModalForm title={modal === 'add' ? 'Add floor' : 'Edit floor'} submitLabel={modal === 'add' ? 'Create floor' : 'Save changes'} onClose={() => setModal(null)} onSubmit={save}>
          <FormGrid>
            <Field label="Building">
              <select required value={buildingId} onChange={(event) => setBuildingId(event.target.value)}>
                <option value="">Select</option>
                {buildings.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.complexName ?? 'Independent'}</option>)}
              </select>
            </Field>
            <Field label="Label"><input required autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="L01" /></Field>
            <Field label="Level"><input required type="number" value={level} onChange={(event) => setLevel(event.target.value)} /></Field>
            <Field label="Mapped % (optional)"><input min="0" max="100" type="number" value={mappedPct} onChange={(event) => setMappedPct(event.target.value)} /></Field>
          </FormGrid>
        </ModalForm>
      ) : null}
    </>
  )
}

export function LocationsPage() {
  const { data, upsert, logAudit } = useErpData()
  const buildings = data.buildings
  const floors = data.floors
  const { items, setItems, selectedId, setSelectedId } = useCollectionState(data.locations)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [buildingFilter, setBuildingFilter] = useState('All')
  const [floorFilter, setFloorFilter] = useState('All')
  const [mappedOnly, setMappedOnly] = useState(false)
  const [modal, setModal] = useState<'add' | 'edit' | null>(null)
  const [floorId, setFloorId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<LocationType>('Room')
  const [code, setCode] = useState('')
  const [mapped, setMapped] = useState(false)
  const [physicalAddress, setPhysicalAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [elevation, setElevation] = useState('')

  const selected = items.find((item) => item.id === selectedId) ?? null
  const availableFloors = buildingFilter === 'All' ? floors : floors.filter((item) => item.buildingId === buildingFilter)
  const shown = items.filter((item) =>
    (typeFilter === 'All' || item.type === typeFilter) &&
    (buildingFilter === 'All' || item.buildingId === buildingFilter) &&
    (floorFilter === 'All' || item.floorId === floorFilter) &&
    (!mappedOnly || item.mapped) &&
    `${item.name} ${item.code} ${item.buildingName} ${item.floorLabel} ${item.physicalAddress}`.toLowerCase().includes(query.toLowerCase()),
  )

  function openAdd() {
    setFloorId('')
    setName('')
    setType('Room')
    setCode('')
    setMapped(false)
    setPhysicalAddress('')
    setLatitude('')
    setLongitude('')
    setElevation('')
    setModal('add')
  }

  function openEdit() {
    if (!selected) return
    setFloorId(selected.floorId)
    setName(selected.name)
    setType(selected.type)
    setCode(selected.code)
    setMapped(selected.mapped)
    setPhysicalAddress(selected.physicalAddress)
    setLatitude(String(selected.latitude))
    setLongitude(String(selected.longitude))
    setElevation(String(selected.elevation))
    setModal('edit')
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const floor = floors.find((item) => item.id === floorId)
    if (!floor) return
    const lat = Number(latitude)
    const lng = Number(longitude)
    const elev = Number(elevation)
    if (!physicalAddress.trim()) return
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(elev)) return
    const values = {
      floorId: floor.id,
      floorLabel: floor.label,
      buildingId: floor.buildingId,
      buildingName: floor.buildingName,
      complexId: floor.complexId,
      complexName: floor.complexName,
      propertyId: floor.propertyId,
      name: name.trim(),
      type,
      code: code.trim(),
      mapped,
      physicalAddress: physicalAddress.trim(),
      latitude: lat,
      longitude: lng,
      elevation: elev,
    }
    if (modal === 'edit' && selected) {
      const next: Location = { ...selected, ...values }
      setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
      persist(async () => {
        await upsert('locations', next)
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'location.update',
          target: next.name,
        })
      })
    } else {
      const next: Location = { id: `loc-${Date.now()}`, ...values }
      setItems((list) => [next, ...list])
      setSelectedId(next.id)
      persist(async () => {
        await upsert('locations', next)
        await logAudit({
          actorUserId: null,
          actor: 'ERP Console',
          action: 'location.create',
          target: next.name,
        })
      })
    }
    setModal(null)
  }

  function toggleSelectedMapped() {
    if (!selected) return
    const next: Location = { ...selected, mapped: !selected.mapped }
    setItems((list) => list.map((item) => (item.id === next.id ? next : item)))
    persist(async () => {
      await upsert('locations', next)
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: next.mapped ? 'location.mapped' : 'location.unmapped',
        target: next.name,
      })
    })
  }

  function changeBuildingFilter(value: string) {
    setBuildingFilter(value)
    setFloorFilter('All')
  }

  return (
    <>
      <PageHeader title="Units / Locations" subtitle="Wayfinding destinations and navigable features." actions={<button type="button" className="k-btn k-btn--primary" onClick={openAdd}>Add location</button>} />
      <KeriosaImportPanel />
      <HelpNote label="Locations">
        Hierarchy: <b>Complex → Building → Floor → Unit / Location</b>.
        Every unit/location requires a <b>physical address</b> and a <b>coordinate address</b> (latitude, longitude, elevation in meters).
        Types: <b>{locationTypes.join(', ')}</b>.
      </HelpNote>
      <KpiRow items={[
        { label: 'Locations', value: items.length },
        { label: 'Mapped', value: items.filter((item) => item.mapped).length, tone: 'ok' },
        { label: 'Unmapped', value: items.filter((item) => !item.mapped).length, tone: 'warn' },
        { label: 'Types used', value: new Set(items.map((item) => item.type)).size, tone: 'info' },
      ]} />
      <Toolbar>
        <input className="k-search" placeholder="Search name, code, building, or floor" value={query} onChange={(event) => setQuery(event.target.value)} />
        <SelectFilter label="Type" value={typeFilter} onChange={setTypeFilter}>
          <option>All</option>{locationTypes.map((item) => <option key={item}>{item}</option>)}
        </SelectFilter>
        <SelectFilter label="Building" value={buildingFilter} onChange={changeBuildingFilter}>
          <option>All</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectFilter>
        <SelectFilter label="Floor" value={floorFilter} onChange={setFloorFilter}>
          <option>All</option>{availableFloors.map((item) => <option key={item.id} value={item.id}>{item.buildingName} · {item.label}</option>)}
        </SelectFilter>
        <label className="k-toggle"><input type="checkbox" checked={mappedOnly} onChange={(event) => setMappedOnly(event.target.checked)} />Mapped only</label>
        <span className="k-toolbar__meta">{shown.length} records</span>
      </Toolbar>
      <SplitView
        left={<Panel title="Location directory">
          {shown.length ? <DataTable columns={['Code', 'Name', 'Type', 'Coords', 'Mapped', '']} rows={shown.map((item) => [
            <code key={item.id}>{item.code || '—'}</code>,
            item.name,
            <Badge key={`type-${item.id}`} tone="info">{item.type}</Badge>,
            <span key={`c-${item.id}`}>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</span>,
            <Status key={`mapped-${item.id}`} value={item.mapped ? 'Mapped' : 'Draft'} />,
            <button type="button" key={`select-${item.id}`} className="k-link-btn" onClick={() => setSelectedId(item.id)}>Select</button>,
          ])} /> : <EmptyHint text="No locations match the current filters." />}
        </Panel>}
        right={<Panel title="Location summary">
          {selected ? <div className="k-detail-list">
            <div><span>Name</span><strong>{selected.name}</strong></div>
            <div><span>Code</span><code>{selected.code || '—'}</code></div>
            <div><span>Type</span><Badge tone="info">{selected.type}</Badge></div>
            <div><span>Building</span><strong>{selected.buildingName}</strong></div>
            <div><span>Floor</span><strong>{selected.floorLabel}</strong></div>
            <div><span>Complex</span><strong>{selected.complexName ?? 'Independent'}</strong></div>
            <div><span>Physical address</span><strong>{selected.physicalAddress}</strong></div>
            <div><span>Latitude</span><strong>{selected.latitude}</strong></div>
            <div><span>Longitude</span><strong>{selected.longitude}</strong></div>
            <div><span>Elevation (m)</span><strong>{selected.elevation}</strong></div>
            <div><span>Map state</span><Status value={selected.mapped ? 'Mapped' : 'Draft'} /></div>
            <ActionBar>
              <button type="button" className="k-btn k-btn--primary" onClick={openEdit}>Edit</button>
              <button type="button" className="k-btn k-btn--ghost" onClick={toggleSelectedMapped}>
                Mark {selected.mapped ? 'unmapped' : 'mapped'}
              </button>
            </ActionBar>
          </div> : <EmptyHint text="Select a location to view its summary." />}
        </Panel>}
      />
      {modal ? (
        <ModalForm title={modal === 'add' ? 'Add location' : 'Edit location'} submitLabel={modal === 'add' ? 'Create location' : 'Save changes'} onClose={() => setModal(null)} onSubmit={save}>
          <FormGrid>
            <Field label="Floor">
              <select required value={floorId} onChange={(event) => setFloorId(event.target.value)}>
                <option value="">Select</option>
                {floors.map((item) => <option key={item.id} value={item.id}>{item.buildingName} · {item.label}</option>)}
              </select>
            </Field>
            <Field label="Name"><input required autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="Type">
              <select value={type} onChange={(event) => setType(event.target.value as LocationType)}>
                {locationTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Code"><input value={code} onChange={(event) => setCode(event.target.value)} /></Field>
            <Field label="Physical address">
              <input
                required
                value={physicalAddress}
                onChange={(event) => setPhysicalAddress(event.target.value)}
                placeholder="Street, unit/suite, city"
              />
            </Field>
            <Field label="Latitude">
              <input required type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="e.g. 41.895400" />
            </Field>
            <Field label="Longitude">
              <input required type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="e.g. -87.624300" />
            </Field>
            <Field label="Elevation (m)">
              <input required type="number" step="any" value={elevation} onChange={(event) => setElevation(event.target.value)} placeholder="Meters above datum" />
            </Field>
            <Field label="Mapped">
              <label className="k-toggle"><input type="checkbox" checked={mapped} onChange={(event) => setMapped(event.target.checked)} />Ready for routing</label>
            </Field>
          </FormGrid>
        </ModalForm>
      ) : null}
    </>
  )
}
