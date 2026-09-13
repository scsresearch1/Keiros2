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
    goTo,
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
  } = useTour()

  const [forceView, setForceView] = useState<'map' | '3d'>('3d')
  const [refreshing, setRefreshing] = useState(false)
  const [showTrack, setShowTrack] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [destOpen, setDestOpen] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [pickedUnitId, setPickedUnitId] = useState<string | null>(null)

  const steps = navigateResult?.journey.steps ?? []
  const outdoorSteps = useMemo(
    () =>
      steps.filter((s) => {
        const p = normalizePhase(s.phase)
        return p === 'drive' || p === 'walk'
      }),
    [steps],
  )
  const indoorSteps = useMemo(() => steps.filter((s) => s.phase === 'indoor'), [steps])
  const active = steps[activeStepIndex] ?? null
  const phase = active ? normalizePhase(active.phase) : 'indoor'
  const showOutdoor = forceView === 'map'
  const indoors = !showOutdoor

  const indoorIndex =
    active?.phase === 'indoor' ? (active.indoorIndex ?? Math.max(0, indoorSteps.indexOf(active))) : 0

  const floorPlaces = useMemo(() => {
    if (!navigateResult) return []
    const fid = selectedFloorId || navigateResult.map3d.selectedFloorId
    return navigateResult.map3d.locations.filter((l) => l.floorId === fid)
  }, [navigateResult, selectedFloorId])

  const remaining = useMemo(() => {
    const rest = steps.slice(activeStepIndex)
    const dist = rest.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
    const secs = rest.reduce((sum, s) => sum + (s.durationSec ?? 0), 0)
    return {
      distFt: Math.round(dist * 3.281),
      mins: Math.max(1, Math.round(secs / 60) || Math.ceil(rest.length * 0.4)),
      pct: steps.length ? Math.round(((activeStepIndex + 1) / steps.length) * 100) : 0,
    }
  }, [steps, activeStepIndex])

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
    setSelectedFloorId(navigateResult.map3d.selectedFloorId)
    setPickedUnitId(navigateResult.map3d.selectedUnitId)
  }, [navigateResult])

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
    const idx = steps.findIndex((s) => normalizePhase(s.phase) === target)
    if (idx >= 0) {
      setActiveStepIndex(idx)
      setForceView(target === 'indoor' ? '3d' : 'map')
    }
  }

  function nextStep() {
    if (activeStepIndex >= steps.length - 1) {
      goTo('doorAccess')
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
    await navigateToUnitId(unitId, floorId)
  }

  const floors = [...navigateResult.map3d.floors].sort((a, b) => b.level - a.level)

  return (
    <section className={`screen screen--nav nav-layout ${panelCollapsed ? 'panel-collapsed' : ''}`}>
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
              onSelectFloor={(id) => {
                setSelectedFloorId(id)
                setDestOpen(true)
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
          <div className="mode-toggle glossy-toggle" role="tablist" aria-label="Map mode">
            <button
              type="button"
              className={forceView === 'map' ? 'active' : ''}
              onClick={() => {
                setForceView('map')
                if (phase === 'indoor') jumpPhase('drive')
              }}
            >
              Outdoor
            </button>
            <button
              type="button"
              className={forceView === '3d' ? 'active' : ''}
              onClick={() => {
                setForceView('3d')
                if (phase !== 'indoor') jumpPhase('indoor')
              }}
            >
              Indoor
            </button>
          </div>
        </header>

        {showTrack && !trackingEnabled && (
          <div className="nav-toast">
            <p>Share journey progress?</p>
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
              <em>
                {showOutdoor ? 'Outdoor' : 'Indoor'} · Step {activeStepIndex + 1}/{steps.length}
              </em>
              <strong>{active.instruction}</strong>
              <span>
                {destination?.name ?? navigateResult.destination.label}
                {' · '}
                {remaining.distFt} ft · ~{remaining.mins} min
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
            <div className="phase-strip" role="tablist" aria-label="Journey phase">
              <button
                type="button"
                className={`phase-drive ${phase === 'drive' ? 'is-active' : ''}`}
                onClick={() => jumpPhase('drive')}
              >
                Drive
              </button>
              <button
                type="button"
                className={`phase-walk ${phase === 'walk' ? 'is-active' : ''}`}
                onClick={() => jumpPhase('walk')}
              >
                Walk
              </button>
              <button
                type="button"
                className={`phase-inside ${phase === 'indoor' || indoors ? 'is-active' : ''}`}
                onClick={() => jumpPhase('indoor')}
              >
                Inside
              </button>
            </div>

            {!indoors && (
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
                    <em>Destination</em>
                    <strong>{destination?.name ?? 'Pick a place'}</strong>
                  </div>
                  <button type="button" className="chip" onClick={() => setDestOpen((v) => !v)}>
                    {destOpen ? 'Close' : 'Change'}
                  </button>
                </div>

                {destOpen && (
                  <div className="dest-picker">
                    <div className="floor-chips" role="tablist" aria-label="Floors">
                      {floors.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={selectedFloorId === f.id ? 'active' : ''}
                          onClick={() => setSelectedFloorId(f.id)}
                        >
                          {f.label.replace(/floor\s*/i, 'F') || f.label}
                        </button>
                      ))}
                    </div>
                    <ul className="dest-picker__list">
                      {floorPlaces.map((place) => (
                        <li key={place.id}>
                          <button
                            type="button"
                            className={pickedUnitId === place.id ? 'is-active' : ''}
                            disabled={navigateLoading}
                            onClick={() => void chooseDestination(place.id, place.floorId)}
                          >
                            <span>
                              <strong>{place.name}</strong>
                              <em>{place.type}</em>
                            </span>
                            <span className="go">{pickedUnitId === place.id ? 'Current' : 'Go'}</span>
                          </button>
                        </li>
                      ))}
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
                <em>Live dwell</em>
                <strong>
                  {zoneLabel} · {Math.floor(liveSec / 60)}m {liveSec % 60}s
                </strong>
                <span>{syncError ? 'sync issue' : 'syncing to ERP'}</span>
              </div>
            ) : null}

            <div className="tool-row">
              <button type="button" className="chip" onClick={() => setListOpen((v) => !v)}>
                {listOpen ? 'Hide steps' : `Steps (${steps.length})`}
              </button>
              <span className="chip soft">
                {outdoorSteps.length} outdoor · {indoorSteps.length} indoor
              </span>
            </div>

            {listOpen && (
              <ol className="step-list">
                {steps.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={i === activeStepIndex ? 'is-active' : ''}
                      onClick={() => {
                        setActiveStepIndex(i)
                        setForceView(normalizePhase(s.phase) === 'indoor' ? '3d' : 'map')
                      }}
                    >
                      <span className="step-n">{i + 1}</span>
                      <span>
                        <em className={`phase-tag phase-tag--${normalizePhase(s.phase)}`}>
                          {phaseLabel(s.phase)}
                        </em>{' '}
                        {s.instruction}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <div className="nav-actions">
              <PrimaryButton
                variant="ghost"
                className="half"
                onClick={() => {
                  const prev = Math.max(0, activeStepIndex - 1)
                  setActiveStepIndex(prev)
                  setForceView(normalizePhase(steps[prev].phase) === 'indoor' ? '3d' : 'map')
                }}
                disabled={activeStepIndex === 0}
              >
                Previous
              </PrimaryButton>
              <PrimaryButton className="half" onClick={nextStep}>
                {activeStepIndex >= steps.length - 1 ? 'Arrive' : 'Next step'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
