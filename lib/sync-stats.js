'use strict'

const { isUnderSyncFolders } = require('./utils')
const { effectiveSyncFolders } = require('./license')
const { normalizeFrontmatter } = require('./sync-frontmatter-i18n')

/** @typedef {'all'|'synced'|'pending'|'failed'|'conflict'|'verify_ok'|'verify_fail'|'verify_pending'} SyncStatKind */

/** @param {object | undefined} frontmatter */
function classifyVerifyStatus (frontmatter) {
  const fm = normalizeFrontmatter(frontmatter)
  if (fm?.sync?.ima !== 'synced') return null
  const v = fm?.sync?.ima_verify
  if (v === 'verified') return 'verify_ok'
  if (v === 'failed') return 'verify_fail'
  if (v === 'pending') return 'verify_pending'
  return null
}

/** @param {object | undefined} frontmatter */
function classifySyncStatus (frontmatter) {
  const sync = normalizeFrontmatter(frontmatter)?.sync?.ima
  if (sync === 'synced') return 'synced'
  if (sync === 'failed') return 'failed'
  if (sync === 'conflict') return 'conflict'
  return 'pending'
}

/**
 * 本地显示用：YYYY-MM-DD HH:mm:ss
 * @param {string|number|null|undefined} value ISO 或毫秒
 * @returns {string}
 */
function formatStatDateTime (value) {
  if (value == null || value === '') return ''
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** @param {{ syncAt?: string|null, mtimeMs?: number }} item */
function sortKeyMs (item) {
  const fromSync = item.syncAt ? Date.parse(String(item.syncAt)) : NaN
  if (Number.isFinite(fromSync)) return fromSync
  return Number(item.mtimeMs) || 0
}

/**
 * @param {import('obsidian').App} app
 * @param {object} settings
 * @param {SyncStatKind} kind
 * @param {number} [limit] 0/负数 = 不截断（弹窗翻页用）；>0 时截断并标 truncated
 */
async function collectSyncStatFiles (app, settings, kind, limit = 0) {
  const folders = effectiveSyncFolders(settings, settings.syncFolders)
  const all = app.vault.getMarkdownFiles()
  const files = folders.length
    ? all.filter(f => isUnderSyncFolders(f.path, folders))
    : all

  /** @type {{ path: string, basename: string, status: string, syncAt: string|null, mtimeMs: number }[]} */
  const items = []
  const chunk = 120

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const rawFm = app.metadataCache.getFileCache(f)?.frontmatter
    const fm = normalizeFrontmatter(rawFm)
    const status = classifySyncStatus(rawFm)
    const verifyStatus = classifyVerifyStatus(rawFm)
    let match = kind === 'all' || status === kind
    if (kind === 'verify_ok' || kind === 'verify_fail' || kind === 'verify_pending') {
      match = verifyStatus === kind
    }
    if (match) {
      const syncAt = fm?.ima_sync_at != null && String(fm.ima_sync_at).trim()
        ? String(fm.ima_sync_at).trim()
        : null
      items.push({
        path: f.path,
        basename: f.basename,
        status,
        syncAt,
        mtimeMs: Number(f.stat?.mtime) || 0
      })
    }
    if (i > 0 && i % chunk === 0) {
      await new Promise(r => window.setTimeout(r, 0))
    }
  }

  items.sort((a, b) => sortKeyMs(b) - sortKeyMs(a))

  const total = items.length
  const cap = Number(limit) > 0 ? Number(limit) : 0
  const truncated = cap > 0 && total > cap
  return {
    total,
    items: truncated ? items.slice(0, cap) : items,
    truncated
  }
}

module.exports = {
  classifySyncStatus,
  classifyVerifyStatus,
  collectSyncStatFiles,
  formatStatDateTime
}
