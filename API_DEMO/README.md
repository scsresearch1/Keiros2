# Keiros API_DEMO (client)

Map navigation client for the Keiros ERP navigation API.

## Prerequisites

1. Firestore seeded (DeployCDCI)
2. ERP API server running:

```bash
cd ../ERP_Full/server
npm install
npm start
```

Listens on `http://localhost:8787`.

## Run

```bash
npm install
npm run dev
```

Opens on **http://localhost:5174** (proxies `/api` → `:8787`).

## Journey

1. Enter API key (demo: `keiros_live_ot_demo_map_nav_2026`)
2. Select Complex → Building → Floor → Unit
3. **Navigate** calls `POST /api/v1/navigate`
4. Outdoor map (~20 mi start, OSRM + OSM), weather (Open-Meteo), traffic estimate
5. Indoor 3D walk through building stops

ERP shows the same call under **API & Integrations → API Logs** and **API Navigation Live**.
