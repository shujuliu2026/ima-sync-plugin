'use strict'

const { isProActive } = require('./entitlements')
const { resolveExperienceLimit, DEFAULT_EXPERIENCE } = require('./experience-limits')

/** 免费默认：每日批量合计可上传篇数（不含「同步当前文档」） */
const DEFAULT_FREE_BATCH_NOTES_PER_DAY = DEFAULT_EXPERIENCE.batch_notes_per_day

/**
 * @returns {string} YYYY-MM-DD local
 */
function todayKey (nowMs = Date.now()) {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 0 = 不限（Pro / 云授权未设上限）
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number}
 */
function batchNotesPerDayMax (settings, nowMs = Date.now()) {
  if (isProActive(settings, nowMs)) return 0
  // 云端验签通过才用后台体验变量；断网/篡改 → 默认
  return resolveExperienceLimit('batch_notes_per_day', settings, nowMs)
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {{ date: string, notes: number }}
 */
function getBatchQuotaUsage (settings, nowMs = Date.now()) {
  const today = todayKey(nowMs)
  const raw = settings?.batchQuotaUsage
  if (!raw || typeof raw !== 'object' || String(raw.date || '') !== today) {
    return { date: today, notes: 0 }
  }
  const notes = Math.max(0, Math.floor(Number(raw.notes) || 0))
  return { date: today, notes }
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number} Infinity when unlimited
 */
function remainingBatchNotes (settings, nowMs = Date.now()) {
  const max = batchNotesPerDayMax(settings, nowMs)
  if (max <= 0) return Number.POSITIVE_INFINITY
  const used = getBatchQuotaUsage(settings, nowMs).notes
  return Math.max(0, max - used)
}

/**
 * @param {object} [settings]
 * @param {number} [plannedNotes]
 * @param {number} [nowMs]
 * @returns {{
 *   ok: boolean,
 *   unlimited: boolean,
 *   max: number,
 *   used: number,
 *   remaining: number,
 *   planned: number,
 *   reason?: 'exhausted' | 'too_many'
 * }}
 */
function checkBatchQuota (settings, plannedNotes = 0, nowMs = Date.now()) {
  const max = batchNotesPerDayMax(settings, nowMs)
  const used = getBatchQuotaUsage(settings, nowMs).notes
  const planned = Math.max(0, Math.floor(Number(plannedNotes) || 0))
  if (max <= 0) {
    return { ok: true, unlimited: true, max: 0, used, remaining: Number.POSITIVE_INFINITY, planned }
  }
  const remaining = Math.max(0, max - used)
  if (remaining <= 0) {
    return { ok: false, unlimited: false, max, used, remaining: 0, planned, reason: 'exhausted' }
  }
  if (planned > remaining) {
    return { ok: false, unlimited: false, max, used, remaining, planned, reason: 'too_many' }
  }
  return { ok: true, unlimited: false, max, used, remaining, planned }
}

/**
 * 批量结束后记账：按实际上传尝试篇数（成功 + 失败，不含跳过）
 * @param {object} settings
 * @param {number} notes
 * @param {number} [nowMs]
 * @returns {{ date: string, notes: number }}
 */
function recordBatchNotes (settings, notes, nowMs = Date.now()) {
  const add = Math.max(0, Math.floor(Number(notes) || 0))
  const today = todayKey(nowMs)
  const prev = getBatchQuotaUsage(settings, nowMs)
  const next = {
    date: today,
    notes: prev.date === today ? prev.notes + add : add
  }
  settings.batchQuotaUsage = next
  return next
}

/**
 * @param {{ pushed?: number, errors?: unknown[] }|null|undefined} summary
 * @returns {number}
 */
function countBatchQuotaNotes (summary) {
  if (!summary || typeof summary !== 'object') return 0
  const pushed = Math.max(0, Math.floor(Number(summary.pushed) || 0))
  const failed = Array.isArray(summary.errors) ? summary.errors.length : 0
  return pushed + failed
}

module.exports = {
  DEFAULT_FREE_BATCH_NOTES_PER_DAY,
  todayKey,
  batchNotesPerDayMax,
  getBatchQuotaUsage,
  remainingBatchNotes,
  checkBatchQuota,
  recordBatchNotes,
  countBatchQuotaNotes
}
