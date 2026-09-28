import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchHierarchy,
  getApiKey,
  navigate,
  type Hierarchy,
  type NavigateResult,
} from '../api/client'
import type { ConsentState } from '../permissions'
import { validatePropertyCode, type PropertyMeta } from '../mock/propertyCode'
import { simulateMapDownload } from '../mock/propertyCode'
import { startTrackingSession, recordTrackingEvent, setTrackingSyncEnabled } from '../mock/tracking'
import { buildGuidedTour, type TourStop } from '../tour/curatedTour'
import { nextStep, prevStep, type TourStep } from './steps'

export type DestinationPick = Hierarchy['units'][number]
export type TourMode = 'guided' | 'browse' | null

type TourContextValue = {
  step: TourStep
  goTo: (s: TourStep) => void
  goNext: () => void
  goBack: () => void
  consent: ConsentState
  setConsent: (c: ConsentState) => void
  property: PropertyMeta | null
  validateCode: (code: string) => Promise<void>
  codeError: string | null
  downloadPct: number
  downloadLabel: string
  runDownload: () => Promise<void>
  hierarchy: Hierarchy | null
  hierarchyError: string | null
  reloadHierarchy: () => Promise<void>
  selectedComplexId: string | null
  setSelectedComplexId: (id: string | null) => void
  destination: DestinationPick | null
  setDestination: (u: DestinationPick | null) => void
  tourMode: TourMode
  tourStops: TourStop[]
  currentStopIndex: number
  visitedStopIds: string[]
  /** True after the visitor has entered the building — remaining stops are indoor-only. */
  insideBuilding: boolean
  startGuidedTour: () => void
  startBrowseTour: () => void
  selectTourStop: (index: number) => void
  markInsideBuilding: () => void
  /** Leave the tour early — always available. */
  endTourEarly: () => void
  /** After arriving at a stop — mark visited and open next, or finish. */
  completeCurrentStop: () => Promise<'next' | 'done'>
  navigateResult: NavigateResult | null
  navigateError: string | null
  navigateLoading: boolean
  runNavigate: () => Promise<void>
  navigateToUnitId: (unitId: string, floorId?: string) => Promise<void>
  patchNavigateResult: (partial: Partial<NavigateResult>) => void
  activeStepIndex: number
  setActiveStepIndex: (i: number) => void
  trackingEnabled: boolean
  enableTracking: () => void
  resetTour: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

const initialConsent: ConsentState = {
  location: false,
  navigation: false,
  tracking: false,
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<TourStep>('splash')
  const [consent, setConsent] = useState<ConsentState>(initialConsent)
  const [property, setProperty] = useState<PropertyMeta | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [downloadPct, setDownloadPct] = useState(0)
  const [downloadLabel, setDownloadLabel] = useState('')
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null)
  const [hierarchyError, setHierarchyError] = useState<string | null>(null)
  const [selectedComplexId, setSelectedComplexId] = useState<string | null>(null)
  const [destination, setDestination] = useState<DestinationPick | null>(null)
  const [tourMode, setTourMode] = useState<TourMode>(null)
  const [tourStops, setTourStops] = useState<TourStop[]>([])
  const [currentStopIndex, setCurrentStopIndex] = useState(0)
  const [visitedStopIds, setVisitedStopIds] = useState<string[]>([])
  const [insideBuilding, setInsideBuilding] = useState(false)
  const [navigateResult, setNavigateResult] = useState<NavigateResult | null>(null)
  const [navigateError, setNavigateError] = useState<string | null>(null)
  const [navigateLoading, setNavigateLoading] = useState(false)
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [trackingEnabled, setTrackingEnabled] = useState(false)

  const goTo = useCallback((s: TourStep) => setStep(s), [])
  const goNext = useCallback(() => {
    const n = nextStep(step)
    if (n) setStep(n)
  }, [step])
  const goBack = useCallback(() => {
    const p = prevStep(step)
    if (p) setStep(p)
  }, [step])

  const validateCode = useCallback(async (code: string) => {
    setCodeError(null)
    try {
      const meta = await validatePropertyCode(code)
      setProperty(meta)
      setSelectedComplexId(meta.complexId || meta.propertyId)
      setStep('validating')
    } catch (e) {
      setCodeError(e instanceof Error ? e.message : 'Validation failed')
      throw e
    }
  }, [])

  const reloadHierarchy = useCallback(async () => {
    setHierarchyError(null)
    try {
      const data = await fetchHierarchy(getApiKey())
      setHierarchy(data)
      const preferred = property?.complexId || property?.propertyId
      if (preferred && data.complexes.some((c) => c.id === preferred)) {
        setSelectedComplexId(preferred)
      } else if (!selectedComplexId && data.complexes[0]) {
        setSelectedComplexId(data.complexes[0].id)
      }
    } catch (e) {
      setHierarchyError(e instanceof Error ? e.message : 'Map couldn’t load — try again')
      setHierarchy(null)
    }
  }, [selectedComplexId, property])

  const runDownload = useCallback(async () => {
    setDownloadPct(0)
    setDownloadLabel('Preparing your tour…')
    await simulateMapDownload((pct, label) => {
      setDownloadPct(pct)
      setDownloadLabel(label)
    })
    await reloadHierarchy()
    setStep('overview')
  }, [reloadHierarchy])

  const startGuidedTour = useCallback(() => {
    if (!hierarchy) return
    const stops = buildGuidedTour(hierarchy, selectedComplexId)
    setTourMode('guided')
    setTourStops(stops)
    setCurrentStopIndex(0)
    setVisitedStopIds([])
    setInsideBuilding(false)
    setDestination(stops[0]?.unit ?? null)
    setStep('search')
  }, [hierarchy, selectedComplexId])

  const startBrowseTour = useCallback(() => {
    setTourMode('browse')
    setTourStops([])
    setCurrentStopIndex(0)
    setInsideBuilding(false)
    setStep('search')
  }, [])

  const markInsideBuilding = useCallback(() => {
    setInsideBuilding(true)
  }, [])

  const endTourEarly = useCallback(() => {
    setStep('doorAccess')
  }, [])

  const selectTourStop = useCallback(
    (index: number) => {
      const stop = tourStops[index]
      if (!stop) return
      setCurrentStopIndex(index)
      setDestination(stop.unit)
    },
    [tourStops],
  )

  const runNavigate = useCallback(async () => {
    if (!destination) return
    setNavigateLoading(true)
    setNavigateError(null)
    try {
      const result = await navigate(getApiKey(), {
        complexId: destination.complexId,
        buildingId: destination.buildingId,
        floorId: destination.floorId,
        unitId: destination.id,
        source: 'TOUR_APP',
      })
      setNavigateResult(result)
      setActiveStepIndex(0)
      startTrackingSession(result.sessionId)
      if (consent.tracking) {
        setTrackingEnabled(true)
        setTrackingSyncEnabled(true)
      }
      recordTrackingEvent({
        kind: 'destination',
        label: `Tour stop: ${destination.name}`,
        latitude: destination.latitude,
        longitude: destination.longitude,
      })
      setStep('routePreview')
    } catch (e) {
      setNavigateError(e instanceof Error ? e.message : 'Could not plan that stop')
      setNavigateResult(null)
    } finally {
      setNavigateLoading(false)
    }
  }, [destination, consent.tracking])

  const navigateToUnitId = useCallback(
    async (unitId: string, floorId?: string) => {
      const fromHierarchy = hierarchy?.units.find((u) => u.id === unitId)
      const buildingId =
        fromHierarchy?.buildingId ||
        navigateResult?.map3d.building.id ||
        navigateResult?.selection.building.id
      const complexId =
        fromHierarchy?.complexId ??
        navigateResult?.map3d.building.complexId ??
        navigateResult?.selection.complex?.id ??
        null
      const resolvedFloor =
        floorId ||
        fromHierarchy?.floorId ||
        navigateResult?.map3d.locations.find((l) => l.id === unitId)?.floorId ||
        navigateResult?.map3d.selectedFloorId

      if (!buildingId || !resolvedFloor) {
        setNavigateError('That place isn’t on the tour map yet.')
        return
      }

      setNavigateLoading(true)
      setNavigateError(null)
      try {
        const result = await navigate(getApiKey(), {
          complexId,
          buildingId,
          floorId: resolvedFloor,
          unitId,
          source: 'TOUR_APP',
        })
        setNavigateResult(result)
        if (fromHierarchy) {
          setDestination(fromHierarchy)
          const stopIdx = tourStops.findIndex((s) => s.id === unitId)
          if (stopIdx >= 0) setCurrentStopIndex(stopIdx)
        } else {
          const loc = result.map3d.locations.find((l) => l.id === unitId)
          if (loc) {
            setDestination({
              id: loc.id,
              name: loc.name,
              type: loc.type,
              code: loc.name,
              floorId: loc.floorId,
              floorLabel: result.map3d.floors.find((f) => f.id === loc.floorId)?.label ?? '',
              buildingId: result.map3d.building.id,
              buildingName: result.map3d.building.name,
              complexId: result.map3d.building.complexId,
              complexName: result.selection.complex?.name ?? null,
              latitude: loc.latitude,
              longitude: loc.longitude,
              elevation: loc.elevation,
            })
          }
        }
        const firstIndoor = result.journey.steps.findIndex((s) => s.phase === 'indoor')
        setActiveStepIndex(firstIndoor >= 0 ? firstIndoor : 0)
        startTrackingSession(result.sessionId)
        if (consent.tracking) {
          setTrackingEnabled(true)
          setTrackingSyncEnabled(true)
        }
        recordTrackingEvent({
          kind: 'destination',
          label: `Exploring ${result.destination.label}`,
          latitude: result.destination.latitude,
          longitude: result.destination.longitude,
        })
        setStep('navigation')
      } catch (e) {
        setNavigateError(e instanceof Error ? e.message : 'Could not open that place')
      } finally {
        setNavigateLoading(false)
      }
    },
    [hierarchy, navigateResult, consent.tracking, tourStops],
  )

  const completeCurrentStop = useCallback(async (): Promise<'next' | 'done'> => {
    const current = tourStops[currentStopIndex]
    if (current) {
      setVisitedStopIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]))
    }

    // Completing the entry stop (or any stop) means we are inside for the rest of the tour
    setInsideBuilding(true)

    if (tourMode !== 'guided' || !tourStops.length) {
      setStep('doorAccess')
      return 'done'
    }

    const nextIndex = currentStopIndex + 1
    if (nextIndex >= tourStops.length) {
      setStep('doorAccess')
      return 'done'
    }

    const next = tourStops[nextIndex]
    setCurrentStopIndex(nextIndex)
    setDestination(next.unit)
    setNavigateLoading(true)
    setNavigateError(null)
    try {
      const result = await navigate(getApiKey(), {
        complexId: next.unit.complexId,
        buildingId: next.unit.buildingId,
        floorId: next.unit.floorId,
        unitId: next.unit.id,
        source: 'TOUR_APP',
      })
      setNavigateResult(result)
      // Stay inside — jump straight to indoor tips for the next place
      const firstIndoor = result.journey.steps.findIndex((s) => s.phase === 'indoor')
      setActiveStepIndex(firstIndoor >= 0 ? firstIndoor : 0)
      startTrackingSession(result.sessionId)
      recordTrackingEvent({
        kind: 'destination',
        label: `Inside tour → ${next.title}`,
        latitude: next.unit.latitude,
        longitude: next.unit.longitude,
      })
      setStep('navigation')
      return 'next'
    } catch (e) {
      setNavigateError(e instanceof Error ? e.message : 'Could not open the next place')
      setStep('search')
      return 'next'
    } finally {
      setNavigateLoading(false)
    }
  }, [tourMode, tourStops, currentStopIndex])

  const patchNavigateResult = useCallback((partial: Partial<NavigateResult>) => {
    setNavigateResult((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const enableTracking = useCallback(() => {
    setTrackingEnabled(true)
    setConsent((c) => ({ ...c, tracking: true }))
    setTrackingSyncEnabled(true)
    recordTrackingEvent({ kind: 'location', label: 'Visitor enabled journey tracking' })
  }, [])

  const resetTour = useCallback(() => {
    setStep('splash')
    setConsent(initialConsent)
    setProperty(null)
    setCodeError(null)
    setDownloadPct(0)
    setDownloadLabel('')
    setHierarchy(null)
    setHierarchyError(null)
    setSelectedComplexId(null)
    setDestination(null)
    setTourMode(null)
    setTourStops([])
    setCurrentStopIndex(0)
    setVisitedStopIds([])
    setInsideBuilding(false)
    setNavigateResult(null)
    setNavigateError(null)
    setActiveStepIndex(0)
    setTrackingEnabled(false)
  }, [])

  const value = useMemo(
    () => ({
      step,
      goTo,
      goNext,
      goBack,
      consent,
      setConsent,
      property,
      validateCode,
      codeError,
      downloadPct,
      downloadLabel,
      runDownload,
      hierarchy,
      hierarchyError,
      reloadHierarchy,
      selectedComplexId,
      setSelectedComplexId,
      destination,
      setDestination,
      tourMode,
      tourStops,
      currentStopIndex,
      visitedStopIds,
      insideBuilding,
      startGuidedTour,
      startBrowseTour,
      selectTourStop,
      markInsideBuilding,
      endTourEarly,
      completeCurrentStop,
      navigateResult,
      navigateError,
      navigateLoading,
      runNavigate,
      navigateToUnitId,
      patchNavigateResult,
      activeStepIndex,
      setActiveStepIndex,
      trackingEnabled,
      enableTracking,
      resetTour,
    }),
    [
      step,
      goTo,
      goNext,
      goBack,
      consent,
      property,
      validateCode,
      codeError,
      downloadPct,
      downloadLabel,
      runDownload,
      hierarchy,
      hierarchyError,
      reloadHierarchy,
      selectedComplexId,
      destination,
      tourMode,
      tourStops,
      currentStopIndex,
      visitedStopIds,
      insideBuilding,
      startGuidedTour,
      startBrowseTour,
      selectTourStop,
      markInsideBuilding,
      endTourEarly,
      completeCurrentStop,
      navigateResult,
      navigateError,
      navigateLoading,
      runNavigate,
      navigateToUnitId,
      patchNavigateResult,
      activeStepIndex,
      trackingEnabled,
      enableTracking,
      resetTour,
    ],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within TourProvider')
  return ctx
}
