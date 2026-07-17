'use strict'

const { isProActive } = require('./entitlements')
const { todayKey } = require('./batch-quota')
const { resolveExperienceLimit, DEFAULT_EXPERIENCE } = require('./experience-limits')

/** 免费：每日链接解析（预览/解析推送）次数 */
const DEFAULT_FREE_ENRICH_PARSE_PER_DAY = DEFAULT_EXPERIENCE.enrich_parse_per_day

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number} 0 = Pro 不限
 */
function enrichParsePerDayMax (settings, nowMs = Date.now()) {
  if (isProActive(settings, nowMs)) return 0
  return resolveExperienceLimit('enrich_parse_per_day', settings, nowMs)
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {{ date: string, count: number }}
 */
function getEnrichTrialUsage (settings, nowMs = Date.now()) {
  const today = todayKey(nowMs)
  const raw = settings?.enrichTrialUsage
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
function remainingEnrichParse (settings, nowMs = Date.now()) {
  const max = enrichParsePerDayMax(settings, nowMs)
  if (max <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, max - getEnrichTrialUsage(settings, nowMs).count)
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
function checkEnrichParseQuota (settings, nowMs = Date.now()) {
  const max = enrichParsePerDayMax(settings, nowMs)
  const used = getEnrichTrialUsage(settings, nowMs).count
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
function recordEnrichParse (settings, nowMs = Date.now()) {
  if (enrichParsePerDayMax(settings, nowMs) <= 0) {
    return getEnrichTrialUsage(settings, nowMs)
  }
  const today = todayKey(nowMs)
  const prev = getEnrichTrialUsage(settings, nowMs)
  const next = { date: today, count: prev.count + 1 }
  settings.enrichTrialUsage = next
  return next
}

module.exports = {
  DEFAULT_FREE_ENRICH_PARSE_PER_DAY,
  enrichParsePerDayMax,
  getEnrichTrialUsage,
  remainingEnrichParse,
  checkEnrichParseQuota,
  recordEnrichParse
}
