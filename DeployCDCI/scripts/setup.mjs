import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, log } from './lib/paths.mjs'

function run(script) {
  log('setup', `→ ${script}`)
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) {
    throw new Error(`Step failed: ${script}`)
  }
}

if (!fs.existsSync(path.join(ROOT, '.env'))) {
  console.error('Create DeployCDCI/.env from .env.example and fill Firebase values first.')
  process.exit(1)
}

run('00-provision-firebase.mjs')
run('01-validate-env.mjs')
run('02-export-sample-data.mjs')
run('03-seed-firestore.mjs')
run('04-seed-auth-users.mjs')
run('05-wire-erp.mjs')

console.log(`
========================================
Keiros Firebase setup finished
========================================
Next:
  1. If provision failed on API permissions: create Firestore + enable Email/Password in Console (see script output)
  2. Console → Firestore → confirm collections (organizations, complexes, …)
  3. Console → Authentication → Users (admin + seeded emails)
  4. Optional: npm run deploy:rules  (or paste firestore.rules in Console)
  5. cd ../ERP_Full && npm run dev
  6. Login with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD

If Google TLS fails on this PC, run:
  $env:NODE_TLS_REJECT_UNAUTHORIZED='0'; npm run setup
`)
