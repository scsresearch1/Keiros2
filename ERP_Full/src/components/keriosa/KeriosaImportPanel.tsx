import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { KeriosaImport, LocationType } from '../../data/schema'
import { useErpData } from '../../data/ErpDataProvider'
import { fetchAllKeriosaLocks } from '../../keriosa/keriosaClient'
import {
  applyKeriosaImport,
  buildKeriosaImport,
  KERIOSA_LOCATION_TYPES,
  type ConfirmKeriosaChoices,
} from '../../keriosa/keriosaMap'
import { Badge, DataTable, EmptyHint, Field, FormGrid, Panel } from '../../ui/primitives'

function MappingArrow() {
  return <span className="k-map-arrow" aria-hidden>→</span>
}

export function KeriosaImportPanel() {
  const { data, upsert, logAudit } = useErpData()
  const imports = data.keriosaImports
  const pending = useMemo(() => imports.filter((i) => i.status === 'Pending'), [imports])

  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [reviewId, setReviewId] = useState<string | null>(null)

  const review = pending.find((i) => i.id === reviewId) ?? null

  const [complexChoice, setComplexChoice] = useState<string>('new')
  const [buildingChoice, setBuildingChoice] = useState<string>('new')
  const [floorChoice, setFloorChoice] = useState<string>('new')
  const [organizationId, setOrganizationId] = useState('')
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
    setUnitName(row.proposed.unitName)
    setLocationType(row.proposed.locationType)
    setMapped(false)
    setConfirmed(false)
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

  async function confirmReview(event: FormEvent) {
    event.preventDefault()
    if (!review || !confirmed) return
    const choices: ConfirmKeriosaChoices = {
      complexId: complexChoice as string | 'new',
      buildingId: buildingChoice as string | 'new',
      floorId: floorChoice as string | 'new',
      organizationId,
      locationType,
      unitName,
      mapped,
      importRow: review,
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
          <code>point_type</code>).
        </p>
        {syncError ? <p className="k-inline-notice k-inline-notice--danger">{syncError}</p> : null}
        {notice ? <p className="k-inline-notice">{notice}</p> : null}
        <div className="k-action-bar k-action-bar--tight">
          <button type="button" className="k-btn k-btn--ghost" disabled={syncing} onClick={() => void syncLocks()}>
            {syncing ? 'Checking Keriosa…' : 'Refresh field locks'}
          </button>
          <Badge tone={pending.length ? 'warn' : 'ok'}>
            {pending.length ? `${pending.length} awaiting confirmation` : 'No pending locks'}
          </Badge>
        </div>
        {pending.length ? (
          <DataTable
            columns={['Locked at', 'Keriosa → ERP', 'Device', 'Match', '']}
            rows={pending.map((row) => [
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
              row.matchComplexId && row.matchBuildingId && row.matchFloorId ? (
                <Badge key={`m-${row.id}`} tone="ok">
                  Full match
                </Badge>
              ) : row.matchComplexId || row.matchBuildingId ? (
                <Badge key={`p-${row.id}`} tone="warn">
                  Partial match
                </Badge>
              ) : (
                <Badge key={`n-${row.id}`} tone="neutral">
                  New hierarchy
                </Badge>
              ),
              <span key={`act-${row.id}`} className="k-inline-actions">
                <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => openReview(row)}>
                  Review & confirm
                </button>
                <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => void rejectImport(row)}>
                  Dismiss
                </button>
              </span>,
            ])}
          />
        ) : (
          <EmptyHint text="When a location is locked in Keriosa, it will show up here for confirmation." />
        )}
      </Panel>

      {review ? (
        <div className="k-modal-backdrop" role="presentation">
          <form className="k-modal k-modal--wide" onSubmit={(e) => void confirmReview(e)}>
            <div className="k-modal__head">
              <h2>Confirm field lock → ERP location</h2>
              <button type="button" className="k-modal__close" onClick={() => setReviewId(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="k-modal__body">
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
                    <dt>Coordinates</dt>
                    <dd>
                      {review.proposed.latitude}, {review.proposed.longitude} · {review.proposed.elevation} m
                    </dd>
                  </dl>
                </div>
                <div>
                  <h3>ERP (target)</h3>
                  <FormGrid>
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
                    <Field label="Complex">
                      <select value={complexChoice} onChange={(e) => setComplexChoice(e.target.value)}>
                        <option value="new">+ Create “{review.proposed.complexName}”</option>
                        {data.complexes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Building">
                      <select value={buildingChoice} onChange={(e) => setBuildingChoice(e.target.value)}>
                        <option value="new">+ Create “{review.proposed.buildingName}”</option>
                        {buildingsForComplex.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Floor">
                      <select value={floorChoice} onChange={(e) => setFloorChoice(e.target.value)}>
                        <option value="new">+ Create “{review.proposed.floorLabel}”</option>
                        {floorsForBuilding.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.buildingName} · {f.label}
                          </option>
                        ))}
                      </select>
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
                        Mark mapped after import
                      </label>
                    </Field>
                  </FormGrid>
                </div>
              </div>
              <label className="k-confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I
                reviewed this mapping and approve creating the ERP location.
              </label>
            </div>
            <div className="k-modal__actions">
              <button type="button" className="k-btn k-btn--ghost" onClick={() => setReviewId(null)}>
                Cancel
              </button>
              <button type="submit" className="k-btn k-btn--primary" disabled={!confirmed}>
                Confirm import
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
