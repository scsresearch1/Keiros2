import { useEffect } from 'react'
import { useTour } from '../flow/TourContext'
import { photos } from '../media/photos'

export function ValidatingScreen() {
  const { property, goTo } = useTour()

  useEffect(() => {
    const t = window.setTimeout(() => goTo('download'), 1400)
    return () => window.clearTimeout(t)
  }, [goTo])

  return (
    <section className="screen screen--center">
      <div className="hero-photo soft" style={{ backgroundImage: `url(${photos.lobby})` }} />
      <div className="hero-overlay dense" />
      <div className="validate-card">
        <div className="success-ring">✓</div>
        <p className="splash-eyebrow">You’re in</p>
        <h2>{property?.name}</h2>
        <p className="muted">{property?.address}</p>
        <p className="muted">Preparing your self-guided tour…</p>
      </div>
    </section>
  )
}
