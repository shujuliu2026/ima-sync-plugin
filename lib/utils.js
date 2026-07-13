'use strict'

/** @param {string} text */
function chunkText (text, opts = {}) {
  const size = opts.size ?? 1500
  const overlap = opts.overlap ?? 200
  const src = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!src) return []
  if (src.length <= size) return [src]

  const chunks = []
  let start = 0
  while (start < src.length) {
    let end = Math.min(start + size, src.length)
    if (end < src.length) {
      const slice = src.slice(start, end)
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('。'))
      if (breakAt > size * 0.4) end = start + breakAt + 1
    }
    chunks.push(src.slice(start, end).trim())
    if (end >= src.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks.filter(Boolean)
}

/** @param {string} body */
function computeContentHash (body) {
  const normalized = String(body).replace(/\r\n/g, '\n').trim()
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** @param {string} raw */
function parseNoteFile (raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) {
    return { frontmatter: {}, body: text.trim(), rawFrontmatter: '' }
  }
  return {
    frontmatter: parseSimpleYaml(m[1].trim()),
    body: m[2].trim(),
    rawFrontmatter: m[1].trim()
  }
}

/** @param {string} block */
function parseSimpleYaml (block) {
  /** @type {Record<string, any>} */
  const out = {}
  let objKey = null

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.match(/^(\s*)/)?.[1]?.length || 0

    if (indent >= 2 && objKey && out[objKey] && typeof out[objKey] === 'object') {
      const m = line.trim().match(/^([\w.-]+):\s*(.*)$/)
      if (m) out[objKey][m[1]] = parseYamlValue(m[2])
      continue
    }

    const m = line.match(/^([\w.-]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    const val = m[2]

    if (val === '' || val === null) {
      out[key] = {}
      objKey = key
    } else {
      out[key] = parseYamlValue(val)
      objKey = null
    }
  }
  return out
}

/** @param {unknown} v */
function parseYamlValue (v) {
  const t = String(v).trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (t.startsWith('[') && t.endsWith(']')) {
    try { return JSON.parse(t.replace(/'/g, '"')) } catch { return [] }
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/** @param {string} path */
function normalizePath (path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
}

/** @param {string} filePath @param {string[]} folders */
function isUnderSyncFolders (filePath, folders) {
  const norm = normalizePath(filePath)
  const roots = (folders || []).map(f => normalizePath(f).replace(/\/$/, '')).filter(Boolean)
  if (!roots.length) return true
  return roots.some(root => norm === root || norm.startsWith(root + '/'))
}

/** @param {string} iso */
function parseTime (iso) {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

module.exports = {
  chunkText,
  computeContentHash,
  parseNoteFile,
  normalizePath,
  isUnderSyncFolders,
  parseTime
}
