import { useMemo, useState } from 'react'
import { BackChip, ErrorBanner, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { photoForType } from '../media/photos'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unit', label: 'Unit' },
  { id: 'gym', label: 'Gym' },
  { id: 'pool', label: 'Pool' },
  { id: 'club', label: 'Club' },
  { id: 'park', label: 'Parking' },
] as const

function matchesFilter(type: string, name: string, filter: string) {
  if (filter === 'all') return true
  const hay = `${type} ${name}`.toLowerCase()
  if (filter === 'unit') return hay.includes('unit') || hay.includes('apt') || hay.includes('apartment')
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
  } = useTour()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')

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

  return (
    <section className="screen screen--scroll">
      <div className="screen-pad search-pad">
        <div className="screen-top static">
          <BackChip onClick={goBack} />
        </div>
        <h1 className="page-title">Where to?</h1>
        {hierarchyError && (
          <ErrorBanner message={hierarchyError} onRetry={() => void reloadHierarchy()} />
        )}
        <label className="search-bar">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search unit or amenity"
            autoFocus
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
                  {u.type} · {u.buildingName}
                </span>
              </div>
            </button>
          ))}
          {results.length === 0 && <p className="empty-hint">No matches</p>}
        </div>
        {navigateError && <p className="field-error">{navigateError}</p>}
      </div>
      <div className="bottom-cta-safe">
        <PrimaryButton onClick={() => void runNavigate()} disabled={!destination || navigateLoading}>
          {navigateLoading ? 'Building route…' : 'Get route'}
        </PrimaryButton>
      </div>
    </section>
  )
}
