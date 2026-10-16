import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CLOCK_LOCATION_KEY,
  browserTimeZone,
  formatZonedDate,
  formatZonedDateTime,
  formatZonedTime,
  sameLocations,
  type ClockLocation,
} from './clock'

type StoredClock = {
  id: string
  timeZone: string
}

type LocationClockValue = {
  locations: ClockLocation[]
  locationId: string
  location: ClockLocation | null
  timeZone: string
  now: Date
  setLocations: (locations: ClockLocation[]) => void
  setLocationId: (id: string) => void
  formatDate: (date?: Date) => string
  formatTime: (date?: Date) => string
  formatDateTime: (date?: Date) => string
}

const LocationClockContext = createContext<LocationClockValue | null>(null)

function readStored(): StoredClock | null {
  try {
    const raw = localStorage.getItem(CLOCK_LOCATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredClock>
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.timeZone !== 'string' || !parsed.timeZone) {
      return null
    }
    return { id: parsed.id, timeZone: parsed.timeZone }
  } catch {
    return null
  }
}

function persistLocation(location: ClockLocation) {
  try {
    const payload: StoredClock = { id: location.id, timeZone: location.timeZone }
    localStorage.setItem(CLOCK_LOCATION_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

export function LocationClockProvider({ children }: { children: ReactNode }) {
  const [locations, setLocationList] = useState<ClockLocation[]>([])
  const [locationId, setLocationIdState] = useState(() => readStored()?.id ?? '')
  const [timeZone, setTimeZone] = useState(() => readStored()?.timeZone || browserTimeZone())
  const [now, setNow] = useState(() => new Date())

  const setLocations = useCallback((next: ClockLocation[]) => {
    setLocationList((prev) => (sameLocations(prev, next) ? prev : next))
  }, [])

  useEffect(() => {
    if (!locations.length) return
    const chosen = locations.find((item) => item.id === locationId) ?? locations[0]
    if (!chosen) return
    if (chosen.id !== locationId) setLocationIdState(chosen.id)
    if (chosen.timeZone !== timeZone) setTimeZone(chosen.timeZone)
    persistLocation(chosen)
  }, [locations, locationId, timeZone])

  useEffect(() => {
    let timer = 0
    const arm = () => {
      const delay = Math.max(250, 60_000 - (Date.now() % 60_000) + 20)
      timer = window.setTimeout(() => {
        setNow(new Date())
        arm()
      }, delay)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    arm()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const setLocationId = useCallback(
    (id: string) => {
      const chosen = locations.find((item) => item.id === id)
      if (!chosen) return
      setLocationIdState(chosen.id)
      setTimeZone(chosen.timeZone)
      persistLocation(chosen)
    },
    [locations],
  )

  const location = locations.find((item) => item.id === locationId) ?? null

  const formatDate = useCallback((date = new Date()) => formatZonedDate(date, timeZone), [timeZone])
  const formatTime = useCallback((date = new Date()) => formatZonedTime(date, timeZone), [timeZone])
  const formatDateTime = useCallback((date = new Date()) => formatZonedDateTime(date, timeZone), [timeZone])

  const value = useMemo(
    () => ({
      locations,
      locationId,
      location,
      timeZone,
      now,
      setLocations,
      setLocationId,
      formatDate,
      formatTime,
      formatDateTime,
    }),
    [locations, locationId, location, timeZone, now, setLocations, setLocationId, formatDate, formatTime, formatDateTime],
  )

  return <LocationClockContext.Provider value={value}>{children}</LocationClockContext.Provider>
}

export function useLocationClock() {
  const ctx = useContext(LocationClockContext)
  if (!ctx) {
    throw new Error('useLocationClock must be used within LocationClockProvider')
  }
  return ctx
}
