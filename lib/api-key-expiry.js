'use strict'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {string} raw
 * @returns {number|null} expiry instant (end of local calendar day for date-only)
 */
function parseApiKeyExpiresAt (raw) {
  const s = String(raw || '').trim()
  if (!s) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    const end = new Date(y, m - 1, d, 23, 59, 59, 999)
    return Number.isFinite(end.getTime()) ? end.getTime() : null
  }

  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/**
 * @param {number} ms
 * @param {'date'|'datetime'} [mode]
 */
function formatExpiryDisplay (ms, mode = 'date') {
  const d = new Date(ms)
  if (mode === 'datetime') {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

/**
 * @param {string} [iso]
 * @returns {string} YYYY-MM-DD local
 */
function localDayKey (iso) {
  const d = iso ? new Date(iso) : new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * @param {object} settings
 * @param {number} [nowMs]
 * @returns {{ level: 'none'|'ok'|'soon'|'expired', daysLeft: number|null, expiresAtMs: number|null, displayDate: string }}
 */
function getApiKeyExpiryState (settings, nowMs = Date.now()) {
  const expiresAtMs = parseApiKeyExpiresAt(settings?.apiKeyExpiresAt)
  if (expiresAtMs == null) {
    return { level: 'none', daysLeft: null, expiresAtMs: null, displayDate: '' }
  }

  const remindDays = Math.max(1, parseInt(String(settings?.apiKeyExpiryRemindDays ?? 7), 10) || 7)
  const displayDate = formatExpiryDisplay(expiresAtMs, 'date')

  if (nowMs > expiresAtMs) {
    return { level: 'expired', daysLeft: 0, expiresAtMs, displayDate }
  }

  const daysLeft = Math.ceil((expiresAtMs - nowMs) / DAY_MS)
  if (daysLeft <= remindDays) {
    return { level: 'soon', daysLeft, expiresAtMs, displayDate }
  }

  return { level: 'ok', daysLeft, expiresAtMs, displayDate }
}

/**
 * @param {object} settings
 * @param {ReturnType<typeof getApiKeyExpiryState>} state
 * @param {number} [nowMs]
 */
function shouldShowApiKeyExpiryReminder (settings, state, nowMs = Date.now()) {
  if (!state || state.level === 'none' || state.level === 'ok') return false

  const snoozeUntil = Date.parse(String(settings?.apiKeyExpirySnoozeUntil || ''))
  if (Number.isFinite(snoozeUntil) && snoozeUntil > nowMs) return false

  const today = localDayKey(new Date(nowMs).toISOString())
  const lastDay = String(settings?.apiKeyExpiryLastReminderDay || '')
  const lastLevel = String(settings?.apiKeyExpiryLastReminderLevel || '')
  if (lastDay === today && lastLevel === state.level) return false

  return true
}

/**
 * @param {object} settings
 * @param {number} days
 * @param {number} [nowMs]
 */
function snoozeApiKeyExpiryReminder (settings, days, nowMs = Date.now()) {
  const until = nowMs + Math.max(1, days) * DAY_MS
  settings.apiKeyExpirySnoozeUntil = new Date(until).toISOString()
}

/**
 * @param {object} settings
 * @param {ReturnType<typeof getApiKeyExpiryState>} state
 * @param {number} [nowMs]
 */
function markApiKeyExpiryReminderShown (settings, state, nowMs = Date.now()) {
  settings.apiKeyExpiryLastReminderDay = localDayKey(new Date(nowMs).toISOString())
  settings.apiKeyExpiryLastReminderLevel = state.level
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
function isInvalidApiKeyExpiresAtInput (raw) {
  const s = String(raw || '').trim()
  if (!s) return false
  return parseApiKeyExpiresAt(s) == null
}

/**
 * @param {string} raw
 * @returns {string} normalized YYYY-MM-DD or '' if empty/invalid
 */
function normalizeApiKeyExpiresAtInput (raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const ms = parseApiKeyExpiresAt(s)
  if (ms == null) return s
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * @param {object} settings
 */
function clearApiKeyExpiryReminders (settings) {
  settings.apiKeyExpirySnoozeUntil = ''
  settings.apiKeyExpiryLastReminderDay = ''
  settings.apiKeyExpiryLastReminderLevel = ''
}

/**
 * @param {ReturnType<typeof getApiKeyExpiryState>} state
 * @param {boolean} [invalid]
 * @returns {string} i18n key or ''
 */
function apiKeyExpiryStatusKey (state, invalid = false) {
  if (invalid) return 'apiKeyExpiryStatusInvalid'
  const map = {
    none: 'apiKeyExpiryStatusUnset',
    ok: 'apiKeyExpiryStatusOk',
    soon: 'apiKeyExpiryStatusSoon',
    expired: 'apiKeyExpiryStatusExpired'
  }
  return map[state?.level] || ''
}

/**
 * @param {number} days
 * @param {number} [nowMs]
 * @returns {string} YYYY-MM-DD local
 */
function addDaysToToday (days, nowMs = Date.now()) {
  const d = new Date(nowMs)
  d.setDate(d.getDate() + Math.max(0, days))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * @param {object} settings
 * @param {ReturnType<typeof getApiKeyExpiryState>} state
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function shouldShowApiKeyExpiryBanner (settings, state, nowMs = Date.now()) {
  if (!state || state.level === 'none' || state.level === 'ok') return false
  if (state.level === 'expired') return true
  const snoozeUntil = Date.parse(String(settings?.apiKeyExpirySnoozeUntil || ''))
  if (Number.isFinite(snoozeUntil) && snoozeUntil > nowMs) return false
  return state.level === 'soon'
}

/**
 * @param {object} settings
 * @returns {boolean} settings tab is open for this plugin
 */
function isSettingsTabOpen (app, pluginId) {
  try {
    return app?.setting?.activeTab?.id === pluginId
  } catch {
    return false
  }
}
/**
 * @param {string} message
 */
function isLikelyAuthFailure (message) {
  return /auth failed|鉴权|unauthorized|401|403|密钥无效|无权访问|skill auth/i.test(String(message || ''))
}

module.exports = {
  parseApiKeyExpiresAt,
  formatExpiryDisplay,
  getApiKeyExpiryState,
  shouldShowApiKeyExpiryReminder,
  snoozeApiKeyExpiryReminder,
  markApiKeyExpiryReminderShown,
  isLikelyAuthFailure,
  isInvalidApiKeyExpiresAtInput,
  normalizeApiKeyExpiresAtInput,
  clearApiKeyExpiryReminders,
  apiKeyExpiryStatusKey,
  isSettingsTabOpen,
  addDaysToToday,
  shouldShowApiKeyExpiryBanner,
  localDayKey
}
