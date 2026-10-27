import type { JourneyStep } from '../api'
import {
  formatDistanceM,
  formatEta,
  maneuverIcon,
  type LiveProgress,
} from '../liveNavigation'

type Props = {
  active: JourneyStep | null
  upcoming: JourneyStep | null
  progress: LiveProgress | null
  recalculating?: boolean
  live: boolean
}

function Icon({ kind }: { kind: string }) {
  const glyph =
    kind === 'walk'
      ? 'WALK'
      : kind === 'elevator'
        ? 'ELV'
        : kind === 'stairs'
          ? 'STR'
          : kind === 'vertical'
            ? '↕'
            : kind === 'enter'
              ? 'IN'
              : kind === 'left'
                ? '←'
                : kind === 'right'
                  ? '→'
                  : kind === 'uturn'
                    ? '↩'
                    : kind === 'arrive'
                      ? '●'
                      : kind === 'roundabout'
                        ? '↻'
                        : '↑'
  return <span className={`demo-nav-banner__icon is-${kind}`}>{glyph}</span>
}

function indoorManeuver(active: JourneyStep) {
  const m = (active as JourneyStep & { maneuver?: string }).maneuver
  if (m) return m
  return maneuverIcon(active.instruction, 'walk')
}

export function NavGuidanceBanner({ active, upcoming, progress, recalculating, live }: Props) {
  if (!active) return null
  const indoor = active.phase === 'indoor'
  const kind = indoor ? indoorManeuver(active) : maneuverIcon(active.instruction, active.phase)
  const toManeuver = indoor
    ? (active.distanceM ?? 0)
    : (progress?.toNextManeuverM ?? active.distanceM ?? 0)
  const remainM = progress?.remainingM
  const remainSec = progress?.remainingSec

  return (
    <div
      className={`demo-nav-banner${live ? ' is-live' : ''}${progress?.offRoute ? ' is-off' : ''}${indoor ? ' is-indoor' : ''}`}
    >
      <div className="demo-nav-banner__main">
        <Icon kind={kind} />
        <div className="demo-nav-banner__copy">
          <p className="demo-nav-banner__dist">
            {indoor && !(active.distanceM && active.distanceM > 0)
              ? active.floorLabel || 'Inside'
              : formatDistanceM(toManeuver)}
          </p>
          <p className="demo-nav-banner__instr">{active.instruction}</p>
          {upcoming ? <p className="demo-nav-banner__then">Then: {upcoming.instruction}</p> : null}
          {indoor && active.stopName ? (
            <p className="demo-nav-banner__then">
              {active.floorLabel ? `${active.floorLabel} · ` : ''}
              {active.stopType || 'Stop'} · {active.stopName}
            </p>
          ) : null}
        </div>
      </div>
      <div className="demo-nav-banner__eta">
        {recalculating ? (
          <strong>Recalculating…</strong>
        ) : progress?.offRoute ? (
          <strong>Off route</strong>
        ) : indoor ? (
          <>
            <strong>Inside</strong>
            <span>{active.floorLabel || 'Building'}</span>
          </>
        ) : live && remainM != null ? (
          <>
            <strong>{formatEta(remainSec ?? 0)}</strong>
            <span>{formatDistanceM(remainM)} left</span>
          </>
        ) : (
          <>
            <strong>{active.phase === 'walk' ? 'Walk' : 'Drive'}</strong>
            <span>Live guidance</span>
          </>
        )}
      </div>
    </div>
  )
}
