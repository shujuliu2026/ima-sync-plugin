'use strict'

const { Modal, Notice } = require('obsidian')
const { t, resolveLang } = require('./i18n')
const { buildLocalSummary, formatDiagnosticsText } = require('./telemetry-local')
const { reportFeedback } = require('./telemetry-report')

class FeedbackModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('../main')} plugin
   */
  constructor (app, plugin) {
    super(app)
    this.plugin = plugin
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-feedback-modal')

    contentEl.createEl('h2', { text: this.tr('feedbackTitle') })
    contentEl.createDiv({ cls: 'ima-muted ima-feedback-desc', text: this.tr('feedbackDesc') })

    const summary = buildLocalSummary(
      this.plugin.settings,
      this.plugin.manifest.version,
      resolveLang(this.plugin.settings),
      this.plugin.isConfigured(),
      this.app?.version
    )

    const summaryBox = contentEl.createDiv({ cls: 'ima-feedback-summary' })
    summaryBox.createDiv({ text: `${this.tr('feedbackDiagVersion')}: v${summary.pluginVersion}` })
    if (summary.obsidianVersion && summary.obsidianVersion !== 'unknown') {
      summaryBox.createDiv({ text: `Obsidian: ${summary.obsidianVersion}` })
    }
    summaryBox.createDiv({ text: `${this.tr('feedbackDiagActive')}: ${summary.activeDays}` })
    summaryBox.createDiv({
      text: `${this.tr('feedbackDiagSuccess')}: ${
        summary.successRatePct != null ? `${summary.successRatePct}%` : '—'
      }`
    })
    summaryBox.createDiv({ text: `${this.tr('feedbackDiagErrors')}: ${summary.errorSummary}` })

    const toggleRow = contentEl.createDiv({ cls: 'ima-feedback-toggle' })
    const toggle = toggleRow.createEl('input', { type: 'checkbox' })
    toggle.id = 'ima-telemetry-toggle'
    toggle.checked = !!this.plugin.settings.telemetryEnabled
    const toggleLabel = toggleRow.createEl('label', { text: this.tr('feedbackTelemetry') })
    toggleLabel.setAttr('for', 'ima-telemetry-toggle')

    contentEl.createDiv({ cls: 'ima-muted ima-feedback-hint', text: this.tr('feedbackTelemetryHint') })

    contentEl.createEl('label', { text: this.tr('feedbackTextLabel'), cls: 'ima-feedback-label' })
    const textarea = contentEl.createEl('textarea', {
      cls: 'ima-feedback-text',
      attr: { rows: '4', placeholder: this.tr('feedbackTextPlaceholder') }
    })

    const actions = contentEl.createDiv({ cls: 'ima-feedback-actions' })
    actions.createEl('button', { text: this.tr('feedbackCopy'), cls: 'ima-btn-secondary' })
      .addEventListener('click', async () => {
        const text = formatDiagnosticsText(summary, (k, v) => this.tr(k, v))
        try {
          await navigator.clipboard.writeText(text)
          new Notice(this.tr('feedbackCopied'), 2500)
        } catch {
          new Notice(text, 8000)
        }
      })

    const sendBtn = actions.createEl('button', { text: this.tr('feedbackSend'), cls: 'ima-btn-primary' })
    sendBtn.addEventListener('click', () => { void this.sendFeedback(toggle, textarea, sendBtn) })

    actions.createEl('button', { text: this.tr('feedbackCancel'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => this.close())
  }

  async sendFeedback (toggle, textarea, sendBtn) {
    sendBtn.disabled = true
    try {
      this.plugin.settings.telemetryEnabled = toggle.checked
      await this.plugin.saveData(this.plugin.settings)
      const result = await reportFeedback(this.plugin, textarea.value)
      new Notice(
        result.uploaded ? this.tr('feedbackThanks') : this.tr('feedbackThanksLocal'),
        3000
      )
      this.close()
    } catch (e) {
      new Notice(`${this.tr('feedbackSendFailed')}: ${e.message}`, 5000)
    } finally {
      sendBtn.disabled = false
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = { FeedbackModal }
