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
      <BottomSheet title="Allow permissions" subtitle="Used only while you tour this property.">
        <ul className="perm-list">
          <li>
            <strong>Location</strong>
            <span>Place you on the map</span>
          </li>
          <li>
            <strong>Navigation</strong>
            <span>Turn-by-turn indoor & outdoor</span>
          </li>
          <li>
            <strong>Tracking</strong>
            <span>Optional — enable later during the tour</span>
          </li>
        </ul>
        <PrimaryButton onClick={allowAll} disabled={busy}>
          {busy ? 'Requesting…' : 'Continue'}
        </PrimaryButton>
        <button type="button" className="linkish" onClick={goNext}>
          Continue without location
        </button>
      </BottomSheet>
    </section>
  )
}
