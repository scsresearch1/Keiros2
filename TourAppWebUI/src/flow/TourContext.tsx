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
import { nextStep, prevStep, type TourStep } from './steps'

export type DestinationPick = Hierarchy['units'][number]

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
  navigateResult: NavigateResult | null
  navigateError: string | null
  navigateLoading: boolean
  runNavigate: () => Promise<void>
  /** Re-route to a unit while staying on the navigation screen. */
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
      setHierarchyError(e instanceof Error ? e.message : 'Backend offline')
      setHierarchy(null)
    }
  }, [selectedComplexId, property])

  const runDownload = useCallback(async () => {
    setDownloadPct(0)
    setDownloadLabel('Preparing…')
    await simulateMapDownload((pct, label) => {
      setDownloadPct(pct)
      setDownloadLabel(label)
    })
    await reloadHierarchy()
    setStep('overview')
  }, [reloadHierarchy])

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
        label: `Route to ${destination.name}`,
        latitude: destination.latitude,
        longitude: destination.longitude,
      })
      setStep('routePreview')
    } catch (e) {
      setNavigateError(e instanceof Error ? e.message : 'Navigate failed')
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
        setNavigateError('Could not resolve building / floor for that place.')
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
        if (fromHierarchy) setDestination(fromHierarchy)
        else {
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
          label: `Changed destination to ${result.destination.label}`,
          latitude: result.destination.latitude,
          longitude: result.destination.longitude,
        })
        setStep('navigation')
      } catch (e) {
        setNavigateError(e instanceof Error ? e.message : 'Navigate failed')
      } finally {
        setNavigateLoading(false)
      }
    },
    [hierarchy, navigateResult, consent.tracking],
  )

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
