'use strict'

const { ENRICH_CODES } = require('./enrich-codes')
const { fetchEnrichHtml } = require('./enrich-fetch')
const { extractWechatFields, extractHtmlMeta, htmlToMarkdownLite } = require('./enrich-html')
const { normalizeEnrichFields, markImagePlaceholders } = require('./enrich-render')

/**
 * WeChat article enrich (D-IS-ENR-01a): T1 static HTML → T4 meta fallback.
 * T3 BrowserWindow deferred (desktopEnhancement hook later).
 *
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   fetchHtml?: Function,
 *   desktopEnhancement?: boolean
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   degraded?: boolean,
 *   codes: string[],
 *   fields?: object,
 *   error?: string
 * }>}
 */
async function enrichFetchWechat (url, opts = {}) {
  const source_url = String(url || '').trim()
  if (!source_url) {
    return { ok: false, codes: [ENRICH_CODES.PARSE_EMPTY], error: 'empty_url' }
  }

  const fetched = await fetchEnrichHtml(source_url, {
    ...opts,
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      ...(opts.headers || {})
    }
  })
  if (!fetched.ok) {
    return {
      ok: false,
      codes: [fetched.code === 'FETCH_TIMEOUT' ? ENRICH_CODES.FETCH_TIMEOUT : ENRICH_CODES.WEB_FETCH_FAILED],
      error: fetched.code || 'WEB_FETCH_FAILED'
    }
  }

  const html = fetched.text
  const wx = extractWechatFields(html)
  if (wx.paywall) {
    const meta = extractHtmlMeta(html)
    const fields = normalizeEnrichFields({
      source_url,
      title: wx.title || meta.title,
      body: wx.description || meta.description || '',
      author: wx.author || meta.author,
      published_at: wx.published_at || meta.published_at
    })
    return {
      ok: false,
      degraded: true,
      codes: [ENRICH_CODES.WECHAT_PAYWALL, ENRICH_CODES.DEGRADED],
      fields,
      error: 'WECHAT_PAYWALL'
    }
  }

  /** @type {string[]} */
  const codes = []
  let title = wx.title
  let author = wx.author
  let published_at = wx.published_at
  let bodyMd = ''

  if (wx.contentHtml && wx.contentHtml.replace(/<[^>]+>/g, '').trim().length >= 20) {
    bodyMd = htmlToMarkdownLite(wx.contentHtml)
    codes.push(ENRICH_CODES.WECHAT_T1_OK)
  } else {
    const meta = extractHtmlMeta(html)
    title = title || meta.title
    author = author || meta.author
    published_at = published_at || meta.published_at
    bodyMd = wx.description || meta.description || ''
    codes.push(ENRICH_CODES.WECHAT_T4_META, ENRICH_CODES.DEGRADED)
  }

  const marked = markImagePlaceholders(bodyMd, source_url)
  const fields = normalizeEnrichFields({
    source_url,
    title,
    body: marked.body,
    author,
    published_at,
    images_marked: marked.images_marked
  })

  if (!fields.body.trim() && !fields.title) {
    return { ok: false, codes: [...codes, ENRICH_CODES.PARSE_EMPTY], error: 'PARSE_EMPTY' }
  }

  const degraded = codes.includes(ENRICH_CODES.WECHAT_T4_META) || fields.missing.includes('missing_body')
  return {
    ok: true,
    degraded,
    codes,
    fields
  }
}

module.exports = { enrichFetchWechat }
