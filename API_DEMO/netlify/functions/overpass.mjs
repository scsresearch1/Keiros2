/**
 * Server-side Overpass proxy (avoids browser CORS / Netlify 406 on raw redirects).
 * POST body: application/x-www-form-urlencoded with `data=<overpass QL>`
 */
const UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
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

  let lastErr = 'Overpass failed'
  for (const url of UPSTREAMS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
        },
        body,
      })
      const text = await res.text()
      if (!res.ok) {
        lastErr = `Overpass ${res.status}`
        continue
      }
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: text,
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }

  return { statusCode: 502, headers: cors, body: JSON.stringify({ error: lastErr }) }
}
