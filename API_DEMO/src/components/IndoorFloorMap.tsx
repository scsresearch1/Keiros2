import { useEffect, useMemo, useRef, useState, type PointerEvent as RE } from 'react'
import type { NavigateResult } from '../api'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
  instruction?: string
  onSelectFloor?: (floorId: string) => void
  onSelectUnit?: (unitId: string) => void
}

type XY = { x: number; y: number }

const W = 800
const H = 520

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function IndoorFloorMap({ map3d, activeStep, instruction, onSelectFloor, onSelectUnit }: Props) {
  const floors = useMemo(
    () => [...map3d.floors].sort((a, b) => a.level - b.level),
    [map3d.floors],
  )
  const stepFloorId = map3d.routeStops[activeStep]?.floorId || map3d.selectedFloorId
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
  }, [floorId, activeStep])

  useEffect(() => {
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
  }, [activeStep, floorId])

  const scene = useMemo(() => buildScene(map3d, floorId, activeStep), [map3d, floorId, activeStep])
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
  const walker = scene && youAreHere ? pointAlong(scene.leg, progress) : null

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
  const minutes = scene.remainM > 0 ? Math.max(1, Math.round(scene.remainM / 75)) : 0

  return (
    <div className="floor-map">
      <div className="floor-map__canvas">
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
                  fill={room.here ? '#d9e4f2' : room.dest ? '#e7e0d4' : '#e6dfd4'}
                  stroke={room.here ? '#7f9bbd' : '#d4cdc2'}
                  strokeWidth={room.here || room.dest ? 1.6 : 1}
                />
                <text
                  x={room.x}
                  y={room.y + 4}
                  textAnchor="middle"
                  fill="#5e584f"
                  fontSize={11}
                  fontFamily="system-ui, sans-serif"
                  clipPath={`url(#clip-${room.id})`}
                >
                  {room.short}
                </text>
                <clipPath id={`clip-${room.id}`}>
                  <rect x={room.x - room.w / 2 + 8} y={room.y - 12} width={room.w - 16} height={22} />
                </clipPath>
              </g>
            ))}
            {scene.path ? (
              <>
                <path
                  d={scene.path}
                  fill="none"
                  stroke="#93c5fd"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.55}
                />
                <path
                  d={scene.path}
                  fill="none"
                  stroke="#1a73e8"
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : null}
            {walker ? (
              <g transform={`translate(${walker.x} ${walker.y}) rotate(${(walker.heading * 180) / Math.PI})`}>
                <circle r={16} fill="#1d3557" />
                <path d="M0 -8 L6.2 7 L0 3.2 L-6.2 7 Z" fill="#f7f4ef" />
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
        <p className="floor-map__then">
          <span aria-hidden>{scene.then.mark}</span>
          {youAreHere ? scene.then.text : `Showing ${floors.find((item) => item.id === floorId)?.label || 'floor'}`}
        </p>
        <div className="floor-map__stats">
          <strong>{minutes > 0 ? `${minutes} min` : 'Here'}</strong>
          <span>{scene.remainM > 0 ? `${scene.remainM} m` : instruction || 'At the stop'}</span>
          <button type="button" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>
            Center
          </button>
        </div>
      </div>
    </div>
  )
}

function buildScene(map3d: NavigateResult['map3d'], floorId: string, activeStep: number) {
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
  const stops = map3d.routeStops
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
  const path = roundedPath(elbows, 16)
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
  const then = nextCue(stops, activeStep, map3d.floors)
  let remainM = 0
  for (let i = activeStep; i < stops.length - 1; i += 1) {
    remainM += haversine(stops[i], stops[i + 1])
  }
  return {
    plate,
    rooms,
    path,
    leg: leg.length > 1 ? leg : elbows.length > 1 ? elbows : floorStops.map((stop) => ({ x: stop.x, y: stop.y })),
    legView,
    then,
    remainM: Math.round(remainM),
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

function roundedPath(points: XY[], radius: number) {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1
    const cut = Math.min(radius, inLen / 2, outLen / 2)
    const ax = cur.x - ((cur.x - prev.x) / inLen) * cut
    const ay = cur.y - ((cur.y - prev.y) / inLen) * cut
    const bx = cur.x + ((next.x - cur.x) / outLen) * cut
    const by = cur.y + ((next.y - cur.y) / outLen) * cut
    d += ` L ${ax} ${ay} Q ${cur.x} ${cur.y} ${bx} ${by}`
  }
  const end = points[points.length - 1]
  d += ` L ${end.x} ${end.y}`
  return d
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

function nextCue(
  stops: NavigateResult['map3d']['routeStops'],
  activeStep: number,
  floors: NavigateResult['map3d']['floors'],
) {
  const here = stops[activeStep]
  const nxt = stops[activeStep + 1]
  const after = stops[activeStep + 2]
  if (!here || !nxt) return { text: 'You have arrived', mark: '●' }
  if (nxt.floorId !== here.floorId) {
    const label = floors.find((floor) => floor.id === nxt.floorId)?.label || 'the next floor'
    return { text: `Then stairs to ${label}`, mark: '↕' }
  }
  if (!after || after.floorId !== nxt.floorId) return { text: `Then toward ${nxt.name}`, mark: '↑' }
  const h1 = Math.atan2(nxt.longitude - here.longitude, nxt.latitude - here.latitude)
  const h2 = Math.atan2(after.longitude - nxt.longitude, after.latitude - nxt.latitude)
  let delta = h2 - h1
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const deg = (delta * 180) / Math.PI
  if (Math.abs(deg) < 28) return { text: 'Then continue straight', mark: '↑' }
  if (deg > 0) return { text: 'Then turn right', mark: '↱' }
  return { text: 'Then turn left', mark: '↰' }
}

function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000
  const p = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * p
  const dLng = (b.longitude - a.longitude) * p
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * p) * Math.cos(b.latitude * p) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
