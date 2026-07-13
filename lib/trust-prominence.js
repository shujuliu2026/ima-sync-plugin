'use strict'

const { canUseTrust, effectiveSyncFolders } = require('./license')

/**
 * @param {object | undefined} fm
 * @returns {'verified'|'failed'|'pending'|'skipped'|'none'}
 */
function noteVerifyBadge (fm) {
  const v = fm?.sync?.ima_verify
  if (v === 'verified') return 'verified'
  if (v === 'failed') return 'failed'
  if (v === 'pending') return 'pending'
  if (v === 'skipped') return 'skipped'
  return 'none'
}

/**
 * @param {{ counts?: object }} [report]
 * @param {{ searchable?: number, verifyFailed?: number, pushed?: number }} [live]
 */
function trustHeroMetrics (report, live = {}) {
  const c = report?.counts || {}
  const verified = live.searchable ?? c.verified ?? 0
  const pushed = live.pushed ?? c.pushed ?? 0
  const failed = live.verifyFailed ?? c.verify_failed ?? 0
  const pending = c.verify_pending ?? 0
  const denom = pushed || c.total || 0
  const pct = denom > 0 ? Math.round((verified / denom) * 100) : null
  return { verified, pushed, failed, pending, denom, pct }
}

/**
 * @param {object} settings
 * @param {import('obsidian').App} app
 * @param {number} [limit]
 */
function listVerifyFailedNotes (settings, app, limit = 8) {
  const folders = effectiveSyncFolders(settings, settings.syncFolders)
  const all = app.vault.getMarkdownFiles()
  const files = folders.length
    ? all.filter(f => {
        const { isUnderSyncFolders } = require('./utils')
        return isUnderSyncFolders(f.path, folders)
      })
    : all
  /** @type {{ path: string, detail: string }[]} */
  const out = []
  for (const f of files) {
    const fm = app.metadataCache.getFileCache(f)?.frontmatter
    if (fm?.sync?.ima_verify !== 'failed') continue
    out.push({
      path: f.path,
      detail: String(fm.ima_verify_detail || fm.ima_verify_query || '').slice(0, 80)
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * @param {object} settings
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatTrustBatchNotice (settings, summary, tr) {
  if (!canUseTrust(settings) || !summary) return ''
  const m = trustHeroMetrics(summary.trustReport, {
    searchable: summary.verified,
    verifyFailed: summary.verify_failed,
    pushed: summary.pushed
  })
  if (!m.denom && !summary.pushed) return ''
  const parts = []
  if (summary.pushed) parts.push(`${tr('pushed')} ${summary.pushed}`)
  if (m.verified != null && summary.pushed) {
    parts.push(`${tr('trustHeroSearchable')} ${m.verified}/${summary.pushed}`)
  }
  if (summary.verify_failed) parts.push(`${tr('trustVerifyFailed')} ${summary.verify_failed}`)
  if (summary.deduped) parts.push(`${tr('trustDeduped')} ${summary.deduped}`)
  if (summary.errors?.length) parts.push(`${tr('errors')} ${summary.errors.length}`)
  if (m.pct != null && summary.pushed) {
    return `${tr('trustHeroDone', { pct: m.pct })} (${parts.join(' · ')})`
  }
  return parts.length ? parts.join(' · ') : ''
}

module.exports = {
  noteVerifyBadge,
  trustHeroMetrics,
  listVerifyFailedNotes,
  formatTrustBatchNotice
}
