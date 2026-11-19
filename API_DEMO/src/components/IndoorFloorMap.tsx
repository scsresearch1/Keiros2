import { useEffect, useMemo, useRef, useState, type PointerEvent as RE } from 'react'
import type { NavigateResult } from '../api'
import type { LiveFix } from '../liveNavigation'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
  instruction?: string
  /** Full indoor directions for this session — shown all at once. */
  directions?: string[]
  liveFix?: LiveFix | null
  /** exit = leave start building; enter = arrive at unit */
  mode?: 'exit' | 'enter'
}

type XY = { x: number; y: number }

const W = 640
const H = 520

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function IndoorFloorMap({
  map3d,
  activeStep,
  instruction,
  directions,
  liveFix = null,
  mode = 'enter',
}: Props) {
  const routeStops = useMemo(
    () =>
      mode === 'exit' && map3d.exitRouteStops?.length
        ? map3d.exitRouteStops
        : map3d.routeStops,
    [mode, map3d.exitRouteStops, map3d.routeStops],
  )
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [progress, setProgress] = useState(0.18)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    setView({ x: 0, y: 0, zoom: 1 })
  }, [activeStep, mode])

  useEffect(() => {
    if (liveFix) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setProgress(0.22)
      return
    }
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      const t = ((now - started) % 7000) / 7000
      setProgress(0.12 + t * 0.62)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [activeStep, liveFix, mode])

  const scene = useMemo(
    () => buildSimpleScene(map3d, activeStep, mode, routeStops),
    [map3d, activeStep, mode, routeStops],
  )
  const lines = useMemo(() => {
    if (directions?.length) return directions
    return buildAllDirections(map3d, mode, routeStops)
  }, [directions, map3d, mode, routeStops])

  useEffect(() => {
    if (!scene) return
    const el = svgRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setView((current) => ({
        ...current,
        zoom: clamp(current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.75, 2.6),
      }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scene])

  // Always show a blue "you" marker. Prefer live GPS only when it falls near the
  // indoor path — otherwise indoor GPS drifts off-canvas and the blue dot vanishes.
  const pathYou: { x: number; y: number; heading: number } | null = scene
    ? pointAlong(scene.leg, liveFix ? 0 : progress) || {
        x: scene.youPin.x,
        y: scene.youPin.y,
        heading: 0,
      }
    : null
  const liveNearPath =
    Boolean(scene && liveFix) && nearestStopMeters(liveFix!, routeStops) <= 55
  const liveYou =
    scene && liveFix && liveNearPath
      ? scene.toXY(liveFix.latitude, liveFix.longitude)
      : null
  const walker: { x: number; y: number; heading: number } | null =
    liveYou != null
      ? {
          x: liveYou.x,
          y: liveYou.y,
          heading:
            liveFix?.heading != null && Number.isFinite(liveFix.heading)
              ? (liveFix.heading * Math.PI) / 180
              : pathYou?.heading ?? 0,
        }
      : pathYou
        ? { x: pathYou.x, y: pathYou.y, heading: pathYou.heading }
        : scene
          ? { x: scene.youPin.x, y: scene.youPin.y, heading: 0 }
          : null

  const frame = useMemo(() => {
    if (!scene) return null
    const pts: XY[] = [scene.destPin, scene.youPin]
    if (walker) pts.push({ x: walker.x, y: walker.y })
    return frameAround(pts, 110)
  }, [scene, walker])

  const onPointerDown = (event: RE<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: RE<SVGSVGElement>) => {
    if (!drag.current) return
    setView((current) => ({
      ...current,
      x: drag.current!.ox + (event.clientX - drag.current!.x),
      y: drag.current!.oy + (event.clientY - drag.current!.y),
    }))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  if (!scene || !frame) {
    return <div className="floor-map floor-map--empty">No indoor map for this building</div>
  }

  const destLabel = mode === 'exit' ? 'Exit' : 'D'

  return (
    <div className="floor-map floor-map--split">
      <div className="floor-map__pane floor-map__pane--map">
        <div className="floor-map__canvas">
          <svg
            ref={svgRef}
            viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="floor-map__svg"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#f7f5f1" />
            <g
              transform={`translate(${view.x} ${view.y}) translate(${frame.x + frame.w / 2} ${frame.y + frame.h / 2}) scale(${view.zoom}) translate(${-(frame.x + frame.w / 2)} ${-(frame.y + frame.h / 2)})`}
            >
              {scene.destPin ? (
                <g transform={`translate(${scene.destPin.x} ${scene.destPin.y})`}>
                  <circle r={14} fill="#ea4335" stroke="#fff" strokeWidth={3} />
                  <text
                    y={5}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={11}
                    fontWeight={800}
                    fontFamily="system-ui,sans-serif"
                  >
                    {destLabel === 'Exit' ? 'E' : 'D'}
                  </text>
                </g>
              ) : null}
              {/* Blue you — always drawn (live when near path, else route start) */}
              <g transform={`translate(${walker?.x ?? scene.youPin.x} ${walker?.y ?? scene.youPin.y})`}>
                <g transform={`rotate(${(((walker?.heading ?? 0) * 180) / Math.PI)})`}>
                  <circle r={16} fill="#1a73e8" stroke="#fff" strokeWidth={3} />
                  <path d="M0 -9 L6 7 L0 3 L-6 7 Z" fill="#fff" />
                </g>
              </g>
            </g>
          </svg>
          <p className="floor-map__legend">
            Blue = you · Red = {mode === 'exit' ? 'exit' : 'destination'}
            {liveFix && !liveNearPath ? ' · GPS weak indoors — showing path start' : ''}
          </p>
        </div>
      </div>

      <div className="floor-map__pane floor-map__pane--text">
        <h3 className="floor-map__directions-title">
          {mode === 'exit' ? 'How to exit the building' : 'How to reach your unit'}
        </h3>
        <ol className="floor-map__directions">
          {lines.map((line, index) => (
            <li key={`${index}-${line.slice(0, 24)}`}>{line}</li>
          ))}
        </ol>
        {!lines.length ? (
          <p className="floor-map__directions-empty">
            {instruction || 'Follow the blue marker toward the red destination.'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function buildSimpleScene(
  map3d: NavigateResult['map3d'],
  _activeStep: number,
  mode: 'exit' | 'enter',
  routeStops: NavigateResult['map3d']['routeStops'],
) {
  const stops = routeStops?.length ? routeStops : map3d.routeStops
  if (!stops.length) return null

  const samples = stops.length >= 2 ? stops : [...stops, ...map3d.locations].slice(0, 8)
  const midLat = samples.reduce((sum, item) => sum + item.latitude, 0) / samples.length
  const midLng = samples.reduce((sum, item) => sum + item.longitude, 0) / samples.length
  const cos = Math.cos((midLat * Math.PI) / 180) || 1
  const meters = samples.map((item) => ({
    x: (item.longitude - midLng) * cos * 111320,
    y: (item.latitude - midLat) * 111320,
  }))
  const minX = Math.min(...meters.map((p) => p.x))
  const maxX = Math.max(...meters.map((p) => p.x))
  const minY = Math.min(...meters.map((p) => p.y))
  const maxY = Math.max(...meters.map((p) => p.y))
  const pad = 80
  const scale = Math.min(
    (W - pad * 2) / Math.max(maxX - minX, 8),
    (H - pad * 2) / Math.max(maxY - minY, 8),
  )
  const toXY = (lat: number, lng: number): XY => {
    const east = (lng - midLng) * cos * 111320
    const north = (lat - midLat) * 111320
    return {
      x: W / 2 + (east - (minX + maxX) / 2) * scale,
      y: H / 2 - (north - (minY + maxY) / 2) * scale,
    }
  }

  // Always anchor "you" at the first stop of this indoor segment (exit start / entrance).
  const start = stops[0]
  const dest = stops[stops.length - 1]
  let you = toXY(start.latitude, start.longitude)
  const destPin = toXY(dest.latitude, dest.longitude)
  // If start ≈ dest (single stop), nudge blue so it is not hidden under red.
  if (Math.hypot(you.x - destPin.x, you.y - destPin.y) < 18) {
    you = { x: destPin.x - 36, y: destPin.y + 28 }
  }
  const leg =
    stops.length > 1
      ? stops.map((s) => toXY(s.latitude, s.longitude))
      : [you, destPin]
  const frame = frameAround([you, destPin, ...leg], 110)

  return {
    toXY,
    youPin: you,
    destPin,
    leg,
    frame,
    mode,
  }
}

function nearestStopMeters(
  fix: { latitude: number; longitude: number },
  stops: NavigateResult['map3d']['routeStops'],
) {
  if (!stops.length) return Infinity
  let best = Infinity
  for (const stop of stops) {
    const d = haversineM(fix, stop)
    if (d < best) best = d
  }
  return best
}

function haversineM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const R = 6371000
  const p = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * p
  const dLng = (b.longitude - a.longitude) * p
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * p) * Math.cos(b.latitude * p) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function buildAllDirections(
  map3d: NavigateResult['map3d'],
  mode: 'exit' | 'enter',
  routeStops: NavigateResult['map3d']['routeStops'],
) {
  const stops = routeStops?.length ? routeStops : map3d.routeStops
  if (!stops.length) return [] as string[]

  const lines: string[] = []
  if (mode === 'exit') {
    lines.push(`Start inside at ${stops[0].name}`)
  } else {
    lines.push(`Enter at ${stops[0].name}`)
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const here = stops[i]
    const nxt = stops[i + 1]
    const last = i === stops.length - 2
    const label = placeLabel(map3d, nxt) || nxt.name

    if (here.floorId !== nxt.floorId) {
      const kind =
        verticalKind(placeLabel(map3d, here)) ||
        verticalKind(placeLabel(map3d, nxt)) ||
        verticalKind(label) ||
        'stairs'
      const floor =
        map3d.floors.find((f) => f.id === nxt.floorId)?.label || 'the next floor'
      lines.push(
        kind === 'elevator' ? `Take the elevator to ${floor}` : `Take the stairs to ${floor}`,
      )
      continue
    }

    const nextKind = verticalKind(label)
    if (nextKind === 'elevator') {
      lines.push(`Walk to the elevator (${nxt.name})`)
      continue
    }
    if (nextKind === 'stairs') {
      lines.push(`Walk to the stairs (${nxt.name})`)
      continue
    }

    if (last) {
      lines.push(
        mode === 'exit'
          ? `Exit at ${nxt.name} — continue outdoors`
          : `Arrive at ${nxt.name}`,
      )
    } else {
      lines.push(`Walk toward ${nxt.name}`)
    }
  }

  // De-dupe consecutive identical lines
  return lines.filter((line, index) => index === 0 || line !== lines[index - 1])
}

function frameAround(points: XY[], pad: number) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs) - pad
  const minY = Math.min(...ys) - pad
  const w = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 280)
  const h = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 240)
  return { x: minX, y: minY, w, h }
}

function pointAlong(points: XY[], t: number) {
  if (points.length < 2) return points[0] ? { ...points[0], heading: 0 } : null
  const total = points
    .slice(1)
    .reduce(
      (sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y),
      0,
    )
  let left = total * clamp(t, 0, 0.92)
  for (let i = 1; i < points.length; i += 1) {
    const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    if (left <= step || i === points.length - 1) {
      const u = step === 0 ? 0 : Math.min(1, left / step)
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * u,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * u,
        heading: Math.atan2(points[i].x - points[i - 1].x, -(points[i].y - points[i - 1].y)),
      }
    }
    left -= step
  }
  return { ...points[points.length - 1], heading: 0 }
}

function verticalKind(label: string): 'elevator' | 'stairs' | null {
  if (/elevator|lift/i.test(label)) return 'elevator'
  if (/stair|escalator/i.test(label)) return 'stairs'
  return null
}

function placeLabel(
  map3d: NavigateResult['map3d'],
  stop: NavigateResult['map3d']['routeStops'][number] | undefined,
) {
  if (!stop) return ''
  const hit = map3d.locations.find((loc) => loc.id === stop.id)
  return `${hit?.type || ''} ${hit?.name || stop.name || ''}`
}
