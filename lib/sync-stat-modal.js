'use strict'

const { Modal, TFile } = require('obsidian')
const { t } = require('./i18n')
const { collectSyncStatFiles, formatStatDateTime } = require('./sync-stats')

/** @typedef {'all'|'synced'|'pending'|'failed'|'conflict'} SyncStatKind */

const PAGE_SIZE = 20

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
    /** @type {{ path: string, basename: string, status: string, syncAt: string|null, mtimeMs: number }[]} */
    this._items = []
    this._total = 0
    this._page = 1
    /** @type {HTMLElement|null} */
    this._listWrap = null
    /** @type {string} */
    this._labelKey = 'notes'
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-stat-detail-modal')

    this._labelKey = LABEL_KEYS[this.kind] || 'notes'
    contentEl.createEl('h2', { text: this.tr('statDetailTitle', { label: this.tr(this._labelKey), n: '…' }) })

    contentEl.createDiv({
      cls: 'ima-stat-privacy ima-muted ima-compact',
      text: this.tr('statLocalPrivacy')
    })

    this._listWrap = contentEl.createDiv({ cls: 'ima-stat-detail-list' })
    this._listWrap.createDiv({ cls: 'ima-muted', text: this.tr('statDetailLoading') })

    void this.loadList()
  }

  async loadList () {
    const listWrap = this._listWrap
    const contentEl = this.contentEl
    if (!listWrap) return

    try {
      const { total, items } = await collectSyncStatFiles(
        this.app,
        this.plugin.settings,
        this.kind,
        0
      )

      this._items = items
      this._total = total
      this._page = 1

      const titleEl = contentEl.querySelector('h2')
      if (titleEl) {
        titleEl.setText(this.tr('statDetailTitle', { label: this.tr(this._labelKey), n: total }))
      }

      this.renderPage()
    } catch (e) {
      listWrap.empty()
      listWrap.createDiv({ cls: 'ima-warn', text: String(e?.message || e) })
    }
  }

  pageCount () {
    return Math.max(1, Math.ceil(this._total / PAGE_SIZE))
  }

  renderPage () {
    const listWrap = this._listWrap
    if (!listWrap) return

    listWrap.empty()

    if (!this._total) {
      listWrap.createDiv({ cls: 'ima-muted ima-stat-detail-empty', text: this.tr('statDetailEmpty') })
      return
    }

    listWrap.createDiv({ cls: 'ima-muted ima-compact ima-stat-detail-hint', text: this.tr('statDetailClickHint') })

    const pages = this.pageCount()
    if (this._page > pages) this._page = pages
    if (this._page < 1) this._page = 1

    const start = (this._page - 1) * PAGE_SIZE
    const pageItems = this._items.slice(start, start + PAGE_SIZE)

    const ul = listWrap.createEl('ul', { cls: 'ima-stat-detail-items' })
    for (const item of pageItems) {
      const li = ul.createEl('li', { cls: 'ima-stat-detail-item' })
      const row = li.createDiv({ cls: 'ima-stat-detail-row' })
      const btn = row.createEl('button', {
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

      const timeText = formatStatDateTime(item.syncAt) ||
        formatStatDateTime(item.mtimeMs) ||
        this.tr('statDetailNoTime')
      row.createDiv({
        cls: 'ima-muted ima-stat-detail-time',
        text: timeText,
        attr: {
          title: item.syncAt
            ? this.tr('statDetailTimeSync')
            : this.tr('statDetailTimeMtime')
        }
      })

      if (item.path !== item.basename) {
        li.createDiv({ cls: 'ima-muted ima-stat-detail-path', text: item.path })
      }
    }

    if (pages > 1) {
      const pager = listWrap.createDiv({ cls: 'ima-stat-detail-pager' })
      const prev = pager.createEl('button', {
        cls: 'ima-btn-secondary ima-stat-detail-page-btn',
        text: this.tr('statDetailPrev'),
        attr: { type: 'button' }
      })
      prev.disabled = this._page <= 1
      prev.addEventListener('click', () => {
        if (this._page <= 1) return
        this._page -= 1
        this.renderPage()
        listWrap.scrollTop = 0
      })

      pager.createSpan({
        cls: 'ima-muted ima-stat-detail-page-label',
        text: this.tr('statDetailPage', { page: this._page, pages })
      })

      const next = pager.createEl('button', {
        cls: 'ima-btn-secondary ima-stat-detail-page-btn',
        text: this.tr('statDetailNext'),
        attr: { type: 'button' }
      })
      next.disabled = this._page >= pages
      next.addEventListener('click', () => {
        if (this._page >= pages) return
        this._page += 1
        this.renderPage()
        listWrap.scrollTop = 0
      })
    }
  }

  onClose () {
    this.contentEl.empty()
    this._listWrap = null
    this._items = []
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
