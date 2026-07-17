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
  parseTime,
  resolveWorkingMarkdownFile
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

{
  const noteA = { path: 'a.md', extension: 'md', basename: 'a' }
  const noteB = { path: 'b.md', extension: 'md', basename: 'b' }
  const appSidebar = {
    workspace: {
      getActiveFile: () => null,
      iterateAllLeaves: (fn) => {
        fn({ activeTime: 10, view: { getViewType: () => 'markdown', file: noteA } })
        fn({ activeTime: 20, view: { getViewType: () => 'markdown', file: noteB } })
        fn({ activeTime: 99, view: { getViewType: () => 'ima-sync' } })
      },
      getLeavesOfType: () => []
    },
    vault: { getAbstractFileByPath: () => null }
  }
  assert('TC-UTIL-07', resolveWorkingMarkdownFile(appSidebar)?.path === 'b.md', '侧栏无焦点时回退最近 markdown 叶')
  const appActive = {
    workspace: {
      getActiveFile: () => noteA,
      iterateAllLeaves: () => {},
      getLeavesOfType: () => []
    },
    vault: { getAbstractFileByPath: () => null }
  }
  assert('TC-UTIL-08', resolveWorkingMarkdownFile(appActive)?.path === 'a.md', '有焦点 md 时优先 getActiveFile')
  const appLast = {
    workspace: {
      getActiveFile: () => null,
      iterateAllLeaves: (fn) => { fn({ view: { getViewType: () => 'ima-sync' } }) },
      getLeavesOfType: () => []
    },
    vault: { getAbstractFileByPath: (p) => (p === 'last.md' ? { path: 'last.md', extension: 'md' } : null) }
  }
  assert('TC-UTIL-09', resolveWorkingMarkdownFile(appLast, 'last.md')?.path === 'last.md', '无编辑叶时回退 lastPath')
  const mainSrc = fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')
  assert(
    'TC-UTIL-10',
    /resolveWorkingMarkdownFile/.test(mainSrc) &&
      /active-leaf-change/.test(mainSrc) &&
      /scheduleWorkspaceContextRefresh/.test(mainSrc) &&
      !/workspace\.getActiveFile\s*\(/.test(mainSrc),
    'main 用工作笔记解析，监听 leaf-change，不再裸用 workspace.getActiveFile'
  )
}

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
assert('TC-I18N-03', label(auto, 'lang').includes('Language') && label(auto, 'lang').includes('·') && label(auto, 'lang').includes('界面语言'), 'auto 双语标签（中英不同文案）')
assert('TC-I18N-03b', label({ language: 'zh' }, 'apiKey') === 'API Key' && label({ language: 'en' }, 'apiKey') === 'API Key', 'zh/en API Key 保持英文专名')
assert('TC-I18N-03c', t(zh, 'proAdToastActivateBtn').includes('设置') && t(zh, 'changelogMore') === '更多更新历史' && t(zh, 'statusNotConfigured').includes('API Key'), '中文界面补齐 toast/changelog/未配置文案')
const { localizeStatus, formatCodeList } = require(path.join(PLUGIN, 'lib/i18n.js'))
assert('TC-I18N-ZH-UI-01', localizeStatus(zh, 'enriched') === '成功', 'enrich status zh')
assert('TC-I18N-ZH-UI-02', formatCodeList(zh, ['URL_ONLY_BODY', 'MISSING_TITLE']) === '仅有链接、缺标题', 'govern codes zh')
assert('TC-I18N-ZH-UI-03', t(zh, 'settingsFoldEnrich') === '链接解析' && !t(zh, 'formatOneClickDesc').includes('Callout'), '无多余英文模块名')
assert('TC-I18N-04', resolveLang(zh) === 'zh' && resolveLang(en) === 'en', '语言解析')
assert('TC-I18N-05', STR.zh.aboutDesc.includes('临忆录'), '简介文案')
assert('TC-I18N-05b', STR.zh.aboutDesc.includes('4927306') && STR.zh.aboutAuthor.includes('4927306'), '简介与作者行含 QQ 群')
assert('TC-I18N-05c', STR.zh.authorFollowHint.includes('QQ 群：4927306'), '侧栏关注提示含 QQ 群')
assert('TC-I18N-07', t(zh, 'tip_apiKey_body').includes('ima.qq.com'), 'API Key 帮助')
assert('TC-I18N-08', t(zh, 'tip_noteBadge_body').includes('已同步') && t(zh, 'statSynced') === '已同步' && t(zh, 'noteSyncNone') === '未同步', '笔记状态帮助去技术化')
assert('TC-I18N-09', t(zh, 'rateLimitBackoffSec').includes('限频'), '限频标签')
assert('TC-I18N-10', t(zh, 'trustCapBase') === '基础推送', '能力标签')
assert('TC-I18N-11', t(zh, 'tip_trustHero_title').length > 0 && t(en, 'tip_governHero_body').toLowerCase().includes('local'), '新增帮助键')
assert('TC-I18N-12', t(zh, 'syncCurrent') === '同步当前文档' && t(zh, 'syncPush') === '增量同步目录' && t(zh, 'kbSelectCta') === '选择知识库' && t(zh, 'zonePrimary') === '日常 · 这一篇' && t(zh, 'zoneBatch') === '批量 · 多篇', '同步按钮分区文案')
assert(
  'TC-I18N-19',
  t(zh, 'settingsSectionAbout') === '关于' && t(zh, 'settingsNavPro') === 'Pro' && t(en, 'settingsSectionAbout') === 'About',
  '设置页导航分区文案'
)
assert(
  'TC-SET-NAV-01',
  /renderSettingsNav/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /ima-settings-group--a/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')) &&
    /settingsGroup\(containerEl,\s*'a',\s*'sectionConnection'\)/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')),
  '设置页顶部导航 + 浅色双色分区'
)
assert('TC-I18N-13', t(zh, 'syncPauseAuto') === '暂停自动推送' && t(zh, 'syncResumeAuto') === '恢复自动推送', '后台推送按钮文案')
assert('TC-I18N-14', t(zh, 'statusPulsePending', { n: 3 }) === '待推 3' && t(zh, 'statsFoldNotesTag') === '笔记' && t(zh, 'statsExpand') === '同步统计与高级' && t(zh, 'statsExpandHint').includes('展开'), '脉冲与折叠统计文案')
assert('TC-I18N-14b', t(zh, 'proStatusTag') === '已激活' && t(zh, 'proStatusTagOff') === '未激活' && t(zh, 'statusLicenseUntil', { date: '2026-08-01' }) === '到期 2026-08-01', '连接行激活态文案')
assert('TC-I18N-14c', t(zh, 'copyrightShort') === '© shujuliu · 临忆录' && t(zh, 'panelFootQq', { group: '4927306' }) === 'QQ 4927306', '当前文档卡右侧精简版权与 QQ')
assert('TC-I18N-14d', t(zh, 'statsExpandShort') === '同步统计' && t(zh, 'autoSyncPanelLabelShort') === '间隔(分)' && t(zh, 'syncPushShort') === '增量目录' && t(zh, 'syncFolderShort') === '指定文件夹…' && t(zh, 'syncCurrentShort') === '同步当前' && t(zh, 'formatOneClickShort') === '一键排版' && t(zh, 'enrichOneClickShort') === '链接解析' && t(zh, 'syncCurrentFolderShort') === '推送本夹', '极窄侧栏短文案')
assert('TC-UI-NARROW-01', /container-type:\s*inline-size/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')) && /ima-btn-text-short/.test(fs.readFileSync(path.join(PLUGIN, 'lib/ui-hints.js'), 'utf8')) && /btnTextShort\s*\|\|\s*btnText/.test(fs.readFileSync(path.join(PLUGIN, 'lib/ui-hints.js'), 'utf8')) && /:not\(:has\(\.ima-btn-text-short\)\)/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')), '极窄容器查询与按钮双文案兜底')
assert('TC-UI-NARROW-02', /\.ima-row\.ima-note-actions|\.ima-note-actions\s*\{[^}]*display:\s*flex/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')) && /极窄：版权/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')), '当前文档版权行 flex 且极窄左对齐防裁切')
assert(
  'TC-UI-HEAD-01',
  /function attachHoverTip/.test(fs.readFileSync(path.join(PLUGIN, 'lib/ui-hints.js'), 'utf8')) &&
    /attachHoverTip\(refreshBtn/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /attachHoverTip\(shareBtn/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /attachHoverTip\(autoInput/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    !/attachTip\(refreshWrap/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /ima-status-license-tag--on/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')),
  '顶栏悬停提示 · 无小问号 · 已激活美化'
)
assert('TC-I18N-15', t(zh, 'actions') === '推送到 IMA' && t(zh, 'syncingHint').includes('暂停'), '操作区状态机文案')
assert('TC-I18N-16', t(zh, 'freeIncluded') === '免费' && t(zh, 'syncCurrentFreeHint').includes('免费'), '免费版同步当前文档文案')
assert('TC-I18N-17', t(zh, 'entModCoreFree').includes('同步当前文档') && t(zh, 'tip_syncCurrent_body').includes('免费版'), '免费版权益与 tip 含同步当前文档')
assert('TC-I18N-18', t(zh, 'proAdLead').includes('同步当前文档'), 'Pro 广告强调免费含同步当前文档')

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
const imaApiSrc = fs.readFileSync(path.join(PLUGIN, 'lib/ima-api.js'), 'utf8')
assert(
  'TC-API-17',
  /Math\.min\(20,\s*Math\.max\(1,\s*Number\(opts\.limit\)/.test(imaApiSrc) &&
    imaApiSrc.includes('next_cursor') &&
    /for\s*\(\s*let\s+page\s*=\s*0;\s*page\s*<\s*25/.test(imaApiSrc),
  'search_knowledge limit 1–20 + listDocuments 分页'
)
const syncEngSrc = fs.readFileSync(path.join(PLUGIN, 'lib/sync-engine.js'), 'utf8')
assert(
  'TC-SYNC-SCOPE-01',
  /listFilesInFolder[\s\S]{0,280}effectiveSyncFolders[\s\S]{0,200}isUnderSyncFolders\(f\.path,\s*scope\)/.test(syncEngSrc),
  'pushFolder 与同步目录取交集'
)
assert(
  'TC-GAP-01',
  /Math\.max\(500,\s*Number\(this\.settings\.uploadGapMs\)/.test(syncEngSrc),
  'uploadGap 下限 500ms'
)

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
assert('TC-NET-08', classifyImaError(403, undefined, '请求频率超限，请稍后重试') === 'rate', '403 频率超限识别为限频')
assert('TC-NET-09', parseImaError(new Error('IMA_HTTP_403: 请求频率超限，请稍后重试'))?.kind === 'rate', 'IMA_HTTP_403 频率超限')
assert('TC-NET-10', parseImaError(new Error('IMA_HTTP_403: 请求超量，请明日再试'))?.kind === 'quota', 'IMA_HTTP_403 超量')
const { isSystemicFailedMark, isSystemicBatchError } = require(path.join(PLUGIN, 'lib/ima-errors.js'))
assert('TC-NET-11', isSystemicBatchError(new Error('IMA_HTTP_403: 请求频率超限，请稍后重试')), '系统性批量错误')
assert('TC-NET-12', isSystemicFailedMark('IMA_HTTP_403: 请求频率超限，请稍后重试'), '可重置失败标记')

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
const prodOverrides = buildBrandOverrides(productManifest)
assert('TC-PROD-14', prodOverrides.zh.authorFollowHint.includes('4927306') && prodOverrides.zh.authorFollowHint.includes('临忆录'), 'manifest QQ 群写入关注提示')
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
assert(
  'TC-LIC-01b',
  Array.isArray(productManifest.license?.freeTier?.benefits?.zh) &&
    productManifest.license.freeTier.benefits.zh.some(s => String(s).includes('同步当前文档')),
  'freeTier 含同步当前文档'
)

const { resolveProBenefits, proLearnMoreUrl, shouldShowProAdStrip, markProAdStripDismissed, todayKey, renderProAdStrip } = require(path.join(PLUGIN, 'lib/pro-ad-block.js'))
const proBenefitsZh = resolveProBenefits({ language: 'zh' })
assert('TC-PRO-AD-01', proBenefitsZh.length >= 3, 'Pro 广告权益列表')
assert('TC-PRO-AD-02', proLearnMoreUrl().includes('/tools/ima-sync'), 'Pro 了解链接')

const mainSrc = fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')
assert(
  'TC-PRO-AD-03',
  /renderProAdStripAboveActions/.test(mainSrc) &&
    /renderProAdStrip\(host[\s\S]*?onActivate:\s*\(\)\s*=>\s*\{\s*this\.plugin\.openSettings\('pro'\)/.test(mainSrc) &&
    !/renderProAdBlock\(this\.proAdEl/.test(mainSrc) &&
    /refreshAfterLicenseChange/.test(mainSrc),
  'Pro 叠层条激活跳转设置；底部大卡已撤；授权后刷新侧栏'
)
assert(
  'TC-PRO-AD-STRIP-01',
  shouldShowProAdStrip({ proAdStripDismissDay: '', proAdToastLastDay: '' }) &&
    !shouldShowProAdStrip({ proAdStripDismissDay: todayKey(), proAdToastLastDay: '' }) &&
    shouldShowProAdStrip({ proAdStripDismissDay: '2020-01-01', proAdToastLastDay: '' }) &&
    !shouldShowProAdStrip({ proAdStripDismissDay: '', proAdToastLastDay: todayKey() }),
  '叠层广告每日一次：关闭或同日 Toast 占用后不再出'
)
{
  const s = { proAdStripDismissDay: '', proAdToastLastDay: '' }
  markProAdStripDismissed(s)
  assert('TC-PRO-AD-STRIP-02', s.proAdStripDismissDay === todayKey() && s.proAdToastLastDay === todayKey(), '关闭叠层条占用当日 Toast 通道')
  assert('TC-PRO-AD-STRIP-03', !shouldShowProAdStrip(s), '关闭后当日不再显示叠层条')
}
assert(
  'TC-PRO-AD-STRIP-LIVE',
  /_proAdStripLive/.test(mainSrc) && /if\s*\(this\._proAdStripLive\)\s*return/.test(mainSrc),
  '叠层条展示中禁止同日中间 Toast'
)
assert(
  'TC-FREE-01',
  mainSrc.includes("this.tr('syncCurrent')") &&
    mainSrc.includes("this.tr('freeIncluded')") &&
    mainSrc.includes("this.tr('syncCurrentFreeHint')") &&
    mainSrc.includes('ima-free-pill') &&
    mainSrc.includes('ima-btn-accent ima-btn-sync-current'),
  '免费版 sticky 日常区挂载同步当前文档与免费标注'
)
assert(
  'TC-FREE-02',
  /当前文档：仅状态/.test(mainSrc) &&
    /!isProActive\(this\.plugin\.settings\)/.test(mainSrc) &&
    !/免费版核心：当前文档卡上直接提供/.test(mainSrc),
  '免费版标注在 sticky；文档卡无重复主按钮'
)
assert(
  'TC-SAVE-01',
  /onVaultModify[\s\S]{0,220}if\s*\(\s*!this\.settings\.syncOnSave\s*\)/.test(mainSrc) &&
    !/onVaultModify[\s\S]{0,280}autoSyncPaused/.test(mainSrc) &&
    /retriesLeft/.test(mainSrc),
  '保存时推送不受暂停定时影响且可重试'
)

let proAdActivateCalls = ''
function mockEl (tag = 'div') {
  const el = {
    tag,
    cls: '',
    text: '',
    href: '',
    target: '',
    rel: '',
    listeners: {},
    children: [],
    setAttr () { return el },
    setText (v) { el.text = v; return el },
    empty () { el.children = []; return el },
    createEl (t, opts = {}) {
      const child = mockEl(t)
      if (opts.cls) child.cls = opts.cls
      if (opts.text) child.text = opts.text
      el.children.push(child)
      return child
    },
    createDiv (opts = {}) {
      const child = mockEl('div')
      if (opts.cls) child.cls = opts.cls
      if (opts.text) child.text = opts.text
      el.children.push(child)
      return child
    },
    createSpan (opts = {}) {
      const child = mockEl('span')
      if (opts.cls) child.cls = opts.cls
      if (opts.text) child.text = opts.text
      el.children.push(child)
      return child
    },
    addEventListener (type, fn) { el.listeners[type] = fn }
  }
  return el
}
const { renderProAdBlock } = require(path.join(PLUGIN, 'lib/pro-ad-block.js'))
const proAdRoot = mockEl()
renderProAdBlock(proAdRoot, { language: 'zh' }, {
  onActivate: () => { proAdActivateCalls = 'openSettings' }
})
const proAdBtn = (function findBtn (node) {
  if (!node) return null
  if (node.tag === 'button') return node
  for (const child of node.children || []) {
    const hit = findBtn(child)
    if (hit) return hit
  }
  return null
})(proAdRoot.children[0])
proAdBtn?.listeners?.click?.()
assert('TC-PRO-AD-04', proAdActivateCalls === 'openSettings', 'Pro 激活按钮触发 onActivate')
{
  let stripActivate = ''
  let stripDismiss = ''
  const stripRoot = mockEl()
  renderProAdStrip(stripRoot, { language: 'zh' }, {
    onActivate: () => { stripActivate = 'pro' },
    onDismiss: () => { stripDismiss = 'today' }
  })
  const buttons = []
  ;(function walk (n) {
    if (!n) return
    if (n.tag === 'button') buttons.push(n)
    for (const c of n.children || []) walk(c)
  })(stripRoot.children[0])
  buttons[0]?.listeners?.click?.({ preventDefault () {}, stopPropagation () {} })
  buttons[1]?.listeners?.click?.({ preventDefault () {}, stopPropagation () {} })
  assert('TC-PRO-AD-STRIP-04', stripActivate === 'pro' && stripDismiss === 'today', '叠层条激活与今日关闭回调')
}

const {
  shouldShowProAdToast,
  markProAdToastDay,
  resolveProAdToastDelayMs,
  renderProAdToast,
  SHOW_PROBABILITY,
  DELAY_MS_MIN,
  DELAY_MS_MAX
} = require(path.join(PLUGIN, 'lib/pro-ad-toast.js'))
assert('TC-PRO-AD-T01', SHOW_PROBABILITY > 0 && SHOW_PROBABILITY < 1, '中间广告命中概率在 (0,1)')
assert('TC-PRO-AD-T02', DELAY_MS_MIN >= 1000 && DELAY_MS_MAX > DELAY_MS_MIN, '中间广告延迟在首次同步后')
assert('TC-PRO-AD-T03', shouldShowProAdToast({ proAdToastLastDay: '' }, { random: () => 0 }), '随机命中可展示')
assert('TC-PRO-AD-T04', !shouldShowProAdToast({ proAdToastLastDay: '' }, { random: () => 0.99 }), '随机未命中不展示')
{
  const s = { proAdToastLastDay: '' }
  markProAdToastDay(s, Date.parse('2026-07-17T12:00:00'))
  assert('TC-PRO-AD-T05', s.proAdToastLastDay === '2026-07-17', '标记本日已展示')
  assert(
    'TC-PRO-AD-T06',
    !shouldShowProAdToast(s, { random: () => 0, now: Date.parse('2026-07-17T18:00:00') }),
    '同日不再展示'
  )
}
assert(
  'TC-PRO-AD-T07',
  t(zh, 'proAdToastBody').includes('定制') && t(en, 'proAdToastBody').toLowerCase().includes('custom'),
  '中间广告文案含定制插件'
)
assert(
  'TC-PRO-AD-T08',
  /async onSyncTelemetry[\s\S]{0,500}maybeShowProAdToast/.test(mainSrc) &&
    mainSrc.includes("openSettings('pro')") &&
    !/async onOpen\s*\(\s*\)[\s\S]{0,800}maybeShowProAdToast/.test(mainSrc),
  '首次同步成功后调度中间广告并跳转 Pro 设置'
)
{
  let toastActivate = ''
  const toastRoot = mockEl()
  renderProAdToast(toastRoot, { language: 'zh' }, {
    onActivate: () => { toastActivate = 'pro' }
  })
  const toastBtn = (function findBtn (node) {
    if (!node) return null
    if (node.tag === 'button' && String(node.text || '').includes('设置')) return node
    for (const c of node.children || []) {
      const hit = findBtn(c)
      if (hit) return hit
    }
    return null
  })(toastRoot.children[0])
  toastBtn?.listeners?.click?.({ preventDefault () {}, stopPropagation () {} })
  assert('TC-PRO-AD-T09', toastActivate === 'pro', '中间广告激活跳转回调')
}
const delayMs = resolveProAdToastDelayMs({ random: () => 0 })
assert('TC-PRO-AD-T10', delayMs === DELAY_MS_MIN, '延迟下界可复现')

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
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            lines.push(`${k}:`)
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

{
  const { patchImaFrontmatter, normalizeFrontmatter } = require('../lib/sync-frontmatter-i18n.js')
  const zhFm = {}
  patchImaFrontmatter(zhFm, {
    syncIma: 'synced',
    syncVerify: 'verified',
    syncError: '',
    syncAt: '2026-07-16T00:00:00.000Z',
    docId: 'doc-zh',
    contentHash: 'abcd1234',
    importKey: '键',
    format: { last_push: '2026-07-16T00:00:00.000Z', status: 'formatted', rules_applied: 'TRIM_TRAILING_SPACE,ENSURE_H1' },
    verifyAt: '2026-07-16T00:00:01.000Z',
    verifyQuery: '键',
    verifyDetail: ''
  }, 'zh')
  assert('TC-FM-ZH-01', zhFm['同步']?.['状态'] === '已同步' && zhFm['同步']?.['核验'] === '已核验', '中文同步状态')
  assert('TC-FM-ZH-02', zhFm['文档编号'] === 'doc-zh' && zhFm['内容指纹'] === 'abcd1234', '中文文档编号/指纹')
  assert('TC-FM-ZH-03', zhFm['排版'] === undefined && zhFm['核验时间'] === undefined && zhFm['核验查询'] === undefined, '不写排版审计/核验诊断')
  assert('TC-FM-ZH-03b', zhFm['同步错误'] === undefined && zhFm['核验详情'] === undefined, '空错误/详情不写盘')
  assert('TC-FM-ZH-03c', zhFm['同步时间'] === '2026-07-16T00:00:00.000Z' && zhFm['导入键'] === '键', '保留同步时间与导入键')
  const back = normalizeFrontmatter(zhFm)
  assert('TC-FM-ZH-04', back.sync?.ima === 'synced' && back.sync?.ima_verify === 'verified', '中文回读规范键')

  const zhSkip = {}
  patchImaFrontmatter(zhSkip, { syncIma: 'pending', format: 'skip' }, 'zh')
  assert('TC-FM-ZH-05', zhSkip['排版'] === '跳过', '用户排版跳过仍保留')

  const zhFail = {}
  patchImaFrontmatter(zhFail, {
    syncIma: 'failed',
    syncError: 'TIMEOUT',
    syncVerify: 'failed',
    verifyDetail: 'NOT_FOUND'
  }, 'zh')
  assert('TC-FM-ZH-05b', zhFail['同步错误'] === 'TIMEOUT' && zhFail['核验详情'] === 'NOT_FOUND', '失败时写错误与核验详情')

  const zhPath = '编史/中文属性.md'
  const zhApp = createMockApp({
    [zhPath]: `---\ntitle: 中文属性\nsync:\n  ima: pending\n---\n正文`
  })
  const zhEngine = new ImaSyncEngine(zhApp, { ...settings, language: 'zh' }, () => {})
  const zhPush = await zhEngine.pushNote(zhApp.vault.getMarkdownFiles()[0], true)
  const zhRaw = zhApp._store.get(zhPath)
  assert('TC-FM-ZH-06', zhPush.pushed && zhRaw.includes('同步:') && zhRaw.includes('已同步'), '推送写盘为中文属性')
  assert('TC-FM-ZH-07', zhRaw.includes('文档编号:') && zhRaw.includes('内容指纹:'), '写盘含文档编号/内容指纹')
  assert('TC-FM-ZH-07b', !zhRaw.includes('核验时间:') && !zhRaw.includes('已应用规则:') && !zhRaw.includes('同步错误:'), '成功推送不写诊断/审计块')
  const zhParsed = parseNoteFile(zhRaw)
  assert('TC-FM-ZH-08', zhParsed.frontmatter.sync?.ima === 'synced' && zhParsed.frontmatter.ima_doc_id, '中文写盘可回读')
}

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
const { buildValidLongLicenseKey } = require(path.join(PLUGIN, 'lib/license-key.js'))
const { evaluateDedup } = require(path.join(PLUGIN, 'lib/trust-dedup.js'))
const { verifyPushedNote, matchKnowledgeHit } = require(path.join(PLUGIN, 'lib/trust-verify.js'))
const { formatTrustReportMarkdown, TrustReportCollector } = require(path.join(PLUGIN, 'lib/trust-report.js'))
const { formatTrustBatchNotice, trustHeroMetrics } = require(path.join(PLUGIN, 'lib/trust-prominence.js'))
const { upsertFailedEntry, removeFailedEntry } = require(path.join(PLUGIN, 'lib/failed-queue.js'))

const legacyShortKey = `IMAPRO-${sig8('ima-sync-pro|IMAPRO-')}`
const proKey = buildValidLongLicenseKey('ima-sync-selftest')
assert(
  'TC-TRUST-07',
  verifyProLicenseKey(proKey) && !verifyProLicenseKey(legacyShortKey) && !verifyProLicenseKey('bad-key'),
  'Pro license 校验'
)

const {
  getEffectiveEntitlements,
  hasModule,
  entitlementStatus,
  MODULE_TRUST,
  MODULE_GOVERN,
  MODULE_FORMAT,
  MODULE_ENRICH,
  MODULE_CORE_FREE,
  TIER_FREE,
  TIER_PRO,
  trustVerifyAllowed,
  trustDedupAllowed,
  syncDirectoriesMax,
  canAddSyncDirectory,
  effectiveSyncFolders,
  kbLibrariesMax,
  canAddKbLibrary,
  effectiveKbLibraries
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
if (!mockResult.ok) throw new Error(`mockActivate failed: ${mockResult.error}`)
applyActivateResult(cloudSettings, { ...mockResult, licenseKey: proKey })
assert('TC-CLD-02', cloudSettings.entitlementsCache?.tier === TIER_PRO && hasModule(cloudSettings, MODULE_TRUST) && hasModule(cloudSettings, MODULE_FORMAT) && hasModule(cloudSettings, MODULE_ENRICH), '写入 entitlementsCache')
clearCloudLicenseCache(cloudSettings)
assert('TC-CLD-03', !cloudSettings.entitlementsCache && cloudLicenseEnabled({ licenseCloudEnabled: true }), '清缓存')
const activateRes = await activateProLicenseCloud(cloudSettings, { pluginVersion: '1.5.39' })
assert('TC-CLD-04', activateRes.ok && cloudSettings.entitlementsCacheKey === proKey, 'activateProLicenseCloud mock')

const { formatProCloudError } = require(path.join(PLUGIN, 'lib/license-cloud.js'))
assert('TC-CLD-05', formatProCloudError({ language: 'zh' }, { error: 'seat_limit' }).includes('激活设备'), '云端席位错误文案')

const hardRevokeSettings = {
  proLicenseKey: proKey,
  proActivated: true,
  entitlementsCache: { tier: TIER_PRO, product: 'ima-sync', modules: ['mod.trust'], valid_until: '2099-01-01T00:00:00.000Z', signature: 'test', issued_at: '2026-01-01', limits: {} },
  entitlementsCacheKey: proKey
}
applyHardRevokeIfNeeded(hardRevokeSettings, { error: 'license_inactive' })
assert(
  'TC-CLD-08',
  !hardRevokeSettings.proActivated &&
    !hardRevokeSettings.entitlementsCache &&
    !hardRevokeSettings.proLicenseKey &&
    hardRevokeSettings.proLicenseKeyRevoked === proKey,
  'hard revoke clears cache+key'
)

const fmtFail = await activateProLicenseCloud({
  proLicenseKey: 'IMAPRO-EGX5-37CH-0',
  licenseCloudEnabled: true,
  licenseMock: true,
  telemetry: { installId: 'fmt' }
}, { pluginVersion: '1.5.70' })
assert('TC-CLD-10', !fmtFail.ok && fmtFail.error === 'invalid_license_format', '残缺激活码格式错误')
assert(
  'TC-CLD-10b',
  formatProCloudError({ language: 'zh' }, { error: 'invalid_license_format' }).includes('IMAPRO-XXXX'),
  '残缺码中文提示'
)

const softKeep = {
  proLicenseKey: proKey,
  licenseCloudEnabled: true,
  licenseMock: false,
  licenseApiUrl: '',
  licenseDeviceId: 'dev-softkeep',
  telemetry: { installId: 'soft-keep' },
  entitlementsCache: cloudSettings.entitlementsCache || mockResult.entitlements,
  entitlementsCacheKey: proKey,
  entitlementsCachedAt: new Date().toISOString(),
  proActivated: true
}
// 无 API URL → activate_failed；软失败应保留缓存（有 device）
globalThis.__IMA_SYNC_DEV_BYPASS__ = false
const softRes = await activateProLicenseCloud(softKeep, { pluginVersion: '1.5.70' })
globalThis.__IMA_SYNC_DEV_BYPASS__ = true
assert(
  'TC-CLD-11',
  !softRes.ok && softRes.kept_cache === true && softKeep.entitlementsCacheKey === proKey && softKeep.proActivated,
  '软失败保留 Pro 缓存'
)

// D-LIC-17d：无 device 脏 cache 不得 kept_cache
const dirtyKeep = {
  proLicenseKey: proKey,
  licenseCloudEnabled: true,
  licenseMock: false,
  licenseApiUrl: '',
  licenseDeviceId: '',
  telemetry: { installId: 'dirty-keep' },
  entitlementsCache: mockResult.entitlements,
  entitlementsCacheKey: proKey,
  entitlementsCachedAt: new Date().toISOString(),
  proActivated: true
}
globalThis.__IMA_SYNC_DEV_BYPASS__ = false
const dirtyRes = await activateProLicenseCloud(dirtyKeep, { pluginVersion: '1.5.70' })
globalThis.__IMA_SYNC_DEV_BYPASS__ = true
assert(
  'TC-LIC-REV-C04',
  dirtyRes.dirty_cache_revoked === true &&
    !dirtyKeep.proLicenseKey &&
    !dirtyKeep.entitlementsCache &&
    !isProActive(dirtyKeep),
  '无 device 脏 cache 联网失败掉 Pro'
)

// D-LIC-17b：生产 + 云端禁止 legacy 校验位旁路
globalThis.__IMA_SYNC_DEV_BYPASS__ = false
assert(
  'TC-LIC-REV-C02',
  !isProActive({
    proLicenseKey: proKey,
    licenseCloudEnabled: true,
    entitlementsCache: null
  }),
  '生产云端开启时仅 Key 不能 Pro'
)
globalThis.__IMA_SYNC_DEV_BYPASS__ = true

const { maybeRefreshCloudEntitlements, REFRESH_INTERVAL_MS } = require(path.join(PLUGIN, 'lib/license-cloud.js'))
const forceFresh = {
  proLicenseKey: proKey,
  licenseCloudEnabled: true,
  licenseMock: true,
  licenseDeviceId: 'dev-force',
  telemetry: { installId: 'force-ref' },
  entitlementsCache: mockResult.entitlements,
  entitlementsCacheKey: proKey,
  entitlementsCachedAt: new Date().toISOString(),
  proActivated: true
}
const skipFresh = await maybeRefreshCloudEntitlements(forceFresh, '1.5.90')
assert('TC-LIC-REV-C03a', skipFresh.skipped === true && skipFresh.reason === 'fresh', '24h 内默认可跳过')
const forceRef = await maybeRefreshCloudEntitlements(forceFresh, '1.5.90', { force: true })
assert('TC-LIC-REV-C03', forceRef.ok === true && !forceRef.skipped, 'force 刷新不被 24h 挡住')
assert('TC-LIC-REV-C03b', Number(REFRESH_INTERVAL_MS) >= 86400000, 'refresh interval constant')

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
  modules: ['core.free', 'mod.trust', 'mod.govern', 'mod.format', 'mod.enrich'],
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
assert('TC-SEC-01', !prodLicenseKey.verifyProLicenseKey(legacyShortKey), 'production rejects short legacy key')
assert('TC-SEC-01b', prodLicenseKey.verifyProLicenseKey(proKey), 'production accepts long key checksum')
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
assert('TC-ENT-11', kbLibrariesMax({ mockPro: false }) === 1 && kbLibrariesMax({ mockPro: true }) === 0, 'Free max 1 KB · Pro unlimited')
assert('TC-ENT-12', canAddKbLibrary({ mockPro: false }, 0) && !canAddKbLibrary({ mockPro: false }, 1), 'Free 不可加第 2 知识库')
assert(
  'TC-ENT-13',
  effectiveKbLibraries({ mockPro: false }, [{ id: 'a' }, { id: 'b' }]).map(k => k.id).join(',') === 'a',
  'Free 裁剪至 1 知识库'
)
assert('TC-ENT-14', t(zh, 'kbLimitReached').includes('{max}') && t(zh, 'kbLibrariesDescFree').includes('{max}'), 'KB 上限文案')
assert(
  'TC-ENT-15',
  /addKbLibrary/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    productManifest.license.freeTier.benefits.zh.some(s => String(s).includes('知识库')),
  'main 门闩 + freeTier 含知识库上限'
)

const entVerifyOffSettings = {
  ...settings,
  mockPro: false,
  kbId: 'kb-test',
  entitlementsCache: {
    ...cloudEnt,
    modules: ['core.free', 'mod.trust', 'mod.govern', 'mod.format', 'mod.enrich'],
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
assert('TC-TRUST-02c', !afterVerify.frontmatter.ima_verify_at && !afterVerify.frontmatter.ima_verify_query, '核验成功不写时间/查询')

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

const {
  normalizeFailedQueue,
  folderOfPath,
  uniqueFoldersFromPaths,
  filterItemsByFolder,
  removeFailedEntry: removeFq
} = require(path.join(PLUGIN, 'lib/failed-queue.js'))
const { countVerifyFailedNotes } = require(path.join(PLUGIN, 'lib/trust-prominence.js'))
const fqNorm = normalizeFailedQueue({
  failedQueue: [
    { path: 'a.md', error: 'x', at: '2026-07-16T00:00:00Z', attempts: 2 },
    { path: '', error: 'skip' },
    null
  ]
})
assert('TC-FQ-01', fqNorm.length === 1 && fqNorm[0].attempts === 2, 'normalizeFailedQueue')
assert('TC-FQ-02', t({ language: 'zh' }, 'fqTitle') === '失败处理' && t({ language: 'zh' }, 'fqTabPush', { n: 3 }) === '推送失败 3', 'fq i18n tabs')
assert(
  'TC-FQ-03',
  /FailureQueueModal/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /openFailureQueue/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')),
  'failure queue modal wired'
)
assert('TC-FQ-04', typeof countVerifyFailedNotes === 'function', 'countVerifyFailedNotes export')
assert('TC-FQ-05', folderOfPath('clips/a.md') === 'clips' && folderOfPath('root.md') === '(root)', 'folderOfPath')
const fqFolders = uniqueFoldersFromPaths([
  { path: 'clips/a.md' },
  { path: 'clips/b.md' },
  { path: 'other/c.md' }
])
assert('TC-FQ-06', fqFolders.join(',') === 'clips,other', 'uniqueFoldersFromPaths')
assert(
  'TC-FQ-07',
  filterItemsByFolder([{ path: 'clips/a.md' }, { path: 'other/c.md' }], 'clips').length === 1,
  'filterItemsByFolder'
)
let fqIgnore = [
  { path: 'clips/a.md', error: 'e', at: '', attempts: 1 },
  { path: 'clips/b.md', error: 'e', at: '', attempts: 1 }
]
fqIgnore = removeFq(fqIgnore, 'clips/a.md')
assert('TC-FQ-08', fqIgnore.length === 1 && fqIgnore[0].path === 'clips/b.md', 'ignore removes from queue only')
assert(
  'TC-FQ-09',
  t({ language: 'zh' }, 'fqRetryOne') === '重试' &&
    t({ language: 'zh' }, 'fqIgnoreOne') === '忽略' &&
    /ignoreFailedEntry/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /openFailureQueue\('push'\)/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')),
  'single retry/ignore + badge deep-link'
)

const report = new TrustReportCollector({ kbId: 'kb', direction: 'push' })
report.addItem({ path: 'a.md', action: 'pushed', doc_id: 'd1', verify: 'verified' })
const md = formatTrustReportMarkdown(report.finish(), (k) => k)
assert('TC-TRUST-06', md.includes('a.md') && !/apiKey/i.test(md), '报告 MD')

assert('TC-TRUST-08', !isProActive({ ...settings, mockPro: false, proLicenseKey: '' }), '未激活 Pro')

assert('TC-TRUST-09', matchKnowledgeHit([{ title: '竞品分析', doc_id: '1' }], { title: '竞品分析' }), '命中判定')

assert('TC-TRUST-10', t({ language: 'en' }, 'trustHeroTitle') === 'Findable after push', 'Trust hero i18n en')
assert('TC-TRUST-10b', t({ language: 'zh' }, 'trustHeroTitle') === '推完验搜得到', 'Trust hero i18n zh')
assert('TC-GOV-08b', t({ language: 'zh' }, 'entModGovern') === '库体检', 'Govern module label zh')

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
{
  let threw = false
  try {
    formatReadyLevelHint((k) => k, capsBlocked)
  } catch {
    threw = true
  }
  assert('TC-TRUST-15d', threw, 'hint args swapped must throw (guard against reintroducing probe bug)')
  const mainSrc = fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')
  assert(
    'TC-TRUST-15e',
    !/formatReadyLevelHint\(\s*\(k,\s*v\)\s*=>\s*t\(this\.settings/.test(mainSrc),
    'probe must call formatReadyLevelHint(caps, tr) not swapped'
  )
  assert('TC-TRUST-15f', /formatReadyLevelHint\(\s*caps,\s*\(k,\s*v\)\s*=>/.test(mainSrc), 'probe uses (caps, tr)')
}

// --- Govern (Pro Alpha · local rules) ---
const { evaluateNoteRules, auditNotes } = require(path.join(PLUGIN, 'lib/govern-rules.js'))
const { formatGovernReportMarkdown } = require(path.join(PLUGIN, 'lib/govern-report.js'))
const { buildHealthReport, gradeFromScore, scoreByRatio } = require(path.join(PLUGIN, 'lib/health-score.js'))
const { canUseGovern } = require(path.join(PLUGIN, 'lib/license.js'))

const LONG_OK = '这是一段足够长的正文用于通过最短字数检查，避免被标成过短。'.repeat(4)

assert('TC-GOV-01', canUseGovern({ mockPro: true }), 'Govern Pro gate')
assert('TC-GOV-02', !canUseGovern({ mockPro: false, proLicenseKey: '' }), 'Govern blocked without Pro')

const govMissingTitle = evaluateNoteRules({
  path: 'a.md',
  basename: 'a',
  title: '',
  body: LONG_OK,
  frontmatter: {},
  settings: { govern: { maxBodyChars: 12000, minTitleChars: 4, minBodyChars: 80 } }
})
assert('TC-GOV-03', govMissingTitle.codes.includes('MISSING_TITLE') && govMissingTitle.risk === 'high', 'MISSING_TITLE')

const govLongBody = evaluateNoteRules({
  path: 'b.md',
  basename: 'b',
  title: '正常标题',
  body: 'x'.repeat(13000),
  frontmatter: { import_key: 'k1' },
  settings: { govern: { maxBodyChars: 12000, minTitleChars: 4, minBodyChars: 80 } }
})
assert('TC-GOV-04', govLongBody.codes.includes('BODY_TOO_LONG') && govLongBody.risk === 'medium', 'BODY_TOO_LONG')

const govAudit = auditNotes([
  { path: 'ok.md', basename: 'ok', title: '正常标题', body: LONG_OK, frontmatter: { import_key: 'k' } },
  { path: 'bad.md', basename: 'bad', title: '', body: LONG_OK, frontmatter: {} }
], { govern: { maxBodyChars: 12000, minTitleChars: 4, minBodyChars: 80 } })
assert('TC-GOV-05', govAudit.total === 2 && govAudit.highRisk === 1 && govAudit.counts.ok === 1, 'auditNotes counts')

const govMd = formatGovernReportMarkdown(govAudit, (k) => k)
assert('TC-GOV-06', govMd.includes('governReportTitle') && govMd.includes('bad.md') && !/apiKey/i.test(govMd), 'govern report MD')

const govSensitive = evaluateNoteRules({
  path: 'c.md',
  basename: 'c',
  title: '机密文档',
  body: LONG_OK,
  frontmatter: { import_key: 'k' },
  settings: { govern: { sensitivePatterns: ['机密'] } }
})
assert('TC-GOV-07', govSensitive.codes.includes('SENSITIVE_PATTERN'), 'SENSITIVE_PATTERN')

assert('TC-GOV-08', t({ language: 'zh' }, 'governHeroTitle') === '库体检' && t({ language: 'zh' }, 'healthHeroTitle') === '库体检', 'Govern i18n zh')

const govShort = evaluateNoteRules({
  path: 'short.md',
  basename: 'short',
  title: '短正文笔记',
  body: '太短了',
  frontmatter: { import_key: 'k' },
  settings: { govern: { minBodyChars: 80 } }
})
assert('TC-HEALTH-01', govShort.codes.includes('BODY_TOO_SHORT'), 'BODY_TOO_SHORT')

const govUrlOnly = evaluateNoteRules({
  path: 'url.md',
  basename: 'url',
  title: '公众号书签',
  body: 'https://mp.weixin.qq.com/s/abcdefg',
  frontmatter: { import_key: 'k' },
  settings: { govern: { minBodyChars: 80, urlOnlyMaxResidualChars: 40 } }
})
assert('TC-HEALTH-02', govUrlOnly.codes.includes('URL_ONLY_BODY') && govUrlOnly.codes.includes('BODY_TOO_SHORT'), 'URL_ONLY_BODY')

const govDup = auditNotes([
  { path: 'd1.md', basename: 'd1', title: '同名标题', body: LONG_OK, frontmatter: { import_key: 'a' } },
  { path: 'd2.md', basename: 'd2', title: '同名标题', body: LONG_OK, frontmatter: { import_key: 'b' } },
  { path: 'd3.md', basename: 'd3', title: '独苗', body: LONG_OK, frontmatter: { import_key: 'c', sync: { ima: 'synced' } } }
], { govern: { minBodyChars: 80 } })
assert(
  'TC-HEALTH-03',
  govDup.items.filter(i => i.codes.includes('DUPLICATE_TITLE')).length === 2 &&
    !govDup.items.find(i => i.path === 'd3.md').codes.includes('DUPLICATE_TITLE'),
  'DUPLICATE_TITLE second pass'
)

const healthNotes = [
  { path: 'p1.md', title: '待推1', frontmatter: { sync: { ima: 'pending' } } },
  { path: 'p2.md', title: '待推2', frontmatter: {} },
  { path: 'u1.md', title: '链接', frontmatter: { sync: { ima: 'pending' } } },
  { path: 'ok1.md', title: '好笔记', frontmatter: { sync: { ima: 'synced' } } }
]
const healthAudit = auditNotes([
  { path: 'p1.md', basename: 'p1', title: '待推1', body: '短', frontmatter: healthNotes[0].frontmatter },
  { path: 'p2.md', basename: 'p2', title: '待推2', body: '短', frontmatter: healthNotes[1].frontmatter },
  { path: 'u1.md', basename: 'u1', title: '链接', body: 'https://example.com/a', frontmatter: healthNotes[2].frontmatter },
  { path: 'ok1.md', basename: 'ok1', title: '好笔记', body: LONG_OK, frontmatter: healthNotes[3].frontmatter }
], { govern: { minBodyChars: 80 } })
const health = buildHealthReport(healthAudit, healthNotes, {})
assert('TC-HEALTH-04', health.score < 80 && health.grade === 'needs_work', 'health score needs work')
assert('TC-HEALTH-05', health.counts.pending === 3 && health.counts.urlOnly >= 1 && health.counts.bodyTooShort >= 2, 'health dimension counts')
assert('TC-HEALTH-06', gradeFromScore(85) === 'excellent' && gradeFromScore(70) === 'good' && scoreByRatio(0.1, 25) === 25, 'grade helpers')
assert('TC-HEALTH-07', t({ language: 'zh' }, 'healthDimUrlOnly') === '仅链接' && t({ language: 'zh' }, 'healthRefresh') === '刷新库体检', 'health i18n')

const {
  foldersForDimension,
  topFoldersOverall,
  formatWeeklyHealthMarkdown,
  listUrlOnlyNotes
} = require(path.join(PLUGIN, 'lib/health-report.js'))
const folderAgg = foldersForDimension(health, 'bodyTooShort')
assert('TC-HEALTH-08', folderAgg.length >= 1 && folderAgg.every(f => f.count > 0), 'foldersForDimension')
assert('TC-HEALTH-09', topFoldersOverall(health, 3).length >= 1, 'topFoldersOverall')
const urlOnlyListed = listUrlOnlyNotes(healthAudit)
assert(
  'TC-HEALTH-12',
  urlOnlyListed.some(n => n.path === 'u1.md') &&
    urlOnlyListed.every(n => n.codes.includes('URL_ONLY_BODY')),
  'listUrlOnlyNotes from govern report'
)
assert(
  'TC-HEALTH-13',
  t({ language: 'zh' }, 'enrichUrlOnlyOne') === '一键富化' &&
    t({ language: 'zh' }, 'healthFolderListHead') === '按文件夹',
  'E3.4 urlOnly enrich i18n'
)
const healthDimSrc = fs.readFileSync(path.join(PLUGIN, 'lib/health-dim-modal.js'), 'utf8')
assert(
  'TC-HEALTH-14',
  healthDimSrc.includes('previewEnrichAtPath') &&
    healthDimSrc.includes("dimKey === 'urlOnly'") &&
    mainSrc.includes('async previewEnrichAtPath') &&
    mainSrc.includes('async previewEnrichFile'),
  'E3.4 urlOnly → previewEnrichAtPath wiring'
)
const weeklyMdPro = formatWeeklyHealthMarkdown(health, healthAudit, (k, vars) => {
  if (k === 'healthWeeklyTitle') return 'WEEKLY'
  if (k === 'healthWeeklyCoreAnalysis') return 'CORE'
  if (k === 'healthWeeklyPriorityTitle') return 'PRIO'
  if (k === 'healthWeeklyStandards') return 'STD'
  if (k === 'healthWeeklyDims') return 'DIMS'
  if (k === 'governReportPath') return 'path'
  if (k === 'governReportRisk') return 'risk'
  if (k === 'governReportCodes') return 'codes'
  if (k === 'healthWeeklyGovernSection') return 'GOVERN'
  if (k === 'governHeroSummary') return `sum ${vars?.total}`
  if (k === 'healthWeeklyConclusionPro') return `pro ${vars?.score} ${vars?.grade} ${vars?.dim}`
  if (k === 'healthWeeklyConclusionFree') return `free ${vars?.score} ${vars?.grade}`
  if (k === 'healthWeeklyPriorityDim' || k === 'healthWeeklyPriorityDimFolder' || k === 'healthWeeklyPriorityFolder') {
    return `prio:${vars?.dim || vars?.folder || ''}`
  }
  if (k === 'healthDimScoreHint') return `${vars?.score}/${vars?.weight}`
  if (k === 'healthWeeklyDelta') return `delta ${vars?.delta}`
  return k
}, { tier: 'pro', prior: { score: 90, grade: 'excellent' } })
assert(
  'TC-HEALTH-10',
  weeklyMdPro.includes('WEEKLY') &&
    weeklyMdPro.includes('GOVERN') &&
    weeklyMdPro.includes('CORE') &&
    weeklyMdPro.includes('DIMS') &&
    weeklyMdPro.includes('STD') &&
    weeklyMdPro.includes('delta') &&
    !/api[_-]?key/i.test(weeklyMdPro) &&
    !weeklyMdPro.includes(LONG_OK),
  'weekly MD pro: analysis + dims + no secrets / no full body'
)
const weeklyMdFree = formatWeeklyHealthMarkdown(health, healthAudit, (k, vars) => {
  if (k === 'healthWeeklyTitle') return 'WEEKLY'
  if (k === 'healthWeeklyCoreAnalysis') return 'CORE'
  if (k === 'healthWeeklyDims') return 'DIMS'
  if (k === 'healthWeeklyTopFolders') return 'FOLDERS'
  if (k === 'healthWeeklyGovernSection') return 'GOVERN'
  if (k === 'healthWeeklyStandards') return 'STD'
  if (k === 'healthWeeklyProUpsell') return 'UPSELL'
  if (k === 'healthWeeklyConclusionFree') return `free ${vars?.score} ${vars?.grade}`
  return k
}, { tier: 'free' })
assert(
  'TC-HEALTH-10b',
  weeklyMdFree.includes('WEEKLY') &&
    weeklyMdFree.includes('CORE') &&
    weeklyMdFree.includes('UPSELL') &&
    !weeklyMdFree.includes('DIMS') &&
    !weeklyMdFree.includes('FOLDERS') &&
    !weeklyMdFree.includes('GOVERN') &&
    !weeklyMdFree.includes('STD'),
  'weekly MD free: score+grade only, no dims/folders'
)
assert('TC-HEALTH-11', t({ language: 'zh' }, 'healthWeeklyExport') === '生成本周周报', 'weekly export i18n')
assert('TC-HEALTH-11b', t({ language: 'zh' }, 'healthWeeklyScore') === '体检分', 'checkup score i18n')
assert(
  'TC-HEALTH-11c',
  mainSrc.includes('renderHealthStatsSummary') &&
    mainSrc.includes("tier === 'pro'") &&
    mainSrc.includes('priorHealthReport'),
  'stats fold health + free/pro weekly wiring'
)
assert(
  'TC-HEALTH-15',
  fs.existsSync(path.join(PLUGIN, 'lib/health-weekly-modal.js')) &&
    /class HealthWeeklyModal/.test(fs.readFileSync(path.join(PLUGIN, 'lib/health-weekly-modal.js'), 'utf8')) &&
    /pickOsDirectory/.test(fs.readFileSync(path.join(PLUGIN, 'lib/health-weekly-modal.js'), 'utf8')) &&
    /healthWeeklyProGuideBtn/.test(fs.readFileSync(path.join(PLUGIN, 'lib/health-weekly-modal.js'), 'utf8')) &&
    /openSettings\(['"]pro['"]\)/.test(fs.readFileSync(path.join(PLUGIN, 'lib/health-weekly-modal.js'), 'utf8')) &&
    mainSrc.includes('HealthWeeklyModal') &&
    mainSrc.includes('saveWeeklyHealthToOsFolder') &&
    mainSrc.includes('saveWeeklyHealthToVaultFolder') &&
    t({ language: 'zh' }, 'healthWeeklySaveOs') === '保存到本机文件夹…' &&
    t({ language: 'zh' }, 'healthWeeklyProGuideBtn') === '前往激活 Pro',
  'weekly report modal + vault/OS save + Free Pro guide'
)

// --- Format (Pro Alpha · local rules) ---
const {
  formatForIma,
  pickContentHashBody,
  ruleWikilink,
  ruleHighlight,
  ruleTaskList,
  ruleCommentStrip,
  ruleCallout,
  ruleCjkSpacing,
  resolveActiveRuleIds,
  CORE_RULE_IDS,
  formatRuleLabels
} = require(path.join(PLUGIN, 'lib/format-pipeline.js'))
const { buildFormatReport, formatFormatReportMarkdown } = require(path.join(PLUGIN, 'lib/format-report.js'))
const { canUseFormatFull } = require(path.join(PLUGIN, 'lib/license.js'))

// --- Free batch daily quota (notes/day; Sync current excluded) ---
const {
  checkBatchQuota,
  recordBatchNotes,
  countBatchQuotaNotes,
  batchNotesPerDayMax,
  DEFAULT_FREE_BATCH_NOTES_PER_DAY
} = require(path.join(PLUGIN, 'lib/batch-quota.js'))
const freeQuotaSettings = { mockPro: false, proLicenseKey: '', batchQuotaUsage: { date: '', notes: 0 } }
assert('TC-QUOTA-01', batchNotesPerDayMax(freeQuotaSettings) === DEFAULT_FREE_BATCH_NOTES_PER_DAY, 'free default 50/day')
assert('TC-QUOTA-02', batchNotesPerDayMax({ mockPro: true }) === 0, 'pro unlimited')
assert('TC-QUOTA-03', checkBatchQuota(freeQuotaSettings, 10).ok === true, 'under quota ok')
freeQuotaSettings.batchQuotaUsage = { date: require(path.join(PLUGIN, 'lib/batch-quota.js')).todayKey(), notes: 50 }
assert('TC-QUOTA-04', checkBatchQuota(freeQuotaSettings, 1).ok === false && checkBatchQuota(freeQuotaSettings, 1).reason === 'exhausted', 'exhausted')
freeQuotaSettings.batchQuotaUsage = { date: require(path.join(PLUGIN, 'lib/batch-quota.js')).todayKey(), notes: 40 }
assert('TC-QUOTA-05', checkBatchQuota(freeQuotaSettings, 20).reason === 'too_many', 'too many planned')
assert('TC-QUOTA-06', countBatchQuotaNotes({ pushed: 3, errors: ['a'] }) === 4, 'count pushed+failed')
recordBatchNotes(freeQuotaSettings, 5)
assert('TC-QUOTA-07', freeQuotaSettings.batchQuotaUsage.notes === 45, 'record adds')
assert(
  'TC-QUOTA-08',
  require(path.join(PLUGIN, 'lib/entitlements.js')).FREE_ENTITLEMENTS.limits.batch_notes_per_day === 50,
  'entitlements free limit'
)

const {
  checkFormatPreviewQuota,
  recordFormatPreview,
  formatPreviewPerDayMax,
  remainingFormatPreview,
  DEFAULT_FREE_FORMAT_PREVIEW_PER_DAY
} = require(path.join(PLUGIN, 'lib/format-quota.js'))
const { todayKey: formatTodayKey } = require(path.join(PLUGIN, 'lib/batch-quota.js'))
const freeFmt = { mockPro: false, proLicenseKey: '', formatTrialUsage: { date: '', count: 0 } }
assert('TC-FMT-Q-01', formatPreviewPerDayMax(freeFmt) === DEFAULT_FREE_FORMAT_PREVIEW_PER_DAY, 'format free default 5/day')
assert('TC-FMT-Q-02', formatPreviewPerDayMax({ mockPro: true }) === 0, 'format pro unlimited')
assert('TC-FMT-Q-03', checkFormatPreviewQuota(freeFmt).ok === true && remainingFormatPreview(freeFmt) === 5, 'format under quota')
freeFmt.formatTrialUsage = { date: formatTodayKey(), count: 5 }
assert('TC-FMT-Q-04', checkFormatPreviewQuota(freeFmt).ok === false && checkFormatPreviewQuota(freeFmt).reason === 'exhausted', 'format exhausted')
freeFmt.formatTrialUsage = { date: formatTodayKey(), count: 2 }
recordFormatPreview(freeFmt)
assert('TC-FMT-Q-05', freeFmt.formatTrialUsage.count === 3, 'format record increments')
assert('TC-FMT-Q-06', t(zh, 'formatQuotaRemain').includes('{remaining}') && t(zh, 'formatQuotaExhausted').includes('{max}'), 'format quota i18n')
assert(
  'TC-FMT-Q-07',
  productManifest.license.freeTier.benefits.zh.some(s => String(s).includes('每日 5 次')),
  'freeTier 含一键排版每日 5 次'
)
assert(
  'TC-FMT-Q-08',
  /guardFormatPreviewQuota/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /format_preview_per_day/.test(fs.readFileSync(path.join(PLUGIN, 'lib/remote-notices.js'), 'utf8')),
  'main 门闩 + 远程 experience 下发'
)

{
  const crypto = require('crypto')
  const {
    applyFetchedExperience,
    markExperienceOffline,
    resolveExperienceLimit,
    DEFAULT_EXPERIENCE
  } = require(path.join(PLUGIN, 'lib/experience-limits.js'))
  const licenseSign = require(path.join(PLUGIN, 'lib/license-sign.js'))
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const origVerify = licenseSign.verifyExperienceSignature
  licenseSign.verifyExperienceSignature = (exp) => licenseSign.verifyExperienceEd25519(exp, publicKey)
  try {
    const issued_at = '2026-07-17T00:00:00.000Z'
    const body = {
      enrich_parse_per_day: 12,
      batch_notes_per_day: 80,
      format_preview_per_day: 7,
      issued_at
    }
    const signature = `ed25519:${crypto.sign(null, licenseSign.experienceSignBytes(body), privateKey).toString('base64')}`
    const s = { mockPro: false, remoteNotices: {} }
    markExperienceOffline()
    assert(
      'TC-EXP-01',
      resolveExperienceLimit('batch_notes_per_day', {
        remoteNotices: { experience: { batch_notes_per_day: 999 } }
      }) === DEFAULT_EXPERIENCE.batch_notes_per_day,
      'tampered/untrusted → default'
    )
    const result = applyFetchedExperience(s, { ...body, signature })
    assert('TC-EXP-02', result?.ok === true, 'signed experience trusted')
    assert('TC-EXP-03', resolveExperienceLimit('batch_notes_per_day', s) === 80, 'cloud batch applied')
    assert('TC-EXP-04', resolveExperienceLimit('enrich_parse_per_day', s) === 12, 'cloud enrich applied')
    assert('TC-EXP-05', resolveExperienceLimit('format_preview_per_day', s) === 7, 'cloud format applied')
    markExperienceOffline()
    assert(
      'TC-EXP-06',
      resolveExperienceLimit('batch_notes_per_day', s) === DEFAULT_EXPERIENCE.batch_notes_per_day,
      'offline → default even if cache numbers remain'
    )
  } finally {
    licenseSign.verifyExperienceSignature = origVerify
    markExperienceOffline()
  }
}

{
  const { buildExperienceTamperEvent, HOOKS } = require(path.join(PLUGIN, 'lib/telemetry.js'))
  const {
    applyExperienceReset,
    shouldReportExperienceTamper,
    markExperienceTamperReported,
    DEFAULT_EXPERIENCE: DEF
  } = require(path.join(PLUGIN, 'lib/experience-limits.js'))
  const ev = buildExperienceTamperEvent(
    { installId: 'install-abc', sessionId: 'sess', pluginVersion: '1.5.77' },
    {
      reason: 'bad_signature',
      claimed: { enrich_parse_per_day: 99, batch_notes_per_day: 999, format_preview_per_day: 88 }
    }
  )
  assert('TC-EXP-07', ev.feature_hook === HOOKS.EXPERIENCE_TAMPER && ev.payload?.reason === 'bad_signature', 'tamper event payload')
  const rs = {
    remoteNotices: { experience: { batch_notes_per_day: 999, signature: 'x' } },
    formatTrialUsage: { date: '2099-01-01', count: 9 },
    enrichTrialUsage: { date: '2099-01-01', count: 9 },
    batchQuotaUsage: { date: '2099-01-01', notes: 40 }
  }
  assert('TC-EXP-08a', shouldReportExperienceTamper(rs) === true, 'tamper report allowed once/day')
  markExperienceTamperReported(rs)
  assert('TC-EXP-08b', shouldReportExperienceTamper(rs) === false, 'tamper report throttled same day')
  const did = applyExperienceReset(rs, { at: '2026-07-17T12:00:00.000Z' })
  assert('TC-EXP-08', did === true && rs.formatTrialUsage.count === 0 && rs.enrichTrialUsage.count === 0 && rs.batchQuotaUsage.notes === 0, 'reset clears trial counters')
  assert('TC-EXP-08c', rs.remoteNotices.experience.signature === '' && rs.experienceResetAckAt === '2026-07-17T12:00:00.000Z', 'reset clears experience cache')
  void DEF
}

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

assert('TC-FMT-17', ruleTaskList('- [ ] todo\n- [x] done') === '- ☐ todo\n- ☑ done', 'task list')
assert('TC-FMT-18', ruleCommentStrip('keep %%hidden%% end') === 'keep end', 'comment strip')
assert('TC-FMT-19', !ruleCallout('> [!note] Tip\n> body\n').includes('[!note]'), 'callout downgrade')
const freeCore = resolveActiveRuleIds({ mockPro: false, proLicenseKey: '', format: { preset: 'core' } }, {})
assert('TC-FMT-20', freeCore.includes('TASK_LIST') && freeCore.includes('CALLOUT') && freeCore.includes('COMMENT_STRIP'), 'free core enriched')
assert('TC-FMT-21', freeCore.includes('CJK_SPACING') === false && CORE_RULE_IDS.length >= 12, 'free excludes pro rules')
const freeForce = resolveActiveRuleIds(
  { mockPro: false, proLicenseKey: '', format: { preset: 'standard' } },
  { format: 'force' }
)
assert(
  'TC-FMT-21b',
  !freeForce.includes('CJK_SPACING') && !freeForce.includes('HEADING_NORMALIZE'),
  'Free 不可 format:force 绕过 Pro 规则'
)
const rich = formatForIma({
  path: 'rich.md',
  title: '富文本',
  body: '%%c%%\n- [ ] a\n\n[[页]] ^bid\n\n==x==',
  frontmatter: {}
}, { format: { enabled: true, preset: 'core' } })
assert('TC-FMT-22', rich.rulesApplied.includes('TASK_LIST') && rich.rulesApplied.includes('COMMENT_STRIP') && rich.body.includes('☐'), 'rich core pass')
assert('TC-FMT-23', formatRuleLabels(['WIKILINK'], (k) => k === 'formatRule_WIKILINK' ? '双链' : k)[0] === '双链', 'rule labels')

const { ruleListSpacing, ruleCollapseInlineSpaces } = require(path.join(PLUGIN, 'lib/format-pipeline.js'))
assert(
  'TC-FMT-24',
  ruleListSpacing('前文\n- a\n- b\n后文') === '前文\n\n- a\n- b\n\n后文' &&
    !ruleListSpacing('前文\n- a\n- b\n后文').includes('- a\n\n- b'),
  'list items stay compact'
)
assert(
  'TC-FMT-25',
  ruleCollapseInlineSpaces('这是  测试   多空格') === '这是 测试 多空格' &&
    ruleCollapseInlineSpaces(['前  后', '```', 'x  y', '```', 'z  w'].join('\n')).includes('x  y'),
  'collapse mid-line spaces; keep code fence'
)
const compactFmt = formatForIma({
  path: 'compact.md',
  title: '紧凑',
  body: '段首  多空\n- a\n\n- b\n\n\n尾',
  frontmatter: {}
}, { format: { enabled: true, preset: 'core' } })
assert(
  'TC-FMT-26',
  compactFmt.body.includes('段首 多空') &&
    compactFmt.body.includes('- a\n- b') &&
    !compactFmt.body.includes('- a\n\n- b') &&
    !/\n{3,}/.test(compactFmt.body),
  'core format reduces mid spaces and list gaps'
)

// --- Enrich Alpha (detect + render + Pro gate) ---
const { detectEnrichTargets, extractEnrichUrls } = require(path.join(PLUGIN, 'lib/enrich-detect.js'))
const { normalizeEnrichFields, markImagePlaceholders, renderEnrichPayloadMarkdown } = require(path.join(PLUGIN, 'lib/enrich-render.js'))
const { canUseEnrich } = require(path.join(PLUGIN, 'lib/entitlements.js'))

assert('TC-ENR-01', canUseEnrich({ mockPro: true }) && !canUseEnrich({ mockPro: false, proLicenseKey: '' }), 'Enrich Pro gate')
assert('TC-ENR-02', hasModule({ mockPro: true }, MODULE_ENRICH), 'legacy Pro includes mod.enrich')

const enrUrls = extractEnrichUrls('见 https://mp.weixin.qq.com/s/abc 与 https://example.com/x')
assert('TC-ENR-03', enrUrls[0].kind === 'wechat' && enrUrls.some(u => u.kind === 'web'), 'wechat before web priority')

const enrNeed = detectEnrichTargets('标题\nhttps://mp.weixin.qq.com/s/abc', {}, { enrich: { skipMinBodyChars: 500 } })
assert('TC-ENR-04', enrNeed.needsEnrich === true && enrNeed.targets.length === 1, 'URL-only needs enrich')

const enrSkip = detectEnrichTargets('x'.repeat(600) + '\nhttps://example.com/a', { enrich: 'skip' }, {})
assert('TC-ENR-05', enrSkip.needsEnrich === false && enrSkip.skipReason === 'enrich_skip', 'enrich: skip')

const enrFields = normalizeEnrichFields({
  source_url: 'https://example.com/a',
  title: '题',
  body: '正文',
  author: '',
  published_at: ''
})
assert('TC-ENR-06', enrFields.author === '未知' && enrFields.missing.includes('missing_author'), 'missing author → 未知')

const marked = markImagePlaceholders('<p>hi</p><img src="https://cdn.example/a.png"><img src="">', 'https://example.com/a')
assert('TC-ENR-07', marked.images_marked === 2 && marked.body.includes('![图片](https://cdn.example/a.png)'), 'image placeholders')

const payload = renderEnrichPayloadMarkdown({
  source_url: 'https://example.com/a',
  title: '公开网页',
  body: 'hello',
  author: '作者甲',
  published_at: '2026-07-01'
})
assert(
  'TC-ENR-08',
  payload.includes('# 公开网页') &&
    payload.includes('- 原文：https://example.com/a') &&
    payload.includes('- 作者：作者甲') &&
    payload.includes('- 发布时间：2026-07-01') &&
    payload.includes('hello'),
  'payload five-field skeleton'
)
assert('TC-ENR-09', t({ language: 'zh' }, 'entModEnrich') === '链接解析', 'enrich module i18n')

const { enrichFetchWeb } = require(path.join(PLUGIN, 'lib/enrich-web.js'))
const { enrichFetchWechat } = require(path.join(PLUGIN, 'lib/enrich-wechat.js'))
const { enrichNote } = require(path.join(PLUGIN, 'lib/enrich-pipeline.js'))
const { ENRICH_CODES } = require(path.join(PLUGIN, 'lib/enrich-codes.js'))
const { parseHTML } = require('linkedom')
const enrichCreateDoc = (html) => parseHTML(String(html || '')).document

const sampleWebHtml = `<!doctype html><html><head>
<title>Ignore</title>
<meta property="og:title" content="公开网页标题">
<meta name="author" content="作者甲">
<meta property="article:published_time" content="2026-07-01">
</head><body><article><h1>公开网页标题</h1>
<p>这是一段足够长的正文内容，用于验证通用网页富化解析是否成功。</p>
<img src="https://cdn.example/a.png">
</article></body></html>`

const webOk = await enrichFetchWeb('https://example.com/a', {
  createDocument: enrichCreateDoc,
  fetchHtml: async () => ({ status: 200, text: sampleWebHtml })
})
assert('TC-ENR-10', webOk.ok && webOk.fields.title === '公开网页标题' && webOk.fields.source_url === 'https://example.com/a', 'web five fields')
assert('TC-ENR-11', webOk.codes.includes(ENRICH_CODES.WEB_DEFUDDLE_OK) || webOk.codes.includes(ENRICH_CODES.WEB_META_OK), 'web parse code')
assert('TC-ENR-12', String(webOk.fields.body).includes('足够长的正文') || webOk.fields.images_marked >= 1, 'web body or images')

const web404 = await enrichFetchWeb('https://example.com/missing', {
  fetchHtml: async () => ({ status: 404, text: 'nope' })
})
assert('TC-ENR-13', !web404.ok && web404.codes.includes(ENRICH_CODES.WEB_FETCH_FAILED), 'web 404')

const sampleWxHtml = `<html><body>
<script>var msg_title = "公众号标题"; var nickname = "公众号名"; var msg_desc = "摘要";</script>
<div id="js_content"><p>微信正文段落一，内容需要足够长才能通过静态层判定。</p><p>第二段继续。</p><img data-src="https://mmbiz.example/x.png"></div>
</body></html>`
const wxOk = await enrichFetchWechat('https://mp.weixin.qq.com/s/abc', {
  fetchHtml: async () => ({ status: 200, text: sampleWxHtml })
})
assert('TC-ENR-14', wxOk.ok && wxOk.fields.title === '公众号标题' && wxOk.fields.author === '公众号名', 'wechat T1 fields')
assert('TC-ENR-15', wxOk.codes.includes(ENRICH_CODES.WECHAT_T1_OK) && wxOk.fields.images_marked >= 1, 'wechat T1 + img placeholder')

const wxPay = await enrichFetchWechat('https://mp.weixin.qq.com/s/pay', {
  fetchHtml: async () => ({
    status: 200,
    text: '<html><body>付费后可查看全文<div id="js_pay_bar"></div><script>var msg_title="付费文";</script></body></html>'
  })
})
assert('TC-ENR-16', !wxPay.ok && wxPay.codes.includes(ENRICH_CODES.WECHAT_PAYWALL), 'wechat paywall')

const timed = await enrichFetchWeb('https://example.com/slow', {
  timeoutMs: 80,
  fetchHtml: async () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, text: '<html></html>' }), 400))
})
assert('TC-ENR-17', !timed.ok && timed.codes.includes(ENRICH_CODES.FETCH_TIMEOUT), 'fetch timeout')

const pipe = await enrichNote({
  body: 'https://example.com/a',
  frontmatter: {},
  settings: { mockPro: true, enrich: { enabled: true, skipMinBodyChars: 500 } },
  createDocument: enrichCreateDoc,
  fetchHtml: async () => ({ status: 200, text: sampleWebHtml })
})
assert('TC-ENR-18', pipe.status === 'enriched' && String(pipe.payloadMarkdown).includes('原文：https://example.com/a'), 'pipeline payload')

const { lightBeautifyEnrichMarkdown } = require(path.join(PLUGIN, 'lib/enrich-pipeline.js'))
assert('TC-ENR-18b', lightBeautifyEnrichMarkdown('# T\n\n\n\na  \n').includes('# T'), 'light beautify keeps title')

const {
  normalizeEnrichSourceUrl,
  planSplitWriteActions,
  buildMergedEnrichNoteRaw,
  buildEnrichNoteRaw,
  readEnrichSourceUrlFromRaw,
  readEnrichContentHashFromRaw
} = require(path.join(PLUGIN, 'lib/enrich-writeback.js'))
assert(
  'TC-ENR-WB-01',
  normalizeEnrichSourceUrl('https://ex.com/a?utm_source=x&b=1') === 'https://ex.com/a?b=1' ||
    normalizeEnrichSourceUrl('https://ex.com/a?utm_source=x&b=1').includes('b=1'),
  'normalize strips utm'
)
const wbPlans = planSplitWriteActions(
  [{ sourceUrl: 'https://ex.com/a', payload: '# A\n\nbody', title: 'A' }],
  new Map([['https://ex.com/a', { path: 'f/A.md', hash: 'x' }]])
)
assert('TC-ENR-WB-02', wbPlans[0].action === 'skip', 'same source_url skips overwrite')
const wbCreate = planSplitWriteActions(
  [{ sourceUrl: 'https://ex.com/b', payload: '# B\n\nb', title: 'B' }],
  new Map()
)
assert('TC-ENR-WB-03', wbCreate[0].action === 'create' && /解析来源:/.test(wbCreate[0].raw || '') && /解析状态:\s*已解析/.test(wbCreate[0].raw || ''), 'create has zh fm')
const merged = buildMergedEnrichNoteRaw([
  { sourceUrl: 'https://a.com', payload: '# A\n\nx' },
  { sourceUrl: 'https://b.com', payload: '# B\n\ny' }
])
assert('TC-ENR-WB-04', /解析合并:\s*true/.test(merged) && merged.includes('# A') && merged.includes('# B'), 'merge note')
assert('TC-ENR-WB-04b', (() => {
  const legacy = `---\nenrich_source_url: "https://x.test/a"\nenrich_content_hash: "abcd"\nenrich_status: enriched\n---\nbody`
  return readEnrichSourceUrlFromRaw(legacy) === 'https://x.test/a' && readEnrichContentHashFromRaw(legacy) === 'abcd'
})(), 'legacy en enrich fm still readable')
assert('TC-ENR-WB-05', /enrichWriteLocal|enrichMergeLinks|enrichMergeProRequired/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')), 'E4 modal Pro merge wired')
assert(
  'TC-ENR-WB-05b',
  /ima-enrich-preview-actions/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')) &&
    /ima-enrich-preview-actions/.test(fs.readFileSync(path.join(PLUGIN, 'styles.css'), 'utf8')) &&
    !/ima-row ima-enrich-preview-actions/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')),
  'enrich preview actions use compact flex (not ima-row 2-col)'
)
assert('TC-ENR-WB-06', t({ language: 'zh' }, 'enrichMergeProRequired').includes('Pro'), 'merge Pro copy')
assert('TC-I18N-ZH-01', t({ language: 'zh' }, 'trustVerifyAfterPush') === '推送后验证可检索', 'zh trustVerifyAfterPush')

const {
  getEnrichCacheEntry,
  putEnrichCacheEntry,
  enrichCacheTtlMs
} = require(path.join(PLUGIN, 'lib/enrich-cache.js'))
const cacheSettings = { enrich: { cacheTtlHours: 72 }, enrichUrlCache: {} }
putEnrichCacheEntry(cacheSettings, 'https://ex.com/c?utm_source=x', {
  status: 'enriched',
  kind: 'web',
  codes: ['WEB_DEFUDDLE_OK'],
  fields: { title: 'C', body: 'x', source_url: 'https://ex.com/c', author: '未知', published_at: '未知' },
  payloadMarkdown: '# C\n\n- 原文：https://ex.com/c\n'
})
const cacheHit = getEnrichCacheEntry(cacheSettings, 'https://ex.com/c')
assert('TC-ENR-CACHE-01', cacheHit && cacheHit.payloadMarkdown.includes('# C'), 'cache put/get by normalized url')
assert('TC-ENR-CACHE-02', enrichCacheTtlMs({ enrich: { cacheTtlHours: 24 } }) === 24 * 3600 * 1000, 'ttl hours')
const cachedPipe = await enrichNote({
  body: 'https://ex.com/c',
  settings: cacheSettings,
  fetchHtml: async () => { throw new Error('should_not_fetch') }
})
assert(
  'TC-ENR-CACHE-03',
  cachedPipe.cacheHit === true && cachedPipe.codes.includes('CACHE_HIT'),
  'enrichNote uses cache without fetch'
)

const pipeFree = await enrichNote({
  body: 'https://example.com/a',
  settings: { mockPro: false, proLicenseKey: '', enrich: { enabled: true } },
  createDocument: enrichCreateDoc,
  fetchHtml: async () => ({ status: 200, text: sampleWebHtml })
})
assert('TC-ENR-19', pipeFree.status === 'enriched' || pipeFree.status === 'degraded', 'Free may enrich preview path')
const pipeFreeProOnly = await enrichNote({
  body: 'https://example.com/a',
  settings: { mockPro: false, proLicenseKey: '', enrich: { enabled: true } },
  requirePro: true,
  fetchHtml: async () => ({ status: 200, text: sampleWebHtml })
})
assert('TC-ENR-19b', pipeFreeProOnly.status === 'skipped' && pipeFreeProOnly.skipReason === 'no_pro', 'requirePro skips Free')

const {
  enrichParsePerDayMax,
  checkEnrichParseQuota,
  recordEnrichParse,
  DEFAULT_FREE_ENRICH_PARSE_PER_DAY
} = require(path.join(PLUGIN, 'lib/enrich-quota.js'))
const freeEnrQ = { mockPro: false, proLicenseKey: '', enrich: { freeParsePerDay: 5 }, enrichTrialUsage: { date: '', count: 0 } }
assert('TC-ENR-Q-01', enrichParsePerDayMax(freeEnrQ) === DEFAULT_FREE_ENRICH_PARSE_PER_DAY, 'enrich free 5/day')
assert('TC-ENR-Q-02', enrichParsePerDayMax({ mockPro: true }) === 0, 'enrich Pro unlimited')
recordEnrichParse(freeEnrQ)
assert('TC-ENR-Q-03', checkEnrichParseQuota(freeEnrQ).remaining === 4, 'enrich record decrements')
assert('TC-ENR-Q-04', t({ language: 'zh' }, 'enrichOneClick') === '链接解析', 'enrich sticky label')
assert('TC-ENR-Q-05', /ima-dual-tools/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')), 'dual tools row')
assert('TC-ENR-Q-06', productManifest.license.freeTier.benefits.zh.some(s => String(s).includes('链接解析')), 'freeTier 含链接解析每日 5 次')
const mainSrcQuota = fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')
assert('TC-ENR-Q-07', /quotaProUnlimitedLink|openSettings\('format'\)|openSettings\('enrich'\)/.test(mainSrcQuota), 'Pro quota link → settings')
assert('TC-ENR-Q-08', /data-ima-fold/.test(mainSrcQuota) && /format: 'sectionPro'/.test(mainSrcQuota), 'settings fold deep-link')

const { buildEnrichReport, formatEnrichReportMarkdown } = require(path.join(PLUGIN, 'lib/enrich-report.js'))
const enrRep = buildEnrichReport([
  { path: 'a.md', status: 'enriched', source_url: 'https://example.com/a', codes: ['WEB_DEFUDDLE_OK'], preview: 'hello' },
  { path: 'b.md', status: 'failed', source_url: 'https://x', codes: ['WEB_FETCH_FAILED'], error: '404' }
])
const enrMd = formatEnrichReportMarkdown(enrRep, (k) => k)
assert('TC-ENR-20', enrRep.counts.enriched === 1 && enrMd.includes('enrichReportTitle') && !/api[_-]?key/i.test(enrMd), 'enrich report MD')
assert('TC-ENR-21', /enrichHeroTitle|enrichPreview/.test(fs.readFileSync(path.join(PLUGIN, 'main.js'), 'utf8')), 'enrich UI wired')

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
if (typeof freshSettings.telemetryEnabled !== 'boolean') freshSettings.telemetryEnabled = true
assert('TC-TELEM-11', freshSettings.telemetryEnabled === true, 'telemetry default on when unset')
assert('TC-TELEM-11b', ({ telemetryEnabled: false }).telemetryEnabled === false, 'explicit off respected')

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
