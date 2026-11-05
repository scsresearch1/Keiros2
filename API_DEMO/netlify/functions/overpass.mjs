/**
 * Fast Overpass proxy — race mirrors in parallel, fail soft (empty JSON)
 * so the SPA never waits on 504 before drawing Google routes.
 */
const UPSTREAMS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const MIRROR_MS = 4500
const OVERALL_MS = 5500

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function fetchMirror(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: '*/*',
      'User-Agent': 'KeirosAPIDemo/1.0 (netlify-overpass-proxy)',
    },
    body,
    signal,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status}`)
  if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    throw new Error('non-json')
  }
  return text
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'POST only' }
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || ''
  const body = raw.includes('data=') ? raw : `data=${encodeURIComponent(raw)}`

  const overall = new AbortController()
  const overallTimer = setTimeout(() => overall.abort(), OVERALL_MS)

  try {
    const text = await Promise.any(
      UPSTREAMS.map(async (url) => {
        const mirror = new AbortController()
        const timer = setTimeout(() => mirror.abort(), MIRROR_MS)
        const onOverall = () => mirror.abort()
        overall.signal.addEventListener('abort', onOverall)
        try {
          return await fetchMirror(url, body, mirror.signal)
        } finally {
          clearTimeout(timer)
          overall.signal.removeEventListener('abort', onOverall)
        }
      }),
    )
    clearTimeout(overallTimer)
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=120',
      },
      body: text,
    }
  } catch {
    clearTimeout(overallTimer)
    // Soft fail — empty extract so browser path is not blocked / no 504 spam.
    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        elements: [],
        remark: 'overpass-unavailable',
      }),
    }
  }
}
