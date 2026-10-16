export type ClockLocation = {
  id: string
  name: string
  city: string
  timeZone: string
}

const CITY_TIME_ZONES: Record<string, string> = {
  chicago: 'America/Chicago',
  boston: 'America/New_York',
  austin: 'America/Chicago',
  denver: 'America/Denver',
  seattle: 'America/Los_Angeles',
  portland: 'America/Los_Angeles',
  miami: 'America/New_York',
  'san jose': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  hyderabad: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  pune: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
}

export const CLOCK_LOCATION_KEY = 'keiros-erp-clock-location'

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timeZoneForCity(city: string, fallback = browserTimeZone()): string {
  return CITY_TIME_ZONES[city.trim().toLowerCase()] ?? fallback
}

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')
  const hour = read('hour')
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  }
}

export function hourInTimeZone(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).hour
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return asUtc - date.getTime()
}

/** Wall-clock time in `timeZone` as a UTC instant. */
export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone)
  instant = utcGuess - timeZoneOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

export function formatZonedDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatZonedTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatZonedDateTime(date: Date, timeZone: string): string {
  return `${formatZonedDate(date, timeZone)} · ${formatZonedTime(date, timeZone)}`
}

export function formatZonedISODate(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

export function calendarYear(date: Date, timeZone: string): number {
  return zonedParts(date, timeZone).year
}

export function sameLocations(a: ClockLocation[], b: ClockLocation[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, index) => {
    const other = b[index]
    return (
      item.id === other.id &&
      item.name === other.name &&
      item.city === other.city &&
      item.timeZone === other.timeZone
    )
  })
}
