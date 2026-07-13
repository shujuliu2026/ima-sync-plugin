'use strict'

const { t } = require('./i18n')
const { fetchVerifiedSponsorQr } = require('./sponsor-qr')
const { brandSiteUrl } = require('./product-config')

/**
 * @param {HTMLImageElement} img
 */
function revokeSponsorObjectUrl (img) {
  const prev = img?.dataset?.imaBlobUrl
  if (prev) {
    URL.revokeObjectURL(prev)
    delete img.dataset.imaBlobUrl
  }
}

/**
 * @param {HTMLImageElement} img
 * @param {ArrayBuffer} buf
 */
function showSponsorQrImage (img, buf) {
  revokeSponsorObjectUrl(img)
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'image/png' }))
  img.dataset.imaBlobUrl = blobUrl
  img.classList.remove('ima-sponsor-qr--loading')
  img.src = blobUrl
}

/**
 * 校验失败或离线：不展示任何二维码，仅显示官网链接。
 * @param {HTMLElement} imgWrap
 * @param {{ language?: string }} settings
 */
function showSponsorFallback (imgWrap, settings) {
  const img = imgWrap.querySelector('img.ima-sponsor-qr')
  if (img) revokeSponsorObjectUrl(img)
  imgWrap.empty()
  const fallback = imgWrap.createDiv({ cls: 'ima-sponsor-qr-fallback' })
  fallback.createDiv({
    cls: 'ima-sponsor-qr-fallback-hint',
    text: t(settings, 'sponsorQrFallbackHint')
  })
  const link = fallback.createEl('a', {
    cls: 'ima-sponsor-qr-fallback-link',
    text: t(settings, 'sponsorQrFallbackBrand')
  })
  link.href = brandSiteUrl
  link.target = '_blank'
  link.rel = 'noopener'
}

/**
 * @param {HTMLElement} parentEl
 * @param {{ language?: string }} settings
 * @param {{ app?: import('obsidian').App, pluginDir?: string }} deps
 */
function renderSponsorBlock (parentEl, settings, deps = {}) {
  const block = parentEl.createDiv({ cls: 'ima-sponsor', attr: { id: 'ima-sponsor' } })
  block.createEl('h4', { cls: 'ima-sponsor-title', text: t(settings, 'sponsorTitle') })
  block.createDiv({ cls: 'ima-muted ima-sponsor-desc', text: t(settings, 'sponsorDesc') })

  const imgWrap = block.createDiv({ cls: 'ima-sponsor-qr-wrap' })
  const img = imgWrap.createEl('img', {
    cls: 'ima-sponsor-qr ima-sponsor-qr--loading',
    attr: { alt: t(settings, 'sponsorQrAlt') }
  })

  void (async () => {
    const result = await fetchVerifiedSponsorQr()
    if (result.ok && result.buffer) {
      showSponsorQrImage(img, result.buffer)
      return
    }
    showSponsorFallback(imgWrap, settings)
  })()

  block.createDiv({ cls: 'ima-muted ima-sponsor-hint', text: t(settings, 'sponsorAlipayHint') })
  return block
}

module.exports = { renderSponsorBlock, showSponsorQrImage, showSponsorFallback, revokeSponsorObjectUrl }
