'use strict'

const { Modal, TFile, Notice } = require('obsidian')
const { t, formatCodeList } = require('./i18n')
const { DIM_I18N, foldersForDimension, listUrlOnlyNotes } = require('./health-report')
const { canUseEnrich } = require('./license')

class HealthDimFolderModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('../main')} plugin
   * @param {string} dimKey
   * @param {object} health
   */
  constructor (app, plugin, dimKey, health) {
    super(app)
    this.plugin = plugin
    this.dimKey = dimKey
    this.health = health
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-health-dim-modal')

    const dimLabel = this.tr(DIM_I18N[this.dimKey] || 'healthDimPending')
    const folders = foldersForDimension(this.health, this.dimKey)
    contentEl.createEl('h2', {
      text: this.tr('healthFolderModalTitle', { label: dimLabel, n: folders.length })
    })
    contentEl.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('healthFolderModalHint')
    })

    // E3.4：仅链接维度 → 笔记列表 + 一键富化
    if (this.dimKey === 'urlOnly') {
      this.renderUrlOnlyNotes(contentEl)
    }

    const list = contentEl.createDiv({ cls: 'ima-health-folder-list' })
    if (!folders.length && this.dimKey !== 'urlOnly') {
      list.createDiv({ cls: 'ima-muted', text: this.tr('healthFolderEmpty') })
      return
    }
    if (folders.length) {
      list.createDiv({
        cls: 'ima-muted ima-compact ima-health-folder-subhead',
        text: this.tr('healthFolderListHead')
      })
    }

    for (const f of folders) {
      const row = list.createDiv({ cls: 'ima-health-folder-row' })
      const label = f.path === '(root)' ? this.tr('healthFolderRoot') : f.path
      row.createSpan({ cls: 'ima-health-folder-path', text: label })
      row.createSpan({ cls: 'ima-health-folder-count', text: String(f.count) })
      row.setAttr('role', 'button')
      row.setAttr('tabindex', '0')
      row.setAttr('title', this.tr('healthFolderOpenHint'))
      const open = () => {
        this.close()
        void this.plugin.revealHealthFolder(f.path)
      }
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    }
  }

  /**
   * @param {HTMLElement} contentEl
   */
  renderUrlOnlyNotes (contentEl) {
    const notes = listUrlOnlyNotes(this.plugin.settings.lastGovernReport)
    const block = contentEl.createDiv({ cls: 'ima-url-only-enrich' })
    block.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('enrichUrlOnlyHint', { n: notes.length })
    })
    if (!notes.length) {
      block.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('enrichUrlOnlyNeedAudit')
      })
      return
    }
    const list = block.createDiv({ cls: 'ima-url-only-list' })
    const canEnrich = canUseEnrich(this.plugin.settings)
    for (const note of notes.slice(0, 40)) {
      const row = list.createDiv({ cls: 'ima-url-only-row' })
      const pathEl = row.createSpan({ cls: 'ima-url-only-path', text: note.path })
      pathEl.setAttr('title', formatCodeList(this.plugin.settings, note.codes || []))
      pathEl.setAttr('role', 'button')
      pathEl.setAttr('tabindex', '0')
      const openNote = () => {
        const f = this.app.vault.getAbstractFileByPath(note.path)
        if (f instanceof TFile) void this.app.workspace.getLeaf(false).openFile(f)
      }
      pathEl.addEventListener('click', openNote)
      pathEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openNote()
        }
      })
      const btn = row.createEl('button', {
        text: this.tr('enrichUrlOnlyOne'),
        cls: 'ima-btn-secondary ima-btn-compact'
      })
      if (!canEnrich) {
        btn.setAttr('title', this.tr('enrichUrlOnlyPro'))
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!canUseEnrich(this.plugin.settings)) {
          new Notice(this.tr('enrichUrlOnlyPro'), 6000)
          this.plugin.openSettings('pro')
          return
        }
        this.close()
        void this.plugin.previewEnrichAtPath(note.path)
      })
    }
    if (notes.length > 40) {
      block.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('enrichUrlOnlyTruncated', { n: notes.length })
      })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = { HealthDimFolderModal }
