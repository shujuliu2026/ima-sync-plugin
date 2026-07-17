'use strict'

const { ENRICH_CODES } = require('./enrich-codes')
const { fetchEnrichHtml } = require('./enrich-fetch')
const {
  extractHtmlMeta,
  htmlToMarkdownLite,
  resolveDocument
} = require('./enrich-html')
const { normalizeEnrichFields, markImagePlaceholders } = require('./enrich-render')

/**
 * @param {string} html
 * @param {string} url
 * @param {((html: string) => Document)|null} [createDocument]
 * @returns {{ title?: string, author?: string, published?: string, content?: string }|null}
 */
function tryDefuddle (html, url, createDocument) {
  const doc = resolveDocument(html, createDocument)
  if (!doc) return null
  try {
    const Defuddle = require('defuddle')
    const parsed = new Defuddle(doc, { url: url || '' }).parse()
    if (!parsed) return null
    return {
      title: parsed.title || '',
      author: parsed.author || '',
      published: parsed.published || '',
      content: parsed.content || ''
    }
  } catch (_) {
    return null
  }
}

/**
 * Generic web enrich (D-IS-ENR-01b): requestUrl → Defuddle → meta fallback.
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   fetchHtml?: Function,
 *   createDocument?: (html: string) => Document
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   degraded?: boolean,
 *   codes: string[],
 *   fields?: object,
 *   error?: string
 * }>}
 */
async function enrichFetchWeb (url, opts = {}) {
  const source_url = String(url || '').trim()
  if (!source_url) {
    return { ok: false, codes: [ENRICH_CODES.PARSE_EMPTY], error: 'empty_url' }
  }

  const fetched = await fetchEnrichHtml(source_url, opts)
  if (!fetched.ok) {
    return {
      ok: false,
      codes: [fetched.code === 'FETCH_TIMEOUT' ? ENRICH_CODES.FETCH_TIMEOUT : ENRICH_CODES.WEB_FETCH_FAILED],
      error: fetched.code || 'WEB_FETCH_FAILED'
    }
  }

  const html = fetched.text
  const maxHtml = 2_500_000
  if (html.length > maxHtml) {
    return { ok: false, codes: [ENRICH_CODES.WEB_FETCH_FAILED], error: 'html_too_large' }
  }

  const meta = extractHtmlMeta(html)
  const def = tryDefuddle(html, source_url, opts.createDocument)
  /** @type {string[]} */
  const codes = []

  let title = ''
  let author = ''
  let published_at = ''
  let bodyHtml = ''

  if (def && (def.content || def.title)) {
    title = def.title || meta.title
    author = def.author || meta.author
    published_at = def.published || meta.published_at
    bodyHtml = def.content || ''
    codes.push(ENRICH_CODES.WEB_DEFUDDLE_OK)
  } else {
    title = meta.title
    author = meta.author
    published_at = meta.published_at
    bodyHtml = meta.description || ''
    codes.push(ENRICH_CODES.WEB_META_OK)
  }

  let body = htmlToMarkdownLite(bodyHtml)
  if (!body.trim() && meta.description) body = meta.description
  const marked = markImagePlaceholders(body, source_url)
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

  const degraded = codes.includes(ENRICH_CODES.WEB_META_OK) && !codes.includes(ENRICH_CODES.WEB_DEFUDDLE_OK)
  return {
    ok: true,
    degraded: degraded || fields.missing.includes('missing_body'),
    codes: degraded ? [...codes, ENRICH_CODES.DEGRADED] : codes,
    fields
  }
}

module.exports = { enrichFetchWeb, tryDefuddle }
