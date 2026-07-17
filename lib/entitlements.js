'use strict'

const { verifyProLicenseKey } = require('./license-key')
const { verifyEntitlementsSignature } = require('./license-sign')
const { isProductionBuild } = require('./build-profile')

/** @typedef {import('./entitlements').ImaSyncEntitlements} ImaSyncEntitlements */

const MODULE_CORE_FREE = 'core.free'
const MODULE_TRUST = 'mod.trust'
const MODULE_GOVERN = 'mod.govern'
const MODULE_GOVERN_LLM = 'mod.govern.llm'
const MODULE_STRUCTURE = 'mod.structure'
const MODULE_FORMAT = 'mod.format'
const MODULE_ENRICH = 'mod.enrich'
const MODULE_WHITELABEL = 'mod.whitelabel'
const MODULE_ANALYTICS_PRIVATE = 'mod.analytics.private'

const TIER_FREE = 'free'
const TIER_PRO = 'ima-pro'

/** @type {ImaSyncEntitlements} */
const FREE_ENTITLEMENTS = Object.freeze({
  schema_version: 1,
  product: 'ima-sync',
  account_id: 'local:free',
  tier: TIER_FREE,
  valid_until: '2099-12-31T23:59:59.000Z',
  modules: [MODULE_CORE_FREE],
  limits: Object.freeze({
    seats: 0,
    offline_grace_days: 7,
    trust_verify_enabled: false,
    trust_dedup_enabled: false,
    govern_llm_enabled: false,
    govern_llm_tokens_month: 0,
    structure_folders_max: 0,
    sync_directories_max: 1,
    /** 免费：知识库条数上限 */
    kb_libraries_max: 1,
    /** 免费：每日批量上传合计篇数；「同步当前文档」不计 */
    batch_notes_per_day: 50,
    white_label: false,
    priority_support: false
  }),
  signature: 'local:free',
  issued_at: '1970-01-01T00:00:00.000Z',
  _source: 'free'
})

/** @type {ImaSyncEntitlements} */
const LEGACY_PRO_ENTITLEMENTS = Object.freeze({
  schema_version: 1,
  product: 'ima-sync',
  account_id: 'local:legacy-pro',
  tier: TIER_PRO,
  valid_until: '2099-12-31T23:59:59.000Z',
  modules: [MODULE_CORE_FREE, MODULE_TRUST, MODULE_GOVERN, MODULE_FORMAT, MODULE_ENRICH],
  limits: Object.freeze({
    seats: 1,
    offline_grace_days: 7,
    trust_verify_enabled: true,
    trust_dedup_enabled: true,
    govern_llm_enabled: false,
    govern_llm_tokens_month: 0,
    structure_folders_max: 0,
    sync_directories_max: 0,
    kb_libraries_max: 0,
    batch_notes_per_day: 0,
    white_label: false,
    priority_support: false
  }),
  signature: 'local:legacy-pro',
  issued_at: '1970-01-01T00:00:00.000Z',
  _source: 'legacy-key'
})

/**
 * @param {string|undefined|null} iso
 * @returns {number}
 */
function parseTime (iso) {
  const t = Date.parse(String(iso || ''))
  return Number.isFinite(t) ? t : 0
}

/**
 * @param {object} [settings]
 * @returns {boolean}
 */
function isMockPro (settings) {
  if (isProductionBuild()) return false
  return settings?.mockPro === true
}

/**
 * @param {object} [settings]
 * @returns {ImaSyncEntitlements|null}
 */
function readCloudCache (settings) {
  const raw = settings?.entitlementsCache
  if (!raw || typeof raw !== 'object') return null
  if (raw.product !== 'ima-sync') return null
  if (!Array.isArray(raw.modules) || !raw.modules.length) return null
  const bound = String(settings?.entitlementsCacheKey || '').trim()
  const current = String(settings?.proLicenseKey || '').trim()
  if (bound && current && bound !== current) return null
  const { legacySignEntitlements } = require('./license-cloud')
  if (!verifyEntitlementsSignature(raw, legacySignEntitlements)) return null
  return { ...raw, _source: 'cloud-cache' }
}

/**
 * D-LIC-17b：生产 + 云端授权开启时，禁止仅凭校验位合法 Key 解锁 Pro。
 * 非生产 / 显式关闭云端 / mockPro 仍可用于自测。
 * @param {object} [settings]
 * @returns {boolean}
 */
function legacyKeyUnlockAllowed (settings) {
  if (!isProductionBuild()) return true
  if (settings?.licenseCloudEnabled === false) return true
  const { cloudLicenseEnabled } = require('./license-cloud')
  return !cloudLicenseEnabled(settings)
}

/**
 * @param {object} [settings]
 * @returns {ImaSyncEntitlements|null}
 */
function synthesizeLegacyPro (settings) {
  if (isMockPro(settings)) {
    return { ...LEGACY_PRO_ENTITLEMENTS, _source: 'mock-pro' }
  }
  if (!legacyKeyUnlockAllowed(settings)) return null
  const key = String(settings?.proLicenseKey || '').trim()
  if (!key) return null
  if (!verifyProLicenseKey(key)) return null
  return {
    ...LEGACY_PRO_ENTITLEMENTS,
    account_id: `local:key:${key.slice(0, 12)}`,
    issued_at: new Date().toISOString(),
    _source: 'legacy-key'
  }
}

/**
 * @param {ImaSyncEntitlements} ent
 * @param {number} [nowMs]
 * @returns {'active'|'grace'|'expired'}
 */
function entitlementStatus (ent, nowMs = Date.now()) {
  const until = parseTime(ent.valid_until)
  if (!until || nowMs <= until) return 'active'
  const graceDays = Math.max(0, Number(ent.limits?.offline_grace_days) || 7)
  const graceUntil = until + graceDays * 86400000
  if (nowMs <= graceUntil) return 'grace'
  return 'expired'
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {ImaSyncEntitlements}
 */
function getEffectiveEntitlements (settings, nowMs = Date.now()) {
  const cloud = readCloudCache(settings)
  if (cloud) {
    const status = entitlementStatus(cloud, nowMs)
    if (status === 'active' || status === 'grace') {
      return { ...cloud, _status: status }
    }
  }

  const legacy = synthesizeLegacyPro(settings)
  if (legacy) return legacy

  return { ...FREE_ENTITLEMENTS, _status: 'active' }
}

/**
 * @param {ImaSyncEntitlements} ent
 * @param {string} moduleId
 * @returns {boolean}
 */
function entHasModule (ent, moduleId) {
  return Array.isArray(ent.modules) && ent.modules.includes(moduleId)
}

/**
 * @param {object} [settings]
 * @param {string} moduleId
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function hasModule (settings, moduleId, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  if (ent._status === 'expired') {
    return moduleId === MODULE_CORE_FREE
  }
  return entHasModule(ent, moduleId)
}

/**
 * @param {object} settings
 * @param {string} limitKey
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isLimitEnabled (settings, limitKey, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  if (ent._status === 'expired') return false
  return ent.limits?.[limitKey] === true
}

/**
 * @param {object} settings
 * @param {string} limitKey
 * @param {number} [nowMs]
 * @returns {number}
 */
function limitNumber (settings, limitKey, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  if (ent._status === 'expired') return 0
  const n = Number(ent.limits?.[limitKey])
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function isProActive (settings, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  return ent.tier !== TIER_FREE && ent._status !== 'expired'
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseTrust (settings) {
  if (!hasModule(settings, MODULE_TRUST)) return false
  return true
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseGovern (settings) {
  return hasModule(settings, MODULE_GOVERN)
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseGovernLlm (settings) {
  return hasModule(settings, MODULE_GOVERN_LLM) && isLimitEnabled(settings, 'govern_llm_enabled')
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseStructure (settings) {
  return hasModule(settings, MODULE_STRUCTURE) && limitNumber(settings, 'structure_folders_max') > 0
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseFormatFull (settings) {
  return hasModule(settings, MODULE_FORMAT)
}

/**
 * Enrich（链接解析富化）· Pro 同档（D-IS-ENR-01g）
 * @param {object} settings
 * @returns {boolean}
 */
function canUseEnrich (settings) {
  return hasModule(settings, MODULE_ENRICH)
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function canUseWhiteLabel (settings) {
  return hasModule(settings, MODULE_WHITELABEL) && isLimitEnabled(settings, 'white_label')
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function trustVerifyAllowed (settings) {
  return canUseTrust(settings) && isLimitEnabled(settings, 'trust_verify_enabled')
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function trustDedupAllowed (settings) {
  return canUseTrust(settings) && isLimitEnabled(settings, 'trust_dedup_enabled')
}

/**
 * 同步目录上限；0 = 不限（Pro）
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number}
 */
function syncDirectoriesMax (settings, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  if (ent._status === 'expired') return 1
  const n = Number(ent.limits?.sync_directories_max)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * @param {object} [settings]
 * @param {number} currentCount
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function canAddSyncDirectory (settings, currentCount, nowMs = Date.now()) {
  const max = syncDirectoriesMax(settings, nowMs)
  if (max === 0) return true
  return currentCount < max
}

/**
 * 按权益裁剪 syncFolders（超限时只保留前 N 个）
 * @param {object} [settings]
 * @param {string[]|null|undefined} rawFolders
 * @param {number} [nowMs]
 * @returns {string[]}
 */
function effectiveSyncFolders (settings, rawFolders, nowMs = Date.now()) {
  const list = Array.isArray(rawFolders) ? rawFolders.filter(f => f != null && f !== '') : []
  const max = syncDirectoriesMax(settings, nowMs)
  if (max === 0) return list
  return list.slice(0, max)
}

/**
 * 知识库条数上限；0 = 不限（Pro）
 * @param {object} [settings]
 * @param {number} [nowMs]
 * @returns {number}
 */
function kbLibrariesMax (settings, nowMs = Date.now()) {
  const ent = getEffectiveEntitlements(settings, nowMs)
  if (ent._status === 'expired') return 1
  const n = Number(ent.limits?.kb_libraries_max)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.floor(n)
}

/**
 * @param {object} [settings]
 * @param {number} currentCount
 * @param {number} [nowMs]
 * @returns {boolean}
 */
function canAddKbLibrary (settings, currentCount, nowMs = Date.now()) {
  const max = kbLibrariesMax(settings, nowMs)
  if (max === 0) return true
  return currentCount < max
}

/**
 * 按权益裁剪 kbLibraries（超限时只保留前 N 个）
 * @param {object} [settings]
 * @param {Array<{id?: string, label?: string}>|null|undefined} rawLibs
 * @param {number} [nowMs]
 * @returns {Array<{id: string, label: string}>}
 */
function effectiveKbLibraries (settings, rawLibs, nowMs = Date.now()) {
  const list = Array.isArray(rawLibs)
    ? rawLibs.filter((k) => k && String(k.id || '').trim())
      .map((k) => ({
        id: String(k.id).trim(),
        label: String(k.label || k.id).trim() || String(k.id).trim()
      }))
    : []
  const max = kbLibrariesMax(settings, nowMs)
  if (max === 0) return list
  return list.slice(0, max)
}

/**
 * @param {object} settings
 * @returns {{ tier: string, status: string, modules: string[], source: string }}
 */
function summarizeEntitlements (settings) {
  const ent = getEffectiveEntitlements(settings)
  return {
    tier: ent.tier,
    status: ent._status || entitlementStatus(ent),
    modules: [...(ent.modules || [])],
    source: ent._source || 'unknown'
  }
}

const TIER_I18N = {
  free: 'entTierFree',
  'ima-pro': 'entTierPro',
  'ima-pro-team': 'entTierProTeam',
  'ima-enterprise': 'entTierEnterprise'
}

const MODULE_I18N = {
  [MODULE_CORE_FREE]: 'entModCoreFree',
  [MODULE_TRUST]: 'entModTrust',
  [MODULE_GOVERN]: 'entModGovern',
  [MODULE_FORMAT]: 'entModFormat',
  [MODULE_ENRICH]: 'entModEnrich',
  [MODULE_GOVERN_LLM]: 'entModGovernLlm',
  [MODULE_STRUCTURE]: 'entModStructure',
  [MODULE_WHITELABEL]: 'entModWhitelabel',
  [MODULE_ANALYTICS_PRIVATE]: 'entModAnalyticsPrivate'
}

const STATUS_I18N = {
  active: 'entStatusActive',
  grace: 'entStatusGrace',
  expired: 'entStatusExpired'
}

/**
 * @param {object} settings
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @returns {{
 *   tier: string,
 *   tierLabel: string,
 *   status: string,
 *   statusLabel: string,
 *   source: string,
 *   modules: Array<{ id: string, label: string }>,
 *   limitsNote: string
 * }}
 */
function buildEntitlementBarModel (settings, tr) {
  const ent = getEffectiveEntitlements(settings)
  const status = ent._status || entitlementStatus(ent)
  const modules = (ent.modules || [])
    .filter(m => m !== MODULE_CORE_FREE)
    .map(m => ({ id: m, label: tr(MODULE_I18N[m] || m) }))
  /** @type {string[]} */
  const limitParts = []
  if (entHasModule(ent, MODULE_TRUST)) {
    if (ent.limits?.trust_dedup_enabled === false) limitParts.push(tr('entLimitDedupOff'))
    if (ent.limits?.trust_verify_enabled === false) limitParts.push(tr('entLimitVerifyOff'))
  }
  if (entHasModule(ent, MODULE_GOVERN) && ent.limits?.govern_llm_enabled === false && !entHasModule(ent, MODULE_GOVERN_LLM)) {
    limitParts.push(tr('entLimitGovernLocalOnly'))
  }
  const syncMax = Number(ent.limits?.sync_directories_max)
  if (Number.isFinite(syncMax) && syncMax > 0) {
    limitParts.push(tr('entLimitSyncDirsMax', { n: syncMax }))
  }
  const kbMax = Number(ent.limits?.kb_libraries_max)
  if (Number.isFinite(kbMax) && kbMax > 0) {
    limitParts.push(tr('entLimitKbMax', { n: kbMax }))
  }
  const batchMax = Number(ent.limits?.batch_notes_per_day)
  if (Number.isFinite(batchMax) && batchMax > 0) {
    limitParts.push(tr('entLimitBatchNotesDay', { n: batchMax }))
  }
  return {
    tier: ent.tier,
    tierLabel: tr(TIER_I18N[ent.tier] || 'entTierUnknown'),
    status,
    statusLabel: tr(STATUS_I18N[status] || 'entStatusUnknown'),
    source: ent._source || 'unknown',
    modules,
    limitsNote: limitParts.join(' · ')
  }
}

module.exports = {
  MODULE_CORE_FREE,
  MODULE_TRUST,
  MODULE_GOVERN,
  MODULE_FORMAT,
  MODULE_ENRICH,
  MODULE_GOVERN_LLM,
  MODULE_STRUCTURE,
  MODULE_WHITELABEL,
  MODULE_ANALYTICS_PRIVATE,
  TIER_FREE,
  TIER_PRO,
  FREE_ENTITLEMENTS,
  LEGACY_PRO_ENTITLEMENTS,
  parseTime,
  entitlementStatus,
  getEffectiveEntitlements,
  hasModule,
  isLimitEnabled,
  limitNumber,
  isProActive,
  canUseTrust,
  canUseGovern,
  canUseFormatFull,
  canUseEnrich,
  canUseGovernLlm,
  canUseStructure,
  canUseWhiteLabel,
  trustVerifyAllowed,
  trustDedupAllowed,
  syncDirectoriesMax,
  canAddSyncDirectory,
  effectiveSyncFolders,
  kbLibrariesMax,
  canAddKbLibrary,
  effectiveKbLibraries,
  summarizeEntitlements,
  buildEntitlementBarModel,
  readCloudCache,
  synthesizeLegacyPro,
  legacyKeyUnlockAllowed
}
