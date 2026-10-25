import { useMemo, useRef, useState, type PointerEvent as RE, type WheelEvent as WE } from 'react'
import type { NavigateResult } from '../api'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
  instruction?: string
}

type Pt = { x: number; y: number }
type Cam = { yaw: number; pitch: number; zoom: number }

const DEFAULT: Cam = { yaw: 0.7, pitch: 0.72, zoom: 1.05 }

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function project(
  x: number,
  y: number,
  z: number,
  ox: number,
  oy: number,
  baseScale: number,
  cam: Cam,
  cx: number,
  cy: number,
  cz: number,
): Pt {
  const lx = x - cx
  const ly = y - cy
  const lz = z - cz
  const cosY = Math.cos(cam.yaw)
  const sinY = Math.sin(cam.yaw)
  const rx = lx * cosY - ly * sinY
  const ry = lx * sinY + ly * cosY
  const cosP = Math.cos(cam.pitch)
  const sinP = Math.sin(cam.pitch)
  const py = ry * cosP - lz * sinP
  const pz = ry * sinP + lz * cosP
  const scale = baseScale * cam.zoom
  return { x: ox + rx * scale, y: oy - pz * scale + py * scale * 0.12 }
}

export function Indoor3D({ map3d, activeStep, instruction }: Props) {
  const [cam, setCam] = useState<Cam>(DEFAULT)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const model = useMemo(() => buildModel(map3d, activeStep), [map3d, activeStep])

  if (!model) return <div className="demo-indoor empty">No indoor geometry</div>

  const width = 720
  const height = 460
  const originX = width / 2
  const originY = height / 2 + 30
  const p = (x: number, y: number, z: number) =>
    project(x, y, z, originX, originY, 1.55, cam, model.cx, model.cy, model.cz)

  const onPointerDown = (event: RE<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, yaw: cam.yaw, pitch: cam.pitch }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: RE<SVGSVGElement>) => {
    if (!drag.current) return
    setCam({
      ...cam,
      yaw: drag.current.yaw + (event.clientX - drag.current.x) * 0.01,
      pitch: clamp(drag.current.pitch + (event.clientY - drag.current.y) * 0.008, 0.35, 1.25),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (event: WE<SVGSVGElement>) => {
    event.preventDefault()
    setCam((current) => ({ ...current, zoom: clamp(current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.65, 2.4) }))
  }

  const you = model.route[activeStep]
  const youPt = you ? p(you.x, you.y, you.zFloor + 8) : null
  const next = model.route[activeStep + 1]
  const heading = you && next ? Math.atan2(next.x - you.x, -(next.y - you.y)) : 0

  return (
    <div className="demo-indoor">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="demo-indoor__svg"
        preserveAspectRatio="xMidYMid slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <linearGradient id="indoor-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#16324a" />
            <stop offset="1" stopColor="#0c1522" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill="url(#indoor-sky)" />
        {model.floors.map((floor) => {
          const z = model.floorZ.get(floor.id) ?? 0
          const active = floor.id === model.activeFloorId
          const top = [
            p(-130, -130, z),
            p(130, -130, z),
            p(130, 130, z),
            p(-130, 130, z),
          ]
          const edge = [
            p(-130, 130, z),
            p(130, 130, z),
            p(130, 130, z - 7),
            p(-130, 130, z - 7),
          ]
          return (
            <g key={floor.id}>
              <polygon
                points={edge.map((corner) => `${corner.x},${corner.y}`).join(' ')}
                fill={active ? '#c4b8a4' : '#6d7c8c'}
                opacity={active ? 0.95 : 0.35}
              />
              <polygon
                points={top.map((corner) => `${corner.x},${corner.y}`).join(' ')}
                fill={active ? '#f3eee6' : '#d5dde6'}
                opacity={active ? 1 : 0.45}
                stroke={active ? '#8ea0b5' : 'transparent'}
                strokeWidth={active ? 1.2 : 0}
              />
            </g>
          )
        })}
        {model.rooms.map((room) => {
          const corners = [
            p(room.x - 10, room.y - 7, room.z + 1),
            p(room.x + 10, room.y - 7, room.z + 1),
            p(room.x + 10, room.y + 7, room.z + 1),
            p(room.x - 10, room.y + 7, room.z + 1),
          ]
          return (
            <polygon
              key={room.id}
              points={corners.map((corner) => `${corner.x},${corner.y}`).join(' ')}
              fill={room.dest ? '#d7c4a4' : '#e4d9c8'}
              stroke="#c9bba6"
              strokeWidth={0.6}
            />
          )
        })}
        {model.links.map((link) => {
          const a = p(link.a.x, link.a.y, link.a.z + 4)
          const b = p(link.b.x, link.b.y, link.b.z + 4)
          return (
            <line
              key={link.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={link.vertical ? '#e7b15a' : '#2c4a73'}
              strokeWidth={link.vertical ? 2 : 4}
              strokeDasharray={link.ahead ? '1.5 7' : '0'}
              strokeLinecap="round"
              opacity={link.ahead ? 1 : 0.35}
            />
          )
        })}
        {youPt ? (
          <g transform={`translate(${youPt.x} ${youPt.y}) rotate(${(heading * 180) / Math.PI})`}>
            <circle r={11} fill="#1d3557" />
            <path d="M0 -6 L4.5 5 L0 2.2 L-4.5 5 Z" fill="#f7f4ef" />
          </g>
        ) : null}
      </svg>
      <div className="demo-indoor__hud">
        <p className="demo-indoor__then">{model.then}</p>
        <p className="demo-indoor__meta">
          {model.floorLabel} · {model.remainM > 0 ? `${model.remainM} m` : 'Arrived'}
        </p>
      </div>
      <div className="demo-indoor__hint">{instruction || 'Drag to look around the floors'}</div>
    </div>
  )
}

function buildModel(map3d: NavigateResult['map3d'], activeStep: number) {
  const locs = map3d.locations
  if (!locs.length) return null
  const lats = locs.map((item) => item.latitude)
  const lngs = locs.map((item) => item.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const toXY = (lat: number, lng: number) => ({
    x: ((lng - minLng) / Math.max(maxLng - minLng, 1e-6)) * 200 - 100,
    y: ((maxLat - lat) / Math.max(maxLat - minLat, 1e-6)) * 200 - 100,
  })
  const floors = [...map3d.floors].sort((a, b) => a.level - b.level)
  const floorZ = new Map(floors.map((floor, index) => [floor.id, index * 28]))
  const activeFloorId = map3d.routeStops[activeStep]?.floorId || map3d.selectedFloorId
  const rooms = locs
    .filter((location) => location.floorId === activeFloorId)
    .map((location) => ({
      id: location.id,
      dest: location.id === map3d.selectedUnitId,
      ...toXY(location.latitude, location.longitude),
      z: floorZ.get(location.floorId) ?? 0,
    }))
  const route = map3d.routeStops.map((stop) => ({
    ...stop,
    ...toXY(stop.latitude, stop.longitude),
    zFloor: floorZ.get(stop.floorId) ?? 0,
  }))
  const links = route.slice(1).map((stop, index) => {
    const prev = route[index]
    return {
      id: `${prev.id}-${stop.id}`,
      a: { x: prev.x, y: prev.y, z: prev.zFloor },
      b: { x: stop.x, y: stop.y, z: stop.zFloor },
      vertical: prev.floorId !== stop.floorId,
      ahead: index >= activeStep,
    }
  })
  const here = map3d.routeStops[activeStep]
  const nxt = map3d.routeStops[activeStep + 1]
  const after = map3d.routeStops[activeStep + 2]
  let then = 'You have arrived'
  if (here && nxt && nxt.floorId !== here.floorId) {
    then = `Then stairs to ${floors.find((floor) => floor.id === nxt.floorId)?.label || 'next floor'}`
  } else if (here && nxt && after) {
    const h1 = Math.atan2(nxt.longitude - here.longitude, nxt.latitude - here.latitude)
    const h2 = Math.atan2(after.longitude - nxt.longitude, after.latitude - nxt.latitude)
    let delta = h2 - h1
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const deg = (delta * 180) / Math.PI
    then = Math.abs(deg) < 28 ? 'Then continue straight' : deg > 0 ? 'Then turn right' : 'Then turn left'
  } else if (nxt) {
    then = `Then toward ${nxt.name}`
  }
  let remainM = 0
  for (let i = activeStep; i < map3d.routeStops.length - 1; i += 1) {
    remainM += haversine(map3d.routeStops[i], map3d.routeStops[i + 1])
  }
  return {
    floors,
    floorZ,
    rooms,
    route,
    links,
    activeFloorId,
    floorLabel: floors.find((floor) => floor.id === activeFloorId)?.label || 'Floor',
    then,
    remainM: Math.round(remainM),
    cx: 0,
    cy: 0,
    cz: ((floors.length - 1) * 28) / 2,
  }
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
