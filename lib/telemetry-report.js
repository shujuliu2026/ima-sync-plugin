'use strict'

const { requestUrl } = require('obsidian')
const {
  HOOKS,
  DEFAULT_ANALYTICS_EVENTS_URL,
  buildEvent,
  buildInstallEvent,
  buildSyncSummaryEvent,
  buildExperienceTamperEvent
} = require('./telemetry')
const { normalizeTelemetry, touchActiveDay } = require('./telemetry-local')
const {
  shouldReportExperienceTamper,
  markExperienceTamperReported
} = require('./experience-limits')

/** @param {unknown} err @param {string} [url] */
function friendlyTelemetryError (err, url = '') {
  const msg = String(err?.message || err || '')
  if (/failed to fetch|networkerror|load failed|net::|IMA_TELEMETRY_TIMEOUT/i.test(msg)) {
    const host = url ? `（${url}）` : ''
    return `无法连接反馈服务器${host}，请检查网络；也可先「复制诊断信息」`
  }
  return msg
}

const MAX_PENDING = 40

/**
 * @param {object} settings
 * @param {string} pluginVersion
 * @param {string} lang
 * @param {boolean} configured
 */
function telemetryCtx (settings, pluginVersion, lang, configured) {
  const t = normalizeTelemetry(settings)
  return {
    installId: t.installId,
    sessionId: t.sessionId,
    pluginVersion,
    lang,
    configured: !!configured
  }
}

/** @param {object} settings */
function eventsUrl (settings) {
  const custom = (settings.telemetryUrl || '').trim()
  return custom || DEFAULT_ANALYTICS_EVENTS_URL
}

/** @param {object} settings @param {object} event */
function enqueueEvent (settings, event) {
  const t = normalizeTelemetry(settings)
  t.pending.push(event)
  if (t.pending.length > MAX_PENDING) {
    t.pending.splice(0, t.pending.length - MAX_PENDING)
  }
}

/**
 * @param {object} settings
 * @param {object[]} events
 */
async function postEvents (settings, events) {
  if (!events.length) return { ok: true, sent: 0 }
  const url = eventsUrl(settings)
  const body = JSON.stringify({ events })
  const timeoutMs = 15000
  const req = requestUrl({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    throw: false
  })
  const timer = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('IMA_TELEMETRY_TIMEOUT')), timeoutMs)
  })
  let res
  try {
    res = await Promise.race([req, timer])
  } catch (err) {
    throw new Error(friendlyTelemetryError(err, url))
  }
  if (res.status < 200 || res.status >= 300) {
    const text = String(res.text || '')
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`)
  }
  return { ok: true, sent: events.length }
}

/**
 * @param {object} settings
 * @param {object} ctx from telemetryCtx
 * @param {{ force?: boolean }} [opts]
 */
async function flushPending (settings, ctx, opts = {}) {
  const force = !!opts.force
  if (!force && !settings.telemetryEnabled) return { ok: true, sent: 0, skipped: true }
  const t = normalizeTelemetry(settings)
  if (!t.pending.length) return { ok: true, sent: 0 }
  const batch = t.pending.splice(0, 30)
  try {
    const r = await postEvents(settings, batch)
    return r
  } catch (e) {
    t.pending.unshift(...batch)
    throw e
  }
}

/**
 * 首次启用时的后台握手（不写 changelog）
 * @param {object} plugin ImaSyncPlugin-like
 */
async function maybeReportInstall (plugin) {
  const t = normalizeTelemetry(plugin.settings)
  if (t.installSent) return
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  ctx.obsidianVersion = plugin.app?.version || 'unknown'
  const hasPendingInstall = t.pending.some((e) => e.feature_hook === HOOKS.INSTALL)
  if (!hasPendingInstall) {
    enqueueEvent(plugin.settings, buildInstallEvent(ctx))
  }
  try {
    await flushPending(plugin.settings, ctx, { force: true })
    t.installSent = true
    await plugin.saveData(plugin.settings)
  } catch {
    // 联网失败：保留 pending，下次 onload 重试；不标记 installSent
  }
}

/**
 * @param {object} plugin
 */
async function maybeReportHeartbeat (plugin) {
  if (!plugin.settings.telemetryEnabled) return
  touchActiveDay(plugin.settings)
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  const ev = buildEvent({
    hook: HOOKS.HEARTBEAT,
    installId: ctx.installId,
    sessionId: ctx.sessionId,
    payload: {
      plugin_version: ctx.pluginVersion,
      lang: ctx.lang,
      configured: ctx.configured
    }
  })
  enqueueEvent(plugin.settings, ev)
  await flushPending(plugin.settings, ctx)
}

/**
 * @param {object} plugin
 * @param {{ pushed?: number, errors?: number, skipped?: number, errorTypes?: string[] }} summary
 */
async function reportSyncSummary (plugin, summary) {
  const { recordSyncSummary } = require('./telemetry-local')
  recordSyncSummary(plugin.settings, summary)
  if (!plugin.settings.telemetryEnabled) return
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  const ev = buildSyncSummaryEvent(ctx, summary)
  enqueueEvent(plugin.settings, ev)
  await plugin.saveData(plugin.settings)
  await flushPending(plugin.settings, ctx)
}

/**
 * @param {object} plugin
 * @param {unknown} err
 */
async function reportSyncError (plugin, err) {
  const { recordSyncError } = require('./telemetry-local')
  const { classifyTelemetryError } = require('./telemetry')
  recordSyncError(plugin.settings, err)
  if (!plugin.settings.telemetryEnabled) return
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  const ev = buildEvent({
    hook: HOOKS.SYNC_ERROR,
    installId: ctx.installId,
    sessionId: ctx.sessionId,
    payload: {
      plugin_version: ctx.pluginVersion,
      error_type: classifyTelemetryError(err)
    }
  })
  enqueueEvent(plugin.settings, ev)
  await plugin.saveData(plugin.settings)
}

/**
 * @param {object} plugin
 * @param {string} [feedbackText]
 * @returns {Promise<{ uploaded: boolean, telemetry: boolean }>}
 */
async function reportFeedback (plugin, feedbackText = '') {
  const text = String(feedbackText || '').trim()
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  const ev = buildEvent({
    hook: HOOKS.FEEDBACK,
    installId: ctx.installId,
    sessionId: ctx.sessionId,
    payload: {
      plugin_version: ctx.pluginVersion,
      has_feedback_text: text.length > 0,
      feedback_len: Math.min(text.length, 2000),
      feedback_text: text.slice(0, 500)
    }
  })
  enqueueEvent(plugin.settings, ev)
  let uploaded = false
  if (plugin.settings.telemetryEnabled) {
    const r = await flushPending(plugin.settings, ctx)
    uploaded = (r.sent || 0) > 0
  } else if (text.length > 0) {
    const r = await flushPending(plugin.settings, ctx, { force: true })
    uploaded = (r.sent || 0) > 0
  }
  await plugin.saveData(plugin.settings)
  return { uploaded, telemetry: !!plugin.settings.telemetryEnabled }
}

/**
 * 体验验签失败 · 强制上报（不受匿名统计开关限制 · 每日每机最多 1 次）
 * @param {object} plugin
 * @param {{ reason?: string, claimed?: object }} detail
 */
async function reportExperienceTamper (plugin, detail = {}) {
  if (!shouldReportExperienceTamper(plugin.settings)) return { sent: false, skipped: true }
  const ctx = telemetryCtx(
    plugin.settings,
    plugin.manifest.version,
    require('./i18n').resolveLang(plugin.settings),
    plugin.isConfigured()
  )
  enqueueEvent(plugin.settings, buildExperienceTamperEvent(ctx, detail))
  try {
    await flushPending(plugin.settings, ctx, { force: true })
    markExperienceTamperReported(plugin.settings)
    await plugin.saveData(plugin.settings)
    return { sent: true, skipped: false }
  } catch {
    return { sent: false, skipped: false }
  }
}

module.exports = {
  telemetryCtx,
  enqueueEvent,
  postEvents,
  flushPending,
  maybeReportInstall,
  maybeReportHeartbeat,
  reportSyncSummary,
  reportSyncError,
  reportFeedback,
  reportExperienceTamper
}
