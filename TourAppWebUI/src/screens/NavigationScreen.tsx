import { useEffect, useMemo, useState } from 'react'
import { BackChip, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import {
  getApiKey,
  normalizePhase,
  phaseLabel,
  refreshConditions,
} from '../api/client'
import { OutdoorMap } from '../map2d/OutdoorMap'
import { TowerIndoorNav } from '../map3d/TowerIndoorNav'
import { recordTrackingEvent } from '../mock/tracking'
import { useLiveDwellSync } from '../hooks/useLiveDwellSync'

export function NavigationScreen() {
  const {
    goBack,
    navigateResult,
    patchNavigateResult,
    activeStepIndex,
    setActiveStepIndex,
    trackingEnabled,
    enableTracking,
    consent,
    destination,
    navigateToUnitId,
    navigateLoading,
    navigateError,
    tourMode,
    tourStops,
    currentStopIndex,
    insideBuilding,
    markInsideBuilding,
    completeCurrentStop,
    endTourEarly,
  } = useTour()

  const [forceView, setForceView] = useState<'map' | '3d'>(insideBuilding ? '3d' : 'map')
  const [refreshing, setRefreshing] = useState(false)
  const [showTrack, setShowTrack] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [destOpen, setDestOpen] = useState(insideBuilding)
  const [panelCollapsed, setPanelCollapsed] = useState(insideBuilding)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [pickedUnitId, setPickedUnitId] = useState<string | null>(null)
  /** When inside, list can show every unit (not only one floor). */
  const [showAllFloorsList, setShowAllFloorsList] = useState(true)

  const steps = navigateResult?.journey.steps ?? []
  const indoorSteps = useMemo(() => steps.filter((s) => s.phase === 'indoor'), [steps])
  /** Once inside, guide place-to-place using indoor tips only. */
  const guideSteps = insideBuilding && tourMode === 'guided' ? indoorSteps : steps
  const guideIndex =
    insideBuilding && tourMode === 'guided'
      ? Math.max(
          0,
          indoorSteps.findIndex((s) => s.id === steps[activeStepIndex]?.id),
        )
      : activeStepIndex
  const active = steps[activeStepIndex] ?? null
  const phase = active ? normalizePhase(active.phase) : 'indoor'
  const showOutdoor = !insideBuilding && forceView === 'map'
  const indoors = !showOutdoor

  const indoorIndex =
    active?.phase === 'indoor' ? (active.indoorIndex ?? Math.max(0, indoorSteps.indexOf(active))) : 0

  const floorPlaces = useMemo(() => {
    if (!navigateResult) return []
    if (insideBuilding && showAllFloorsList) {
      return [...navigateResult.map3d.locations].sort((a, b) => {
        const fa = navigateResult.map3d.floors.find((f) => f.id === a.floorId)?.level ?? 0
        const fb = navigateResult.map3d.floors.find((f) => f.id === b.floorId)?.level ?? 0
        return fa - fb || a.name.localeCompare(b.name)
      })
    }
    const fid = selectedFloorId || navigateResult.map3d.selectedFloorId
    return navigateResult.map3d.locations.filter((l) => l.floorId === fid)
  }, [navigateResult, selectedFloorId, insideBuilding, showAllFloorsList])

  const nextTourStop =
    tourMode === 'guided' && currentStopIndex < tourStops.length - 1
      ? tourStops[currentStopIndex + 1]
      : null

  const currentFloorGroup = useMemo(() => {
    const stop = tourStops[currentStopIndex]
    if (!stop) return null
    const sameFloor = tourStops.filter((s) => s.floorId === stop.floorId)
    const idx = sameFloor.findIndex((s) => s.id === stop.id)
    return { label: stop.floorLabel, index: idx + 1, total: sameFloor.length }
  }, [tourStops, currentStopIndex])

  const remaining = useMemo(() => {
    const pool = insideBuilding && tourMode === 'guided' ? indoorSteps : steps
    const idx = insideBuilding && tourMode === 'guided' ? guideIndex : activeStepIndex
    const rest = pool.slice(Math.max(0, idx))
    const dist = rest.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
    const secs = rest.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
    return {
      distFt: Math.round(dist * 3.281),
      mins: Math.max(1, Math.round(secs / 60) || Math.ceil(rest.length * 0.4)),
      pct: pool.length ? Math.round(((idx + 1) / pool.length) * 100) : 0,
    }
  }, [steps, indoorSteps, activeStepIndex, guideIndex, insideBuilding, tourMode])

  const { liveSec, zoneLabel, syncError } = useLiveDwellSync({
    enabled: trackingEnabled,
    activeStep: active,
    navigateResult,
  })

  useEffect(() => {
    if (!consent.tracking && !trackingEnabled) {
      const t = window.setTimeout(() => setShowTrack(true), 1600)
      return () => window.clearTimeout(t)
    }
  }, [consent.tracking, trackingEnabled])

  useEffect(() => {
    if (!active || !trackingEnabled) return
    recordTrackingEvent({
      kind: 'step',
      label: active.instruction,
      latitude: active.latitude,
      longitude: active.longitude,
    })
  }, [active, trackingEnabled])

  useEffect(() => {
    if (!navigateResult) return
    const stopFloor = tourStops[currentStopIndex]?.floorId
    setSelectedFloorId(stopFloor || navigateResult.map3d.selectedFloorId)
    setPickedUnitId(navigateResult.map3d.selectedUnitId)
  }, [navigateResult, tourStops, currentStopIndex])

  // Entering indoor tips means the building walk-through has begun
  useEffect(() => {
    if (phase === 'indoor' && tourMode === 'guided') {
      markInsideBuilding()
      setForceView('3d')
    }
  }, [phase, tourMode, markInsideBuilding])

  // After entering: bigger map, open unit list, stay on indoor 3D
  useEffect(() => {
    if (!insideBuilding) return
    setForceView('3d')
    setDestOpen(true)
    setPanelCollapsed(false)
    setShowAllFloorsList(true)
  }, [insideBuilding, currentStopIndex, navigateResult?.sessionId])

  if (!navigateResult) {
    return (
      <section className="screen">
        <PrimaryButton onClick={goBack}>Back</PrimaryButton>
      </section>
    )
  }

  async function onRefresh() {
    const current = navigateResult
    if (!current) return
    setRefreshing(true)
    try {
      const live = await refreshConditions(
        getApiKey(),
        current.destination.latitude,
        current.destination.longitude,
        current.origin.offsetMiles,
      )
      patchNavigateResult({
        weather: live.weather,
        outdoor: {
          ...current.outdoor,
          traffic: live.outdoor.traffic,
          provider: live.outdoor.provider || current.outdoor.provider,
          steps: live.outdoor.steps ?? current.outdoor.steps,
        },
      })
    } catch {
      /* soft */
    } finally {
      setRefreshing(false)
    }
  }

  function jumpPhase(target: 'drive' | 'walk' | 'indoor') {
    if (insideBuilding && target !== 'indoor') return
    const idx = steps.findIndex((s) => normalizePhase(s.phase) === target)
    if (idx >= 0) {
      setActiveStepIndex(idx)
      setForceView(target === 'indoor' ? '3d' : 'map')
    }
  }

  function nextStep() {
    if (insideBuilding && tourMode === 'guided') {
      const atLastIndoor =
        indoorSteps.length === 0 || guideIndex >= indoorSteps.length - 1 || activeStepIndex >= steps.length - 1
      if (atLastIndoor) {
        void completeCurrentStop()
        return
      }
      const nextIndoor = indoorSteps[guideIndex + 1]
      const global = steps.findIndex((s) => s.id === nextIndoor.id)
      if (global >= 0) {
        setActiveStepIndex(global)
        setForceView('3d')
      }
      return
    }

    if (activeStepIndex >= steps.length - 1) {
      void completeCurrentStop()
      return
    }
    const next = activeStepIndex + 1
    setActiveStepIndex(next)
    const nextPhase = normalizePhase(steps[next].phase)
    setForceView(nextPhase === 'indoor' ? '3d' : 'map')
  }

  async function chooseDestination(unitId: string, floorId?: string) {
    setPickedUnitId(unitId)
    if (floorId) setSelectedFloorId(floorId)
    setForceView('3d')
    markInsideBuilding()
    await navigateToUnitId(unitId, floorId)
  }

  const floors = [...navigateResult.map3d.floors].sort((a, b) => a.level - b.level)
  const tourStop = tourStops[currentStopIndex]
  const stopLabel =
    tourMode === 'guided' && tourStop
      ? insideBuilding
        ? currentFloorGroup
          ? `${currentFloorGroup.label} · ${currentFloorGroup.index}/${currentFloorGroup.total} · ${tourStop.title}`
          : `Inside · ${currentStopIndex + 1}/${tourStops.length} · ${tourStop.title}`
        : `Enter building · ${tourStop.title}`
      : destination?.name ?? navigateResult.destination.label

  const atEndOfCurrentPlace =
    insideBuilding && tourMode === 'guided'
      ? indoorSteps.length === 0 || guideIndex >= indoorSteps.length - 1 || activeStepIndex >= steps.length - 1
      : activeStepIndex >= steps.length - 1

  const arriveLabel = atEndOfCurrentPlace
    ? nextTourStop
      ? `Next: ${nextTourStop.title}`
      : 'Finish building tour'
    : insideBuilding
      ? 'Next place tip'
      : 'Next'

  return (
    <section
      className={`screen screen--nav nav-layout ${panelCollapsed ? 'panel-collapsed' : ''} ${insideBuilding ? 'nav-layout--indoor' : ''}`}
    >
      <div className="nav-map">
        <div className="nav-map__stage">
          {showOutdoor ? (
            <OutdoorMap
              result={navigateResult}
              activeStep={phase === 'indoor' ? null : active}
              weather={navigateResult.weather}
              traffic={navigateResult.outdoor.traffic}
            />
          ) : (
            <TowerIndoorNav
              map3d={navigateResult.map3d}
              activeIndoorStep={indoorIndex}
              selectedFloorId={selectedFloorId}
              selectedUnitId={pickedUnitId}
              showAllUnits={insideBuilding}
              onSelectFloor={(id) => {
                setSelectedFloorId(id)
                setShowAllFloorsList(false)
                setDestOpen(true)
                setPanelCollapsed(false)
              }}
              onSelectUnit={(id) => {
                const loc = navigateResult.map3d.locations.find((l) => l.id === id)
                void chooseDestination(id, loc?.floorId)
              }}
              onSelectRouteStep={(idx) => {
                const step = indoorSteps[idx]
                if (!step) return
                const global = steps.findIndex((s) => s.id === step.id)
                if (global >= 0) setActiveStepIndex(global)
              }}
            />
          )}
        </div>

        <header className="nav-chrome">
          <BackChip onClick={goBack} />
          {!insideBuilding && (
            <div className="mode-toggle glossy-toggle" role="tablist" aria-label="Map mode">
              <button
                type="button"
                className={forceView === 'map' ? 'active' : ''}
                onClick={() => {
                  setForceView('map')
                  if (phase === 'indoor') jumpPhase('drive')
                }}
              >
                Outside
              </button>
              <button
                type="button"
                className={forceView === '3d' ? 'active' : ''}
                onClick={() => {
                  setForceView('3d')
                  if (phase !== 'indoor') jumpPhase('indoor')
                }}
              >
                Inside
              </button>
            </div>
          )}
          {insideBuilding && (
            <div className="nav-chrome__end">
              <div className="mode-toggle glossy-toggle">
                <button type="button" className="active">
                  Floor by floor
                </button>
              </div>
              <button type="button" className="end-tour-btn" onClick={endTourEarly}>
                End tour
              </button>
            </div>
          )}
        </header>

        {showTrack && !trackingEnabled && (
          <div className="nav-toast">
            <p>Track time at each stop?</p>
            <button
              type="button"
              onClick={() => {
                enableTracking()
                setShowTrack(false)
              }}
            >
              Enable
            </button>
            <button type="button" className="ghost" onClick={() => setShowTrack(false)}>
              Later
            </button>
          </div>
        )}

        {active && (
          <div className={`nav-banner is-${showOutdoor ? 'outdoor' : 'indoor'}`}>
            <div className="nav-banner__text">
              <em>{stopLabel}</em>
              <strong>{active.instruction}</strong>
              <span>
                {remaining.distFt} ft · ~{remaining.mins} min · tip {activeStepIndex + 1}/{steps.length}
              </span>
            </div>
            <div className="nav-banner__bar" aria-hidden>
              <div style={{ width: `${remaining.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="nav-panel glossy-panel">
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setPanelCollapsed((v) => !v)}
          aria-label={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
        />

        {!panelCollapsed && (
          <div className="nav-panel__body">
            <div className="phase-strip" role="tablist" aria-label="Tour phase">
              {!insideBuilding && (
                <>
                  <button
                    type="button"
                    className={`phase-drive ${phase === 'drive' ? 'is-active' : ''}`}
                    onClick={() => jumpPhase('drive')}
                  >
                    Arrive
                  </button>
                  <button
                    type="button"
                    className={`phase-walk ${phase === 'walk' ? 'is-active' : ''}`}
                    onClick={() => jumpPhase('walk')}
                  >
                    Walk in
                  </button>
                </>
              )}
              <button
                type="button"
                className={`phase-inside ${phase === 'indoor' || indoors ? 'is-active' : ''}`}
                onClick={() => jumpPhase('indoor')}
              >
                {insideBuilding ? 'Places inside' : 'Explore'}
              </button>
            </div>

            {insideBuilding && nextTourStop && (
              <div className="nav-status">
                <em>Up next on your walk-through</em>
                <strong>{nextTourStop.title}</strong>
                <span>{nextTourStop.blurb}</span>
              </div>
            )}

            {!indoors && !insideBuilding && (
              <div className="meta-row">
                <div>
                  <em>Weather</em>
                  <strong>
                    {navigateResult.weather.summary ?? '—'}
                    {navigateResult.weather.temperatureF != null
                      ? ` · ${navigateResult.weather.temperatureF}°F`
                      : ''}
                  </strong>
                </div>
                <div>
                  <em>Traffic</em>
                  <strong className={`traffic-${(navigateResult.outdoor.traffic.level || '').toLowerCase()}`}>
                    {navigateResult.outdoor.traffic.level}
                  </strong>
                </div>
                <button type="button" className="link-btn" onClick={() => void onRefresh()} disabled={refreshing}>
                  {refreshing ? '…' : 'Refresh'}
                </button>
              </div>
            )}

            {indoors && (
              <section className="nav-section">
                <div className="nav-section__head">
                  <div>
                    <em>{insideBuilding ? 'All units in the building' : 'Looking around?'}</em>
                    <strong>{destination?.name ?? 'Pick a place'}</strong>
                  </div>
                  <button type="button" className="chip" onClick={() => setDestOpen((v) => !v)}>
                    {destOpen ? 'Hide list' : 'Show units'}
                  </button>
                </div>

                {destOpen && (
                  <div className="dest-picker">
                    <div className="floor-chips" role="tablist" aria-label="Floors">
                      {insideBuilding && (
                        <button
                          type="button"
                          className={showAllFloorsList ? 'active' : ''}
                          onClick={() => setShowAllFloorsList(true)}
                        >
                          All
                        </button>
                      )}
                      {floors.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={!showAllFloorsList && selectedFloorId === f.id ? 'active' : ''}
                          onClick={() => {
                            setShowAllFloorsList(false)
                            setSelectedFloorId(f.id)
                          }}
                        >
                          {f.label.replace(/floor\s*/i, 'F') || f.label}
                        </button>
                      ))}
                    </div>
                    <ul className="dest-picker__list">
                      {floorPlaces.map((place) => {
                        const floorName =
                          floors.find((f) => f.id === place.floorId)?.label || place.type
                        return (
                        <li key={place.id}>
                          <button
                            type="button"
                            className={pickedUnitId === place.id ? 'is-active' : ''}
                            disabled={navigateLoading}
                            onClick={() => void chooseDestination(place.id, place.floorId)}
                          >
                            <span>
                              <strong>{place.name}</strong>
                              <em>
                                {insideBuilding && showAllFloorsList ? floorName : place.type}
                              </em>
                            </span>
                            <span className="go">{pickedUnitId === place.id ? 'Current' : 'Go'}</span>
                          </button>
                        </li>
                        )
                      })}
                      {!floorPlaces.length ? (
                        <li className="dest-empty">No places on this floor.</li>
                      ) : null}
                    </ul>
                    {navigateError ? <p className="field-error">{navigateError}</p> : null}
                    {navigateLoading ? <p className="explore-hint">Updating route…</p> : null}
                  </div>
                )}
              </section>
            )}

            {trackingEnabled && zoneLabel ? (
              <div className="nav-status">
                <em>You’re spending time here</em>
                <strong>
                  {zoneLabel} · {Math.floor(liveSec / 60)}m {liveSec % 60}s
                </strong>
                <span>{syncError ? 'couldn’t sync quietly' : 'optional visit timing'}</span>
              </div>
            ) : null}

            <div className="tool-row">
              <button type="button" className="chip" onClick={() => setListOpen((v) => !v)}>
                {listOpen ? 'Hide tips' : 'Direction tips'}
              </button>
              <span className="chip soft">
                {tourMode === 'guided'
                  ? insideBuilding
                    ? currentFloorGroup
                      ? `${currentFloorGroup.label} · unit ${currentFloorGroup.index}/${currentFloorGroup.total}`
                      : `Stop ${currentStopIndex + 1}/${tourStops.length}`
                    : `Lowest floor first · ${tourStops.length} stops`
                  : `${indoorSteps.length} indoor tips`}
              </span>
              {tourMode === 'guided' && (
                <button type="button" className="chip danger" onClick={endTourEarly}>
                  End tour
                </button>
              )}
            </div>

            {listOpen && (
              <ol className="step-list">
                {guideSteps.map((s) => {
                  const global = steps.findIndex((x) => x.id === s.id)
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={global === activeStepIndex ? 'is-active' : ''}
                        onClick={() => {
                          setActiveStepIndex(global)
                          setForceView(normalizePhase(s.phase) === 'indoor' || insideBuilding ? '3d' : 'map')
                        }}
                      >
                        <span className="step-n">{guideSteps.indexOf(s) + 1}</span>
                        <span>
                          <em className={`phase-tag phase-tag--${normalizePhase(s.phase)}`}>
                            {phaseLabel(s.phase)}
                          </em>{' '}
                          {s.instruction}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}

            <div className="nav-actions">
              <PrimaryButton
                variant="ghost"
                className="half"
                onClick={() => {
                  if (insideBuilding && tourMode === 'guided') {
                    if (guideIndex <= 0) return
                    const prevIndoor = indoorSteps[guideIndex - 1]
                    const global = steps.findIndex((s) => s.id === prevIndoor.id)
                    if (global >= 0) setActiveStepIndex(global)
                    return
                  }
                  const prev = Math.max(0, activeStepIndex - 1)
                  setActiveStepIndex(prev)
                  setForceView(normalizePhase(steps[prev].phase) === 'indoor' ? '3d' : 'map')
                }}
                disabled={insideBuilding && tourMode === 'guided' ? guideIndex <= 0 : activeStepIndex === 0}
              >
                Previous
              </PrimaryButton>
              <PrimaryButton className="half" onClick={nextStep} disabled={navigateLoading}>
                {arriveLabel}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
