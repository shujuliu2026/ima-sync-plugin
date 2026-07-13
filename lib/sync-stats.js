'use strict'

const { isUnderSyncFolders } = require('./utils')
const { effectiveSyncFolders } = require('./license')

/** @typedef {'all'|'synced'|'pending'|'failed'|'conflict'|'verify_ok'|'verify_fail'|'verify_pending'} SyncStatKind */

/** @param {object | undefined} frontmatter */
function classifyVerifyStatus (frontmatter) {
  if (frontmatter?.sync?.ima !== 'synced') return null
  const v = frontmatter?.sync?.ima_verify
  if (v === 'verified') return 'verify_ok'
  if (v === 'failed') return 'verify_fail'
  if (v === 'pending') return 'verify_pending'
  return null
}

/** @param {object | undefined} frontmatter */
function classifySyncStatus (frontmatter) {
  const sync = frontmatter?.sync?.ima
  if (sync === 'synced') return 'synced'
  if (sync === 'failed') return 'failed'
  if (sync === 'conflict') return 'conflict'
  return 'pending'
}

/**
 * @param {import('obsidian').App} app
 * @param {object} settings
 * @param {SyncStatKind} kind
 * @param {number} [limit]
 */
async function collectSyncStatFiles (app, settings, kind, limit = 200) {
  const folders = effectiveSyncFolders(settings, settings.syncFolders)
  const all = app.vault.getMarkdownFiles()
  const files = folders.length
    ? all.filter(f => isUnderSyncFolders(f.path, folders))
    : all

  /** @type {{ path: string, basename: string, status: string }[]} */
  const items = []
  let total = 0
  const chunk = 120

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const fm = app.metadataCache.getFileCache(f)?.frontmatter
    const status = classifySyncStatus(fm)
    const verifyStatus = classifyVerifyStatus(fm)
    let match = kind === 'all' || status === kind
    if (kind === 'verify_ok' || kind === 'verify_fail' || kind === 'verify_pending') {
      match = verifyStatus === kind
    }
    if (match) {
      total++
      if (items.length < limit) {
        items.push({ path: f.path, basename: f.basename, status })
      }
    }
    if (i > 0 && i % chunk === 0) {
      await new Promise(r => window.setTimeout(r, 0))
    }
  }

  return { total, items, truncated: total > items.length }
}

module.exports = { classifySyncStatus, classifyVerifyStatus, collectSyncStatFiles }
