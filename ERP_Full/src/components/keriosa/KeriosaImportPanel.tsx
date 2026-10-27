import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Building, Complex, Floor, KeriosaImport, LocationType, SiteProperty } from '../../data/schema'
import { useErpData } from '../../data/ErpDataProvider'
import { fetchAllKeriosaLocks } from '../../keriosa/keriosaClient'
import {
  applyKeriosaImport,
  buildKeriosaImport,
  KERIOSA_LOCATION_TYPES,
  matchHierarchy,
  type ConfirmKeriosaChoices,
} from '../../keriosa/keriosaMap'
import { ActionBar, Badge, DataTable, EmptyHint, Field, FormGrid, Panel, Toolbar } from '../../ui/primitives'

type MatchFilter = 'All' | 'Full match' | 'Partial match' | 'New hierarchy'
type ConfidenceFilter = 'All' | 'High' | 'Medium' | 'Low'
type DuplicateFilter = 'All' | 'Duplicates' | 'Unique'

function matchKind(row: KeriosaImport): Exclude<MatchFilter, 'All'> {
  if (row.matchComplexId && row.matchBuildingId && row.matchFloorId) return 'Full match'
  if (row.matchComplexId || row.matchBuildingId) return 'Partial match'
  return 'New hierarchy'
}

function MappingArrow() {
  return <span className="k-map-arrow" aria-hidden>→</span>
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function placeKey(row: KeriosaImport) {
  const parts = [
    normalizeKey(row.proposed.complexName || row.source.property),
    normalizeKey(row.proposed.buildingName || row.source.building),
    normalizeKey(row.proposed.floorLabel || row.source.floor),
    normalizeKey(row.proposed.unitName || row.source.house),
    normalizeKey(row.proposed.locationType || row.source.pointType),
  ]
  if (parts.every((part) => !part)) return ''
  return parts.join('|')
}

function coordKey(row: KeriosaImport) {
  const { latitude, longitude } = row.proposed
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return ''
  if (latitude === 0 && longitude === 0) return ''
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`
}

function parseConfidence(raw: string | undefined): { pct: number; label: string } | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const numeric = Number(text.replace(/%$/, ''))
  if (!Number.isFinite(numeric)) return null
  const pct = numeric <= 1 ? numeric * 100 : numeric
  const rounded = Math.round(pct * 10) / 10
  const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return { pct: rounded, label: `${shown}%` }
}

function ConfidenceScore({ value }: { value: string | undefined }) {
  const parsed = parseConfidence(value)
  if (!parsed) {
    const text = (value ?? '').trim()
    return text ? <Badge tone="neutral">{text}</Badge> : <span>—</span>
  }
  const tone = parsed.pct >= 80 ? 'ok' : parsed.pct >= 50 ? 'warn' : 'danger'
  return <Badge tone={tone}>{parsed.label}</Badge>
}

export function KeriosaImportPanel() {
  const { data, upsert, logAudit } = useErpData()
  const imports = data.keriosaImports
  const pending = useMemo(() => imports.filter((i) => i.status === 'Pending'), [imports])
  const confirmedRows = useMemo(
    () =>
      imports
        .filter((i) => i.status === 'Confirmed')
        .slice()
        .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '')),
    [imports],
  )
  const duplicates = useMemo(() => {
    const byPlace = new Map<string, string[]>()
    const byCoord = new Map<string, string[]>()
    for (const row of pending) {
      const place = placeKey(row)
      if (place) byPlace.set(place, [...(byPlace.get(place) ?? []), row.id])
      const coord = coordKey(row)
      if (coord) byCoord.set(coord, [...(byCoord.get(coord) ?? []), row.id])
    }
    const count = new Map<string, number>()
    for (const group of [...byPlace.values(), ...byCoord.values()]) {
      if (group.length < 2) continue
      for (const id of group) count.set(id, Math.max(count.get(id) ?? 0, group.length))
    }
    return count
  }, [pending])

  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('All')
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('All')
  const [duplicateFilter, setDuplicateFilter] = useState<DuplicateFilter>('All')
  const [propertyFilter, setPropertyFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const review = imports.find((i) => i.id === reviewId) ?? null
  const editingConfirmed = review?.status === 'Confirmed'

  const propertyOptions = useMemo(() => {
    const names = new Set(
      pending.map((row) => row.proposed.complexName || row.source.property).filter(Boolean),
    )
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [pending])

  const typeOptions = useMemo(() => {
    const types = new Set(pending.map((row) => row.proposed.locationType))
    return Array.from(types).sort()
  }, [pending])

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pending.filter((row) => {
      if (matchFilter !== 'All' && matchKind(row) !== matchFilter) return false
      if (propertyFilter !== 'All') {
        const name = row.proposed.complexName || row.source.property
        if (name !== propertyFilter) return false
      }
      if (typeFilter !== 'All' && row.proposed.locationType !== typeFilter) return false
      if (duplicateFilter === 'Duplicates' && !duplicates.has(row.id)) return false
      if (duplicateFilter === 'Unique' && duplicates.has(row.id)) return false
      if (confidenceFilter !== 'All') {
        const conf = parseConfidence(row.source.confidence)?.pct ?? -1
        if (confidenceFilter === 'High' && conf < 80) return false
        if (confidenceFilter === 'Medium' && (conf < 50 || conf >= 80)) return false
        if (confidenceFilter === 'Low' && conf >= 50) return false
      }
      if (!q) return true
      const hay = [
        row.lockedAt,
        row.deviceId,
        row.source.property,
        row.source.building,
        row.source.floor,
        row.source.house,
        row.source.pointType,
        row.proposed.complexName,
        row.proposed.buildingName,
        row.proposed.floorLabel,
        row.proposed.unitName,
        row.proposed.locationType,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [
    pending,
    query,
    matchFilter,
    confidenceFilter,
    duplicateFilter,
    propertyFilter,
    typeFilter,
    duplicates,
  ])

  const filteredIds = useMemo(() => filteredPending.map((row) => row.id), [filteredPending])
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const selectedPending = useMemo(
    () => pending.filter((row) => selectedIds.has(row.id)),
    [pending, selectedIds],
  )

  useEffect(() => {
    setSelectedIds((prev) => {
      const alive = new Set(pending.map((row) => row.id))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (alive.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [pending])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id)
      } else {
        for (const id of filteredIds) next.add(id)
      }
      return next
    })
  }

  const [complexChoice, setComplexChoice] = useState<string>('new')
  const [buildingChoice, setBuildingChoice] = useState<string>('new')
  const [floorChoice, setFloorChoice] = useState<string>('new')
  const [organizationId, setOrganizationId] = useState('')
  const [complexName, setComplexName] = useState('')
  const [buildingName, setBuildingName] = useState('')
  const [floorLabel, setFloorLabel] = useState('')
  const [unitName, setUnitName] = useState('')
  const [locationType, setLocationType] = useState<LocationType>('Unit')
  const [mapped, setMapped] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const syncLocks = useCallback(async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const locks = await fetchAllKeriosaLocks()
      const existing = new Map(data.keriosaImports.map((i) => [i.lockKey, i]))
      let added = 0
      for (const { lockKey, data: raw } of locks) {
        if (existing.has(lockKey)) continue
        const row = buildKeriosaImport(
          lockKey,
          raw,
          data.complexes,
          data.buildings,
          data.floors,
        )
        await upsert('keriosaImports', row)
        added += 1
      }
      setNotice(
        added
          ? `${added} new field lock(s) ready for review.`
          : locks.length
            ? 'No new locks — pending list is up to date.'
            : 'No locked records found in Keriosa.',
      )
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Could not reach Keriosa database.')
    } finally {
      setSyncing(false)
    }
  }, [data.buildings, data.complexes, data.floors, data.keriosaImports, upsert])

  const initialSync = useRef(false)
  useEffect(() => {
    if (initialSync.current) return
    initialSync.current = true
    void syncLocks()
  }, [syncLocks])

  function openReview(row: KeriosaImport) {
    setReviewId(row.id)
    setComplexChoice(row.matchComplexId ?? 'new')
    setBuildingChoice(row.matchBuildingId ?? 'new')
    setFloorChoice(row.matchFloorId ?? 'new')
    setOrganizationId(data.organizations.find((o) => o.status === 'Active')?.id ?? data.organizations[0]?.id ?? '')
    setComplexName(row.proposed.complexName)
    setBuildingName(row.proposed.buildingName)
    setFloorLabel(row.proposed.floorLabel)
    setUnitName(row.proposed.unitName)
    setLocationType(row.proposed.locationType)
    const linked = row.resolvedLocationId
      ? data.locations.find((l) => l.id === row.resolvedLocationId)
      : null
    setMapped(linked?.mapped ?? false)
    setConfirmed(false)
  }

  function withRenamedProposed(row: KeriosaImport): KeriosaImport {
    return {
      ...row,
      proposed: {
        ...row.proposed,
        complexName: complexName.trim() || row.proposed.complexName,
        buildingName: buildingName.trim() || row.proposed.buildingName,
        floorLabel: floorLabel.trim() || row.proposed.floorLabel,
        unitName: unitName.trim() || row.proposed.unitName,
        locationType,
      },
      matchComplexId: complexChoice === 'new' ? null : complexChoice,
      matchBuildingId: buildingChoice === 'new' ? null : buildingChoice,
      matchFloorId: floorChoice === 'new' ? null : floorChoice,
    }
  }

  async function saveMappingDraft() {
    if (!review || review.status !== 'Pending') return
    const updated = withRenamedProposed(review)
    await upsert('keriosaImports', updated)
    await logAudit({
      actorUserId: null,
      actor: 'ERP Console',
      action: 'keriosa.import.mapping_saved',
      target: updated.proposed.unitName,
    })
    setNotice('Mapping saved — you can confirm import when ready.')
    setReviewId(null)
  }

  async function saveConfirmedMapping(event: FormEvent) {
    event.preventDefault()
    if (!review || review.status !== 'Confirmed' || !review.resolvedLocationId) return
    const location = data.locations.find((l) => l.id === review.resolvedLocationId)
    if (!location) {
      setNotice('Linked location was removed — open Units to recreate it.')
      return
    }

    const building = data.buildings.find((b) => b.id === buildingChoice)
    const floor = data.floors.find((f) => f.id === floorChoice)
    const complex = building
      ? data.complexes.find((c) => c.id === (building.complexId ?? complexChoice))
      : data.complexes.find((c) => c.id === complexChoice)
    if (!building || !floor) {
      setNotice('Select an existing complex, building, and floor to rematch.')
      return
    }

    const renamedUnit = unitName.trim() || location.name
    const nextLocation = {
      ...location,
      name: renamedUnit,
      type: locationType,
      mapped,
      floorId: floor.id,
      floorLabel: floor.label,
      buildingId: building.id,
      buildingName: building.name,
      complexId: floor.complexId,
      complexName: floor.complexName,
      propertyId: floor.propertyId,
    }

    if (complex && complexChoice !== 'new' && complexName.trim() && complexName.trim() !== complex.name) {
      await upsert('complexes', { ...complex, name: complexName.trim() })
      const siteProp = data.siteProperties.find((p) => p.complexId === complex.id || p.id === complex.id)
      if (siteProp) await upsert('siteProperties', { ...siteProp, name: complexName.trim() })
    }
    if (buildingChoice !== 'new' && buildingName.trim() && buildingName.trim() !== building.name) {
      await upsert('buildings', { ...building, name: buildingName.trim() })
    }
    if (floorChoice !== 'new' && floorLabel.trim() && floorLabel.trim() !== floor.label) {
      await upsert('floors', { ...floor, label: floorLabel.trim() })
      nextLocation.floorLabel = floorLabel.trim()
    }

    const updatedImport = withRenamedProposed({
      ...review,
      matchComplexId: building.complexId,
      matchBuildingId: building.id,
      matchFloorId: floor.id,
      reviewedAt: new Date().toISOString(),
    })

    await upsert('locations', nextLocation)
    await upsert('keriosaImports', updatedImport)
    await logAudit({
      actorUserId: null,
      actor: 'ERP Console',
      action: 'keriosa.import.mapping_updated',
      target: nextLocation.name,
    })
    setReviewId(null)
    setNotice(`Mapping updated for “${nextLocation.name}”.`)
  }

  const buildingsForComplex = useMemo(() => {
    if (complexChoice === 'new') return data.buildings
    return data.buildings.filter((b) => b.complexId === complexChoice)
  }, [complexChoice, data.buildings])

  const floorsForBuilding = useMemo(() => {
    if (buildingChoice === 'new') return data.floors
    return data.floors.filter((f) => f.buildingId === buildingChoice)
  }, [buildingChoice, data.floors])

  async function rejectImport(row: KeriosaImport) {
    const updated: KeriosaImport = {
      ...row,
      status: 'Rejected',
      reviewedAt: new Date().toISOString(),
    }
    await upsert('keriosaImports', updated)
    await logAudit({
      actorUserId: null,
      actor: 'ERP Console',
      action: 'keriosa.import.reject',
      target: row.proposed.unitName,
    })
    setNotice('Import dismissed.')
    if (reviewId === row.id) setReviewId(null)
  }

  async function bulkReject(rows: KeriosaImport[]) {
    if (!rows.length || bulkBusy) return
    const ok = window.confirm(`Reject ${rows.length} selected field lock(s)?`)
    if (!ok) return
    setBulkBusy(true)
    try {
      const now = new Date().toISOString()
      for (const row of rows) {
        await upsert('keriosaImports', { ...row, status: 'Rejected', reviewedAt: now })
      }
      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'keriosa.import.bulk_reject',
        target: `${rows.length} locks`,
      })
      setSelectedIds(new Set())
      setNotice(`Rejected ${rows.length} field lock(s).`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk reject failed.')
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkAccept(rows: KeriosaImport[]) {
    if (!rows.length || bulkBusy) return
    const ok = window.confirm(
      `Accept ${rows.length} selected lock(s) using auto-matched / proposed hierarchy? New ERP records will be created where needed.`,
    )
    if (!ok) return
    setBulkBusy(true)
    try {
      const organizationId =
        data.organizations.find((o) => o.status === 'Active')?.id ?? data.organizations[0]?.id ?? ''
      if (!organizationId) {
        setNotice('No organization available for import.')
        return
      }

      let complexes: Complex[] = [...data.complexes]
      let buildings: Building[] = [...data.buildings]
      let floors: Floor[] = [...data.floors]
      let siteProperties: SiteProperty[] = [...data.siteProperties]
      let accepted = 0
      let failed = 0

      for (const row of rows) {
        try {
          const rematch = matchHierarchy(complexes, buildings, floors, row.proposed)
          const choices: ConfirmKeriosaChoices = {
            complexId: rematch.matchComplexId ?? 'new',
            buildingId: rematch.matchBuildingId ?? 'new',
            floorId: rematch.matchFloorId ?? 'new',
            organizationId,
            locationType: row.proposed.locationType,
            unitName: row.proposed.unitName,
            mapped: true,
            importRow: {
              ...row,
              matchComplexId: rematch.matchComplexId,
              matchBuildingId: rematch.matchBuildingId,
              matchFloorId: rematch.matchFloorId,
            },
          }
          const result = applyKeriosaImport(
            {
              organizations: data.organizations,
              complexes,
              buildings,
              floors,
              siteProperties,
            },
            choices,
          )

          if (choices.complexId === 'new') {
            complexes = [...complexes, result.complex]
            if (result.siteProperty) {
              siteProperties = [...siteProperties, result.siteProperty as SiteProperty]
              await upsert('siteProperties', result.siteProperty)
            }
            await upsert('complexes', result.complex)
          }
          if (choices.buildingId === 'new') {
            buildings = [...buildings, result.building]
            await upsert('buildings', result.building)
          }
          if (choices.floorId === 'new') {
            floors = [...floors, result.floor]
            await upsert('floors', result.floor)
          }
          await upsert('locations', result.location)
          await upsert('keriosaImports', result.updatedImport)
          accepted += 1
        } catch {
          failed += 1
        }
      }

      await logAudit({
        actorUserId: null,
        actor: 'ERP Console',
        action: 'keriosa.import.bulk_accept',
        target: `${accepted} accepted${failed ? `, ${failed} failed` : ''}`,
      })
      setSelectedIds(new Set())
      setNotice(
        failed
          ? `Accepted ${accepted} lock(s); ${failed} failed.`
          : `Accepted ${accepted} field lock(s).`,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk accept failed.')
    } finally {
      setBulkBusy(false)
    }
  }

  async function confirmReview(event: FormEvent) {
    event.preventDefault()
    if (!review) return
    if (editingConfirmed) {
      await saveConfirmedMapping(event)
      return
    }
    if (!confirmed) return
    const importRow = withRenamedProposed(review)
    const choices: ConfirmKeriosaChoices = {
      complexId: complexChoice as string | 'new',
      buildingId: buildingChoice as string | 'new',
      floorId: floorChoice as string | 'new',
      organizationId,
      locationType,
      unitName,
      mapped,
      importRow,
    }
    const result = applyKeriosaImport(
      {
        organizations: data.organizations,
        complexes: data.complexes,
        buildings: data.buildings,
        floors: data.floors,
        siteProperties: data.siteProperties,
      },
      choices,
    )

    if (choices.complexId === 'new') {
      await upsert('complexes', result.complex)
      if (result.siteProperty) await upsert('siteProperties', result.siteProperty)
    }
    if (choices.buildingId === 'new') {
      await upsert('buildings', result.building)
    }
    if (choices.floorId === 'new') {
      await upsert('floors', result.floor)
    }
    await upsert('locations', result.location)
    await upsert('keriosaImports', result.updatedImport)
    await logAudit({
      actorUserId: null,
      actor: 'ERP Console',
      action: 'keriosa.import.confirm',
      target: result.location.name,
    })
    setReviewId(null)
    setNotice(`Location “${result.location.name}” created from field lock.`)
  }

  return (
    <>
      <Panel title="Field locks from Keriosa">
        <p className="k-panel__lede">
          Locked GPS points in Keriosa appear here for review before they become ERP locations.
          Mapping: <strong>property → complex</strong>, <strong>building → building</strong>,{' '}
          <strong>floor → floor</strong>, <strong>house → unit</strong> (type from{' '}
          <code>point_type</code>). Duplicate locks are highlighted.
        </p>
        {syncError ? <p className="k-inline-notice k-inline-notice--danger">{syncError}</p> : null}
        {notice ? <p className="k-inline-notice">{notice}</p> : null}
        <div className="k-action-bar k-action-bar--tight">
          <button type="button" className="k-btn k-btn--ghost" disabled={syncing || bulkBusy} onClick={() => void syncLocks()}>
            {syncing ? 'Checking Keriosa…' : 'Refresh field locks'}
          </button>
          <Badge tone={pending.length ? 'warn' : 'ok'}>
            {pending.length ? `${pending.length} awaiting confirmation` : 'No pending locks'}
          </Badge>
          {filteredPending.length !== pending.length ? (
            <Badge tone="info">{filteredPending.length} match filters</Badge>
          ) : null}
          {selectedIds.size ? <Badge tone="info">{selectedIds.size} selected</Badge> : null}
        </div>
        {pending.length ? (
          <>
            <Toolbar>
              <input
                className="k-search"
                placeholder="Search property, building, unit, device…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="k-compact-field">
                <span>Property</span>
                <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
                  <option>All</option>
                  {propertyOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="k-compact-field">
                <span>Match</span>
                <select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value as MatchFilter)}>
                  <option>All</option>
                  <option>Full match</option>
                  <option>Partial match</option>
                  <option>New hierarchy</option>
                </select>
              </label>
              <label className="k-compact-field">
                <span>Confidence</span>
                <select
                  value={confidenceFilter}
                  onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
                >
                  <option>All</option>
                  <option value="High">High (≥80%)</option>
                  <option value="Medium">Medium (50–79%)</option>
                  <option value="Low">Low (&lt;50%)</option>
                </select>
              </label>
              <label className="k-compact-field">
                <span>Duplicates</span>
                <select
                  value={duplicateFilter}
                  onChange={(e) => setDuplicateFilter(e.target.value as DuplicateFilter)}
                >
                  <option>All</option>
                  <option>Duplicates</option>
                  <option>Unique</option>
                </select>
              </label>
              <label className="k-compact-field">
                <span>Type</span>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option>All</option>
                  {typeOptions.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <span className="k-toolbar__meta">
                {filteredPending.length} of {pending.length}
              </span>
            </Toolbar>
            <ActionBar>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                disabled={!filteredIds.length || bulkBusy}
                onClick={toggleSelectFiltered}
              >
                {allFilteredSelected ? 'Clear filtered' : 'Select filtered'}
              </button>
              <button
                type="button"
                className="k-btn k-btn--primary"
                disabled={!selectedPending.length || bulkBusy}
                onClick={() => void bulkAccept(selectedPending)}
              >
                {bulkBusy ? 'Working…' : `Bulk accept (${selectedPending.length})`}
              </button>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                disabled={!selectedPending.length || bulkBusy}
                onClick={() => void bulkReject(selectedPending)}
              >
                Bulk reject ({selectedPending.length})
              </button>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                disabled={!filteredPending.length || bulkBusy}
                onClick={() => void bulkAccept(filteredPending)}
              >
                Accept all filtered
              </button>
              <button
                type="button"
                className="k-btn k-btn--ghost"
                disabled={!filteredPending.length || bulkBusy}
                onClick={() => void bulkReject(filteredPending)}
              >
                Reject all filtered
              </button>
            </ActionBar>
            {filteredPending.length ? (
              <DataTable
                columns={[
                  <input
                    key="sel-all"
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectFiltered}
                    aria-label="Select all filtered"
                  />,
                  'Locked at',
                  'Keriosa → ERP',
                  'Device',
                  'Confidence',
                  'Match',
                  '',
                ]}
                rowClassNames={filteredPending.map((row) =>
                  [
                    duplicates.has(row.id) ? 'k-row-duplicate' : '',
                    selectedIds.has(row.id) ? 'k-row-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' '),
                )}
                rows={filteredPending.map((row) => [
                  <input
                    key={`cb-${row.id}`}
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Select ${row.proposed.unitName}`}
                  />,
                  row.lockedAt,
                  <span key={`map-${row.id}`} className="k-keriosa-map-cell">
                    <span>{row.source.property || '—'}</span>
                    <MappingArrow />
                    <strong>{row.proposed.complexName}</strong>
                    <br />
                    <span>{row.source.building}</span>
                    <MappingArrow />
                    <strong>{row.proposed.buildingName}</strong>
                    <br />
                    <span>Floor {row.source.floor}</span>
                    <MappingArrow />
                    <strong>{row.proposed.floorLabel}</strong>
                    <br />
                    <span>{row.source.house || row.source.pointType}</span>
                    <MappingArrow />
                    <strong>
                      {row.proposed.unitName}{' '}
                      <Badge tone="info">{row.proposed.locationType}</Badge>
                    </strong>
                  </span>,
                  <code key={`dev-${row.id}`}>{row.deviceId || '—'}</code>,
                  <ConfidenceScore key={`conf-${row.id}`} value={row.source.confidence} />,
                  <span key={`m-${row.id}`} className="k-inline-actions">
                    {matchKind(row) === 'Full match' ? (
                      <Badge tone="ok">Full match</Badge>
                    ) : matchKind(row) === 'Partial match' ? (
                      <Badge tone="warn">Partial match</Badge>
                    ) : (
                      <Badge tone="neutral">New hierarchy</Badge>
                    )}
                    {duplicates.has(row.id) ? (
                      <Badge tone="warn">Duplicate · {duplicates.get(row.id)}</Badge>
                    ) : null}
                  </span>,
                  <span key={`act-${row.id}`} className="k-inline-actions">
                    <button
                      type="button"
                      className="k-btn k-btn--primary k-btn--sm"
                      disabled={bulkBusy}
                      onClick={() => openReview(row)}
                    >
                      Review & confirm
                    </button>
                    <button
                      type="button"
                      className="k-btn k-btn--ghost k-btn--sm"
                      disabled={bulkBusy}
                      onClick={() => void rejectImport(row)}
                    >
                      Dismiss
                    </button>
                  </span>,
                ])}
              />
            ) : (
              <EmptyHint text="No pending locks match the current filters." />
            )}
          </>
        ) : (
          <EmptyHint text="When a location is locked in Keriosa, it will show up here for confirmation." />
        )}
      </Panel>

      {confirmedRows.length ? (
        <Panel title="Confirmed mappings">
          <p className="k-panel__lede">
            Rename ERP names or rematch Complex → Building → Floor → Unit after import.
          </p>
          <DataTable
            columns={['Confirmed', 'Keriosa → ERP', 'Location', '']}
            rows={confirmedRows.slice(0, 25).map((row) => [
              row.reviewedAt ? new Date(row.reviewedAt).toLocaleString() : '—',
              <span key={`cmap-${row.id}`} className="k-keriosa-map-cell">
                <span>{row.source.property || '—'}</span>
                <MappingArrow />
                <strong>{row.proposed.complexName}</strong>
                <br />
                <span>{row.source.building}</span>
                <MappingArrow />
                <strong>{row.proposed.buildingName}</strong>
                <br />
                <span>Floor {row.source.floor}</span>
                <MappingArrow />
                <strong>{row.proposed.floorLabel}</strong>
                <br />
                <span>{row.source.house || row.source.pointType}</span>
                <MappingArrow />
                <strong>
                  {row.proposed.unitName} <Badge tone="info">{row.proposed.locationType}</Badge>
                </strong>
              </span>,
              <code key={`loc-${row.id}`}>{row.resolvedLocationId || '—'}</code>,
              <button
                key={`edit-${row.id}`}
                type="button"
                className="k-btn k-btn--ghost k-btn--sm"
                onClick={() => openReview(row)}
              >
                Edit mapping
              </button>,
            ])}
          />
        </Panel>
      ) : null}

      {review ? (
        <div
          className="k-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={editingConfirmed ? 'Edit mapping' : 'Confirm field lock'}
        >
          <form className="k-modal k-modal--wide" onSubmit={(e) => void confirmReview(e)}>
            <div className="k-modal__head">
              <h2>{editingConfirmed ? 'Edit mapping' : 'Confirm field lock → ERP location'}</h2>
              <button type="button" className="k-modal__close" onClick={() => setReviewId(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
              {duplicates.has(review.id) ? (
                <p className="k-inline-notice">
                  Duplicate · {duplicates.get(review.id)} pending locks share this place or these coordinates.
                </p>
              ) : null}
              <div className="k-keriosa-review-grid">
                <div>
                  <h3>Keriosa (source)</h3>
                  <dl className="k-dl-compact">
                    <dt>Property</dt>
                    <dd>{review.source.property || '—'}</dd>
                    <dt>Building</dt>
                    <dd>{review.source.building || '—'}</dd>
                    <dt>Floor</dt>
                    <dd>{review.source.floor || '—'}</dd>
                    <dt>House / point</dt>
                    <dd>{review.source.house || '—'}</dd>
                    <dt>Point type</dt>
                    <dd>{review.source.pointType || '—'}</dd>
                    <dt>Confidence</dt>
                    <dd>
                      <ConfidenceScore value={review.source.confidence} />
                    </dd>
                    <dt>Coordinates</dt>
                    <dd>
                      {review.proposed.latitude}, {review.proposed.longitude} · {review.proposed.elevation} m
                    </dd>
                  </dl>
                </div>
                <div>
                  <h3>ERP (target)</h3>
                  <FormGrid>
                    {!editingConfirmed ? (
                      <Field label="Organization (new complex)">
                        <select
                          value={organizationId}
                          onChange={(e) => setOrganizationId(e.target.value)}
                          disabled={complexChoice !== 'new'}
                        >
                          {data.organizations.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    ) : null}
                    <Field label="Complex">
                      <select
                        value={complexChoice}
                        onChange={(e) => {
                          const next = e.target.value
                          setComplexChoice(next)
                          if (editingConfirmed) {
                            const firstBuilding = data.buildings.find((b) => b.complexId === next)
                            setBuildingChoice(firstBuilding?.id ?? '')
                            const firstFloor = firstBuilding
                              ? data.floors.find((f) => f.buildingId === firstBuilding.id)
                              : undefined
                            setFloorChoice(firstFloor?.id ?? '')
                            if (firstBuilding) setBuildingName(firstBuilding.name)
                            if (firstFloor) setFloorLabel(firstFloor.label)
                            const cpx = data.complexes.find((c) => c.id === next)
                            if (cpx) setComplexName(cpx.name)
                          } else {
                            setBuildingChoice('new')
                            setFloorChoice('new')
                          }
                        }}
                      >
                        {!editingConfirmed ? (
                          <option value="new">+ Create “{complexName || review.proposed.complexName}”</option>
                        ) : null}
                        {data.complexes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={complexChoice === 'new' ? 'New complex name' : 'Rename complex'}>
                      <input
                        required={complexChoice === 'new'}
                        value={complexName}
                        onChange={(e) => setComplexName(e.target.value)}
                        placeholder="ERP complex name"
                      />
                    </Field>
                    <Field label="Building">
                      <select
                        value={buildingChoice}
                        onChange={(e) => {
                          const next = e.target.value
                          setBuildingChoice(next)
                          if (editingConfirmed) {
                            const firstFloor = data.floors.find((f) => f.buildingId === next)
                            setFloorChoice(firstFloor?.id ?? '')
                            const bld = data.buildings.find((b) => b.id === next)
                            if (bld) setBuildingName(bld.name)
                            if (firstFloor) setFloorLabel(firstFloor.label)
                          } else {
                            setFloorChoice('new')
                          }
                        }}
                      >
                        {!editingConfirmed ? (
                          <option value="new">+ Create “{buildingName || review.proposed.buildingName}”</option>
                        ) : null}
                        {buildingsForComplex.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={buildingChoice === 'new' ? 'New building name' : 'Rename building'}>
                      <input
                        required={buildingChoice === 'new'}
                        value={buildingName}
                        onChange={(e) => setBuildingName(e.target.value)}
                        placeholder="ERP building name"
                      />
                    </Field>
                    <Field label="Floor">
                      <select
                        value={floorChoice}
                        onChange={(e) => {
                          const next = e.target.value
                          setFloorChoice(next)
                          const fl = data.floors.find((f) => f.id === next)
                          if (fl) setFloorLabel(fl.label)
                        }}
                      >
                        {!editingConfirmed ? (
                          <option value="new">+ Create “{floorLabel || review.proposed.floorLabel}”</option>
                        ) : null}
                        {floorsForBuilding.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.buildingName} · {f.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={floorChoice === 'new' ? 'New floor label' : 'Rename floor'}>
                      <input
                        required={floorChoice === 'new'}
                        value={floorLabel}
                        onChange={(e) => setFloorLabel(e.target.value)}
                        placeholder="ERP floor label"
                      />
                    </Field>
                    <Field label="Unit / location name">
                      <input required value={unitName} onChange={(e) => setUnitName(e.target.value)} />
                    </Field>
                    <Field label="Location type">
                      <select
                        value={locationType}
                        onChange={(e) => setLocationType(e.target.value as LocationType)}
                      >
                        {KERIOSA_LOCATION_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                      <small className="k-field-hint">
                        Suggested from Keriosa point_type “{review.source.pointType || '—'}”.
                      </small>
                    </Field>
                    <Field label="Physical address">
                      <input readOnly value={review.proposed.physicalAddress} />
                    </Field>
                    <Field label="Ready for routing">
                      <label className="k-toggle">
                        <input type="checkbox" checked={mapped} onChange={(e) => setMapped(e.target.checked)} />
                        {editingConfirmed ? 'Mapped for routing' : 'Mark mapped after import'}
                      </label>
                    </Field>
                  </FormGrid>
                </div>
              </div>
              {!editingConfirmed ? (
                <label className="k-confirm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I reviewed this mapping and approve creating the ERP location.
                </label>
              ) : (
                <p className="k-field-hint">
                  Changes update the linked ERP location and rename matched hierarchy records when you edit the name fields.
                </p>
              )}
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setReviewId(null)}>
                Cancel
              </button>
              {!editingConfirmed ? (
                <button type="button" className="k-btn k-btn--ghost" onClick={() => void saveMappingDraft()}>
                  Save mapping
                </button>
              ) : null}
              <button
                type="submit"
                className="k-btn k-btn--primary"
                disabled={!editingConfirmed && !confirmed}
              >
                {editingConfirmed ? 'Save changes' : 'Confirm import'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
