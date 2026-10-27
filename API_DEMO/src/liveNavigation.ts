import { useEffect, useRef, useState } from 'react'
import type { JourneyStep } from './api'

export type LiveFix = {
  latitude: number
  longitude: number
  accuracy: number
  heading: number | null
  speed: number | null
  timestamp: number
}

export type LiveProgress = {
  stepIndex: number
  distanceToRouteM: number
  remainingM: number
  remainingSec: number
  toNextManeuverM: number
  snapped: { latitude: number; longitude: number } | null
  offRoute: boolean
}

const EARTH_M = 6371000
/** Google-like: leave the planned polyline by this much → off route */
export const OFF_ROUTE_M = 55

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Bearing in degrees [0, 360) from A → B. */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const φ1 = toRad(aLat)
  const φ2 = toRad(bLat)
  const Δλ = toRad(bLng - aLng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

type RoutePoint = { lat: number; lng: number; stepIndex: number }

function flattenRoute(steps: JourneyStep[]): RoutePoint[] {
  const points: RoutePoint[] = []
  steps.forEach((step, stepIndex) => {
    if (step.phase === 'indoor') return
    const geom = step.geometry
    if (geom && geom.length) {
      for (const [lng, lat] of geom) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          points.push({ lat, lng, stepIndex })
        }
      }
      return
    }
    if (Number.isFinite(step.latitude) && Number.isFinite(step.longitude)) {
      points.push({ lat: step.latitude, lng: step.longitude, stepIndex })
    }
  })
  return points
}

function projectOnSegment(
  lat: number,
  lng: number,
  a: RoutePoint,
  b: RoutePoint,
): { lat: number; lng: number; t: number; distM: number } {
  const ax = a.lng
  const ay = a.lat
  const bx = b.lng
  const by = b.lat
  const abx = bx - ax
  const aby = by - ay
  const len2 = abx * abx + aby * aby
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((lng - ax) * abx + (lat - ay) * aby) / len2)) : 0
  const snapLng = ax + abx * t
  const snapLat = ay + aby * t
  return {
    lat: snapLat,
    lng: snapLng,
    t,
    distM: haversineM(lat, lng, snapLat, snapLng),
  }
}

/**
 * Snap GPS to the planned route and return progress like Google Maps guidance.
 */
export function matchLiveProgress(
  steps: JourneyStep[],
  fix: LiveFix,
  currentIndex: number,
): LiveProgress {
  const outdoor = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.phase !== 'indoor')
  if (!outdoor.length) {
    return {
      stepIndex: currentIndex,
      distanceToRouteM: Infinity,
      remainingM: 0,
      remainingSec: 0,
      toNextManeuverM: 0,
      snapped: null,
      offRoute: false,
    }
  }

  const points = flattenRoute(steps)
  if (points.length < 2) {
    const target = outdoor[outdoor.length - 1].s
    const rem = haversineM(fix.latitude, fix.longitude, target.latitude, target.longitude)
    return {
      stepIndex: outdoor[0].i,
      distanceToRouteM: rem,
      remainingM: rem,
      remainingSec: estimateSec(rem, fix.speed, outdoor[0].s.phase),
      toNextManeuverM: rem,
      snapped: { latitude: fix.latitude, longitude: fix.longitude },
      offRoute: rem > OFF_ROUTE_M,
    }
  }

  let best = {
    distM: Infinity,
    lat: points[0].lat,
    lng: points[0].lng,
    seg: 0,
    stepIndex: points[0].stepIndex,
  }
  for (let i = 0; i < points.length - 1; i++) {
    const proj = projectOnSegment(fix.latitude, fix.longitude, points[i], points[i + 1])
    if (proj.distM < best.distM) {
      best = {
        distM: proj.distM,
        lat: proj.lat,
        lng: proj.lng,
        seg: i,
        stepIndex: points[i].stepIndex,
      }
    }
  }

  let remaining = haversineM(best.lat, best.lng, points[best.seg + 1].lat, points[best.seg + 1].lng)
  for (let i = best.seg + 1; i < points.length - 1; i++) {
    remaining += haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
  }

  let stepIndex = best.stepIndex
  const next = currentIndex + 1
  if (next < steps.length && steps[next].phase !== 'indoor') {
    const n = steps[next]
    const toNext = haversineM(fix.latitude, fix.longitude, n.latitude, n.longitude)
    if (toNext < 45) stepIndex = Math.max(stepIndex, next)
  }
  if (stepIndex < currentIndex && best.distM < 80) {
    stepIndex = currentIndex
  }

  const active = steps[stepIndex]
  let toNextManeuverM = active?.distanceM ?? 0
  if (active?.geometry && active.geometry.length > 1) {
    // Distance along this step from snapped point to step end
    const end = active.geometry[active.geometry.length - 1]
    toNextManeuverM = haversineM(best.lat, best.lng, end[1], end[0])
  } else if (active) {
    toNextManeuverM = haversineM(best.lat, best.lng, active.latitude, active.longitude)
  }

  const phase = active?.phase ?? 'drive'
  return {
    stepIndex,
    distanceToRouteM: best.distM,
    remainingM: remaining,
    remainingSec: estimateSec(remaining, fix.speed, phase),
    toNextManeuverM,
    snapped: { latitude: best.lat, longitude: best.lng },
    offRoute: best.distM > OFF_ROUTE_M,
  }
}

/** @deprecated use matchLiveProgress */
export function matchLiveStep(
  steps: JourneyStep[],
  fix: LiveFix,
  currentIndex: number,
): { stepIndex: number; distanceToRouteM: number; remainingM: number } {
  const p = matchLiveProgress(steps, fix, currentIndex)
  return {
    stepIndex: p.stepIndex,
    distanceToRouteM: p.distanceToRouteM,
    remainingM: p.remainingM,
  }
}

function estimateSec(remainingM: number, speedMs: number | null, phase: string) {
  if (speedMs != null && speedMs > 0.8) return Math.round(remainingM / speedMs)
  const walk = phase === 'walk'
  return Math.round(remainingM / (walk ? 1.35 : 11))
}

export function formatDistanceM(meters: number) {
  if (!Number.isFinite(meters) || meters < 0) return '—'
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`
  const km = meters / 1000
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatEta(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 60) return '< 1 min'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

export function maneuverIcon(instruction: string, phase?: string) {
  const t = instruction.toLowerCase()
  if (phase === 'walk' || /walk|pedestrian|leave the car|entrance/i.test(t)) return 'walk'
  if (/u-?turn|uturn/i.test(t)) return 'uturn'
  if (/sharp right|turn right|bear right|right onto/i.test(t)) return 'right'
  if (/sharp left|turn left|bear left|left onto/i.test(t)) return 'left'
  if (/roundabout|rotary/i.test(t)) return 'roundabout'
  if (/arrive|park|reached/i.test(t)) return 'arrive'
  if (/head|start|depart|continue|straight/i.test(t)) return 'straight'
  return 'straight'
}

export function useGeolocationWatch(enabled: boolean): {
  fix: LiveFix | null
  error: string | null
  watching: boolean
} {
  const [fix, setFix] = useState<LiveFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const lastHeading = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setWatching(false)
      return
    }
    if (!navigator.geolocation) {
      setError('This device cannot share location.')
      setWatching(false)
      return
    }

    setError(null)
    setWatching(true)
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const heading =
          typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)
            ? pos.coords.heading
            : lastHeading.current
        if (typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)) {
          lastHeading.current = pos.coords.heading
        }
        setFix({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading,
          speed: typeof pos.coords.speed === 'number' ? pos.coords.speed : null,
          timestamp: pos.timestamp,
        })
        setError(null)
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Allow location access for live navigation.'
            : 'Could not read GPS. Check location services.',
        )
        setWatching(false)
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      },
    )

    return () => {
      navigator.geolocation.clearWatch(id)
      setWatching(false)
    }
  }, [enabled])

  return { fix, error, watching }
}
