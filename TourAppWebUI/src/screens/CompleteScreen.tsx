import { useMemo, useState } from 'react'
import { BottomSheet, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { submitTourFeedback } from '../mock/feedback'
import { getTrackingEvents, completeDwellTracking } from '../mock/tracking'
import { photos } from '../media/photos'

export function CompleteScreen() {
  const {
    destination,
    resetTour,
    property,
    navigateResult,
    trackingEnabled,
    tourStops,
    visitedStopIds,
  } = useTour()
  const [rating, setRating] = useState(5)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => {
    const events = trackingEnabled ? getTrackingEvents() : []
    const indoorMin = navigateResult?.indoor.walkMinutes ?? 0
    const walkMin = navigateResult?.walk?.durationMinutes ?? 0
    return {
      minutes: Math.max(1, Math.round(indoorMin + walkMin + events.filter((e) => e.kind === 'dwell').length * 2)),
      visited: visitedStopIds.length || (destination ? 1 : 0),
      planned: tourStops.length || 1,
    }
  }, [navigateResult, trackingEnabled, visitedStopIds, destination, tourStops])

  const visitedNames = tourStops.filter((s) => visitedStopIds.includes(s.id)).map((s) => s.title)

  async function submit() {
    setBusy(true)
    await completeDwellTracking()
    await submitTourFeedback({
      rating,
      interestUnits: destination ? [destination.name] : [],
      interestAmenities: visitedNames,
      comments: '',
      contactOptIn: false,
    })
    setBusy(false)
    setDone(true)
  }

  return (
    <section className="screen">
      <div className="hero-photo soft" style={{ backgroundImage: `url(${photos.unit})` }} />
      <div className="hero-overlay" />
      <BottomSheet
        title={done ? 'Thanks for visiting' : 'Tour complete'}
        subtitle={
          done
            ? 'We saved your feedback.'
            : `${property?.name ?? 'Property'}${visitedNames.length ? ` · ${visitedNames.slice(0, 2).join(', ')}` : ''}`
        }
      >
        {!done ? (
          <>
            <div className="leg-row">
              <div>
                <strong>{summary.visited}</strong>
                <span>Stops seen</span>
              </div>
              <div>
                <strong>{summary.planned}</strong>
                <span>On your list</span>
              </div>
              <div>
                <strong>{summary.minutes}m</strong>
                <span>Tour time</span>
              </div>
            </div>
            {visitedNames.length > 0 && (
              <ul className="tour-checklist">
                {tourStops.map((s) => (
                  <li key={s.id} className={visitedStopIds.includes(s.id) ? 'seen' : ''}>
                    {visitedStopIds.includes(s.id) ? '✓' : '○'} {s.title}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">How was this self-guided tour?</p>
            <div className="rating-row" role="group" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`star ${n <= rating ? 'on' : ''}`}
                  onClick={() => setRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <PrimaryButton onClick={() => void submit()} disabled={busy}>
              {busy ? 'Saving…' : 'Submit & finish'}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={resetTour}>Tour another property</PrimaryButton>
        )}
      </BottomSheet>
    </section>
  )
}
