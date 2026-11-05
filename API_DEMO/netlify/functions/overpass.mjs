/**
 * Server-side Overpass proxy (browser CORS + Netlify edge 406/429).
 * Tries several public mirrors; returns first JSON success.
 */
const UPSTREAMS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  const errors = []
  for (const url of UPSTREAMS) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: '*/*',
          'User-Agent': 'KeirosAPIDemo/1.0 (netlify-overpass-proxy)',
        },
        body,
        signal: controller.signal,
      })
      clearTimeout(timer)
      const text = await res.text()
      if (!res.ok) {
        errors.push(`${new URL(url).hostname}:${res.status}`)
        continue
      }
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        errors.push(`${new URL(url).hostname}:non-json`)
        continue
      }
      return {
        statusCode: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=120',
        },
        body: text,
      }
    } catch (err) {
      errors.push(
        `${new URL(url).hostname}:${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    statusCode: 502,
    headers: cors,
    body: JSON.stringify({ error: 'Overpass failed', tried: errors }),
  }
}
