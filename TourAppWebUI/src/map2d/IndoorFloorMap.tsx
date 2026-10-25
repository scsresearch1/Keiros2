import { useEffect, useMemo, useRef, useState, type PointerEvent as RE, type WheelEvent as WE } from 'react'
import type { NavigateResult } from '../api/client'

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
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    setFloorId(stepFloorId)
  }, [stepFloorId])

  useEffect(() => {
    setView({ x: 0, y: 0, zoom: 1 })
  }, [floorId])

  const scene = useMemo(() => buildScene(map3d, floorId, activeStep), [map3d, floorId, activeStep])
  const floor = floors.find((item) => item.id === floorId)
  const youAreHere = floorId === stepFloorId

  const onPointerDown = (event: RE<SVGSVGElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: RE<SVGSVGElement>) => {
    if (!drag.current) return
    setView((current) => ({
      ...current,
      x: drag.current!.ox + event.clientX - drag.current!.x,
      y: drag.current!.oy + event.clientY - drag.current!.y,
    }))
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onWheel = (event: WE<SVGSVGElement>) => {
    event.preventDefault()
    setView((current) => ({ ...current, zoom: clamp(current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.7, 3.2) }))
  }

  if (!scene) return <div className="floor-map floor-map--empty">No floor plan for this building</div>

  return (
    <div className="floor-map">
      {floors.length > 1 ? (
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
      ) : null}
      <div className="floor-map__canvas">
        <svg
          viewBox={`${scene.view.x} ${scene.view.y} ${scene.view.w} ${scene.view.h}`}
          className="floor-map__svg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <rect x={scene.view.x} y={scene.view.y} width={scene.view.w} height={scene.view.h} fill="#e8eaed" />
          <g transform={`translate(${view.x} ${view.y}) translate(${scene.view.x + scene.view.w / 2} ${scene.view.y + scene.view.h / 2}) scale(${view.zoom}) translate(${-(scene.view.x + scene.view.w / 2)} ${-(scene.view.y + scene.view.h / 2)})`}>
            <rect
              x={scene.plate.x}
              y={scene.plate.y}
              width={scene.plate.w}
              height={scene.plate.h}
              rx={18}
              fill="#f8f9fa"
              stroke="#dadce0"
              strokeWidth={2}
            />
            {scene.corridor ? (
              <polyline
                points={scene.corridor}
                fill="none"
                stroke="#ffffff"
                strokeWidth={22}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {scene.route ? (
              <polyline
                points={scene.route}
                fill="none"
                stroke="#1a73e8"
                strokeWidth={5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {scene.places.map((place) => (
              <g key={place.id} onClick={() => onSelectUnit?.(place.id)} style={{ cursor: onSelectUnit ? 'pointer' : undefined }}>
                <circle cx={place.x} cy={place.y} r={place.kind === 'entry' ? 6 : 4} fill={place.kind === 'entry' ? '#1a73e8' : '#80868b'} />
                <text x={place.x + 8} y={place.y - 8} fill="#3c4043" fontSize="12" fontFamily="system-ui, sans-serif">
                  {place.name}
                </text>
              </g>
            ))}
            {scene.exit ? (
              <g>
                <rect x={scene.exit.x - 46} y={scene.exit.y - 28} width={92} height={22} rx={11} fill="#fff" stroke="#f9ab00" />
                <text x={scene.exit.x} y={scene.exit.y - 13} textAnchor="middle" fill="#b06000" fontSize="11" fontFamily="system-ui, sans-serif">
                  {scene.exit.label}
                </text>
              </g>
            ) : null}
            {scene.destination ? (
              <g>
                <path
                  d={`M ${scene.destination.x} ${scene.destination.y + 4} c -8 -14 -8 -18 0 -28 c 8 10 8 14 0 28 z`}
                  fill="#ea4335"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                <text
                  x={scene.destination.x}
                  y={scene.destination.y - 32}
                  textAnchor="middle"
                  fill="#202124"
                  fontSize="13"
                  fontWeight={700}
                  fontFamily="system-ui, sans-serif"
                >
                  {scene.destination.name}
                </text>
              </g>
            ) : null}
            {scene.you && youAreHere ? (
              <g>
                <circle cx={scene.you.x} cy={scene.you.y} r={11} fill="#1a73e8" fillOpacity={0.2} />
                <circle cx={scene.you.x} cy={scene.you.y} r={7} fill="#1a73e8" stroke="#fff" strokeWidth={3} />
              </g>
            ) : null}
          </g>
          <text x={scene.view.x + 14} y={scene.view.y + 22} fill="#5f6368" fontSize="13" fontWeight={700} fontFamily="system-ui, sans-serif">
            N
          </text>
        </svg>
        <p className="floor-map__card">
          <strong>{youAreHere ? 'You' : floor?.label || 'Floor'}</strong>
          <span>{youAreHere ? instruction || scene.youName || 'Follow the blue line' : `You are on ${floors.find((item) => item.id === stepFloorId)?.label || 'another floor'}`}</span>
        </p>
        <p className="floor-map__hint">Drag to move · scroll to zoom · blue line is the walk</p>
      </div>
    </div>
  )
}

function buildScene(map3d: NavigateResult['map3d'], floorId: string, activeStep: number) {
  const onFloor = map3d.locations.filter((location) => location.floorId === floorId)
  const stops = map3d.routeStops
  const samples = onFloor.length ? onFloor : map3d.locations
  if (!samples.length) return null
  const lats = samples.map((item) => item.latitude)
  const lngs = samples.map((item) => item.longitude)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const midLat = (minLat + maxLat) / 2
  const cos = Math.cos((midLat * Math.PI) / 180) || 1
  const spanX = Math.max((maxLng - minLng) * cos, 1e-5)
  const spanY = Math.max(maxLat - minLat, 1e-5)
  const pad = 70
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
  const toXY = (lat: number, lng: number): XY => ({
    x: W / 2 + (lng - (minLng + maxLng) / 2) * cos * scale,
    y: H / 2 - (lat - midLat) * scale,
  })
  const placed = samples.map((item) => ({ ...item, ...toXY(item.latitude, item.longitude) }))
  const xs = placed.map((item) => item.x)
  const ys = placed.map((item) => item.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const margin = 56
  const view = {
    x: minX - margin,
    y: minY - margin,
    w: Math.max(maxX - minX + margin * 2, 220),
    h: Math.max(maxY - minY + margin * 2, 220),
  }
  const plate = { x: view.x + 16, y: view.y + 16, w: view.w - 32, h: view.h - 32 }
  const routePts = stops
    .map((stop, index) => ({ ...stop, index, ...toXY(stop.latitude, stop.longitude) }))
    .filter((stop) => stop.floorId === floorId)
  const route = routePts.map((stop) => `${stop.x},${stop.y}`).join(' ')
  const current = stops[activeStep]
  const you = current && current.floorId === floorId ? toXY(current.latitude, current.longitude) : null
  const destStop = stops[stops.length - 1]
  const destination =
    destStop && destStop.floorId === floorId ? { ...toXY(destStop.latitude, destStop.longitude), name: destStop.name } : null
  const leaveIndex = stops.findIndex((stop, index) => index > 0 && stop.floorId !== stops[index - 1].floorId && stops[index - 1].floorId === floorId)
  const exitStop = leaveIndex > 0 ? stops[leaveIndex - 1] : null
  const nextFloor = leaveIndex > 0 ? map3d.floors.find((item) => item.id === stops[leaveIndex].floorId) : null
  const exit = exitStop && nextFloor ? { ...toXY(exitStop.latitude, exitStop.longitude), label: `To ${nextFloor.label}` } : null
  const labeled = new Set<string>()
  if (current?.floorId === floorId) labeled.add(current.id)
  if (destStop?.floorId === floorId) labeled.add(destStop.id)
  const places = onFloor
    .filter((location) => location.id !== destStop?.id)
    .filter((location) => {
      if (onFloor.length <= 14) return true
      return labeled.has(location.id) || /entry|exit|door|stair|elevator|lobby/i.test(location.type)
    })
    .map((location) => ({
      id: location.id,
      name: location.name,
      kind: /entry|exit|door|lobby/i.test(location.type) ? 'entry' : 'room',
      ...toXY(location.latitude, location.longitude),
    }))
  return { view, plate, corridor: route, route, places, you, youName: current?.name, destination, exit }
}
