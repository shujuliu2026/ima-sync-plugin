'use strict'

const { normalizeEnrichSourceUrl } = require('./enrich-writeback')
const { computeContentHash } = require('./utils')

const DEFAULT_TTL_HOURS = 72
const MAX_ENTRIES = 200

/**
 * @param {object} [settings]
 * @returns {number} ttl ms
 */
function enrichCacheTtlMs (settings) {
  const hours = Number(settings?.enrich?.cacheTtlHours)
  const h = Number.isFinite(hours) && hours >= 0 ? Math.min(hours, 24 * 30) : DEFAULT_TTL_HOURS
  return h * 3600 * 1000
}

/**
 * @param {object} settings
 * @returns {Record<string, object>}
 */
function ensureEnrichUrlCache (settings) {
  if (!settings || typeof settings !== 'object') return {}
  if (!settings.enrichUrlCache || typeof settings.enrichUrlCache !== 'object') {
    settings.enrichUrlCache = {}
  }
  return settings.enrichUrlCache
}

/**
 * @param {object} settings
 * @param {string} url
 * @param {number} [nowMs]
 * @returns {object|null} cached enrich result fields
 */
function getEnrichCacheEntry (settings, url, nowMs = Date.now()) {
  const key = normalizeEnrichSourceUrl(url)
  if (!key) return null
  const ttl = enrichCacheTtlMs(settings)
  if (ttl <= 0) return null
  const map = ensureEnrichUrlCache(settings)
  const hit = map[key]
  if (!hit || typeof hit !== 'object') return null
  const at = Number(hit.at) || 0
  if (!at || nowMs - at > ttl) {
    delete map[key]
    return null
  }
  if (!hit.payloadMarkdown && !hit.fields) return null
  return hit
}

/**
 * @param {object} settings
 * @param {string} url
 * @param {{
 *   kind?: string,
 *   status: string,
 *   codes?: string[],
 *   fields?: object,
 *   payloadMarkdown?: string
 * }} entry
 * @param {number} [nowMs]
 */
function putEnrichCacheEntry (settings, url, entry, nowMs = Date.now()) {
  const key = normalizeEnrichSourceUrl(url)
  if (!key || !entry?.payloadMarkdown) return
  // Only cache successful / degraded payloads (not hard failures without body)
  if (entry.status !== 'enriched' && entry.status !== 'degraded') return
  const map = ensureEnrichUrlCache(settings)
  map[key] = {
    at: nowMs,
    kind: entry.kind || 'web',
    status: entry.status,
    codes: Array.isArray(entry.codes) ? entry.codes.slice(0, 12) : [],
    fields: entry.fields || null,
    payloadMarkdown: String(entry.payloadMarkdown || ''),
    contentHash: computeContentHash(String(entry.payloadMarkdown || ''))
  }
  pruneEnrichCache(settings, nowMs)
}

/**
 * Drop expired + cap size (oldest first).
 * @param {object} settings
 * @param {number} [nowMs]
 */
function pruneEnrichCache (settings, nowMs = Date.now()) {
  const map = ensureEnrichUrlCache(settings)
  const ttl = enrichCacheTtlMs(settings)
  /** @type {Array<[string, object]>} */
  const rows = Object.entries(map)
  for (const [k, v] of rows) {
    const at = Number(v?.at) || 0
    if (ttl > 0 && (!at || nowMs - at > ttl)) delete map[k]
  }
  const left = Object.entries(map)
  if (left.length <= MAX_ENTRIES) return
  left.sort((a, b) => (Number(a[1]?.at) || 0) - (Number(b[1]?.at) || 0))
  const drop = left.length - MAX_ENTRIES
  for (let i = 0; i < drop; i++) delete map[left[i][0]]
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleepMs (ms) {
  const n = Math.max(0, Number(ms) || 0)
  if (n <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, n))
}

module.exports = {
  DEFAULT_TTL_HOURS,
  MAX_ENTRIES,
  enrichCacheTtlMs,
  ensureEnrichUrlCache,
  getEnrichCacheEntry,
  putEnrichCacheEntry,
  pruneEnrichCache,
  sleepMs
}
