import { useState } from 'react'
import { BottomSheet, PrimaryButton, BackChip } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { requestLocationPermission } from '../permissions'
import { photos } from '../media/photos'

export function PermissionsScreen() {
  const { goBack, goNext, setConsent } = useTour()
  const [busy, setBusy] = useState(false)

  async function allowAll() {
    setBusy(true)
    const loc = await requestLocationPermission()
    setConsent({
      location: loc || true,
      navigation: true,
      tracking: false,
      askedAt: new Date().toISOString(),
    })
    setBusy(false)
    goNext()
  }

  return (
    <section className="screen">
      <div className="hero-photo soft" style={{ backgroundImage: `url(${photos.night})` }} />
      <div className="hero-overlay" />
      <div className="screen-top">
        <BackChip onClick={goBack} />
      </div>
      <BottomSheet
        title="Help us guide you"
        subtitle="Only used while you’re on this self-guided tour."
      >
        <ul className="perm-list">
          <li>
            <strong>Location</strong>
            <span>Show where you are on the property</span>
          </li>
          <li>
            <strong>Directions</strong>
            <span>Guide you from stop to stop</span>
          </li>
          <li>
            <strong>Visit timing</strong>
            <span>Optional — you can turn this on later</span>
          </li>
        </ul>
        <PrimaryButton onClick={allowAll} disabled={busy}>
          {busy ? 'One moment…' : 'Continue'}
        </PrimaryButton>
        <button type="button" className="linkish" onClick={goNext}>
          Continue without location
        </button>
      </BottomSheet>
    </section>
  )
}
