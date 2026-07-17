'use strict'

const { t, resolveLang } = require('./i18n')
const { manifest, siteUrl } = require('./product-config')

function resolveShareUrls () {
  const d = manifest?.distribution || {}
  const downloadPath = d.downloadPath || '/downloads/ima-sync'
  const learnPath = d.learnMorePath || downloadPath || '/tools/ima-sync'
  const bratRepoUrl = String(
    d.brat?.repoUrl || (d.githubRepo ? `https://github.com/${d.githubRepo}` : '')
  ).trim()
  return {
    downloadUrl: siteUrl(downloadPath),
    learnMoreUrl: siteUrl(learnPath),
    bratRepoUrl
  }
}

/**
 * @param {{ language?: string }} settings
 * @returns {string}
 */
function buildPluginShareText (settings) {
  const urls = resolveShareUrls()
  const lang = resolveLang(settings)
  const name = lang === 'en'
    ? (manifest?.productName?.en || 'IMA Sync')
    : (manifest?.productName?.zh || 'IMA 同步')
  if (lang === 'en') {
    const lines = [
      `${name} — Obsidian → Tencent IMA`,
      '',
      `Download: ${urls.downloadUrl}`,
      `Learn more: ${urls.learnMoreUrl}`
    ]
    if (urls.bratRepoUrl) {
      lines.push('', 'BRAT (beta install): add this repo', urls.bratRepoUrl)
    }
    return lines.join('\n')
  }
  const lines = [
    `${name} · Obsidian → 腾讯 IMA`,
    '',
    `下载：${urls.downloadUrl}`,
    `了解：${urls.learnMoreUrl}`
  ]
  if (urls.bratRepoUrl) {
    lines.push('', 'BRAT 安装：添加 Beta 插件后粘贴仓库', urls.bratRepoUrl)
  }
  return lines.join('\n')
}

/**
 * @param {{ language?: string }} settings
 * @param {typeof import('obsidian').Notice} [Notice]
 */
async function copyPluginShare (settings, Notice) {
  const text = buildPluginShareText(settings)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      if (Notice) new Notice(t(settings, 'panelShareCopied'), 2500)
      return { ok: true, text }
    }
  } catch {
    /* fall through */
  }
  if (Notice) new Notice(text, 8000)
  return { ok: false, text }
}

module.exports = {
  resolveShareUrls,
  buildPluginShareText,
  copyPluginShare
}
