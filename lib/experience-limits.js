'use strict'

/**
 * Free 体验额度解析（D-IS-EXP-01 / D-IS-EXP-02 / D-IS-EXP-03）
 * - 仅「本会话云端拉取成功 + Ed25519 验签通过」才采用远程值
 * - 断网 / 拉取失败 / 篡改 → 代码默认
 * - 运维重置 → 清空本地试用计数与体验缓存
 */

const licenseSign = require('./license-sign')
const { isDevBypassEnabled } = require('./build-profile')

/** 与 notices-core / product-manifest 兜底一致 */
const DEFAULT_EXPERIENCE = Object.freeze({
  enrich_parse_per_day: 5,
  batch_notes_per_day: 50,
  format_preview_per_day: 5
})

/** @returns {string} YYYY-MM-DD local */
function todayKey (nowMs = Date.now()) {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 进程内：仅成功云端校验后置 true；不落盘（防本地改 settings 伪造） */
let liveOk = false
let liveAt = 0

/** 与 remote-notices 缓存窗对齐 */
const LIVE_TTL_MS = 30 * 60 * 1000

/**
 * @param {boolean} ok
 */
function setExperienceCloudLive (ok) {
  liveOk = !!ok
  liveAt = ok ? Date.now() : 0
}

/** @returns {boolean} */
function isExperienceCloudLive (nowMs = Date.now()) {
  if (!liveOk || !liveAt) return false
  return nowMs - liveAt < LIVE_TTL_MS
}

/**
 * @param {object} [settings]
 * @returns {boolean}
 */
function isExperiencePayloadTrusted (settings, nowMs = Date.now()) {
  if (!isExperienceCloudLive(nowMs)) return false
  const exp = settings?.remoteNotices?.experience
  if (!exp || typeof exp !== 'object') return false
  return licenseSign.verifyExperienceSignature(exp)
}

/**
 * @param {'enrich_parse_per_day'|'batch_notes_per_day'|'format_preview_per_day'} key
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number}
 */
function resolveExperienceLimit (key, settings, nowMs = Date.now()) {
  if (isExperiencePayloadTrusted(settings, nowMs)) {
    const n = Number(settings?.remoteNotices?.experience?.[key])
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  }
  if (isDevBypassEnabled()) {
    if (key === 'enrich_parse_per_day') {
      const n = Number(settings?.enrich?.freeParsePerDay)
      if (Number.isFinite(n) && n >= 0) return Math.floor(n)
    }
    if (key === 'format_preview_per_day') {
      const n = Number(settings?.format?.freePreviewPerDay)
      if (Number.isFinite(n) && n >= 0) return Math.floor(n)
    }
  }
  return DEFAULT_EXPERIENCE[key]
}

/**
 * @param {object|null|undefined} dataExperience
 * @returns {'ok'|'missing_signature'|'bad_signature'|'absent'}
 */
function classifyExperienceFetch (dataExperience) {
  if (!dataExperience || typeof dataExperience !== 'object') return 'absent'
  const sig = String(dataExperience.signature || '')
  if (!sig) return 'missing_signature'
  if (!licenseSign.verifyExperienceSignature({
    enrich_parse_per_day: dataExperience.enrich_parse_per_day,
    batch_notes_per_day: dataExperience.batch_notes_per_day,
    format_preview_per_day: dataExperience.format_preview_per_day,
    issued_at: dataExperience.issued_at,
    signature: sig
  })) {
    return 'bad_signature'
  }
  return 'ok'
}

/**
 * 写入拉取到的 experience；验签失败则不信任（额度回默认）
 * @param {object} settings
 * @param {object|null|undefined} dataExperience
 * @returns {{ ok: boolean, reason: string }}
 */
function applyFetchedExperience (settings, dataExperience) {
  const r = settings.remoteNotices
  if (!r || typeof r !== 'object') {
    setExperienceCloudLive(false)
    return { ok: false, reason: 'absent' }
  }
  const reason = classifyExperienceFetch(dataExperience)
  if (reason === 'absent') {
    setExperienceCloudLive(false)
    return { ok: false, reason }
  }
  const en = Number(dataExperience.enrich_parse_per_day)
  const bn = Number(dataExperience.batch_notes_per_day)
  const fp = Number(dataExperience.format_preview_per_day)
  r.experience = {
    enrich_parse_per_day: Number.isFinite(en) && en >= 0 ? Math.floor(en) : DEFAULT_EXPERIENCE.enrich_parse_per_day,
    batch_notes_per_day: Number.isFinite(bn) && bn >= 0 ? Math.floor(bn) : DEFAULT_EXPERIENCE.batch_notes_per_day,
    format_preview_per_day: Number.isFinite(fp) && fp >= 0 ? Math.floor(fp) : DEFAULT_EXPERIENCE.format_preview_per_day,
    issued_at: dataExperience.issued_at ? String(dataExperience.issued_at) : '',
    signature: dataExperience.signature ? String(dataExperience.signature) : ''
  }
  const ok = reason === 'ok'
  setExperienceCloudLive(ok)
  return { ok, reason: ok ? 'ok' : reason }
}

/**
 * 运维远程重置：清体验缓存与当日试用计数
 * @param {object} settings
 * @param {{ at?: string }} [reset]
 * @returns {boolean} 是否执行了重置
 */
function applyExperienceReset (settings, reset) {
  const at = String(reset?.at || '').trim()
  if (!at) return false
  const prev = String(settings.experienceResetAckAt || '')
  if (prev && Date.parse(prev) >= Date.parse(at)) return false

  markExperienceOffline()
  if (!settings.remoteNotices || typeof settings.remoteNotices !== 'object') {
    settings.remoteNotices = {}
  }
  settings.remoteNotices.experience = {
    enrich_parse_per_day: DEFAULT_EXPERIENCE.enrich_parse_per_day,
    batch_notes_per_day: DEFAULT_EXPERIENCE.batch_notes_per_day,
    format_preview_per_day: DEFAULT_EXPERIENCE.format_preview_per_day,
    issued_at: '',
    signature: ''
  }
  const today = todayKey()
  settings.formatTrialUsage = { date: today, count: 0 }
  settings.enrichTrialUsage = { date: today, count: 0 }
  settings.batchQuotaUsage = { date: today, notes: 0 }
  settings.experienceResetAckAt = at
  return true
}

/**
 * 每 install 每日最多上报 1 次篡改告警
 * @param {object} settings
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function shouldReportExperienceTamper (settings, nowMs = Date.now()) {
  const day = todayKey(nowMs)
  const last = String(settings.experienceTamperReportedOn || '')
  return last !== day
}

/** @param {object} settings @param {number} [nowMs] */
function markExperienceTamperReported (settings, nowMs = Date.now()) {
  settings.experienceTamperReportedOn = todayKey(nowMs)
}

function markExperienceOffline () {
  setExperienceCloudLive(false)
}

module.exports = {
  DEFAULT_EXPERIENCE,
  LIVE_TTL_MS,
  setExperienceCloudLive,
  isExperienceCloudLive,
  isExperiencePayloadTrusted,
  resolveExperienceLimit,
  classifyExperienceFetch,
  applyFetchedExperience,
  applyExperienceReset,
  shouldReportExperienceTamper,
  markExperienceTamperReported,
  markExperienceOffline
}
