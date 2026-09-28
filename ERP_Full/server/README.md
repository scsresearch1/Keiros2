# Keiros ERP Navigation API

Express server that reads Firestore hierarchy and serves map navigation for **API_DEMO**.

## Deploy (Netlify + Render)

See repo root **`Migration_Phase1.txt`** for the full checklist.

Quick map:

| App | Host | Base / root |
|-----|------|-------------|
| ERP web | Netlify | `ERP_Full` |
| API Demo | Netlify (2nd site) | `API_DEMO` |
| Navigation API | Render | `ERP_Full/server` |

## Run

```bash
# from ERP_Full/server (or: npm run api from ERP_Full)
npm install
npm start
```

Uses `DeployCDCI/.env` / `server/.env` for credentials.
On Render, prefer `FIREBASE_SERVICE_ACCOUNT_JSON` (inline JSON) instead of a file path.

Default port: **8787** (Render injects `PORT` automatically).

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | no | Liveness (`dataMode`: firestore \| local-seed) |
| GET | `/api/v1/hierarchy` | Bearer API key | Complex / building / floor / unit lists |
| POST | `/api/v1/navigate` | Bearer API key | Outdoor (~20 mi) + indoor 3D payload + weather/traffic |
| POST | `/api/v1/access/validate` | Bearer API key | Tour App property code validation |
| POST | `/api/v1/tracking/dwell` | Bearer API key | Live dwell heartbeats → `dwell_metrics` |

## Local seed fallback

If Firestore returns **Quota exceeded** (or `FIRESTORE_LOCAL_FALLBACK=true`), the API serves data from `src/data/erpData.ts` and keeps writes in memory so Tour App / API_DEMO keep working.

## Auth

1. ERP **API Keys → Issue secret** generates `prefix + random`, shows full key once, stores `keyHash` (SHA-256).
2. Clients send `Authorization: Bearer <full-key>`.
3. Server matches `sha256(key) === keyHash` for Active keys.
4. Legacy Active keys without `keyHash` still accept prefix + ≥8 char suffix (demo only).

## Side effects (ERP visibility)

Each authenticated call writes/updates:

- `api_logs` (+ `apiKeyId` in meta)
- `api_usage_stats`
- `api_keys.lastUsed`
- `navigation_sessions` / `journeys` (navigate only)
