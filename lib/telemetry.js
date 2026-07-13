'use strict'

/**
 * IMA Sync 匿名统计契约
 * 服务端：POST {ANALYTICS_URL}/analytics/events
 */

const { defaultAnalyticsEventsUrl, clientChannel, analyticsTenantId } = require('./product-config')

const CHANNEL = clientChannel || 'ima-sync'
const TENANT_ID = analyticsTenantId || ''

const HOOKS = {
  INSTALL: 'ima.install',
  HEARTBEAT: 'ima.heartbeat',
  PANEL_OPEN: 'ima.panel_open',
  SYNC_SUMMARY: 'ima.sync_summary',
  SYNC_ERROR: 'ima.sync_error',
  FEEDBACK: 'ima.feedback'
}

/** @param {unknown} err */
function classifyTelemetryError (err) {
  const msg = String(err?.message || err || '')
  if (/IMA_QUOTA|超量|明日再试/.test(msg)) return 'quota'
  if (/IMA_RATE|429|限频|过于频繁/.test(msg)) return 'rate'
  if (/401|403|密钥|key|auth|unauthorized/i.test(msg)) return 'auth'
  if (/network|fetch|timeout|ECONN|ENOTFOUND|断网|网络/i.test(msg)) return 'network'
  const http = msg.match(/IMA_HTTP_(\d+)/)
  if (http) return `http_${http[1]}`
  return 'other'
}

/**
 * @param {object} opts
 * @param {string} opts.hook
 * @param {string} opts.installId
 * @param {string} [opts.sessionId]
 * @param {object} [opts.payload]
 */
function buildEvent (opts) {
  const ev = {
    feature_hook: opts.hook,
    session_id: (opts.sessionId || 'sess').slice(0, 64),
    visitor_id: (opts.installId || 'anon').slice(0, 64),
    client_channel: CHANNEL,
    occurred_at: new Date().toISOString(),
    payload: opts.payload || {}
  }
  if (TENANT_ID) ev.tenant_id = TENANT_ID
  return ev
}

/**
 * @param {object} ctx
 * @param {string} ctx.installId
 * @param {string} ctx.pluginVersion
 * @param {string} [ctx.lang]
 * @param {boolean} [ctx.configured]
 * @param {string} [ctx.obsidianVersion]
 */
function buildInstallEvent (ctx) {
  return buildEvent({
    hook: HOOKS.INSTALL,
    installId: ctx.installId,
    payload: {
      plugin_version: ctx.pluginVersion,
      lang: ctx.lang,
      configured: !!ctx.configured,
      platform: typeof process !== 'undefined' ? process.platform : 'unknown',
      obsidian_version: ctx.obsidianVersion || 'unknown'
    }
  })
}

/**
 * @param {object} summary
 * @param {number} [summary.pushed]
 * @param {number} [summary.errors]
 * @param {number} [summary.skipped]
 */
function buildSyncSummaryEvent (ctx, summary) {
  const errorTypes = {}
  if (Array.isArray(summary?.errorTypes)) {
    for (const t of summary.errorTypes) {
      if (t) errorTypes[t] = (errorTypes[t] || 0) + 1
    }
  }
  return buildEvent({
    hook: HOOKS.SYNC_SUMMARY,
    installId: ctx.installId,
    sessionId: ctx.sessionId,
    payload: {
      plugin_version: ctx.pluginVersion,
      pushed: summary?.pushed || 0,
      errors: summary?.errors || 0,
      skipped: summary?.skipped || 0,
      error_types: errorTypes
    }
  })
}

/** 默认上报地址（可在设置 telemetryUrl 覆盖） */
const DEFAULT_ANALYTICS_EVENTS_URL = defaultAnalyticsEventsUrl

module.exports = {
  CHANNEL,
  HOOKS,
  DEFAULT_ANALYTICS_EVENTS_URL,
  classifyTelemetryError,
  buildEvent,
  buildInstallEvent,
  buildSyncSummaryEvent
}
