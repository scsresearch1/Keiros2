import { useMemo, useState, type ReactNode } from 'react'
import type { Location } from '../data/erpData'
import { useErpData } from '../data/ErpDataProvider'
import { routePath } from '../maps/geo'
import { BuildingBlueprint3D, CampusBlueprint3D } from '../maps/BuildingBlueprint3D'
import { WayfindingMap, type MapLevel, type ViewMode } from '../maps/WayfindingMap'
import {
  Badge,
  Field,
  FormGrid,
  KpiRow,
  PageHeader,
  Panel,
  SplitView,
  Toolbar,
} from '../ui/primitives'
import './WayfindingPage.css'
import './pages.css'

function HelpNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="k-help-note" aria-label={`${title} help`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  )
}

function locationLabel(loc: Location) {
  const campus = loc.complexName ?? 'Independent'
  return `${loc.name} · ${loc.buildingName} · ${loc.floorLabel} · ${campus}`
}

export function WayfindingPage() {
  const { data } = useErpData()
  const { buildings, complexes, floors, locations, routes } = data
  const [complexId, setComplexId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [level, setLevel] = useState<MapLevel>('complex')
  const [mode, setMode] = useState<ViewMode>('2D')
  const [darkBasemap, setDarkBasemap] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showRoute, setShowRoute] = useState(true)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')

  const complexBuildings = useMemo(
    () => (complexId ? buildings.filter((b) => b.complexId === complexId) : []),
    [buildings, complexId],
  )

  const buildingFloors = useMemo(
    () => (buildingId ? floors.filter((f) => f.buildingId === buildingId) : []),
    [floors, buildingId],
  )

  const floorUnits = useMemo(
    () => (floorId ? locations.filter((l) => l.floorId === floorId) : []),
    [locations, floorId],
  )

  const from = locations.find((l) => l.id === fromId) ?? null
  const to = locations.find((l) => l.id === toId) ?? null
  const path = useMemo(() => (from && to ? routePath(from, to, locations) : []), [from, to, locations])

  const breadcrumb = useMemo(() => {
    const parts: { label: string; onClick?: () => void }[] = [
      {
        label: 'Campus',
        onClick: () => {
          setLevel('complex')
          setBuildingId('')
          setFloorId('')
          setUnitId('')
        },
      },
    ]
    const complex = complexes.find((c) => c.id === complexId)
    if (complex) parts.push({ label: complex.name, onClick: () => setLevel('complex') })
    if (level !== 'complex' && buildingId) {
      const building = buildings.find((b) => b.id === buildingId)
      if (building)
        parts.push({
          label: building.name,
          onClick: () => {
            setLevel('building')
            setFloorId('')
            setUnitId('')
          },
        })
    }
    if ((level === 'floor' || level === 'unit') && floorId) {
      const floor = floors.find((f) => f.id === floorId)
      if (floor)
        parts.push({
          label: floor.label,
          onClick: () => {
            setLevel('floor')
            setUnitId('')
          },
        })
    }
    if (level === 'unit' && unitId) {
      const unit = locations.find((l) => l.id === unitId)
      if (unit) parts.push({ label: unit.name })
    }
    return parts
  }, [buildings, complexes, floors, locations, complexId, level, buildingId, floorId, unitId])

  const relatedRoutes = routes.filter((r) => {
    const complex = complexes.find((c) => c.id === complexId)
    return complex ? r.propertyName === complex.name : false
  })

  function drillBuilding(id: string) {
    setBuildingId(id)
    setFloorId('')
    setUnitId('')
    setLevel('building')
  }

  function drillFloor(id: string) {
    setFloorId(id)
    setUnitId('')
    setLevel('floor')
    const floor = floors.find((f) => f.id === id)
    if (floor) setBuildingId(floor.buildingId)
  }

  function drillUnit(id: string) {
    const loc = locations.find((l) => l.id === id)
    if (!loc) return
    setUnitId(id)
    setFloorId(loc.floorId)
    setBuildingId(loc.buildingId)
    if (loc.complexId) setComplexId(loc.complexId)
    setLevel('unit')
    setToId(id)
  }

  function goToLevel(next: MapLevel) {
    setLevel(next)
    if (next === 'complex') {
      setBuildingId('')
      setFloorId('')
      setUnitId('')
    } else if (next === 'building') {
      setFloorId('')
      setUnitId('')
    } else if (next === 'floor') {
      setUnitId('')
    }
  }

  const mappedOnView = locations.filter((l) => {
    if (!complexId) return false
    if (level === 'unit' && unitId) return l.floorId === floorId
    if (level === 'floor') return l.floorId === floorId
    if (level === 'building') return l.buildingId === buildingId
    return l.complexId === complexId
  }).length

  return (
    <>
      <PageHeader
        title="Wayfinding Map"
        subtitle="Coordinate maps over free OpenStreetMap — complex → building → floor → unit."
        actions={
          <div className="k-segment">
            <button type="button" className={mode === '2D' ? 'is-active' : ''} onClick={() => setMode('2D')}>
              2D
            </button>
            <button type="button" className={mode === '3D' ? 'is-active' : ''} onClick={() => setMode('3D')}>
              3D
            </button>
          </div>
        }
      />
      <HelpNote title="Wayfinding">
        Each cascade dropdown starts at <strong>Select</strong>. Choose Complex → Building → Floor, then From / To for
        a step-by-step path to the unit.
      </HelpNote>

      <KpiRow
        items={[
          { label: 'Level', value: level },
          { label: 'Mapped nodes', value: mappedOnView },
          { label: 'Route stops', value: path.length },
          { label: 'Basemap', value: darkBasemap ? 'OSM Dark' : 'OSM Light', tone: 'info' },
        ]}
      />

      <Toolbar>
        <label className="k-compact-field">
          <span>Complex</span>
          <select
            value={complexId}
            onChange={(event) => {
              setComplexId(event.target.value)
              setBuildingId('')
              setFloorId('')
              setUnitId('')
              setLevel('complex')
            }}
          >
            <option value="">Select</option>
            {complexes.map((complex) => (
              <option key={complex.id} value={complex.id}>
                {complex.name}
              </option>
            ))}
          </select>
        </label>
        <label className="k-compact-field">
          <span>Building</span>
          <select
            value={buildingId}
            disabled={!complexId}
            onChange={(event) => {
              setBuildingId(event.target.value)
              setFloorId('')
              setUnitId('')
              setLevel('building')
            }}
          >
            <option value="">Select</option>
            {complexBuildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </label>
        <label className="k-compact-field">
          <span>Floor</span>
          <select
            value={floorId}
            disabled={!buildingId}
            onChange={(event) => {
              if (event.target.value) drillFloor(event.target.value)
              else {
                setFloorId('')
                setUnitId('')
              }
            }}
          >
            <option value="">Select</option>
            {buildingFloors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.label}
              </option>
            ))}
          </select>
        </label>
        <div className="k-segment">
          {(['complex', 'building', 'floor', 'unit'] as MapLevel[]).map((item) => (
            <button
              key={item}
              type="button"
              className={level === item ? 'is-active' : ''}
              onClick={() => goToLevel(item)}
              disabled={
                (item === 'building' && !buildingId) ||
                (item === 'floor' && !buildingId) ||
                (item === 'unit' && !floorId)
              }
            >
              {item}
            </button>
          ))}
        </div>
        <label className="k-toggle">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          Labels
        </label>
        <label className="k-toggle">
          <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
          Route
        </label>
        <label className="k-toggle">
          <input type="checkbox" checked={darkBasemap} onChange={(e) => setDarkBasemap(e.target.checked)} />
          Dark basemap
        </label>
      </Toolbar>

      <nav className="k-wf-crumb" aria-label="Map hierarchy">
        {breadcrumb.map((part, index) => (
          <span key={`${part.label}-${index}`}>
            {index > 0 ? <span className="k-wf-crumb__sep">/</span> : null}
            {part.onClick ? (
              <button type="button" className="k-wf-crumb__btn" onClick={part.onClick}>
                {part.label}
              </button>
            ) : (
              <span className="k-wf-crumb__here">{part.label}</span>
            )}
          </span>
        ))}
      </nav>

      <SplitView
        left={
          <Panel title={`${level.toUpperCase()} · ${mode}`} className="k-wf-panel">
            {!complexId ? (
              <div className="k-empty">Select a complex to load the map.</div>
            ) : mode === '3D' ? (
              level === 'complex' ? (
                <CampusBlueprint3D
                  buildings={complexBuildings.length ? complexBuildings : buildings.filter((b) => !b.complexId)}
                  floors={floors}
                  locations={locations}
                  showLabels={showLabels}
                  onSelectBuilding={drillBuilding}
                />
              ) : buildingId ? (
                <BuildingBlueprint3D
                  building={buildings.find((b) => b.id === buildingId)!}
                  floors={floors}
                  locations={locations}
                  selectedFloorId={level === 'building' ? null : floorId || null}
                  selectedUnitId={level === 'unit' ? unitId : null}
                  showLabels={showLabels}
                  onSelectFloor={drillFloor}
                  onSelectUnit={drillUnit}
                />
              ) : (
                <div className="k-empty">Select a building for 3D view.</div>
              )
            ) : (
              <WayfindingMap
                level={level}
                mode={mode}
                darkBasemap={darkBasemap}
                showLabels={showLabels}
                showRoute={showRoute}
                complexId={complexId}
                buildingId={level === 'complex' ? null : buildingId || null}
                floorId={level === 'floor' || level === 'unit' ? floorId || null : null}
                unitId={level === 'unit' ? unitId : null}
                buildings={buildings}
                floors={floors}
                locations={locations}
                routeStops={path}
                onSelectBuilding={drillBuilding}
                onSelectFloor={drillFloor}
                onSelectUnit={drillUnit}
              />
            )}
          </Panel>
        }
        right={
          <>
            <Panel title="Navigate">
              <FormGrid>
                <Field label="From">
                  <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                    <option value="">Select</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {locationLabel(loc)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="To">
                  <select value={toId} onChange={(e) => setToId(e.target.value)}>
                    <option value="">Select</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {locationLabel(loc)}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormGrid>
              <ol className="k-wf-steps">
                {path.length === 0 ? (
                  <li style={{ listStyle: 'none' }}>
                    <p className="k-muted">Select From and To for step-by-step path.</p>
                  </li>
                ) : (
                  path.map((stop, index) => (
                    <li key={`${stop.id}-${index}`}>
                      <button type="button" onClick={() => drillUnit(stop.id)}>
                        <strong>
                          {index + 1}. {stop.name}
                        </strong>
                        <span>
                          {stop.buildingName} · {stop.floorLabel} · {stop.type}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ol>
              <div className="k-wf-actions">
                <button
                  type="button"
                  className="k-btn"
                  disabled={!from}
                  onClick={() => {
                    if (!from) return
                    if (from.complexId) setComplexId(from.complexId)
                    setBuildingId(from.buildingId)
                    setFloorId(from.floorId)
                    setUnitId(from.id)
                    setLevel('unit')
                  }}
                >
                  Focus from
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--ghost"
                  disabled={!to}
                  onClick={() => {
                    if (!to) return
                    if (to.complexId) setComplexId(to.complexId)
                    setBuildingId(to.buildingId)
                    setFloorId(to.floorId)
                    setUnitId(to.id)
                    setLevel('unit')
                  }}
                >
                  Focus to
                </button>
              </div>
            </Panel>

            <Panel title="Units on floor">
              {!floorId ? (
                <p className="k-muted">Select a floor.</p>
              ) : floorUnits.length === 0 ? (
                <p className="k-muted">No units on this floor.</p>
              ) : (
                <ul className="k-wf-route-list">
                  {floorUnits.map((u) => (
                    <li key={u.id}>
                      <button type="button" className="k-link-btn" onClick={() => drillUnit(u.id)}>
                        {u.name} · {u.type}
                      </button>
                      {u.id === unitId ? <Badge tone="ok">Selected</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Grouping">
              <div className="k-detail-list">
                <div>
                  <span>Complex map</span>
                  <strong>Building footprints + links</strong>
                </div>
                <div>
                  <span>Building map</span>
                  <strong>{mode === '3D' ? 'Blueprint wireframe' : 'Floor footprints'}</strong>
                </div>
                <div>
                  <span>Floor map</span>
                  <strong>Room / unit polygons</strong>
                </div>
                <div>
                  <span>Basemap</span>
                  <strong>{mode === '3D' ? 'CAD blueprint' : 'OpenStreetMap (free)'}</strong>
                </div>
              </div>
            </Panel>

            <Panel title="Linked routes">
              {relatedRoutes.length === 0 ? (
                <p className="k-muted">No saved routes for this complex.</p>
              ) : (
                <ul className="k-wf-route-list">
                  {relatedRoutes.map((route) => (
                    <li key={route.id}>
                      <span>{route.name}</span>
                      <Badge tone={route.status === 'Active' ? 'ok' : 'warn'}>{route.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        }
      />
    </>
  )
}
