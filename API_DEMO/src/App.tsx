import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  fetchHealth,
  fetchHierarchy,
  navigate,
  phaseLabel,
  type Hierarchy,
  type NavigateResult,
} from './api'
import { OutdoorMap } from './components/OutdoorMap'
import { IndoorGuide } from './components/IndoorGuide'
import { StartLocationPanel } from './components/StartLocationPanel'
import { NavGuidanceBanner } from './components/NavGuidanceBanner'
import { AutocompleteField, type AutocompleteOption } from './components/AutocompleteField'
import { speakWeakGpsAlert, unlockVoiceFromGesture, useDirectionVoice } from './voiceGuide'
import { withLiveDrive } from './liveDrive'
// import { attachLotToResult, withLiveDrive } from './liveDrive' // Via parking
import {
  corridorTravelMode,
  inferTravelMode,
  matchLiveProgress,
  requestCompassPermission,
  useGeolocationWatch,
  type LiveFix,
  type LiveProgress,
  type TravelMode,
} from './liveNavigation'
import { rerouteFromLiveFix } from './smartReroute'
import { AT_ENTRANCE_M } from './outdoorLegs'
import { haversineM } from './liveNavigation'
import type { StartPoint } from './startLocation'

/** Phone is at the door / inside — not “near the block”. */
const ENTERED_BUILDING_M = AT_ENTRANCE_M

const DEMO_KEY = 'keiros_live_ot_demo_map_nav_2026'
const KEY_STORAGE = 'keiros_api_demo_key'

type StartMode = 'demo' | 'live' | 'custom'

function approxMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  return Math.hypot(
    (aLat - bLat) * 111_320,
    (aLng - bLng) * 111_320 * Math.cos((aLat * Math.PI) / 180),
  )
}

/** Inject outdoor/walk LineString coords into journey steps so off-route uses the drawn path. */
function enrichStepsWithRouteGeometry(
  result: NavigateResult,
  corridor?: { drive?: [number, number][]; walk?: [number, number][] },
) {
  const steps = result.journey.steps.map((s) => ({ ...s }))
  const outdoorCoords =
    (corridor?.drive && corridor.drive.length > 1
      ? corridor.drive
      : result.outdoor?.geometry?.coordinates) ?? null
  const walkCoords =
    (corridor?.walk && corridor.walk.length > 1
      ? corridor.walk
      : result.walk?.geometry?.coordinates) ?? null

  if (outdoorCoords && outdoorCoords.length > 1) {
    const driveIdx = steps.findIndex((s) => s.phase === 'drive' || s.phase === 'outdoor')
    if (driveIdx >= 0) {
      const existing = steps[driveIdx].geometry?.length ?? 0
      if (existing < outdoorCoords.length) {
        steps[driveIdx] = { ...steps[driveIdx], geometry: outdoorCoords }
      }
    } else {
      steps.unshift({
        id: 'live-drive-corridor',
        phase: 'drive',
        index: 0,
        instruction: 'Follow the drive route',
        latitude: outdoorCoords[0][1],
        longitude: outdoorCoords[0][0],
        geometry: outdoorCoords,
      })
    }
  }

  if (walkCoords && walkCoords.length > 1) {
    const walkIdx = steps.findIndex((s) => s.phase === 'walk')
    if (walkIdx >= 0) {
      const existing = steps[walkIdx].geometry?.length ?? 0
      if (existing < walkCoords.length) {
        steps[walkIdx] = { ...steps[walkIdx], geometry: walkCoords }
      }
    }
  }

  return steps
}

function readCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot read the current location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Allow location for this site in the phone browser, then tap Live again.'
              : 'Could not read GPS. Turn on Location and try Live again.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) || '')
  const [keyInput, setKeyInput] = useState(apiKey || DEMO_KEY)
  const [apiOk, setApiOk] = useState<boolean | null>(null)
  const [dataMode, setDataMode] = useState<string | null>(null)
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [complexId, setComplexId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [result, setResult] = useState<NavigateResult | null>(null)
  const [journeyIndex, setJourneyIndex] = useState(0)
  const [startMode, setStartMode] = useState<StartMode>('demo')
  /** Via parking UI/flow disabled for now — always point-to-point to the unit. */
  // const [viaParking, setViaParking] = useState(false)
  /** Demo Mode is the default start — destination can be chosen immediately. */
  const [startReady, setStartReady] = useState(true)
  const [liveSelected, setLiveSelected] = useState(false)
  const [customOrigin, setCustomOrigin] = useState<StartPoint | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  /** Google Maps–style live GPS follow. Next/Previous stay available as optional manual control. */
  const [liveNav, setLiveNav] = useState(false)
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null)
  const [recalculating, setRecalculating] = useState(false)
  const manualHoldUntil = useRef(0)
  const rerouteLockUntil = useRef(0)
  const lastOffRouteAt = useRef(0)
  /** Google-like: require consecutive off-route fixes before recalculating. */
  const offRouteStreak = useRef(0)
  const rerouteInFlight = useRef(false)
  /** GPS walk vs drive — hysteresis in inferTravelMode; streak confirms a switch. */
  const travelModeRef = useRef<TravelMode | null>(null)
  const travelModeSwitchStreak = useRef(0)
  const [travelMode, setTravelMode] = useState<TravelMode | null>(null)
  /** Prior GPS sample — derive speed when the OS leaves coords.speed null. */
  const prevMotionFixRef = useRef<LiveFix | null>(null)
  /** Dense map polylines from OutdoorMap (lng,lat) — preferred for off-route. */
  const routeCorridorRef = useRef<{
    drive?: [number, number][]
    walk?: [number, number][]
  }>({})
  /** Guidance steps that match the painted blue/red path (fixes left/right vs map). */
  const [mapGuidance, setMapGuidance] = useState<NavigateResult['journey']['steps'] | null>(null)
  const mapGuidanceSig = useRef('')

  useEffect(() => {
    void fetchHealth()
      .then((h) => {
        setApiOk(true)
        setDataMode(h.dataMode ?? null)
      })
      .catch(() => {
        setApiOk(false)
        setDataMode(null)
      })
  }, [])

  async function unlock(e: FormEvent) {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) {
      setError('Enter an API key to continue.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const health = await fetchHealth().catch(() => null)
      if (health?.dataMode) setDataMode(health.dataMode)
      const h = await fetchHierarchy(key)
      setHierarchy(h)
      setApiKey(key)
      localStorage.setItem(KEY_STORAGE, key)
      setComplexId('')
      setBuildingId('')
      setFloorId('')
      setUnitId('')
      setResult(null)
      if (health?.dataMode === 'local-seed') {
        setError(
          'API is on local-seed (not Firestore). Cameron Crossing and live sites are missing until the API reconnects to Firebase — restart the Render API service.',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate')
      setHierarchy(null)
      setApiKey('')
    } finally {
      setLoading(false)
    }
  }

  const buildings = useMemo(() => {
    if (!hierarchy || !complexId) return []
    return hierarchy.buildings.filter((b) => b.complexId === complexId)
  }, [hierarchy, complexId])

  const floors = useMemo(() => {
    if (!hierarchy || !buildingId) return []
    return hierarchy.floors.filter((f) => f.buildingId === buildingId)
  }, [hierarchy, buildingId])

  const units = useMemo(() => {
    if (!hierarchy || !floorId) return []
    return hierarchy.units.filter((u) => u.floorId === floorId)
  }, [hierarchy, floorId])

  const complexOptions = useMemo<AutocompleteOption[]>(() => {
    if (!hierarchy) return []
    const rows = hierarchy.complexes.map((c) => {
      const buildingCount = hierarchy.buildings.filter((b) => b.complexId === c.id).length
      const unitCount = hierarchy.units.filter((u) => u.complexId === c.id).length
      return {
        id: c.id,
        label: c.name,
        hint: [`${buildingCount} buildings`, `${unitCount} locations`, c.city].filter(Boolean).join(' · '),
        searchText: `${c.name} ${c.city ?? ''} ${c.address ?? ''}`,
        unitCount,
      }
    })
    // Duplicate names (e.g. empty Cameron Crossing clone): put the populated one first.
    return rows
      .sort((a, b) => b.unitCount - a.unitCount || a.label.localeCompare(b.label))
      .map(({ unitCount: _unitCount, ...option }) => option)
  }, [hierarchy])

  const buildingOptions = useMemo<AutocompleteOption[]>(() => {
    if (!hierarchy) return []
    return buildings.map((b) => {
      const floorCount = hierarchy.floors.filter((f) => f.buildingId === b.id).length
      const unitCount = hierarchy.units.filter((u) => u.buildingId === b.id).length
      return {
        id: b.id,
        label: b.name,
        hint: `${floorCount} floors · ${unitCount} locations`,
        searchText: `${b.name} ${b.complexName ?? ''}`,
      }
    })
  }, [buildings, hierarchy])

  const floorOptions = useMemo<AutocompleteOption[]>(() => {
    if (!hierarchy) return []
    return floors.map((f) => {
      const unitCount = hierarchy.units.filter((u) => u.floorId === f.id).length
      return {
        id: f.id,
        label: `${f.label} (L${f.level})`,
        hint: `${unitCount} locations`,
        searchText: `${f.label} L${f.level} ${f.buildingName}`,
      }
    })
  }, [floors, hierarchy])

  /** Unit list is scoped to the selected floor (cascade). */
  const unitOptions = useMemo<AutocompleteOption[]>(() => {
    return units.map((u) => ({
      id: u.id,
      label: u.name,
      hint: u.type,
      searchText: `${u.name} ${u.type} ${u.code}`,
    }))
  }, [units])

  /** Via parking: Parking from Keiros DB (type=Parking). Stubbed while via parking is off (Hooks order). */
  const databaseParking = useMemo(() => {
    // if (!hierarchy || !buildingId) return null
    // const near =
    //   hierarchy.units.find((u) => u.id === unitId) ||
    //   hierarchy.units.find((u) => u.buildingId === buildingId && /entry/i.test(u.type))
    // const pool = hierarchy.units.filter((u) => {
    //   if (!/^parking$/i.test(u.type)) return false
    //   if (!Number.isFinite(u.latitude) || !Number.isFinite(u.longitude)) return false
    //   if (u.buildingId === buildingId) return true
    //   if (complexId && u.complexId === complexId) return true
    //   return false
    // })
    // if (!pool.length) return null
    // const ranked = [...pool].sort((a, b) => {
    //   const aB = a.buildingId === buildingId ? 0 : 1
    //   const bB = b.buildingId === buildingId ? 0 : 1
    //   if (aB !== bB) return aB - bB
    //   if (!near) return a.name.localeCompare(b.name)
    //   const dA = Math.hypot(a.latitude - near.latitude, a.longitude - near.longitude)
    //   const dB = Math.hypot(b.latitude - near.latitude, b.longitude - near.longitude)
    //   return dA - dB
    // })
    // const p = ranked[0]
    // return { id: p.id, latitude: p.latitude, longitude: p.longitude, label: p.name || 'Parking' }
    void hierarchy
    void buildingId
    void complexId
    void unitId
    return null as {
      id: string
      latitude: number
      longitude: number
      label: string
    } | null
  }, [hierarchy, buildingId, complexId, unitId])
  void databaseParking

  /** When a parent is chosen and only one child exists, auto-select that child. */
  useEffect(() => {
    if (!complexId || buildingId) return
    if (buildings.length === 1) {
      setBuildingId(buildings[0].id)
      setFloorId('')
      setUnitId('')
      setResult(null)
    }
  }, [complexId, buildingId, buildings])

  useEffect(() => {
    if (!buildingId || floorId) return
    if (floors.length === 1) {
      setFloorId(floors[0].id)
      setUnitId('')
      setResult(null)
    }
  }, [buildingId, floorId, floors])

  useEffect(() => {
    if (!floorId || unitId) return
    if (units.length === 1) {
      setUnitId(units[0].id)
      setResult(null)
    }
  }, [floorId, unitId, units])

  function selectComplex(id: string) {
    setComplexId(id)
    setBuildingId('')
    setFloorId('')
    setUnitId('')
    setResult(null)
  }

  function selectBuilding(id: string) {
    setBuildingId(id)
    setFloorId('')
    setUnitId('')
    setResult(null)
  }

  function selectFloor(id: string) {
    setFloorId(id)
    setUnitId('')
    setResult(null)
  }

  function selectUnit(id: string) {
    setUnitId(id)
    setResult(null)
  }

  function selectionReady() {
    return Boolean(apiKey && complexId && buildingId && floorId && unitId)
  }

  async function planRoute(
    mode: StartMode,
    origin?: { latitude: number; longitude: number; label?: string },
  ) {
    if (!selectionReady()) {
      setError('Select complex, building, floor, and unit.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const explicit = mode !== 'demo' && origin
      // --- Via parking (disabled) ---
      // const dbParking = viaParking ? databaseParking : null
      // if (viaParking && !dbParking) {
      //   setError('No parking is marked in the database for this property. Add a Parking location (e.g. Black truck) or turn off Via parking.')
      //   setLoading(false)
      //   return
      // }
      const nav = await navigate(apiKey, {
        complexId,
        buildingId,
        floorId,
        unitId,
        startMode: mode,
        viaParking: false,
        // ...(dbParking
        //   ? {
        //       parkingId: dbParking.id,
        //       parkingLatitude: dbParking.latitude,
        //       parkingLongitude: dbParking.longitude,
        //       parkingLabel: dbParking.label,
        //     }
        //   : {}),
        ...(explicit
          ? {
              originLatitude: origin.latitude,
              originLongitude: origin.longitude,
              ...(origin.label ? { originLabel: origin.label } : {}),
            }
          : {}),
      })
      // Prefer DB parking pin. Skip OSM lot align when we already have Keiros parking.
      let routed = nav
      // if (viaParking && dbParking) {
      //   routed = {
      //     ...nav,
      //     parking: {
      //       latitude: dbParking.latitude,
      //       longitude: dbParking.longitude,
      //       label: dbParking.label,
      //       offsetMeters: nav.parking?.offsetMeters ?? 0,
      //       mode: 'database',
      //     },
      //   }
      //   if (explicit && origin) {
      //     routed = await withLiveDrive(routed, origin, {
      //       label: origin.label,
      //       startMode: mode === 'custom' ? 'custom' : 'live',
      //     })
      //     if (routed.origin.viaParking !== false && routed.parking?.mode !== 'on-site' && routed.parking?.mode !== 'walk-from-origin') {
      //       routed = {
      //         ...routed,
      //         parking: {
      //           latitude: dbParking.latitude,
      //           longitude: dbParking.longitude,
      //           label: dbParking.label,
      //           offsetMeters: routed.parking?.offsetMeters ?? 0,
      //           mode: 'database',
      //         },
      //       }
      //     }
      //   }
      // } else if (viaParking) {
      //   routed = explicit
      //     ? await withLiveDrive(nav, origin!, {
      //         label: origin?.label,
      //         startMode: mode === 'custom' ? 'custom' : 'live',
      //       })
      //     : await attachLotToResult(nav)
      // }
      if (explicit && origin) {
        routed = await withLiveDrive(nav, origin, {
          label: origin.label,
          startMode: mode === 'custom' ? 'custom' : 'live',
        })
      }
      // Stamp viaParking false — outdoor map goes straight toward destination (no parking stop).
      setResult({
        ...routed,
        // Fresh Navigate: clear live recalculate anchors so S is only this session start.
        origin: {
          ...routed.origin,
          viaParking: false,
          liveFrom: undefined,
          liveTravelMode: undefined,
        },
        // ...(dbParking && routed.parking?.mode === 'database'
        //   ? {
        //       parking: {
        //         latitude: dbParking.latitude,
        //         longitude: dbParking.longitude,
        //         label: dbParking.label,
        //         offsetMeters: routed.parking?.offsetMeters ?? 0,
        //         mode: 'database',
        //       },
        //     }
        //   : {}),
      })
      // Point-to-point starts at the first step (origin → destination).
      setJourneyIndex(0)
      // Do not force Floor/3D here — keep whatever the user last selected.
      // Live / custom: keep GPS follow + re-route on. Demo: leave live off (simulated start).
      setLiveNav(mode === 'live' || mode === 'custom')
      setLiveProgress(null)
      setRecalculating(false)
      setMapGuidance(null)
      mapGuidanceSig.current = ''
      offRouteStreak.current = 0
      rerouteInFlight.current = false
      travelModeRef.current = null
      travelModeSwitchStreak.current = 0
      setTravelMode(null)
      prevMotionFixRef.current = null
      // Short hold so step voice settles — do not block off-route recalculation for long.
      manualHoldUntil.current = Date.now() + (mode === 'demo' ? 4000 : 1500)
      rerouteLockUntil.current = 0
      routeCorridorRef.current = {}
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Navigate failed')
    } finally {
      setLoading(false)
    }
  }

  async function chooseStartMode(next: 'demo' | 'live') {
    if (next === 'demo') {
      setStartMode('demo')
      setStartReady(true)
      setLiveSelected(false)
      setError('')
      if (selectionReady()) await planRoute('demo')
      return
    }
    setLocating(true)
    setError('')
    try {
      void requestCompassPermission()
      const coords = await readCurrentLocation()
      setLiveSelected(true)
      setStartMode('live')
      setStartReady(true)
      if (selectionReady()) await planRoute('live', coords)
    } catch (err) {
      setStartMode('demo')
      setLiveSelected(false)
      setError(err instanceof Error ? err.message : 'Could not read the current location.')
    } finally {
      setLocating(false)
    }
  }

  async function runNavigate(e: FormEvent) {
    e.preventDefault()
    // Phones require a tap before speechSynthesis will play.
    unlockVoiceFromGesture()
    if (!startReady) {
      setError('Choose a starting position first.')
      return
    }
    if (!selectionReady()) {
      setError('Select the destination: complex, building, floor, and unit.')
      return
    }
    if (startMode === 'custom') {
      if (!customOrigin) {
        setError('Set a starting point, or switch to Demo Mode or Live.')
        return
      }
      await planRoute('custom', customOrigin)
      return
    }
    if (startMode === 'live') {
      setLocating(true)
      try {
        void requestCompassPermission()
        const coords = await readCurrentLocation()
        await planRoute('live', coords)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read the current location.')
      } finally {
        setLocating(false)
      }
      return
    }
    await planRoute('demo')
  }

  function signOut() {
    localStorage.removeItem(KEY_STORAGE)
    setApiKey('')
    setHierarchy(null)
    setResult(null)
    setComplexId('')
    setBuildingId('')
    setFloorId('')
    setUnitId('')
    setKeyInput(DEMO_KEY)
    setStartMode('demo')
    setStartReady(true)
    setLiveSelected(false)
    setCustomOrigin(null)
    setPickerOpen(false)
  }

  async function applyCustomStart(point: StartPoint) {
    setCustomOrigin(point)
    setStartMode('custom')
    setStartReady(true)
    setPickerOpen(false)
    setError('')
    if (selectionReady()) await planRoute('custom', point)
  }

  async function clearCustomStart() {
    setCustomOrigin(null)
    setPickerOpen(false)
    await chooseStartMode(liveSelected ? 'live' : 'demo')
  }

  const voiceSteps = useMemo(() => {
    const base = result?.journey.steps ?? []
    if (!mapGuidance?.length) return base
    const indoor = base.filter((s) => s.phase === 'indoor')
    return [
      ...mapGuidance.map((s, i) => ({ ...s, index: i })),
      ...indoor.map((s, i) => ({ ...s, index: mapGuidance.length + i })),
    ]
  }, [result, mapGuidance])
  const voiceCurrent = voiceSteps[journeyIndex]
    ? { ...voiceSteps[journeyIndex], id: `${result?.sessionId ?? 'route'}:${voiceSteps[journeyIndex].id}` }
    : null
  const voice = useDirectionVoice(voiceCurrent, voiceSteps[journeyIndex + 1] ?? null)

  const activePhase = voiceSteps[journeyIndex]?.phase
  const outdoorActive =
    activePhase === 'drive' || activePhase === 'walk' || activePhase === 'outdoor'

  // Phone live: watch GPS outdoors and indoors whenever Live is on.
  const wantsLiveGps =
    liveNav || startMode === 'live' || (startMode === 'custom' && liveSelected)
  const indoorActive = activePhase === 'indoor'
  const liveWatchOn = Boolean(result && wantsLiveGps && (outdoorActive || indoorActive))
  // Freeze on session start coords only — live recalculate must not re-seed GPS.
  const liveGpsAnchor = useMemo(
    () =>
      result
        ? { latitude: result.origin.latitude, longitude: result.origin.longitude }
        : null,
    [result?.origin.latitude, result?.origin.longitude],
  )
  const { fix: liveFix, error: liveGpsError, watching: liveWatching } = useGeolocationWatch(
    liveWatchOn,
    liveGpsAnchor,
  )

  // Keep the toggle in sync when user chose Live as the start mode.
  useEffect(() => {
    if (startMode === 'live' || (startMode === 'custom' && liveSelected)) {
      setLiveNav(true)
    }
  }, [startMode, liveSelected])

  useEffect(() => {
    if (!liveWatchOn || !liveFix || !result) {
      setLiveProgress(null)
      offRouteStreak.current = 0
      return
    }

    // Weak phone GPS — short voice nudge (throttled inside speakWeakGpsAlert).
    if (liveFix.accuracy >= 25) {
      speakWeakGpsAlert(liveFix.accuracy)
    }

    const phaseNow = result.journey.steps[journeyIndex]?.phase
    const now = Date.now()

    // Indoor: follow phone GPS against indoor stop pins (no outdoor re-route).
    if (phaseNow === 'indoor') {
      const indoorSteps = result.journey.steps.filter((s) => s.phase === 'indoor')
      if (!indoorSteps.length) return
      let bestIdx = journeyIndex
      let bestDist = Infinity
      for (let i = 0; i < result.journey.steps.length; i += 1) {
        const s = result.journey.steps[i]
        if (s.phase !== 'indoor') continue
        const d = approxMeters(liveFix.latitude, liveFix.longitude, s.latitude, s.longitude)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      const arriveR = Math.max(12, Math.min(35, (liveFix.accuracy || 15) * 1.2))
      setLiveProgress({
        stepIndex: bestIdx,
        distanceToRouteM: bestDist,
        remainingM: bestDist,
        remainingSec: Math.round(bestDist / 1.2),
        toNextManeuverM: bestDist,
        snapped: { latitude: liveFix.latitude, longitude: liveFix.longitude },
        offRoute: bestDist > Math.max(40, arriveR * 2),
      })
      if (now >= manualHoldUntil.current && liveFix.accuracy < 35) {
        // Advance when near the next indoor pin (or snapped onto a later one).
        const next = Math.min(result.journey.steps.length - 1, journeyIndex + 1)
        const nextStep = result.journey.steps[next]
        if (nextStep?.phase === 'indoor') {
          const toNext = approxMeters(
            liveFix.latitude,
            liveFix.longitude,
            nextStep.latitude,
            nextStep.longitude,
          )
          if (toNext <= arriveR || (bestIdx > journeyIndex && bestDist <= arriveR * 1.4)) {
            setJourneyIndex(bestIdx > journeyIndex ? bestIdx : next)
          }
        }
      }
      return
    }

    // Walk vs drive from GPS speed (not from the current journey step alone).
    // Many phones leave coords.speed null — estimate from successive fixes.
    const prevMotion = prevMotionFixRef.current
    let derivedSpeed: number | null = null
    if (prevMotion && liveFix.timestamp > prevMotion.timestamp) {
      const dt = (liveFix.timestamp - prevMotion.timestamp) / 1000
      if (dt >= 0.4 && dt <= 12) {
        const dist = approxMeters(
          prevMotion.latitude,
          prevMotion.longitude,
          liveFix.latitude,
          liveFix.longitude,
        )
        derivedSpeed = dist / dt
      }
    }
    prevMotionFixRef.current = liveFix

    const inferred = inferTravelMode(liveFix.speed, travelModeRef.current, derivedSpeed)
    if (travelModeRef.current == null) {
      travelModeRef.current = inferred
      setTravelMode(inferred)
      travelModeSwitchStreak.current = 0
    } else if (inferred !== travelModeRef.current) {
      travelModeSwitchStreak.current += 1
    } else {
      travelModeSwitchStreak.current = 0
    }
    const confirmedModeSwitch =
      travelModeSwitchStreak.current >= 2 && inferred !== travelModeRef.current
    // Painted corridor lags motion mode when a prior recalculate failed — keep retrying.
    const corridorMode = corridorTravelMode(result)
    const stuckModeMismatch =
      travelModeRef.current != null && travelModeRef.current !== corridorMode

    // Match the SAME turn-by-turn list the banner shows (mapGuidance), so D / instruction
    // update as you drive. Fall back to server steps + drawn corridor when guidance isn't ready.
    const matchSteps = mapGuidance?.length
      ? voiceSteps
      : enrichStepsWithRouteGeometry(result, routeCorridorRef.current)
    const progress = matchLiveProgress(matchSteps, liveFix, journeyIndex)
    setLiveProgress(progress)

    // Step auto-advance can wait; off-route recalculation must not.
    if (now >= manualHoldUntil.current) {
      const target = matchSteps[progress.stepIndex]
      if (target?.phase !== 'indoor') {
        if (progress.stepIndex !== journeyIndex && progress.distanceToRouteM < 120) {
          setJourneyIndex(progress.stepIndex)
        }
      }
    }

    // Entered the building (at entrance) → start indoor. Never jump indoor from far away.
    const indoorIdx = result.journey.steps.findIndex((s) => s.phase === 'indoor')
    if (
      indoorIdx >= 0 &&
      now >= manualHoldUntil.current &&
      liveFix.accuracy < 45
    ) {
      const entry = result.entrance ?? result.journey.steps[indoorIdx]
      if (entry && Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude)) {
        const atDoor =
          approxMeters(
            liveFix.latitude,
            liveFix.longitude,
            entry.latitude,
            entry.longitude,
          ) <= ENTERED_BUILDING_M
        if (atDoor) {
          // Map-guidance steps may prefix outdoor turns — prefer UI steps index when present.
          const uiIndoor =
            mapGuidance?.length
              ? voiceSteps.findIndex((s) => s.phase === 'indoor')
              : indoorIdx
          const goTo = uiIndoor >= 0 ? uiIndoor : indoorIdx
          if (journeyIndex < goTo) {
            setJourneyIndex(goTo)
            return
          }
        }
      }
    }

    const dest = {
      latitude: result.destination.latitude,
      longitude: result.destination.longitude,
    }
    const origin = {
      latitude: result.origin.latitude,
      longitude: result.origin.longitude,
    }
    const toDestM = approxMeters(liveFix.latitude, liveFix.longitude, dest.latitude, dest.longitude)
    const toOriginM = approxMeters(liveFix.latitude, liveFix.longitude, origin.latitude, origin.longitude)
    // Ignore GPS that is nowhere near this trip (e.g. wrong continent vs Fresno demo).
    if (toDestM > 25000 && toOriginM > 25000) return

    if (progress.offRoute) {
      offRouteStreak.current += 1
    } else {
      offRouteStreak.current = 0
    }

    // Recalculate when off-route OR walk↔drive flips OR corridor still mismatches motion mode.
    const confirmedOff = offRouteStreak.current >= 2
    const shouldReroute =
      (confirmedOff || confirmedModeSwitch || stuckModeMismatch) &&
      !rerouteInFlight.current &&
      now > rerouteLockUntil.current
    if (shouldReroute) {
      // Commit motion mode only after a successful recalculate (avoids Walking + Drive steps).
      const mode: TravelMode = confirmedModeSwitch
        ? inferred
        : stuckModeMismatch
          ? (travelModeRef.current as TravelMode)
          : (travelModeRef.current ?? inferred)
      lastOffRouteAt.current = now
      rerouteInFlight.current = true
      setRecalculating(true)
      const phaseHint = mode === 'walk' ? 'walk' : 'drive'
      void rerouteFromLiveFix(result, liveFix, { phaseHint, travelMode: mode })
        .then((next) => {
          if (!next) {
            // Short backoff so walk/drive can retry instead of getting stuck.
            rerouteLockUntil.current = Date.now() + 1500
            return
          }
          travelModeRef.current = mode
          setTravelMode(mode)
          travelModeSwitchStreak.current = 0
          setResult(next)
          setJourneyIndex(0)
          manualHoldUntil.current = 0
          offRouteStreak.current = 0
          routeCorridorRef.current = {}
          rerouteLockUntil.current = Date.now() + 4000
        })
        .finally(() => {
          rerouteInFlight.current = false
          setRecalculating(false)
        })
    }
  }, [liveWatchOn, liveFix, result, journeyIndex, mapGuidance, voiceSteps])

  // Indoor Floor ↔ 3D is user-controlled only (never auto-flip on step advance).

  function bumpJourney(delta: number) {
    manualHoldUntil.current = Date.now() + 10000
    setJourneyIndex((i) => {
      const max = Math.max(0, steps.length - 1)
      const next = Math.min(max, Math.max(0, i + delta))
      // Live GPS: do not step into indoor until the phone is at the entrance.
      if (
        delta > 0 &&
        wantsLiveGps &&
        !enteredBuilding &&
        steps[next]?.phase === 'indoor'
      ) {
        return i
      }
      return next
    })
  }

  function jumpJourney(index: number) {
    manualHoldUntil.current = Date.now() + 10000
    setJourneyIndex(index)
  }

  if (!apiKey || !hierarchy) {
    return (
      <div className="demo-shell demo-shell--gate">
        <div className="demo-gate">
          <p className="demo-brand">Keiros</p>
          <h1>Map Navigation API Demo</h1>
          <p className="demo-lede">
            Client-only app. Enter an ERP API key, pick Complex → Building → Floor → Unit, and choose Demo
            Mode, Live, or a custom start. Activity appears live in ERP under API Logs & API Navigation Live.
          </p>
          <form onSubmit={unlock} className="demo-gate__form">
            <label>
              API key
              <input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="keiros_live_ot_…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="demo-hint">
              Prefer a secret issued in ERP (API Keys → Issue secret). Legacy demo prefix key:{' '}
              <code>{DEMO_KEY}</code>
            </p>
            <button type="submit" disabled={loading}>
              {loading ? 'Validating…' : 'Continue'}
            </button>
          </form>
          <p className={`demo-api-status ${apiOk === false ? 'is-bad' : apiOk ? 'is-ok' : ''}`}>
            API server:{' '}
            {apiOk === null ? 'checking…' : apiOk ? 'reachable on :8787' : 'offline — run ERP_Full/server'}
          </p>
          {error ? <p className="demo-error">{error}</p> : null}
        </div>
      </div>
    )
  }

  // Prefer turn-by-turn from the painted Google path so left/right matches the blue line.
  // (Plain const — must stay after the gate return; do not use hooks here.)
  const baseSteps = result?.journey.steps ?? []
  const steps =
    mapGuidance?.length && result
      ? [
          ...mapGuidance.map((s, i) => ({ ...s, index: i })),
          ...baseSteps
            .filter((s) => s.phase === 'indoor')
            .map((s, i) => ({ ...s, index: mapGuidance.length + i })),
        ]
      : baseSteps
  const active = steps[journeyIndex] ?? null
  const phase = active?.phase === 'outdoor' ? 'drive' : (active?.phase ?? 'drive')
  const showOutdoorMap = phase === 'drive' || phase === 'walk'
  const firstIndoorIndex = steps.findIndex((s) => s.phase === 'indoor')
  const indoorStepCount = steps.filter((s) => s.phase === 'indoor').length
  const canNavigate = Boolean(complexId && buildingId && floorId && unitId)
  const firstIndoorStep = firstIndoorIndex >= 0 ? steps[firstIndoorIndex] : null
  const entranceFocus = result
    ? {
        latitude: Number(
          result.entrance?.latitude ?? firstIndoorStep?.latitude ?? result.destination.latitude,
        ),
        longitude: Number(
          result.entrance?.longitude ?? firstIndoorStep?.longitude ?? result.destination.longitude,
        ),
        label: result.entrance?.label || firstIndoorStep?.stopName || 'Entrance',
      }
    : null
  const metersToEntrance =
    wantsLiveGps && liveFix && entranceFocus
      ? haversineM(
          liveFix.latitude,
          liveFix.longitude,
          entranceFocus.latitude,
          entranceFocus.longitude,
        )
      : null
  // Live GPS: indoor only after the phone is at the entrance (entered the building).
  // No GPS yet / still outside → stay outdoor. Live off = demo preview only.
  const enteredBuilding =
    Boolean(liveFix) &&
    liveFix!.accuracy < 45 &&
    metersToEntrance != null &&
    metersToEntrance <= ENTERED_BUILDING_M
  const indoorUnlocked = wantsLiveGps ? enteredBuilding : true

  function jumpToPhase(target: 'drive' | 'walk' | 'indoor') {
    if (target === 'indoor' && wantsLiveGps && !enteredBuilding) return
    const idx = steps.findIndex((s) => {
      if (target === 'drive') return s.phase === 'drive' || s.phase === 'outdoor'
      return s.phase === target
    })
    if (idx >= 0) jumpJourney(idx)
  }
  const selectedUnit =
    (hierarchy?.units.find((unit) => unit.id === unitId) ?? null) ||
    (units.find((unit) => unit.id === unitId) ?? null)
  const unitFocus =
    selectedUnit &&
    Number.isFinite(selectedUnit.latitude) &&
    Number.isFinite(selectedUnit.longitude) &&
    Math.abs(selectedUnit.latitude) <= 90 &&
    Math.abs(selectedUnit.longitude) <= 180
      ? { latitude: selectedUnit.latitude, longitude: selectedUnit.longitude, label: selectedUnit.name }
      : null
  const switchShowsLive = startMode === 'live' || (startMode === 'custom' && liveSelected)

  return (
    <div className="demo-shell">
      <header className="demo-top">
        <div>
          <p className="demo-brand">Keiros · API Demo</p>
          <h1>Navigate to unit</h1>
        </div>
        <button type="button" className="demo-ghost" onClick={signOut}>
          Change API key
        </button>
      </header>
      {dataMode === 'local-seed' ? (
        <p className="demo-error">
          API data mode is <code>local-seed</code> — live Firebase sites (e.g. Cameron Crossing) will not appear.
          Restart the Render API (<code>keiros-erp-api</code>) so it reconnects to Firestore.
        </p>
      ) : dataMode ? (
        <p className="demo-hint">
          Data source: <code>{dataMode}</code> · {hierarchy?.complexes.length ?? 0} complexes loaded
        </p>
      ) : null}

      <form className="demo-controls" onSubmit={runNavigate}>
        <section className="demo-step">
          <p className="demo-step__title">1 · Starting position</p>
          <div className="demo-start__bar">
            <div
              className={`demo-mode${startMode === 'custom' && startReady ? ' is-held' : ''}`}
              role="group"
              aria-label="Starting position"
            >
              <button
                type="button"
                className={startReady && startMode === 'demo' ? 'is-active' : ''}
                disabled={locating || loading}
                onClick={() => void chooseStartMode('demo')}
              >
                Demo Mode
              </button>
              <button
                type="button"
                role="switch"
                className={`demo-mode__switch${switchShowsLive ? ' is-live' : ''}`}
                aria-checked={startReady && switchShowsLive}
                aria-label={
                  startReady && startMode === 'custom'
                    ? 'Custom start is in use. Activate to return to Demo Mode or Live.'
                    : startReady && switchShowsLive
                      ? 'Live, current location'
                      : 'Demo Mode, simulated start'
                }
                disabled={locating || loading}
                onClick={() => {
                  if (startMode === 'custom') {
                    void chooseStartMode(liveSelected ? 'live' : 'demo')
                    return
                  }
                  if (!startReady) {
                    void chooseStartMode('demo')
                    return
                  }
                  void chooseStartMode(startMode === 'live' ? 'demo' : 'live')
                }}
              >
                <span className="demo-mode__knob" />
              </button>
              <button
                type="button"
                className={startReady && startMode === 'live' ? 'is-active' : ''}
                disabled={locating || loading}
                onClick={() => void chooseStartMode('live')}
              >
                Live
              </button>
            </div>
            {startMode === 'custom' && customOrigin ? (
              <div className="demo-start__chip">
                <strong>{customOrigin.label}</strong>
                <span>
                  {customOrigin.latitude.toFixed(5)}, {customOrigin.longitude.toFixed(5)}
                </span>
                <button
                  type="button"
                  className="demo-ghost demo-ghost--small"
                  onClick={() => setPickerOpen((open) => !open)}
                >
                  {pickerOpen ? 'Close' : 'Change'}
                </button>
                <button
                  type="button"
                  className="demo-ghost demo-ghost--small"
                  onClick={() => void clearCustomStart()}
                  disabled={loading || locating}
                >
                  Clear
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="demo-ghost demo-ghost--small"
                onClick={() => setPickerOpen((open) => !open)}
              >
                {pickerOpen ? 'Close map' : 'Set a point'}
              </button>
            )}
            <span className="demo-hint">
              {startMode === 'custom' && startReady
                ? 'Custom map point is the drive start.'
                : startMode === 'live' && startReady
                  ? 'Using this device as the start.'
                  : 'Demo Mode uses a simulated start. Switch to Live or set a point anytime.'}
            </span>
          </div>
          {pickerOpen ? (
            <StartLocationPanel
              initial={customOrigin}
              unit={unitFocus}
              busy={loading || locating}
              onUse={(point) => void applyCustomStart(point)}
              onClose={() => setPickerOpen(false)}
            />
          ) : null}
        </section>
        <section className="demo-step demo-step--dest">
          <p className="demo-step__title">2 · Destination</p>
          <div className="demo-dest">
            <AutocompleteField
              label="Complex"
              value={complexId}
              options={complexOptions}
              placeholder="Search complex…"
              onChange={selectComplex}
            />
            <AutocompleteField
              label="Building"
              value={buildingId}
              options={buildingOptions}
              placeholder={complexId ? 'Search building…' : 'Pick a complex first'}
              disabled={!complexId}
              emptyText={complexId ? 'No buildings match' : 'Select a complex first'}
              onChange={selectBuilding}
            />
            <AutocompleteField
              label="Floor"
              value={floorId}
              options={floorOptions}
              placeholder={buildingId ? 'Search floor…' : 'Pick a building first'}
              disabled={!buildingId}
              emptyText={buildingId ? 'No floors match' : 'Select a building first'}
              onChange={selectFloor}
            />
            <AutocompleteField
              label="Unit"
              value={unitId}
              options={unitOptions}
              placeholder={floorId ? 'Search unit, aisle, room…' : 'Pick a floor first'}
              disabled={!floorId}
              emptyText={floorId ? 'No units on this floor' : 'Select a floor first'}
              onChange={selectUnit}
            />
            <div className="demo-controls__go">
              {/* Via parking — disabled for now
              <label className="demo-via-parking">
                <input
                  type="checkbox"
                  checked={viaParking}
                  onChange={(e) => setViaParking(e.target.checked)}
                />
                Via parking
              </label>
              */}
              <button type="submit" disabled={loading || locating || !canNavigate}>
                {loading ? 'Calling API…' : 'Navigate'}
              </button>
            </div>
          </div>
          <p className="demo-hint demo-hint--tight">
            {/* {viaParking
              ? databaseParking
                ? `Drive to “${databaseParking.label}” (database parking) → walk pathways to entrance → indoor.`
                : 'Via parking needs a Parking location in this property’s database (e.g. Black truck).'
              : 'Point-to-point: your start → entrance → unit (no parking stop).'} */}
            Point-to-point: your start → entrance → unit.
          </p>
        </section>
      </form>
      {error ? <p className="demo-error">{error}</p> : null}

      {result ? (
        <>
          <div className="demo-phase-strip" aria-label="Journey phases">
            {steps.some((s) => s.phase === 'drive' || s.phase === 'outdoor') ? (
              <>
                <button
                  type="button"
                  className={phase === 'drive' ? 'is-active phase-drive' : 'phase-drive'}
                  onClick={() => jumpToPhase('drive')}
                >
                  {/* {result.origin.viaParking ? '1 · Drive to parking' : '1 · Drive to destination'} */}
                  1 · Drive to destination
                </button>
                <button
                  type="button"
                  className={phase === 'walk' ? 'is-active phase-walk' : 'phase-walk'}
                  onClick={() => jumpToPhase('walk')}
                >
                  {/* {result.origin.viaParking ? '2 · Walk to entrance' : '2 · Walk to door'} */}
                  2 · Walk to door
                </button>
                <button
                  type="button"
                  className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}
                  onClick={() => jumpToPhase('indoor')}
                  disabled={firstIndoorIndex < 0 || !indoorUnlocked}
                  title={
                    wantsLiveGps && !enteredBuilding
                      ? metersToEntrance != null
                        ? `Enter the building first · ${Math.round(metersToEntrance)} m to entrance`
                        : 'Enter the building first (Live GPS)'
                      : undefined
                  }
                >
                  3 · Inside building
                  {indoorStepCount ? ` (${indoorStepCount})` : ''}
                </button>
              </>
            ) : steps.some((s) => s.phase === 'walk') ? (
              <>
                <button
                  type="button"
                  className={phase === 'walk' ? 'is-active phase-walk' : 'phase-walk'}
                  onClick={() => jumpToPhase('walk')}
                >
                  1 · Walk to entrance
                </button>
                <button
                  type="button"
                  className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}
                  onClick={() => jumpToPhase('indoor')}
                  disabled={firstIndoorIndex < 0 || !indoorUnlocked}
                  title={
                    wantsLiveGps && !enteredBuilding
                      ? metersToEntrance != null
                        ? `Enter the building first · ${Math.round(metersToEntrance)} m to entrance`
                        : 'Enter the building first (Live GPS)'
                      : undefined
                  }
                >
                  2 · Inside building
                  {indoorStepCount ? ` (${indoorStepCount})` : ''}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={phase === 'indoor' ? 'is-active phase-inside' : 'phase-inside'}
                onClick={() => jumpToPhase('indoor')}
                disabled={firstIndoorIndex < 0 || !indoorUnlocked}
                title={
                  wantsLiveGps && !enteredBuilding
                    ? metersToEntrance != null
                      ? `Enter the building first · ${Math.round(metersToEntrance)} m to entrance`
                      : 'Enter the building first (Live GPS)'
                    : undefined
                }
              >
                Inside · to unit
                {indoorStepCount ? ` (${indoorStepCount})` : ''}
              </button>
            )}
          </div>
          {firstIndoorIndex >= 0 && phase !== 'indoor' ? (
            <div className="demo-indoor-jump">
              <button
                type="button"
                className="demo-indoor-next"
                onClick={() => jumpToPhase('indoor')}
                disabled={!indoorUnlocked}
              >
                {enteredBuilding || !wantsLiveGps
                  ? 'Start indoor navigation'
                  : 'Waiting until you enter the building'}
              </button>
              <span className="demo-hint">
                {wantsLiveGps && !enteredBuilding
                  ? metersToEntrance != null
                    ? `Stay on outdoor · ${Math.round(metersToEntrance)} m to entrance — indoor starts when you enter`
                    : 'Turn on / wait for Live GPS — indoor starts only after you enter the building'
                  : wantsLiveGps
                    ? `Entered · ${indoorStepCount} indoor step${indoorStepCount === 1 ? '' : 's'}`
                    : `Demo preview · ${indoorStepCount} step${indoorStepCount === 1 ? '' : 's'} (Live GPS required to gate on entry)`}
              </span>
            </div>
          ) : null}

          {(showOutdoorMap || phase === 'indoor') && result ? (
            <div className="demo-live-bar demo-live-bar--top">
              <button
                type="button"
                className={`demo-live-toggle${wantsLiveGps ? ' is-on' : ''}`}
                aria-pressed={wantsLiveGps}
                onClick={() => {
                  unlockVoiceFromGesture()
                  void requestCompassPermission()
                  if (startMode === 'live') {
                    setLiveNav(true)
                    return
                  }
                  setLiveNav((v) => !v)
                }}
              >
                <span className="demo-live-toggle__pulse" aria-hidden />
                {wantsLiveGps ? 'Live GPS on' : 'Live GPS off'}
              </button>
              <span className="demo-hint">
                {recalculating
                  ? 'Recalculating from your phone…'
                  : wantsLiveGps
                    ? liveWatching && liveFix
                      ? showOutdoorMap
                        ? liveProgress?.offRoute
                          ? 'Off route — finding a better path…'
                          : `Following you · ${travelMode === 'walk' ? 'Walking' : travelMode === 'drive' ? 'Driving' : '…'} · ±${Math.round(liveFix.accuracy)} m`
                        : `Indoor map on · ±${Math.round(liveFix.accuracy)} m`
                      : liveGpsError || 'Waiting for GPS — allow location in the browser'
                    : showOutdoorMap
                      ? 'Turn on to follow GPS and re-route when you leave the path'
                      : 'Turn on Live GPS to show you + the unit pin on the map'}
              </span>
            </div>
          ) : null}

          {showOutdoorMap ? (
            <OutdoorMap
              result={result}
              activeStep={active}
              weather={result.weather}
              traffic={result.outdoor.traffic}
              liveFix={wantsLiveGps ? liveFix : null}
              followLive={wantsLiveGps}
              onRouteCorridor={(corridor) => {
                routeCorridorRef.current = corridor
              }}
              onRouteGuidance={(guideSteps) => {
                const sig = guideSteps.map((s) => `${s.instruction}|${s.distanceM ?? 0}`).join('·')
                if (sig === mapGuidanceSig.current) return
                mapGuidanceSig.current = sig
                setMapGuidance(guideSteps)
                setJourneyIndex(0)
              }}
            />
          ) : active ? (
            <IndoorGuide
              map3d={result.map3d}
              steps={steps}
              journeyIndex={journeyIndex}
              active={active}
              upcoming={steps[journeyIndex + 1] ?? null}
              complexName={result.selection.complex?.name}
              destination={{
                latitude: Number(
                  result.destination.latitude ?? result.selection.unit.latitude,
                ),
                longitude: Number(
                  result.destination.longitude ?? result.selection.unit.longitude,
                ),
                label:
                  result.destination.label ||
                  result.selection.unit.name ||
                  result.selection.unit.code ||
                  'Unit',
              }}
              entrance={entranceFocus}
              liveFix={wantsLiveGps ? liveFix : null}
              wantsLiveGps={wantsLiveGps}
              onPrev={() => bumpJourney(-1)}
              onNext={() => bumpJourney(1)}
            />
          ) : null}

          {active && showOutdoorMap ? (
            <div className="demo-map-guidance">
              <NavGuidanceBanner
                active={active}
                upcoming={steps[journeyIndex + 1] ?? null}
                progress={wantsLiveGps ? liveProgress : null}
                recalculating={recalculating}
                live={wantsLiveGps && Boolean(liveFix)}
              />
            </div>
          ) : null}

          <div className="demo-journey">
            <div className="demo-steps">
              <button type="button" disabled={journeyIndex <= 0} onClick={() => bumpJourney(-1)}>
                Previous
              </button>
              <span>
                Step {journeyIndex + 1} / {steps.length}
                {active ? ` · ${phaseLabel(active.phase)}` : ''}
                {wantsLiveGps ? ' · auto' : ''}
              </span>
              <button
                type="button"
                disabled={journeyIndex >= steps.length - 1}
                onClick={() => bumpJourney(1)}
              >
                Next
              </button>
            </div>
            <p className="demo-hint demo-hint--tight">
              Next / Previous are optional — use them to preview steps. Live navigation advances as you
              walk or drive.
            </p>
            {active ? (
              <div className={`demo-step-card is-${active.phase === 'outdoor' ? 'drive' : active.phase}${liveNav && liveFix ? ' is-live-nav' : ''}`}>
                <div className="demo-voice">
                  <strong>{active.title ?? `Step ${journeyIndex + 1}`}</strong>
                  {voice.supported ? (
                    <div>
                      <button type="button" aria-pressed={voice.on} onClick={voice.toggle}>
                        {voice.on ? 'Voice on' : 'Voice off'}
                      </button>
                      <button type="button" onClick={voice.replay} disabled={!voice.on}>
                        Hear again
                      </button>
                    </div>
                  ) : (
                    <span className="demo-hint">Voice not supported in this browser</span>
                  )}
                </div>
                {voice.supported && voice.on && !voice.unlocked ? (
                  <p className="demo-hint demo-hint--voice">
                    On phones, tap <strong>Voice on</strong> or <strong>Hear again</strong> once to allow spoken
                    directions (browser audio lock).
                  </p>
                ) : null}
                <p>{active.instruction}</p>
                <p className="demo-hint">
                  {active.phase === 'drive' || active.phase === 'outdoor' ? (
                    <>
                      {active.roadName ? `${active.roadName} · ` : ''}
                      {Math.round(
                        wantsLiveGps && liveProgress
                          ? liveProgress.toNextManeuverM
                          : (active.distanceM ?? 0),
                      )}{' '}
                      m
                      {wantsLiveGps && liveProgress
                        ? ` · ${Math.round(liveProgress.remainingM)} m trip`
                        : active.durationSec != null
                          ? ` · ${active.durationSec}s`
                          : ''}
                      {active.trafficLevel ? (
                        <>
                          {' '}
                          · traffic <strong>{active.trafficLevel}</strong>
                        </>
                      ) : null}
                      {active.speedMph != null ? ` · ${active.speedMph} mph` : ''}
                    </>
                  ) : active.phase === 'walk' ? (
                    <>
                      Pedestrian ·{' '}
                      {Math.round(
                        wantsLiveGps && liveProgress
                          ? liveProgress.toNextManeuverM
                          : (active.distanceM ?? 0),
                      )}{' '}
                      m
                      {active.roadName ? ` · ${active.roadName}` : ''}
                      {' · leave vehicle at parking'}
                    </>
                  ) : (
                    <>
                      {active.stopName} · {active.floorLabel} · {active.stopType}
                      {active.distanceM ? ` · ~${active.distanceM} m` : ''}
                    </>
                  )}
                </p>
              </div>
            ) : null}

            <ol className="demo-step-list">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={i === journeyIndex ? 'is-active' : ''}
                    onClick={() => jumpJourney(i)}
                  >
                    <span className="demo-step-list__n">{i + 1}</span>
                    <span>
                      <em className={`phase-tag phase-tag--${s.phase === 'outdoor' ? 'drive' : s.phase}`}>
                        {phaseLabel(s.phase)}
                      </em>{' '}
                      {s.instruction}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      ) : (
        <p className="demo-placeholder">
          Select Complex → Building → Floor → Unit, then press Navigate. Demo Mode is already the start.
        </p>
      )}
    </div>
  )
}
