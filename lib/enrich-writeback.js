'use strict'

const { computeContentHash, parseNoteFile } = require('./utils')

/** 磁盘写中文键；读时兼容英文旧键 */
const ENRICH_FM = {
  sourceUrl: { zh: '解析来源', en: 'enrich_source_url' },
  contentHash: { zh: '解析指纹', en: 'enrich_content_hash' },
  status: { zh: '解析状态', en: 'enrich_status' },
  merged: { zh: '解析合并', en: 'enrich_merged' },
  sourceUrls: { zh: '原文链接列表', en: 'enrich_source_urls' }
}

const ENRICH_STATUS_ZH = '已解析'
const ENRICH_STATUS_EN = 'enriched'

/**
 * Strip common tracking params for dedupe key.
 * @param {string} url
 * @returns {string}
 */
function normalizeEnrichSourceUrl (url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw)
    u.hash = ''
    const drop = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'from', 'scene', 'wd', 'exportkey', 'mpshare', 'srcid'
    ])
    for (const key of [...u.searchParams.keys()]) {
      if (drop.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        u.searchParams.delete(key)
      }
    }
    return u.toString()
  } catch (_) {
    return raw.replace(/[?#].*$/, '')
  }
}

/**
 * @param {string} title
 * @param {string} [sourceUrl]
 * @returns {string} basename without .md
 */
function safeEnrichBasename (title, sourceUrl) {
  let base = String(title || '').trim() || '未命名解析'
  base = base
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (!base) base = '未命名解析'
  const norm = normalizeEnrichSourceUrl(sourceUrl || '')
  if (norm) {
    const hash = computeContentHash(norm).slice(0, 4)
    return `${base}-${hash}`
  }
  return base
}

/**
 * @param {string} payloadMarkdown
 * @param {{ sourceUrl: string, contentHash?: string }} meta
 * @returns {string}
 */
function buildEnrichNoteRaw (payloadMarkdown, meta) {
  const sourceUrl = normalizeEnrichSourceUrl(meta.sourceUrl || '')
  const body = String(payloadMarkdown || '').trim()
  const hash = meta.contentHash || computeContentHash(body)
  const fm = [
    '---',
    `${ENRICH_FM.sourceUrl.zh}: "${sourceUrl.replace(/"/g, '\\"')}"`,
    `${ENRICH_FM.contentHash.zh}: "${hash}"`,
    `${ENRICH_FM.status.zh}: ${ENRICH_STATUS_ZH}`,
    '---',
    '',
    body,
    ''
  ]
  return fm.join('\n')
}

/**
 * @param {Array<{ sourceUrl: string, payload: string, title?: string }>} items
 * @returns {string}
 */
function buildMergedEnrichNoteRaw (items) {
  const list = Array.isArray(items) ? items : []
  const parts = []
  /** @type {string[]} */
  const urls = []
  for (const it of list) {
    const url = normalizeEnrichSourceUrl(it.sourceUrl || '')
    if (url) urls.push(url)
    parts.push(String(it.payload || '').trim())
  }
  const body = parts.filter(Boolean).join('\n\n---\n\n')
  const hash = computeContentHash(body)
  const fm = [
    '---',
    `${ENRICH_FM.merged.zh}: true`,
    `${ENRICH_FM.sourceUrls.zh}: ${JSON.stringify(urls)}`,
    `${ENRICH_FM.contentHash.zh}: "${hash}"`,
    `${ENRICH_FM.status.zh}: ${ENRICH_STATUS_ZH}`,
    '---',
    '',
    body,
    ''
  ]
  return fm.join('\n')
}

/**
 * @param {Record<string, unknown>|undefined} frontmatter
 * @returns {string}
 */
function pickEnrichSourceUrl (frontmatter) {
  const fm = frontmatter || {}
  return normalizeEnrichSourceUrl(String(
    fm[ENRICH_FM.sourceUrl.zh] ||
    fm[ENRICH_FM.sourceUrl.en] ||
    fm.enrich_source ||
    ''
  ))
}

/**
 * @param {Record<string, unknown>|undefined} frontmatter
 * @returns {string}
 */
function pickEnrichContentHash (frontmatter) {
  const fm = frontmatter || {}
  return String(
    fm[ENRICH_FM.contentHash.zh] ||
    fm[ENRICH_FM.contentHash.en] ||
    ''
  ).trim()
}

/**
 * Read enrich source url from note raw (fm or 原文 line).
 * @param {string} raw
 * @returns {string}
 */
function readEnrichSourceUrlFromRaw (raw) {
  const { frontmatter, body } = parseNoteFile(raw)
  const fromFm = pickEnrichSourceUrl(frontmatter)
  if (fromFm) return fromFm
  const m = String(body || '').match(/^-+\s*原文[：:]\s*(\S+)/m) ||
    String(body || '').match(/^-\s*原文[：:]\s*(\S+)/m)
  return normalizeEnrichSourceUrl(m ? m[1] : '')
}

/**
 * @param {string} raw
 * @returns {string}
 */
function readEnrichContentHashFromRaw (raw) {
  const { frontmatter } = parseNoteFile(raw)
  return pickEnrichContentHash(frontmatter)
}

/**
 * @param {import('obsidian').App} app
 * @param {string} folderPath vault-relative folder ('' = root)
 * @returns {Promise<Map<string, { path: string, hash: string }>>}
 */
async function indexEnrichNotesInFolder (app, folderPath) {
  /** @type {Map<string, { path: string, hash: string }>} */
  const map = new Map()
  const folder = String(folderPath || '').replace(/^\/+|\/+$/g, '')
  const files = app.vault.getMarkdownFiles().filter((f) => {
    if (!folder) return !f.path.includes('/')
    return f.path === `${folder}/${f.name}` || f.path.startsWith(`${folder}/`)
  })
  for (const file of files) {
    try {
      const raw = await app.vault.read(file)
      const url = readEnrichSourceUrlFromRaw(raw)
      if (!url) continue
      map.set(url, {
        path: file.path,
        hash: readEnrichContentHashFromRaw(raw)
      })
    } catch (_) { /* skip */ }
  }
  return map
}

/**
 * Plan split writes without overwriting same source_url.
 * @param {Array<{ sourceUrl: string, payload: string, title?: string }>} items
 * @param {Map<string, { path: string, hash: string }>} index
 * @returns {Array<{
 *   action: 'create'|'skip'|'skip_same_hash',
 *   sourceUrl: string,
 *   basename: string,
 *   existingPath?: string,
 *   raw?: string
 * }>}
 */
function planSplitWriteActions (items, index) {
  const idx = index || new Map()
  /** @type {ReturnType<typeof planSplitWriteActions>} */
  const out = []
  for (const it of items || []) {
    const sourceUrl = normalizeEnrichSourceUrl(it.sourceUrl || '')
    const payload = String(it.payload || '').trim()
    const hash = computeContentHash(payload)
    const title = it.title || (payload.match(/^#\s+(.+)$/m) || [])[1] || ''
    const basename = safeEnrichBasename(title, sourceUrl)
    const hit = sourceUrl ? idx.get(sourceUrl) : null
    if (hit) {
      out.push({
        action: hit.hash && hit.hash === hash ? 'skip_same_hash' : 'skip',
        sourceUrl,
        basename,
        existingPath: hit.path
      })
      continue
    }
    out.push({
      action: 'create',
      sourceUrl,
      basename,
      raw: buildEnrichNoteRaw(payload, { sourceUrl, contentHash: hash })
    })
  }
  return out
}

module.exports = {
  normalizeEnrichSourceUrl,
  safeEnrichBasename,
  buildEnrichNoteRaw,
  buildMergedEnrichNoteRaw,
  readEnrichSourceUrlFromRaw,
  readEnrichContentHashFromRaw,
  indexEnrichNotesInFolder,
  planSplitWriteActions,
  computeContentHash,
  ENRICH_FM,
  ENRICH_STATUS_ZH,
  ENRICH_STATUS_EN
}
