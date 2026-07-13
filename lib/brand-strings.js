'use strict'

/**
 * 从 product-manifest 生成 i18n 品牌文案覆盖（白标 / 独立产品）。
 * @see docs/design/ima-sync-product/02-逐步剥离路线图.md §Phase 1
 */

/**
 * @param {object} manifest
 * @param {'zh'|'en'} lang
 */
function brandName (manifest, lang) {
  return manifest.brand?.name?.[lang] ||
    manifest.brand?.name?.zh ||
    manifest.brand?.name?.en ||
    'Brand'
}

/**
 * @param {object} manifest product-manifest.json
 * @returns {{ zh: Record<string, string>, en: Record<string, string> }}
 */
function buildBrandOverrides (manifest) {
  const holder = manifest.brand?.copyrightHolder || 'Author'
  const authorName = manifest.brand?.authorName || holder
  const year = manifest.brand?.copyrightYear || new Date().getFullYear()
  const host = manifest.brand?.siteHost || 'example.com'
  const wechat = manifest.brand?.wechatAccount || ''
  const email = manifest.brand?.authorEmail || ''
  const nameZh = brandName(manifest, 'zh')
  const nameEn = brandName(manifest, 'en')
  const siteTitleZh = manifest.brand?.siteTitle?.zh || `${nameZh} · ${host}`
  const siteTitleEn = manifest.brand?.siteTitle?.en || `${nameEn} · ${host}`
  const aboutDescZh = manifest.brand?.aboutDesc?.zh || ''
  const aboutDescEn = manifest.brand?.aboutDesc?.en || aboutDescZh

  const followZh = wechat ? `关注公众号：${wechat}  获取最新版本` : ''
  const followEn = wechat ? `Follow WeChat: ${wechat} for latest version` : ''

  const productZh = manifest.productName?.zh || 'IMA 同步'
  const productEn = manifest.productName?.en || 'IMA Sync'

  return {
    zh: {
      pluginName: productZh,
      ribbon: productZh,
      settingsTitle: productZh,
      authorName,
      authorFollowHint: followZh,
      aboutAuthor: followZh ? `作者 ${authorName} · ${followZh}` : `作者 ${authorName}`,
      aboutEmail: email,
      aboutSite: siteTitleZh,
      aboutDesc: aboutDescZh,
      sponsorQrAlt: `支付宝「${nameZh}」打赏二维码`,
      sponsorAlipayHint: `支付宝扫码 · ${nameZh}`,
      sponsorQrFallbackBrand: nameZh,
      copyrightNotice: `© ${year} ${holder}（${nameZh} · ${host}）。保留所有权利。`,
      copyrightShort: `© ${holder} · ${nameZh} · 保留所有权利`,
      pickKbFromImaHint: `请点选要推送的目标库（名称如「${nameZh}」，ID 为 IMA 返回的约 20 位字符）`,
      kbLabelPlaceholder: `可选，例如：${nameZh}`
    },
    en: {
      pluginName: productEn,
      ribbon: productEn,
      settingsTitle: productEn,
      authorName,
      authorFollowHint: followEn,
      aboutAuthor: followEn ? `Author: ${authorName} · ${followEn}` : `Author: ${authorName}`,
      aboutEmail: email,
      aboutSite: siteTitleEn,
      aboutDesc: aboutDescEn,
      sponsorQrAlt: `Alipay QR code for ${nameEn}`,
      sponsorAlipayHint: `Alipay · ${nameEn}`,
      sponsorQrFallbackBrand: nameEn,
      copyrightNotice: `© ${year} ${holder} (${nameEn} · ${host}). All rights reserved.`,
      copyrightShort: `© ${holder} · ${nameEn} · All rights reserved`,
      pickKbFromImaHint: `Pick target KB (name like "${nameEn}", ID is ~20 chars from IMA)`,
      kbLabelPlaceholder: `Optional label, e.g. ${nameEn}`
    }
  }
}

/**
 * @param {typeof import('./i18n').STR} strTable
 * @param {object} manifest
 */
function applyBrandStrings (strTable, manifest) {
  const overrides = buildBrandOverrides(manifest)
  for (const lang of ['zh', 'en']) {
    for (const [key, val] of Object.entries(overrides[lang])) {
      if (val !== undefined) strTable[lang][key] = val
    }
  }
  return strTable
}

module.exports = { brandName, buildBrandOverrides, applyBrandStrings }
