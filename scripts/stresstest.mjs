#!/usr/bin/env node
/**
 * ima-sync · 打包前压力/规模自测（Node · mock · 默认不打真实 IMA）
 *
 * 独立 repo: npm run stresstest
 * wikimap:   npm run chronicle:ima-sync-stresstest
 */
import path from 'path'
import { createRequire } from 'module'
import { getPaths } from './_paths.mjs'
import { parseTestFlags, stressScale } from './_test-flags.mjs'

const { pluginRoot: PLUGIN } = getPaths()
const { quick } = parseTestFlags()
const { noteCount: NOTE_COUNT, bodyKb: BODY_KB, pushCount: PUSH_COUNT } = stressScale()
const tStart = Date.now()
const require = createRequire(import.meta.url)
const Module = require('module')

const moduleLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      requestUrl: async () => ({ status: 200, json: { code: 0 }, text: '{}' }),
      Modal: class Modal {
        constructor () { this.contentEl = { empty () {}, createEl () { return { addEventListener () {} } } } }
        open () {} close () {}
      }
    }
  }
  return moduleLoad(request, parent, isMain)
}

global.window = {
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a)
}
global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const { chunkText, computeContentHash, parseNoteFile } = require(path.join(PLUGIN, 'lib/utils.js'))
const { collectSyncStatFiles } = require(path.join(PLUGIN, 'lib/sync-stats.js'))
const { ImaSyncEngine } = require(path.join(PLUGIN, 'lib/sync-engine.js'))
const { SyncControl } = require(path.join(PLUGIN, 'lib/sync-control.js'))
const { normalizeTelemetry } = require(path.join(PLUGIN, 'lib/telemetry-local.js'))
const { enqueueEvent } = require(path.join(PLUGIN, 'lib/telemetry-report.js'))
const { buildEvent, HOOKS } = require(path.join(PLUGIN, 'lib/telemetry.js'))

const results = []

function record (id, pass, note) {
  results.push({ id, pass, note })
  console.log(`  ${id}  ${pass ? 'PASS' : 'FAIL'}  ${note}`)
}

function assert (id, cond, note) {
  record(id, Boolean(cond), note || (cond ? 'ok' : 'assertion failed'))
}

function assertTime (id, ms, budgetMs, label) {
  const pass = ms <= budgetMs
  record(id, pass, `${label}: ${ms}ms (≤${budgetMs}ms)`)
}

function buildNotes (count, folder = '编史') {
  const store = new Map()
  const fm = new Map()
  const files = []
  for (let i = 0; i < count; i++) {
    const p = `${folder}/stress-${i}.md`
    const ima = i % 5 === 0 ? 'synced' : i % 5 === 1 ? 'failed' : 'pending'
    const body = `段落${i}\n` + '字'.repeat(80)
    store.set(p, `---\ntitle: stress-${i}\nimport_key: sk-${i}\nsync:\n  ima: ${ima}\n---\n${body}`)
    fm.set(p, { frontmatter: { sync: { ima: ima }, import_key: `sk-${i}` } })
    files.push({
      path: p,
      basename: `stress-${i}`,
      extension: 'md',
      stat: { mtime: Date.now() },
      parent: { path: folder }
    })
  }
  return { store, fm, files }
}

function createMockApp (count, folder) {
  const { store, fm, files } = buildNotes(count, folder)
  return {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file) => store.get(file.path),
      getAbstractFileByPath: () => null,
      create: async (p, content) => { store.set(p, content); return { path: p } },
      modify: async (file, content) => { store.set(file.path, content) }
    },
    metadataCache: {
      getFileCache: (file) => fm.get(file.path) || null
    },
    fileManager: {
      processFrontMatter: async (file, fn) => {
        const raw = store.get(file.path)
        const parsed = parseNoteFile(raw)
        fn(parsed.frontmatter)
        const lines = ['---']
        for (const [k, v] of Object.entries(parsed.frontmatter)) {
          if (k === 'sync' && v && typeof v === 'object') {
            lines.push('sync:')
            for (const [sk, sv] of Object.entries(v)) lines.push(`  ${sk}: ${sv}`)
          } else {
            lines.push(`${k}: ${v}`)
          }
        }
        lines.push('---', '', parsed.body)
        store.set(file.path, lines.join('\n'))
      }
    },
    _store: store
  }
}

console.log('\n=== ima-sync 压力自测 ===')
console.log(`  规模: notes=${NOTE_COUNT} bodyKb=${BODY_KB} push=${PUSH_COUNT}${quick ? ' · quick' : ''}\n`)

// ST-CHUNK: 大正文分块
{
  const big = '段'.repeat(BODY_KB * 1024 / 3)
  const t0 = Date.now()
  const chunks = chunkText(big, { size: 1500, overlap: 200 })
  const ms = Date.now() - t0
  assert('ST-CHUNK-01', chunks.length > 10, `分块数 ${chunks.length}`)
  assertTime('ST-CHUNK-02', ms, 3000, 'chunkText')
}

// ST-HASH: 大量 hash
{
  const t0 = Date.now()
  for (let i = 0; i < NOTE_COUNT; i++) computeContentHash(`body-${i}`)
  assertTime('ST-HASH-01', Date.now() - t0, 8000, `${NOTE_COUNT}× computeContentHash`)
}

// ST-PARSE: 大量 frontmatter 解析
{
  const sample = buildNotes(1).store.values().next().value
  const t0 = Date.now()
  for (let i = 0; i < 1000; i++) parseNoteFile(sample)
  assertTime('ST-PARSE-01', Date.now() - t0, 5000, '1000× parseNoteFile')
}

// ST-STATS: 大库统计扫描
{
  const app = createMockApp(NOTE_COUNT)
  const settings = { syncFolders: ['编史'] }
  const t0 = Date.now()
  const r = await collectSyncStatFiles(app, settings, 'all', 200)
  const ms = Date.now() - t0
  assert('ST-STATS-01', r.total > 0 && r.items.length <= 200, `total=${r.total} items=${r.items.length}`)
  const budget = NOTE_COUNT >= 5000 ? 15000 : 10000
  assertTime('ST-STATS-02', ms, budget, `collectSyncStatFiles(${NOTE_COUNT})`)
}

// ST-PUSH: 批量 mock 推送（uploadGapMs=0 测引擎吞吐）
{
  const app = createMockApp(PUSH_COUNT)
  const settings = {
    apiUrl: '',
    apiKey: '',
    mockMode: true,
    syncFolders: ['编史'],
    conflictStrategy: 'local',
    uploadGapMs: 0,
    batchSize: 80,
    batchPauseSeconds: 0,
    chunkSize: 1500,
    chunkOverlap: 200,
    timeout: 30000
  }
  const engine = new ImaSyncEngine(app, settings, () => {})
  const t0 = Date.now()
  const summary = await engine.runSync('push')
  const ms = Date.now() - t0
  assert('ST-PUSH-01', summary.pushed > 0 && summary.errors.length === 0, `pushed=${summary.pushed} err=${summary.errors.length}`)
  const budget = PUSH_COUNT * 80 + 60000
  assertTime('ST-PUSH-02', ms, budget, `mock push×${PUSH_COUNT}`)
}

// ST-CTL: 高频 gate + 暂停/恢复（pause 后须 resume，否则 gate 阻塞）
{
  const ctrl = new SyncControl()
  let gates = 0
  const t0 = Date.now()
  for (let i = 0; i < 1500; i++) {
    if (await ctrl.gate()) gates++
  }
  ctrl.pause()
  const pauseProbe = ctrl.gate()
  await new Promise(r => setImmediate(r))
  assert('ST-CTL-01', ctrl.paused && gates === 1500, `暂停前 gate=${gates}`)
  ctrl.resume()
  const okAfterResume = await pauseProbe
  assert('ST-CTL-02', okAfterResume === true, 'resume 后 gate 恢复')
  for (let i = 0; i < 500; i++) {
    if (await ctrl.gate()) gates++
  }
  ctrl.requestStop()
  const stopped = await ctrl.gate()
  assert('ST-CTL-03', stopped === false, 'requestStop 后 gate=false')
  const ms = Date.now() - t0
  assert('ST-CTL-04', gates === 2000, `gate通过 ${gates}`)
  assertTime('ST-CTL-05', ms, 5000, 'SyncControl 暂停/恢复/停止')
}

// ST-TEL: pending 队列上限
{
  const settings = { telemetry: {}, telemetryEnabled: true }
  normalizeTelemetry(settings)
  for (let i = 0; i < 60; i++) {
    enqueueEvent(settings, buildEvent({ hook: HOOKS.HEARTBEAT, installId: settings.telemetry.installId, payload: { n: i } }))
  }
  assert('ST-TEL-01', settings.telemetry.pending.length <= 40, `pending capped ${settings.telemetry.pending.length}`)
}

const failed = results.filter(r => !r.pass)
console.log('\n---')
console.log(`合计 ${results.length} 项 · PASS ${results.length - failed.length} · FAIL ${failed.length}`)
if (failed.length) {
  console.log('\n失败项:')
  for (const f of failed) console.log(`  ${f.id}: ${f.note}`)
  process.exit(1)
}
console.log('\n压力自测 PASS · 可执行 bundle/install')
const elapsed = ((Date.now() - tStart) / 1000).toFixed(1)
console.log(`耗时 ${elapsed}s${quick ? ' · quick' : ''}\n`)
