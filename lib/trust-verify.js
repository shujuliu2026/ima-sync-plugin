'use strict'

const { parseImaError, isImaAuthError } = require('./ima-errors')
const { buildVerifyQueries } = require('./trust-queries')
const { sleep } = require('./rate-limit')

/**
 * @param {object[]} items
 * @param {{ title?: string, docId?: string, basename?: string }} ctx
 */
function matchKnowledgeHit (items, ctx) {
  if (!Array.isArray(items) || !items.length) return false
  const docId = String(ctx.docId || '').trim()
  const title = String(ctx.title || ctx.basename || '').replace(/\.md$/i, '').trim().toLowerCase()

  for (const item of items) {
    const id = String(item.doc_id || item.media_id || item.id || '').trim()
    if (docId && id && docId === id) return true
    const itemTitle = String(item.title || item.name || '').replace(/\.md$/i, '').trim().toLowerCase()
    if (title && itemTitle && (itemTitle === title || itemTitle.includes(title) || title.includes(itemTitle))) {
      return true
    }
  }
  return false
}

/**
 * @param {import('./ima-api').ImaApiClient} client
 * @param {object} settings
 * @param {{ title: string, docId: string, basename?: string }} ctx
 */
async function runVerifyQueries (client, settings, ctx) {
  const gapMs = Math.max(200, Number(settings?.trust?.verifyGapMs) || 600)
  const queries = buildVerifyQueries(ctx.title, ctx.basename)

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]
    if (i > 0) await sleep(gapMs)
    try {
      const { items } = await client.searchKnowledge(q, { limit: 20 })
      if (matchKnowledgeHit(items, ctx)) {
        return { status: 'verified', query: q }
      }
    } catch (err) {
      const limit = parseImaError(err)
      if (limit?.kind === 'rate' || limit?.kind === 'quota') {
        return { status: 'pending', query: q, detail: limit.kind.toUpperCase() }
      }
      const msg = String(err?.message || err)
      if (isImaAuthError(msg)) {
        return { status: 'failed', query: q, detail: `AUTH_FAILED: ${msg.slice(0, 100)}` }
      }
      return { status: 'failed', query: q, detail: msg.slice(0, 120) }
    }
  }

  return { status: 'failed', query: queries[0] || ctx.title, detail: 'NOT_FOUND' }
}

/**
 * @param {import('./ima-api').ImaApiClient} client
 * @param {object} settings
 * @param {{ title: string, docId: string, basename?: string }} ctx
 * @returns {Promise<{ status: 'verified'|'failed'|'pending'|'skipped', query: string, detail?: string }>}
 */
async function verifyPushedNote (client, settings, ctx) {
  if (settings?.trust?.verifyAfterPush === false) {
    return { status: 'skipped', query: '', detail: 'DISABLED' }
  }

  const delayMs = Math.max(0, Number(settings?.trust?.verifyDelayMs) ?? 2000)
  if (delayMs > 0) await sleep(delayMs)

  const attempts = Math.max(1, Number(settings?.trust?.verifyRetries) || 2)
  const retryDelayMs = Math.max(500, Number(settings?.trust?.verifyRetryDelayMs) || 3000)

  /** @type {{ status: string, query: string, detail?: string }} */
  let last = { status: 'failed', query: ctx.title, detail: 'NOT_FOUND' }

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs)
    last = await runVerifyQueries(client, settings, ctx)
    if (last.status === 'verified' || last.status === 'pending') return last
    if (last.detail !== 'NOT_FOUND') return last
  }

  return last
}

/**
 * @param {import('obsidian').App} app
 * @param {import('obsidian').TFile} file
 * @param {{ status: string, query?: string, detail?: string }} result
 */
async function writeVerifyFrontmatter (app, file, result) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!fm.sync || typeof fm.sync !== 'object') fm.sync = {}
    fm.sync.ima_verify = result.status
    fm.ima_verify_at = new Date().toISOString()
    fm.ima_verify_query = String(result.query || '').slice(0, 120)
    fm.ima_verify_detail = String(result.detail || '').slice(0, 120)
  })
}

module.exports = {
  matchKnowledgeHit,
  verifyPushedNote,
  runVerifyQueries,
  writeVerifyFrontmatter
}
