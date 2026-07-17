'use strict'

const { t } = require('./i18n')

/** 侧板中间 Pro 广告：每日最多一次机会，命中概率约 40% */
const SHOW_PROBABILITY = 0.4
/** 首次同步成功后再随机延迟，再打开广告 */
const DELAY_MS_MIN = 1400
const DELAY_MS_MAX = 2800

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
 * 是否应展示中间 Pro 广告（未激活 · 本日未决策 · 随机命中）
 * @param {object} settings
 * @param {{ random?: () => number, now?: number, force?: boolean }} [opts]
 * @returns {boolean}
 */
function shouldShowProAdToast (settings, opts = {}) {
  if (opts.force) return true
  const day = todayKey(opts.now)
  const last = String(settings?.proAdToastLastDay || '').trim()
  if (last && last === day) return false
  // 叠层条已关闭占用当日通道
  const stripDismissed = String(settings?.proAdStripDismissDay || '').trim()
  if (stripDismissed && stripDismissed === day) return false
  const rnd = typeof opts.random === 'function' ? opts.random() : Math.random()
  return rnd < SHOW_PROBABILITY
}

/**
 * 标记本日已决策（展示或抽中后写入，避免同日反复弹）
 * @param {object} settings
 * @param {number} [now]
 */
function markProAdToastDay (settings, now = Date.now()) {
  if (!settings || typeof settings !== 'object') return
  settings.proAdToastLastDay = todayKey(now)
}

/**
 * 首次同步后的随机延迟（ms）
 * @param {{ random?: () => number }} [opts]
 */
function resolveProAdToastDelayMs (opts = {}) {
  const rnd = typeof opts.random === 'function' ? opts.random() : Math.random()
  return Math.round(DELAY_MS_MIN + rnd * (DELAY_MS_MAX - DELAY_MS_MIN))
}

/**
 * @param {HTMLElement} el
 */
function removeToastEl (el) {
  if (!el) return
  if (typeof el.remove === 'function') el.remove()
  else if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
    el.parentNode.removeChild(el)
  }
}

/**
 * 在侧板叶节点中间渲染可关闭 Pro 广告
 * @param {HTMLElement} hostEl leaf-content 或 view-content
 * @param {{ language?: string }} settings
 * @param {{ onActivate?: () => void, onDismiss?: () => void }} [handlers]
 * @returns {HTMLElement | null}
 */
function renderProAdToast (hostEl, settings, handlers = {}) {
  if (!hostEl?.createDiv) return null
  if (typeof hostEl.querySelectorAll === 'function') {
    hostEl.querySelectorAll('.ima-pro-ad-toast').forEach((el) => removeToastEl(el))
  }

  const toast = hostEl.createDiv({
    cls: 'ima-pro-ad-toast',
    attr: { role: 'dialog', 'aria-label': t(settings, 'proAdToastTitle') }
  })
  const card = toast.createDiv({ cls: 'ima-pro-ad-toast-card' })

  const head = card.createDiv({ cls: 'ima-pro-ad-toast-head' })
  head.createEl('h3', { cls: 'ima-pro-ad-toast-title', text: t(settings, 'proAdToastTitle') })
  head.createSpan({ cls: 'ima-pro-ad-toast-tag', text: t(settings, 'proAdTag') })

  const dismiss = head.createEl('button', {
    cls: 'ima-pro-ad-toast-dismiss',
    text: '×',
    attr: {
      type: 'button',
      'aria-label': t(settings, 'proAdToastDismiss'),
      title: t(settings, 'proAdToastDismiss')
    }
  })
  dismiss.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    removeToastEl(toast)
    if (typeof handlers.onDismiss === 'function') handlers.onDismiss()
  })

  card.createDiv({ cls: 'ima-muted ima-pro-ad-toast-body', text: t(settings, 'proAdToastBody') })

  const actions = card.createDiv({ cls: 'ima-row ima-pro-ad-toast-actions' })
  const activateBtn = actions.createEl('button', {
    text: t(settings, 'proAdToastActivateBtn'),
    cls: 'mod-cta ima-pro-ad-toast-btn',
    attr: { type: 'button' }
  })
  activateBtn.addEventListener('click', (e) => {
    e.preventDefault()
    removeToastEl(toast)
    if (typeof handlers.onActivate === 'function') handlers.onActivate()
  })

  const laterBtn = actions.createEl('button', {
    text: t(settings, 'proAdToastLater'),
    cls: 'ima-btn-secondary ima-pro-ad-toast-later',
    attr: { type: 'button' }
  })
  laterBtn.addEventListener('click', (e) => {
    e.preventDefault()
    removeToastEl(toast)
    if (typeof handlers.onDismiss === 'function') handlers.onDismiss()
  })

  return toast
}

module.exports = {
  SHOW_PROBABILITY,
  DELAY_MS_MIN,
  DELAY_MS_MAX,
  todayKey,
  shouldShowProAdToast,
  markProAdToastDay,
  resolveProAdToastDelayMs,
  renderProAdToast
}
