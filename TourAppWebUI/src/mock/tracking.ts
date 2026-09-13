import { getApiKey, postDwellEvent, type DwellTrackPayload } from '../api/client'

export type TrackingEvent = {
  id: string
  at: string
  kind: 'location' | 'step' | 'dwell' | 'destination'
  label: string
  latitude?: number
  longitude?: number
  dwellSec?: number
  synced?: boolean
}

type ZoneContext = {
  locationId: string
  zone: string
  propertyId?: string | null
  propertyName?: string | null
  latitude?: number
  longitude?: number
}

let events: TrackingEvent[] = []
let sessionId = ''
let currentZone: ZoneContext | null = null
let zoneStartedAt = 0
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let lastPostedSec = -1
let syncEnabled = false

const HEARTBEAT_MS = 5000

export function startTrackingSession(id: string) {
  stopDwellHeartbeat()
  sessionId = id
  currentZone = null
  zoneStartedAt = 0
  lastPostedSec = -1
  events = [
    {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      kind: 'location',
      label: 'Tour tracking started',
    },
  ]
}

export function setTrackingSyncEnabled(on: boolean) {
  syncEnabled = on
  if (!on) stopDwellHeartbeat()
}

export function recordTrackingEvent(partial: Omit<TrackingEvent, 'id' | 'at'>) {
  if (!sessionId) return
  events = [
    ...events,
    {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      ...partial,
    },
  ]
}

export function getTrackingEvents() {
  return events
}

export function getTrackingSessionId() {
  return sessionId
}

export function getLiveDwellSec() {
  if (!currentZone || !zoneStartedAt) return 0
  return Math.max(0, Math.floor((Date.now() - zoneStartedAt) / 1000))
}

export function getCurrentDwellZone() {
  return currentZone
}

async function push(event: DwellTrackPayload['event'], dwellSec: number, force = false) {
  // enter/heartbeat need sync on; leave/complete always finalize so ERP clears live visitors
  if ((!syncEnabled && !force) || !sessionId || !currentZone) return null
  try {
    const result = await postDwellEvent(getApiKey(), {
      sessionId,
      locationId: currentZone.locationId,
      zone: currentZone.zone,
      dwellSec,
      event,
      propertyId: currentZone.propertyId,
      propertyName: currentZone.propertyName,
      latitude: currentZone.latitude,
      longitude: currentZone.longitude,
      unitId: currentZone.locationId,
    })
    lastPostedSec = dwellSec
    recordTrackingEvent({
      kind: 'dwell',
      label: `${event}: ${currentZone.zone}`,
      dwellSec,
      latitude: currentZone.latitude,
      longitude: currentZone.longitude,
      synced: true,
    })
    return result
  } catch (err) {
    recordTrackingEvent({
      kind: 'dwell',
      label: `sync failed: ${err instanceof Error ? err.message : 'error'}`,
      dwellSec,
      synced: false,
    })
    return null
  }
}

function stopDwellHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function startDwellHeartbeat() {
  stopDwellHeartbeat()
  heartbeatTimer = setInterval(() => {
    const sec = getLiveDwellSec()
    if (sec <= 0 || sec === lastPostedSec) return
    void push('heartbeat', sec)
  }, HEARTBEAT_MS)
}

/** Enter a zone and begin realtime dwell heartbeats to ERP. */
export async function enterDwellZone(zone: ZoneContext) {
  if (!sessionId) return
  if (currentZone?.locationId === zone.locationId) return

  if (currentZone) {
    await leaveDwellZone()
  }

  currentZone = zone
  zoneStartedAt = Date.now()
  lastPostedSec = -1
  await push('enter', 0)
  startDwellHeartbeat()
}

/** Leave current zone and finalize dwell visit in ERP. */
export async function leaveDwellZone() {
  if (!currentZone) return
  const sec = getLiveDwellSec()
  stopDwellHeartbeat()
  await push('leave', sec, true)
  currentZone = null
  zoneStartedAt = 0
  lastPostedSec = -1
}

export async function completeDwellTracking() {
  if (currentZone) {
    const sec = getLiveDwellSec()
    stopDwellHeartbeat()
    await push('complete', sec, true)
    currentZone = null
    zoneStartedAt = 0
  } else {
    stopDwellHeartbeat()
  }
}

/** @deprecated local-only helper — prefer enterDwellZone */
export function simulateDwell(label: string, dwellSec: number) {
  recordTrackingEvent({ kind: 'dwell', label, dwellSec })
}
