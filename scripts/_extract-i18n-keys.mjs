import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const s = fs.readFileSync(path.join(root, 'dist/main.js'), 'utf8')
const keys = [
  'proAdToastBody',
  'proAdToastTitle',
  'enrichUrlOnlyOne',
  'healthFolderListHead',
  'syncCurrentShort',
  'formatOneClickShort',
  'enrichOneClickShort',
  'syncCurrentFolderShort',
  'syncPauseAutoShort',
  'syncResumeAutoShort',
  'kbSelectCtaShort',
  'syncPauseShort',
  'syncResumeShort',
  'syncStopShort'
]
for (const k of keys) {
  const re = new RegExp(k + ':\\s*"((?:\\\\.|[^"\\\\])*)"', 'g')
  const all = [...s.matchAll(re)].map((m) => m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'))
  console.log(JSON.stringify({ key: k, values: all.slice(0, 4) }))
}
