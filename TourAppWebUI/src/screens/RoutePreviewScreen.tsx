import { useMemo } from 'react'
import { BackChip, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { normalizePhase } from '../api/client'
import { OutdoorMap } from '../map2d/OutdoorMap'

export function RoutePreviewScreen() {
  const {
    goBack,
    goTo,
    navigateResult,
    destination,
    activeStepIndex,
    tourMode,
    tourStops,
    currentStopIndex,
  } = useTour()

  const stop = tourStops[currentStopIndex]
  const summary = useMemo(() => {
    if (!navigateResult) return null
    return {
      drive: Math.round(navigateResult.outdoor.durationMinutes),
      walk: navigateResult.walk ? Math.round(navigateResult.walk.durationMinutes) : null,
      indoor: Math.round(navigateResult.indoor.walkMinutes),
      weather: navigateResult.weather.summary,
      temp: navigateResult.weather.temperatureF,
      indoorStops: navigateResult.map3d.routeStops.length,
    }
  }, [navigateResult])

  if (!navigateResult) {
    return (
      <section className="screen screen--scroll">
        <div className="screen-pad">
          <PrimaryButton onClick={goBack}>Back</PrimaryButton>
        </div>
      </section>
    )
  }

  const active = navigateResult.journey.steps[activeStepIndex] ?? null
  const title = stop?.title ?? destination?.name ?? navigateResult.destination.label

  return (
    <section className="screen screen--journey">
      <div className="journey-map">
        <OutdoorMap
          result={navigateResult}
          activeStep={active && normalizePhase(active.phase) !== 'indoor' ? active : null}
          weather={navigateResult.weather}
          traffic={navigateResult.outdoor.traffic}
        />
        <div className="screen-top float">
          <BackChip onClick={goBack} />
        </div>
      </div>
      <div className="journey-panel">
        <p className="splash-eyebrow">
          {tourMode === 'guided' && tourStops.length
            ? currentStopIndex === 0
              ? 'Step 1 · Get inside'
              : `Inside · Place ${currentStopIndex + 1} of ${tourStops.length}`
            : 'Next on your tour'}
        </p>
        <h2>{title}</h2>
        {stop?.blurb ? <p className="muted">{stop.blurb}</p> : null}
        <div className="phase-strip static">
          {currentStopIndex === 0 ? (
            <>
              <span className="phase-drive">Arrive</span>
              <span className="phase-walk">Walk in</span>
              <span className="phase-inside is-active">Enter</span>
            </>
          ) : (
            <>
              <span className="phase-inside is-active">Already inside</span>
              <span className="phase-walk">Walk to place</span>
              <span className="phase-drive">Explore</span>
            </>
          )}
        </div>
        {summary && (
          <div className="leg-row">
            <div>
              <strong>{summary.drive}m</strong>
              <span>To parking</span>
            </div>
            <div>
              <strong>{summary.walk != null ? `${summary.walk}m` : '—'}</strong>
              <span>To entrance</span>
            </div>
            <div>
              <strong>{summary.indoor}m</strong>
              <span>Inside</span>
            </div>
          </div>
        )}
        <p className="hint">
          {summary?.weather ?? 'Nice conditions'}
          {summary?.temp != null ? ` · ${summary.temp}°F` : ''}
          {summary ? ` · ${summary.indoorStops} indoor checkpoints` : ''}
        </p>
        <PrimaryButton onClick={() => goTo('navigation')}>Continue to this stop</PrimaryButton>
      </div>
    </section>
  )
}
