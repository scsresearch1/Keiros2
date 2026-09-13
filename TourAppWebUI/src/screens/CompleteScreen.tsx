import { useMemo, useState } from 'react'
import { BottomSheet, PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { submitTourFeedback } from '../mock/feedback'
import { getTrackingEvents, completeDwellTracking } from '../mock/tracking'
import { photos } from '../media/photos'

export function CompleteScreen() {
  const { destination, resetTour, property, navigateResult, trackingEnabled } = useTour()
  const [rating, setRating] = useState(5)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => {
    const events = trackingEnabled ? getTrackingEvents() : []
    const indoorMin = navigateResult?.indoor.walkMinutes ?? 0
    const walkMin = navigateResult?.walk?.durationMinutes ?? 0
    const distM =
      (navigateResult?.indoor.distanceM ?? 0) + (navigateResult?.walk?.distanceM ?? 0)
    return {
      dwell: Math.max(1, Math.round(indoorMin + walkMin + events.filter((e) => e.kind === 'dwell').length * 2)),
      miles: (distM / 1609).toFixed(2),
      floors: navigateResult?.indoor.floorChanges ?? 1,
    }
  }, [navigateResult, trackingEnabled])

  async function submit() {
    setBusy(true)
    await completeDwellTracking()
    await submitTourFeedback({
      rating,
      interestUnits: destination ? [destination.name] : [],
      interestAmenities: [],
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
        title={done ? 'Thank you' : 'Journey complete'}
        subtitle={
          done
            ? 'Feedback recorded.'
            : `${property?.name ?? ''}${destination ? ` · ${destination.name}` : ''}`
        }
      >
        {!done ? (
          <>
            <div className="leg-row">
              <div>
                <strong>{summary.dwell}m</strong>
                <span>Dwell</span>
              </div>
              <div>
                <strong>{summary.miles}</strong>
                <span>Miles</span>
              </div>
              <div>
                <strong>{summary.floors}</strong>
                <span>Floors</span>
              </div>
            </div>
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
              {busy ? 'Saving…' : 'Finish'}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton onClick={resetTour}>Start another tour</PrimaryButton>
        )}
      </BottomSheet>
    </section>
  )
}
