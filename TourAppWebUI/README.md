# Keiros Tour App (Web UI)

Capacitor-ready visitor tour experience for U.S. multifamily & commercial properties.

## Stack

- React 19 + Vite + TypeScript
- Leaflet (outdoor route)
- Glossy SVG tower blueprint (ERP-style, colorful) for indoor nav + destination pick
- Keiros navy theme (aligned with ERP)
- Live ERP APIs: `GET /api/v1/hierarchy`, `POST /api/v1/navigate`, `POST /api/v1/tracking/dwell`, `POST /api/v1/access/validate`
- Mocked: map download progress animation, door access, feedback
- Journey tracking (when consented) heartbeats dwell every ~5s to ERP **Analytics → Dwell-Time**
- Property codes come from ERP **Property Codes** (e.g. `OC-CHI-2026`)

## Run

1. Start ERP API server on **8787** (`ERP_Full/server`).
2. In this folder:

```bash
npm install
npm run dev
```

Open **http://localhost:5175**

Demo property codes: `KEIROS-DEMO`, `KEIROS-ATL`, `KEIROS-DEN`  
API key (`.env`): `keiros_live_ot_demo_map_nav_2026`

Without ERP, splash → permissions → code → download still work; overview/search show a clear offline error with retry.

## Tour flow

Splash → Permissions → Property code / QR → Map download → Overview → Search destination → Route preview → Indoor 3D nav → Door access (optional) → Feedback

## Capacitor (later Android / iOS)

`capacitor.config.ts` is a stub. When ready:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npm run build
npx cap sync
```

Geolocation lives behind `src/permissions` so Capacitor plugins can replace the browser facade.
