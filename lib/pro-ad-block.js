'use strict'

const { t } = require('./i18n')
const { manifest, siteUrl } = require('./product-config')

/**
 * @param {{ language?: string }} settings
 * @returns {string[]}
 */
function resolveProBenefits (settings) {
  const lang = settings?.language === 'en' ? 'en' : 'zh'
  const list = manifest?.license?.proTier?.benefits?.[lang]
  return Array.isArray(list) ? list.filter(Boolean) : []
}

/**
 * @returns {string}
 */
function proLearnMoreUrl () {
  const path =
    manifest?.distribution?.learnMorePath ||
    manifest?.distribution?.downloadPath ||
    '/tools/ima-sync'
  return siteUrl(path)
}

/**
 * @param {HTMLElement} parentEl
 * @param {{ language?: string }} settings
 * @param {{ onActivate?: () => void }} [handlers]
 */
function renderProAdBlock (parentEl, settings, handlers = {}) {
  const block = parentEl.createDiv({ cls: 'ima-pro-ad' })
  const head = block.createDiv({ cls: 'ima-pro-ad-head' })
  head.createEl('h3', { cls: 'ima-pro-ad-title', text: t(settings, 'proAdTitle') })
  head.createSpan({ cls: 'ima-pro-ad-tag', text: t(settings, 'proAdTag') })
  block.createDiv({ cls: 'ima-muted ima-pro-ad-lead', text: t(settings, 'proAdLead') })

  const benefits = resolveProBenefits(settings)
  if (benefits.length) {
    const list = block.createEl('ul', { cls: 'ima-pro-ad-benefits' })
    for (const item of benefits) {
      list.createEl('li', { text: item })
    }
  }

  const row = block.createDiv({ cls: 'ima-row ima-pro-ad-actions' })
  const activateBtn = row.createEl('button', {
    text: t(settings, 'proAdActivateBtn'),
    cls: 'mod-cta ima-pro-ad-btn'
  })
  activateBtn.addEventListener('click', () => {
    if (typeof handlers.onActivate === 'function') handlers.onActivate()
  })

  const learn = row.createEl('a', {
    cls: 'ima-pro-ad-link',
    text: t(settings, 'proAdLearnMore')
  })
  learn.href = proLearnMoreUrl()
  learn.target = '_blank'
  learn.rel = 'noopener'

  block.createDiv({ cls: 'ima-muted ima-compact ima-pro-ad-foot', text: t(settings, 'proAdFoot') })
  return block
}

module.exports = {
  resolveProBenefits,
  proLearnMoreUrl,
  renderProAdBlock
}
