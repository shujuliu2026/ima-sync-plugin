'use strict'

const { t } = require('./i18n')
const { manifest, siteUrl } = require('./product-config')

/**
 * @returns {string} YYYY-MM-DD（本地）
 */
function todayKey (now = Date.now()) {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

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
 * Free 叠层广告条：每个自然日一次机会；关闭后当日不再出；若同日 Toast 已占用也不再出。
 * 注意：展示中勿写 proAdToastLastDay，否则软刷新会把条误藏掉。
 * @param {object} settings
 * @param {{ now?: number }} [opts]
 * @returns {boolean}
 */
function shouldShowProAdStrip (settings, opts = {}) {
  const day = todayKey(opts.now)
  const dismissed = String(settings?.proAdStripDismissDay || '').trim()
  if (dismissed && dismissed === day) return false
  const toastDay = String(settings?.proAdToastLastDay || '').trim()
  if (toastDay && toastDay === day) return false
  return true
}

/**
 * 手动关闭叠层条（今日不再出；并占用当日广告通道，压住中间 Toast）
 * @param {object} settings
 * @param {number} [now]
 */
function markProAdStripDismissed (settings, now = Date.now()) {
  if (!settings || typeof settings !== 'object') return
  const day = todayKey(now)
  settings.proAdStripDismissDay = day
  settings.proAdToastLastDay = day
}

/**
 * 底部大卡（历史；侧栏已改叠层条，仍导出供自测/了解页复用）
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

/**
 * 日常功能键上方叠层条（absolute，不顶开 sticky）
 * @param {HTMLElement} parentEl
 * @param {{ language?: string }} settings
 * @param {{ onActivate?: () => void, onDismiss?: () => void }} [handlers]
 */
function renderProAdStrip (parentEl, settings, handlers = {}) {
  const strip = parentEl.createDiv({
    cls: 'ima-pro-ad-strip',
    attr: { role: 'region', 'aria-label': t(settings, 'proAdTitle') }
  })
  const tag = strip.createSpan({ cls: 'ima-pro-ad-strip-tag', text: t(settings, 'proAdTag') })
  tag.setAttr('aria-hidden', 'true')
  strip.createSpan({ cls: 'ima-pro-ad-strip-lead', text: t(settings, 'proAdStripLead') })

  const actions = strip.createDiv({ cls: 'ima-pro-ad-strip-actions' })
  const activateBtn = actions.createEl('button', {
    text: t(settings, 'proAdActivateBtn'),
    cls: 'mod-cta ima-pro-ad-strip-btn',
    attr: { type: 'button' }
  })
  activateBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof handlers.onActivate === 'function') handlers.onActivate()
  })

  const dismissBtn = actions.createEl('button', {
    text: '×',
    cls: 'ima-pro-ad-strip-dismiss',
    attr: {
      type: 'button',
      'aria-label': t(settings, 'proAdStripDismiss'),
      title: t(settings, 'proAdStripDismiss')
    }
  })
  dismissBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (typeof handlers.onDismiss === 'function') handlers.onDismiss()
  })

  return strip
}

module.exports = {
  todayKey,
  resolveProBenefits,
  proLearnMoreUrl,
  shouldShowProAdStrip,
  markProAdStripDismissed,
  renderProAdBlock,
  renderProAdStrip
}
