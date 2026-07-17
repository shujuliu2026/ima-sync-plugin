'use strict'

/**
 * Enrich Alpha 五字段 + 推送载荷骨架（D-IS-ENR-01f / 01h）
 */

/**
 * @typedef {{
 *   title: string,
 *   body: string,
 *   source_url: string,
 *   author: string,
 *   published_at: string,
 *   images_marked?: number,
 *   missing?: string[]
 * }} EnrichFields
 */

/**
 * @param {Partial<EnrichFields> & { source_url: string }} raw
 * @returns {EnrichFields}
 */
function normalizeEnrichFields (raw) {
  const source_url = String(raw?.source_url || '').trim()
  const title = String(raw?.title || '').trim()
  const body = String(raw?.body || '')
  const author = String(raw?.author || '').trim()
  const published_at = String(raw?.published_at || '').trim()
  /** @type {string[]} */
  const missing = []
  if (!title) missing.push('missing_title')
  if (!body.trim()) missing.push('missing_body')
  if (!source_url) missing.push('missing_source_url')
  if (!author) missing.push('missing_author')
  if (!published_at) missing.push('missing_published_at')
  return {
    title: title || '',
    body,
    source_url,
    author: author || '未知',
    published_at: published_at || '未知',
    images_marked: Number(raw?.images_marked) || 0,
    missing
  }
}

/**
 * Keep image positions: prefer markdown image URLs; else placeholder to source.
 * @param {string} htmlOrMd
 * @param {string} sourceUrl
 * @returns {{ body: string, images_marked: number }}
 */
function markImagePlaceholders (htmlOrMd, sourceUrl) {
  let body = String(htmlOrMd || '')
  let n = 0
  const src = String(sourceUrl || '').trim()

  // HTML <img …> — empty src still counts as a placeholder (D-IS-ENR-01h)
  body = body.replace(/<img\b[^>]*>/gi, (tag) => {
    n += 1
    const m = /\bsrc=["']([^"']*)["']/i.exec(tag)
    const url = m ? String(m[1] || '').trim() : ''
    if (url) return `![图片](${url})`
    return `![图片占位 · 见原文](${src}#img-${n})`
  })

  // Count existing markdown images
  const mdImgs = body.match(/!\[[^\]]*]\([^)]+\)/g) || []
  if (!n && mdImgs.length) n = mdImgs.length

  return { body, images_marked: n }
}

/**
 * Push payload MD skeleton — source_url row always present when known.
 * @param {Partial<EnrichFields> & { source_url: string }} fields
 * @returns {string}
 */
function renderEnrichPayloadMarkdown (fields) {
  const f = normalizeEnrichFields(fields)
  const title = f.title || '未命名'
  const lines = [
    `# ${title}`,
    '',
    `- 原文：${f.source_url || '未知'}`,
    `- 作者：${f.author}`,
    `- 发布时间：${f.published_at}`,
    '',
    '---',
    '',
    f.body.trim() || '',
    ''
  ]
  return lines.join('\n')
}

module.exports = {
  normalizeEnrichFields,
  markImagePlaceholders,
  renderEnrichPayloadMarkdown
}
