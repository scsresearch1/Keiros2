import { useMemo } from 'react'
import { BackChip, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { normalizePhase } from '../api/client'
import { OutdoorMap } from '../map2d/OutdoorMap'

export function RoutePreviewScreen() {
  const { goBack, goTo, navigateResult, destination, activeStepIndex } = useTour()

  const summary = useMemo(() => {
    if (!navigateResult) return null
    return {
      drive: Math.round(navigateResult.outdoor.durationMinutes),
      walk: navigateResult.walk ? Math.round(navigateResult.walk.durationMinutes) : null,
      indoor: Math.round(navigateResult.indoor.walkMinutes),
      weather: navigateResult.weather.summary,
      temp: navigateResult.weather.temperatureF,
      traffic: navigateResult.outdoor.traffic.level,
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
        <p className="splash-eyebrow">Best route</p>
        <h2>{destination?.name ?? navigateResult.destination.label}</h2>
        <div className="phase-strip static">
          <span className="phase-drive is-active">Drive</span>
          <span className="phase-walk">Walk</span>
          <span className="phase-inside">Inside</span>
        </div>
        {summary && (
          <div className="leg-row">
            <div>
              <strong>{summary.drive}m</strong>
              <span>Drive</span>
            </div>
            <div>
              <strong>{summary.walk != null ? `${summary.walk}m` : '—'}</strong>
              <span>Walk</span>
            </div>
            <div>
              <strong>{summary.indoor}m</strong>
              <span>Inside</span>
            </div>
          </div>
        )}
        <p className="hint">
          {summary?.weather ?? 'Conditions'}
          {summary?.temp != null ? ` · ${summary.temp}°F` : ''} · Traffic {summary?.traffic}
          {summary ? ` · ${summary.indoorStops} indoor stops` : ''}
        </p>
        <PrimaryButton onClick={() => goTo('navigation')}>Start navigation</PrimaryButton>
      </div>
    </section>
  )
}
