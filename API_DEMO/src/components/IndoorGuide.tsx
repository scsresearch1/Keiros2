import { useMemo, useState } from 'react'
import type { JourneyStep, NavigateResult } from '../api'
import type { LiveFix } from '../liveNavigation'
import { Indoor3D } from './Indoor3D'
import { IndoorMiniMap } from './IndoorMiniMap'

type Props = {
  map3d: NavigateResult['map3d']
  steps: JourneyStep[]
  journeyIndex: number
  active: JourneyStep
  upcoming: JourneyStep | null
  complexName?: string | null
  destination: {
    latitude: number
    longitude: number
    label: string
  }
  liveFix: LiveFix | null
  wantsLiveGps: boolean
  onPrev: () => void
  onNext: () => void
}

function floorLevel(
  map3d: NavigateResult['map3d'],
  step: JourneyStep | null | undefined,
): number | null {
  if (!step) return null
  if (step.floorId) {
    const byId = map3d.floors.find((f) => f.id === step.floorId)
    if (byId && Number.isFinite(byId.level)) return byId.level
  }
  const label = (step.floorLabel || '').trim().toLowerCase()
  if (label) {
    const byLabel = map3d.floors.find((f) => f.label.trim().toLowerCase() === label)
    if (byLabel && Number.isFinite(byLabel.level)) return byLabel.level
  }
  const stop = step.stopId
    ? map3d.routeStops.find((s) => s.id === step.stopId)
    : map3d.routeStops.find(
        (s) =>
          Math.abs(s.latitude - step.latitude) < 1e-5 &&
          Math.abs(s.longitude - step.longitude) < 1e-5,
      )
  if (stop && Number.isFinite(stop.elevation)) return stop.elevation
  return null
}

function floorChange(
  map3d: NavigateResult['map3d'],
  active: JourneyStep,
  upcoming: JourneyStep | null,
): {
  from: string
  to: string
  kind: 'stairs' | 'elevator'
  direction: 'up' | 'down' | 'same'
} | null {
  if (!upcoming || upcoming.phase !== 'indoor') return null
  const a = (active.floorLabel || '').trim()
  const b = (upcoming.floorLabel || '').trim()
  // Dedicated vertical card only when the next stop is on another floor.
  if (!a || !b || a === b) return null
  const blob = `${active.stopType || ''} ${active.stopName || ''} ${active.instruction || ''} ${upcoming.stopType || ''} ${upcoming.instruction || ''}`
  const fromLvl = floorLevel(map3d, active)
  const toLvl = floorLevel(map3d, upcoming)
  let direction: 'up' | 'down' | 'same' = 'same'
  if (fromLvl != null && toLvl != null && fromLvl !== toLvl) {
    direction = toLvl > fromLvl ? 'up' : 'down'
  } else if (/down|lower|descend/i.test(blob)) {
    direction = 'down'
  } else if (/up|upper|ascend|climb/i.test(blob)) {
    direction = 'up'
  } else {
    // Fallback: L01 < L02 style labels.
    const na = Number((a.match(/-?\d+/) || [])[0])
    const nb = Number((b.match(/-?\d+/) || [])[0])
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
      direction = nb > na ? 'up' : 'down'
    } else {
      direction = 'up'
    }
  }
  return {
    from: a,
    to: b,
    kind: /elevator|lift/i.test(blob) ? 'elevator' : 'stairs',
    direction,
  }
}

export function IndoorGuide({
  map3d,
  steps,
  journeyIndex,
  active,
  upcoming,
  complexName,
  destination,
  liveFix,
  wantsLiveGps,
  onPrev,
  onNext,
}: Props) {
  const [showOverview, setShowOverview] = useState(false)

  const indoorSteps = useMemo(
    () => steps.map((s, i) => ({ step: s, index: i })).filter((x) => x.step.phase === 'indoor'),
    [steps],
  )
  const indoorOrdinal = Math.max(
    0,
    indoorSteps.findIndex((x) => x.index === journeyIndex),
  )
  const indoorTotal = indoorSteps.length
  const indoorStep = active.indoorIndex ?? 0
  const vertical = floorChange(map3d, active, upcoming)
  const atEnd = journeyIndex >= steps.length - 1
  const building = map3d?.building?.name || 'Building'
  const title =
    active.title?.trim() ||
    active.stopName?.trim() ||
    (vertical ? (vertical.kind === 'elevator' ? 'Elevator' : 'Stairs') : null) ||
    'Inside'

  const liveHint = wantsLiveGps
    ? liveFix
      ? liveFix.accuracy >= 25
        ? `Following your phone · weak GPS ±${Math.round(liveFix.accuracy)} m`
        : `Following your phone · ±${Math.round(liveFix.accuracy)} m`
      : 'Waiting for phone GPS indoors…'
    : 'Turn on Live GPS to see the map and auto-advance near each stop'

  const verticalVerb =
    vertical?.direction === 'down'
      ? 'Go down'
      : vertical?.direction === 'up'
        ? 'Go up'
        : 'Change floor'
  const verticalBadge =
    vertical?.kind === 'elevator'
      ? 'ELV'
      : vertical?.direction === 'down'
        ? '↓'
        : '↑'

  return (
    <div className="indoor-guide">
      <header className="indoor-guide__top">
        <p className="indoor-guide__eyebrow">
          Inside · {complexName ? `${complexName} · ` : ''}
          {building}
        </p>
        <div className="indoor-guide__chips" aria-label="Indoor progress">
          {active.floorLabel ? (
            <span className="indoor-guide__chip is-floor">{active.floorLabel}</span>
          ) : null}
          <span className="indoor-guide__chip">
            Step {indoorOrdinal + 1} / {Math.max(1, indoorTotal)}
          </span>
          {active.stopType ? (
            <span className="indoor-guide__chip is-muted">{active.stopType}</span>
          ) : null}
        </div>
      </header>

      {vertical ? (
        <section
          className={`indoor-guide__vertical is-${vertical.direction}`}
          aria-live="polite"
        >
          <div className="indoor-guide__vertical-badge" aria-hidden>
            {verticalBadge}
          </div>
          <p className="indoor-guide__kicker is-vertical">
            {verticalVerb} · {vertical.from} → {vertical.to}
          </p>
          <h2 className="indoor-guide__headline">
            {vertical.kind === 'elevator' ? 'Take the elevator' : 'Take the stairs'}{' '}
            {vertical.direction === 'down' ? 'down' : 'up'} to <span>{vertical.to}</span>
          </h2>
          <p className="indoor-guide__sub">
            From {vertical.from}
            {active.instruction ? ` · ${active.instruction}` : ''}
          </p>
          {upcoming?.instruction ? (
            <p className="indoor-guide__then">Then: {upcoming.instruction}</p>
          ) : null}
        </section>
      ) : (
        <section className="indoor-guide__card" aria-live="polite">
          <p className="indoor-guide__kicker">{title}</p>
          <h2 className="indoor-guide__headline">{active.instruction}</h2>
          {active.stopName && active.stopName !== title ? (
            <p className="indoor-guide__sub">{active.stopName}</p>
          ) : null}
          {upcoming ? (
            <p className="indoor-guide__then">
              Then
              {upcoming.floorLabel && upcoming.floorLabel !== active.floorLabel
                ? ` (${upcoming.floorLabel})`
                : ''}
              : {upcoming.instruction}
            </p>
          ) : (
            <p className="indoor-guide__then">You are at the last indoor step</p>
          )}
        </section>
      )}

      {wantsLiveGps ? (
        <IndoorMiniMap liveFix={liveFix} destination={destination} />
      ) : null}

      <div className="indoor-guide__actions">
        <button type="button" className="indoor-guide__btn is-ghost" disabled={journeyIndex <= 0} onClick={onPrev}>
          Previous
        </button>
        <button
          type="button"
          className="indoor-guide__btn is-primary"
          disabled={atEnd}
          onClick={onNext}
        >
          {atEnd ? 'Arrived' : vertical ? 'I took the change' : 'Next indoor step'}
        </button>
      </div>
      <p className="indoor-guide__live">{liveHint}</p>

      {indoorTotal > 1 ? (
        <ol className="indoor-guide__rail" aria-label="Indoor stops">
          {indoorSteps.map(({ step, index }, i) => {
            const done = index < journeyIndex
            const here = index === journeyIndex
            const label = step.stopName || step.floorLabel || `Stop ${i + 1}`
            return (
              <li key={step.id || `${index}`} className={here ? 'is-here' : done ? 'is-done' : ''}>
                <span className="indoor-guide__rail-dot" aria-hidden>
                  {i + 1}
                </span>
                <span className="indoor-guide__rail-label">{label}</span>
              </li>
            )
          })}
        </ol>
      ) : null}

      <div className="indoor-guide__overview">
        <button
          type="button"
          className={`indoor-guide__overview-toggle${showOverview ? ' is-open' : ''}`}
          aria-expanded={showOverview}
          onClick={() => setShowOverview((v) => !v)}
        >
          {showOverview ? 'Hide building overview' : 'Building overview (floors)'}
        </button>
        {showOverview ? (
          <div className="indoor-guide__overview-body">
            <p className="indoor-guide__overview-hint">
              Optional — shows which floors you cross. Guidance stays in the step card above.
            </p>
            <Indoor3D
              map3d={map3d}
              activeStep={indoorStep}
              instruction={active.instruction}
              complexName={complexName ?? undefined}
              liveFix={null}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
