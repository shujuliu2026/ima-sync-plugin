'use strict'

const { normalizePath } = require('./utils')

/**
 * 从 Markdown 正文提取本地附件引用
 * @param {string} body
 * @param {string} notePath
 */
function extractAttachmentRefs (body, notePath) {
  const refs = []
  const seen = new Set()
  const noteDir = normalizePath(notePath).split('/').slice(0, -1).join('/')

  const wikiRe = /!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g
  const mdRe = /!\[[^\]]*\]\(([^)]+)\)/g

  let m
  while ((m = wikiRe.exec(body)) !== null) {
    addRef(m[1])
  }
  while ((m = mdRe.exec(body)) !== null) {
    addRef(m[1])
  }

  function addRef (raw) {
    const target = String(raw || '').trim().replace(/^<|>$/g, '')
    if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mock://')) {
      return
    }
    const resolved = resolveRelative(noteDir, target.split('#')[0].split('?')[0])
    if (!seen.has(resolved)) {
      seen.add(resolved)
      refs.push({ raw: target, path: resolved })
    }
  }

  return refs
}

/** @param {string} baseDir @param {string} rel */
function resolveRelative (baseDir, rel) {
  const clean = normalizePath(rel)
  if (clean.startsWith('/')) return clean.slice(1)
  if (!baseDir) return clean
  const parts = baseDir.split('/').filter(Boolean)
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/**
 * @param {import('obsidian').App} app
 * @param {import('./ima-api').ImaApiClient} client
 * @param {string} docId
 * @param {string} body
 * @param {string} notePath
 */
async function syncAttachments (app, client, docId, body, notePath) {
  const refs = extractAttachmentRefs(body, notePath)
  if (!refs.length) return { uploaded: [], body }

  const uploaded = []
  let nextBody = body

  for (const ref of refs) {
    const file = app.vault.getAbstractFileByPath(ref.path)
    if (!file || !('extension' in file)) continue

    try {
      const binary = await app.vault.readBinary(file)
      const blob = new Blob([binary])
      const result = await client.uploadAttachment(docId, blob, file.name)
      uploaded.push({ path: ref.path, ...result })

      if (result.url) {
        nextBody = replaceAttachmentRef(nextBody, ref.raw, result.url, file.name)
      }
    } catch (err) {
      uploaded.push({ path: ref.path, error: err.message || String(err) })
    }
  }

  return { uploaded, body: nextBody }
}

/** @param {string} body @param {string} raw @param {string} url @param {string} name */
function replaceAttachmentRef (body, raw, url, name) {
  const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wiki = new RegExp(`!\\[\\[${esc}(?:\\|[^\\]]*)?\\]\\]`, 'g')
  const md = new RegExp(`!\\[[^\\]]*\\]\\(${esc}\\)`, 'g')
  return body
    .replace(wiki, `![${name}](${url})`)
    .replace(md, `![${name}](${url})`)
}

module.exports = { extractAttachmentRefs, syncAttachments }
