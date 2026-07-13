'use strict'

const { Modal } = require('obsidian')
const { t } = require('./i18n')
const {
  markApiKeyExpiryReminderShown,
  snoozeApiKeyExpiryReminder
} = require('./api-key-expiry')

class ApiKeyExpiryModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {{ settings: object, saveSettings: () => Promise<void>, openSettings: () => void }} plugin
   * @param {ReturnType<import('./api-key-expiry').getApiKeyExpiryState>} state
   */
  constructor (app, plugin, state) {
    super(app)
    this.plugin = plugin
    this.state = state
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-api-key-expiry-modal')

    const expired = this.state.level === 'expired'
    contentEl.createEl('h2', {
      text: this.tr(expired ? 'apiKeyExpiryModalTitleExpired' : 'apiKeyExpiryModalTitleSoon')
    })

    const bodyKey = expired ? 'apiKeyExpiryModalBodyShortExpired' : 'apiKeyExpiryModalBodyShortSoon'
    contentEl.createEl('p', {
      cls: 'ima-api-key-expiry-modal__body',
      text: this.tr(bodyKey, {
        date: this.state.displayDate,
        days: this.state.daysLeft ?? 0
      })
    })

    const primary = contentEl.createDiv({ cls: 'ima-api-key-expiry-modal__primary' })
    primary.createEl('button', { text: this.tr('apiKeyExpiryOpenSettings'), cls: 'mod-cta' })
      .addEventListener('click', () => {
        this.close()
        this.plugin.openSettings()
      })

    const actions = contentEl.createDiv({ cls: 'ima-api-key-expiry-modal__actions' })
    actions.createEl('button', { text: this.tr('apiKeyExpirySnoozeLater'), cls: 'ima-btn-secondary' })
      .addEventListener('click', async () => {
        snoozeApiKeyExpiryReminder(this.plugin.settings, 1)
        markApiKeyExpiryReminderShown(this.plugin.settings, this.state)
        await this.plugin.saveSettings()
        this.close()
      })

    actions.createEl('button', { text: this.tr('apiKeyExpiryDismissToday'), cls: 'ima-btn-secondary' })
      .addEventListener('click', async () => {
        markApiKeyExpiryReminderShown(this.plugin.settings, this.state)
        await this.plugin.saveSettings()
        this.close()
      })
  }

  onClose () {
    this.contentEl.empty()
  }
}

module.exports = { ApiKeyExpiryModal }
