import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '../..')
export const REPO_ROOT = path.resolve(ROOT, '..')
export const ERP_ROOT = path.join(REPO_ROOT, 'ERP_Full')
export const OUT_DIR = path.join(ROOT, 'out')
export const SAMPLE_DATA_PATH = path.join(OUT_DIR, 'sample-data.json')
export const COLLECTIONS_PATH = path.join(ROOT, 'config', 'collections.json')

export function loadEnv() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing ${envPath} — copy .env.example to .env and fill values.`)
  }
  dotenv.config({ path: envPath })
}

export function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '')
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`)
  }
}

export function readCollectionsConfig() {
  return JSON.parse(fs.readFileSync(COLLECTIONS_PATH, 'utf8'))
}

export function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
}

export function log(step, message) {
  console.log(`[${step}] ${message}`)
}
