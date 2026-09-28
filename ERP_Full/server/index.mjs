import express from 'express'
import cors from 'cors'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import dotenv from 'dotenv'
import { loadCollection, upsert, isUsingLocalFallback } from './lib/firebase.mjs'
import { authenticateApiKey, extractApiKey, requireScope } from './lib/auth.mjs'
import { buildIndoorJourney, serializeStop } from './lib/indoor.mjs'
import { fetchDriveRoute, fetchWalkRoute, fetchWeather, offsetMiles, offsetMeters, MILES_START, PARKING_OFFSET_METERS, buildJourneySteps } from './lib/outdoor.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '.env') })
const deployEnv = resolve(__dirname, '..', '..', 'DeployCDCI', '.env')
if (existsSync(deployEnv)) dotenv.config({ path: deployEnv, override: false })

const PORT = Number(process.env.PORT || 8787)
const CORS_ORIGINS = String(
  process.env.CORS_ORIGINS ||
    'http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175',
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const app = express()
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) return cb(null, true)
      return cb(null, false)
    },
    exposedHeaders: ['X-Request-Id'],
  }),
)
app.use(express.json({ limit: '1mb' }))

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function requestId() {
  return `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function logApiCall({ auth, method, path, status, durationMs, meta }) {
  const id = `al-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`
  await upsert('api_logs', id, {
    id,
    timestamp: stamp(),
    apiClientId: auth?.apiClientId ?? 'unknown',
    clientName: auth?.clientName ?? 'Unknown',
    method,
    path,
    status,
    durationMs,
    meta: meta ?? null,
    apiKeyId: auth?.apiKeyId ?? null,
  })

  if (auth?.apiClientId) {
    const usageRows = await loadCollection('api_usage_stats')
    const endpoint = path.split('?')[0]
    let row = usageRows.find((u) => u.apiClientId === auth.apiClientId && u.endpoint === endpoint)
    if (!row) {
      row = {
        id: `aus-${Date.now().toString(36)}`,
        apiClientId: auth.apiClientId,
        clientName: auth.clientName,
        endpoint,
        requests: 0,
        errors: 0,
        p95Ms: durationMs,
      }
    }
    row.requests += 1
    if (status >= 400) row.errors += 1
    row.p95Ms = Math.round(row.p95Ms * 0.85 + durationMs * 0.15)
    row.clientName = auth.clientName
    await upsert('api_usage_stats', row.id, row)
  }
}

async function withAuth(req, res, neededScope, handler) {
  const started = Date.now()
  const rid = requestId()
  res.setHeader('X-Request-Id', rid)
  let auth = null
  try {
    auth = await authenticateApiKey(extractApiKey(req))
    if (!auth.ok) {
      await logApiCall({
        auth: null,
        method: req.method,
        path: req.path,
        status: auth.status,
        durationMs: Date.now() - started,
        meta: { error: auth.error, requestId: rid },
      })
      return res.status(auth.status).json({ error: auth.error, requestId: rid })
    }
    if (neededScope && !requireScope(auth, neededScope)) {
      await logApiCall({
        auth,
        method: req.method,
        path: req.path,
        status: 403,
        durationMs: Date.now() - started,
        meta: { error: 'insufficient_scope', requestId: rid },
      })
      return res.status(403).json({ error: 'API key lacks required scope', requestId: rid })
    }
    const result = await handler(auth, rid)
    await logApiCall({
      auth,
      method: req.method,
      path: req.path,
      status: 200,
      durationMs: Date.now() - started,
      meta: {
        requestId: rid,
        apiKeyId: auth.apiKeyId,
        authMode: auth.authMode,
        ...(result?.logMeta || {}),
      },
    })
    return res.json({ ...result.body, requestId: rid, durationMs: Date.now() - started })
  } catch (err) {
    const status = Number(err?.status) || 500
    if (status >= 500) console.error(err)
    await logApiCall({
      auth,
      method: req.method,
      path: req.path,
      status,
      durationMs: Date.now() - started,
      meta: { error: String(err instanceof Error ? err.message : err), requestId: rid },
    })
    return res.status(status).json({
      error:
        status === 503
          ? err instanceof Error
            ? err.message
            : 'Service temporarily unavailable'
          : status >= 500
            ? 'Internal server error'
            : err instanceof Error
              ? err.message
              : String(err),
      detail: err instanceof Error ? err.message : String(err),
      requestId: rid,
    })
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'keiros-erp-api',
    time: stamp(),
    startOffsetMiles: MILES_START,
    dataMode: isUsingLocalFallback() ? 'local-seed' : 'firestore',
  })
})

function normalizeAccessCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
}

/**
 * Validate a Tour App / mobile property access code against ERP Property Codes.
 * Body: { code: string }
 */
app.post('/api/v1/access/validate', (req, res) =>
  withAuth(req, res, 'maps:read', async (auth, rid) => {
    const code = normalizeAccessCode(req.body?.code)
    if (!code) {
      const err = new Error('Property code is required')
      err.status = 400
      throw err
    }

    const [codes, complexes, usageRows] = await Promise.all([
      loadCollection('property_codes'),
      loadCollection('complexes'),
      loadCollection('code_usage'),
    ])

    const row = codes.find((c) => normalizeAccessCode(c.code) === code)
    if (!row) {
      const err = new Error('Invalid or inactive property code')
      err.status = 404
      throw err
    }

    const status = String(row.status || '')
    if (status === 'Revoked') {
      const err = new Error('This property code has been revoked')
      err.status = 403
      throw err
    }
    if (status === 'Expired') {
      const err = new Error('This property code has expired')
      err.status = 403
      throw err
    }

    if (row.expiresAt) {
      const exp = new Date(`${row.expiresAt}T23:59:59`)
      if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
        const err = new Error('This property code has expired')
        err.status = 403
        throw err
      }
    }

    if (status && status !== 'Active') {
      const err = new Error('Invalid or inactive property code')
      err.status = 403
      throw err
    }

    const complex =
      complexes.find((c) => c.id === row.propertyId) ||
      complexes.find((c) => c.name === row.propertyName) ||
      null

    // bump usage for ERP Code Usage page
    let usage = usageRows.find((u) => u.propertyCodeId === row.id || normalizeAccessCode(u.code) === code)
    if (!usage) {
      usage = {
        id: `cu-${Date.now().toString(36)}`,
        propertyCodeId: row.id,
        propertyId: row.propertyId,
        code: row.code,
        propertyName: row.propertyName,
        scans: 0,
        uniqueDevices: 0,
        lastUsed: stamp(),
      }
    }
    usage = {
      ...usage,
      scans: Number(usage.scans || 0) + 1,
      lastUsed: stamp(),
      propertyName: row.propertyName,
      code: row.code,
    }
    await upsert('code_usage', usage.id, usage)

    const address = complex?.address || ''
    const city = complex?.city || ''
    const stateMatch = address.match(/,\s*([A-Z]{2})\s*\d*$/i)

    return {
      body: {
        ok: true,
        requestId: rid,
        property: {
          code: row.code,
          propertyId: row.propertyId,
          complexId: complex?.id || row.propertyId,
          name: complex?.name || row.propertyName,
          city,
          state: stateMatch ? stateMatch[1].toUpperCase() : '',
          address,
          label: row.label || null,
          status: 'Active',
          expiresAt: row.expiresAt ?? null,
        },
      },
      logMeta: { code: row.code, propertyId: row.propertyId, propertyName: row.propertyName },
    }
  }),
)

app.get('/api/v1/hierarchy', (req, res) =>
  withAuth(req, res, 'maps:read', async () => {
    const [complexes, buildings, floors, locations] = await Promise.all([
      loadCollection('complexes'),
      loadCollection('buildings'),
      loadCollection('floors'),
      loadCollection('locations'),
    ])

    const units = locations
      .filter((l) => l.mapped !== false)
      .map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        code: l.code,
        floorId: l.floorId,
        floorLabel: l.floorLabel,
        buildingId: l.buildingId,
        buildingName: l.buildingName,
        complexId: l.complexId,
        complexName: l.complexName,
        latitude: l.latitude,
        longitude: l.longitude,
        elevation: l.elevation,
      }))

    return {
      body: {
        complexes: complexes.map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city,
          status: c.status,
          address: c.address,
        })),
        buildings: buildings.map((b) => ({
          id: b.id,
          name: b.name,
          complexId: b.complexId,
          complexName: b.complexName,
          floors: b.floors,
          status: b.status,
          city: b.city,
        })),
        floors: floors.map((f) => ({
          id: f.id,
          label: f.label,
          level: f.level,
          buildingId: f.buildingId,
          buildingName: f.buildingName,
          complexId: f.complexId,
          complexName: f.complexName,
        })),
        units,
      },
      logMeta: {
        complexes: complexes.length,
        buildings: buildings.length,
        floors: floors.length,
        units: units.length,
      },
    }
  }),
)

app.post('/api/v1/navigate', (req, res) =>
  withAuth(req, res, null, async (auth, rid) => {
    if (!requireScope(auth, 'routes:read') && !requireScope(auth, 'maps:read')) {
      const err = new Error('API key lacks maps:read or routes:read scope')
      err.status = 403
      throw err
    }
    const { complexId, buildingId, floorId, unitId, locationId } = req.body || {}
    const targetId = String(unitId || locationId || '').trim()
    if (!buildingId || !floorId || !targetId) {
      const err = new Error('buildingId, floorId, and unitId are required')
      err.status = 400
      throw err
    }

    const [buildings, floors, locations, complexes] = await Promise.all([
      loadCollection('buildings'),
      loadCollection('floors'),
      loadCollection('locations'),
      loadCollection('complexes'),
    ])

    const building = buildings.find((b) => b.id === buildingId)
    const floor = floors.find((f) => f.id === floorId)
    const unit = locations.find((l) => l.id === targetId)

    if (!building || !floor || !unit) {
      const err = new Error('Complex / building / floor / unit not found in Firestore')
      err.status = 404
      throw err
    }
    if (unit.buildingId !== building.id || unit.floorId !== floor.id) {
      const err = new Error('Unit does not belong to the selected building/floor')
      err.status = 400
      throw err
    }
    if (complexId && building.complexId && building.complexId !== complexId) {
      const err = new Error('Building does not belong to the selected complex')
      err.status = 400
      throw err
    }

    const complex =
      complexes.find((c) => c.id === (complexId || building.complexId || unit.complexId)) ?? null

    const indoor = buildIndoorJourney(unit, locations)
    const entry = indoor.entry || {
      latitude: unit.latitude,
      longitude: unit.longitude,
      name: 'Building entrance',
    }
    const parking = {
      ...offsetMeters(entry.latitude, entry.longitude, PARKING_OFFSET_METERS, 135),
      label: 'Visitor / garage parking',
      offsetMeters: PARKING_OFFSET_METERS,
    }
    const destination = {
      latitude: unit.latitude,
      longitude: unit.longitude,
    }
    const origin = offsetMiles(parking.latitude, parking.longitude, MILES_START, 315)

    const [drive, walk, weather] = await Promise.all([
      fetchDriveRoute(origin, parking),
      fetchWalkRoute(parking, { latitude: entry.latitude, longitude: entry.longitude }),
      fetchWeather(destination.latitude, destination.longitude),
    ])

    const outdoor = {
      ...drive,
      walk,
      parking,
      entrance: {
        latitude: entry.latitude,
        longitude: entry.longitude,
        label: entry.name || 'Building entrance',
        type: entry.type || 'Entry',
      },
      note: 'Drive ends at parking. Walk from parking to entrance, then continue indoors.',
    }

    const buildingUnits = locations.filter((l) => l.buildingId === building.id)
    const buildingFloors = floors.filter((f) => f.buildingId === building.id)
    const journeySteps = buildJourneySteps(drive, walk, indoor, unit.name)

    const sessionId = rid
    const session = {
      id: sessionId,
      createdAt: stamp(),
      status: 'Active',
      source: req.body?.source === 'TOUR_APP' ? 'TOUR_APP' : 'API_DEMO',
      apiClientId: auth.apiClientId,
      clientName: auth.clientName,
      complexId: complex?.id ?? building.complexId ?? null,
      complexName: complex?.name ?? building.complexName ?? unit.complexName ?? null,
      buildingId: building.id,
      buildingName: building.name,
      floorId: floor.id,
      floorLabel: floor.label,
      unitId: unit.id,
      unitName: unit.name,
      unitCode: unit.code,
      originMiles: MILES_START,
      outdoorDistanceMiles: outdoor.distanceMiles,
      outdoorDurationMin: outdoor.durationMinutes,
      walkDistanceM: walk.distanceM,
      walkDurationMin: walk.durationMinutes,
      indoorWalkMin: indoor.walkMinutes,
      trafficLevel: outdoor.traffic?.level ?? 'Unknown',
      weatherSummary: weather.summary ?? null,
      temperatureF: weather.temperatureF ?? null,
      requestPath: '/api/v1/navigate',
    }
    await upsert('navigation_sessions', sessionId, session)

    // Surface in Journey Tracking as well
    const journeyId = `jn-api-${unit.id}`
    const existingJourneys = await loadCollection('journeys')
    const prev = existingJourneys.find((j) => j.id === journeyId)
    await upsert('journeys', journeyId, {
      id: journeyId,
      propertyId: unit.propertyId || complex?.id || building.id,
      propertyName: complex?.name || building.complexName || building.name,
      routeId: `rt-api-${unit.id}`,
      routeName: `API · Entry → ${unit.name}`,
      sessions: (prev?.sessions ?? 0) + 1,
      completionRate: prev?.completionRate ?? 100,
      avgDurationMin: Math.round(((prev?.avgDurationMin ?? outdoor.durationMinutes) * 0.7 + outdoor.durationMinutes * 0.3) * 10) / 10,
    })

    return {
      body: {
        sessionId,
        selection: {
          complex: complex
            ? { id: complex.id, name: complex.name, city: complex.city, address: complex.address }
            : null,
          building: {
            id: building.id,
            name: building.name,
            floors: building.floors,
            status: building.status,
          },
          floor: { id: floor.id, label: floor.label, level: floor.level },
          unit: serializeStop(unit),
        },
        origin: {
          ...origin,
          label: `Start (~${MILES_START} mi NW of parking)`,
          offsetMiles: MILES_START,
        },
        parking,
        entrance: outdoor.entrance,
        destination: {
          latitude: unit.latitude,
          longitude: unit.longitude,
          label: unit.name,
          address: unit.physicalAddress,
        },
        outdoor,
        walk,
        weather,
        journey: {
          totalSteps: journeySteps.length,
          driveSteps: drive.steps?.length ?? 0,
          walkSteps: walk.steps?.length ?? 0,
          indoorSteps: indoor.stops?.length ?? 0,
          outdoorSteps: drive.steps?.length ?? 0,
          phases: ['drive', 'walk', 'indoor'],
          summary:
            'Drive to parking → walk to building entrance → navigate inside to the unit.',
          steps: journeySteps,
        },
        indoor: {
          distanceM: indoor.distanceM,
          walkMinutes: indoor.walkMinutes,
          floorChanges: indoor.floorChanges,
          entry: indoor.entry ? serializeStop(indoor.entry) : null,
          stops: indoor.stops.map(serializeStop),
        },
        map3d: {
          building,
          floors: buildingFloors,
          locations: buildingUnits.map(serializeStop),
          selectedFloorId: floor.id,
          selectedUnitId: unit.id,
          routeStops: indoor.stops.map(serializeStop),
        },
      },
      logMeta: {
        sessionId,
        unitId: unit.id,
        outdoorMiles: outdoor.distanceMiles,
        traffic: outdoor.traffic?.level,
        journeySteps: journeySteps.length,
      },
    }
  }),
)

app.get('/api/v1/conditions', (req, res) =>
  withAuth(req, res, 'maps:read', async () => {
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const err = new Error('lat and lng query params required')
      err.status = 400
      throw err
    }
    const originMiles = Number(req.query.originMiles) || MILES_START
    const origin = offsetMiles(lat, lng, originMiles, 315)
    const destination = { latitude: lat, longitude: lng }
    const [outdoor, weather] = await Promise.all([
      fetchDriveRoute(origin, destination),
      fetchWeather(lat, lng),
    ])
    return {
      body: {
        origin,
        destination,
        outdoor: {
          distanceMiles: outdoor.distanceMiles,
          durationMinutes: outdoor.durationMinutes,
          traffic: outdoor.traffic,
          steps: outdoor.steps,
          provider: outdoor.provider,
        },
        weather,
        refreshedAt: new Date().toISOString(),
      },
      logMeta: { lat, lng, traffic: outdoor.traffic?.level },
    }
  }),
)

/**
 * Realtime dwell / zone occupancy from Tour App.
 * Upserts Firestore `dwell_metrics` so ERP Dwell-Time page can show live values.
 */
app.post('/api/v1/tracking/dwell', (req, res) =>
  withAuth(req, res, null, async (auth, rid) => {
    if (!requireScope(auth, 'routes:read') && !requireScope(auth, 'maps:read')) {
      const err = new Error('API key lacks maps:read or routes:read scope')
      err.status = 403
      throw err
    }

    const body = req.body || {}
    const locationId = String(body.locationId || body.unitId || '').trim()
    const zone = String(body.zone || body.label || '').trim()
    const sessionId = String(body.sessionId || '').trim()
    const event = String(body.event || 'heartbeat').toLowerCase()
    const dwellSec = Math.max(0, Number(body.dwellSec) || 0)

    if (!locationId || !zone) {
      const err = new Error('locationId and zone are required')
      err.status = 400
      throw err
    }

    const [locations, complexes, buildings, existing] = await Promise.all([
      loadCollection('locations'),
      loadCollection('complexes'),
      loadCollection('buildings'),
      loadCollection('dwell_metrics'),
    ])

    const loc = locations.find((l) => l.id === locationId)
    const building = loc ? buildings.find((b) => b.id === loc.buildingId) : null
    const complex = loc
      ? complexes.find((c) => c.id === (loc.complexId || building?.complexId))
      : null

    const propertyId =
      String(body.propertyId || loc?.propertyId || complex?.id || building?.id || 'unknown')
    const propertyName =
      String(
        body.propertyName ||
          complex?.name ||
          building?.complexName ||
          building?.name ||
          'Tour property',
      )

    const metricId = `dm-live-${locationId}`
    const prev = existing.find((d) => d.id === metricId)
    const sampleMin = Math.round((dwellSec / 60) * 10) / 10
    const hour = new Date().getHours()
    const peakHour = `${((hour + 11) % 12) + 1}${hour >= 12 ? ' PM' : ' AM'}–${((hour + 12) % 12) + 1}${
      hour + 1 >= 12 ? ' PM' : ' AM'
    }`

    let visits = prev?.visits ?? 0
    let avgDwellMin = prev?.avgDwellMin ?? 0
    let activeVisitors = prev?.activeVisitors ?? 0

    if (event === 'enter') {
      activeVisitors = Math.max(0, activeVisitors) + 1
    } else if (event === 'leave' || event === 'complete') {
      activeVisitors = Math.max(0, activeVisitors - 1)
      visits += 1
      avgDwellMin =
        visits <= 1
          ? sampleMin
          : Math.round((((prev?.avgDwellMin ?? sampleMin) * (visits - 1) + sampleMin) / visits) * 10) / 10
    } else {
      // heartbeat — keep rolling preview avg without double-counting visits
      avgDwellMin =
        visits > 0
          ? Math.round((((prev?.avgDwellMin ?? 0) * visits + sampleMin) / (visits + 1)) * 10) / 10
          : Math.max(prev?.avgDwellMin ?? 0, sampleMin)
      if (activeVisitors < 1) activeVisitors = 1
    }

    const metric = {
      id: metricId,
      propertyId,
      propertyName,
      locationId,
      zone,
      avgDwellMin: Math.max(0, avgDwellMin),
      visits,
      peakHour: prev?.peakHour || peakHour,
      liveDwellSec: dwellSec,
      liveUpdatedAt: new Date().toISOString(),
      activeVisitors,
      source: 'TOUR_APP',
      lastSessionId: sessionId || prev?.lastSessionId || null,
      lastEvent: event,
      latitude: body.latitude ?? loc?.latitude ?? null,
      longitude: body.longitude ?? loc?.longitude ?? null,
    }
    await upsert('dwell_metrics', metricId, metric)

    if (sessionId) {
      const sessions = await loadCollection('navigation_sessions')
      const session = sessions.find((s) => s.id === sessionId)
      if (session) {
        await upsert('navigation_sessions', sessionId, {
          ...session,
          lastDwellZone: zone,
          lastDwellSec: dwellSec,
          lastDwellAt: stamp(),
          lastDwellLocationId: locationId,
          status: event === 'complete' ? 'Completed' : session.status || 'Active',
          source: session.source === 'API_DEMO' ? 'TOUR_APP' : session.source,
        })
      }
    }

    // lightweight event log for ops
    const eventId = `je-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    await upsert('journey_events', eventId, {
      id: eventId,
      createdAt: stamp(),
      sessionId: sessionId || null,
      event,
      locationId,
      zone,
      dwellSec,
      propertyId,
      propertyName,
      apiClientId: auth.apiClientId,
      clientName: auth.clientName,
      source: 'TOUR_APP',
    })

    return {
      body: {
        ok: true,
        requestId: rid,
        metric,
      },
      logMeta: {
        locationId,
        zone,
        event,
        dwellSec,
        sessionId: sessionId || null,
      },
    }
  }),
)

// Express error for status-bearing errors in navigate validation
app.use((err, _req, res, _next) => {
  if (err?.status) {
    return res.status(err.status).json({ error: err.message })
  }
  console.error(err)
  res.status(500).json({ error: 'Unhandled error' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Keiros ERP API listening on http://0.0.0.0:${PORT}`)
  console.log(`Health: http://localhost:${PORT}/api/health`)
  console.log(`Demo key example: keiros_live_ot_demo_map_nav_2026`)
})

process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandledRejection (kept alive):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[api] uncaughtException (kept alive):', err)
})
