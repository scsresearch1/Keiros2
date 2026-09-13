import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  fetchHealth,
  fetchHierarchy,
  navigate,
  refreshConditions,
  phaseLabel,
  type Hierarchy,
  type NavigateResult,
} from './api'
import { OutdoorMap } from './components/OutdoorMap'
import { Indoor3D } from './components/Indoor3D'

const DEMO_KEY = 'keiros_live_ot_demo_map_nav_2026'
const KEY_STORAGE = 'keiros_api_demo_key'

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

  async function runNavigate(e: FormEvent) {
    e.preventDefault()
    if (!apiKey || !complexId || !buildingId || !floorId || !unitId) {
      setError('Select complex, building, floor, and unit first.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const nav = await navigate(apiKey, {
        complexId,
        buildingId,
        floorId,
        unitId,
      })
      setResult(nav)
      setJourneyIndex(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Navigate failed')
    } finally {
      setLoading(false)
    }
  }

  async function onRefreshConditions() {
    if (!apiKey || !result) return
    setRefreshing(true)
    setError('')
    try {
      const live = await refreshConditions(
        apiKey,
        result.destination.latitude,
        result.destination.longitude,
        result.origin.offsetMiles,
      )
      setResult((prev) =>
        prev
          ? {
              ...prev,
              weather: live.weather,
              outdoor: {
                ...prev.outdoor,
                traffic: live.outdoor.traffic,
                provider: live.outdoor.provider || prev.outdoor.provider,
                steps: live.outdoor.steps ?? prev.outdoor.steps,
              },
            }
          : prev,
      )
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
  }

  if (!apiKey || !hierarchy) {
    return (
      <div className="demo-shell demo-shell--gate">
        <div className="demo-gate">
          <p className="demo-brand">Keiros</p>
          <h1>Map Navigation API Demo</h1>
          <p className="demo-lede">
            Client-only app. Enter an ERP API key, pick Complex → Building → Floor → Unit, then call the
            navigation API. Activity appears live in ERP under API Logs & API Navigation Live.
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
        <label>
          Complex
          <select
            value={complexId}
            onChange={(e) => {
              setComplexId(e.target.value)
              setBuildingId('')
              setFloorId('')
              setUnitId('')
              setResult(null)
            }}
          >
            <option value="">Select</option>
            {hierarchy.complexes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Building
          <select
            value={buildingId}
            disabled={!complexId}
            onChange={(e) => {
              setBuildingId(e.target.value)
              setFloorId('')
              setUnitId('')
              setResult(null)
            }}
          >
            <option value="">Select</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Floor
          <select
            value={floorId}
            disabled={!buildingId}
            onChange={(e) => {
              setFloorId(e.target.value)
              setUnitId('')
              setResult(null)
            }}
          >
            <option value="">Select</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} (L{f.level})
              </option>
            ))}
          </select>
        </label>
        <label>
          Unit
          <select
            value={unitId}
            disabled={!floorId}
            onChange={(e) => {
              setUnitId(e.target.value)
              setResult(null)
            }}
          >
            <option value="">Select</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.type}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading || !canNavigate}>
          {loading ? 'Calling API…' : 'Navigate'}
        </button>
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
            <span className={phase === 'drive' ? 'is-active phase-drive' : 'phase-drive'}>1 · Drive to parking</span>
            <span className={phase === 'walk' ? 'is-active phase-walk' : 'phase-walk'}>2 · Walk to entrance</span>
            <span className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}>3 · Inside building</span>
          </div>

          <div className="demo-journey">
            <div className="demo-steps">
              <button
                type="button"
                disabled={journeyIndex <= 0}
                onClick={() => setJourneyIndex((i) => Math.max(0, i - 1))}
              >
                Previous
              </button>
              <span>
                Step {journeyIndex + 1} / {steps.length}
                {active ? ` · ${phaseLabel(active.phase)}` : ''}
              </span>
              <button
                type="button"
                disabled={journeyIndex >= steps.length - 1}
                onClick={() => setJourneyIndex((i) => Math.min(steps.length - 1, i + 1))}
              >
                Next
              </button>
            </div>
            {active ? (
              <div className={`demo-step-card is-${active.phase === 'outdoor' ? 'drive' : active.phase}`}>
                <strong>{active.title ?? `Step ${journeyIndex + 1}`}</strong>
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
                    onClick={() => setJourneyIndex(i)}
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
              />
            ) : (
              <p className="demo-placeholder">
                Map needs the updated API (drive → parking → walk → inside). Restart{' '}
                <code>ERP_Full/server</code> and Navigate again.
              </p>
            )
          ) : (
            <div className="demo-indoor-wrap">
              <p className="demo-indoor-banner">Inside building — 3D floor navigation to the unit</p>
              <Indoor3D map3d={result.map3d} activeStep={indoorStep} />
            </div>
          )}
        </>
      ) : (
        <p className="demo-placeholder">
          Choose Complex → Building → Floor → Unit (each starts at Select), then press Navigate.
        </p>
      )}
    </div>
  )
}
