'use strict'

const { detectEnrichTargets } = require('./enrich-detect')
const { enrichFetchWeb } = require('./enrich-web')
const { enrichFetchWechat } = require('./enrich-wechat')
const { renderEnrichPayloadMarkdown } = require('./enrich-render')
const { ENRICH_CODES } = require('./enrich-codes')
const { canUseEnrich } = require('./entitlements')
const { formatForIma } = require('./format-pipeline')
const { getEnrichCacheEntry, putEnrichCacheEntry } = require('./enrich-cache')

/**
 * @typedef {{
 *   status: 'enriched'|'degraded'|'failed'|'skipped',
 *   codes: string[],
 *   source_url?: string,
 *   kind?: string,
 *   fields?: object,
 *   payloadMarkdown?: string,
 *   skipReason?: string,
 *   error?: string,
 *   cacheHit?: boolean
 * }} EnrichNoteResult
 */

/**
 * Light beautify after parse (D-IS-ENR-UI-02b) — minimal rules, no format trial.
 * @param {string} markdown
 * @returns {string}
 */
function lightBeautifyEnrichMarkdown (markdown) {
  const body = String(markdown || '')
  if (!body.trim()) return body
  const formatted = formatForIma({
    path: '',
    title: '',
    body,
    frontmatter: {}
  }, {
    format: {
      enabled: true,
      preset: 'minimal',
      writeBack: 'off',
      onPush: false
    }
  })
  return formatted.body || body
}

/**
 * Enrich one URL target.
 * @param {{ kind: 'wechat'|'web', url: string }} target
 * @param {{
 *   timeoutMs?: number,
 *   fetchHtml?: Function,
 *   createDocument?: Function,
 *   desktopEnhancement?: boolean,
 *   settings?: object,
 *   skipCache?: boolean
 * }} opts
 * @returns {Promise<EnrichNoteResult>}
 */
async function enrichTarget (target, opts = {}) {
  const url = String(target?.url || '').trim()
  const kind = target?.kind === 'wechat' ? 'wechat' : 'web'
  if (!url) {
    return { status: 'failed', codes: [ENRICH_CODES.PARSE_EMPTY], error: 'empty_url' }
  }

  const settings = opts.settings || null
  if (settings && !opts.skipCache) {
    const hit = getEnrichCacheEntry(settings, url)
    if (hit?.payloadMarkdown) {
      const codes = Array.isArray(hit.codes) ? hit.codes.slice() : []
      if (!codes.includes(ENRICH_CODES.CACHE_HIT)) codes.push(ENRICH_CODES.CACHE_HIT)
      return {
        status: hit.status === 'degraded' ? 'degraded' : 'enriched',
        codes,
        source_url: url,
        kind: hit.kind || kind,
        fields: hit.fields || undefined,
        payloadMarkdown: String(hit.payloadMarkdown),
        cacheHit: true
      }
    }
  }

  const result =
    kind === 'wechat'
      ? await enrichFetchWechat(url, opts)
      : await enrichFetchWeb(url, opts)

  if (!result.ok || !result.fields) {
    const payload = result.fields ? lightBeautifyEnrichMarkdown(renderEnrichPayloadMarkdown(result.fields)) : undefined
    const out = {
      status: result.degraded && result.fields ? 'degraded' : 'failed',
      codes: result.codes || [ENRICH_CODES.WEB_FETCH_FAILED],
      source_url: url,
      kind,
      fields: result.fields,
      payloadMarkdown: payload,
      error: result.error
    }
    if (settings && out.payloadMarkdown) putEnrichCacheEntry(settings, url, out)
    return out
  }

  const payloadMarkdown = lightBeautifyEnrichMarkdown(renderEnrichPayloadMarkdown(result.fields))
  const out = {
    status: result.degraded ? 'degraded' : 'enriched',
    codes: result.codes || [],
    source_url: url,
    kind,
    fields: result.fields,
    payloadMarkdown
  }
  if (settings) putEnrichCacheEntry(settings, url, out)
  return out
}

/**
 * Enrich a single note body for push injection (default: no vault write-back).
 * Fail soft — caller should fall back to original body on failed/skipped.
 *
 * @param {{
 *   path?: string,
 *   body: string,
 *   frontmatter?: object,
 *   settings?: object,
 *   fetchHtml?: Function,
 *   createDocument?: (html: string) => Document,
 *   requirePro?: boolean,
 *   targetOverride?: { kind: 'wechat'|'web', url: string },
 *   skipCache?: boolean
 * }} input
 * @returns {Promise<EnrichNoteResult>}
 */
async function enrichNote (input) {
  const settings = input.settings || {}
  const body = String(input.body || '')
  const fm = input.frontmatter || {}

  if (input.requirePro && !canUseEnrich(settings)) {
    return { status: 'skipped', codes: [ENRICH_CODES.SKIPPED], skipReason: 'no_pro' }
  }
  if (settings.enrich && settings.enrich.enabled === false) {
    return { status: 'skipped', codes: [ENRICH_CODES.SKIPPED], skipReason: 'disabled' }
  }

  let target = input.targetOverride || null
  if (!target) {
    const plan = detectEnrichTargets(body, fm, settings)
    if (!plan.needsEnrich) {
      return {
        status: 'skipped',
        codes: [ENRICH_CODES.SKIPPED],
        skipReason: plan.skipReason || 'not_needed',
        kind: plan.targets[0]?.kind
      }
    }
    target = plan.targets[0]
  }

  const timeoutMs = Math.max(1000, Number(settings.enrich?.fetchTimeoutMs) || 30000)
  const opts = {
    timeoutMs,
    fetchHtml: input.fetchHtml,
    createDocument: input.createDocument,
    desktopEnhancement: settings.enrich?.desktopEnhancement !== false,
    settings,
    skipCache: input.skipCache === true
  }

  return enrichTarget(target, opts)
}

module.exports = {
  enrichNote,
  enrichTarget,
  lightBeautifyEnrichMarkdown,
  ENRICH_CODES
}
