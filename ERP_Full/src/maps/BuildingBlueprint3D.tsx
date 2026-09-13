import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import type { Building, Floor, Location } from '../data/erpData'
import './BuildingBlueprint3D.css'

type Props = {
  building: Building
  floors: Floor[]
  locations: Location[]
  selectedFloorId?: string | null
  selectedUnitId?: string | null
  showLabels?: boolean
  compact?: boolean
  routeStops?: Location[]
  activeRouteIndex?: number
  onSelectFloor?: (floorId: string) => void
  onSelectUnit?: (unitId: string) => void
  onSelectBuilding?: (buildingId: string) => void
  onSelectRouteStep?: (index: number) => void
}

type Pt = { x: number; y: number }

type Camera = {
  yaw: number
  pitch: number
  zoom: number
}

const DEFAULT_CAM: Camera = { yaw: 0.55, pitch: 0.55, zoom: 1 }

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function wrapAngle(rad: number) {
  const t = Math.PI * 2
  return ((rad % t) + t) % t
}

/** Orbit projection: yaw 360°, pitch tilt, zoom scale. Origin at building center. */
function project(
  x: number,
  y: number,
  z: number,
  ox: number,
  oy: number,
  baseScale: number,
  cam: Camera,
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
  const rz = lz

  const cosP = Math.cos(cam.pitch)
  const sinP = Math.sin(cam.pitch)
  const py = ry * cosP - rz * sinP
  const pz = ry * sinP + rz * cosP

  const scale = baseScale * cam.zoom
  return {
    x: ox + rx * scale,
    y: oy - pz * scale + py * scale * 0.18,
  }
}

function poly(points: Pt[]) {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function line(a: Pt, b: Pt) {
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}

function slotForLevel(level: number, totalFloors: number, storyCount: number) {
  if (storyCount <= 1) return 0
  return Math.min(
    storyCount - 1,
    Math.max(0, Math.round(((level - 1) / Math.max(totalFloors - 1, 1)) * (storyCount - 1))),
  )
}

export function BuildingBlueprint3D({
  building,
  floors,
  locations,
  selectedFloorId,
  selectedUnitId,
  showLabels = true,
  compact = false,
  routeStops,
  activeRouteIndex = 0,
  onSelectFloor,
  onSelectUnit,
  onSelectBuilding,
  onSelectRouteStep,
}: Props) {
  const [cam, setCam] = useState<Camera>(DEFAULT_CAM)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    yaw: number
    pitch: number
    moved: boolean
  } | null>(null)
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)
  const suppressClickRef = useRef(false)

  const mappedFloors = useMemo(
    () => floors.filter((f) => f.buildingId === building.id).sort((a, b) => a.level - b.level),
    [floors, building.id],
  )

  const storyCount = Math.min(Math.max(building.floors, mappedFloors.length, 4), compact ? 10 : 16)
  const W = compact ? 3.2 : 4.2
  const D = compact ? 2.4 : 3.2
  const storyH = compact ? 0.38 : 0.48
  const groundH = storyH * 1.35

  const vbW = compact ? 280 : 440
  const vbH = compact ? 260 : 420
  const baseScale = compact ? 36 : 48
  const ox = vbW / 2
  const oy = vbH / 2 + (compact ? 12 : 18)

  const stories = useMemo(() => {
    const rows: Array<{
      index: number
      z0: number
      z1: number
      floor: Floor | null
      mapped: boolean
      active: boolean
    }> = []

    for (let i = 0; i < storyCount; i += 1) {
      const z0 = i === 0 ? 0 : groundH + (i - 1) * storyH
      const z1 = i === 0 ? groundH : groundH + i * storyH
      rows.push({ index: i, z0, z1, floor: null, mapped: false, active: false })
    }

    const used = new Set<number>()
    mappedFloors.forEach((f) => {
      let slot = slotForLevel(f.level, building.floors, storyCount)
      while (used.has(slot) && slot < storyCount - 1) slot += 1
      while (used.has(slot) && slot > 0) slot -= 1
      used.add(slot)
      rows[slot].floor = f
      rows[slot].mapped = true
      rows[slot].active = f.id === selectedFloorId
    })

    return rows
  }, [building.floors, groundH, mappedFloors, selectedFloorId, storyCount, storyH])

  const floorUnits = useMemo(
    () => (selectedFloorId ? locations.filter((l) => l.floorId === selectedFloorId) : []),
    [locations, selectedFloorId],
  )

  const buildingLocs = useMemo(
    () => locations.filter((l) => l.buildingId === building.id),
    [locations, building.id],
  )

  const topZ = stories[stories.length - 1]?.z1 ?? storyH
  const roofZ = topZ + storyH * 0.3
  const cx = W / 2
  const cy = D / 2
  const cz = topZ / 2

  const corner = useCallback(
    (x: number, y: number, z: number) => project(x, y, z, ox, oy, baseScale, cam, cx, cy, cz),
    [baseScale, cam, cx, cy, cz, ox, oy],
  )

  const stopModelPoint = useCallback(
    (stop: Location): { x: number; y: number; z: number } | null => {
      // Map stop onto this building's volume (same building or campus hop placed at facade)
      const story =
        stories.find((s) => s.floor?.id === stop.floorId) ??
        stories.find((s) => s.floor?.level === stop.elevation) ??
        (stop.buildingId === building.id
          ? stories[
              slotForLevel(
                stop.floorLabel.match(/\d+/) ? Number(stop.floorLabel.replace(/\D/g, '')) || 1 : 1,
                building.floors,
                storyCount,
              )
            ]
          : null)

      const z =
        story?.z1 ??
        (stop.buildingId === building.id ? topZ * 0.5 : topZ * 0.15)

      if (!buildingLocs.length) {
        return { x: W * 0.5, y: D * 0.5, z: z + 0.08 }
      }

      const lats = buildingLocs.map((l) => l.latitude)
      const lngs = buildingLocs.map((l) => l.longitude)
      const minLat = Math.min(...lats)
      const maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs)
      const maxLng = Math.max(...lngs)
      const u = maxLng === minLng ? 0.5 : (stop.longitude - minLng) / (maxLng - minLng)
      const v = maxLat === minLat ? 0.5 : (stop.latitude - minLat) / (maxLat - minLat)
      const outside = stop.buildingId !== building.id
      return {
        x: clamp(0.25 + u * (W - 0.5), 0.15, W - 0.15) + (outside ? W * 0.05 : 0),
        y: clamp(0.25 + v * (D - 0.5), 0.15, D - 0.15),
        z: z + 0.08,
      }
    },
    [W, D, building.floors, building.id, buildingLocs, stories, storyCount, topZ],
  )

  const routePoints = useMemo(() => {
    if (!routeStops?.length) return []
    return routeStops.map((stop, index) => {
      const model = stopModelPoint(stop)
      if (!model) return null
      return { stop, index, screen: corner(model.x, model.y, model.z), model }
    }).filter((p): p is NonNullable<typeof p> => Boolean(p))
  }, [corner, routeStops, stopModelPoint])

  const c = {
    flb: corner(0, 0, 0),
    frb: corner(W, 0, 0),
    brb: corner(W, D, 0),
    blb: corner(0, D, 0),
    flt: corner(0, 0, topZ),
    frt: corner(W, 0, topZ),
    brt: corner(W, D, topZ),
    blt: corner(0, D, topZ),
    rfl: corner(0.12, 0.12, roofZ),
    rfr: corner(W - 0.12, 0.12, roofZ),
    rbr: corner(W - 0.12, D - 0.12, roofZ),
    rbl: corner(0.12, D - 0.12, roofZ),
    p0: corner(W * 0.55, D * 0.12, roofZ),
    p1: corner(W * 0.88, D * 0.12, roofZ),
    p2: corner(W * 0.88, D * 0.42, roofZ),
    p3: corner(W * 0.55, D * 0.42, roofZ),
    p0t: corner(W * 0.55, D * 0.12, roofZ + storyH * 0.55),
    p1t: corner(W * 0.88, D * 0.12, roofZ + storyH * 0.55),
    p2t: corner(W * 0.88, D * 0.42, roofZ + storyH * 0.55),
    p3t: corner(W * 0.55, D * 0.42, roofZ + storyH * 0.55),
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: cam.yaw,
      pitch: cam.pitch,
      moved: false,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    setCam((prev) => ({
      ...prev,
      yaw: wrapAngle(drag.yaw - dx * 0.01),
      pitch: clamp(drag.pitch + dy * 0.008, 0.12, 1.35),
    }))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    dragRef.current = null
    setDragging(false)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const delta = event.deltaY > 0 ? 0.9 : 1.1
    setCam((prev) => ({ ...prev, zoom: clamp(prev.zoom * delta, 0.45, 2.8) }))
  }

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      pinchRef.current = { dist, zoom: cam.zoom }
      dragRef.current = null
    }
  }

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && pinchRef.current) {
      event.preventDefault()
      const [a, b] = [event.touches[0], event.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const ratio = dist / Math.max(pinchRef.current.dist, 1)
      setCam((prev) => ({
        ...prev,
        zoom: clamp(pinchRef.current!.zoom * ratio, 0.45, 2.8),
      }))
    }
  }

  const onTouchEnd = () => {
    if (pinchRef.current) pinchRef.current = null
  }

  const safeClick = (fn?: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation()
    if (suppressClickRef.current) return
    fn?.()
  }

  const zoomBy = (factor: number) => {
    setCam((prev) => ({ ...prev, zoom: clamp(prev.zoom * factor, 0.45, 2.8) }))
  }

  const yawDeg = Math.round((cam.yaw * 180) / Math.PI) % 360

  return (
    <div
      className={`k-bp3d${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}
      role="img"
      aria-label={`${building.name} 3D blueprint — drag to rotate, scroll to zoom`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="k-bp3d__controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="k-bp3d__ctrl" onClick={() => zoomBy(1.15)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" className="k-bp3d__ctrl" onClick={() => zoomBy(1 / 1.15)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className="k-bp3d__ctrl k-bp3d__ctrl--wide"
          onClick={() => setCam(DEFAULT_CAM)}
          title="Reset view"
        >
          Reset
        </button>
      </div>
      <p className="k-bp3d__hint">Drag to rotate · Scroll / pinch to zoom · {yawDeg}°</p>

      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="k-bp3d__svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id={`bp-grid-${building.id}`} width="18" height="18" patternUnits="userSpaceOnUse">
            <path d="M 18 0 L 0 0 0 18" fill="none" stroke="rgba(226,232,240,0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={vbW} height={vbH} fill="#0a1a3a" />
        <rect width={vbW} height={vbH} fill={`url(#bp-grid-${building.id})`} />

        <g className="k-bp3d__building" onClick={safeClick(() => onSelectBuilding?.(building.id))}>
          <polygon points={poly([c.flb, c.frb, c.brb, c.blb])} fill="rgba(2,6,23,0.35)" stroke="none" />
          <polygon
            points={poly([c.frb, c.brb, c.brt, c.frt])}
            fill="rgba(14, 36, 78, 0.55)"
            stroke="#e8eefc"
            strokeWidth="1.2"
          />
          <polygon
            points={poly([c.flb, c.frb, c.frt, c.flt])}
            fill="rgba(12, 30, 68, 0.32)"
            stroke="#e8eefc"
            strokeWidth="1.4"
          />
          <path d={line(c.flb, c.flt)} stroke="#e8eefc" strokeWidth="1.2" fill="none" />
          <path d={line(c.blb, c.blt)} stroke="#c5d0e8" strokeWidth="1" fill="none" opacity="0.7" />
          <path d={line(c.flb, c.blb)} stroke="#c5d0e8" strokeWidth="1" fill="none" opacity="0.5" />

          {stories.map((story) => {
            const fl = corner(0, 0, story.z1)
            const fr = corner(W, 0, story.z1)
            const br = corner(W, D, story.z1)
            const bl = corner(0, D, story.z1)
            const stroke = story.active ? '#5eead4' : story.mapped ? '#9eb6e8' : '#6b7fa8'
            const weight = story.active ? 2.4 : 1
            const zMid = (story.z0 + story.z1) / 2
            const windows: string[] = []
            const cols = 5
            for (let col = 0; col < cols; col += 1) {
              const x0 = 0.28 + (col / cols) * (W - 0.45)
              const x1 = x0 + ((W - 0.5) / cols) * 0.55
              const wz0 = story.z0 + (story.z1 - story.z0) * (story.index === 0 ? 0.38 : 0.22)
              const wz1 = story.z1 - (story.z1 - story.z0) * 0.16
              windows.push(
                poly([corner(x0, 0, wz0), corner(x1, 0, wz0), corner(x1, 0, wz1), corner(x0, 0, wz1)]),
              )
            }
            for (let col = 0; col < 3; col += 1) {
              const y0 = 0.28 + (col / 3) * (D - 0.45)
              const y1 = y0 + ((D - 0.55) / 3) * 0.5
              const wz0 = story.z0 + (story.z1 - story.z0) * (story.index === 0 ? 0.38 : 0.22)
              const wz1 = story.z1 - (story.z1 - story.z0) * 0.16
              windows.push(
                poly([
                  corner(W, y0, wz0),
                  corner(W, y1, wz0),
                  corner(W, y1, wz1),
                  corner(W, y0, wz1),
                ]),
              )
            }
            if (story.index === 0) {
              for (let col = 0; col < 3; col += 1) {
                const x0 = 0.35 + col * ((W - 0.7) / 3)
                const x1 = x0 + ((W - 0.7) / 3) * 0.72
                windows.push(
                  poly([
                    corner(x0, 0, 0.06),
                    corner(x1, 0, 0.06),
                    corner(x1, 0, zMid),
                    corner(x0, 0, zMid),
                  ]),
                )
              }
            }

            // Label anchor: outward-facing side based on yaw so text stays readable
            const labelAt = corner(W + 0.15, D * 0.35, story.z1)

            return (
              <g
                key={`story-${story.index}`}
                className={
                  story.active
                    ? 'k-bp3d__story is-active'
                    : story.mapped
                      ? 'k-bp3d__story is-mapped'
                      : 'k-bp3d__story'
                }
                onClick={safeClick(() => {
                  if (story.floor) onSelectFloor?.(story.floor.id)
                })}
                style={{ cursor: story.floor ? 'pointer' : 'grab' }}
              >
                <path d={line(fl, fr)} stroke={stroke} strokeWidth={weight} fill="none" />
                <path d={line(fr, br)} stroke={stroke} strokeWidth={weight} fill="none" opacity="0.85" />
                <path d={line(br, bl)} stroke={stroke} strokeWidth={Math.max(0.6, weight - 0.4)} fill="none" opacity="0.45" />
                <path d={line(bl, fl)} stroke={stroke} strokeWidth={Math.max(0.6, weight - 0.4)} fill="none" opacity="0.45" />
                {story.active ? (
                  <polygon
                    points={poly([fl, fr, br, bl])}
                    fill="rgba(94, 234, 212, 0.2)"
                    stroke="#5eead4"
                    strokeWidth="1.5"
                  />
                ) : null}
                {windows.map((pts, wi) => (
                  <polygon
                    key={wi}
                    points={pts}
                    fill="none"
                    stroke={story.active ? '#a7f3d0' : '#b8c7e6'}
                    strokeWidth="0.9"
                    opacity={story.index === 0 ? 0.95 : 0.72}
                  />
                ))}
                {showLabels && story.mapped && story.floor ? (
                  <text
                    x={labelAt.x}
                    y={labelAt.y}
                    className={story.active ? 'k-bp3d__label is-active' : 'k-bp3d__label'}
                  >
                    {story.floor.label}
                  </text>
                ) : null}
              </g>
            )
          })}

          <polygon
            points={poly([c.flt, c.frt, c.brt, c.blt])}
            fill="rgba(18, 42, 88, 0.5)"
            stroke="#e8eefc"
            strokeWidth="1.3"
          />
          <polygon points={poly([c.rfl, c.rfr, c.rbr, c.rbl])} fill="none" stroke="#d7e3ff" strokeWidth="1" />
          <polygon points={poly([c.p0, c.p1, c.p2, c.p3])} fill="none" stroke="#e8eefc" strokeWidth="1" />
          <polygon
            points={poly([c.p0t, c.p1t, c.p2t, c.p3t])}
            fill="rgba(20,48,96,0.5)"
            stroke="#e8eefc"
            strokeWidth="1"
          />
          <path d={line(c.p0, c.p0t)} stroke="#e8eefc" strokeWidth="1" fill="none" />
          <path d={line(c.p1, c.p1t)} stroke="#e8eefc" strokeWidth="1" fill="none" />
          <path d={line(c.p2, c.p2t)} stroke="#e8eefc" strokeWidth="1" fill="none" />
          <path d={line(c.p3, c.p3t)} stroke="#e8eefc" strokeWidth="1" fill="none" />
        </g>

        {showLabels &&
          !routeStops?.length &&
          floorUnits.slice(0, compact ? 4 : 8).map((unit, index) => {
            const story = stories.find((s) => s.floor?.id === unit.floorId)
            if (!story) return null
            const cols = 4
            const u = (index % cols) / cols
            const v = Math.floor(index / cols) / 3
            const p = corner(0.45 + u * (W - 0.9), 0.35 + v * (D - 0.7), story.z1 + 0.02)
            const hot = unit.id === selectedUnitId
            return (
              <g
                key={unit.id}
                className={hot ? 'k-bp3d__unit is-hot' : 'k-bp3d__unit'}
                onClick={safeClick(() => onSelectUnit?.(unit.id))}
                style={{ cursor: 'pointer' }}
              >
                <circle cx={p.x} cy={p.y} r={hot ? 5 : 3.5} fill={hot ? '#fbbf24' : '#7dd3fc'} />
                <text x={p.x + 7} y={p.y + 3} className={hot ? 'k-bp3d__label is-hot' : 'k-bp3d__label'}>
                  {unit.name}
                </text>
              </g>
            )
          })}

        {routePoints.length > 0 ? (
          <g className="k-bp3d__route">
            {routePoints.slice(0, -1).map((point, index) => {
              const next = routePoints[index + 1]
              const activeSeg = index === activeRouteIndex || index + 1 === activeRouteIndex
              return (
                <path
                  key={`seg-${point.index}`}
                  d={line(point.screen, next.screen)}
                  stroke={activeSeg ? '#fbbf24' : '#f59e0b'}
                  strokeWidth={activeSeg ? 3.2 : 2.2}
                  fill="none"
                  opacity={activeSeg ? 1 : 0.55}
                  strokeLinecap="round"
                />
              )
            })}
            {routePoints.map((point) => {
              const active = point.index === activeRouteIndex
              return (
                <g
                  key={`rp-${point.index}`}
                  className={active ? 'k-bp3d__route-stop is-active' : 'k-bp3d__route-stop'}
                  onClick={safeClick(() => onSelectRouteStep?.(point.index))}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={point.screen.x}
                    cy={point.screen.y}
                    r={active ? 9 : 6}
                    fill={active ? '#fbbf24' : '#0f172a'}
                    stroke={active ? '#fef3c7' : '#fbbf24'}
                    strokeWidth={active ? 2.5 : 1.8}
                  />
                  <text
                    x={point.screen.x}
                    y={point.screen.y + 3.5}
                    textAnchor="middle"
                    className="k-bp3d__route-num"
                  >
                    {point.index + 1}
                  </text>
                  {showLabels ? (
                    <text
                      x={point.screen.x + 12}
                      y={point.screen.y + 4}
                      className={active ? 'k-bp3d__label is-hot' : 'k-bp3d__label'}
                    >
                      {point.stop.name}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </g>
        ) : null}
      </svg>
      <div className="k-bp3d__caption">
        <strong>{building.name}</strong>
        <span>
          {building.floors} floors · {mappedFloors.length} mapped
          {selectedFloorId
            ? ` · ${mappedFloors.find((f) => f.id === selectedFloorId)?.label ?? ''}`
            : ''}
          {routeStops?.length ? ` · route ${Math.min(activeRouteIndex + 1, routeStops.length)}/${routeStops.length}` : ''}
          {' · '}
          {Math.round(cam.zoom * 100)}%
        </span>
      </div>
    </div>
  )
}

type CampusProps = {
  buildings: Building[]
  floors: Floor[]
  locations: Location[]
  showLabels?: boolean
  onSelectBuilding: (id: string) => void
}

export function CampusBlueprint3D({
  buildings,
  floors,
  locations,
  showLabels,
  onSelectBuilding,
}: CampusProps) {
  return (
    <div className="k-bp3d-campus">
      {buildings.map((building) => (
        <BuildingBlueprint3D
          key={building.id}
          building={building}
          floors={floors}
          locations={locations}
          showLabels={showLabels}
          compact
          onSelectBuilding={onSelectBuilding}
        />
      ))}
    </div>
  )
}
