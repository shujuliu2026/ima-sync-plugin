'use strict'

const { isUrlOnlyBody } = require('./govern-rules')

/**
 * Alpha 可解析链接检测（公众号 + http(s) 网页；不含文件专线）
 * @param {string} body
 * @returns {{ kind: 'wechat'|'web', url: string, priority: number }[]}
 */
function extractEnrichUrls (body) {
  const text = String(body || '')
  /** @type {{ kind: 'wechat'|'web', url: string, priority: number }[]} */
  const out = []
  const seen = new Set()
  const re = /https?:\/\/[^\s)\]>'"<>]+/gi
  let m
  while ((m = re.exec(text)) !== null) {
    let url = m[0].replace(/[.,;:!?)]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    const lower = url.toLowerCase()
    if (lower.includes('mp.weixin.qq.com') || lower.includes('weixin.qq.com')) {
      out.push({ kind: 'wechat', url, priority: 10 })
    } else {
      out.push({ kind: 'web', url, priority: 5 })
    }
  }
  return out.sort((a, b) => b.priority - a.priority)
}

/**
 * @param {string} body
 * @param {object} [frontmatter]
 * @param {object} [settings]
 * @returns {{
 *   needsEnrich: boolean,
 *   skipReason?: string,
 *   targets: Array<{ kind: 'wechat'|'web', url: string, priority: number }>
 * }}
 */
function detectEnrichTargets (body, frontmatter, settings) {
  const fm = frontmatter || {}
  const enrich = settings?.enrich || {}
  const skipMin = Math.max(0, Number(enrich.skipMinBodyChars) || 500)

  if (String(fm.enrich || '').toLowerCase() === 'skip') {
    return { needsEnrich: false, skipReason: 'enrich_skip', targets: [] }
  }
  if (String(fm.source || '').toLowerCase() === 'ima') {
    const compact = String(body || '').replace(/\s+/g, '')
    if (compact.length >= skipMin) {
      return { needsEnrich: false, skipReason: 'source_ima', targets: [] }
    }
  }

  const targets = extractEnrichUrls(body)
  if (!targets.length) {
    return { needsEnrich: false, skipReason: 'no_url', targets: [] }
  }

  const compact = String(body || '').replace(/\s+/g, '')
  const urlOnly = isUrlOnlyBody(body, settings?.govern || enrich)
  if (compact.length >= skipMin && !urlOnly) {
    return { needsEnrich: false, skipReason: 'body_sufficient', targets }
  }

  return { needsEnrich: true, targets }
}

/** @deprecated use detectEnrichTargets(...).targets — kept for call sites expecting URL list */
function detectEnrichUrlList (body) {
  return extractEnrichUrls(body).map(({ kind, url }) => ({ kind, url }))
}

module.exports = {
  extractEnrichUrls,
  detectEnrichTargets,
  detectEnrichUrlList
}
