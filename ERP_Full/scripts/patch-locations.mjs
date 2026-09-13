import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'erpData.ts')
let s = fs.readFileSync(filePath, 'utf8')
const start = s.indexOf('export const locations: Location[] = [')
const end = s.indexOf('export const mappingQueue')
if (start < 0 || end < 0) throw new Error('markers not found')

const head = s.slice(0, start)
const tail = s.slice(end)
const arrText = s.slice(start, end).replace('export const locations: Location[] = ', 'return ')
const locations = new Function(arrText)()

const cityBase = {
  'Orion Complex': { lat: 41.8954, lng: -87.6243, elev: 182, addr: '1200 N Michigan Ave, Chicago, IL' },
  'Harbor Mall Campus': { lat: 42.3512, lng: -71.0445, elev: 6, addr: '88 Seaport Blvd, Boston, MA' },
  'Summit Medical Campus': { lat: 39.7431, lng: -104.9556, elev: 1610, addr: '2550 E 17th Ave, Denver, CO' },
  'Northgate Plaza': { lat: 47.7086, lng: -122.3271, elev: 90, addr: '401 NE Northgate Way, Seattle, WA' },
  'Lakeside Community': { lat: 30.3072, lng: -97.7559, elev: 160, addr: '4100 Lakeshore Dr, Austin, TX' },
}

const out = locations.map((loc, i) => {
  let base = cityBase[loc.complexName]
  if (!base) {
    if (loc.buildingName === 'Standalone Clinic') {
      base = { lat: 37.3382, lng: -121.8863, elev: 25, addr: '220 Clinic Park Dr, San Jose, CA' }
    } else if (loc.buildingName === 'Riverside Tower') {
      base = { lat: 37.7946, lng: -122.3999, elev: 12, addr: '88 Embarcadero, San Francisco, CA' }
    } else {
      base = { lat: 37.7749, lng: -122.4194, elev: 16, addr: '100 Independent Way' }
    }
  }
  const level = Number((loc.floorLabel.match(/\d+/) || ['1'])[0])
  const physicalAddress =
    loc.type === 'Unit' || loc.type === 'Room'
      ? `${base.addr.split(',')[0]}, ${loc.name},${base.addr.slice(base.addr.indexOf(','))}`
      : `${base.addr} · ${loc.name}`
  return {
    ...loc,
    physicalAddress,
    latitude: Number((base.lat + (i % 7) * 0.00012).toFixed(6)),
    longitude: Number((base.lng + (i % 5) * 0.00009).toFixed(6)),
    elevation: Number((base.elev + level * 3.2).toFixed(1)),
  }
})

function serialize(value, indent = 0) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return `[\n${value.map((item) => `${pad}  ${serialize(item, indent + 2)}`).join(',\n')},\n${pad}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    return `{\n${entries
      .map(([key, val]) => `${pad}  ${key}: ${serialize(val, indent + 2)}`)
      .join(',\n')},\n${pad}}`
  }
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

const block = `export const locations: Location[] = ${serialize(out)}\n\n`
fs.writeFileSync(filePath, head + block + tail)
console.log('patched', out.length, 'locations')
