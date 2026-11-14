import { useEffect, useRef, useState } from 'react'
import type { JourneyStep } from './api'

export type LiveFix = {
  latitude: number
  longitude: number
  accuracy: number
  /** Best travel/facing direction (clockwise from north). */
  heading: number | null
  /** Where `heading` came from — OutdoorMap trusts gps/course over compass. */
  headingSource?: 'gps' | 'compass' | null
  speed: number | null
  timestamp: number
}

export type TravelMode = 'walk' | 'drive'

/**
 * Infer walk vs drive from GPS speed with hysteresis so noisy phone GPS
 * does not flip modes every tick (Google Maps–style).
 * Thresholds in m/s: walk stays until ~14 km/h; drive drops to walk under ~7 km/h.
 * `derivedSpeedMps` fills in when the OS leaves coords.speed null (common on Android).
 */
export function inferTravelMode(
  speedMps: number | null | undefined,
  prev: TravelMode | null,
  derivedSpeedMps?: number | null,
): TravelMode {
  const reported =
    speedMps != null && Number.isFinite(speedMps) ? Math.max(0, Number(speedMps)) : null
  const derived =
    derivedSpeedMps != null && Number.isFinite(derivedSpeedMps)
      ? Math.max(0, Number(derivedSpeedMps))
      : null
  // Prefer reported speed when present; otherwise use displacement-based estimate.
  const speed = reported ?? derived
  if (speed == null) return prev ?? 'walk'
  if (prev === 'drive') return speed < 2.0 ? 'walk' : 'drive'
  if (prev === 'walk') return speed > 4.0 ? 'drive' : 'walk'
  return speed >= 3.0 ? 'drive' : 'walk'
}

/** What corridor the current NavigateResult is painted as (after last successful recalculate). */
export function corridorTravelMode(result: {
  origin: { liveTravelMode?: 'walk' | 'drive' }
  outdoor?: { provider?: string; steps?: unknown[] }
  journey: { driveSteps?: number; walkSteps?: number }
}): TravelMode {
  if (result.origin.liveTravelMode === 'walk' || result.origin.liveTravelMode === 'drive') {
    return result.origin.liveTravelMode
  }
  const provider = String(result.outdoor?.provider || '')
  if (/live recalculate · walk/i.test(provider)) return 'walk'
  if (/live recalculate · drive/i.test(provider)) return 'drive'
  if ((result.journey.driveSteps ?? 0) > 0 || (result.outdoor?.steps?.length ?? 0) > 0) return 'drive'
  if ((result.journey.walkSteps ?? 0) > 0) return 'walk'
  return 'drive'
}

export type LiveProgress = {
  stepIndex: number
  distanceToRouteM: number
  remainingM: number
  remainingSec: number
  toNextManeuverM: number
  snapped: { latitude: number; longitude: number } | null
  offRoute: boolean
  /**
   * Forward bearing along the painted corridor at the snap (look-ahead).
   * This is what makes Google’s blue arrow stay on the path — use it for the puck.
   */
  routeHeadingDeg: number | null
}

const EARTH_M = 6371000
/** Drive corridor — leave the planned polyline by this much → off route (Google ~40–75 m). */
export const OFF_ROUTE_DRIVE_M = 60
/** Walk corridor — tighter than drive. */
export const OFF_ROUTE_WALK_M = 35
/** @deprecated use OFF_ROUTE_DRIVE_M */
export const OFF_ROUTE_M = OFF_ROUTE_DRIVE_M

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
    // Outdoor only — never auto-drive into indoor via GPS.
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

function arrivalRadiusM(accuracyM: number) {
  const base = 45
  return Math.max(base, Math.min(90, accuracyM * 1.15))
}

function lastOutdoorIndex(steps: JourneyStep[]) {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].phase !== 'indoor') return i
  }
  return -1
}

/** Meters left along a step polyline from the snapped GPS point to the step end. */
function remainingAlongGeometry(
  snapLat: number,
  snapLng: number,
  geometry: [number, number][],
): number {
  if (!geometry.length) return 0
  if (geometry.length === 1) {
    return haversineM(snapLat, snapLng, geometry[0][1], geometry[0][0])
  }
  let bestDist = Infinity
  let bestSeg = 0
  let bestT = 0
  let bestLat = geometry[0][1]
  let bestLng = geometry[0][0]
  for (let i = 0; i < geometry.length - 1; i += 1) {
    const a = { lat: geometry[i][1], lng: geometry[i][0], stepIndex: 0 }
    const b = { lat: geometry[i + 1][1], lng: geometry[i + 1][0], stepIndex: 0 }
    const proj = projectOnSegment(snapLat, snapLng, a, b)
    if (proj.distM < bestDist) {
      bestDist = proj.distM
      bestSeg = i
      bestT = proj.t
      bestLat = proj.lat
      bestLng = proj.lng
    }
  }
  let rem = haversineM(bestLat, bestLng, geometry[bestSeg + 1][1], geometry[bestSeg + 1][0])
  // If projection is past mid-segment, rem already starts at best→segEnd; otherwise include
  // leftover of current segment via bestT (proj already is the snap on the segment).
  void bestT
  for (let i = bestSeg + 1; i < geometry.length - 1; i += 1) {
    rem += haversineM(geometry[i][1], geometry[i][0], geometry[i + 1][1], geometry[i + 1][0])
  }
  return rem
}

/**
 * Bearing looking ~lookAheadM forward along the route from a segment index.
 * Anticipates turns the way Google Maps does (arrow leads the corner slightly).
 */
function lookAheadBearingDeg(
  points: RoutePoint[],
  segIndex: number,
  fromLat: number,
  fromLng: number,
  lookAheadM = 28,
): number | null {
  if (points.length < 2) return null
  let i = Math.max(0, Math.min(segIndex, points.length - 2))
  let lat = fromLat
  let lng = fromLng
  let budget = lookAheadM
  let lastBearing: number | null = null
  while (budget > 0 && i < points.length - 1) {
    const next = points[i + 1]
    const segLen = haversineM(lat, lng, next.lat, next.lng)
    lastBearing = bearingDeg(lat, lng, next.lat, next.lng)
    if (segLen >= budget || segLen < 0.05) {
      return lastBearing
    }
    budget -= segLen
    lat = next.lat
    lng = next.lng
    i += 1
  }
  if (lastBearing != null) return lastBearing
  const a = points[Math.max(0, points.length - 2)]
  const b = points[points.length - 1]
  return bearingDeg(a.lat, a.lng, b.lat, b.lng)
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
  const points = flattenRoute(steps)
  if (!points.length) {
    // No corridor to follow → must recalculate (was false before, so reroute never fired).
    return {
      stepIndex: currentIndex,
      distanceToRouteM: Infinity,
      remainingM: 0,
      remainingSec: 0,
      toNextManeuverM: 0,
      snapped: null,
      offRoute: true,
      routeHeadingDeg: null,
    }
  }

  if (points.length === 1) {
    const only = points[0]
    const rem = haversineM(fix.latitude, fix.longitude, only.lat, only.lng)
    const step = steps[only.stepIndex]
    return {
      stepIndex: only.stepIndex,
      distanceToRouteM: rem,
      remainingM: rem,
      remainingSec: estimateSec(rem, fix.speed, step?.phase ?? 'walk'),
      toNextManeuverM: rem,
      snapped: { latitude: only.lat, longitude: only.lng },
      offRoute: rem > arrivalRadiusM(fix.accuracy),
      routeHeadingDeg: bearingDeg(fix.latitude, fix.longitude, only.lat, only.lng),
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

  // Prefer nearest waypoint when GPS is closer to a discrete stop than to a segment
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i]
    const d = haversineM(fix.latitude, fix.longitude, pt.lat, pt.lng)
    if (d < best.distM) {
      best = {
        distM: d,
        lat: pt.lat,
        lng: pt.lng,
        seg: Math.max(0, i - 1),
        stepIndex: pt.stepIndex,
      }
    }
  }

  const nextPt = points[Math.min(best.seg + 1, points.length - 1)]
  let remaining = haversineM(best.lat, best.lng, nextPt.lat, nextPt.lng)
  for (let i = best.seg + 1; i < points.length - 1; i++) {
    remaining += haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng)
  }

  let stepIndex = best.stepIndex
  // Prefer not jumping backward while still on the corridor; allow forward along GPS.
  if (stepIndex < currentIndex && best.distM < 90) {
    stepIndex = currentIndex
  }
  // Advance only along outdoor steps — never into indoor.
  const next = Math.max(stepIndex, currentIndex) + 1
  if (next < steps.length && steps[next].phase !== 'indoor') {
    const n = steps[next]
    const cur = steps[Math.max(stepIndex, currentIndex)]
    const arriveR = arrivalRadiusM(fix.accuracy)
    let nearNext = false
    if (Number.isFinite(n.latitude) && Number.isFinite(n.longitude)) {
      nearNext = haversineM(fix.latitude, fix.longitude, n.latitude, n.longitude) < arriveR
    }
    // Also advance when the current step polyline is nearly finished (Google-like).
    if (
      !nearNext &&
      cur?.geometry &&
      cur.geometry.length > 1 &&
      remainingAlongGeometry(best.lat, best.lng, cur.geometry) < Math.max(25, arriveR * 0.6)
    ) {
      nearNext = true
    }
    if (nearNext) stepIndex = Math.max(stepIndex, next)
  }
  // Don't jump backwards while still near the current corridor
  if (stepIndex < currentIndex && best.distM < 90) {
    stepIndex = currentIndex
  }
  const outdoorCap = lastOutdoorIndex(steps)
  if (outdoorCap >= 0 && stepIndex > outdoorCap) stepIndex = outdoorCap
  if (steps[stepIndex]?.phase === 'indoor') {
    stepIndex = outdoorCap >= 0 ? outdoorCap : currentIndex
  }

  const active = steps[stepIndex]
  // Distance left on THIS turn (Google-style D) — along the step polyline from the snap,
  // not the static step.distanceM which never changes while you drive.
  let toNextManeuverM = active?.distanceM ?? 0
  if (active?.geometry && active.geometry.length > 1) {
    toNextManeuverM = remainingAlongGeometry(best.lat, best.lng, active.geometry)
  } else if (active && Number.isFinite(active.latitude) && Number.isFinite(active.longitude)) {
    // Prefer distance to the NEXT step start (the maneuver) when we lack a polyline.
    const nxt = steps[stepIndex + 1]
    if (nxt && nxt.phase !== 'indoor' && Number.isFinite(nxt.latitude) && Number.isFinite(nxt.longitude)) {
      toNextManeuverM = haversineM(best.lat, best.lng, nxt.latitude, nxt.longitude)
    } else {
      toNextManeuverM = haversineM(best.lat, best.lng, active.latitude, active.longitude)
    }
  }

  const phase = active?.phase ?? 'drive'
  const walkPhase = phase === 'walk'
  // Accuracy-aware threshold (Google-like): don't thrash on noisy GPS.
  const threshold = Math.max(
    walkPhase ? OFF_ROUTE_WALK_M : OFF_ROUTE_DRIVE_M,
    (fix.accuracy || 15) * 1.35,
  )
  const routeHeadingDeg = lookAheadBearingDeg(points, best.seg, best.lat, best.lng, 32)

  return {
    stepIndex,
    distanceToRouteM: best.distM,
    remainingM: remaining,
    remainingSec: estimateSec(remaining, fix.speed, phase),
    toNextManeuverM,
    snapped: { latitude: best.lat, longitude: best.lng },
    offRoute: best.distM > threshold,
    routeHeadingDeg,
  }
}

/**
 * Google-class puck pose: stick to the corridor and point along it while on-route.
 * Off-route → GPS movement / course. Compass is last resort only.
 */
export function resolvePuckPose(
  fix: LiveFix,
  progress: LiveProgress | null | undefined,
  prevFix: LiveFix | null,
): {
  lat: number
  lng: number
  heading: number | null
  onRoute: boolean
  source: 'route' | 'gps-move' | 'gps-course' | 'compass' | 'step' | null
} {
  const onRoute =
    Boolean(progress) &&
    !progress!.offRoute &&
    progress!.distanceToRouteM < Math.max(28, (fix.accuracy || 15) * 1.1) &&
    progress!.snapped != null &&
    progress!.routeHeadingDeg != null

  if (onRoute && progress!.snapped && progress!.routeHeadingDeg != null) {
    // Soft stick-to-road: mostly snapped, slight pull toward raw GPS (feels alive).
    const snap = progress!.snapped
    const t = Math.min(0.35, Math.max(0.08, (fix.accuracy || 15) / 80))
    return {
      lat: snap.latitude * (1 - t) + fix.latitude * t,
      lng: snap.longitude * (1 - t) + fix.longitude * t,
      heading: normalizeHeading(progress!.routeHeadingDeg),
      onRoute: true,
      source: 'route',
    }
  }

  let movedBearing: number | null = null
  if (prevFix) {
    const moved = haversineM(prevFix.latitude, prevFix.longitude, fix.latitude, fix.longitude)
    if (moved > 1.2) {
      movedBearing = bearingDeg(prevFix.latitude, prevFix.longitude, fix.latitude, fix.longitude)
    }
  }

  if (movedBearing != null) {
    return {
      lat: fix.latitude,
      lng: fix.longitude,
      heading: movedBearing,
      onRoute: false,
      source: 'gps-move',
    }
  }

  if (fix.headingSource === 'gps' && fix.heading != null) {
    return {
      lat: fix.latitude,
      lng: fix.longitude,
      heading: normalizeHeading(fix.heading),
      onRoute: false,
      source: 'gps-course',
    }
  }

  // Even off-route, if we still have a corridor heading nearby, prefer it over compass.
  if (progress?.routeHeadingDeg != null && progress.distanceToRouteM < 55) {
    return {
      lat: fix.latitude,
      lng: fix.longitude,
      heading: normalizeHeading(progress.routeHeadingDeg),
      onRoute: false,
      source: 'route',
    }
  }

  if (fix.heading != null) {
    return {
      lat: fix.latitude,
      lng: fix.longitude,
      heading: normalizeHeading(fix.heading),
      onRoute: false,
      source: fix.headingSource === 'compass' ? 'compass' : 'gps-course',
    }
  }

  return { lat: fix.latitude, lng: fix.longitude, heading: null, onRoute: false, source: null }
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
  // Walk phase still shows turn arrows when the text is a turn (not "Walk to entrance").
  if (/u-?turn|uturn/i.test(t)) return 'uturn'
  const hasLeft = /\bleft\b/.test(t)
  const hasRight = /\bright\b/.test(t)
  if (hasLeft && !hasRight) return 'left'
  if (hasRight && !hasLeft) return 'right'
  if (hasLeft && hasRight) {
    return t.indexOf('left') <= t.indexOf('right') ? 'left' : 'right'
  }
  if (/roundabout|rotary/i.test(t)) return 'roundabout'
  if (/arrive|park|reached/i.test(t)) return 'arrive'
  if (
    phase === 'walk' &&
    /walk to|leave the car|entrance|pedestrian|continue inside/i.test(t)
  ) {
    return 'walk'
  }
  if (/head|start|depart|continue|straight|keep going/i.test(t)) return 'straight'
  if (phase === 'walk') return 'walk'
  return 'straight'
}

function normalizeHeading(d: number): number {
  return ((d % 360) + 360) % 360
}

/**
 * Phone-top direction in degrees clockwise from true north.
 * GPS coords.heading only updates while moving — standing turns need this.
 */
export function compassHeadingFromEvent(e: DeviceOrientationEvent): number | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
  if (typeof webkit === 'number' && Number.isFinite(webkit)) {
    return normalizeHeading(webkit)
  }
  if (typeof e.alpha !== 'number' || !Number.isFinite(e.alpha)) return null
  // Prefer absolute orientation when the browser provides it.
  if (e.absolute === false) {
    // Relative-only events are too noisy for a nav puck — skip unless nothing else.
    // Still allow when absolute flag is missing (older Android).
  }
  const screenAngle =
    typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number'
      ? screen.orientation.angle
      : typeof (window as Window & { orientation?: number }).orientation === 'number'
        ? Number((window as Window & { orientation?: number }).orientation)
        : 0
  // alpha: 0 = north on many absolute implementations; convert to compass bearing.
  return normalizeHeading(360 - e.alpha + screenAngle)
}

/** iOS requires a user gesture; call from the Live GPS button click. */
export async function requestCompassPermission(): Promise<boolean> {
  try {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied' | 'default'>
    }
    if (typeof DOE.requestPermission === 'function') {
      const result = await DOE.requestPermission()
      return result === 'granted'
    }
  } catch {
    return false
  }
  return true
}

export type GeoWatchAnchor = { latitude: number; longitude: number }

/**
 * Drop Wi‑Fi / cached “city center” jumps that claim ±20 m but land kilometers away.
 * If several rejected samples agree, accept them (phone really moved / reroute).
 */
function shouldAcceptFix(
  prev: LiveFix | null,
  next: LiveFix,
  anchor: GeoWatchAnchor | null,
  rejectCluster: { lat: number; lng: number; count: number } | null,
): { accept: boolean; cluster: { lat: number; lng: number; count: number } | null } {
  if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) {
    return { accept: false, cluster: rejectCluster }
  }

  // Very coarse network location — wait for a tighter sample.
  if (next.accuracy > 200) {
    return { accept: false, cluster: rejectCluster }
  }

  const near = (aLat: number, aLng: number, bLat: number, bLng: number, m: number) =>
    haversineM(aLat, aLng, bLat, bLng) <= m

  // First fix far from the Live route start → almost always a bad Wi‑Fi centroid.
  if (!prev && anchor) {
    const dAnchor = haversineM(anchor.latitude, anchor.longitude, next.latitude, next.longitude)
    if (dAnchor > 2500) {
      const cluster =
        rejectCluster && near(rejectCluster.lat, rejectCluster.lng, next.latitude, next.longitude, 400)
          ? { ...rejectCluster, count: rejectCluster.count + 1 }
          : { lat: next.latitude, lng: next.longitude, count: 1 }
      return { accept: cluster.count >= 5, cluster: cluster.count >= 5 ? null : cluster }
    }
  }

  if (prev) {
    const dt = Math.max(0.2, (next.timestamp - prev.timestamp) / 1000)
    const dist = haversineM(prev.latitude, prev.longitude, next.latitude, next.longitude)
    // Physically impossible jump (keeps a wrong city pin from replacing a good street fix).
    if (dist / dt > 85) {
      return { accept: false, cluster: rejectCluster }
    }
    if (dist > 2000 && dt < 90 && next.accuracy <= 75) {
      const cluster =
        rejectCluster && near(rejectCluster.lat, rejectCluster.lng, next.latitude, next.longitude, 400)
          ? { ...rejectCluster, count: rejectCluster.count + 1 }
          : { lat: next.latitude, lng: next.longitude, count: 1 }
      return { accept: cluster.count >= 5, cluster: cluster.count >= 5 ? null : cluster }
    }
  }

  return { accept: true, cluster: null }
}

export function useGeolocationWatch(
  enabled: boolean,
  anchor: GeoWatchAnchor | null = null,
): {
  fix: LiveFix | null
  error: string | null
  watching: boolean
} {
  const [fix, setFix] = useState<LiveFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const lastGpsHeading = useRef<number | null>(null)
  const lastCompassHeading = useRef<number | null>(null)
  const lastFixRef = useRef<LiveFix | null>(null)
  const rejectClusterRef = useRef<{ lat: number; lng: number; count: number } | null>(null)
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor

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
    rejectClusterRef.current = null

    // Hold the puck at the planned Live start until a real nearby GPS sample arrives.
    // Stops the first Wi‑Fi “city center” reading from teleporting the marker across town.
    const seedAnchor = anchorRef.current
    if (seedAnchor) {
      const seed: LiveFix = {
        latitude: seedAnchor.latitude,
        longitude: seedAnchor.longitude,
        accuracy: 45,
        heading: lastCompassHeading.current,
        headingSource: lastCompassHeading.current != null ? 'compass' : null,
        speed: null,
        timestamp: Date.now(),
      }
      lastFixRef.current = seed
      setFix(seed)
    }

    const pickHeading = (
      gpsHeading: number | null,
      speed: number | null,
    ): { heading: number | null; source: 'gps' | 'compass' | null } => {
      const compass = lastCompassHeading.current
      const spd = speed != null && Number.isFinite(speed) ? speed : null
      // GPS course is usable well below driving speed; parking-lot walk ~1–2 m/s.
      const moving = spd != null && spd > 0.8
      if (moving && gpsHeading != null) return { heading: gpsHeading, source: 'gps' }
      if (moving && lastGpsHeading.current != null) {
        return { heading: lastGpsHeading.current, source: 'gps' }
      }
      // Compass only when nearly stopped — magnetic noise near cars/buildings is terrible.
      if ((spd == null || spd < 0.6) && compass != null) {
        return { heading: compass, source: 'compass' }
      }
      if (gpsHeading != null) return { heading: gpsHeading, source: 'gps' }
      if (lastGpsHeading.current != null) return { heading: lastGpsHeading.current, source: 'gps' }
      if (compass != null) return { heading: compass, source: 'compass' }
      return { heading: null, source: null }
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const gpsHeading =
          typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)
            ? normalizeHeading(pos.coords.heading)
            : null
        if (gpsHeading != null) lastGpsHeading.current = gpsHeading
        const speed = typeof pos.coords.speed === 'number' ? pos.coords.speed : null
        const picked = pickHeading(gpsHeading, speed)
        const candidate: LiveFix = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: picked.heading,
          headingSource: picked.source,
          speed,
          timestamp: pos.timestamp,
        }
        const verdict = shouldAcceptFix(
          lastFixRef.current,
          candidate,
          anchorRef.current,
          rejectClusterRef.current,
        )
        rejectClusterRef.current = verdict.cluster
        if (!verdict.accept) return

        lastFixRef.current = candidate
        setFix(candidate)
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
        // Cached Wi‑Fi centroids often land kilometers away with a fake ±15 m accuracy.
        maximumAge: 0,
        timeout: 20000,
      },
    )

    let compassTimer = 0
    let pendingCompass: number | null = null
    const flushCompass = () => {
      compassTimer = 0
      if (pendingCompass == null) return
      const compass = pendingCompass
      pendingCompass = null
      lastCompassHeading.current = compass
      const prev = lastFixRef.current
      if (!prev) return
      // Do not override a GPS course with compass while the phone is moving.
      const spd = prev.speed != null && Number.isFinite(prev.speed) ? prev.speed : null
      if (spd != null && spd > 0.8) return
      const picked = pickHeading(lastGpsHeading.current, prev.speed)
      if (picked.heading == null || picked.source !== 'compass') return
      if (prev.heading != null) {
        const delta = Math.abs(((picked.heading - prev.heading + 540) % 360) - 180)
        // Ignore tiny compass noise — was republishing every frame and thrashing the map.
        if (delta < 6) return
      }
      const next: LiveFix = {
        ...prev,
        heading: picked.heading,
        headingSource: 'compass',
        timestamp: Date.now(),
      }
      lastFixRef.current = next
      setFix(next)
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      const h = compassHeadingFromEvent(e)
      if (h == null) return
      pendingCompass = h
      // ~8 Hz is enough for a stable Google-like puck; rAF was overkill.
      if (!compassTimer) compassTimer = window.setTimeout(flushCompass, 120)
    }

    // Absolute first (Android); fall back to deviceorientation (iOS webkitCompassHeading).
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, true)
    window.addEventListener('deviceorientation', onOrientation as EventListener, true)

    return () => {
      navigator.geolocation.clearWatch(id)
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener, true)
      window.removeEventListener('deviceorientation', onOrientation as EventListener, true)
      if (compassTimer) window.clearTimeout(compassTimer)
      setWatching(false)
    }
  }, [enabled])

  return { fix, error, watching }
}
