import { useEffect, useState } from 'react'
import type { JourneyStep, NavigateResult } from '../api/client'
import {
  enterDwellZone,
  leaveDwellZone,
  getLiveDwellSec,
  getCurrentDwellZone,
  setTrackingSyncEnabled,
} from '../mock/tracking'

/**
 * While tracking is enabled, push dwell enter/heartbeat/leave to ERP in realtime.
 */
export function useLiveDwellSync(opts: {
  enabled: boolean
  activeStep: JourneyStep | null
  navigateResult: NavigateResult | null
}) {
  const { enabled, activeStep, navigateResult } = opts
  const [liveSec, setLiveSec] = useState(0)
  const [zoneLabel, setZoneLabel] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      void leaveDwellZone().finally(() => setTrackingSyncEnabled(false))
      setLiveSec(0)
      setZoneLabel(null)
      return
    }
    setTrackingSyncEnabled(true)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !navigateResult || !activeStep) return

    const locationId =
      activeStep.stopId ||
      (activeStep.phase === 'indoor' ? navigateResult.selection.unit.id : null) ||
      navigateResult.selection.unit.id

    const zone =
      activeStep.stopName ||
      activeStep.title ||
      (activeStep.phase === 'indoor'
        ? navigateResult.selection.unit.name
        : `${activeStep.phase} · ${activeStep.instruction.slice(0, 40)}`)

    let cancelled = false
    void (async () => {
      try {
        await enterDwellZone({
          locationId,
          zone,
          propertyId:
            navigateResult.selection.complex?.id || navigateResult.selection.building.id,
          propertyName:
            navigateResult.selection.complex?.name || navigateResult.selection.building.name,
          latitude: activeStep.latitude,
          longitude: activeStep.longitude,
        })
        if (!cancelled) {
          setZoneLabel(zone)
          setSyncError(null)
        }
      } catch (e) {
        if (!cancelled) setSyncError(e instanceof Error ? e.message : 'Dwell sync failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled, activeStep, navigateResult])

  useEffect(() => {
    if (!enabled) return
    const t = window.setInterval(() => {
      setLiveSec(getLiveDwellSec())
      setZoneLabel(getCurrentDwellZone()?.zone ?? null)
    }, 1000)
    return () => window.clearInterval(t)
  }, [enabled])

  return { liveSec, zoneLabel, syncError }
}
