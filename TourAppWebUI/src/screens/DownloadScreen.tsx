import { useEffect } from 'react'
import { useTour } from '../flow/TourContext'
import { photos } from '../media/photos'

export function DownloadScreen() {
  const { property, downloadPct, downloadLabel, runDownload } = useTour()

  useEffect(() => {
    void runDownload()
  }, [runDownload])

  return (
    <section className="screen screen--download">
      <div className="hero-photo" style={{ backgroundImage: `url(${photos.lobby})` }} />
      <div className="hero-overlay dense" />
      <div className="download-card">
        <p className="splash-eyebrow">Getting ready</p>
        <h1>{property?.name ?? 'Your tour'}</h1>
        <p className="muted">
          {property?.city}
          {property?.state ? `, ${property.state}` : ''}
        </p>
        <div className="progress-bar">
          <div style={{ width: `${downloadPct}%` }} />
        </div>
        <p className="download-label">{downloadLabel || 'Preparing your tour…'}</p>
      </div>
    </section>
  )
}
