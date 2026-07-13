'use strict'

const { t } = require('./i18n')

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

/**
 * 侧栏：按钮 + 旁侧 ?
 * @param {HTMLElement} row
 * @param {object} settings
 * @param {string} tipId
 * @param {string} btnText
 * @param {string} [btnClass]
 * @param {() => void} onClick
 * @param {{ Notice: typeof import('obsidian').Notice }} deps
 */
function addButtonWithTip (row, settings, tipId, btnText, btnClass, onClick, deps) {
  const wrap = row.createDiv({ cls: 'ima-btn-with-tip' })
  const btn = wrap.createEl('button', { text: btnText })
  if (btnClass) btn.addClass(btnClass)
  btn.addEventListener('click', onClick)
  attachTip(wrap, settings, tipId, deps)
}

module.exports = { attachTip, settingNameWithTip, applySettingTip, addButtonWithTip }
