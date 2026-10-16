import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hourInTimeZone, zonedDateTimeToUtc, zonedParts } from '../time/clock'
import { useLocationClock } from '../time/LocationClockProvider'

export type ThemeMode = 'light' | 'dark'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

/** Location clock. Light through the daytime window, dark overnight. */
const DAY_START_HOUR = 6
const NIGHT_START_HOUR = 18

const OVERRIDE_KEY = 'keiros-erp-theme-override'
const LEGACY_KEY = 'keiros-erp-theme'

type ThemeOverride = {
  theme: ThemeMode
  until: number
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function themeForTime(date = new Date(), timeZone?: string): ThemeMode {
  const hour = timeZone ? hourInTimeZone(date, timeZone) : date.getHours()
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'light' : 'dark'
}

export function nextThemeBoundary(date = new Date(), timeZone?: string): Date {
  if (!timeZone) {
    const next = new Date(date)
    const hour = date.getHours()
    next.setMinutes(0, 0, 0)
    if (hour < DAY_START_HOUR) {
      next.setHours(DAY_START_HOUR)
    } else if (hour < NIGHT_START_HOUR) {
      next.setHours(NIGHT_START_HOUR)
    } else {
      next.setDate(next.getDate() + 1)
      next.setHours(DAY_START_HOUR)
    }
    return next
  }

  const parts = zonedParts(date, timeZone)
  let year = parts.year
  let month = parts.month
  let day = parts.day
  let boundaryHour: number
  if (parts.hour < DAY_START_HOUR) {
    boundaryHour = DAY_START_HOUR
  } else if (parts.hour < NIGHT_START_HOUR) {
    boundaryHour = NIGHT_START_HOUR
  } else {
    boundaryHour = DAY_START_HOUR
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1))
    year = nextDay.getUTCFullYear()
    month = nextDay.getUTCMonth() + 1
    day = nextDay.getUTCDate()
  }
  const boundary = zonedDateTimeToUtc(year, month, day, boundaryHour, 0, timeZone)
  if (boundary.getTime() <= date.getTime()) return new Date(date.getTime() + 60 * 60 * 1000)
  return boundary
}

function readOverride(now = Date.now(), timeZone?: string): ThemeMode | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ThemeOverride>
    if (parsed.theme !== 'light' && parsed.theme !== 'dark') return null
    if (typeof parsed.until !== 'number' || parsed.until <= now) return null
    if (parsed.theme === themeForTime(new Date(now), timeZone)) return null
    return parsed.theme
  } catch {
    return null
  }
}

function writeOverride(theme: ThemeMode, timeZone?: string) {
  try {
    if (theme === themeForTime(new Date(), timeZone)) {
      localStorage.removeItem(OVERRIDE_KEY)
      return
    }
    const payload: ThemeOverride = { theme, until: nextThemeBoundary(new Date(), timeZone).getTime() }
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function clearOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY)
  } catch {
    /* ignore */
  }
}

function resolveTheme(timeZone?: string): ThemeMode {
  return readOverride(Date.now(), timeZone) ?? themeForTime(new Date(), timeZone)
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { timeZone } = useLocationClock()
  const zoneRef = useRef(timeZone)
  zoneRef.current = timeZone
  const seenZone = useRef<string | null>(null)

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof document === 'undefined') return 'light'
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      /* ignore */
    }
    const initial = resolveTheme(timeZone)
    applyTheme(initial)
    return initial
  })

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (seenZone.current === null) {
      seenZone.current = timeZone
      return
    }
    if (seenZone.current === timeZone) return
    seenZone.current = timeZone
    clearOverride()
    setThemeState(themeForTime(new Date(), timeZone))
  }, [timeZone])

  useEffect(() => {
    let timer = 0

    const syncToClock = () => {
      const override = readOverride(Date.now(), timeZone)
      setThemeState(override ?? themeForTime(new Date(), timeZone))
      if (!override) clearOverride()
    }

    const arm = () => {
      window.clearTimeout(timer)
      const delay = Math.max(1000, nextThemeBoundary(new Date(), timeZone).getTime() - Date.now())
      timer = window.setTimeout(() => {
        clearOverride()
        setThemeState(themeForTime(new Date(), timeZone))
        arm()
      }, delay)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        syncToClock()
        arm()
      }
    }

    arm()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [timeZone])

  const setTheme = useCallback((next: ThemeMode) => {
    writeOverride(next, zoneRef.current)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'light' ? 'dark' : 'light'
      writeOverride(next, zoneRef.current)
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}
