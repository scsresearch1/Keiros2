export type DoorRequest = {
  facilityId: string
  facilityName: string
  status: 'pending' | 'granted' | 'denied'
  expiresAt?: string
  message: string
}

const FACILITIES = [
  { id: 'door_lobby', name: 'Main Lobby' },
  { id: 'door_gym', name: 'Fitness Center' },
  { id: 'door_pool', name: 'Pool Deck' },
  { id: 'door_pkg', name: 'Resident Parking Gate' },
  { id: 'door_club', name: 'Clubhouse' },
]

export function listFacilities() {
  return FACILITIES
}

export async function requestDoorAccess(facilityId: string): Promise<DoorRequest> {
  await new Promise((r) => setTimeout(r, 900))
  const facility = FACILITIES.find((f) => f.id === facilityId)
  if (!facility) {
    return {
      facilityId,
      facilityName: 'Unknown',
      status: 'denied',
      message: 'Facility not found on this property.',
    }
  }
  // Demo: parking gate occasionally denied
  if (facilityId === 'door_pkg' && Math.random() < 0.35) {
    return {
      facilityId,
      facilityName: facility.name,
      status: 'denied',
      message: 'Access denied — visitor parking requires front-desk approval.',
    }
  }
  const expires = new Date(Date.now() + 15 * 60 * 1000)
  return {
    facilityId,
    facilityName: facility.name,
    status: 'granted',
    expiresAt: expires.toISOString(),
    message: `Temporary access granted until ${expires.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`,
  }
}
