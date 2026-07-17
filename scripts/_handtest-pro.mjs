#!/usr/bin/env node
/**
 * Handtest helper: Pro entitlements + health/FQ/enrich detect from vault e2e notes.
 * Evidence only — does not mark E2E PASS.
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const Module = require('module')
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const obsidianStub = {
  requestUrl: async () => ({ status: 200, json: {}, text: '{}' }),
  Modal: class {
    constructor () {
      this.contentEl = {
        empty () {},
        createEl () { return { addEventListener () {}, setText () {} } },
        createDiv () { return { createEl () { return { addEventListener () {} } } } }
      }
    }
    open () {}
    close () {}
  },
  Notice: class { constructor () {} }
}
const moduleLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub
  return moduleLoad(request, parent, isMain)
}

const {
  isProActive, canUseGovern, canUseTrust, canUseEnrich, getEffectiveEntitlements
} = require(path.join(pluginRoot, 'lib/entitlements.js'))
const { auditNotes } = require(path.join(pluginRoot, 'lib/govern-rules.js'))
const { buildHealthReport } = require(path.join(pluginRoot, 'lib/health-score.js'))
const { formatWeeklyHealthMarkdown } = require(path.join(pluginRoot, 'lib/health-report.js'))
const {
  normalizeFailedQueue, removeFailedEntry, folderOfPath, filterItemsByFolder
} = require(path.join(pluginRoot, 'lib/failed-queue.js'))
const { detectEnrichTargets } = require(path.join(pluginRoot, 'lib/enrich-detect.js'))
const { renderEnrichPayloadMarkdown } = require(path.join(pluginRoot, 'lib/enrich-render.js'))

const dataPath = 'D:/system/home/home/.obsidian/plugins/ima-sync/data.json'
const e2eDir = 'D:/system/home/home/_ima-sync-e2e'
const settings = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

const ent = getEffectiveEntitlements(settings)
console.log(JSON.stringify({
  isProActive: isProActive(settings),
  canUseGovern: canUseGovern(settings),
  canUseTrust: canUseTrust(settings),
  canUseEnrich: canUseEnrich(settings),
  tier: ent.tier,
  source: ent._source,
  modules: ent.modules
}, null, 2))

const notes = fs.readdirSync(e2eDir).filter((f) => f.endsWith('.md')).map((f) => {
  const raw = fs.readFileSync(path.join(e2eDir, f), 'utf8')
  const title = (raw.match(/^#\s+(.+)$/m) || [])[1] || f.replace(/\.md$/, '')
  const body = raw.replace(/^---[\s\S]*?---\r?\n/, '').replace(/^#.+\r?\n/, '').trim()
  return {
    path: `_ima-sync-e2e/${f}`,
    basename: f.replace(/\.md$/, ''),
    title,
    body,
    frontmatter: {}
  }
})

const report = auditNotes(notes, settings)
const health = buildHealthReport(report, notes, settings)
console.log('health', JSON.stringify({ score: health.score, grade: health.grade, counts: health.counts }, null, 2))

const { t } = require(path.join(pluginRoot, 'lib/i18n.js'))
const weekly = formatWeeklyHealthMarkdown(health, report, (k, vars) => t(settings, k, vars), { tier: 'pro' })
const outDir = 'D:/system/home/home/_ima-sync/reports'
fs.mkdirSync(outDir, { recursive: true })
const weeklyPath = path.join(outDir, 'ima-health-weekly-handtest.md')
fs.writeFileSync(weeklyPath, weekly, 'utf8')
console.log('weekly', {
  path: weeklyPath,
  bytes: weekly.length,
  leakKey: /IMAPRO-|sk-[a-z]/.test(weekly)
})

const fq = normalizeFailedQueue({
  failedQueue: [
    { path: '_ima-sync-e2e/测试-网页.md', error: 'handtest', attempts: 2, at: new Date().toISOString() },
    { path: '_ima-sync-e2e/测试-短正文.md', error: 'handtest2', attempts: 1, at: new Date().toISOString() }
  ]
})
const after = removeFailedEntry(fq, '_ima-sync-e2e/测试-网页.md')
console.log('fq', {
  before: fq.length,
  afterIgnore: after.length,
  folder: folderOfPath(fq[0].path),
  inFolder: filterItemsByFolder(fq, '_ima-sync-e2e').length
})

// Persist sample failed queue for UI handtest (Obsidian Ctrl+R)
settings.failedQueue = fq
fs.writeFileSync(dataPath, JSON.stringify(settings, null, 2))
console.log('persisted failedQueue', settings.failedQueue.length)

const urlNote = notes.find((n) => /https?:\/\//.test(n.body || ''))
if (urlNote) {
  const det = detectEnrichTargets(urlNote.body, urlNote.frontmatter, settings)
  console.log('enrichDetect', det)
  const sample = renderEnrichPayloadMarkdown({
    title: 'Example',
    body: 'Hello\n\n![图片](https://example.com/a.png)',
    source_url: 'https://example.com',
    author: '未知',
    published_at: '未知'
  })
  console.log('enrichSkeleton', {
    hasUrl: sample.includes('https://example.com'),
    hasImgPlaceholder: sample.includes('![图片]')
  })
}

console.log('DONE')
