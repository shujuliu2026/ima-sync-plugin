'use strict'

const { Modal, Notice, TFile } = require('obsidian')
const { t } = require('./i18n')
const { listVerifyFailedNotes } = require('./trust-prominence')
const {
  normalizeFailedQueue,
  uniqueFoldersFromPaths,
  filterItemsByFolder
} = require('./failed-queue')

/** @typedef {'push'|'verify'} FailureQueueTab */

class FailureQueueModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('../main')} plugin
   * @param {FailureQueueTab} [tab]
   */
  constructor (app, plugin, tab = 'push') {
    super(app)
    this.plugin = plugin
    /** @type {FailureQueueTab} */
    this.tab = tab === 'verify' ? 'verify' : 'push'
    /** @type {string} */
    this.folderFilter = ''
    this._busy = false
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    this.render()
  }

  render () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-fq-modal')

    const pushAll = normalizeFailedQueue(this.plugin.settings)
    const verifyAll = listVerifyFailedNotes(this.plugin.settings, this.app, 0)
    const pushItems = filterItemsByFolder(pushAll, this.folderFilter)
    const verifyItems = filterItemsByFolder(verifyAll, this.folderFilter)
    const folders = uniqueFoldersFromPaths(this.tab === 'push' ? pushAll : verifyAll)

    contentEl.createEl('h2', { text: this.tr('fqTitle') })
    contentEl.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('fqHint')
    })

    const tabs = contentEl.createDiv({ cls: 'ima-fq-tabs' })
    const pushTab = tabs.createEl('button', {
      cls: `ima-fq-tab${this.tab === 'push' ? ' is-active' : ''}`,
      text: this.tr('fqTabPush', { n: pushAll.length }),
      attr: { type: 'button' }
    })
    const verifyTab = tabs.createEl('button', {
      cls: `ima-fq-tab${this.tab === 'verify' ? ' is-active' : ''}`,
      text: this.tr('fqTabVerify', { n: verifyAll.length }),
      attr: { type: 'button' }
    })
    pushTab.addEventListener('click', () => {
      this.tab = 'push'
      this.folderFilter = ''
      this.render()
    })
    verifyTab.addEventListener('click', () => {
      this.tab = 'verify'
      this.folderFilter = ''
      this.render()
    })

    if (folders.length > 1) {
      const filterRow = contentEl.createDiv({ cls: 'ima-fq-filter' })
      filterRow.createSpan({ cls: 'ima-muted ima-compact', text: this.tr('fqFilterLabel') })
      const sel = filterRow.createEl('select', { cls: 'ima-fq-filter-select' })
      sel.createEl('option', {
        text: this.tr('fqFilterAll'),
        attr: { value: '' }
      })
      for (const folder of folders) {
        const label = folder === '(root)' ? this.tr('healthFolderRoot') : folder
        const opt = sel.createEl('option', {
          text: label,
          attr: { value: folder }
        })
        if (folder === this.folderFilter) opt.selected = true
      }
      sel.addEventListener('change', () => {
        this.folderFilter = sel.value || ''
        this.render()
      })
    }

    const list = contentEl.createDiv({ cls: 'ima-fq-list' })
    if (this.tab === 'push') {
      this.renderPushList(list, pushItems)
    } else {
      this.renderVerifyList(list, verifyItems)
    }

    const foot = contentEl.createDiv({ cls: 'ima-fq-foot ima-row' })
    if (this.tab === 'push') {
      const n = pushItems.length
      const retryBtn = foot.createEl('button', {
        text: this.folderFilter
          ? this.tr('fqRetryFiltered', { n })
          : this.tr('fqRetryAll', { n: pushAll.length }),
        cls: 'ima-btn-secondary',
        attr: { type: 'button' }
      })
      retryBtn.disabled = !n || this.plugin.syncing || this._busy
      retryBtn.addEventListener('click', () => {
        const paths = pushItems.map((e) => e.path)
        this.close()
        void this.plugin.retryFailedQueue({ paths })
      })
    } else {
      foot.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('fqVerifyFootHint')
      })
    }
  }

  /**
   * @param {HTMLElement} list
   * @param {import('./failed-queue').FailedEntry[]} items
   */
  renderPushList (list, items) {
    if (!items.length) {
      list.createDiv({
        cls: 'ima-muted',
        text: this.folderFilter ? this.tr('fqFilterEmpty') : this.tr('fqPushEmpty')
      })
      return
    }
    for (const item of items) {
      const row = list.createDiv({ cls: 'ima-fq-row' })
      const main = row.createDiv({ cls: 'ima-fq-row-main' })
      const link = main.createEl('button', {
        cls: 'ima-fq-path',
        text: item.path,
        attr: { type: 'button', title: item.path }
      })
      link.addEventListener('click', () => this.openPath(item.path))
      if (item.error) {
        main.createDiv({ cls: 'ima-muted ima-compact ima-fq-detail', text: item.error })
      }
      const meta = row.createDiv({ cls: 'ima-fq-meta ima-muted ima-compact' })
      meta.createSpan({
        text: this.tr('fqMetaAttempts', { n: item.attempts || 1 })
      })
      if (item.at) {
        meta.createSpan({
          text: String(item.at).replace('T', ' ').slice(0, 16)
        })
      }
      const actions = row.createDiv({ cls: 'ima-fq-actions' })
      const retryOne = actions.createEl('button', {
        text: this.tr('fqRetryOne'),
        cls: 'ima-btn-secondary ima-btn-compact',
        attr: { type: 'button' }
      })
      retryOne.disabled = this.plugin.syncing || this._busy
      retryOne.addEventListener('click', () => {
        void this.onRetryOne(item.path)
      })
      const ignoreOne = actions.createEl('button', {
        text: this.tr('fqIgnoreOne'),
        cls: 'ima-btn-secondary ima-btn-compact',
        attr: { type: 'button' }
      })
      ignoreOne.disabled = this._busy
      ignoreOne.addEventListener('click', () => {
        void this.onIgnoreOne(item.path)
      })
    }
  }

  /**
   * @param {HTMLElement} list
   * @param {{ path: string, detail: string }[]} items
   */
  renderVerifyList (list, items) {
    if (!items.length) {
      list.createDiv({
        cls: 'ima-muted',
        text: this.folderFilter ? this.tr('fqFilterEmpty') : this.tr('fqVerifyEmpty')
      })
      return
    }
    for (const item of items) {
      const row = list.createDiv({ cls: 'ima-fq-row' })
      const main = row.createDiv({ cls: 'ima-fq-row-main' })
      const link = main.createEl('button', {
        cls: 'ima-fq-path',
        text: item.path,
        attr: { type: 'button', title: item.path }
      })
      link.addEventListener('click', () => this.openPath(item.path))
      if (item.detail) {
        main.createDiv({ cls: 'ima-muted ima-compact ima-fq-detail', text: item.detail })
      }
      const actions = row.createDiv({ cls: 'ima-fq-actions' })
      actions.createEl('button', {
        text: this.tr('fqOpenNote'),
        cls: 'ima-btn-secondary ima-btn-compact',
        attr: { type: 'button' }
      }).addEventListener('click', () => this.openPath(item.path))
    }
  }

  /** @param {string} path */
  async onRetryOne (path) {
    if (this._busy || this.plugin.syncing) return
    this._busy = true
    this.render()
    try {
      this.close()
      await this.plugin.retryFailedQueue({ paths: [path] })
    } finally {
      this._busy = false
    }
  }

  /** @param {string} path */
  async onIgnoreOne (path) {
    if (this._busy) return
    this._busy = true
    try {
      const ok = await this.plugin.ignoreFailedEntry(path)
      if (ok) new Notice(this.tr('fqIgnored', { path }), 3000)
      this.render()
    } finally {
      this._busy = false
    }
  }

  /** @param {string} path */
  openPath (path) {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(file)
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = { FailureQueueModal }
