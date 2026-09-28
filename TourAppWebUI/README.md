# Keiros Tour App (Web UI)

Capacitor-ready visitor **self-guided property tour** for U.S. multifamily & commercial properties.

## Stack

- React 19 + Vite + TypeScript
- Leaflet (outside path)
- Glossy SVG tower blueprint for indoor explore + stop picking
- Keiros navy theme (aligned with ERP)
- Live ERP APIs: hierarchy, navigate, access validate, dwell tracking
- Guided tour itinerary built from property amenities + model homes

## Tour experience

1. Scan / enter property code  
2. Welcome → **Start self-guided tour** (or browse places)  
3. Visit curated stops (lobby → amenities → model home)  
4. Directions between stops; change stop anytime inside  
5. Optional amenity unlocks → rate your visit  

Demo code: `OC-CHI-2026` (ERP Property Codes).

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
