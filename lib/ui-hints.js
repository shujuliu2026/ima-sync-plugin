'use strict'

const { t } = require('./i18n')

/**
 * @param {object} settings
 * @param {string} tipId
 * @returns {string}
 */
function tipHoverText (settings, tipId) {
  const title = t(settings, `tip_${tipId}_title`)
  const body = t(settings, `tip_${tipId}_body`)
  if (title && body && title !== body) return `${title}\n${body}`
  return body || title || ''
}

/**
 * 在元素旁挂可点击「?」，点击弹出 Notice 说明
 * @param {HTMLElement | DocumentFragment} parent
 * @param {object} settings
 * @param {string} tipId 对应 i18n：tip_{id}_title / tip_{id}_body
 * @param {{ Notice: typeof import('obsidian').Notice }} deps
 */
function attachTip (parent, settings, tipId, deps) {
  const { Notice } = deps
  const titleKey = `tip_${tipId}_title`
  const bodyKey = `tip_${tipId}_body`
  const btn = parent.createEl('button', {
    cls: 'ima-tip',
    text: '?',
    attr: { type: 'button' }
  })
  btn.setAttr('aria-label', t(settings, titleKey))
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    new Notice(t(settings, bodyKey), 10000)
  })
  return btn
}

/**
 * 无「?」按钮：把 tip 文案挂到元素悬停提示（顶栏等紧凑区用）
 * @param {HTMLElement} el
 * @param {object} settings
 * @param {string} tipId
 * @param {{ setTooltip?: Function }} [deps]
 */
function attachHoverTip (el, settings, tipId, deps = {}) {
  if (!el) return el
  const text = tipHoverText(settings, tipId)
  if (!text) return el
  const titleOnly = t(settings, `tip_${tipId}_title`)
  if (!el.getAttribute('aria-label') && titleOnly) {
    el.setAttribute('aria-label', titleOnly)
  }
  el.setAttribute('title', text)
  const setTooltip = deps.setTooltip
  if (typeof setTooltip === 'function') {
    try {
      setTooltip(el, text.replace(/\n/g, ' · '))
    } catch { /* title fallback */ }
  } else {
    try {
      const ob = require('obsidian')
      if (typeof ob.setTooltip === 'function') {
        ob.setTooltip(el, text.replace(/\n/g, ' · '))
      }
    } catch { /* title only */ }
  }
  return el
}

/**
 * @param {object} settings
 * @param {string} nameText
 * @param {string} tipId
 * @param {typeof import('obsidian').Notice} Notice
 * @param {typeof import('obsidian').createFragment} createFragment
 */
function settingNameWithTip (settings, nameText, tipId, Notice, createFragment) {
  return createFragment((frag) => {
    frag.appendText(nameText + ' ')
    attachTip(frag, settings, tipId, { Notice })
  })
}

/**
 * 设置页：行末帮助按钮（Obsidian Setting.setName 内勿嵌 button，否则会截断后续项）
 * @param {import('obsidian').Setting} setting
 * @param {object} settings
 * @param {string} tipId
 * @param {typeof import('obsidian').Notice} Notice
 */
function applySettingTip (setting, settings, tipId, Notice) {
  setting.addExtraButton((btn) => {
    btn.setIcon('help-circle')
    btn.setTooltip(t(settings, `tip_${tipId}_title`))
    btn.onClick(() => {
      new Notice(t(settings, `tip_${tipId}_body`), 10000)
    })
  })
  return setting
}

/** 按下即时视觉反馈（pointer 态；勿等 click 后同步重建 DOM） */
function bindPressFeedback (btn) {
  const down = () => btn.addClass('is-pressed')
  const up = () => btn.removeClass('is-pressed')
  btn.addEventListener('pointerdown', down)
  btn.addEventListener('pointerup', up)
  btn.addEventListener('pointercancel', up)
  btn.addEventListener('pointerleave', up)
}

/**
 * click 先让出一帧绘制按下态，再跑可能阻塞的 handler（同步 beginSyncRun 等）
 * @param {HTMLElement} btn
 * @param {(e: Event) => void} onClick
 */
function bindSnappyClick (btn, onClick) {
  btn.addEventListener('click', (e) => {
    const run = () => {
      try {
        onClick(e)
      } catch (err) {
        console.error('[ima-sync] button handler', err)
      }
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(run)
    } else {
      setTimeout(run, 0)
    }
  })
}

function addButtonWithTip (row, settings, tipId, btnText, btnClass, onClick, deps, btnTextShort) {
  const wrap = row.createDiv({ cls: 'ima-btn-with-tip' })
  const btn = wrap.createEl('button', { attr: { type: 'button' } })
  const label = btn.createSpan({ cls: 'ima-btn-label' })
  const longText = String(btnText || '').trim()
  const shortText = String(btnTextShort || btnText || '').trim() || longText
  label.createSpan({ cls: 'ima-btn-text-long', text: longText })
  // 极窄侧栏会隐藏 long；缺短文案时用 long 兜底，避免只剩「?」空白按钮
  label.createSpan({ cls: 'ima-btn-text-short', text: shortText })
  if (btnClass) {
    for (const c of String(btnClass).split(/\s+/).filter(Boolean)) btn.addClass(c)
  }
  bindPressFeedback(btn)
  bindSnappyClick(btn, onClick)
  attachTip(wrap, settings, tipId, deps)
  return btn
}

module.exports = {
  tipHoverText,
  attachTip,
  attachHoverTip,
  settingNameWithTip,
  applySettingTip,
  addButtonWithTip,
  bindPressFeedback,
  bindSnappyClick
}
