import { useEffect, useMemo, useRef, useState, type PointerEvent as RE } from 'react'
import type { NavigateResult } from '../api'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
  instruction?: string
  complexName?: string
}

type Pt = { x: number; y: number }
type Cam = { yaw: number; pitch: number; zoom: number }
type Vec3 = { x: number; y: number; z: number }

const DEFAULT: Cam = { yaw: 0.55, pitch: 0.62, zoom: 1 }
const HALF = 95
const FLOOR_GAP = 26
const CORE = { x: 0, y: 0 } // elevator / vertical shaft near building center

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
  return { x: ox + rx * scale, y: oy - pz * scale + py * scale * 0.1 }
}

export function Indoor3D({ map3d, activeStep, instruction, complexName }: Props) {
  const [cam, setCam] = useState<Cam>(DEFAULT)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const model = useMemo(() => buildModel(map3d, activeStep), [map3d, activeStep])
  const hasModel = Boolean(model)

  // Non-passive wheel listener — React onWheel is passive and can't preventDefault.
  useEffect(() => {
    if (!hasModel) return
    const el = svgRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setCam((current) => ({
        ...current,
        zoom: clamp(current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.6),
      }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasModel, map3d.building.id])

  if (!model) return <div className="demo-indoor empty">No indoor geometry</div>

  const width = 760
  const height = 520
  const originX = width / 2 - 20
  const originY = height / 2 + 36
  const p = (x: number, y: number, z: number) =>
    project(x, y, z, originX, originY, 1.7, cam, model.cx, model.cy, model.cz)

  const onPointerDown = (event: RE<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, yaw: cam.yaw, pitch: cam.pitch }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: RE<SVGSVGElement>) => {
    if (!drag.current) return
    setCam({
      ...cam,
      yaw: drag.current.yaw + (event.clientX - drag.current.x) * 0.01,
      pitch: clamp(drag.current.pitch + (event.clientY - drag.current.y) * 0.008, 0.28, 1.2),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const deg = Math.round((cam.yaw * 180) / Math.PI) % 360
  const title = [complexName, '3D', map3d.building.name].filter(Boolean).join(' · ')
  const progressPct = model.routeStops.length
    ? Math.round(((activeStep + 1) / model.routeStops.length) * 100)
    : 100

  const shellBottom = 0
  const shellTop = Math.max(FLOOR_GAP, (model.floors.length - 1) * FLOOR_GAP + 18)
  const corners2d = [
    [-HALF, -HALF],
    [HALF, -HALF],
    [HALF, HALF],
    [-HALF, HALF],
  ] as const

  const activeFloor = model.floors.find((f) => f.id === model.activeFloorId)
  const activeZ = model.floorZ.get(model.activeFloorId) ?? 0

  return (
    <div className="demo-indoor demo-indoor--orion">
      <div className="demo-indoor__chrome-top">
        <div className="demo-indoor__title-pill">{title || 'Indoor · 3D'}</div>
        <div className="demo-indoor__zoom">
          <button type="button" aria-label="Zoom in" onClick={() => setCam((c) => ({ ...c, zoom: clamp(c.zoom * 1.12, 0.55, 2.6) }))}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => setCam((c) => ({ ...c, zoom: clamp(c.zoom * 0.9, 0.55, 2.6) }))}>
            −
          </button>
          <button type="button" className="demo-indoor__reset" onClick={() => setCam(DEFAULT)}>
            Reset
          </button>
        </div>
      </div>

      <p className="demo-indoor__gesture">
        Drag to rotate · Scroll / pinch to zoom · {(deg < 0 ? deg + 360 : deg)}°
      </p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="demo-indoor__svg"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="orion-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(148,180,220,0.12)" strokeWidth="1" />
          </pattern>
          <linearGradient id="orion-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#102a44" />
            <stop offset="1" stopColor="#071018" />
          </linearGradient>
          <filter id="orion-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={width} height={height} fill="url(#orion-sky)" />
        <rect width={width} height={height} fill="url(#orion-grid)" />

        {/* Building wireframe shell */}
        <g className="demo-indoor__shell" opacity={0.95}>
          {corners2d.map(([x, y], i) => {
            const n = corners2d[(i + 1) % 4]
            const a0 = p(x, y, shellBottom)
            const a1 = p(n[0], n[1], shellBottom)
            const b0 = p(x, y, shellTop)
            const b1 = p(n[0], n[1], shellTop)
            return (
              <g key={`edge-${i}`}>
                <line x1={a0.x} y1={a0.y} x2={a1.x} y2={a1.y} stroke="rgba(226,236,248,0.55)" strokeWidth={1.4} />
                <line x1={b0.x} y1={b0.y} x2={b1.x} y2={b1.y} stroke="rgba(226,236,248,0.7)" strokeWidth={1.4} />
                <line x1={a0.x} y1={a0.y} x2={b0.x} y2={b0.y} stroke="rgba(226,236,248,0.65)" strokeWidth={1.4} />
              </g>
            )
          })}
        </g>

        {/* Floor plates */}
        {model.floors.map((floor, index) => {
          const z = model.floorZ.get(floor.id) ?? index * FLOOR_GAP
          const active = floor.id === model.activeFloorId
          const top = corners2d.map(([x, y]) => p(x, y, z))
          return (
            <g key={floor.id}>
              <polygon
                points={top.map((c) => `${c.x},${c.y}`).join(' ')}
                fill={active ? 'rgba(56, 189, 248, 0.08)' : 'rgba(148, 163, 184, 0.04)'}
                stroke={active ? 'rgba(125, 211, 252, 0.55)' : 'rgba(148, 163, 184, 0.28)'}
                strokeWidth={active ? 1.6 : 0.9}
              />
            </g>
          )
        })}

        {/* Active floor volume (teal slab) */}
        {activeFloor ? (
          <g className="demo-indoor__active-volume">
            {corners2d.map(([x, y], i) => {
              const n = corners2d[(i + 1) % 4]
              const a0 = p(x, y, activeZ)
              const a1 = p(n[0], n[1], activeZ)
              const b0 = p(x, y, activeZ + 14)
              const b1 = p(n[0], n[1], activeZ + 14)
              return (
                <polygon
                  key={`vol-${i}`}
                  points={`${a0.x},${a0.y} ${a1.x},${a1.y} ${b1.x},${b1.y} ${b0.x},${b0.y}`}
                  fill="rgba(34, 211, 238, 0.18)"
                  stroke="rgba(34, 211, 238, 0.45)"
                  strokeWidth={1}
                />
              )
            })}
            <polygon
              points={corners2d.map(([x, y]) => {
                const c = p(x, y, activeZ + 14)
                return `${c.x},${c.y}`
              }).join(' ')}
              fill="rgba(34, 211, 238, 0.22)"
              stroke="rgba(165, 243, 252, 0.7)"
              strokeWidth={1.4}
            />
          </g>
        ) : null}

        {/* Indoor path (floor → core → vertical → floor) */}
        <polyline
          points={model.path3d.map((v) => {
            const c = p(v.x, v.y, v.z)
            return `${c.x},${c.y}`
          }).join(' ')}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#orion-glow)"
        />

        {/* Waypoints */}
        {model.waypoints.map((wp) => {
          const c = p(wp.x, wp.y, wp.z + 6)
          const done = wp.index < activeStep
          const current = wp.index === activeStep
          return (
            <g key={wp.id} className="demo-indoor__wp">
              <circle
                cx={c.x}
                cy={c.y}
                r={current ? 12 : 10}
                fill={current || done ? '#fbbf24' : 'rgba(15, 23, 42, 0.85)'}
                stroke="#fbbf24"
                strokeWidth={2.2}
              />
              <text
                x={c.x}
                y={c.y + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill={current || done ? '#0f172a' : '#fbbf24'}
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                {wp.index + 1}
              </text>
              <text
                x={c.x + 16}
                y={c.y + 4}
                fontSize={12}
                fontWeight={600}
                fill="#f8fafc"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                {wp.name}
              </text>
            </g>
          )
        })}

        {/* Floor labels on the right of the tower */}
        {model.labelFloors.map((floor) => {
          const z = model.floorZ.get(floor.id) ?? 0
          const anchor = p(HALF + 8, 0, z + 4)
          const active = floor.id === model.activeFloorId
          return (
            <text
              key={`lbl-${floor.id}`}
              x={anchor.x + 8}
              y={anchor.y + 4}
              fontSize={active ? 13 : 11}
              fontWeight={active ? 700 : 500}
              fill={active ? '#a5f3fc' : 'rgba(226,232,240,0.65)'}
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {floor.label}
            </text>
          )
        })}
      </svg>

      <div className="demo-indoor__chrome-bottom">
        <span>
          {map3d.building.name} | {model.totalFloors} floors · {model.mappedFloors} mapped ·{' '}
          {model.floorLabel} · route {activeStep + 1}/{Math.max(1, model.routeStops.length)} · {progressPct}%
        </span>
      </div>

      {instruction ? <p className="demo-indoor__instruction">{instruction}</p> : null}
    </div>
  )
}

function buildModel(map3d: NavigateResult['map3d'], activeStep: number) {
  const locs = map3d.locations
  if (!locs.length && !map3d.routeStops.length) return null

  const samples = locs.length ? locs : map3d.routeStops
  const lats = samples.map((item) => item.latitude)
  const lngs = samples.map((item) => item.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const spanLat = Math.max(maxLat - minLat, 1e-6)
  const spanLng = Math.max(maxLng - minLng, 1e-6)

  const toXY = (lat: number, lng: number) => ({
    x: ((lng - minLng) / spanLng) * (HALF * 1.5) - HALF * 0.75,
    y: ((maxLat - lat) / spanLat) * (HALF * 1.5) - HALF * 0.75,
  })

  const floors = [...map3d.floors].sort((a, b) => a.level - b.level)
  const floorZ = new Map(floors.map((floor, index) => [floor.id, index * FLOOR_GAP]))
  const activeFloorId = map3d.routeStops[activeStep]?.floorId || map3d.selectedFloorId
  const routeStops = map3d.routeStops

  const routePts = routeStops.map((stop) => {
    const xy = toXY(stop.latitude, stop.longitude)
    return {
      ...stop,
      x: xy.x,
      y: xy.y,
      z: (floorZ.get(stop.floorId) ?? 0) + 8,
    }
  })

  // Path follows floor → elevator core → vertical rise → floor (not a diagonal through floors)
  const path3d: Vec3[] = []
  for (let i = 0; i < routePts.length; i += 1) {
    const cur = routePts[i]
    if (i === 0) {
      path3d.push({ x: cur.x, y: cur.y, z: cur.z })
      continue
    }
    const prev = routePts[i - 1]
    if (prev.floorId === cur.floorId) {
      path3d.push({ x: cur.x, y: cur.y, z: cur.z })
    } else {
      path3d.push({ x: CORE.x, y: CORE.y, z: prev.z })
      path3d.push({ x: CORE.x, y: CORE.y, z: cur.z })
      path3d.push({ x: cur.x, y: cur.y, z: cur.z })
    }
  }

  const waypoints = routePts.map((stop, index) => ({
    id: stop.id,
    index,
    name: stop.name,
    x: stop.x,
    y: stop.y,
    z: stop.z,
  }))

  // Show a few floor labels (first, mid, last, and active)
  const labelFloors = floors.filter((floor, index) => {
    if (floor.id === activeFloorId) return true
    if (index === 0 || index === floors.length - 1) return true
    if (floors.length > 4 && index === Math.floor(floors.length / 2)) return true
    return false
  })

  const mappedFloorIds = new Set(locs.map((l) => l.floorId))
  const declaredFloors = map3d.building.floors || floors.length

  return {
    floors,
    floorZ,
    routeStops,
    path3d,
    waypoints,
    labelFloors,
    activeFloorId,
    floorLabel: floors.find((floor) => floor.id === activeFloorId)?.label || 'Floor',
    totalFloors: declaredFloors,
    mappedFloors: mappedFloorIds.size || floors.length,
    cx: 0,
    cy: 0,
    cz: ((floors.length - 1) * FLOOR_GAP) / 2,
  }
}
