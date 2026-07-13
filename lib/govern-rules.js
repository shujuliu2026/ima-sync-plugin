'use strict'

/** @typedef {'ok'|'low'|'medium'|'high'} GovernRisk */

const CODE_SEVERITY = {
  MISSING_TITLE: 'high',
  BODY_TOO_LONG: 'medium',
  ALREADY_VERIFY_FAILED: 'medium',
  MISSING_IMPORT_KEY: 'low',
  TITLE_EQUALS_BASENAME: 'low',
  TITLE_TOO_SHORT: 'medium',
  SENSITIVE_PATTERN: 'high'
}

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

  if (String(body || '').length > maxBody) codes.push('BODY_TOO_LONG')

  if (!String(frontmatter?.import_key || '').trim()) codes.push('MISSING_IMPORT_KEY')

  if (frontmatter?.sync?.ima_verify === 'failed') codes.push('ALREADY_VERIFY_FAILED')

  const sensitive = Array.isArray(govern.sensitivePatterns) ? govern.sensitivePatterns : []
  for (const raw of sensitive) {
    const pat = String(raw || '').trim()
    if (!pat) continue
    try {
      if (new RegExp(pat, 'i').test(`${t}\n${body.slice(0, 2000)}`)) {
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
 * @param {Array<{ path: string, basename: string, title: string, body: string, frontmatter: object }>} notes
 * @param {object} settings
 */
function auditNotes (notes, settings) {
  const items = (notes || []).map(n => evaluateNoteRules({ ...n, settings }))
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
  aggregateRisk,
  evaluateNoteRules,
  auditNotes
}
