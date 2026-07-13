#!/usr/bin/env node
/**
 * ima-sync Obsidian 插件 · 功能自测（Node 环境模拟）
 *
 * 独立 repo: npm run selftest
 * wikimap:   npm run chronicle:ima-sync-selftest
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { getPaths } from './_paths.mjs'
import { parseTestFlags } from './_test-flags.mjs'

const { pluginRoot: PLUGIN, distDir: DIST } = getPaths()
const { quick, skipBuild } = parseTestFlags()
const tStart = Date.now()
const require = createRequire(import.meta.url)
const Module = require('module')

// Node 环境模拟 obsidian（ima-api requestUrl、conflicts Modal）
const obsidianStub = {
  telemetryFail: false,
  requestUrl: async function () {
    if (obsidianStub.telemetryFail) throw new Error('network down')
    return {
      status: 200,
      json: { code: 0, msg: 'ok', data: {} },
      text: JSON.stringify({ code: 0 })
    }
  },
  Modal: class Modal {
    constructor () {
      this.contentEl = {
        empty () {},
        createEl () {
          return { addEventListener () {}, setText () {} }
        },
        createDiv () {
          return { createEl () { return { addEventListener () {} } } }
        }
      }
    }
    open () {}
    close () {}
  }
}
const moduleLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub
  return moduleLoad(request, parent, isMain)
}

globalThis.__IMA_SYNC_DEV_BYPASS__ = true

// ima-api 依赖 window / fetch
global.window = global.window || {
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a)
}
global.fetch = global.fetch || (async () => ({
  ok: false,
  status: 503,
  statusText: 'stub',
  json: async () => ({})
}))
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'))

const {
  chunkText,
  computeContentHash,
  parseNoteFile,
  isUnderSyncFolders,
  parseTime
} = require(path.join(PLUGIN, 'lib/utils.js'))

const { t, label, resolveLang, STR } = require(path.join(PLUGIN, 'lib/i18n.js'))
const { extractAttachmentRefs } = require(path.join(PLUGIN, 'lib/attachments.js'))
const { detectConflict, resolveConflict } = require(path.join(PLUGIN, 'lib/conflicts.js'))
const { ImaApiClient, normalizeApiBase, extractImaNoteId } = require(path.join(PLUGIN, 'lib/ima-api.js'))
const { ImaSyncEngine } = require(path.join(PLUGIN, 'lib/sync-engine.js'))
const { SyncControl } = require(path.join(PLUGIN, 'lib/sync-control.js'))
const { createVaultReadyGate, probeMetadataReady } = require(path.join(PLUGIN, 'lib/vault-ready.js'))
const {
  parseApiKeyExpiresAt,
  getApiKeyExpiryState,
  shouldShowApiKeyExpiryReminder,
  snoozeApiKeyExpiryReminder,
  markApiKeyExpiryReminderShown,
  isLikelyAuthFailure,
  isInvalidApiKeyExpiresAtInput,
  normalizeApiKeyExpiresAtInput,
  clearApiKeyExpiryReminders,
  apiKeyExpiryStatusKey,
  addDaysToToday,
  shouldShowApiKeyExpiryBanner
} = require(path.join(PLUGIN, 'lib/api-key-expiry.js'))

const results = []

function record (id, pass, note) {
  results.push({ id, pass, note })
  console.log(`  ${id}  ${pass ? 'PASS' : 'FAIL'}  ${note}`)
}

function assert (id, cond, note) {
  record(id, Boolean(cond), note || (cond ? 'ok' : 'assertion failed'))
}

console.log('\n=== ima-sync 自测 ===')
if (quick) console.log('  模式: quick（跳过 bundle）')
if (skipBuild && !quick) console.log('  模式: skip-build')
console.log('')

// --- utils ---
const long = '甲'.repeat(2000)
const chunks = chunkText(long, { size: 500, overlap: 50 })
assert('TC-UTIL-01', chunks.length > 1 && chunks.every(c => c.length <= 500), `chunkText → ${chunks.length} 块`)

const noteRaw = `---
title: 测试
import_key: test-key
sync:
  ima: pending
ima_doc_id: doc-1
ima_content_hash: abc
---
正文内容。`
const parsed = parseNoteFile(noteRaw)
assert('TC-UTIL-02', parsed.frontmatter.title === '测试' && parsed.frontmatter.sync?.ima === 'pending', 'parseNoteFile frontmatter')
assert('TC-UTIL-03', computeContentHash(parsed.body) === computeContentHash(parsed.body), 'contentHash 稳定')

assert('TC-UTIL-04', isUnderSyncFolders('编史/a.md', ['编史']), 'sync folder 命中')
assert('TC-UTIL-05', !isUnderSyncFolders('其他/a.md', ['编史']), 'sync folder 排除')
assert('TC-UTIL-06', isUnderSyncFolders('任意.md', []), '空目录=全库')

assert('TC-UTIL-07', parseTime('2026-06-08T02:46:00Z') > 0, 'parseTime')

// --- vault-ready ---
const mockFiles = [{ path: 'a.md' }, { path: 'b.md' }]
const mockAppCached = {
  vault: { getMarkdownFiles: () => mockFiles },
  metadataCache: {
    getFileCache: () => ({ frontmatter: {} }),
    on: () => ({})
  },
  workspace: { layoutReady: true, onLayoutReady: () => ({}) }
}
assert('TC-VR-01', probeMetadataReady(mockAppCached), 'metadata 已缓存 → ready')
assert('TC-VR-02', probeMetadataReady({ vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } }), '空库 → ready')
const gate = createVaultReadyGate(mockAppCached)
const mockPlugin = { registerEvent: () => {}, register: () => {} }
gate.bind(mockPlugin)
assert('TC-VR-03', gate.isReady(), 'layout+metadata 同步探测 → gate ready')
const gatePending = createVaultReadyGate({
  vault: { getMarkdownFiles: () => [{ path: 'a.md' }] },
  metadataCache: { getFileCache: () => null, on: () => ({}) },
  workspace: { layoutReady: false, onLayoutReady: () => ({}) }
})
let gateResolved = false
gatePending.whenReady({ timeoutMs: 50 }).then(() => { gateResolved = true })
await new Promise((r) => setTimeout(r, 80))
assert('TC-VR-04', gateResolved, 'whenReady timeout → resolve')

// --- i18n ---
const zh = { language: 'zh' }
const en = { language: 'en' }
const auto = { language: 'auto' }
assert('TC-I18N-01', t(zh, 'aboutEmail') === 'shujuliu@foxmail.com', '中文邮箱')
assert('TC-I18N-02', t(en, 'aboutEmail') === 'shujuliu@foxmail.com', '英文邮箱')
assert('TC-I18N-03', label(auto, 'apiKey').includes('API'), 'auto 双语标签')
assert('TC-I18N-04', resolveLang(zh) === 'zh' && resolveLang(en) === 'en', '语言解析')
assert('TC-I18N-05', STR.zh.aboutDesc.includes('临忆录'), '简介文案')
assert('TC-I18N-07', t(zh, 'tip_apiKey_body').includes('ima.qq.com'), 'API Key 帮助')
assert('TC-I18N-08', t(zh, 'tip_noteBadge_body').includes('已同步'), '笔记状态帮助去技术化')
assert('TC-I18N-09', t(zh, 'rateLimitBackoffSec').includes('限频'), '限频标签')
assert('TC-I18N-10', t(zh, 'trustCapBase') === '基础推送', '能力标签')
assert('TC-I18N-11', t(zh, 'tip_trustHero_title').length > 0 && t(en, 'tip_governHero_body').includes('local'), '新增帮助键')

// --- attachments ---
const bodyWithImg = '文字 ![[assets/pic.png]] 更多 ![](photo.jpg)'
const refs = extractAttachmentRefs(bodyWithImg, '编史/note.md')
assert('TC-ATT-01', refs.length === 2, `附件引用 ${refs.length}`)
assert('TC-ATT-02', refs.some(r => r.path.includes('pic.png')), 'wiki 链接解析')
assert('TC-ATT-03', refs.every(r => !r.path.startsWith('http')), '跳过远程 URL')

// --- conflicts ---
const synced = 'same-base'
const baseHash = computeContentHash(synced)
const c1 = detectConflict({ body: 'local edit', syncedHash: baseHash }, { content: synced, content_hash: baseHash })
assert('TC-CON-01', c1.kind === 'local_newer', '仅本地修改')

const c2 = detectConflict({ body: synced, syncedHash: baseHash }, { content: 'remote edit', content_hash: computeContentHash('remote edit') })
assert('TC-CON-02', c2.kind === 'remote_newer', '仅远程修改')

const c3 = detectConflict({ body: 'local', syncedHash: baseHash }, { content: 'remote', content_hash: computeContentHash('remote') })
assert('TC-CON-03', c3.kind === 'both_changed', '双向冲突')

const c4 = detectConflict({ body: synced, syncedHash: baseHash }, { content: synced, content_hash: baseHash })
assert('TC-CON-04', c4.kind === 'none', '无变化')

const pushAction = await resolveConflict(null, {}, 'local')
const pullAction = await resolveConflict(null, {}, 'remote')
const skipAction = await resolveConflict(null, {}, 'skip')
assert('TC-CON-05', pushAction === 'push' && pullAction === 'pull' && skipAction === 'skip', '冲突策略')

// --- ima-api ---
const unconfigured = new ImaApiClient({ apiUrl: '', apiKey: '', mock: false })
assert('TC-API-01', unconfigured.shouldMock(), '未配置 → mock')

const configured = new ImaApiClient({ apiUrl: 'https://api.test/ima', apiKey: 'sk-test', mock: false })
assert('TC-API-02', !configured.shouldMock(), '已配置且 mock=false → 真实')

const configuredMock = new ImaApiClient({ apiUrl: 'https://api.test/ima', apiKey: 'sk-test', mock: true })
assert('TC-API-03', configuredMock.shouldMock(), '已配置但 mock=true → mock')

const askClient = new ImaApiClient({ apiUrl: 'https://api.test/ima/ask', apiKey: 'k' })
assert('TC-API-04', askClient.documentsUrl().endsWith('/documents'), `URL 推导 ${askClient.documentsUrl()}`)

assert('TC-API-09', normalizeApiBase('https://ima.qq.com/agent-interface') === 'https://ima.qq.com', 'agent-interface 归一化')
const tencentClient = new ImaApiClient({
  apiUrl: 'https://ima.qq.com/agent-interface',
  apiKey: 'k',
  clientId: 'c',
  mock: false
})
assert('TC-API-10', tencentClient.isTencentIma(), '腾讯 IMA 检测')
assert('TC-API-11', tencentClient.openapiUrl('openapi/wiki/v1/search_knowledge_base').includes('/openapi/wiki/'), 'OpenAPI 路径')

assert('TC-API-13', extractImaNoteId({ note_id: 'n1' }) === 'n1', 'note_id 解析')
assert('TC-API-14', extractImaNoteId({ data: { note_id: 'n2' } }) === 'n2', 'data.note_id 解析')
assert('TC-API-15', extractImaNoteId({ doc_info: { basic_info: { basic_info: { docid: 'd1' } } } }) === 'd1', 'doc_info.docid 解析')
const kbFromInfoList = tencentClient.normalizeKbListResponse({
  info_list: [{ kb_id: 'BhCFmfWzNRabc', kb_name: '临忆录' }]
})
assert('TC-API-16', kbFromInfoList.length === 1 && kbFromInfoList[0].id === 'BhCFmfWzNRabc' && kbFromInfoList[0].label === '临忆录', 'info_list 解析')

const { isRetryableNetworkError, isNetworkErrorMessage, withNetworkRetry } = require(path.join(PLUGIN, 'lib/net-retry.js'))
const { classifyImaError, parseImaError } = require(path.join(PLUGIN, 'lib/ima-errors.js'))
const { backoffMsList } = require(path.join(PLUGIN, 'lib/rate-limit.js'))
assert('TC-NET-01', isRetryableNetworkError(new Error('IMA_TIMEOUT: 30000ms')), '超时可重试')
assert('TC-NET-02', !isRetryableNetworkError(new Error('IMA_QUOTA_EXCEEDED: 超量')), '超量不重试')
assert('TC-NET-03', isNetworkErrorMessage('无法连接 IMA 服务'), '断网文案识别')
let netAttempts = 0
await withNetworkRetry(async () => {
  netAttempts++
  if (netAttempts < 3) throw new Error('IMA_TIMEOUT: 100ms')
  return 'ok'
}, { maxRetries: 3, retryDelayMs: 10 })
assert('TC-NET-04', netAttempts === 3, `重试 3 次后成功 attempts=${netAttempts}`)
assert('TC-NET-05', classifyImaError(429, undefined, '请求过于频繁') === 'rate', 'HTTP 429 识别为限频')
assert('TC-NET-06', backoffMsList('60,120,300').join(',') === '60000,120000,300000', '退避秒解析')
assert('TC-NET-07', parseImaError(new Error('IMA_RATE_LIMIT: x'))?.kind === 'rate', 'IMA_RATE_LIMIT 解析')

const { PLUGIN_VERSION, CHANGELOG, CHANGELOG_FORBIDDEN } = require(path.join(PLUGIN, 'lib/changelog.js'))
assert('TC-CL-01', CHANGELOG.length >= 10, `changelog ${CHANGELOG.length} 条`)
assert('TC-CL-02', !CHANGELOG.some((e) => ['1.5.19', '1.5.20', '1.5.21', '1.5.22'].includes(e.version)), '1.5.19–1.5.22 不入更新历史')
function versionGte (a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return true
    if (x < y) return false
  }
  return true
}

assert('TC-CL-02b', versionGte(PLUGIN_VERSION, CHANGELOG[0].version), `manifest ${PLUGIN_VERSION} >= changelog ${CHANGELOG[0].version}`)
let sponsorWordHit = ''
for (const entry of CHANGELOG) {
  for (const lang of ['zh', 'en']) {
    for (const line of entry[lang] || []) {
      if (CHANGELOG_FORBIDDEN.test(line)) sponsorWordHit = `${entry.version}/${lang}: ${line}`
    }
  }
}
assert('TC-CL-03', !sponsorWordHit, `changelog 禁打赏措辞 ${sponsorWordHit || 'ok'}`)

const productConfig = require(path.join(PLUGIN, 'lib/product-config.js'))
const productManifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'product-manifest.json'), 'utf8'))
assert('TC-PROD-01', productConfig.productId === 'ima-sync', 'productId')
assert('TC-PROD-02', productConfig.brandSiteHost === productManifest.brand.siteHost, 'brandSiteHost 来自 manifest')
assert('TC-PROD-03', productConfig.defaultAnalyticsEventsUrl === productManifest.analytics.defaultEventsUrl, 'analytics URL 来自 manifest')
assert('TC-PROD-04', productConfig.sponsorBases.every((u) => u.includes(productManifest.brand.siteHost)), 'sponsor bases 含 host')
assert('TC-PROD-05', productConfig.clientChannel === 'ima-sync', 'clientChannel')
assert('TC-CLD-00', productConfig.licenseActivateUrl.includes('/api/v1/ima-sync/license/activate'), 'License activate URL')

const { buildBrandOverrides, applyBrandStrings } = require(path.join(PLUGIN, 'lib/brand-strings.js'))
const testManifestPath = path.join(PLUGIN, 'fixtures/product-manifest.test.json')
const testManifest = JSON.parse(fs.readFileSync(testManifestPath, 'utf8'))
const testConfig = productConfig.fromManifest(testManifest)
assert('TC-PROD-06', testConfig.brandSiteHost === 'plugin.example.com', '白标夹具 siteHost')
assert('TC-PROD-07', testConfig.defaultAnalyticsEventsUrl === testManifest.analytics.defaultEventsUrl, '白标 analytics URL')
assert('TC-PROD-08', testConfig.sponsorBases.every((u) => u.includes('plugin.example.com')), '白标 sponsor bases')
const testOverrides = buildBrandOverrides(testManifest)
assert('TC-PROD-09', testOverrides.zh.aboutDesc === '白标测试描述' && testOverrides.en.aboutDesc === 'White-label test description', '白标 aboutDesc')
assert('TC-PROD-10', testOverrides.zh.aboutEmail === 'test@example.com', '白标 aboutEmail')
assert('TC-PROD-11', testOverrides.zh.authorFollowHint === '' && testOverrides.en.authorFollowHint === '', '白标无公众号时清空 followHint')
const strFixture = { zh: { pluginName: 'placeholder', authorFollowHint: 'old' }, en: { pluginName: 'placeholder', authorFollowHint: 'old' } }
applyBrandStrings(strFixture, testManifest)
assert('TC-PROD-12', strFixture.zh.pluginName === '测试 IMA 同步' && strFixture.zh.authorFollowHint === '', 'applyBrandStrings 白标覆盖')
assert('TC-PROD-13', testConfig.clientChannel === 'ima-sync-test', '白标 clientChannel')

const pkgPath = path.join(PLUGIN, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
assert('TC-REPO-01', pkg.scripts?.pregate && pkg.scripts?.bundle, '独立 repo package.json scripts')
assert('TC-REPO-02', fs.existsSync(path.join(PLUGIN, 'scripts/bundle.mjs')), 'scripts/bundle.mjs SSOT')
assert('TC-REPO-03', fs.existsSync(path.join(PLUGIN, '.github/workflows/pregate.yml')), '独立 CI 模板')

const obsManifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'manifest.json'), 'utf8'))
assert('TC-COMM-01', obsManifest.description && !/[\u4e00-\u9fff]/.test(obsManifest.description), 'manifest description 英文')
assert('TC-COMM-02', fs.existsSync(path.join(PLUGIN, 'README.en.md')), 'README.en.md')
assert('TC-COMM-03', productManifest.distribution?.githubRepo && productManifest.distribution?.brat?.repoUrl, 'distribution github/brat')

const syncVer = spawnSync('node', [path.join(PLUGIN, 'scripts/sync-versions.mjs')], {
  env: { ...process.env, IMA_SYNC_ROOT: PLUGIN },
  shell: true,
  stdio: 'pipe',
  encoding: 'utf8'
})
assert('TC-UPD-00', syncVer.status === 0, 'sync-versions 脚本')

const versionsPath = path.join(PLUGIN, 'versions.json')
assert('TC-UPD-01', fs.existsSync(versionsPath), 'versions.json 存在')
const versionsMap = JSON.parse(fs.readFileSync(versionsPath, 'utf8'))
assert('TC-UPD-02', versionsMap[obsManifest.version] === obsManifest.minAppVersion, 'versions 当前版 minApp')
assert('TC-UPD-03', Object.keys(versionsMap).length >= 10, `versions 条目 ${Object.keys(versionsMap).length}`)
assert('TC-ANALYT-01', productManifest.analytics?.tenantId === 'linyilu-default', 'analytics tenantId')
assert('TC-LIC-01', productManifest.license?.proTier?.locksCoreFeatures === false, 'Pro 不锁核心')

const { resolveProBenefits, proLearnMoreUrl } = require(path.join(PLUGIN, 'lib/pro-ad-block.js'))
const proBenefitsZh = resolveProBenefits({ language: 'zh' })
assert('TC-PRO-AD-01', proBenefitsZh.length >= 3, 'Pro 广告权益列表')
assert('TC-PRO-AD-02', proLearnMoreUrl().includes('/tools/ima-sync'), 'Pro 了解链接')

const {
  SPONSOR_BASES,
  SPONSOR_QR_URL,
  SPONSOR_MD5_URL,
  readPendingBody,
  resolveArrayBuffer,
  resolveText,
  md5Hex,
  parseServerMd5
} = require(path.join(PLUGIN, 'lib/sponsor-qr.js'))
assert('TC-SP-01', SPONSOR_QR_URL.includes('sponsor-alipay.png'), '官方支付宝 QR URL')
assert('TC-SP-01b', SPONSOR_BASES.length === 2 && SPONSOR_BASES[0].startsWith('https://') && SPONSOR_BASES[1].startsWith('http://'), 'HTTPS 优先 + HTTP 回退')
assert('TC-SP-02', SPONSOR_MD5_URL.includes('sponsor-alipay.md5'), '官方 MD5 URL')
assert('TC-SP-03', t(zh, 'sponsorQrFallbackHint') === '联网显示二维码', 'fallback 提示换行上句')
assert('TC-SP-03b', t(zh, 'sponsorQrFallbackBrand') === '临忆录', 'fallback 品牌换行下句')
assert('TC-SP-04', md5Hex(new TextEncoder().encode('')) === 'd41d8cd98f00b204e9800998ecf8427e', 'MD5 空串')
assert('TC-SP-05', parseServerMd5('  abcdef0123456789abcdef0123456789  \n') === 'abcdef0123456789abcdef0123456789', 'parseServerMd5')
assert('TC-SP-06', (await resolveText({ text: Promise.resolve('70be878127491c267edad9a19aba369d\n') })) === '70be878127491c267edad9a19aba369d\n', 'resolveText Promise')
assert('TC-SP-07', (await resolveArrayBuffer({ arrayBuffer: Promise.resolve(new ArrayBuffer(128)) }))?.byteLength === 128, 'resolveArrayBuffer Promise')
assert('TC-SP-08', (await resolveArrayBuffer({ async arrayBuffer () { return new ArrayBuffer(128) } }))?.byteLength === 128, 'resolveArrayBuffer method')
assert('TC-SP-09', (await readPendingBody({ async arrayBuffer () { return new ArrayBuffer(96) } }, 'arrayBuffer'))?.byteLength === 96, 'readPendingBody arrayBuffer')
assert('TC-SP-10', await readPendingBody({ async text () { return '70be878127491c267edad9a19aba369d' } }, 'text') === '70be878127491c267edad9a19aba369d', 'readPendingBody text')

assert('TC-I18N-06', t(zh, 'statusTencentHint').includes('ima.qq.com'), '腾讯提示文案')

const tencentHealth = await tencentClient.checkHealth()
assert('TC-API-12', tencentHealth.ok && !tencentHealth.mock, '腾讯健康检查 mock 探针')

const healthMock = await unconfigured.checkHealth()
assert('TC-API-05', healthMock.ok && healthMock.mock, 'mock 健康检查')

const upload = await unconfigured.uploadDocument({ title: 'T', body: '内容', importKey: 'k1' })
assert('TC-API-06', upload.ok && upload.mock && upload.doc_id, `mock 上传 doc=${upload.doc_id}`)

const attach = await unconfigured.uploadAttachment('doc-1', new Blob(['x']), 'a.png')
assert('TC-API-07', attach.ok && attach.url.includes('mock://'), 'mock 附件')

const list = await unconfigured.listDocuments()
assert('TC-API-08', list.mock && Array.isArray(list.items), 'mock 列表')

// --- sync-engine (mock Obsidian) ---
function createMockApp (notes) {
  const store = new Map(Object.entries(notes))
  const fmPatches = []

  return {
    vault: {
      getMarkdownFiles () {
        return [...store.keys()].map(p => ({
          path: p,
          basename: path.basename(p, '.md'),
          extension: 'md',
          stat: { mtime: Date.now() },
          parent: { path: path.dirname(p).replace(/\\/g, '/') }
        }))
      },
      read: async (file) => store.get(file.path) || store.get(file),
      getAbstractFileByPath: () => null,
      create: async (p, content) => { store.set(p, content); return { path: p } },
      modify: async (file, content) => { store.set(file.path, content) }
    },
    fileManager: {
      processFrontMatter: async (file, fn) => {
        const raw = store.get(file.path)
        const { frontmatter, body } = parseNoteFile(raw)
        fn(frontmatter)
        const lines = ['---']
        for (const [k, v] of Object.entries(frontmatter)) {
          if (k === 'sync' && v && typeof v === 'object') {
            lines.push('sync:')
            for (const [sk, sv] of Object.entries(v)) lines.push(`  ${sk}: ${sv}`)
          } else {
            lines.push(`${k}: ${v}`)
          }
        }
        lines.push('---', '', body)
        store.set(file.path, lines.join('\n'))
        fmPatches.push(file.path)
      }
    },
    _store: store,
    _fmPatches: fmPatches
  }
}

const settings = {
  apiUrl: '',
  apiKey: '',
  mockMode: true,
  syncFolders: ['编史'],
  conflictStrategy: 'local',
  pullNewFromIma: true,
  chunkSize: 1500,
  chunkOverlap: 200,
  timeout: 30000
}

const notePath = '编史/条目.md'
const hash = computeContentHash('临忆录示例正文')
const initial = `---
title: 临忆录
import_key: linyilu-sample
sync:
  ima: pending
ima_content_hash: ${hash}
---
临忆录示例正文`
const app = createMockApp({ [notePath]: initial })
const engine = new ImaSyncEngine(app, settings, () => {})

const push1 = await engine.pushNote(app.vault.getMarkdownFiles()[0])
assert('TC-SYNC-01', push1.pushed && push1.doc_id, `推送 ${push1.doc_id}`)

const afterPush = parseNoteFile(app._store.get(notePath))
assert('TC-SYNC-02', afterPush.frontmatter.sync?.ima === 'synced', 'frontmatter synced')
assert('TC-SYNC-03', afterPush.frontmatter.ima_doc_id, '写入 ima_doc_id')

const push2 = await engine.pushNote(app.vault.getMarkdownFiles()[0])
assert('TC-SYNC-04', push2.skipped, '增量跳过未改笔记')

app._store.set(notePath, initial.replace('临忆录示例正文', '临忆录示例正文\n新增段落'))
const push3 = await engine.pushNote(app.vault.getMarkdownFiles()[0], true)
assert('TC-SYNC-05', push3.pushed, 'force 推送修改')

const summary = await engine.runSync('push')
assert('TC-SYNC-06', summary.pushed >= 0 && !summary.errors.length, `批量 push errors=${summary.errors.length}`)

const folderSummary = await engine.pushFolder('编史')
assert('TC-SYNC-07', folderSummary.total === 1 && folderSummary.skipped === 1, `文件夹推送 total=${folderSummary.total}`)

const rootSummary = await engine.pushFolder('')
assert('TC-SYNC-08', rootSummary.total >= 1, `库根推送 total=${rootSummary.total}`)

// --- sync control stop ---
const control = new SyncControl()
const engine2 = new ImaSyncEngine(app, settings, () => {}, control)
control.requestStop()
const summaryStop = await engine2.runSync('push')
assert('TC-CTL-01', summaryStop.stopped === true, '停止同步')

assert('TC-CTL-02', !new SyncControl().paused && !new SyncControl().stopRequested, 'control 初始状态')

let pullBlocked = false
try {
  await engine.runSync('pull')
} catch (e) {
  pullBlocked = /pullDisabled|已关闭|disabled/i.test(String(e.message || e))
}
assert('TC-SYNC-09', pullBlocked, '未开启实验时拦截拉取')

// --- Trust (Pro) ---
const { isProActive, verifyProLicenseKey, sig8 } = require(path.join(PLUGIN, 'lib/license.js'))
const { evaluateDedup } = require(path.join(PLUGIN, 'lib/trust-dedup.js'))
const { verifyPushedNote, matchKnowledgeHit } = require(path.join(PLUGIN, 'lib/trust-verify.js'))
const { formatTrustReportMarkdown, TrustReportCollector } = require(path.join(PLUGIN, 'lib/trust-report.js'))
const { formatTrustBatchNotice, trustHeroMetrics } = require(path.join(PLUGIN, 'lib/trust-prominence.js'))
const { upsertFailedEntry, removeFailedEntry } = require(path.join(PLUGIN, 'lib/failed-queue.js'))

const proKey = `IMAPRO-${sig8('ima-sync-pro|IMAPRO-')}`
assert('TC-TRUST-07', verifyProLicenseKey(proKey) && !verifyProLicenseKey('bad-key'), 'Pro license 校验')

const {
  getEffectiveEntitlements,
  hasModule,
  entitlementStatus,
  MODULE_TRUST,
  MODULE_GOVERN,
  MODULE_CORE_FREE,
  TIER_FREE,
  TIER_PRO,
  trustVerifyAllowed,
  trustDedupAllowed,
  syncDirectoriesMax,
  canAddSyncDirectory,
  effectiveSyncFolders
} = require(path.join(PLUGIN, 'lib/entitlements.js'))

const {
  activateProLicenseCloud,
  applyActivateResult,
  applyHardRevokeIfNeeded,
  clearCloudLicenseCache,
  cloudLicenseEnabled,
  mockActivate
} = require(path.join(PLUGIN, 'lib/license-cloud.js'))
const cloudSettings = {
  proLicenseKey: proKey,
  licenseMock: true,
  licenseCloudEnabled: true,
  telemetry: { installId: 'selftest-install' }
}
const mockResult = mockActivate(cloudSettings, proKey)
assert('TC-CLD-01', mockResult.ok && mockResult.entitlements?.product === 'ima-sync', 'mock activate')
applyActivateResult(cloudSettings, { ...mockResult, licenseKey: proKey })
assert('TC-CLD-02', cloudSettings.entitlementsCache?.tier === TIER_PRO && hasModule(cloudSettings, MODULE_TRUST), '写入 entitlementsCache')
clearCloudLicenseCache(cloudSettings)
assert('TC-CLD-03', !cloudSettings.entitlementsCache && cloudLicenseEnabled({ licenseCloudEnabled: true }), '清缓存')
const activateRes = await activateProLicenseCloud(cloudSettings, { pluginVersion: '1.5.39' })
assert('TC-CLD-04', activateRes.ok && cloudSettings.entitlementsCacheKey === proKey, 'activateProLicenseCloud mock')

const { formatProCloudError } = require(path.join(PLUGIN, 'lib/license-cloud.js'))
assert('TC-CLD-05', formatProCloudError({ language: 'zh' }, { error: 'seat_limit' }).includes('席位'), '云端席位错误文案')

const hardRevokeSettings = {
  proLicenseKey: proKey,
  proActivated: true,
  entitlementsCache: { tier: TIER_PRO, product: 'ima-sync', modules: ['mod.trust'], valid_until: '2099-01-01T00:00:00.000Z', signature: 'test', issued_at: '2026-01-01', limits: {} },
  entitlementsCacheKey: proKey
}
applyHardRevokeIfNeeded(hardRevokeSettings, { error: 'license_inactive' })
assert('TC-CLD-08', !hardRevokeSettings.proActivated && !hardRevokeSettings.entitlementsCache, 'hard revoke clears cache')

const crypto = require('crypto')
const { verifyEntitlementsEd25519, entitlementsSignBytes } = require(path.join(PLUGIN, 'lib/license-sign.js'))
const { normalizeEntitlementsPayload } = require(path.join(PLUGIN, 'lib/license-cloud.js'))
const { ENTITLEMENTS_PUBLIC_KEY_B64 } = require(path.join(PLUGIN, 'lib/license-sign-pubkey.js'))
const edEnt = {
  schema_version: 1,
  product: 'ima-sync',
  account_id: 'acc:edtest',
  tier: 'ima-pro-team',
  valid_until: '2099-01-01T00:00:00.000Z',
  modules: ['core.free', 'mod.trust', 'mod.govern'],
  limits: {
    seats: 5,
    offline_grace_days: 7,
    trust_verify_enabled: true,
    trust_dedup_enabled: true,
    govern_llm_enabled: false,
    govern_llm_tokens_month: 0,
    structure_folders_max: 0,
    sync_directories_max: 0,
    white_label: false,
    priority_support: true
  },
  issued_at: '2026-01-01T00:00:00.000Z',
  signature: ''
}
const { publicKey: edPub, privateKey: edPriv } = crypto.generateKeyPairSync('ed25519')
const edSig = crypto.sign(null, entitlementsSignBytes(edEnt), edPriv)
edEnt.signature = `ed25519:${edSig.toString('base64')}`
assert('TC-CLD-06', verifyEntitlementsEd25519(edEnt, edPub), 'Ed25519 插件验签 round-trip')

const prodPrivB64 = String(process.env.IMA_SYNC_LICENSE_SIGN_PRIVATE_KEY || '').trim()
if (prodPrivB64 && ENTITLEMENTS_PUBLIC_KEY_B64) {
  const prodPriv = crypto.createPrivateKey({
    key: Buffer.from(prodPrivB64, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  const prodPub = crypto.createPublicKey({
    key: Buffer.from(ENTITLEMENTS_PUBLIC_KEY_B64, 'base64'),
    format: 'der',
    type: 'spki'
  })
  const prodEnt = { ...edEnt, account_id: 'acc:prod-key-test', signature: '' }
  prodEnt.signature = `ed25519:${crypto.sign(null, entitlementsSignBytes(prodEnt), prodPriv).toString('base64')}`
  assert(
    'TC-CLD-07',
    verifyEntitlementsEd25519(prodEnt, prodPub) && normalizeEntitlementsPayload(prodEnt).ok,
    '生产公钥与 env 私钥验签'
  )
} else {
  assert('TC-CLD-07', true, '生产密钥验签 SKIP（无 IMA_SYNC_LICENSE_SIGN_PRIVATE_KEY）')
}

const freeEnt = getEffectiveEntitlements({ mockPro: false, proLicenseKey: '' })
assert('TC-ENT-01', freeEnt.tier === TIER_FREE && hasModule({ mockPro: false }, MODULE_CORE_FREE) && !hasModule({ mockPro: false }, MODULE_TRUST), 'Free 仅 core.free')

const legacyEnt = getEffectiveEntitlements({ proLicenseKey: proKey })
assert('TC-ENT-02', legacyEnt.tier === TIER_PRO && hasModule({ proLicenseKey: proKey }, MODULE_TRUST) && hasModule({ proLicenseKey: proKey }, MODULE_GOVERN), 'Legacy key → Pro modules')

const cloudEnt = {
  schema_version: 1,
  product: 'ima-sync',
  account_id: 'acc:test',
  tier: 'ima-pro-team',
  valid_until: '2099-01-01T00:00:00.000Z',
  modules: ['core.free', 'mod.trust'],
  limits: { seats: 3, offline_grace_days: 7, trust_verify_enabled: false, trust_dedup_enabled: true },
  signature: 'test',
  issued_at: '2026-01-01T00:00:00.000Z'
}
assert('TC-ENT-03', hasModule({ entitlementsCache: cloudEnt }, MODULE_TRUST) && !trustVerifyAllowed({ entitlementsCache: cloudEnt }) && trustDedupAllowed({ entitlementsCache: cloudEnt }), 'Cloud cache limits 细调')

// --- P0 production guard ---
globalThis.__IMA_SYNC_DEV_BYPASS__ = false
const prodLicenseKey = require(path.join(PLUGIN, 'lib/license-key.js'))
const prodEntitlements = require(path.join(PLUGIN, 'lib/entitlements.js'))
const prodLicenseCloud = require(path.join(PLUGIN, 'lib/license-cloud.js'))
assert('TC-SEC-01', !prodLicenseKey.verifyProLicenseKey(proKey), 'production rejects legacy key')
assert('TC-SEC-02', !prodLicenseKey.verifyProLicenseKey('IMA-PRO-TEST'), 'production rejects test key')
assert('TC-SEC-03', prodEntitlements.getEffectiveEntitlements({ mockPro: true }).tier === TIER_FREE, 'production ignores mockPro')
const unsignedEnt = { ...cloudEnt, signature: '' }
assert('TC-SEC-04', !prodLicenseCloud.normalizeEntitlementsPayload(unsignedEnt).ok, 'reject missing signature')
const actProd = await prodLicenseCloud.activateProLicenseCloud({
  proLicenseKey: proKey,
  licenseMock: true,
  licenseCloudEnabled: true,
  telemetry: { installId: 'x' }
}, { pluginVersion: '1.5.40' })
assert('TC-SEC-05', !actProd.ok, 'production no licenseMock / legacy activate')
globalThis.__IMA_SYNC_DEV_BYPASS__ = true

const expiredEnt = {
  ...cloudEnt,
  valid_until: '2020-01-01T00:00:00.000Z',
  limits: { ...cloudEnt.limits, offline_grace_days: 0 }
}
assert('TC-ENT-04', entitlementStatus(expiredEnt, Date.now()) === 'expired' && !hasModule({ entitlementsCache: expiredEnt }, MODULE_TRUST), '过期剥 Pro')

const graceEnt = {
  ...cloudEnt,
  valid_until: new Date(Date.now() - 86400000).toISOString(),
  limits: { ...cloudEnt.limits, offline_grace_days: 7 }
}
assert('TC-ENT-05', entitlementStatus(graceEnt, Date.now()) === 'grace' && hasModule({ entitlementsCache: graceEnt }, MODULE_TRUST), '宽限内仍有效')

const { buildEntitlementBarModel } = require(path.join(PLUGIN, 'lib/entitlements.js'))
const entBar = buildEntitlementBarModel({ proLicenseKey: proKey }, (k) => k)
assert('TC-ENT-05b', entBar.tier === TIER_PRO && entBar.modules.some(m => m.id === MODULE_TRUST), '权益栏模型')

assert('TC-ENT-07', syncDirectoriesMax({ mockPro: false }) === 1 && syncDirectoriesMax({ mockPro: true }) === 0, 'Free max 1 sync dir · Pro unlimited')
assert('TC-ENT-08', canAddSyncDirectory({ mockPro: false }, 0) && !canAddSyncDirectory({ mockPro: false }, 1), 'Free 不可加第 2 目录')
assert('TC-ENT-09', effectiveSyncFolders({ mockPro: false }, ['A', 'B']).join(',') === 'A', 'Free 裁剪至 1 目录')
assert('TC-ENT-10', effectiveSyncFolders({ mockPro: true }, ['A', 'B']).length === 2, 'Pro 不裁剪')

const entVerifyOffSettings = {
  ...settings,
  mockPro: false,
  kbId: 'kb-test',
  entitlementsCache: {
    ...cloudEnt,
    modules: ['core.free', 'mod.trust', 'mod.govern'],
    limits: { seats: 1, offline_grace_days: 7, trust_verify_enabled: false, trust_dedup_enabled: true }
  },
  trust: { verifyAfterPush: true, dedupBeforePush: true, dedupAmbiguous: 'warn-push', verifyGapMs: 0, verifyDelayMs: 0, verifyRetries: 1, verifyRetryDelayMs: 0 },
  trustMock: {
    searchHits: [{ title: '临忆录', doc_id: 'mock-hit' }],
    repeated: {}
  },
  trustCapabilities: { checkedAt: new Date().toISOString(), canDedup: true, canVerify: true, readyLevel: 'full' }
}
const entApp = createMockApp({ [notePath]: initial })
const entEngine = new ImaSyncEngine(entApp, entVerifyOffSettings, () => {}, null, () => {}, () => {})
const entPush = await entEngine.pushNote(entApp.vault.getMarkdownFiles()[0], true)
assert('TC-ENT-06', entPush.pushed && entPush.verify === 'skipped', `权益关验证 ${entPush.verify}`)

const trustSettings = {
  ...settings,
  mockPro: true,
  kbId: 'kb-test',
  trust: { verifyAfterPush: true, dedupBeforePush: true, dedupAmbiguous: 'warn-push', verifyGapMs: 0, verifyDelayMs: 0, verifyRetries: 1, verifyRetryDelayMs: 0 },
  trustMock: {
    searchHits: [{ title: '临忆录', doc_id: 'mock-hit' }],
    repeated: {}
  }
}

const trustApp = createMockApp({ [notePath]: initial })
const trustEngine = new ImaSyncEngine(trustApp, trustSettings, () => {}, null, () => {}, () => {})
const trustPush = await trustEngine.pushNote(trustApp.vault.getMarkdownFiles()[0], true)
assert('TC-TRUST-01', trustPush.pushed && trustPush.verify === 'verified', `推送验证 ${trustPush.verify}`)

const afterVerify = parseNoteFile(trustApp._store.get(notePath))
assert('TC-TRUST-02', afterVerify.frontmatter.sync?.ima_verify === 'verified', 'frontmatter ima_verify')

trustSettings.trustMock = {
  searchHits: [],
  repeated: {}
}
const missClient = new ImaApiClient({ mockMode: true, apiKey: 'k', apiUrl: 'https://ima.qq.com', kbId: 'kb', trustMock: trustSettings.trustMock })
const missVerify = await verifyPushedNote(missClient, trustSettings, { title: '不存在', docId: 'x', basename: '不存在' })
assert('TC-TRUST-02b', missVerify.status === 'failed', '验证失败 NOT_FOUND')

const dedupHash = computeContentHash('临忆录示例正文')
const dedupRaw = `---
title: 临忆录
ima_doc_id: doc-existing
ima_content_hash: ${dedupHash}
sync:
  ima: pending
---
临忆录示例正文`
const dedupApp = createMockApp({ '编史/dedup.md': dedupRaw })
const dedupSettings = {
  ...trustSettings,
  trustMock: { repeated: { '临忆录.md': true }, searchHits: [{ title: '临忆录', doc_id: 'doc-existing' }] }
}
const dedupEngine = new ImaSyncEngine(dedupApp, dedupSettings, () => {})
const dedupFile = dedupApp.vault.getMarkdownFiles().find(f => f.path === '编史/dedup.md')
const dedupResult = await dedupEngine.pushNote(dedupFile)
assert('TC-TRUST-03', dedupResult.skipped && dedupResult.deduped, '去重跳过')

const ambRaw = `---
title: 临忆录
ima_content_hash: ${dedupHash}
sync:
  ima: pending
---
临忆录示例正文`
const ambApp = createMockApp({ '编史/amb.md': ambRaw })
const ambFile = ambApp.vault.getMarkdownFiles().find(f => f.path === '编史/amb.md')
const ambEngine = new ImaSyncEngine(ambApp, dedupSettings, () => {})
const ambResult = await ambEngine.pushNote(ambFile)
assert('TC-TRUST-04', ambResult.pushed, '重名无 doc_id 仍推送')

let fq = []
fq = upsertFailedEntry(fq, '编史/a.md', 'net err')
assert('TC-TRUST-05', fq.length === 1, '失败队列入队')
fq = removeFailedEntry(fq, '编史/a.md')
assert('TC-TRUST-05b', fq.length === 0, '失败队列出队')

const report = new TrustReportCollector({ kbId: 'kb', direction: 'push' })
report.addItem({ path: 'a.md', action: 'pushed', doc_id: 'd1', verify: 'verified' })
const md = formatTrustReportMarkdown(report.finish(), (k) => k)
assert('TC-TRUST-06', md.includes('a.md') && !/apiKey/i.test(md), '报告 MD')

assert('TC-TRUST-08', !isProActive({ ...settings, mockPro: false, proLicenseKey: '' }), '未激活 Pro')

assert('TC-TRUST-09', matchKnowledgeHit([{ title: '竞品分析', doc_id: '1' }], { title: '竞品分析' }), '命中判定')

assert('TC-TRUST-10', t({ language: 'en' }, 'trustHeroTitle') === 'Searchable on IMA?', 'Trust hero i18n en')

const hero = trustHeroMetrics({ counts: { verified: 9, pushed: 10, verify_failed: 1 } })
assert('TC-TRUST-11', hero.pct === 90, 'hero pct')
const notice = formatTrustBatchNotice(trustSettings, { pushed: 10, verified: 9, verify_failed: 1, trustReport: { counts: { verified: 9, pushed: 10 } } }, (k) => t(trustSettings, k))
assert('TC-TRUST-12', notice.includes('9') && notice.includes('10'), 'batch notice')

const { isImaAuthError } = require(path.join(PLUGIN, 'lib/ima-errors.js'))
const { captureTrustAuthError, formatTrustAuthHint, formatVerifyDetail, verifyDetailKind } = require(path.join(PLUGIN, 'lib/trust-auth.js'))
assert('TC-TRUST-13', isImaAuthError('skill auth failed') && captureTrustAuthError(new Error('skill auth failed')) === 'skill auth failed', 'auth error detect')
assert('TC-TRUST-13b', formatTrustAuthHint((k) => k, 'skill auth failed').includes('trustAuth'), 'auth hint i18n key')
assert('TC-TRUST-14', verifyDetailKind('AUTH_FAILED: skill auth failed') === 'auth', 'verify detail auth')
assert('TC-TRUST-14b', formatVerifyDetail((k, v) => `${k}:${v?.detail || ''}`, 'NOT_FOUND').includes('trustVerifyDetail'), 'verify detail fmt')

const { summarizeCapabilities, shouldRunDedup, shouldRunVerify, formatReadyLevelHint } = require(path.join(PLUGIN, 'lib/trust-capabilities.js'))
const capsFull = summarizeCapabilities({ base: true, dedup: true, verify: true, errors: {} })
assert('TC-TRUST-15', capsFull.readyLevel === 'full' && shouldRunDedup(capsFull) && shouldRunVerify(capsFull), 'cap full')
const capsBlocked = summarizeCapabilities({ base: false, dedup: false, verify: false, errors: { base: 'skill auth failed' } })
assert('TC-TRUST-15b', capsBlocked.readyLevel === 'blocked' && !shouldRunVerify(capsBlocked), 'cap blocked')
assert('TC-TRUST-15c', formatReadyLevelHint(capsBlocked, (k) => k).includes('trustCap'), 'cap hint')

// --- Govern (Pro Alpha · local rules) ---
const { evaluateNoteRules, auditNotes } = require(path.join(PLUGIN, 'lib/govern-rules.js'))
const { formatGovernReportMarkdown } = require(path.join(PLUGIN, 'lib/govern-report.js'))
const { canUseGovern } = require(path.join(PLUGIN, 'lib/license.js'))

assert('TC-GOV-01', canUseGovern({ mockPro: true }), 'Govern Pro gate')
assert('TC-GOV-02', !canUseGovern({ mockPro: false, proLicenseKey: '' }), 'Govern blocked without Pro')

const govMissingTitle = evaluateNoteRules({
  path: 'a.md',
  basename: 'a',
  title: '',
  body: 'ok',
  frontmatter: {},
  settings: { govern: { maxBodyChars: 12000, minTitleChars: 4 } }
})
assert('TC-GOV-03', govMissingTitle.codes.includes('MISSING_TITLE') && govMissingTitle.risk === 'high', 'MISSING_TITLE')

const govLongBody = evaluateNoteRules({
  path: 'b.md',
  basename: 'b',
  title: '正常标题',
  body: 'x'.repeat(13000),
  frontmatter: { import_key: 'k1' },
  settings: { govern: { maxBodyChars: 12000, minTitleChars: 4 } }
})
assert('TC-GOV-04', govLongBody.codes.includes('BODY_TOO_LONG') && govLongBody.risk === 'medium', 'BODY_TOO_LONG')

const govAudit = auditNotes([
  { path: 'ok.md', basename: 'ok', title: '正常标题', body: 'short', frontmatter: { import_key: 'k' } },
  { path: 'bad.md', basename: 'bad', title: '', body: 'short', frontmatter: {} }
], { govern: { maxBodyChars: 12000, minTitleChars: 4 } })
assert('TC-GOV-05', govAudit.total === 2 && govAudit.highRisk === 1 && govAudit.counts.ok === 1, 'auditNotes counts')

const govMd = formatGovernReportMarkdown(govAudit, (k) => k)
assert('TC-GOV-06', govMd.includes('governReportTitle') && govMd.includes('bad.md') && !/apiKey/i.test(govMd), 'govern report MD')

const govSensitive = evaluateNoteRules({
  path: 'c.md',
  basename: 'c',
  title: '机密文档',
  body: '内容',
  frontmatter: { import_key: 'k' },
  settings: { govern: { sensitivePatterns: ['机密'] } }
})
assert('TC-GOV-07', govSensitive.codes.includes('SENSITIVE_PATTERN'), 'SENSITIVE_PATTERN')

assert('TC-GOV-08', t({ language: 'zh' }, 'governHeroTitle') === '推送前治理', 'Govern i18n zh')

// --- Format (Pro Alpha · local rules) ---
const {
  formatForIma,
  pickContentHashBody,
  ruleWikilink,
  ruleHighlight,
  ruleCjkSpacing,
  resolveActiveRuleIds
} = require(path.join(PLUGIN, 'lib/format-pipeline.js'))
const { buildFormatReport, formatFormatReportMarkdown } = require(path.join(PLUGIN, 'lib/format-report.js'))
const { canUseFormatFull } = require(path.join(PLUGIN, 'lib/license.js'))

assert('TC-FMT-01', ruleWikilink('见 [[页面|别名]]') === '见 别名', 'wikilink alias')
assert('TC-FMT-02', ruleHighlight('这是==重点==') === '这是**重点**', 'highlight')
assert('TC-FMT-03', ruleWikilink('[[仅页面]]') === '仅页面', 'wikilink plain')

const fmtCore = formatForIma({
  path: 'a.md',
  title: '测试标题',
  body: '[[链接]]\n\n==高亮==',
  frontmatter: {}
}, { format: { enabled: true, preset: 'core' } })
assert('TC-FMT-04', fmtCore.rulesApplied.includes('WIKILINK') && fmtCore.rulesApplied.includes('HIGHLIGHT'), 'core rules applied')
assert('TC-FMT-05', !fmtCore.body.includes('[[') && fmtCore.body.includes('**高亮**'), 'core output')

const fmtSkip = formatForIma({
  path: 'b.md',
  title: 'x',
  body: '[[x]]',
  frontmatter: { format: 'skip' }
}, { format: { enabled: true, preset: 'core' } })
assert('TC-FMT-06', fmtSkip.skipped === true && fmtSkip.body === '[[x]]', 'format skip fm')

assert('TC-FMT-07', pickContentHashBody('local', 'formatted', { format: { hashSource: 'local' } }) === 'local', 'hash local')
assert('TC-FMT-08', pickContentHashBody('local', 'formatted', { format: { hashSource: 'formatted' } }) === 'formatted', 'hash formatted')

const fmtTwice = formatForIma({ path: 'c.md', title: 'T', body: '[[a]]', frontmatter: {} }, { format: { preset: 'core' } })
const fmtTwice2 = formatForIma({ path: 'c.md', title: 'T', body: fmtTwice.body, frontmatter: {} }, { format: { preset: 'core' } })
assert('TC-FMT-09', fmtTwice2.body === fmtTwice.body, 'idempotent')

const fmtReport = buildFormatReport([
  { path: 'a.md', status: 'formatted', rulesApplied: ['WIKILINK'], deltaChars: 2 }
])
const fmtMd = formatFormatReportMarkdown(fmtReport, (k) => k)
assert('TC-FMT-10', fmtMd.includes('formatReportTitle') && fmtMd.includes('WIKILINK') && !/apiKey/i.test(fmtMd), 'format report MD')

assert('TC-FMT-11', !canUseFormatFull({ mockPro: false, proLicenseKey: '' }), 'format full blocked free')
assert('TC-FMT-12', canUseFormatFull({ mockPro: true }), 'format full pro')

const proRules = resolveActiveRuleIds({ mockPro: true, format: { preset: 'standard' } }, {})
assert('TC-FMT-13', proRules.includes('CALLOUT') && proRules.includes('CJK_SPACING') === false, 'pro standard rules')

const govObsidian = evaluateNoteRules({
  path: 'd.md',
  basename: 'd',
  title: '标题够长',
  body: '[[x]] and ==y==',
  frontmatter: { import_key: 'k' },
  settings: { govern: { maxBodyChars: 12000, minTitleChars: 4 } }
})
assert('TC-FMT-14', govObsidian.codes.includes('OBSIDIAN_SYNTAX'), 'govern OBSIDIAN_SYNTAX')

assert('TC-FMT-15', ruleCjkSpacing('与API对接') === '与 API 对接', 'cjk spacing')

const { rebuildNoteRaw } = require(path.join(PLUGIN, 'lib/format-pipeline.js'))
const rebuilt = rebuildNoteRaw('---\ntitle: x\n---\n\n[[old]]', '**new** body')
assert('TC-FMT-16', rebuilt.includes('title: x') && rebuilt.includes('**new** body') && !rebuilt.includes('[[old]]'), 'rebuildNoteRaw')

// --- telemetry install ---
const { buildInstallEvent, HOOKS } = require(path.join(PLUGIN, 'lib/telemetry.js'))
const { maybeReportInstall } = require(path.join(PLUGIN, 'lib/telemetry-report.js'))
const { buildLocalSummary, formatDiagnosticsText } = require(path.join(PLUGIN, 'lib/telemetry-local.js'))
const installEv = buildInstallEvent({
  installId: 'test-install-id',
  pluginVersion: PLUGIN_VERSION,
  lang: 'zh',
  configured: false,
  obsidianVersion: '1.6.7'
})
assert('TC-TELEM-01', installEv.feature_hook === HOOKS.INSTALL, 'install hook')
assert('TC-TELEM-02', installEv.client_channel === 'ima-sync', 'install channel')
assert('TC-TELEM-02b', installEv.tenant_id === 'linyilu-default', 'install tenant_id')
assert('TC-TELEM-03', installEv.payload.plugin_version === PLUGIN_VERSION && installEv.payload.obsidian_version === '1.6.7', 'install payload')

const diagSummary = buildLocalSummary({}, PLUGIN_VERSION, 'zh', false, '1.6.7')
const diagText = formatDiagnosticsText(diagSummary, (k) => k)
assert('TC-TELEM-07', diagText.includes('Obsidian: 1.6.7'), 'diagnostics obsidian version')

const freshSettings = Object.assign({ telemetry: {} }, { telemetryEnabled: undefined })
if (freshSettings.telemetryEnabled !== true) freshSettings.telemetryEnabled = false
assert('TC-TELEM-11', freshSettings.telemetryEnabled === false, 'telemetry default off when unset')
assert('TC-TELEM-11b', ({ telemetryEnabled: true }).telemetryEnabled === true, 'explicit on respected')

const telemSettings = { telemetryEnabled: false, telemetry: {} }
const telemPlugin = {
  settings: telemSettings,
  manifest: { version: PLUGIN_VERSION },
  app: { version: '1.6.7' },
  isConfigured: () => false,
  saveData: async () => {}
}
await maybeReportInstall(telemPlugin)
assert('TC-TELEM-04', telemSettings.telemetry.installSent === true, 'installSent after successful flush')
assert('TC-TELEM-05', telemSettings.telemetry.pending.length === 0, 'install flushed even when telemetry off')
await maybeReportInstall(telemPlugin)
assert('TC-TELEM-06', telemSettings.telemetry.pending.length === 0, 'install not duplicated')

const failSettings = { telemetryEnabled: false, telemetry: {} }
obsidianStub.telemetryFail = true
const failPlugin = {
  settings: failSettings,
  manifest: { version: PLUGIN_VERSION },
  app: { version: '1.6.7' },
  isConfigured: () => false,
  saveData: async () => {}
}
await maybeReportInstall(failPlugin)
assert('TC-TELEM-08', failSettings.telemetry.installSent !== true, 'installSent false when flush fails')
assert('TC-TELEM-09', failSettings.telemetry.pending.some((e) => e.feature_hook === HOOKS.INSTALL), 'install stays pending on failure')
obsidianStub.telemetryFail = false
await maybeReportInstall(failPlugin)
assert('TC-TELEM-10', failSettings.telemetry.installSent === true, 'installSent after retry succeeds')
obsidianStub.telemetryFail = false

// --- API Key expiry reminders ---
assert('TC-KEY-EXP-01', parseApiKeyExpiresAt('2026-07-20') != null, 'parse YYYY-MM-DD')
const soonAt = new Date('2026-07-12T10:00:00').getTime()
const soonSettings = { apiKeyExpiresAt: '2026-07-15', apiKeyExpiryRemindDays: 7 }
const soonState = getApiKeyExpiryState(soonSettings, soonAt)
assert('TC-KEY-EXP-02', soonState.level === 'soon' && soonState.daysLeft === 4, `soon level days=${soonState.daysLeft}`)
const expiredState = getApiKeyExpiryState({ apiKeyExpiresAt: '2026-07-01' }, new Date('2026-07-12').getTime())
assert('TC-KEY-EXP-03', expiredState.level === 'expired', 'expired level')
assert('TC-KEY-EXP-04', getApiKeyExpiryState({}).level === 'none', 'none when unset')
const okState = getApiKeyExpiryState({ apiKeyExpiresAt: '2026-12-31' }, soonAt)
assert('TC-KEY-EXP-05', okState.level === 'ok', 'ok when far future')
assert('TC-KEY-EXP-06', shouldShowApiKeyExpiryReminder(soonSettings, soonState, soonAt), 'should show soon')
const snoozeSettings = { ...soonSettings }
snoozeApiKeyExpiryReminder(snoozeSettings, 1, soonAt)
assert('TC-KEY-EXP-07', !shouldShowApiKeyExpiryReminder(snoozeSettings, soonState, soonAt), 'snooze suppresses')
const dismissSettings = { ...soonSettings }
markApiKeyExpiryReminderShown(dismissSettings, soonState, soonAt)
assert('TC-KEY-EXP-08', !shouldShowApiKeyExpiryReminder(dismissSettings, soonState, soonAt + 3600000), 'dismiss today')
assert('TC-KEY-EXP-09', isLikelyAuthFailure('IMA auth failed: 401'), 'auth failure detect')
assert('TC-KEY-EXP-10', t(zh, 'apiKeyExpiryModalTitleSoon').includes('到期'), 'zh modal title')
assert('TC-KEY-EXP-11', normalizeApiKeyExpiresAtInput('2026/07/20') === '2026-07-20', 'normalize slash date')
assert('TC-KEY-EXP-12', isInvalidApiKeyExpiresAtInput('not-a-date'), 'invalid detect')
assert('TC-KEY-EXP-13', !isInvalidApiKeyExpiresAtInput(''), 'empty not invalid')
const clearSettings = { apiKeyExpiresAt: '2026-07-15', apiKeyExpirySnoozeUntil: '2099-01-01', apiKeyExpiryLastReminderDay: '2026-07-12', apiKeyExpiryLastReminderLevel: 'soon' }
clearApiKeyExpiryReminders(clearSettings)
assert('TC-KEY-EXP-14', !clearSettings.apiKeyExpirySnoozeUntil && !clearSettings.apiKeyExpiryLastReminderDay, 'clear reminders')
assert('TC-KEY-EXP-15', apiKeyExpiryStatusKey({ level: 'ok' }) === 'apiKeyExpiryStatusOk', 'status key ok')
assert('TC-KEY-EXP-16', apiKeyExpiryStatusKey({ level: 'none' }) === 'apiKeyExpiryStatusUnset', 'status key unset')
assert('TC-KEY-EXP-17', t(zh, 'apiKeyExpiryDisconnectNoDate').includes('到期日'), 'disconnect no date zh')
assert('TC-KEY-EXP-18', /^\d{4}-\d{2}-\d{2}$/.test(addDaysToToday(30, soonAt)), 'addDaysToToday format')
const bannerSoon = shouldShowApiKeyExpiryBanner(soonSettings, soonState, soonAt)
assert('TC-KEY-EXP-19', bannerSoon, 'banner show soon')
const bannerSnooze = { ...soonSettings }
snoozeApiKeyExpiryReminder(bannerSnooze, 1, soonAt)
assert('TC-KEY-EXP-20', !shouldShowApiKeyExpiryBanner(bannerSnooze, soonState, soonAt), 'banner hide when snoozed')
assert('TC-KEY-EXP-21', shouldShowApiKeyExpiryBanner(bannerSnooze, expiredState, soonAt), 'banner always expired')
assert('TC-KEY-EXP-22', t(zh, 'apiKeyExpiryBannerLineSoon').includes('点击'), 'banner line zh')

// --- remote notices ---
const {
  noticesUrl,
  activeNotices,
  dismissRemoteNotice
} = require(path.join(PLUGIN, 'lib/remote-notices.js'))

const noticeSettings = {
  telemetryUrl: 'https://www.linyilu.com/analytics/events',
  remoteNotices: {
    notices: [{
      id: 'test-maint',
      title: '维护',
      body: '今晚维护',
      level: 'warn',
      active: true,
      dismissible: true,
      published_at: '2020-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
      min_version: '1.5.0'
    }],
    dismissed: {},
    fetchedAt: 0
  }
}
assert('TC-NOTICE-01', noticesUrl(noticeSettings).endsWith('/analytics/ima-sync/notices'), 'notices URL')
assert('TC-NOTICE-02', activeNotices(noticeSettings, '1.5.40').length === 1, 'active notice visible')
assert('TC-NOTICE-03', activeNotices(noticeSettings, '1.4.0').length === 0, 'min_version blocks old plugin')

const futureSettings = JSON.parse(JSON.stringify(noticeSettings))
futureSettings.remoteNotices.notices[0].published_at = '2099-01-01T00:00:00.000Z'
assert('TC-NOTICE-04', activeNotices(futureSettings, '1.5.40').length === 0, 'future publish hidden')

dismissRemoteNotice(noticeSettings, 'test-maint')
assert('TC-NOTICE-05', noticeSettings.remoteNotices.dismissed['test-maint'], 'dismiss recorded')
assert('TC-NOTICE-06', activeNotices(noticeSettings, '1.5.40').length === 0, 'dismissed notice hidden')

const upgradeSettings = JSON.parse(JSON.stringify(noticeSettings))
upgradeSettings.remoteNotices.dismissed = {}
upgradeSettings.remoteNotices.notices[0].max_version = '1.5.39'
assert('TC-NOTICE-09', activeNotices(upgradeSettings, '1.5.40').length === 0, 'max_version hides on newer plugin')
assert('TC-NOTICE-10', activeNotices(upgradeSettings, '1.5.38').length === 1, 'max_version shows on older plugin')

const multiSettings = JSON.parse(JSON.stringify(noticeSettings))
multiSettings.remoteNotices.dismissed = {}
multiSettings.remoteNotices.notices = [
  {
    id: 'notice-a',
    title: '公告 A',
    body: '内容 A',
    level: 'info',
    active: true,
    dismissible: true,
    published_at: '2020-01-01T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    min_version: '1.5.0'
  },
  {
    id: 'notice-b',
    title: '公告 B',
    body: '内容 B',
    level: 'warn',
    active: true,
    dismissible: true,
    published_at: '2020-01-01T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    min_version: '1.5.0'
  }
]
assert('TC-NOTICE-11', activeNotices(multiSettings, '1.5.40').length === 2, 'multiple active notices')

const remoteNoticesPath = path.join(PLUGIN, 'lib/remote-notices.js')
const origRequestUrl = obsidianStub.requestUrl
obsidianStub.requestUrl = async ({ url }) => {
  if (String(url || '').includes('/ima-sync/notices')) {
    return {
      status: 200,
      json: {
        ok: true,
        updated_at: '2026-07-09T00:00:00.000Z',
        notices: [{
          id: 'remote-1',
          title: '远程公告',
          body: '内容',
          level: 'info',
          dismissible: true
        }]
      }
    }
  }
  return origRequestUrl({ url })
}
delete require.cache[remoteNoticesPath]
const { fetchRemoteNotices: fetchRemoteNoticesLive } = require(remoteNoticesPath)
const fetchSettings = { telemetryUrl: 'https://www.linyilu.com/analytics/events' }
const fetchResult = await fetchRemoteNoticesLive(fetchSettings, '1.5.40', { force: true })
assert('TC-NOTICE-07', fetchResult.ok && fetchResult.notices.length === 1, 'fetch remote notices')
assert('TC-NOTICE-08', fetchSettings.remoteNotices.notices[0].id === 'remote-1', 'fetch caches notices')
obsidianStub.requestUrl = origRequestUrl
delete require.cache[remoteNoticesPath]
require(remoteNoticesPath)

// --- bundle & install ---
const distMain = path.join(DIST, 'main.js')

if (skipBuild) {
  assert('TC-BUILD-01', fs.existsSync(distMain), 'skip bundle · 复用 dist/main.js（先 npm run bundle）')
} else {
  const bundle = spawnSync('node', [path.join(PLUGIN, 'scripts/bundle.mjs')], {
    env: { ...process.env, IMA_SYNC_ROOT: PLUGIN },
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8'
  })
  assert('TC-BUILD-01', bundle.status === 0, 'esbuild 打包')
}

assert('TC-BUILD-02', fs.existsSync(distMain) && fs.statSync(distMain).size > 10000, `dist/main.js ${fs.existsSync(distMain) ? fs.statSync(distMain).size : 0}b`)

const syntax = spawnSync('node', ['--check', distMain], { encoding: 'utf8' })
assert('TC-BUILD-03', syntax.status === 0, 'bundle 语法检查')

const bundled = fs.readFileSync(distMain, 'utf8')
assert('TC-BUILD-04', !bundled.includes("require('./lib/"), 'bundle 无 lib 依赖')
assert('TC-BUILD-05', bundled.includes('shujuliu@foxmail.com'), 'bundle 含邮箱')

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'))
assert('TC-BUILD-06', manifest.author === 'shujuliu' && manifest.version, `manifest v${manifest.version}`)
assert('TC-BUILD-07', fs.existsSync(path.join(DIST, 'product-manifest.json')), 'dist 含 product-manifest.json')
assert('TC-BUILD-08', fs.existsSync(path.join(DIST, 'versions.json')), 'dist 含 versions.json')

// --- summary ---
const failed = results.filter(r => !r.pass)
console.log('\n---')
console.log(`合计 ${results.length} 项 · PASS ${results.length - failed.length} · FAIL ${failed.length}`)
if (failed.length) {
  console.log('\n失败项:')
  for (const f of failed) console.log(`  ${f.id}: ${f.note}`)
  process.exit(1)
}
const elapsed = ((Date.now() - tStart) / 1000).toFixed(1)
console.log(`\n全部 PASS · ${elapsed}s${quick ? ' · quick' : ''}\n`)
