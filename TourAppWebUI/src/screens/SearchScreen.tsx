import { useMemo, useState } from 'react'
import { BackChip, ErrorBanner, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { photoForType } from '../media/photos'
import { estimateTourMinutes, groupStopsByFloor } from '../tour/curatedTour'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unit', label: 'Homes' },
  { id: 'gym', label: 'Gym' },
  { id: 'pool', label: 'Pool' },
  { id: 'club', label: 'Club' },
  { id: 'park', label: 'Parking' },
] as const

function matchesFilter(type: string, name: string, filter: string) {
  if (filter === 'all') return true
  const hay = `${type} ${name}`.toLowerCase()
  if (filter === 'unit') return hay.includes('unit') || hay.includes('apt') || hay.includes('apartment') || hay.includes('suite')
  return hay.includes(filter)
}

export function SearchScreen() {
  const {
    goBack,
    hierarchy,
    hierarchyError,
    reloadHierarchy,
    destination,
    setDestination,
    runNavigate,
    navigateLoading,
    navigateError,
    selectedComplexId,
    tourMode,
    tourStops,
    currentStopIndex,
    visitedStopIds,
    selectTourStop,
  } = useTour()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useState<'tour' | 'browse'>(tourMode === 'browse' ? 'browse' : 'tour')

  const results = useMemo(() => {
    if (!hierarchy) return []
    const qq = q.trim().toLowerCase()
    return hierarchy.units
      .filter((u) => !selectedComplexId || u.complexId === selectedComplexId)
      .filter((u) => matchesFilter(u.type, u.name, filter))
      .filter(
        (u) =>
          !qq ||
          u.name.toLowerCase().includes(qq) ||
          u.type.toLowerCase().includes(qq) ||
          u.buildingName.toLowerCase().includes(qq),
      )
      .slice(0, 24)
  }, [hierarchy, q, filter, selectedComplexId])

  const floorGroups = useMemo(() => groupStopsByFloor(tourStops), [tourStops])
  const currentStop = tourStops[currentStopIndex]
  const mins = estimateTourMinutes(tourStops.length || 5)

  return (
    <section className="screen screen--scroll">
      <div className="screen-pad search-pad">
        <div className="screen-top static">
          <BackChip onClick={goBack} />
        </div>

        {tourStops.length > 0 && (
          <div className="tour-tabs">
            <button
              type="button"
              className={tab === 'tour' ? 'active' : ''}
              onClick={() => setTab('tour')}
            >
              My tour
            </button>
            <button
              type="button"
              className={tab === 'browse' ? 'active' : ''}
              onClick={() => setTab('browse')}
            >
              Explore map
            </button>
          </div>
        )}

        {tab === 'tour' && tourStops.length > 0 ? (
          <>
            <p className="splash-eyebrow">Self-guided · ~{mins} min</p>
            <h1 className="page-title">Floor by floor</h1>
            <p className="muted tour-lede">
              Start on the lowest floor, visit every unit there, then move up one floor at a time.
              You can end the tour anytime once you’re inside.
            </p>
            {hierarchyError && (
              <ErrorBanner message={hierarchyError} onRetry={() => void reloadHierarchy()} />
            )}
            <div className="tour-floor-groups">
              {floorGroups.map((group, gIndex) => (
                <section key={group.floorId} className="tour-floor-group">
                  <header className="tour-floor-group__head">
                    <em>Floor {gIndex + 1}</em>
                    <strong>{group.floorLabel}</strong>
                    <span>{group.stops.length} stops</span>
                  </header>
                  <ol className="tour-stop-list">
                    {group.stops.map((stop) => {
                      const index = tourStops.findIndex((s) => s.id === stop.id)
                      const visited = visitedStopIds.includes(stop.id)
                      const current = index === currentStopIndex
                      return (
                        <li key={stop.id}>
                          <button
                            type="button"
                            className={`tour-stop-card ${current ? 'is-current' : ''} ${visited ? 'is-visited' : ''}`}
                            onClick={() => {
                              selectTourStop(index)
                              setDestination(stop.unit)
                            }}
                          >
                            <div
                              className="dest-thumb"
                              style={{ backgroundImage: `url(${photoForType(stop.unit.type, stop.unit.name)})` }}
                            />
                            <div className="dest-copy">
                              <em>
                                {stop.role === 'entry'
                                  ? 'Enter here'
                                  : `Stop ${stop.order}`}
                                {visited ? ' · Seen' : current ? ' · Up next' : ''}
                              </em>
                              <strong>{stop.title}</strong>
                              <span>{stop.blurb}</span>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </section>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="splash-eyebrow">Explore</p>
            <h1 className="page-title">Places to see</h1>
            <p className="muted tour-lede">Pick anything on the property — we’ll take you there.</p>
            {hierarchyError && (
              <ErrorBanner message={hierarchyError} onRetry={() => void reloadHierarchy()} />
            )}
            <label className="search-bar">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search homes or amenities"
                autoFocus={tab === 'browse'}
              />
            </label>
            <div className="chip-row scroll">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`chip ${filter === f.id ? 'active' : ''}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="dest-cards">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`dest-card ${destination?.id === u.id ? 'selected' : ''}`}
                  onClick={() => setDestination(u)}
                >
                  <div
                    className="dest-thumb"
                    style={{ backgroundImage: `url(${photoForType(u.type, u.name)})` }}
                  />
                  <div className="dest-copy">
                    <strong>{u.name}</strong>
                    <span>
                      {u.buildingName} · {u.floorLabel}
                    </span>
                  </div>
                </button>
              ))}
              {results.length === 0 && <p className="empty-hint">No matches — try another filter.</p>}
            </div>
          </>
        )}

        {navigateError && <p className="field-error">{navigateError}</p>}
      </div>
      <div className="bottom-cta-safe">
        <PrimaryButton onClick={() => void runNavigate()} disabled={!destination || navigateLoading}>
          {navigateLoading
            ? 'Getting directions…'
            : tab === 'tour' && currentStop
              ? `Head to ${currentStop.title}`
              : destination
                ? `Head to ${destination.name}`
                : 'Choose a stop'}
        </PrimaryButton>
      </div>
    </section>
  )
}
