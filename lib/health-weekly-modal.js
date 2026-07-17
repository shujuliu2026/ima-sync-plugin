'use strict'

const { Modal, Notice } = require('obsidian')
const { t } = require('./i18n')

/**
 * Desktop: pick a local directory via Electron dialog.
 * @param {string} [title]
 * @returns {Promise<{ ok: true, path: string } | { ok: false, reason: 'cancel'|'unavailable' }>}
 */
async function pickOsDirectory (title) {
  try {
    const req = typeof window !== 'undefined' && typeof window.require === 'function'
      ? window.require
      : typeof require === 'function'
        ? require
        : null
    if (!req) return { ok: false, reason: 'unavailable' }
    const electron = req('electron')
    const dialog = electron?.remote?.dialog || electron?.dialog
    const BrowserWindow = electron?.remote?.BrowserWindow || electron?.BrowserWindow
    if (!dialog?.showOpenDialog) return { ok: false, reason: 'unavailable' }
    const win = BrowserWindow?.getFocusedWindow?.() || undefined
    const res = await dialog.showOpenDialog(win, {
      title: title || 'Select folder',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res?.canceled) return { ok: false, reason: 'cancel' }
    const picked = res?.filePaths?.[0] || res?.[0]
    if (!picked) return { ok: false, reason: 'cancel' }
    return { ok: true, path: String(picked) }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Write UTF-8 file outside vault (desktop).
 * @param {string} dir
 * @param {string} fileName
 * @param {string} content
 * @returns {string} absolute path written
 */
function writeOsFile (dir, fileName, content) {
  const req = typeof window !== 'undefined' && typeof window.require === 'function'
    ? window.require
    : require
  const fs = req('fs')
  const path = req('path')
  const full = path.join(String(dir), String(fileName))
  fs.writeFileSync(full, String(content ?? ''), 'utf8')
  return full
}

/**
 * 库体检周报：弹窗预览 · 复制 · 保存到库内/本机文件夹
 */
class HealthWeeklyModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   * @param {{ markdown: string, fileName: string, tier: 'free'|'pro' }} data
   */
  constructor (app, plugin, data) {
    super(app)
    this.plugin = plugin
    this.settings = plugin.settings
    this.markdown = String(data?.markdown || '')
    this.fileName = String(data?.fileName || 'ima-health-weekly.md')
    this.tier = data?.tier === 'pro' ? 'pro' : 'free'
  }

  tr (key, vars) {
    return t(this.settings, key, vars)
  }

  onOpen () {
    const { contentEl, modalEl } = this
    contentEl.empty()
    contentEl.addClass('ima-health-weekly-modal')
    if (modalEl) {
      modalEl.addClass('ima-health-weekly-modal-el')
      modalEl.style.width = 'min(720px, 94vw)'
      modalEl.style.maxWidth = '720px'
    }

    const head = contentEl.createDiv({ cls: 'ima-health-weekly-head' })
    head.createEl('h2', { text: this.tr('healthWeeklyModalTitle') })
    head.createSpan({
      cls: `ima-health-weekly-tier ima-health-weekly-tier--${this.tier}`,
      text: this.tr(this.tier === 'pro' ? 'healthWeeklyTierPro' : 'healthWeeklyTierFree')
    })
    contentEl.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('healthWeeklyModalHint')
    })

    if (this.tier !== 'pro') {
      const guide = contentEl.createDiv({ cls: 'ima-health-weekly-pro-guide' })
      guide.createDiv({
        cls: 'ima-health-weekly-pro-guide-title',
        text: this.tr('healthWeeklyProGuideTitle')
      })
      guide.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('healthWeeklyProGuideBody')
      })
      const guideBtn = guide.createEl('button', {
        text: this.tr('healthWeeklyProGuideBtn'),
        cls: 'ima-btn-accent ima-btn-compact'
      })
      guideBtn.addEventListener('click', () => {
        this.close()
        this.plugin.openSettings('pro')
      })
    }

    const pre = contentEl.createEl('pre', {
      cls: 'ima-health-weekly-pre',
      text: this.markdown
    })
    pre.setAttr('tabindex', '0')

    const actions = contentEl.createDiv({ cls: 'ima-health-weekly-actions' })
    actions.createEl('button', {
      text: this.tr('healthWeeklyCopy'),
      cls: 'ima-btn-secondary'
    }).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.markdown)
        new Notice(this.tr('healthWeeklyCopied'), 2500)
      } catch (e) {
        new Notice(String(e?.message || e), 5000)
      }
    })

    actions.createEl('button', {
      text: this.tr('healthWeeklySaveVault'),
      cls: 'ima-btn-secondary'
    }).addEventListener('click', () => {
      void this.plugin.saveWeeklyHealthToVaultFolder(this.markdown, this.fileName)
    })

    actions.createEl('button', {
      text: this.tr('healthWeeklySaveOs'),
      cls: 'ima-btn-accent'
    }).addEventListener('click', () => {
      void this.plugin.saveWeeklyHealthToOsFolder(this.markdown, this.fileName)
    })

    actions.createEl('button', {
      text: this.tr('healthWeeklyClose'),
      cls: 'ima-btn-secondary'
    }).addEventListener('click', () => this.close())
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = {
  HealthWeeklyModal,
  pickOsDirectory,
  writeOsFile
}
