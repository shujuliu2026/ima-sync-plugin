'use strict'

/**
 * @param {string} term
 * @returns {string[]}
 */
function buildFallbackQueries (term) {
  const out = []
  const t = String(term || '').trim()
  if (!t || t.length < 4) return out
  if (/^[\u4e00-\u9fff]+$/.test(t)) {
    for (let i = 0; i <= t.length - 2; i += 2) {
      const part = t.slice(i, i + 2)
      if (part.length >= 2 && part !== t) out.push(part)
    }
    for (let i = 0; i <= t.length - 3; i++) {
      const part = t.slice(i, i + 3)
      if (part.length >= 3 && part !== t) out.push(part)
    }
  }
  const spaced = t.split(/[\s,，、；;]+/).map(s => s.trim()).filter(s => s.length >= 2 && s !== t)
  return [...new Set([...out, ...spaced])]
}

/**
 * @param {string} title
 * @param {string} [basename]
 * @returns {string[]}
 */
function buildVerifyQueries (title, basename) {
  const primary = String(title || basename || '').replace(/\.md$/i, '').trim()
  /** @type {string[]} */
  const queries = []
  if (primary) queries.push(primary)
  for (const alt of buildFallbackQueries(primary)) {
    if (!queries.includes(alt)) queries.push(alt)
  }
  return queries
}

module.exports = { buildFallbackQueries, buildVerifyQueries }
