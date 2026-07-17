'use strict'

/**
 * Shared HTML helpers for Enrich (meta/og · entity decode · tag strip)
 */

function decodeBasicEntities (s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = parseInt(d, 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
}

/**
 * @param {string} html
 * @param {string} prop
 * @returns {string}
 */
function metaContent (html, prop) {
  const h = String(html || '')
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']` +
      `|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i'
  )
  const m = re.exec(h)
  return decodeBasicEntities((m && (m[1] || m[2])) || '').trim()
}

/**
 * @param {string} html
 * @returns {{ title: string, author: string, published_at: string, description: string }}
 */
function extractHtmlMeta (html) {
  const h = String(html || '')
  let title =
    metaContent(h, 'og:title') ||
    metaContent(h, 'twitter:title') ||
    ''
  if (!title) {
    const tm = /<title[^>]*>([^<]*)<\/title>/i.exec(h)
    title = decodeBasicEntities(tm ? tm[1] : '').trim()
  }
  const author =
    metaContent(h, 'author') ||
    metaContent(h, 'article:author') ||
    metaContent(h, 'og:article:author') ||
    ''
  const published_at =
    metaContent(h, 'article:published_time') ||
    metaContent(h, 'og:published_time') ||
    metaContent(h, 'publish_date') ||
    ''
  const description =
    metaContent(h, 'og:description') ||
    metaContent(h, 'description') ||
    metaContent(h, 'twitter:description') ||
    ''
  return { title, author, published_at, description }
}

/**
 * Decode \\xNN / \\uNNNN sequences common in WeChat inline JS.
 * @param {string} s
 */
function decodeJsStringEscapes (s) {
  return String(s || '')
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * @param {string} html
 * @param {string} name  e.g. msg_title
 * @returns {string}
 */
function extractJsVar (html, name) {
  const h = String(html || '')
  const re = new RegExp(
    `(?:var\\s+|window\\.)?${name}\\s*=\\s*(?:htmlDecode\\()?["']([^"']*)["']`,
    'i'
  )
  const m = re.exec(h)
  if (!m) return ''
  return decodeBasicEntities(decodeJsStringEscapes(m[1])).trim()
}

/**
 * @param {string} html
 * @returns {{
 *   title: string,
 *   author: string,
 *   published_at: string,
 *   description: string,
 *   contentHtml: string,
 *   paywall: boolean
 * }}
 */
function extractWechatFields (html) {
  const h = String(html || '')
  const paywall =
    /付费阅读|付费后可查看|subscribe_bar|js_pay_bar|付费全文/i.test(h) &&
    !/#js_content[\s\S]{80,}/i.test(h)

  const title =
    extractJsVar(h, 'msg_title') ||
    metaContent(h, 'og:title') ||
    ''
  const author =
    extractJsVar(h, 'nickname') ||
    extractJsVar(h, 'author') ||
    metaContent(h, 'author') ||
    ''
  const published_at =
    extractJsVar(h, 'ct') ||
    extractJsVar(h, 'create_time') ||
    (() => {
      const m = /id="publish_time"[^>]*>([^<]+)</i.exec(h) ||
        /id="publish_time"[^>]*data-time=["']?(\d+)/i.exec(h)
      if (!m) return ''
      const raw = String(m[1] || '').trim()
      if (/^\d{10}$/.test(raw)) {
        return new Date(Number(raw) * 1000).toISOString().slice(0, 10)
      }
      return raw
    })()
  const description =
    extractJsVar(h, 'msg_desc') ||
    metaContent(h, 'og:description') ||
    ''

  let contentHtml = ''
  const jsContent = /id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i.exec(h)
  if (jsContent) contentHtml = jsContent[1]
  if (!contentHtml) {
    const rich = /id=["']js_content["'][^>]*style=["'][^"']*visibility:\s*hidden[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(h)
    if (rich) contentHtml = rich[1]
  }
  // data-src → src for placeholders
  contentHtml = String(contentHtml || '').replace(/\bdata-src=/gi, 'src=')

  return { title, author, published_at, description, contentHtml, paywall }
}

/**
 * Lightweight HTML → markdown-ish text (no turndown).
 * @param {string} html
 * @returns {string}
 */
function htmlToMarkdownLite (html) {
  let s = String(html || '')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n) => `${'#'.repeat(Math.min(6, Number(n) || 1))} `)
  s = s.replace(/<img\b[^>]*>/gi, (tag) => tag) // keep for markImagePlaceholders
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = decodeBasicEntities(String(text).replace(/<[^>]+>/g, '')).trim()
    return t ? `[${t}](${href})` : href
  })
  s = s.replace(/<(strong|b)\b[^>]*>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
  s = s.replace(/<(em)\b[^>]*>/gi, '_').replace(/<\/(em)>/gi, '_')
  // Avoid matching <img — use \bi\b only for italic tags
  s = s.replace(/<(i)\b[^>]*>/gi, '_').replace(/<\/(i)>/gi, '_')
  // Strip remaining tags except img (handled later)
  s = s.replace(/<(?!\/?img\b)[^>]+>/gi, '')
  s = decodeBasicEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

/**
 * Create a Document for Defuddle. Obsidian: DOMParser; Node selftest: inject createDocument.
 * @param {string} html
 * @param {((html: string) => Document)|null} [createDocument]
 * @returns {Document|null}
 */
function resolveDocument (html, createDocument) {
  if (typeof createDocument === 'function') {
    try {
      return createDocument(html)
    } catch (_) {
      return null
    }
  }
  if (typeof globalThis.DOMParser === 'function') {
    try {
      return new globalThis.DOMParser().parseFromString(String(html || ''), 'text/html')
    } catch (_) {
      return null
    }
  }
  return null
}

module.exports = {
  decodeBasicEntities,
  metaContent,
  extractHtmlMeta,
  extractJsVar,
  extractWechatFields,
  htmlToMarkdownLite,
  resolveDocument
}
