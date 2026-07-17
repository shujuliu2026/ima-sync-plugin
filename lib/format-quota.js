'use strict'

const { isProActive } = require('./entitlements')
const { todayKey } = require('./batch-quota')
const { resolveExperienceLimit, DEFAULT_EXPERIENCE } = require('./experience-limits')

/** 免费：每日一键排版预览次数 */
const DEFAULT_FREE_FORMAT_PREVIEW_PER_DAY = DEFAULT_EXPERIENCE.format_preview_per_day

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number} 0 = Pro 不限
 */
function formatPreviewPerDayMax (settings, nowMs = Date.now()) {
  if (isProActive(settings, nowMs)) return 0
  return resolveExperienceLimit('format_preview_per_day', settings, nowMs)
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {{ date: string, count: number }}
 */
function getFormatTrialUsage (settings, nowMs = Date.now()) {
  const today = todayKey(nowMs)
  const raw = settings?.formatTrialUsage
  if (!raw || typeof raw !== 'object' || String(raw.date || '') !== today) {
    return { date: today, count: 0 }
  }
  return { date: today, count: Math.max(0, Math.floor(Number(raw.count) || 0)) }
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number} Infinity when unlimited
 */
function remainingFormatPreview (settings, nowMs = Date.now()) {
  const max = formatPreviewPerDayMax(settings, nowMs)
  if (max <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, max - getFormatTrialUsage(settings, nowMs).count)
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {{
 *   ok: boolean,
 *   unlimited: boolean,
 *   max: number,
 *   used: number,
 *   remaining: number,
 *   reason?: 'exhausted'
 * }}
 */
function checkFormatPreviewQuota (settings, nowMs = Date.now()) {
  const max = formatPreviewPerDayMax(settings, nowMs)
  const used = getFormatTrialUsage(settings, nowMs).count
  if (max <= 0) {
    return { ok: true, unlimited: true, max: 0, used, remaining: Number.POSITIVE_INFINITY }
  }
  const remaining = Math.max(0, max - used)
  if (remaining <= 0) {
    return { ok: false, unlimited: false, max, used, remaining: 0, reason: 'exhausted' }
  }
  return { ok: true, unlimited: false, max, used, remaining }
}

/**
 * @param {object} settings
 * @param {number} [nowMs]
 * @returns {{ date: string, count: number }}
 */
function recordFormatPreview (settings, nowMs = Date.now()) {
  if (formatPreviewPerDayMax(settings, nowMs) <= 0) {
    return getFormatTrialUsage(settings, nowMs)
  }
  const today = todayKey(nowMs)
  const prev = getFormatTrialUsage(settings, nowMs)
  const next = { date: today, count: prev.count + 1 }
  settings.formatTrialUsage = next
  return next
}

module.exports = {
  DEFAULT_FREE_FORMAT_PREVIEW_PER_DAY,
  formatPreviewPerDayMax,
  getFormatTrialUsage,
  remainingFormatPreview,
  checkFormatPreviewQuota,
  recordFormatPreview
}
