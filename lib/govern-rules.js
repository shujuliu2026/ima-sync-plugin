'use strict'

/** @typedef {'ok'|'low'|'medium'|'high'} GovernRisk */

const CODE_SEVERITY = {
  MISSING_TITLE: 'high',
  BODY_TOO_LONG: 'medium',
  BODY_TOO_SHORT: 'medium',
  DUPLICATE_TITLE: 'medium',
  URL_ONLY_BODY: 'medium',
  ALREADY_VERIFY_FAILED: 'medium',
  MISSING_IMPORT_KEY: 'low',
  TITLE_EQUALS_BASENAME: 'low',
  TITLE_TOO_SHORT: 'medium',
  SENSITIVE_PATTERN: 'high',
  OBSIDIAN_SYNTAX: 'low'
}

const URL_RE = /https?:\/\/[^\s)\]>'"]+/gi

/**
 * @param {string[]} codes
 * @returns {GovernRisk}
 */
function aggregateRisk (codes) {
  if (!codes.length) return 'ok'
  let max = 0
  const rank = { ok: 0, low: 1, medium: 2, high: 3 }
  for (const c of codes) {
    const sev = CODE_SEVERITY[c] || 'low'
    max = Math.max(max, rank[sev] || 1)
  }
  if (max >= 3) return 'high'
  if (max >= 2) return 'medium'
  return 'low'
}

/**
 * @param {string} body
 * @param {object} [govern]
 */
function isUrlOnlyBody (body, govern) {
  const text = String(body || '').trim()
  if (!text) return false
  const urls = text.match(URL_RE) || []
  if (!urls.length) return false
  const residual = text.replace(URL_RE, '').replace(/\s+/g, '')
  const maxResidual = Math.max(0, Number(govern?.urlOnlyMaxResidualChars) || 40)
  return residual.length <= maxResidual
}

/**
 * @param {string} body
 * @param {object} [govern]
 */
function isBodyTooShort (body, govern) {
  const minBody = Math.max(1, Number(govern?.minBodyChars) || 80)
  const compact = String(body || '').replace(/\s+/g, '')
  return compact.length < minBody
}

/**
 * @param {string} title
 */
function normalizeTitleKey (title) {
  return String(title || '').trim().toLowerCase()
}

/**
 * @param {object} ctx
 * @param {string} ctx.path
 * @param {string} ctx.basename
 * @param {string} ctx.title
 * @param {string} ctx.body
 * @param {object} ctx.frontmatter
 * @param {object} [ctx.settings]
 */
function evaluateNoteRules (ctx) {
  const { path, basename, title, body, frontmatter, settings } = ctx
  const govern = settings?.govern || {}
  const maxBody = Math.max(1000, Number(govern.maxBodyChars) || 12000)
  const minTitle = Math.max(2, Number(govern.minTitleChars) || 4)
  /** @type {string[]} */
  const codes = []

  const t = String(title || '').trim()
  const base = String(basename || '').replace(/\.md$/i, '').trim()

  if (!t) codes.push('MISSING_TITLE')
  else if (t.length < minTitle) codes.push('TITLE_TOO_SHORT')
  else if (base && t === base) codes.push('TITLE_EQUALS_BASENAME')

  const bodyText = String(body || '')
  if (bodyText.length > maxBody) codes.push('BODY_TOO_LONG')
  if (isBodyTooShort(bodyText, govern)) codes.push('BODY_TOO_SHORT')
  if (isUrlOnlyBody(bodyText, govern)) codes.push('URL_ONLY_BODY')

  if (!String(frontmatter?.import_key || '').trim()) codes.push('MISSING_IMPORT_KEY')

  if (frontmatter?.sync?.ima_verify === 'failed') codes.push('ALREADY_VERIFY_FAILED')

  if (/(\[\[[^\]]+\]\]|==[^=\n]+==|>\s*\[!\w+\])/.test(bodyText)) {
    codes.push('OBSIDIAN_SYNTAX')
  }

  const sensitive = Array.isArray(govern.sensitivePatterns) ? govern.sensitivePatterns : []
  for (const raw of sensitive) {
    const pat = String(raw || '').trim()
    if (!pat) continue
    try {
      if (new RegExp(pat, 'i').test(`${t}\n${bodyText.slice(0, 2000)}`)) {
        codes.push('SENSITIVE_PATTERN')
        break
      }
    } catch {
      // invalid regex — skip
    }
  }

  return {
    path,
    title: t || base,
    codes,
    risk: aggregateRisk(codes)
  }
}

/**
 * Second pass: mark DUPLICATE_TITLE for titles appearing ≥2 times in scope.
 * @param {Array<{ path: string, title: string, codes: string[], risk: GovernRisk }>} items
 */
function annotateDuplicateTitles (items) {
  /** @type {Map<string, string[]>} */
  const byTitle = new Map()
  for (const it of items) {
    const key = normalizeTitleKey(it.title)
    if (!key) continue
    if (!byTitle.has(key)) byTitle.set(key, [])
    byTitle.get(key).push(it.path)
  }
  const dupPaths = new Set()
  for (const paths of byTitle.values()) {
    if (paths.length >= 2) {
      for (const p of paths) dupPaths.add(p)
    }
  }
  for (const it of items) {
    if (!dupPaths.has(it.path)) continue
    if (!it.codes.includes('DUPLICATE_TITLE')) it.codes.push('DUPLICATE_TITLE')
    it.risk = aggregateRisk(it.codes)
  }
  return items
}

/**
 * @param {Array<{ path: string, basename: string, title: string, body: string, frontmatter: object }>} notes
 * @param {object} settings
 */
function auditNotes (notes, settings) {
  const items = annotateDuplicateTitles(
    (notes || []).map(n => evaluateNoteRules({ ...n, settings }))
  )
  const counts = { ok: 0, low: 0, medium: 0, high: 0 }
  for (const it of items) {
    counts[it.risk] = (counts[it.risk] || 0) + 1
  }
  return {
    auditedAt: new Date().toISOString(),
    total: items.length,
    counts,
    highRisk: items.filter(i => i.risk === 'high').length,
    items
  }
}

module.exports = {
  CODE_SEVERITY,
  URL_RE,
  aggregateRisk,
  isUrlOnlyBody,
  isBodyTooShort,
  normalizeTitleKey,
  evaluateNoteRules,
  annotateDuplicateTitles,
  auditNotes
}
