'use strict'

const { t } = require('./i18n')

/**
 * @param {HTMLElement} parentEl
 * @param {{ language?: string }} settings
 * @param {{ compact?: boolean }} [opts]
 */
function renderCopyrightBlock (parentEl, settings, opts = {}) {
  const block = parentEl.createDiv({ cls: 'ima-copyright' })
  if (!opts.compact) {
    block.createEl('h4', { cls: 'ima-copyright-title', text: t(settings, 'copyrightTitle') })
  }
  block.createDiv({ cls: 'ima-copyright-notice', text: t(settings, 'copyrightNotice') })
  if (!opts.compact) {
    block.createDiv({ cls: 'ima-muted ima-copyright-detail', text: t(settings, 'copyrightDetail') })
    block.createDiv({ cls: 'ima-muted ima-copyright-free', text: t(settings, 'copyrightFreeNote') })
  }
  return block
}

module.exports = { renderCopyrightBlock }
