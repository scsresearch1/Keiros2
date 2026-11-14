/** Deployed build id (injected at Vite build time). */
declare const __KEIROS_BUILD_ID__: string

const BUILD_ID =
  typeof __KEIROS_BUILD_ID__ !== 'undefined' && __KEIROS_BUILD_ID__
    ? String(__KEIROS_BUILD_ID__)
    : 'dev'

const RELOAD_FLAG = 'keiros_hard_reload_for'
const ASSET_STORE = 'keiros_asset_sig'

function normalizeAssetPath(src: string | null | undefined): string | null {
  if (!src) return null
  try {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
      return new URL(src, window.location.origin).pathname
    }
  } catch {
    /* ignore */
  }
  const m = src.match(/\/assets\/[^"'?\s]+/)
  return m ? m[0] : src.startsWith('/') ? src.split('?')[0] : null
}

function assetSigFromHtml(html: string): string | null {
  const m = html.match(/\/assets\/index-[^"'?\s]+\.js/)
  return m ? m[0] : null
}

function currentPageAssetSig(): string | null {
  const el = document.querySelector('script[type="module"][src]') as HTMLScriptElement | null
  return normalizeAssetPath(el?.getAttribute('src') || el?.src || null)
}

async function fetchRemoteAssetSig(): Promise<string | null> {
  try {
    const res = await fetch(`/index.html?_=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
    })
    if (!res.ok) return null
    const html = await res.text()
    return assetSigFromHtml(html)
  } catch {
    return null
  }
}

async function fetchRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/build-id.json?_=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
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

async function performHardReload(token: string) {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === token) return false
    sessionStorage.setItem(RELOAD_FLAG, token)
  } catch {
    /* private mode — still reload */
  }
  await clearCaches()
  const url = new URL(window.location.href)
  url.searchParams.set('_keiros', token.slice(0, 24))
  window.location.replace(url.toString())
  return true
}

/**
 * Hard-refresh when the live Netlify shell points at a different JS bundle
 * than the one currently running in this tab.
 */
export async function hardRefreshIfStale(): Promise<boolean> {
  const remoteAsset = await fetchRemoteAssetSig()
  const localAsset = currentPageAssetSig()

  if (remoteAsset) {
    try {
      localStorage.setItem(ASSET_STORE, remoteAsset)
    } catch {
      /* ignore */
    }
    if (localAsset && remoteAsset !== localAsset) {
      return performHardReload(remoteAsset)
    }
  }

  const remoteBuild = await fetchRemoteBuildId()
  if (remoteBuild && remoteBuild !== BUILD_ID && BUILD_ID !== 'dev') {
    return performHardReload(remoteBuild)
  }

  return false
}

/** Poll while the gate screen stays open (tab left open across deploys). */
export function watchBuildOnGate(intervalMs = 8000): () => void {
  let stopped = false
  let timer: number | undefined

  const tick = () => {
    if (stopped) return
    void hardRefreshIfStale().finally(() => {
      if (!stopped) timer = window.setTimeout(tick, intervalMs)
    })
  }

  tick()

  const onVisible = () => {
    if (document.visibilityState === 'visible') void hardRefreshIfStale()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)

  return () => {
    stopped = true
    if (timer != null) window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
  }
}

export function currentBuildId() {
  return BUILD_ID
}
