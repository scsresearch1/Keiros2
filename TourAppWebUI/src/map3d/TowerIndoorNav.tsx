import { useMemo } from 'react'
import type { NavigateResult } from '../api/client'
import {
  BuildingBlueprint3D,
  type BpFloor,
  type BpLocation,
} from './BuildingBlueprint3D'

type Props = {
  map3d: NavigateResult['map3d']
  activeIndoorStep: number
  selectedFloorId: string | null
  selectedUnitId: string | null
  onSelectFloor: (floorId: string) => void
  onSelectUnit: (unitId: string) => void
  onSelectRouteStep?: (index: number) => void
}

/** Glossy tower indoor nav — ERP blueprint style with Tour destination picking. */
export function TowerIndoorNav({
  map3d,
  activeIndoorStep,
  selectedFloorId,
  selectedUnitId,
  onSelectFloor,
  onSelectUnit,
  onSelectRouteStep,
}: Props) {
  const building = useMemo(
    () => ({
      id: map3d.building.id,
      name: map3d.building.name,
      floors: map3d.building.floors || Math.max(map3d.floors.length, 4),
      mappedFloors: map3d.floors.length,
      complexId: map3d.building.complexId,
    }),
    [map3d.building],
  )

  const floors: BpFloor[] = useMemo(
    () =>
      map3d.floors.map((f) => ({
        id: f.id,
        label: f.label,
        level: f.level,
        buildingId: f.buildingId || map3d.building.id,
        mappedPct: 100,
      })),
    [map3d.floors, map3d.building.id],
  )

  const locations: BpLocation[] = useMemo(
    () =>
      map3d.locations.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        floorId: l.floorId,
        floorLabel: floors.find((f) => f.id === l.floorId)?.label,
        buildingId: map3d.building.id,
        latitude: l.latitude,
        longitude: l.longitude,
        elevation: l.elevation,
      })),
    [map3d.locations, map3d.building.id, floors],
  )

  const routeStops: BpLocation[] = useMemo(
    () =>
      map3d.routeStops.map((s) => ({
        id: s.id,
        name: s.name,
        floorId: s.floorId,
        floorLabel: floors.find((f) => f.id === s.floorId)?.label,
        buildingId: map3d.building.id,
        latitude: s.latitude,
        longitude: s.longitude,
        elevation: s.elevation,
      })),
    [map3d.routeStops, map3d.building.id, floors],
  )

  return (
    <BuildingBlueprint3D
      building={building}
      floors={floors}
      locations={locations}
      selectedFloorId={selectedFloorId ?? map3d.selectedFloorId}
      selectedUnitId={selectedUnitId ?? map3d.selectedUnitId}
      routeStops={routeStops}
      activeRouteIndex={activeIndoorStep}
      alwaysShowUnits
      showLabels
      onSelectFloor={onSelectFloor}
      onSelectUnit={onSelectUnit}
      onSelectRouteStep={onSelectRouteStep}
    />
  )
}
