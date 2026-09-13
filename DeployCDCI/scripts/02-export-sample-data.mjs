import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  COLLECTIONS_PATH,
  ERP_ROOT,
  SAMPLE_DATA_PATH,
  ensureOutDir,
  loadEnv,
  log,
  readCollectionsConfig,
} from './lib/paths.mjs'

loadEnv()
ensureOutDir()

const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-erp-data-worker.mts')

const result = spawnSync(process.execPath, [tsxCli, workerPath, SAMPLE_DATA_PATH, COLLECTIONS_PATH], {
  cwd: ERP_ROOT,
  encoding: 'utf8',
  env: { ...process.env },
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const data = JSON.parse(fs.readFileSync(SAMPLE_DATA_PATH, 'utf8'))
const cfg = readCollectionsConfig()
log('export', `Wrote ${SAMPLE_DATA_PATH}`)
log('export', `Mapped ${Object.keys(data.collections).length}/${cfg.collections.length} collections`)
