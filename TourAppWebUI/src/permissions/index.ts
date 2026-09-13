export type ConsentState = {
  location: boolean
  navigation: boolean
  tracking: boolean
  askedAt?: string
}

export type GeoPosition = {
  latitude: number
  longitude: number
  accuracy?: number
}

/**
 * Browser geolocation facade — swap internals for Capacitor Geolocation later.
 */
export async function requestLocationPermission(): Promise<boolean> {
  if (!navigator.geolocation) return false
  try {
    await getCurrentPosition()
    return true
  } catch {
    return false
  }
}

export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    )
  })
}

/** Capacitor-ready stubs for plugins not yet installed */
export const capacitorStubs = {
  async requestNotifications() {
    return false
  },
  async openSettings() {
    // no-op on web
  },
}
