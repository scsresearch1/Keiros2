import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  fetchHealth,
  fetchHierarchy,
  navigate,
  refreshConditions,
  applyDriveRefresh,
  phaseLabel,
  type Hierarchy,
  type NavigateResult,
} from './api'
import { OutdoorMap } from './components/OutdoorMap'
import { Indoor3D } from './components/Indoor3D'
import { IndoorFloorMap } from './components/IndoorFloorMap'
import { StartLocationPanel } from './components/StartLocationPanel'
import { NavGuidanceBanner } from './components/NavGuidanceBanner'
import { AutocompleteField, type AutocompleteOption } from './components/AutocompleteField'
import { unlockVoiceFromGesture, useDirectionVoice } from './voiceGuide'
import { attachLotToResult, withLiveDrive } from './liveDrive'
import {
  matchLiveProgress,
  useGeolocationWatch,
  type LiveProgress,
} from './liveNavigation'
import { rerouteFromLiveFix } from './smartReroute'
import type { StartPoint } from './startLocation'

const DEMO_KEY = 'keiros_live_ot_demo_map_nav_2026'
const KEY_STORAGE = 'keiros_api_demo_key'

type StartMode = 'demo' | 'live' | 'custom'

function readCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot read the current location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => reject(new Error('Allow location access to use Live.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    )
  })
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) || '')
  const [keyInput, setKeyInput] = useState(apiKey || DEMO_KEY)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [complexId, setComplexId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [result, setResult] = useState<NavigateResult | null>(null)
  const [journeyIndex, setJourneyIndex] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [startMode, setStartMode] = useState<StartMode>('demo')
  /** Demo Mode is the default start — destination can be chosen immediately. */
  const [startReady, setStartReady] = useState(true)
  const [liveSelected, setLiveSelected] = useState(false)
  const [customOrigin, setCustomOrigin] = useState<StartPoint | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [liveOrigin, setLiveOrigin] = useState<{ latitude: number; longitude: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [indoorView, setIndoorView] = useState<'floor' | 'building'>('floor')
  /** Google Maps–style live GPS follow. Next/Previous stay available as optional manual control. */
  const [liveNav, setLiveNav] = useState(true)
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  const manualHoldUntil = useRef(0)
  const rerouteLockUntil = useRef(0)
  const lastOffRouteAt = useRef(0)

  useEffect(() => {
    void fetchHealth()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false))
  }, [])

  async function unlock(e: FormEvent) {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) {
      setError('Enter an API key to continue.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const h = await fetchHierarchy(key)
      setHierarchy(h)
      setApiKey(key)
      localStorage.setItem(KEY_STORAGE, key)
      setComplexId('')
      setBuildingId('')
      setFloorId('')
      setUnitId('')
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate')
      setHierarchy(null)
      setApiKey('')
    } finally {
      setLoading(false)
    }
  }

  const buildings = useMemo(() => {
    if (!hierarchy || !complexId) return []
    return hierarchy.buildings.filter((b) => b.complexId === complexId)
  }, [hierarchy, complexId])

  const floors = useMemo(() => {
    if (!hierarchy || !buildingId) return []
    return hierarchy.floors.filter((f) => f.buildingId === buildingId)
  }, [hierarchy, buildingId])

  const units = useMemo(() => {
    if (!hierarchy || !floorId) return []
    return hierarchy.units.filter((u) => u.floorId === floorId)
  }, [hierarchy, floorId])

  const complexOptions = useMemo<AutocompleteOption[]>(() => {
    if (!hierarchy) return []
    return hierarchy.complexes.map((c) => ({
      id: c.id,
      label: c.name,
      hint: [c.city, c.address].filter(Boolean).join(' · ') || undefined,
      searchText: `${c.name} ${c.city ?? ''} ${c.address ?? ''}`,
    }))
  }, [hierarchy])

  const buildingOptions = useMemo<AutocompleteOption[]>(() => {
    return buildings.map((b) => ({
      id: b.id,
      label: b.name,
      hint: b.complexName || undefined,
      searchText: `${b.name} ${b.complexName ?? ''}`,
    }))
  }, [buildings])

  const floorOptions = useMemo<AutocompleteOption[]>(() => {
    return floors.map((f) => ({
      id: f.id,
      label: `${f.label} (L${f.level})`,
      hint: f.buildingName || undefined,
      searchText: `${f.label} L${f.level} ${f.buildingName}`,
    }))
  }, [floors])

  /** Unit list is scoped to the selected floor (cascade). */
  const unitOptions = useMemo<AutocompleteOption[]>(() => {
    return units.map((u) => ({
      id: u.id,
      label: `${u.name} · ${u.type}`,
      hint: u.type || undefined,
      searchText: `${u.name} ${u.type} ${u.code}`,
    }))
  }, [units])

  /** When a parent is chosen and only one child exists, auto-select that child. */
  useEffect(() => {
    if (!complexId || buildingId) return
    if (buildings.length === 1) {
      setBuildingId(buildings[0].id)
      setFloorId('')
      setUnitId('')
      setResult(null)
    }
  }, [complexId, buildingId, buildings])

  useEffect(() => {
    if (!buildingId || floorId) return
    if (floors.length === 1) {
      setFloorId(floors[0].id)
      setUnitId('')
      setResult(null)
    }
  }, [buildingId, floorId, floors])

  useEffect(() => {
    if (!floorId || unitId) return
    if (units.length === 1) {
      setUnitId(units[0].id)
      setResult(null)
    }
  }, [floorId, unitId, units])

  function selectComplex(id: string) {
    setComplexId(id)
    setBuildingId('')
    setFloorId('')
    setUnitId('')
    setResult(null)
  }

  function selectBuilding(id: string) {
    setBuildingId(id)
    setFloorId('')
    setUnitId('')
    setResult(null)
  }

  function selectFloor(id: string) {
    setFloorId(id)
    setUnitId('')
    setResult(null)
  }

  function selectUnit(id: string) {
    setUnitId(id)
    setResult(null)
  }

  function selectionReady() {
    return Boolean(apiKey && complexId && buildingId && floorId && unitId)
  }

  async function planRoute(
    mode: StartMode,
    origin?: { latitude: number; longitude: number; label?: string },
  ) {
    if (!selectionReady()) {
      setError('Select complex, building, floor, and unit.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const explicit = mode !== 'demo' && origin
      const nav = await navigate(apiKey, {
        complexId,
        buildingId,
        floorId,
        unitId,
        startMode: mode,
        ...(explicit
          ? {
              originLatitude: origin.latitude,
              originLongitude: origin.longitude,
              ...(origin.label ? { originLabel: origin.label } : {}),
            }
          : {}),
      })
      const routed = explicit
        ? await withLiveDrive(nav, origin, {
            label: origin.label,
            startMode: mode === 'custom' ? 'custom' : 'live',
          })
        : await attachLotToResult(nav)
      setResult(routed)
      setJourneyIndex(0)
      setLiveNav(true)
      setLiveProgress(null)
      setRecalculating(false)
      manualHoldUntil.current = 0
      rerouteLockUntil.current = 0
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Navigate failed')
    } finally {
      setLoading(false)
    }
  }

  async function chooseStartMode(next: 'demo' | 'live') {
    if (next === 'demo') {
      setStartMode('demo')
      setStartReady(true)
      setLiveSelected(false)
      setLiveOrigin(null)
      setError('')
      if (selectionReady()) await planRoute('demo')
      return
    }
    setLocating(true)
    setError('')
    try {
      const coords = await readCurrentLocation()
      setLiveOrigin(coords)
      setLiveSelected(true)
      setStartMode('live')
      setStartReady(true)
      if (selectionReady()) await planRoute('live', coords)
    } catch (err) {
      setStartMode('demo')
      setLiveSelected(false)
      setLiveOrigin(null)
      setError(err instanceof Error ? err.message : 'Could not read the current location.')
    } finally {
      setLocating(false)
    }
  }

  async function runNavigate(e: FormEvent) {
    e.preventDefault()
    // Phones require a tap before speechSynthesis will play.
    unlockVoiceFromGesture()
    if (!startReady) {
      setError('Choose a starting position first.')
      return
    }
    if (!selectionReady()) {
      setError('Select the destination: complex, building, floor, and unit.')
      return
    }
    if (startMode === 'custom') {
      if (!customOrigin) {
        setError('Set a starting point, or switch to Demo Mode or Live.')
        return
      }
      await planRoute('custom', customOrigin)
      return
    }
    if (startMode === 'live') {
      setLocating(true)
      try {
        const coords = await readCurrentLocation()
        setLiveOrigin(coords)
        await planRoute('live', coords)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read the current location.')
      } finally {
        setLocating(false)
      }
      return
    }
    await planRoute('demo')
  }

  async function onRefreshConditions() {
    if (!apiKey || !result) return
    setRefreshing(true)
    setError('')
    try {
      const live = await refreshConditions(apiKey, {
        latitude: result.destination.latitude,
        longitude: result.destination.longitude,
        originMiles: result.origin.offsetMiles,
        origin: { latitude: result.origin.latitude, longitude: result.origin.longitude },
        parking: result.parking
          ? { latitude: result.parking.latitude, longitude: result.parking.longitude }
          : undefined,
      })
      setResult(await attachLotToResult(applyDriveRefresh(result, live)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh conditions')
    } finally {
      setRefreshing(false)
    }
  }

  function signOut() {
    localStorage.removeItem(KEY_STORAGE)
    setApiKey('')
    setHierarchy(null)
    setResult(null)
    setComplexId('')
    setBuildingId('')
    setFloorId('')
    setUnitId('')
    setKeyInput(DEMO_KEY)
    setStartMode('demo')
    setStartReady(true)
    setLiveSelected(false)
    setCustomOrigin(null)
    setPickerOpen(false)
    setLiveOrigin(null)
  }

  async function applyCustomStart(point: StartPoint) {
    setCustomOrigin(point)
    setStartMode('custom')
    setStartReady(true)
    setPickerOpen(false)
    setError('')
    if (selectionReady()) await planRoute('custom', point)
  }

  async function clearCustomStart() {
    setCustomOrigin(null)
    setPickerOpen(false)
    await chooseStartMode(liveSelected ? 'live' : 'demo')
  }

  const voiceSteps = result?.journey.steps ?? []
  const voiceCurrent = voiceSteps[journeyIndex]
    ? { ...voiceSteps[journeyIndex], id: `${result?.sessionId ?? 'route'}:${voiceSteps[journeyIndex].id}` }
    : null
  const voice = useDirectionVoice(voiceCurrent, voiceSteps[journeyIndex + 1] ?? null)

  const outdoorActive =
    Boolean(result) &&
    (voiceSteps[journeyIndex]?.phase === 'drive' ||
      voiceSteps[journeyIndex]?.phase === 'walk' ||
      voiceSteps[journeyIndex]?.phase === 'outdoor')

  const liveWatchOn = Boolean(result && liveNav && outdoorActive)
  const { fix: liveFix, error: liveGpsError, watching: liveWatching } = useGeolocationWatch(liveWatchOn)

  useEffect(() => {
    if (!liveWatchOn || !liveFix || !result) {
      setLiveProgress(null)
      return
    }
    const progress = matchLiveProgress(result.journey.steps, liveFix, journeyIndex)
    setLiveProgress(progress)
    if (Date.now() < manualHoldUntil.current) return
    if (progress.stepIndex !== journeyIndex && progress.distanceToRouteM < 120) {
      setJourneyIndex(progress.stepIndex)
    }

    // Off-route → recalculate like Google Maps (throttle)
    const now = Date.now()
    if (
      progress.offRoute &&
      now > rerouteLockUntil.current &&
      now - lastOffRouteAt.current > 2500
    ) {
      lastOffRouteAt.current = now
      rerouteLockUntil.current = now + 12000
      setRecalculating(true)
      void rerouteFromLiveFix(result, liveFix)
        .then((next) => {
          if (!next) return
          setResult(next)
          setJourneyIndex(0)
          manualHoldUntil.current = 0
        })
        .finally(() => setRecalculating(false))
    }
  }, [liveWatchOn, liveFix, result, journeyIndex])

  useEffect(() => {
    const step = result?.journey.steps[journeyIndex]
    if (step?.phase === 'indoor') setIndoorView('floor')
  }, [result, journeyIndex])

  function bumpJourney(delta: number) {
    manualHoldUntil.current = Date.now() + 10000
    setJourneyIndex((i) => {
      const max = Math.max(0, (result?.journey.steps.length ?? 1) - 1)
      return Math.min(max, Math.max(0, i + delta))
    })
  }

  function jumpJourney(index: number) {
    manualHoldUntil.current = Date.now() + 10000
    setJourneyIndex(index)
  }

  if (!apiKey || !hierarchy) {
    return (
      <div className="demo-shell demo-shell--gate">
        <div className="demo-gate">
          <p className="demo-brand">Keiros</p>
          <h1>Map Navigation API Demo</h1>
          <p className="demo-lede">
            Client-only app. Enter an ERP API key, pick Complex → Building → Floor → Unit, and choose Demo
            Mode, Live, or a custom start. Activity appears live in ERP under API Logs & API Navigation Live.
          </p>
          <form onSubmit={unlock} className="demo-gate__form">
            <label>
              API key
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="keiros_live_ot_…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="demo-hint">
              Prefer a secret issued in ERP (API Keys → Issue secret). Legacy demo prefix key:{' '}
              <code>{DEMO_KEY}</code>
            </p>
            <button type="submit" disabled={loading}>
              {loading ? 'Validating…' : 'Continue'}
            </button>
          </form>
          <p className={`demo-api-status ${apiOk === false ? 'is-bad' : apiOk ? 'is-ok' : ''}`}>
            API server:{' '}
            {apiOk === null ? 'checking…' : apiOk ? 'reachable on :8787' : 'offline — run ERP_Full/server'}
          </p>
          {error ? <p className="demo-error">{error}</p> : null}
        </div>
      </div>
    )
  }

  const steps = result?.journey.steps ?? []
  const active = steps[journeyIndex] ?? null
  const phase = active?.phase === 'outdoor' ? 'drive' : (active?.phase ?? 'drive')
  const indoorStep = active?.phase === 'indoor' ? (active.indoorIndex ?? 0) : 0
  const showOutdoorMap = phase === 'drive' || phase === 'walk'
  const canNavigate = Boolean(complexId && buildingId && floorId && unitId)
  const selectedUnit =
    (hierarchy?.units.find((unit) => unit.id === unitId) ?? null) ||
    (units.find((unit) => unit.id === unitId) ?? null)
  const unitFocus =
    selectedUnit &&
    Number.isFinite(selectedUnit.latitude) &&
    Number.isFinite(selectedUnit.longitude) &&
    Math.abs(selectedUnit.latitude) <= 90 &&
    Math.abs(selectedUnit.longitude) <= 180
      ? { latitude: selectedUnit.latitude, longitude: selectedUnit.longitude, label: selectedUnit.name }
      : null
  const switchShowsLive = startMode === 'live' || (startMode === 'custom' && liveSelected)

  return (
    <div className="demo-shell">
      <header className="demo-top">
        <div>
          <p className="demo-brand">Keiros · API Demo</p>
          <h1>Navigate to unit</h1>
        </div>
        <button type="button" className="demo-ghost" onClick={signOut}>
          Change API key
        </button>
      </header>

      <form className="demo-controls" onSubmit={runNavigate}>
        <section className="demo-step">
          <p className="demo-step__title">1 · Starting position</p>
          <div className="demo-start__bar">
            <div
              className={`demo-mode${startMode === 'custom' && startReady ? ' is-held' : ''}`}
              role="group"
              aria-label="Starting position"
            >
              <button
                type="button"
                className={startReady && startMode === 'demo' ? 'is-active' : ''}
                disabled={locating || loading}
                onClick={() => void chooseStartMode('demo')}
              >
                Demo Mode
              </button>
              <button
                type="button"
                role="switch"
                className={`demo-mode__switch${switchShowsLive ? ' is-live' : ''}`}
                aria-checked={startReady && switchShowsLive}
                aria-label={
                  startReady && startMode === 'custom'
                    ? 'Custom start is in use. Activate to return to Demo Mode or Live.'
                    : startReady && switchShowsLive
                      ? 'Live, current location'
                      : 'Demo Mode, simulated start'
                }
                disabled={locating || loading}
                onClick={() => {
                  if (startMode === 'custom') {
                    void chooseStartMode(liveSelected ? 'live' : 'demo')
                    return
                  }
                  if (!startReady) {
                    void chooseStartMode('demo')
                    return
                  }
                  void chooseStartMode(startMode === 'live' ? 'demo' : 'live')
                }}
              >
                <span className="demo-mode__knob" />
              </button>
              <button
                type="button"
                className={startReady && startMode === 'live' ? 'is-active' : ''}
                disabled={locating || loading}
                onClick={() => void chooseStartMode('live')}
              >
                Live
              </button>
            </div>
            {startMode === 'custom' && customOrigin ? (
              <div className="demo-start__chip">
                <strong>{customOrigin.label}</strong>
                <span>
                  {customOrigin.latitude.toFixed(5)}, {customOrigin.longitude.toFixed(5)}
                </span>
                <button
                  type="button"
                  className="demo-ghost demo-ghost--small"
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  {pickerOpen ? 'Close' : 'Change'}
                </button>
                <button
                  type="button"
                  className="demo-ghost demo-ghost--small"
                  onClick={() => void clearCustomStart()}
                  disabled={loading || locating}
                >
                  Clear
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="demo-ghost demo-ghost--small"
                onClick={() => setPickerOpen((open) => !open)}
              >
                {pickerOpen ? 'Close map' : 'Set a point'}
              </button>
            )}
            <span className="demo-hint">
              {startMode === 'custom' && startReady
                ? 'Custom map point is the drive start.'
                : startMode === 'live' && startReady
                  ? 'Using this device as the start.'
                  : 'Demo Mode uses a simulated start. Switch to Live or set a point anytime.'}
            </span>
          </div>
          {pickerOpen ? (
            <StartLocationPanel
              initial={customOrigin}
              unit={unitFocus}
              busy={loading || locating}
              onUse={(point) => void applyCustomStart(point)}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </section>
        <section className="demo-step demo-step--dest">
          <p className="demo-step__title">2 · Destination</p>
          <div className="demo-dest">
            <AutocompleteField
              label="Complex"
              value={complexId}
              options={complexOptions}
              placeholder="Search complex…"
              onChange={selectComplex}
            />
            <AutocompleteField
              label="Building"
              value={buildingId}
              options={buildingOptions}
              placeholder={complexId ? 'Search building…' : 'Pick a complex first'}
              disabled={!complexId}
              emptyText={complexId ? 'No buildings match' : 'Select a complex first'}
              onChange={selectBuilding}
            />
            <AutocompleteField
              label="Floor"
              value={floorId}
              options={floorOptions}
              placeholder={buildingId ? 'Search floor…' : 'Pick a building first'}
              disabled={!buildingId}
              emptyText={buildingId ? 'No floors match' : 'Select a building first'}
              onChange={selectFloor}
            />
            <AutocompleteField
              label="Unit"
              value={unitId}
              options={unitOptions}
              placeholder={floorId ? 'Search unit, aisle, room…' : 'Pick a floor first'}
              disabled={!floorId}
              emptyText={floorId ? 'No units on this floor' : 'Select a floor first'}
              onChange={selectUnit}
            />
            <div className="demo-controls__go">
              <button type="submit" disabled={loading || locating || !canNavigate}>
                {loading ? 'Calling API…' : 'Navigate'}
              </button>
            </div>
          </div>
        </section>
      </form>
      {error ? <p className="demo-error">{error}</p> : null}

      {result ? (
        <>
          <section className="demo-meta">
            <article>
              <h3>Weather · live</h3>
              <p>
                <strong>{result.weather.summary ?? '—'}</strong>
                {result.weather.temperatureF != null ? ` · ${result.weather.temperatureF}°F` : ''}
                {result.weather.feelsLikeF != null ? ` (feels ${result.weather.feelsLikeF}°F)` : ''}
              </p>
              <p>
                Humidity {result.weather.humidityPct ?? '—'}% · Wind {result.weather.windMph ?? '—'} mph
                {result.weather.precipitationIn != null
                  ? ` · precip ${result.weather.precipitationIn} in`
                  : ''}
              </p>
              <p className="demo-meta__src">{result.weather.provider}</p>
            </article>
            <article>
              <h3>Traffic · live</h3>
              <p>
                <strong className={`traffic-${(result.outdoor.traffic.level || '').toLowerCase()}`}>
                  {result.outdoor.traffic.level}
                </strong>
                {' · '}
                congestion {result.outdoor.traffic.congestionIndex}
                {result.outdoor.traffic.averageSpeedMph != null
                  ? ` · avg ${result.outdoor.traffic.averageSpeedMph} mph`
                  : ''}
              </p>
              <p>
                {result.outdoor.distanceMiles} mi · {result.outdoor.durationMinutes} min ·{' '}
                {result.outdoor.provider}
              </p>
              <p className="demo-meta__src">{result.outdoor.traffic.note}</p>
            </article>
            <article>
              <h3>Journey</h3>
              <p>
                {result.journey?.summary ??
                  'Drive to parking → walk to entrance → navigate inside.'}
              </p>
              <p>
                {result.journey?.driveSteps ?? result.journey?.outdoorSteps ?? 0} drive ·{' '}
                {result.journey?.walkSteps ?? 0} walk · {result.journey?.indoorSteps ?? 0} inside
                {result.walk?.distanceM != null
                  ? ` · walk ${result.walk.distanceM} m (${result.walk.durationMinutes ?? '—'} min)`
                  : ''}
              </p>
              <p>
                Start: {result.origin.label}
                {result.origin.startMode === 'custom' &&
                !result.origin.label.includes(
                  `${result.origin.latitude.toFixed(5)}, ${result.origin.longitude.toFixed(5)}`,
                )
                  ? ` · ${result.origin.latitude.toFixed(5)}, ${result.origin.longitude.toFixed(5)}`
                  : liveOrigin && startMode === 'live'
                    ? ` · device ${liveOrigin.latitude.toFixed(5)}, ${liveOrigin.longitude.toFixed(5)}`
                    : ''}
              </p>
              <p>
                Indoor {result.indoor?.walkMinutes ?? '—'} min · session{' '}
                <code>{result.sessionId}</code>
              </p>
              {!result.walk || !result.parking ? (
                <p className="demo-error">
                  API response is missing walk/parking. Restart ERP_Full/server and press Navigate again.
                </p>
              ) : null}
              <button type="button" className="demo-ghost demo-ghost--small" onClick={() => void onRefreshConditions()} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh weather & traffic'}
              </button>
            </article>
          </section>

          <div className="demo-phase-strip" aria-label="Journey phases">
            {result.outdoor.provider === 'on-site' || !(result.outdoor.steps?.length) ? (
              <>
                <span className={phase === 'walk' ? 'is-active phase-walk' : 'phase-walk'}>1 · Walk to entrance</span>
                <span className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}>2 · Inside building</span>
              </>
            ) : (
              <>
                <span className={phase === 'drive' ? 'is-active phase-drive' : 'phase-drive'}>1 · Drive to parking</span>
                <span className={phase === 'walk' ? 'is-active phase-walk' : 'phase-walk'}>2 · Walk to entrance</span>
                <span className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}>3 · Inside building</span>
              </>
            )}
          </div>

          {active && (showOutdoorMap || phase === 'indoor') ? (
            <NavGuidanceBanner
              active={active}
              upcoming={steps[journeyIndex + 1] ?? null}
              progress={liveNav && showOutdoorMap ? liveProgress : null}
              recalculating={recalculating}
              live={liveNav && showOutdoorMap && Boolean(liveFix)}
            />
          ) : null}

          <div className="demo-journey">
            <div className="demo-live-bar">
              <button
                type="button"
                className={`demo-live-toggle${liveNav ? ' is-on' : ''}`}
                aria-pressed={liveNav}
                onClick={() => setLiveNav((v) => !v)}
              >
                <span className="demo-live-toggle__pulse" aria-hidden />
                {liveNav ? 'Live navigation on' : 'Live navigation off'}
              </button>
              <span className="demo-hint">
                {recalculating
                  ? 'Recalculating route from your position…'
                  : liveNav
                    ? liveWatching && liveFix
                      ? liveProgress?.offRoute
                        ? 'Off the planned path — finding a better route…'
                        : `Tracking you · ±${Math.round(liveFix.accuracy)} m · ETA updates as you move`
                      : liveGpsError
                        ? liveGpsError
                        : 'Waiting for GPS… allow location on this device'
                    : 'Turn on for Google Maps–style follow, ETA, and auto-reroute. Next stays optional.'}
              </span>
            </div>
            <div className="demo-steps">
              <button type="button" disabled={journeyIndex <= 0} onClick={() => bumpJourney(-1)}>
                Previous
              </button>
              <span>
                Step {journeyIndex + 1} / {steps.length}
                {active ? ` · ${phaseLabel(active.phase)}` : ''}
                {liveNav ? ' · auto' : ''}
              </span>
              <button
                type="button"
                disabled={journeyIndex >= steps.length - 1}
                onClick={() => bumpJourney(1)}
              >
                Next
              </button>
            </div>
            <p className="demo-hint demo-hint--tight">
              Next / Previous are optional — use them to preview steps. Live navigation advances as you
              walk or drive.
            </p>
            {active ? (
              <div className={`demo-step-card is-${active.phase === 'outdoor' ? 'drive' : active.phase}${liveNav && liveFix ? ' is-live-nav' : ''}`}>
                <div className="demo-voice">
                  <strong>{active.title ?? `Step ${journeyIndex + 1}`}</strong>
                  {voice.supported ? (
                    <div>
                      <button type="button" aria-pressed={voice.on} onClick={voice.toggle}>
                        {voice.on ? 'Voice on' : 'Voice off'}
                      </button>
                      <button type="button" onClick={voice.replay} disabled={!voice.on}>
                        Hear again
                      </button>
                    </div>
                  ) : (
                    <span className="demo-hint">Voice not supported in this browser</span>
                  )}
                </div>
                {voice.supported && voice.on && !voice.unlocked ? (
                  <p className="demo-hint demo-hint--voice">
                    On phones, tap <strong>Voice on</strong> or <strong>Hear again</strong> once to allow spoken
                    directions (browser audio lock).
                  </p>
                ) : null}
                <p>{active.instruction}</p>
                <p className="demo-hint">
                  {active.phase === 'drive' || active.phase === 'outdoor' ? (
                    <>
                      {active.roadName ? `${active.roadName} · ` : ''}
                      {active.distanceM ?? 0} m · {active.durationSec ?? 0}s · traffic{' '}
                      <strong>{active.trafficLevel}</strong>
                      {active.speedMph != null ? ` · ${active.speedMph} mph` : ''}
                    </>
                  ) : active.phase === 'walk' ? (
                    <>
                      Pedestrian · {active.distanceM ?? 0} m · {active.durationSec ?? 0}s
                      {active.roadName ? ` · ${active.roadName}` : ''}
                      {' · leave vehicle at parking'}
                    </>
                  ) : (
                    <>
                      {active.stopName} · {active.floorLabel} · {active.stopType}
                      {active.distanceM ? ` · ~${active.distanceM} m` : ''}
                    </>
                  )}
                </p>
              </div>
            ) : null}

            <ol className="demo-step-list">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={i === journeyIndex ? 'is-active' : ''}
                    onClick={() => jumpJourney(i)}
                  >
                    <span className="demo-step-list__n">{i + 1}</span>
                    <span>
                      <em className={`phase-tag phase-tag--${s.phase === 'outdoor' ? 'drive' : s.phase}`}>
                        {phaseLabel(s.phase)}
                      </em>{' '}
                      {s.instruction}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {showOutdoorMap ? (
            result.parking && result.entrance ? (
              <OutdoorMap
                result={result}
                activeStep={active}
                weather={result.weather}
                traffic={result.outdoor.traffic}
                liveFix={
                  liveNav && liveFix
                    ? liveProgress?.snapped && !liveProgress.offRoute
                      ? {
                          ...liveFix,
                          latitude: liveProgress.snapped.latitude,
                          longitude: liveProgress.snapped.longitude,
                        }
                      : liveFix
                    : null
                }
                followLive={liveNav}
              />
            ) : (
              <p className="demo-placeholder">
                Map needs the updated API (drive → parking → walk → inside). Restart{' '}
                <code>ERP_Full/server</code> and Navigate again.
              </p>
            )
          ) : (
            <div className="demo-indoor-wrap">
              <div className="demo-indoor-head">
                <p className="demo-indoor-banner">
                  {indoorView === 'floor'
                    ? 'Inside — follow the blue path on this floor'
                    : 'Inside — 3D building overview'}
                </p>
                <div className="demo-indoor-toggle" role="tablist" aria-label="Indoor map">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={indoorView === 'floor'}
                    className={indoorView === 'floor' ? 'is-active' : ''}
                    onClick={() => setIndoorView('floor')}
                  >
                    Floor map
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={indoorView === 'building'}
                    className={indoorView === 'building' ? 'is-active' : ''}
                    onClick={() => setIndoorView('building')}
                  >
                    3D building
                  </button>
                </div>
              </div>
              <div className="demo-indoor-actions">
                <button
                  type="button"
                  className="demo-indoor-next"
                  disabled={journeyIndex >= steps.length - 1}
                  onClick={() => bumpJourney(1)}
                >
                  {journeyIndex >= steps.length - 1 ? 'Arrived' : 'Next indoor step'}
                </button>
                <span className="demo-hint">
                  Path uses corridors, elevators/stairs, and turn-by-turn cues.
                </span>
              </div>
              {indoorView === 'floor' ? (
                <IndoorFloorMap map3d={result.map3d} activeStep={indoorStep} instruction={active?.instruction} />
              ) : (
                <Indoor3D map3d={result.map3d} activeStep={indoorStep} instruction={active?.instruction} />
              )}
            </div>
          )}
        </>
      ) : (
        <p className="demo-placeholder">
          Select Complex → Building → Floor → Unit, then press Navigate. Demo Mode is already the start.
        </p>
      )}
    </div>
  )
}
