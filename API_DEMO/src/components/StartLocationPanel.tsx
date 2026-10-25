import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  formatCoords,
  formatDistance,
  milesBetween,
  parseDecimalPair,
  parseLatLng,
  reversePlace,
  searchPlaces,
  type PlaceHit,
  type StartPoint,
} from '../startLocation'
import { StartPickerMap, type MapFocus, type StartPickerMapHandle } from './StartPickerMap'

type Props = {
  initial: StartPoint | null
  unit: MapFocus | null
  busy: boolean
  onUse: (point: StartPoint) => void
  onClose: () => void
}

export function StartLocationPanel({ initial, unit, busy, onUse, onClose }: Props) {
  const mapRef = useRef<StartPickerMapHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const chosenQuery = useRef<string | null>(null)
  const reverseRef = useRef<AbortController | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [highlight, setHighlight] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(
    initial ? { latitude: initial.latitude, longitude: initial.longitude } : null,
  )
  const [label, setLabel] = useState(initial?.label ?? '')
  const [resolving, setResolving] = useState(false)
  const [latText, setLatText] = useState(initial ? initial.latitude.toFixed(6) : '')
  const [lngText, setLngText] = useState(initial ? initial.longitude.toFixed(6) : '')
  const [coordError, setCoordError] = useState('')

  useEffect(() => {
    searchRef.current?.focus()
    return () => reverseRef.current?.abort()
  }, [])

  useEffect(() => {
    if (chosenQuery.current === query) return
    const q = query.trim()
    if (q.length < 3) {
      setHits([])
      setSearching(false)
      setSearchError('')
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      setSearchError('')
      void searchPlaces(q, ctrl.signal)
        .then((next) => {
          setHits(next)
          setHighlight(0)
          if (!next.length) setSearchError('No matching places.')
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setHits([])
          setSearchError(err instanceof Error ? err.message : 'Place search failed.')
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, 320)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  function remember(next: { latitude: number; longitude: number }, nextLabel?: string) {
    setPoint(next)
    setLatText(next.latitude.toFixed(6))
    setLngText(next.longitude.toFixed(6))
    setCoordError('')
    if (nextLabel) setLabel(nextLabel)
  }

  function resolve(next: { latitude: number; longitude: number }) {
    reverseRef.current?.abort()
    const ctrl = new AbortController()
    reverseRef.current = ctrl
    setResolving(true)
    void reversePlace(next.latitude, next.longitude, ctrl.signal)
      .then((place) => {
        if (!ctrl.signal.aborted) setLabel(place)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!ctrl.signal.aborted) setLabel(formatCoords(next.latitude, next.longitude))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setResolving(false)
      })
  }

  function chooseHit(hit: PlaceHit) {
    chosenQuery.current = hit.label
    setQuery(hit.label)
    setHits([])
    setHighlight(0)
    setSearchError('')
    remember(hit, hit.label)
  }

  function commitCoords() {
    if (!latText.trim() && !lngText.trim()) {
      setCoordError('')
      return
    }
    const parsed = parseDecimalPair(latText, lngText)
    if (!parsed) {
      setCoordError('Latitude must be -90 to 90 and longitude -180 to 180.')
      return
    }
    remember(parsed)
    resolve(parsed)
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((index) => Math.min(hits.length - 1, index + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((index) => Math.max(0, index - 1))
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const direct = parseLatLng(query)
    if (direct) {
      const place = formatCoords(direct.latitude, direct.longitude)
      chooseHit({ id: 'coords', label: place, ...direct })
      resolve(direct)
      return
    }
    const hit = hits[highlight] ?? hits[0]
    if (hit) chooseHit(hit)
  }

  function usePoint() {
    const parsed = parseDecimalPair(latText, lngText)
    if ((latText.trim() || lngText.trim()) && !parsed) {
      setCoordError('Latitude must be -90 to 90 and longitude -180 to 180.')
      return
    }
    const chosen = parsed ?? point
    if (!chosen) return
    onUse({
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      label: label.trim() || formatCoords(chosen.latitude, chosen.longitude),
    })
  }

  const distance =
    point && unit ? formatDistance(milesBetween(point, unit)) : null

  return (
    <div className="demo-start__panel">
      <div className="demo-start__fields">
        <label>
          Place or coordinates
          <div className="demo-start__search">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                chosenQuery.current = null
                setQuery(event.target.value)
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Search, or paste 32.71570, -117.16110"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="start-place-hits"
              aria-autocomplete="list"
            />
            {hits.length ? (
              <ul className="demo-start__hits" id="start-place-hits" role="listbox">
                {hits.map((hit, index) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      className={index === highlight ? 'is-active' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => chooseHit(hit)}
                    >
                      {hit.label}
                      {hit.detail && hit.detail !== hit.label ? <small>{hit.detail}</small> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </label>
        <p className="demo-hint">
          {searching ? 'Searching…' : searchError || 'Arrow keys move through results. Enter selects one.'}
        </p>
        <div className="demo-start__coords">
          <label>
            Latitude
            <input
              inputMode="decimal"
              value={latText}
              onChange={(event) => setLatText(event.target.value)}
              onBlur={commitCoords}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitCoords()
                }
              }}
              placeholder="32.715700"
              spellCheck={false}
            />
          </label>
          <label>
            Longitude
            <input
              inputMode="decimal"
              value={lngText}
              onChange={(event) => setLngText(event.target.value)}
              onBlur={commitCoords}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitCoords()
                }
              }}
              placeholder="-117.161100"
              spellCheck={false}
            />
          </label>
        </div>
        {coordError ? <p className="demo-error">{coordError}</p> : null}
        <p className="demo-start__readout" aria-live="polite">
          {point ? (
            <>
              <strong>{resolving ? 'Finding place…' : label || 'Pinned start'}</strong>
              <br />
              {formatCoords(point.latitude, point.longitude)}
              {distance && unit ? ` · ${distance} straight-line from ${unit.label}` : ''}
            </>
          ) : unit ? (
            `Map is centered on ${unit.label}. Click where the drive should start.`
          ) : (
            'Search, paste coordinates, or click the map to drop the start pin.'
          )}
        </p>
        <div className="demo-start__actions">
          <button type="button" disabled={!point || busy} onClick={usePoint}>
            Use this start
          </button>
          <button type="button" className="demo-ghost" onClick={onClose}>
            Cancel
          </button>
          {point && unit ? (
            <button type="button" className="demo-ghost" onClick={() => mapRef.current?.frame()}>
              Show start and unit
            </button>
          ) : null}
        </div>
      </div>
      <StartPickerMap
        ref={mapRef}
        latitude={point?.latitude ?? null}
        longitude={point?.longitude ?? null}
        focus={unit}
        onPick={(latitude, longitude) => {
          const next = { latitude, longitude }
          remember(next)
          resolve(next)
        }}
      />
    </div>
  )
}
