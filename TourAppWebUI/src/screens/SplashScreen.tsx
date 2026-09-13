import { PrimaryButton } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { photos } from '../media/photos'
import './screens.css'

export function SplashScreen() {
  const { goNext } = useTour()
  return (
    <section className="screen screen--splash">
      <div className="hero-photo" style={{ backgroundImage: `url(${photos.splash})` }} aria-hidden />
      <div className="hero-overlay" />
      <div className="splash-brand">
        <p className="splash-eyebrow">Indoor wayfinding</p>
        <h1 className="splash-logo">Keiros</h1>
        <p className="splash-tag">Tour any property with confidence — from lobby to unit.</p>
      </div>
      <div className="splash-cta">
        <PrimaryButton variant="light" onClick={goNext}>
          Start tour
        </PrimaryButton>
      </div>
    </section>
  )
}
