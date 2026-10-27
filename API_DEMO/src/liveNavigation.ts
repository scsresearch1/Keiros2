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

const EARTH_M = 6371000

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

/**
 * Snap GPS to the planned route and return the journey step that should be active.
 * Prefer forward progress (never jump backwards more than one step unless far off route).
 */
export function matchLiveStep(
  steps: JourneyStep[],
  fix: LiveFix,
  currentIndex: number,
): { stepIndex: number; distanceToRouteM: number; remainingM: number } {
  const outdoor = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.phase !== 'indoor')
  if (!outdoor.length) {
    return { stepIndex: currentIndex, distanceToRouteM: Infinity, remainingM: 0 }
  }

  const points = flattenRoute(steps)
  if (!points.length) {
    let best = outdoor[0].i
    let bestD = Infinity
    for (const { s, i } of outdoor) {
      const d = haversineM(fix.latitude, fix.longitude, s.latitude, s.longitude)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return { stepIndex: best, distanceToRouteM: bestD, remainingM: bestD }
  }

  let nearestIdx = 0
  let nearestD = Infinity
  for (let i = 0; i < points.length; i++) {
    const d = haversineM(fix.latitude, fix.longitude, points[i].lat, points[i].lng)
    if (d < nearestD) {
      nearestD = d
      nearestIdx = i
    }
  }

  let remaining = 0
  for (let i = nearestIdx; i < points.length - 1; i++) {
    remaining += haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
  }

  let stepIndex = points[nearestIdx].stepIndex

  // Advance when within ~35 m of the next step's start (Google-like)
  const next = currentIndex + 1
  if (next < steps.length && steps[next].phase !== 'indoor') {
    const n = steps[next]
    const toNext = haversineM(fix.latitude, fix.longitude, n.latitude, n.longitude)
    if (toNext < 40) stepIndex = Math.max(stepIndex, next)
  }

  // Prefer not to rewind while actively navigating unless user is clearly on an earlier segment
  if (stepIndex < currentIndex && nearestD < 80) {
    stepIndex = currentIndex
  }

  return { stepIndex, distanceToRouteM: nearestD, remainingM: remaining }
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
