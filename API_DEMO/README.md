# Keiros API_DEMO (client)

Map navigation client for the Keiros ERP navigation API.

## Deploy

Production: Netlify site with base directory `API_DEMO` + `VITE_API_BASE` pointing at Render.
See repo root **`Migration_Phase1.txt`**.

## Prerequisites

1. Firestore seeded (DeployCDCI)
2. ERP API server running locally or on Render:

```bash
cd ../ERP_Full/server
npm install
npm start
```

Local API: `http://localhost:8787`. Production: your Render URL.

## Run

```bash
npm install
npm run dev
```

Opens on **http://localhost:5174** (proxies `/api` → `:8787`).

For a production-like local build against Render:

```bash
# .env.local
VITE_API_BASE=https://YOUR-SERVICE.onrender.com
npm run build && npm run preview
```

## Journey

1. Enter API key (demo: `keiros_live_ot_demo_map_nav_2026`)
2. Select Complex → Building → Floor → Unit
3. **Navigate** calls `POST /api/v1/navigate`
4. Outdoor map (~20 mi start, OSRM + OSM), weather (Open-Meteo), traffic estimate
5. Indoor 3D walk through building stops

ERP shows the same call under **API & Integrations → API Logs** and **API Navigation Live**.
