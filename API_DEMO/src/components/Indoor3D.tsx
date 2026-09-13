import { useMemo, useRef, useState, type PointerEvent as RE, type WheelEvent as WE } from 'react'
import type { NavigateResult } from '../api'

type Props = {
  map3d: NavigateResult['map3d']
  activeStep: number
}

type Pt = { x: number; y: number }
type Cam = { yaw: number; pitch: number; zoom: number }

const DEFAULT: Cam = { yaw: 0.55, pitch: 0.55, zoom: 1 }

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
  return { x: ox + rx * scale, y: oy - pz * scale + py * scale * 0.18 }
}

export function Indoor3D({ map3d, activeStep }: Props) {
  const [cam, setCam] = useState<Cam>(DEFAULT)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)

  const model = useMemo(() => {
    const locs = map3d.locations
    if (!locs.length) return null
    const lats = locs.map((l) => l.latitude)
    const lngs = locs.map((l) => l.longitude)
    const elevs = locs.map((l) => l.elevation)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const minE = Math.min(...elevs)
    const toXY = (lat: number, lng: number, elev: number) => {
      const x = ((lng - minLng) / Math.max(maxLng - minLng, 1e-6)) * 220 - 110
      const y = ((lat - minLat) / Math.max(maxLat - minLat, 1e-6)) * 220 - 110
      const z = (elev - minE) * 0.35
      return { x, y, z }
    }
    const floors = [...map3d.floors].sort((a, b) => a.level - b.level)
    const floorZ = new Map(floors.map((f, i) => [f.id, i * 18]))
    const units = locs.map((l) => ({ ...l, ...toXY(l.latitude, l.longitude, l.elevation), zFloor: floorZ.get(l.floorId) ?? 0 }))
    const route = map3d.routeStops.map((s) => ({
      ...s,
      ...toXY(s.latitude, s.longitude, s.elevation),
      zFloor: floorZ.get(s.floorId) ?? 0,
    }))
    return { units, route, floors, floorZ, cx: 0, cy: 0, cz: ((floors.length - 1) * 18) / 2 }
  }, [map3d])

  if (!model) return <div className="demo-indoor empty">No indoor geometry</div>

  const W = 720
  const H = 420
  const ox = W / 2
  const oy = H / 2 + 20
  const scale = 1.6

  const onPointerDown = (e: RE<SVGSVGElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: RE<SVGSVGElement>) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    setCam({
      ...cam,
      yaw: drag.current.yaw + dx * 0.01,
      pitch: clamp(drag.current.pitch + dy * 0.008, 0.15, 1.2),
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (e: WE<SVGSVGElement>) => {
    e.preventDefault()
    setCam((c) => ({ ...c, zoom: clamp(c.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.5, 2.8) }))
  }

  const p = (x: number, y: number, z: number) => project(x, y, z, ox, oy, scale, cam, model.cx, model.cy, model.cz)

  return (
    <div className="demo-indoor">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="demo-indoor__svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {model.floors.map((f) => {
          const z = model.floorZ.get(f.id) ?? 0
          const corners = [
            p(-120, -120, z),
            p(120, -120, z),
            p(120, 120, z),
            p(-120, 120, z),
          ]
          const active = f.id === map3d.selectedFloorId
          return (
            <polygon
              key={f.id}
              points={corners.map((c) => `${c.x},${c.y}`).join(' ')}
              fill={active ? 'rgba(56,189,248,0.12)' : 'rgba(148,163,184,0.05)'}
              stroke={active ? '#38bdf8' : 'rgba(148,163,184,0.35)'}
              strokeWidth={active ? 1.6 : 1}
            />
          )
        })}
        {model.units.map((u) => {
          const pt = p(u.x, u.y, u.zFloor + 2)
          const selected = u.id === map3d.selectedUnitId
          return (
            <g key={u.id}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={selected ? 5 : 3}
                fill={selected ? '#fbbf24' : '#94a3b8'}
              />
              {selected ? (
                <text x={pt.x + 8} y={pt.y + 3} fill="#e2e8f0" fontSize="11">
                  {u.name}
                </text>
              ) : null}
            </g>
          )
        })}
        {model.route.length > 1
          ? model.route.slice(1).map((stop, i) => {
              const a = model.route[i]
              const b = stop
              const pa = p(a.x, a.y, a.zFloor + 3)
              const pb = p(b.x, b.y, b.zFloor + 3)
              const lit = i < activeStep
              return (
                <line
                  key={`${a.id}-${b.id}`}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={lit ? '#22c55e' : '#64748b'}
                  strokeWidth={lit ? 3 : 1.5}
                  strokeDasharray={lit ? undefined : '4 4'}
                />
              )
            })
          : null}
        {model.route[activeStep]
          ? (() => {
              const s = model.route[activeStep]
              const pt = p(s.x, s.y, s.zFloor + 6)
              return <circle cx={pt.x} cy={pt.y} r={7} fill="#22c55e" stroke="#ecfdf5" strokeWidth={2} />
            })()
          : null}
      </svg>
      <div className="demo-indoor__hint">Drag to orbit · scroll to zoom · green path = indoor walk</div>
    </div>
  )
}
