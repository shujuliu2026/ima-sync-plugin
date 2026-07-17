'use strict'

const { isImaAuthError } = require('./ima-errors')
const { normalizeFrontmatter } = require('./sync-frontmatter-i18n')

/**
 * @param {string} title
 * @param {string} [basename]
 */
function noteFileName (title, basename) {
  const base = String(title || basename || 'note').replace(/\.md$/i, '').trim() || 'note'
  return `${base}.md`.slice(0, 256)
}

/**
 * @param {import('./ima-api').ImaApiClient} client
 * @param {object} settings
 * @param {{ title: string, basename?: string, frontmatter: object, contentHash: string, force?: boolean }} ctx
 * @returns {Promise<{ action: 'continue'|'skip'|'ambiguous', reason?: string, apiCalls: number }>}
 */
async function evaluateDedup (client, settings, ctx) {
  const { title, basename, frontmatter, contentHash, force } = ctx
  if (force) return { action: 'continue', apiCalls: 0 }

  const name = noteFileName(title, basename)
  let results
  try {
    results = await client.checkRepeatedNames([{ name, media_type: 11 }])
  } catch (err) {
    const msg = String(err?.message || err)
    if (isImaAuthError(msg)) throw new Error(`IMA_AUTH: ${msg}`)
    throw err
  }
  const repeated = Boolean(results[0]?.is_repeated)

  if (!repeated) return { action: 'continue', apiCalls: 1 }

  const fm = normalizeFrontmatter(frontmatter)
  const docId = String(fm?.ima_doc_id || '').trim()
  const syncedHash = String(fm?.ima_content_hash || '')

  if (docId && syncedHash && syncedHash === contentHash) {
    return { action: 'skip', reason: 'dedup', apiCalls: 1 }
  }

  if (!docId) {
    const mode = settings?.trust?.dedupAmbiguous || 'warn-push'
    if (mode === 'skip') {
      return { action: 'skip', reason: 'dedup_ambiguous', apiCalls: 1 }
    }
    return { action: 'ambiguous', reason: 'dedup_ambiguous', apiCalls: 1 }
  }

  return { action: 'continue', apiCalls: 1 }
}

module.exports = { evaluateDedup, noteFileName }
