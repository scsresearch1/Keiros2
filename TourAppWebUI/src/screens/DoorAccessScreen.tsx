import { useState } from 'react'
import { BottomSheet, PrimaryButton, BackChip } from '../ui/chrome'
import { useTour } from '../flow/TourContext'
import { listFacilities, requestDoorAccess, type DoorRequest } from '../mock/doorAccess'
import { photos } from '../media/photos'

export function DoorAccessScreen() {
  const { goBack, goNext } = useTour()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [last, setLast] = useState<DoorRequest | null>(null)

  async function unlock(id: string) {
    setBusyId(id)
    setLast(await requestDoorAccess(id))
    setBusyId(null)
  }

  return (
    <section className="screen">
      <div className="hero-photo soft" style={{ backgroundImage: `url(${photos.lobby})` }} />
      <div className="hero-overlay" />
      <div className="screen-top">
        <BackChip onClick={goBack} />
      </div>
      <BottomSheet title="Facility access" subtitle="Optional temporary unlock.">
        <ul className="door-list">
          {listFacilities().map((f) => (
            <li key={f.id}>
              <div>
                <strong>{f.name}</strong>
                <span>Visitor access</span>
              </div>
              <PrimaryButton variant="teal" onClick={() => void unlock(f.id)} disabled={busyId === f.id}>
                {busyId === f.id ? '…' : 'Unlock'}
              </PrimaryButton>
            </li>
          ))}
        </ul>
        {last && (
          <div className={`access-result ${last.status}`}>
            <strong>
              {last.facilityName}: {last.status === 'granted' ? 'Granted' : 'Denied'}
            </strong>
            <p>{last.message}</p>
          </div>
        )}
        <PrimaryButton onClick={goNext}>Finish tour</PrimaryButton>
      </BottomSheet>
    </section>
  )
}
