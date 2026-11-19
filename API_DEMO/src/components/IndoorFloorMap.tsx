import { useEffect, useMemo, useRef, useState, type PointerEvent as RE } from 'react'
import type { NavigateResult } from '../api'
import type { LiveFix } from '../liveNavigation'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
  instruction?: string
  liveFix?: LiveFix | null
  /** exit = leave start building; enter = arrive at unit */
  mode?: 'exit' | 'enter'
  onSelectFloor?: (floorId: string) => void
  onSelectUnit?: (unitId: string) => void
}

type XY = { x: number; y: number }

const W = 800
const H = 520

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function IndoorFloorMap({
  map3d,
  activeStep,
  instruction,
  liveFix = null,
  mode = 'enter',
  onSelectFloor,
  onSelectUnit,
}: Props) {
  const routeStops = useMemo(
    () =>
      mode === 'exit' && map3d.exitRouteStops?.length
        ? map3d.exitRouteStops
        : map3d.routeStops,
    [mode, map3d.exitRouteStops, map3d.routeStops],
  )
  const floors = useMemo(
    () => [...map3d.floors].sort((a, b) => a.level - b.level),
    [map3d.floors],
  )
  const stepFloorId = routeStops[activeStep]?.floorId || map3d.selectedFloorId
  const [floorId, setFloorId] = useState(stepFloorId)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [progress, setProgress] = useState(0.18)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    setFloorId(stepFloorId)
  }, [stepFloorId])

  useEffect(() => {
    setView({ x: 0, y: 0, zoom: 1 })
  }, [floorId, activeStep, mode])

  // Demo walker only when we do not have a live phone fix.
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
  }, [activeStep, floorId, liveFix, mode])

  const scene = useMemo(
    () => buildScene(map3d, floorId, activeStep, mode, routeStops),
    [map3d, floorId, activeStep, mode, routeStops],
  )
  const hasScene = Boolean(scene)

  useEffect(() => {
    if (!hasScene) return
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
  }, [hasScene, floorId])

  const youAreHere = floorId === stepFloorId
  const liveYou =
    scene && liveFix
      ? scene.toXY(liveFix.latitude, liveFix.longitude)
      : null
  const walker =
    liveYou != null
      ? {
          x: liveYou.x,
          y: liveYou.y,
          heading:
            liveFix?.heading != null && Number.isFinite(liveFix.heading)
              ? (liveFix.heading * Math.PI) / 180
              : 0,
          live: true as const,
        }
      : scene && youAreHere
        ? { ...pointAlong(scene.leg, progress), live: false as const }
        : null
  const guide = scene?.guideText || instruction || 'Follow the map to your unit'

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

  if (!scene) return <div className="floor-map floor-map--empty">No floor plan for this building</div>

  const frame = scene.legView

  return (
    <div className="floor-map">
      <div className="floor-map__canvas">
        <p className="floor-map__guide" role="status">
          {guide}
        </p>
        <svg
          ref={svgRef}
          viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
          preserveAspectRatio="xMidYMid slice"
          className="floor-map__svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill="#f4f1eb" />
          <g transform={`translate(${view.x} ${view.y}) translate(${frame.x + frame.w / 2} ${frame.y + frame.h / 2}) scale(${view.zoom}) translate(${-(frame.x + frame.w / 2)} ${-(frame.y + frame.h / 2)})`}>
            <rect x={scene.plate.x} y={scene.plate.y} width={scene.plate.w} height={scene.plate.h} rx={22} fill="#f7f4ef" />
            {scene.rooms.map((room) => (
              <g
                key={room.id}
                onClick={() => onSelectUnit?.(room.id)}
                style={{ cursor: onSelectUnit ? 'pointer' : undefined }}
              >
                <rect
                  x={room.x - room.w / 2}
                  y={room.y - room.h / 2}
                  width={room.w}
                  height={room.h}
                  rx={8}
                  fill={room.dest ? '#f5e6e0' : room.vertical ? '#e8eef7' : '#e6dfd4'}
                  stroke={room.dest ? '#ea4335' : room.vertical ? '#7f9bbd' : '#d4cdc2'}
                  strokeWidth={room.dest || room.vertical ? 1.6 : 1}
                />
                <text
                  x={room.x}
                  y={room.y + 4}
                  textAnchor="middle"
                  fill="#5e584f"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                >
                  {room.short}
                </text>
              </g>
            ))}
            {/* Destination only — no route polyline clutter */}
            {scene.destPin ? (
              <g transform={`translate(${scene.destPin.x} ${scene.destPin.y})`}>
                <circle r={11} fill="#ea4335" stroke="#fff" strokeWidth={3} />
              </g>
            ) : null}
            {/* You — blue marker */}
            {walker ? (
              <g transform={`translate(${walker.x} ${walker.y})`}>
                <g transform={`rotate(${((walker.heading ?? 0) * 180) / Math.PI})`}>
                  <circle r={15} fill="#1a73e8" stroke="#fff" strokeWidth={3} />
                  <path d="M0 -9 L6 7 L0 3 L-6 7 Z" fill="#fff" />
                </g>
              </g>
            ) : null}
          </g>
        </svg>
        <div className="floor-map__floors" role="tablist" aria-label="Floor">
          {floors.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === floorId}
              className={item.id === floorId ? 'is-active' : ''}
              onClick={() => {
                setFloorId(item.id)
                onSelectFloor?.(item.id)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="floor-map__stats">
          <span>
            {youAreHere
              ? mode === 'exit'
                ? 'Blue = you · Red = exit'
                : 'Blue = you · Red = destination'
              : `Viewing ${floors.find((f) => f.id === floorId)?.label || 'floor'}`}
          </span>
          <button
            type="button"
            onClick={() => {
              if (liveYou) {
                setView({
                  x: frame.x + frame.w / 2 - liveYou.x,
                  y: frame.y + frame.h / 2 - liveYou.y,
                  zoom: Math.max(view.zoom, 1.2),
                })
                return
              }
              setView({ x: 0, y: 0, zoom: 1 })
            }}
          >
            Center
          </button>
        </div>
      </div>
    </div>
  )
}

function buildScene(
  map3d: NavigateResult['map3d'],
  floorId: string,
  activeStep: number,
  mode: 'exit' | 'enter' = 'enter',
  routeStops?: NavigateResult['map3d']['routeStops'],
) {
  const onFloor = map3d.locations.filter((location) => location.floorId === floorId)
  const samples = onFloor.length ? onFloor : map3d.locations
  if (!samples.length) return null
  const midLat = samples.reduce((sum, item) => sum + item.latitude, 0) / samples.length
  const midLng = samples.reduce((sum, item) => sum + item.longitude, 0) / samples.length
  const cos = Math.cos((midLat * Math.PI) / 180) || 1
  const meters = samples.map((item) => ({
    x: (item.longitude - midLng) * cos * 111320,
    y: (item.latitude - midLat) * 111320,
  }))
  const spanX = Math.max(...meters.map((point) => point.x)) - Math.min(...meters.map((point) => point.x))
  const spanY = Math.max(...meters.map((point) => point.y)) - Math.min(...meters.map((point) => point.y))
  const rotate = spanY > spanX * 1.15
  const local = meters.map((point) => (rotate ? { x: point.y, y: -point.x } : point))
  const minX = Math.min(...local.map((point) => point.x))
  const maxX = Math.max(...local.map((point) => point.x))
  const minY = Math.min(...local.map((point) => point.y))
  const maxY = Math.max(...local.map((point) => point.y))
  const pad = 120
  const scale = Math.min(
    (W - pad * 2) / Math.max(maxX - minX, 1),
    (H - pad * 2) / Math.max(maxY - minY, 1),
  )
  const toXY = (lat: number, lng: number): XY => {
    const east = (lng - midLng) * cos * 111320
    const north = (lat - midLat) * 111320
    const point = rotate ? { x: north, y: -east } : { x: east, y: north }
    return {
      x: W / 2 + (point.x - (minX + maxX) / 2) * scale,
      y: H / 2 - (point.y - (minY + maxY) / 2) * scale,
    }
  }
  const placed = samples.map((item) => ({ ...item, ...toXY(item.latitude, item.longitude) }))
  const gaps: number[] = []
  for (const point of placed) {
    let nearest = Infinity
    for (const other of placed) {
      if (other.id === point.id) continue
      nearest = Math.min(nearest, Math.hypot(other.x - point.x, other.y - point.y))
    }
    if (Number.isFinite(nearest)) gaps.push(nearest)
  }
  gaps.sort((a, b) => a - b)
  const typical = gaps[Math.floor(gaps.length / 2)] || 120
  const roomW = clamp(typical * 0.58, 86, 148)
  const roomH = clamp(roomW * 0.68, 62, 100)
  const stops = routeStops?.length ? routeStops : map3d.routeStops
  const current = stops[activeStep]
  const dest = stops[stops.length - 1]
  const rooms = placed.map((place) => ({
    id: place.id,
    name: place.name,
    short: place.name.length > 12 ? `${place.name.slice(0, 11)}…` : place.name,
    x: place.x,
    y: place.y,
    w: roomW,
    h: roomH,
    here: place.id === current?.id,
    dest: place.id === dest?.id,
    vertical: isVerticalAccess(`${place.type || ''} ${place.name || ''}`),
  }))
  const floorStops = stops
    .map((stop, index) => ({ ...stop, index, ...toXY(stop.latitude, stop.longitude) }))
    .filter((stop) => stop.floorId === floorId)
  const nextStop = stops[activeStep + 1]
  if (current?.floorId === floorId && nextStop && nextStop.floorId !== floorId) {
    const here = placed.find((place) => place.id === current.id)
    const exit = placed
      .filter((place) => place.id !== current.id && /stair|elevator/i.test(`${place.type} ${place.name}`))
      .sort((a, b) => {
        const da = here ? Math.hypot(a.x - here.x, a.y - here.y) : 0
        const db = here ? Math.hypot(b.x - here.x, b.y - here.y) : 0
        return da - db
      })[0]
    if (exit && !floorStops.some((stop) => stop.id === exit.id)) {
      floorStops.push({ ...exit, index: activeStep + 0.5, latitude: exit.latitude, longitude: exit.longitude })
    }
  }
  const doors = floorStops.map((stop, index) => {
    const next = floorStops[index + 1]
    const prev = floorStops[index - 1]
    const toward = next || prev || stop
    return doorOnRoom(stop, toward, roomW, roomH)
  })
  const hereIndex = floorStops.findIndex((stop) => stop.index === activeStep)
  const aheadDoors = hereIndex >= 0 ? doors.slice(hereIndex) : doors
  const elbows = hallway(aheadDoors)
  const xs = rooms.map((room) => room.x)
  const ys = rooms.map((room) => room.y)
  const plate = {
    x: Math.min(...xs) - roomW / 2 - 28,
    y: Math.min(...ys) - roomH / 2 - 28,
    w: Math.max(...xs) - Math.min(...xs) + roomW + 56,
    h: Math.max(...ys) - Math.min(...ys) + roomH + 56,
  }
  const legDoors = hereIndex >= 0 ? doors.slice(hereIndex, hereIndex + 2) : doors.slice(0, 2)
  const leg = hallway(legDoors.length ? legDoors : aheadDoors)
  const anchor = leg.length ? leg : rooms.map((room) => ({ x: room.x, y: room.y }))
  const nearby = rooms.filter((room) => anchor.some((point) => Math.hypot(room.x - point.x, room.y - point.y) < 190))
  const framePts = [...anchor, ...nearby.map((room) => ({ x: room.x, y: room.y }))]
  const legView = frameAround(framePts.length ? framePts : anchor, 110)
  const guideText = indoorGuideText(map3d, activeStep, mode, stops)
  const destOnFloor = dest && dest.floorId === floorId ? toXY(dest.latitude, dest.longitude) : null

  return {
    plate,
    rooms,
    leg: leg.length > 1 ? leg : elbows.length > 1 ? elbows : floorStops.map((stop) => ({ x: stop.x, y: stop.y })),
    legView,
    guideText,
    toXY,
    destPin: destOnFloor,
  }
}

function doorOnRoom(from: XY, toward: XY, w: number, h: number): XY {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return { ...from }
  if (Math.abs(dx) / (w / 2) > Math.abs(dy) / (h / 2)) {
    const edge = Math.sign(dx) * (w / 2 + 10)
    return { x: from.x + edge, y: from.y + clamp(dy, -h / 3, h / 3) }
  }
  const edge = Math.sign(dy || 1) * (h / 2 + 10)
  return { x: from.x + clamp(dx, -w / 3, w / 3), y: from.y + edge }
}

function hallway(points: XY[]): XY[] {
  if (points.length < 2) return points
  const raw: XY[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = raw[raw.length - 1]
    const next = points[i]
    if (Math.abs(prev.x - next.x) > 12 && Math.abs(prev.y - next.y) > 12) {
      raw.push({ x: next.x, y: prev.y })
    }
    raw.push(next)
  }
  return raw
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
  const total = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
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

function isVerticalAccess(label: string) {
  return /stair|elevator|lift|escalator/i.test(label)
}

function verticalKind(label: string): 'elevator' | 'stairs' | null {
  if (/elevator|lift/i.test(label)) return 'elevator'
  if (/stair|escalator/i.test(label)) return 'stairs'
  return null
}

function placeLabel(map3d: NavigateResult['map3d'], stop: NavigateResult['map3d']['routeStops'][number] | undefined) {
  if (!stop) return ''
  const hit = map3d.locations.find((loc) => loc.id === stop.id)
  return `${hit?.type || ''} ${hit?.name || stop.name || ''}`
}

function indoorGuideText(
  map3d: NavigateResult['map3d'],
  activeStep: number,
  mode: 'exit' | 'enter' = 'enter',
  routeStops?: NavigateResult['map3d']['routeStops'],
) {
  const stops = routeStops?.length ? routeStops : map3d.routeStops
  const here = stops[activeStep]
  const nxt = stops[activeStep + 1]
  if (!here) return 'Indoor navigation'
  if (!nxt) {
    return mode === 'exit'
      ? `Exit at ${here.name} — continue outdoors`
      : `You have arrived at ${here.name}`
  }

  const floorLabel = (floorId: string) =>
    map3d.floors.find((floor) => floor.id === floorId)?.label || 'the next floor'

  if (nxt.floorId !== here.floorId) {
    const hereKind = verticalKind(placeLabel(map3d, here))
    const nextKind = verticalKind(placeLabel(map3d, nxt))
    const nearby = map3d.locations
      .filter((loc) => loc.floorId === here.floorId && isVerticalAccess(`${loc.type || ''} ${loc.name || ''}`))
      .map((loc) => verticalKind(`${loc.type || ''} ${loc.name || ''}`))
      .find(Boolean)
    const kind = hereKind || nextKind || nearby || 'stairs'
    const to = floorLabel(nxt.floorId)
    if (kind === 'elevator') return `Take the elevator to ${to}`
    return `Take the stairs to ${to}`
  }

  const nextKind = verticalKind(placeLabel(map3d, nxt))
  if (nextKind === 'elevator') return `Walk to the elevator (${nxt.name})`
  if (nextKind === 'stairs') return `Walk to the stairs (${nxt.name})`

  const dest = stops[stops.length - 1]
  if (dest && nxt.id === dest.id) {
    return mode === 'exit'
      ? `Walk to the exit: ${dest.name}`
      : `Walk to your destination: ${dest.name}`
  }
  return mode === 'exit' ? `Walk toward ${nxt.name}` : `Walk toward ${nxt.name}`
}
