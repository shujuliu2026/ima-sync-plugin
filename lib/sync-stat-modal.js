'use strict'

const { Modal, TFile } = require('obsidian')
const { t } = require('./i18n')
const { collectSyncStatFiles } = require('./sync-stats')

/** @typedef {'all'|'synced'|'pending'|'failed'|'conflict'} SyncStatKind */

const LABEL_KEYS = {
  all: 'notes',
  synced: 'statSynced',
  pending: 'statPending',
  failed: 'statFailed',
  conflict: 'statConflict',
  statSearchable: 'statSearchable',
  statVerifyFailed: 'statVerifyFailed',
  statVerifyPending: 'statVerifyPending'
}

class SyncStatDetailModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('../main')} plugin
   * @param {SyncStatKind} kind
   */
  constructor (app, plugin, kind) {
    super(app)
    this.plugin = plugin
    this.kind = kind
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-stat-detail-modal')

    const labelKey = LABEL_KEYS[this.kind] || 'notes'
    contentEl.createEl('h2', { text: this.tr('statDetailTitle', { label: this.tr(labelKey), n: '…' }) })

    contentEl.createDiv({
      cls: 'ima-stat-privacy ima-muted ima-compact',
      text: this.tr('statLocalPrivacy')
    })

    const listWrap = contentEl.createDiv({ cls: 'ima-stat-detail-list' })
    listWrap.createDiv({ cls: 'ima-muted', text: this.tr('statDetailLoading') })

    void this.loadList(contentEl, listWrap, labelKey)
  }

  /**
   * @param {HTMLElement} contentEl
   * @param {HTMLElement} listWrap
   * @param {string} labelKey
   */
  async loadList (contentEl, listWrap, labelKey) {
    try {
      const { total, items, truncated } = await collectSyncStatFiles(
        this.app,
        this.plugin.settings,
        this.kind
      )

      const titleEl = contentEl.querySelector('h2')
      if (titleEl) {
        titleEl.setText(this.tr('statDetailTitle', { label: this.tr(labelKey), n: total }))
      }

      listWrap.empty()

      if (!total) {
        listWrap.createDiv({ cls: 'ima-muted ima-stat-detail-empty', text: this.tr('statDetailEmpty') })
        return
      }

      if (truncated) {
        listWrap.createDiv({
          cls: 'ima-muted ima-compact ima-stat-detail-trunc',
          text: this.tr('statDetailTruncated', { total, shown: items.length })
        })
      }

      listWrap.createDiv({ cls: 'ima-muted ima-compact ima-stat-detail-hint', text: this.tr('statDetailClickHint') })

      const ul = listWrap.createEl('ul', { cls: 'ima-stat-detail-items' })
      for (const item of items) {
        const li = ul.createEl('li', { cls: 'ima-stat-detail-item' })
        const btn = li.createEl('button', {
          cls: 'ima-stat-detail-link',
          text: item.basename,
          attr: { type: 'button', title: item.path }
        })
        btn.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(item.path)
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file)
            this.close()
          }
        })
        if (item.path !== item.basename) {
          li.createDiv({ cls: 'ima-muted ima-stat-detail-path', text: item.path })
        }
      }
    } catch (e) {
      listWrap.empty()
      listWrap.createDiv({ cls: 'ima-warn', text: String(e?.message || e) })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = { SyncStatDetailModal, STAT_KIND_BY_LABEL: {
  notes: 'all',
  statSynced: 'synced',
  statPending: 'pending',
  statFailed: 'failed',
  statConflict: 'conflict',
  statSearchable: 'verify_ok',
  statVerifyFailed: 'verify_fail',
  statVerifyPending: 'verify_pending'
} }
