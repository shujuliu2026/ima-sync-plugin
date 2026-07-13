'use strict'

const { classifyTelemetryError } = require('./telemetry')

function todayKey () {
  return new Date().toISOString().slice(0, 10)
}

function randomId () {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/** @param {object} settings */
function normalizeTelemetry (settings) {
  if (!settings.telemetry || typeof settings.telemetry !== 'object') {
    settings.telemetry = {}
  }
  const t = settings.telemetry
  if (!t.installId) t.installId = randomId()
  if (!t.sessionId) t.sessionId = randomId()
  if (!t.errorTypes || typeof t.errorTypes !== 'object') t.errorTypes = {}
  if (!Array.isArray(t.pending)) t.pending = []
  if (t.installSent !== true) t.installSent = false
  if (typeof t.activeDays !== 'number') t.activeDays = 0
  if (typeof t.syncRuns !== 'number') t.syncRuns = 0
  if (typeof t.pushed !== 'number') t.pushed = 0
  if (typeof t.errors !== 'number') t.errors = 0
  if (typeof t.skipped !== 'number') t.skipped = 0
  return t
}

/** @param {object} settings */
function touchActiveDay (settings) {
  const t = normalizeTelemetry(settings)
  const today = todayKey()
  if (t.lastActiveDate !== today) {
    t.lastActiveDate = today
    t.activeDays += 1
  }
  return t
}

/**
 * @param {object} settings
 * @param {{ pushed?: number, errors?: number, skipped?: number, errorTypes?: string[] }} summary
 */
function recordSyncSummary (settings, summary) {
  const t = touchActiveDay(settings)
  t.syncRuns += 1
  t.pushed += summary?.pushed || 0
  t.errors += summary?.errors || 0
  t.skipped += summary?.skipped || 0
  if (Array.isArray(summary?.errorTypes)) {
    for (const key of summary.errorTypes) {
      if (!key) continue
      t.errorTypes[key] = (t.errorTypes[key] || 0) + 1
    }
  }
}

/** @param {object} settings @param {unknown} err */
function recordSyncError (settings, err) {
  const t = touchActiveDay(settings)
  const key = classifyTelemetryError(err)
  t.errorTypes[key] = (t.errorTypes[key] || 0) + 1
}

/**
 * @param {object} settings
 * @param {string} pluginVersion
 * @param {string} lang
 * @param {boolean} configured
 * @param {string} [obsidianVersion]
 */
function buildLocalSummary (settings, pluginVersion, lang, configured, obsidianVersion) {
  const t = normalizeTelemetry(settings)
  const attempts = t.pushed + t.errors
  const rate = attempts > 0 ? Math.round((t.pushed / attempts) * 100) : null
  const errParts = Object.entries(t.errorTypes)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${k}(${n})`)

  return {
    installId: t.installId,
    pluginVersion,
    lang,
    configured: !!configured,
    obsidianVersion: obsidianVersion || 'unknown',
    activeDays: t.activeDays,
    syncRuns: t.syncRuns,
    pushed: t.pushed,
    errors: t.errors,
    skipped: t.skipped,
    successRatePct: rate,
    errorTypes: { ...t.errorTypes },
    errorSummary: errParts.join(' · ') || '—',
    platform: typeof process !== 'undefined' ? process.platform : 'unknown'
  }
}

/**
 * @param {object} summary from buildLocalSummary
 * @param {(key: string, vars?: object) => string} tr
 */
function formatDiagnosticsText (summary, tr) {
  const lines = [
    `IMA Sync ${summary.pluginVersion}`,
    `Obsidian: ${summary.obsidianVersion || 'unknown'}`,
    `${tr('feedbackDiagActive')}: ${summary.activeDays}`,
    `${tr('feedbackDiagSyncRuns')}: ${summary.syncRuns}`,
    `${tr('feedbackDiagSuccess')}: ${summary.successRatePct != null ? `${summary.successRatePct}%` : '—'}`,
    `${tr('feedbackDiagErrors')}: ${summary.errorSummary}`,
    `platform: ${summary.platform}`,
    `install: ${summary.installId.slice(0, 8)}…`
  ]
  return lines.join('\n')
}

module.exports = {
  normalizeTelemetry,
  touchActiveDay,
  recordSyncSummary,
  recordSyncError,
  buildLocalSummary,
  formatDiagnosticsText
}
