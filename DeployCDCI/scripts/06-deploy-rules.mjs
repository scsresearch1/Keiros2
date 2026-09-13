import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { ROOT, loadEnv, log, requireEnv } from './lib/paths.mjs'

loadEnv()
requireEnv(['FIREBASE_PROJECT_ID'])

const projectId = process.env.FIREBASE_PROJECT_ID
log('rules', `Deploying firestore.rules to ${projectId}`)

const r = spawnSync(
  'npx',
  ['firebase-tools', 'deploy', '--only', 'firestore:rules', '--project', projectId],
  {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env },
  },
)

if (r.stdout) process.stdout.write(r.stdout)
if (r.stderr) process.stderr.write(r.stderr)
if (r.status !== 0) {
  console.error(
    '\n[rules] Deploy failed. Run: npx firebase-tools login\n' +
      'Or paste DeployCDCI/firestore.rules manually in Console → Firestore → Rules.',
  )
  process.exit(r.status ?? 1)
}

log('rules', 'Rules deployed')
