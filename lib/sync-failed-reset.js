'use strict'

const { isSystemicFailedMark } = require('./ima-errors')
const { isUnderSyncFolders } = require('./utils')
const { effectiveSyncFolders } = require('./license')
const { yieldToUi } = require('./ui-yield')
const { resolveLang } = require('./i18n')
const { normalizeFrontmatter, patchImaFrontmatter } = require('./sync-frontmatter-i18n')

/**
 * 将限频/超量/鉴权等系统性失败标记重置为 pending，避免「失败≈全库」。
 * @param {import('obsidian').App} app
 * @param {object} settings
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 * @returns {Promise<{ scanned: number, cleared: number }>}
 */
async function resetSystemicFailedMarks (app, settings, opts = {}) {
  const folders = effectiveSyncFolders(settings, settings.syncFolders)
  const all = app.vault.getMarkdownFiles()
  const files = folders.length
    ? all.filter(f => isUnderSyncFolders(f.path, folders))
    : all
  const lang = resolveLang(settings)

  let scanned = 0
  let cleared = 0
  const chunk = 80

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    scanned++
    const fm = normalizeFrontmatter(app.metadataCache.getFileCache(file)?.frontmatter)
    if (fm?.sync?.ima !== 'failed') {
      if (i > 0 && i % chunk === 0) await yieldToUi()
      continue
    }
    if (!isSystemicFailedMark(fm.ima_sync_error)) {
      if (i > 0 && i % chunk === 0) await yieldToUi()
      continue
    }
    await app.fileManager.processFrontMatter(file, (next) => {
      patchImaFrontmatter(next, {
        syncIma: 'pending',
        syncError: ''
      }, lang)
    })
    cleared++
    if (opts.onProgress) opts.onProgress(cleared, files.length)
    if (i > 0 && i % chunk === 0) await yieldToUi()
  }

  return { scanned, cleared }
}

module.exports = { resetSystemicFailedMarks }
