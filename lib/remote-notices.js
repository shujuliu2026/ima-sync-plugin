'use strict'

const { requestUrl } = require('obsidian')
const { DEFAULT_ANALYTICS_EVENTS_URL } = require('./telemetry')

const CACHE_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 12000

/** @param {object} settings */
function normalizeRemoteNotices (settings) {
  if (!settings.remoteNotices || typeof settings.remoteNotices !== 'object') {
    settings.remoteNotices = {}
  }
  const r = settings.remoteNotices
  if (!Array.isArray(r.notices)) r.notices = []
  if (!r.dismissed || typeof r.dismissed !== 'object') r.dismissed = {}
  if (typeof r.fetchedAt !== 'number') r.fetchedAt = 0
  return r
}

/** @param {object} settings */
function noticesUrl (settings) {
  const custom = (settings.telemetryUrl || '').trim()
  const eventsUrl = custom || DEFAULT_ANALYTICS_EVENTS_URL
  return eventsUrl.replace(/\/analytics\/events\/?$/i, '/analytics/ima-sync/notices')
}

/**
 * @param {object} settings
 * @param {string} pluginVersion
 */
function activeNotices (settings, pluginVersion) {
  const r = normalizeRemoteNotices(settings)
  const dismissed = new Set(Object.keys(r.dismissed || {}))
  const now = Date.now()
  return (Array.isArray(r.notices) ? r.notices : [])
    .filter((n) => {
      if (!n || n.active === false) return false
      if (dismissed.has(String(n.id))) return false
      if (n.published_at && Date.parse(String(n.published_at)) > now) return false
      if (n.expires_at && Date.parse(String(n.expires_at)) <= now) return false
      if (n.min_version && !versionAtLeast(pluginVersion, String(n.min_version))) return false
      if (n.max_version && versionAtLeast(pluginVersion, String(n.max_version))) return false
      return true
    })
}

/** @param {string} current @param {string} min */
function versionAtLeast (current, min) {
  const parse = (v) => {
    const m = String(v || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const a = parse(current)
  const b = parse(min)
  if (!a || !b) return true
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

/**
 * @param {object} settings
 * @param {string} pluginVersion
 * @param {{ force?: boolean }} [opts]
 */
async function fetchRemoteNotices (settings, pluginVersion, opts = {}) {
  const r = normalizeRemoteNotices(settings)
  const force = !!opts.force
  if (!force && r.fetchedAt && Date.now() - r.fetchedAt < CACHE_MS) {
    return { ok: true, cached: true, notices: activeNotices(settings, pluginVersion) }
  }

  const url = `${noticesUrl(settings)}?plugin_version=${encodeURIComponent(pluginVersion || '')}`
  const req = requestUrl({
    url,
    method: 'GET',
    throw: false
  })
  const timer = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('IMA_NOTICES_TIMEOUT')), FETCH_TIMEOUT_MS)
  })

  let res
  try {
    res = await Promise.race([req, timer])
  } catch {
    return { ok: false, cached: false, notices: activeNotices(settings, pluginVersion) }
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, cached: false, notices: activeNotices(settings, pluginVersion) }
  }

  let data
  try {
    data = typeof res.json === 'object' && res.json != null ? res.json : JSON.parse(String(res.text || '{}'))
  } catch {
    return { ok: false, cached: false, notices: activeNotices(settings, pluginVersion) }
  }

  r.notices = Array.isArray(data?.notices) ? data.notices : []
  r.fetchedAt = Date.now()
  r.updatedAt = data?.updated_at || null
  return { ok: true, cached: false, notices: activeNotices(settings, pluginVersion) }
}

/** @param {object} settings @param {string} noticeId */
function dismissRemoteNotice (settings, noticeId) {
  const r = normalizeRemoteNotices(settings)
  const id = String(noticeId || '').trim()
  if (!id) return
  r.dismissed[id] = new Date().toISOString()
}

module.exports = {
  normalizeRemoteNotices,
  noticesUrl,
  activeNotices,
  fetchRemoteNotices,
  dismissRemoteNotice
}
