/** Deployed build id (injected at Vite build time). */
declare const __KEIROS_BUILD_ID__: string

const BUILD_ID =
  typeof __KEIROS_BUILD_ID__ !== 'undefined' && __KEIROS_BUILD_ID__
    ? String(__KEIROS_BUILD_ID__)
    : 'dev'

const RELOAD_FLAG = 'keiros_hard_reload_for'

async function fetchRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/build-id.json?_=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null
    const data = (await res.json()) as { id?: string }
    return data?.id ? String(data.id) : null
  } catch {
    return null
  }
}

async function clearCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* ignore */
  }
}

/**
 * Hard-refresh once when the deployed build-id differs from this JS bundle.
 * Used on the API-key gate so open tabs pick up Netlify deploys.
 */
export async function hardRefreshIfStale(): Promise<boolean> {
  const remote = await fetchRemoteBuildId()
  if (!remote || remote === BUILD_ID) return false

  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === remote) return false
    sessionStorage.setItem(RELOAD_FLAG, remote)
  } catch {
    /* private mode — still reload */
  }

  await clearCaches()
  const url = new URL(window.location.href)
  url.searchParams.set('_keiros', remote)
  window.location.replace(url.toString())
  return true
}

/** Poll while the gate screen stays open (tab left open across deploys). */
export function watchBuildOnGate(intervalMs = 20000): () => void {
  let stopped = false
  let timer: number | undefined

  const tick = () => {
    if (stopped) return
    void hardRefreshIfStale().finally(() => {
      if (!stopped) timer = window.setTimeout(tick, intervalMs)
    })
  }

  // Immediate check when the gate appears.
  tick()

  const onVisible = () => {
    if (document.visibilityState === 'visible') void hardRefreshIfStale()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    stopped = true
    if (timer != null) window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export function currentBuildId() {
  return BUILD_ID
}
