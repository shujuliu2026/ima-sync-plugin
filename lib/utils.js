'use strict'

const { normalizeFrontmatter } = require('./sync-frontmatter-i18n')

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
    frontmatter: normalizeFrontmatter(parseSimpleYaml(m[1].trim())),
    body: m[2].trim(),
    rawFrontmatter: m[1].trim()
  }
}

/** YAML 键：支持中文属性名（同步/文档编号等） */
const YAML_KEY_RE = /^([^\s:#][^:]*?):\s*(.*)$/

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
      const m = line.trim().match(YAML_KEY_RE)
      if (m) out[objKey][m[1].trim()] = parseYamlValue(m[2])
      continue
    }

    const m = line.match(YAML_KEY_RE)
    if (!m) continue
    const key = m[1].trim()
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

/**
 * 「当前文档」解析：点侧栏时 getActiveFile() 常为 null，需回退到最近 Markdown 编辑叶 / lastPath。
 * @param {{ workspace?: any, vault?: any }} app
 * @param {string} [lastPath]
 * @returns {{ path: string, extension?: string, basename?: string, parent?: any } | null}
 */
function resolveWorkingMarkdownFile (app, lastPath = '') {
  const active = app?.workspace?.getActiveFile?.()
  if (active && active.extension === 'md') return active

  let best = null
  let bestTime = -1
  const iterate = app?.workspace?.iterateAllLeaves?.bind(app.workspace)
  if (typeof iterate === 'function') {
    iterate((leaf) => {
      const view = leaf?.view
      if (!view || view.getViewType?.() !== 'markdown') return
      const file = view.file
      if (!file || file.extension !== 'md') return
      const t = typeof leaf.activeTime === 'number' ? leaf.activeTime : 0
      if (t >= bestTime) {
        bestTime = t
        best = file
      }
    })
  }
  if (best) return best

  const leaves = app?.workspace?.getLeavesOfType?.('markdown') || []
  for (const leaf of leaves) {
    const file = leaf?.view?.file
    if (file?.extension === 'md') return file
  }

  const path = String(lastPath || '').trim()
  if (path && typeof app?.vault?.getAbstractFileByPath === 'function') {
    const f = app.vault.getAbstractFileByPath(path)
    if (f && f.extension === 'md') return f
  }
  return null
}

module.exports = {
  chunkText,
  computeContentHash,
  parseNoteFile,
  normalizePath,
  isUnderSyncFolders,
  parseTime,
  resolveWorkingMarkdownFile
}
