'use strict'

const { computeContentHash, parseTime } = require('./utils')

/**
 * @param {object} local
 * @param {object} remote
 */
function detectConflict (local, remote) {
  const localHash = local.contentHash || computeContentHash(local.body || '')
  const remoteHash = remote.content_hash || computeContentHash(remote.content || '')
  const syncedHash = local.syncedHash || ''
  const localChanged = localHash !== syncedHash
  const remoteChanged = remoteHash !== syncedHash

  const localTime = parseTime(local.mtimeIso || local.ima_sync_at)
  const remoteTime = parseTime(remote.updated_at)

  if (localChanged && remoteChanged && localHash !== remoteHash) {
    return { kind: 'both_changed', localHash, remoteHash, localTime, remoteTime }
  }
  if (localChanged && !remoteChanged) {
    return { kind: 'local_newer', localHash, remoteHash }
  }
  if (!localChanged && remoteChanged) {
    return { kind: 'remote_newer', localHash, remoteHash, remoteTime }
  }
  if (localChanged && remoteChanged && localHash === remoteHash) {
    return { kind: 'none', localHash, remoteHash }
  }
  return { kind: 'none', localHash, remoteHash }
}

/**
 * @param {import('obsidian').App} app
 * @param {object} conflict
 * @param {string} strategy ask|local|remote
 * @param {(key: string, vars?: Record<string, string>) => string} [translate]
 */
async function resolveConflict (app, conflict, strategy, translate) {
  const tr = translate || ((k) => k)
  const choice = strategy === 'ask'
    ? await promptConflict(app, conflict, tr)
    : strategy

  if (choice === 'local') return 'push'
  if (choice === 'remote') return 'pull'
  return 'skip'
}

/**
 * @param {import('obsidian').App} app
 * @param {object} conflict
 * @param {(key: string, vars?: Record<string, string>) => string} tr
 */
function promptConflict (app, conflict, tr) {
  const { Modal } = require('obsidian')
  const file = conflict.file
  const title = file?.basename || 'note'

  return new Promise((resolve) => {
    class ConflictModal extends Modal {
      onOpen () {
        const { contentEl } = this
        contentEl.empty()
        contentEl.createEl('h2', { text: tr('conflictTitle') })
        contentEl.createEl('p', { text: tr('conflictBody', { title }) })

        const actions = contentEl.createDiv({ cls: 'ima-conflict-actions' })
        actions.createEl('button', { text: tr('keepLocal'), cls: 'mod-cta' })
          .addEventListener('click', () => { this.close(); resolve('local') })
        actions.createEl('button', { text: tr('keepRemote') })
          .addEventListener('click', () => { this.close(); resolve('remote') })
        actions.createEl('button', { text: tr('skipNote') })
          .addEventListener('click', () => { this.close(); resolve('skip') })
      }

      onClose () {
        this.contentEl.empty()
      }
    }

    new ConflictModal(app).open()
  })
}

module.exports = { detectConflict, resolveConflict }
