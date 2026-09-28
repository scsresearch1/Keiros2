import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import './BuildingBlueprint3D.css'

/** Local shapes — adapted from ERP BuildingBlueprint3D for Tour App. */

export type BpBuilding = {
  id: string
  name: string
  floors: number
  mappedFloors?: number
  complexId?: string | null
}

export type BpFloor = {
  id: string
  label: string
  level: number
  buildingId: string
  mappedPct?: number
}

export type BpLocation = {
  id: string
  name: string
  type?: string
  floorId: string
  floorLabel?: string
  buildingId: string
  latitude: number
  longitude: number
  elevation: number
}

type Props = {
  building: BpBuilding
  floors: BpFloor[]
  locations: BpLocation[]
  selectedFloorId?: string | null
  selectedUnitId?: string | null
  showLabels?: boolean
  compact?: boolean
  routeStops?: BpLocation[]
  activeRouteIndex?: number
  /** When true, show unit dots on selected floor even if a route is drawn */
  alwaysShowUnits?: boolean
  /** Show every unit in the building (not only the selected floor). */
  showAllUnits?: boolean
  onSelectFloor?: (floorId: string) => void
  onSelectUnit?: (unitId: string) => void
  onSelectRouteStep?: (index: number) => void
}

type Pt = { x: number; y: number }
type Camera = { yaw: number; pitch: number; zoom: number }

const DEFAULT_CAM: Camera = { yaw: 0.48, pitch: 0.52, zoom: 1.12 }

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function wrapAngle(rad: number) {
  const t = Math.PI * 2
  return ((rad % t) + t) % t
}

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
  const cosP = Math.cos(cam.pitch)
  const sinP = Math.sin(cam.pitch)
  const py = ry * cosP - lz * sinP
  const pz = ry * sinP + lz * cosP
  const scale = baseScale * cam.zoom
  return { x: ox + rx * scale, y: oy - pz * scale + py * scale * 0.18 }
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
  alwaysShowUnits = false,
  showAllUnits = false,
  onSelectFloor,
  onSelectUnit,
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

  const storyCount = Math.min(Math.max(building.floors, mappedFloors.length, 4), compact ? 10 : 22)
  const W = compact ? 3.2 : 4.8
  const D = compact ? 2.4 : 3.6
  const storyH = compact ? 0.38 : 0.42
  const groundH = storyH * 1.35
  const vbW = compact ? 280 : 520
  const vbH = compact ? 260 : 640
  const baseScale = compact ? 36 : 58
  const ox = vbW / 2
  const oy = vbH / 2 + (compact ? 12 : 28)

  const stories = useMemo(() => {
    const rows: Array<{
      index: number
      z0: number
      z1: number
      floor: BpFloor | null
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

  const unitsToRender = useMemo(() => {
    if (showAllUnits) return locations.filter((l) => l.buildingId === building.id)
    return floorUnits
  }, [showAllUnits, locations, building.id, floorUnits])

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
    (stop: BpLocation): { x: number; y: number; z: number } | null => {
      const story =
        stories.find((s) => s.floor?.id === stop.floorId) ??
        stories.find((s) => s.floor?.level === stop.elevation) ??
        (stop.buildingId === building.id
          ? stories[
              slotForLevel(
                stop.floorLabel?.match(/\d+/)
                  ? Number(stop.floorLabel.replace(/\D/g, '')) || 1
                  : 1,
                building.floors,
                storyCount,
              )
            ]
          : null)

      const z = story?.z1 ?? (stop.buildingId === building.id ? topZ * 0.5 : topZ * 0.15)
      if (!buildingLocs.length) return { x: W * 0.5, y: D * 0.5, z: z + 0.08 }

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
    return routeStops
      .map((stop, index) => {
        const model = stopModelPoint(stop)
        if (!model) return null
        return { stop, index, screen: corner(model.x, model.y, model.z), model }
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
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
  const showUnits = alwaysShowUnits || !routeStops?.length

  return (
    <div
      className={`k-bp3d tour-bp3d${compact ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}
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
      <div className="k-bp3d__glow" aria-hidden />
      <div className="k-bp3d__controls" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="k-bp3d__ctrl" onClick={() => zoomBy(1.15)} title="Zoom in">
          +
        </button>
        <button type="button" className="k-bp3d__ctrl" onClick={() => zoomBy(1 / 1.15)} title="Zoom out">
          −
        </button>
        <button type="button" className="k-bp3d__ctrl k-bp3d__ctrl--wide" onClick={() => setCam(DEFAULT_CAM)}>
          Reset
        </button>
      </div>
      <p className="k-bp3d__hint">Drag to rotate · Pinch zoom · Tap floor / place · {yawDeg}°</p>

      <svg viewBox={`0 0 ${vbW} ${vbH}`} className="k-bp3d__svg" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`bp-sky-${building.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12306a" />
            <stop offset="55%" stopColor="#0a1a3a" />
            <stop offset="100%" stopColor="#06101f" />
          </linearGradient>
          <linearGradient id={`bp-glass-${building.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,0.35)" />
            <stop offset="50%" stopColor="rgba(99,102,241,0.22)" />
            <stop offset="100%" stopColor="rgba(45,212,191,0.28)" />
          </linearGradient>
          <linearGradient id={`bp-facade-${building.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(14,165,233,0.45)" />
            <stop offset="100%" stopColor="rgba(30,58,138,0.55)" />
          </linearGradient>
          <filter id={`bp-glow-${building.id}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id={`bp-grid-${building.id}`} width="18" height="18" patternUnits="userSpaceOnUse">
            <path d="M 18 0 L 0 0 0 18" fill="none" stroke="rgba(125,211,252,0.12)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={vbW} height={vbH} fill={`url(#bp-sky-${building.id})`} />
        <rect width={vbW} height={vbH} fill={`url(#bp-grid-${building.id})`} />

        <g className="k-bp3d__building">
          <polygon points={poly([c.flb, c.frb, c.brb, c.blb])} fill="rgba(2,6,23,0.45)" stroke="none" />
          <polygon
            points={poly([c.frb, c.brb, c.brt, c.frt])}
            fill={`url(#bp-facade-${building.id})`}
            stroke="#7dd3fc"
            strokeWidth="1.3"
          />
          <polygon
            points={poly([c.flb, c.frb, c.frt, c.flt])}
            fill={`url(#bp-glass-${building.id})`}
            stroke="#e0f2fe"
            strokeWidth="1.5"
          />
          <path d={line(c.flb, c.flt)} stroke="#a5f3fc" strokeWidth="1.3" fill="none" />
          <path d={line(c.blb, c.blt)} stroke="#67e8f9" strokeWidth="1" fill="none" opacity="0.7" />
          <path d={line(c.flb, c.blb)} stroke="#38bdf8" strokeWidth="1" fill="none" opacity="0.55" />

          {stories.map((story) => {
            const fl = corner(0, 0, story.z1)
            const fr = corner(W, 0, story.z1)
            const br = corner(W, D, story.z1)
            const bl = corner(0, D, story.z1)
            const stroke = story.active ? '#fbbf24' : story.mapped ? '#22d3ee' : '#64748b'
            const weight = story.active ? 2.6 : story.mapped ? 1.4 : 0.9
            const zMid = (story.z0 + story.z1) / 2
            const windows: string[] = []
            const cols = 5
            for (let col = 0; col < cols; col += 1) {
              const x0 = 0.28 + (col / cols) * (W - 0.45)
              const x1 = x0 + ((W - 0.45) / cols) * 0.55
              const wz0 = story.z0 + (story.z1 - story.z0) * (story.index === 0 ? 0.38 : 0.22)
              const wz1 = story.z1 - (story.z1 - story.z0) * 0.16
              windows.push(poly([corner(x0, 0, wz0), corner(x1, 0, wz0), corner(x1, 0, wz1), corner(x0, 0, wz1)]))
            }
            for (let col = 0; col < 3; col += 1) {
              const y0 = 0.28 + (col / 3) * (D - 0.45)
              const y1 = y0 + ((D - 0.55) / 3) * 0.5
              const wz0 = story.z0 + (story.z1 - story.z0) * (story.index === 0 ? 0.38 : 0.22)
              const wz1 = story.z1 - (story.z1 - story.z0) * 0.16
              windows.push(
                poly([corner(W, y0, wz0), corner(W, y1, wz0), corner(W, y1, wz1), corner(W, y0, wz1)]),
              )
            }
            if (story.index === 0) {
              for (let col = 0; col < 3; col += 1) {
                const x0 = 0.35 + col * ((W - 0.7) / 3)
                const x1 = x0 + ((W - 0.7) / 3) * 0.72
                windows.push(
                  poly([corner(x0, 0, 0.06), corner(x1, 0, 0.06), corner(x1, 0, zMid), corner(x0, 0, zMid)]),
                )
              }
            }
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
                <path
                  d={line(br, bl)}
                  stroke={stroke}
                  strokeWidth={Math.max(0.6, weight - 0.4)}
                  fill="none"
                  opacity="0.45"
                />
                <path
                  d={line(bl, fl)}
                  stroke={stroke}
                  strokeWidth={Math.max(0.6, weight - 0.4)}
                  fill="none"
                  opacity="0.45"
                />
                {story.active ? (
                  <polygon
                    points={poly([fl, fr, br, bl])}
                    fill="rgba(251, 191, 36, 0.28)"
                    stroke="#fbbf24"
                    strokeWidth="1.6"
                    filter={`url(#bp-glow-${building.id})`}
                  />
                ) : story.mapped ? (
                  <polygon points={poly([fl, fr, br, bl])} fill="rgba(34, 211, 238, 0.08)" stroke="none" />
                ) : null}
                {windows.map((pts, wi) => (
                  <polygon
                    key={wi}
                    points={pts}
                    fill={story.active ? 'rgba(251,191,36,0.18)' : 'rgba(56,189,248,0.12)'}
                    stroke={story.active ? '#fde68a' : '#7dd3fc'}
                    strokeWidth="0.9"
                    opacity={story.index === 0 ? 0.95 : 0.75}
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
            fill="rgba(56,189,248,0.25)"
            stroke="#e0f2fe"
            strokeWidth="1.3"
          />
          <polygon points={poly([c.rfl, c.rfr, c.rbr, c.rbl])} fill="none" stroke="#67e8f9" strokeWidth="1" />
          <polygon points={poly([c.p0, c.p1, c.p2, c.p3])} fill="none" stroke="#a5f3fc" strokeWidth="1" />
          <polygon
            points={poly([c.p0t, c.p1t, c.p2t, c.p3t])}
            fill="rgba(99,102,241,0.4)"
            stroke="#c4b5fd"
            strokeWidth="1"
          />
          <path d={line(c.p0, c.p0t)} stroke="#c4b5fd" strokeWidth="1" fill="none" />
          <path d={line(c.p1, c.p1t)} stroke="#c4b5fd" strokeWidth="1" fill="none" />
          <path d={line(c.p2, c.p2t)} stroke="#c4b5fd" strokeWidth="1" fill="none" />
          <path d={line(c.p3, c.p3t)} stroke="#c4b5fd" strokeWidth="1" fill="none" />
        </g>

        {showLabels &&
          showUnits &&
          unitsToRender.slice(0, compact ? 6 : showAllUnits ? 60 : 16).map((unit, index) => {
            const story = stories.find((s) => s.floor?.id === unit.floorId)
            if (!story) return null
            const cols = showAllUnits ? 5 : 4
            const peers = unitsToRender.filter((u) => u.floorId === unit.floorId)
            const localIndex = peers.findIndex((u) => u.id === unit.id)
            const u = ((localIndex >= 0 ? localIndex : index) % cols) / cols
            const v = Math.floor((localIndex >= 0 ? localIndex : index) / cols) / 4
            const p = corner(0.4 + u * (W - 0.8), 0.3 + v * (D - 0.6), story.z1 + 0.02)
            const hot = unit.id === selectedUnitId
            return (
              <g
                key={unit.id}
                className={hot ? 'k-bp3d__unit is-hot' : 'k-bp3d__unit'}
                onClick={safeClick(() => onSelectUnit?.(unit.id))}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hot ? 7 : 4.5}
                  fill={hot ? '#f472b6' : '#34d399'}
                  stroke={hot ? '#fce7f3' : '#ecfdf5'}
                  strokeWidth={hot ? 2.2 : 1.2}
                  filter={`url(#bp-glow-${building.id})`}
                />
                {(hot || !showAllUnits || peers.length <= 8) && (
                  <text x={p.x + 8} y={p.y + 3} className={hot ? 'k-bp3d__label is-hot' : 'k-bp3d__label'}>
                    {unit.name}
                  </text>
                )}
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
                  stroke={activeSeg ? '#f472b6' : '#22c55e'}
                  strokeWidth={activeSeg ? 3.4 : 2.4}
                  fill="none"
                  opacity={activeSeg ? 1 : 0.65}
                  strokeLinecap="round"
                  filter={activeSeg ? `url(#bp-glow-${building.id})` : undefined}
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
                    fill={active ? '#f472b6' : '#052e16'}
                    stroke={active ? '#fce7f3' : '#4ade80'}
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
          {routeStops?.length
            ? ` · route ${Math.min(activeRouteIndex + 1, routeStops.length)}/${routeStops.length}`
            : ''}
          {' · '}
          {Math.round(cam.zoom * 100)}%
        </span>
      </div>
    </div>
  )
}
