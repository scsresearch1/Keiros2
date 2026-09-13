import { useEffect, useState } from 'react'
import keirosLogo from '../../assets/keiros-logo.png'
import './HomePage.css'

const features = [
  { id: 'mapped', label: 'Mapped', copy: 'Rooms, doors, units, and floors.' },
  { id: 'approved', label: 'Approved', copy: 'Reviewed before release.' },
  { id: 'published', label: 'Published', copy: 'Available to apps and APIs.' },
  { id: 'navigable', label: 'Navigable', copy: 'Routes from entry to destination.' },
  { id: 'trackable', label: 'Trackable', copy: 'Location and time spent by zone.' },
  { id: 'api', label: 'API-ready', copy: 'Access for connected systems.' },
]

type HomePageProps = {
  onEnter: () => void
}

export function HomePage({ onEnter }: HomePageProps) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return undefined

    const timer = window.setInterval(() => {
      setActive((index) => (index + 1) % features.length)
    }, 2800)

    return () => window.clearInterval(timer)
  }, [])

  const feature = features[active]

  return (
    <div className="land">
      <div className="land-grid" aria-hidden="true" />
      <div className="land-scan" aria-hidden="true" />

      <header className="land-nav">
        <span className="logo-plate">
          <img src={keirosLogo} alt="Keiros" />
        </span>
        <button type="button" className="btn ghost" onClick={onEnter}>
          Sign in
        </button>
      </header>

      <main className="land-hero">
        <p className="kicker rise delay-1">Keiros ERP</p>
        <h1 className="rise delay-2">
          Indoor maps
          <em>for properties.</em>
        </h1>

        <div className="features rise delay-4" aria-live="polite">
          <ol className="feature-track">
            {features.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={index === active ? 'is-on' : ''}
                  onClick={() => setActive(index)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
          <p className="feature-copy" key={feature.id}>
            {feature.copy}
          </p>
        </div>

        <button type="button" className="btn solid rise delay-5" onClick={onEnter}>
          Enter product
        </button>
      </main>
    </div>
  )
}
