'use strict'

const { requestUrl } = require('obsidian')
const { productId, licenseActivateUrl, licenseEntitlementsUrl } = require('./product-config')
const { normalizeTelemetry } = require('./telemetry-local')
const { verifyProLicenseKey } = require('./license-key')
const { verifyEntitlementsSignature } = require('./license-sign')
const { isProductionBuild } = require('./build-profile')
const { t } = require('./i18n')

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15000

/** @param {string} seed */
function sig8 (seed) {
  let h = 5381
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8)
}

/**
 * @param {string} fingerprint
 * @param {string} licenseKey
 */
function buildDeviceId (fingerprint, licenseKey) {
  const fp = String(fingerprint || 'unknown').slice(0, 120)
  const key = String(licenseKey || '').slice(0, 32)
  return `dev-${sig8(`ima-sync-device|${fp}|${key}`).toLowerCase()}`
}

/**
 * @param {object} ent
 */
function canonicalEntitlements (ent) {
  return {
    schema_version: ent.schema_version,
    product: ent.product,
    account_id: ent.account_id,
    tier: ent.tier,
    valid_until: ent.valid_until,
    modules: [...(ent.modules || [])].sort(),
    limits: ent.limits || {},
    issued_at: ent.issued_at
  }
}

/** @param {object} ent */
function legacySignEntitlements (ent) {
  return `v1-${sig8(`ima-sync-ent|${JSON.stringify(canonicalEntitlements(ent))}`)}`
}

/**
 * @param {string} licenseKey
 * @param {{ accountSuffix?: string }} [opts]
 */
function issueEntitlementsForKey (licenseKey, opts = {}) {
  const key = String(licenseKey || '').trim()
  const until = new Date()
  until.setUTCFullYear(until.getUTCFullYear() + 1)
  const accountSuffix = opts.accountSuffix || sig8(`acc|${key.slice(0, 16)}`).toLowerCase()
  const ent = {
    schema_version: 1,
    product: 'ima-sync',
    account_id: `acc:${accountSuffix}`,
    tier: 'ima-pro',
    valid_until: until.toISOString(),
    modules: ['core.free', 'mod.trust', 'mod.govern'],
    limits: {
      seats: 1,
      offline_grace_days: 7,
      trust_verify_enabled: true,
      trust_dedup_enabled: true,
      govern_llm_enabled: false,
      govern_llm_tokens_month: 0,
      structure_folders_max: 0,
      sync_directories_max: 0,
      white_label: false,
      priority_support: false
    },
    issued_at: new Date().toISOString(),
    signature: ''
  }
  ent.signature = legacySignEntitlements(ent)
  return ent
}

/**
 * @param {unknown} raw
 */
function normalizeEntitlementsPayload (raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_entitlements' }
  const ent = raw
  if (ent.product !== 'ima-sync') return { ok: false, error: 'bad_product' }
  if (!Array.isArray(ent.modules) || !ent.modules.length) return { ok: false, error: 'bad_modules' }
  if (!ent.tier || !ent.valid_until || !ent.issued_at) return { ok: false, error: 'bad_fields' }
  const signature = String(ent.signature || '')
  if (!signature) return { ok: false, error: 'missing_signature' }
  if (!verifyEntitlementsSignature(ent, legacySignEntitlements)) {
    return { ok: false, error: 'bad_signature' }
  }
  return { ok: true, entitlements: ent }
}

/**
 * @param {object} settings
 * @returns {string}
 */
function buildDeviceFingerprint (settings) {
  const t = normalizeTelemetry(settings)
  return `${productId}|${String(t.installId || 'unknown')}`
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
function cloudLicenseEnabled (settings) {
  if (settings?.licenseCloudEnabled === false) return false
  if (settings?.licenseMock === true && !isProductionBuild()) return true
  return Boolean(resolveActivateUrl(settings))
}

/**
 * @param {object} settings
 * @returns {string}
 */
function resolveActivateUrl (settings) {
  const custom = String(settings?.licenseApiUrl || '').trim()
  if (custom) return custom.replace(/\/activate\/?$/i, '').replace(/\/$/, '') + '/activate'
  return licenseActivateUrl || ''
}

/**
 * @param {object} settings
 * @returns {string}
 */
function resolveEntitlementsUrl (settings) {
  const custom = String(settings?.licenseApiUrl || '').trim()
  if (custom) {
    const base = custom.replace(/\/activate\/?$/i, '').replace(/\/$/, '')
    return `${base}/entitlements`
  }
  return licenseEntitlementsUrl || ''
}

/**
 * @param {object} settings
 */
function clearCloudLicenseCache (settings) {
  settings.entitlementsCache = null
  settings.entitlementsCachedAt = ''
  settings.entitlementsCacheKey = ''
  settings.licenseDeviceId = ''
  settings.licenseActivateToken = ''
}

/**
 * @param {object} settings
 * @param {{ entitlements: object, device_id?: string, activate_token?: string, licenseKey: string }} result
 */
function applyActivateResult (settings, result) {
  const norm = normalizeEntitlementsPayload(result.entitlements)
  if (!norm.ok) throw new Error(`LICENSE_ENT_${norm.error}`)
  settings.entitlementsCache = norm.entitlements
  settings.entitlementsCachedAt = new Date().toISOString()
  settings.entitlementsCacheKey = result.licenseKey
  settings.licenseDeviceId = String(result.device_id || result.activate_token || '')
  settings.licenseActivateToken = String(result.activate_token || result.device_id || '')
  settings.proActivated = true
}

/**
 * @param {string} url
 * @param {object} opts
 */
async function postJson (url, opts) {
  const req = requestUrl({
    url,
    method: opts.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    throw: false
  })
  const timer = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('IMA_LICENSE_TIMEOUT')), REQUEST_TIMEOUT_MS)
  })
  const res = await Promise.race([req, timer])
  const text = String(res.text || '')
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { status: res.status, data, text }
}

/**
 * @param {object} settings
 * @param {string} licenseKey
 */
function mockActivate (settings, licenseKey) {
  if (!verifyProLicenseKey(licenseKey)) {
    return { ok: false, error: 'invalid_license', mode: 'mock' }
  }
  const fingerprint = buildDeviceFingerprint(settings)
  const deviceId = buildDeviceId(fingerprint, licenseKey)
  const entitlements = issueEntitlementsForKey(licenseKey, {
    accountSuffix: deviceId.replace(/^dev-/, '')
  })
  return {
    ok: true,
    mode: 'mock',
    device_id: deviceId,
    activate_token: deviceId,
    entitlements
  }
}

/**
 * @param {object} settings
 * @param {string} licenseKey
 * @param {string} pluginVersion
 */
async function activateRemote (settings, licenseKey, pluginVersion) {
  const url = resolveActivateUrl(settings)
  if (!url) return { ok: false, error: 'no_license_api', mode: 'remote' }
  const fingerprint = buildDeviceFingerprint(settings)
  const { status, data } = await postJson(url, {
    method: 'POST',
    body: {
      product: 'ima-sync',
      license_key: licenseKey,
      device_fingerprint: fingerprint,
      install_id: normalizeTelemetry(settings).installId,
      plugin_version: pluginVersion
    }
  })
  if (status === 403 || data?.error === 'invalid_license') {
    return { ok: false, error: 'invalid_license', mode: 'remote', status }
  }
  if (status < 200 || status >= 300 || !data?.ok || !data?.entitlements) {
    return {
      ok: false,
      error: data?.error || 'activate_failed',
      mode: 'remote',
      status,
      message: data?.message || ''
    }
  }
  return {
    ok: true,
    mode: 'remote',
    device_id: data.device_id,
    activate_token: data.activate_token,
    entitlements: data.entitlements
  }
}

const PRO_CLOUD_ERROR_I18N = {
  seat_limit: 'proCloudErrSeatLimit',
  device_revoked: 'proCloudErrDeviceRevoked',
  license_inactive: 'proCloudErrLicenseInactive',
  device_not_found: 'proCloudErrDeviceNotFound',
  invalid_license: 'proInvalidKey'
}

/** 吊销/失效类错误：立即清缓存，避免继续享受 Pro */
const HARD_REVOKE_ERRORS = new Set([
  'license_inactive',
  'device_revoked',
  'device_not_found',
  'invalid_license',
  'device_mismatch'
])

/**
 * @param {object} settings
 * @param {{ error?: string }} result
 */
function applyHardRevokeIfNeeded (settings, result) {
  const code = String(result?.error || '').trim()
  if (!HARD_REVOKE_ERRORS.has(code)) return
  clearCloudLicenseCache(settings)
  settings.proActivated = false
}

/**
 * @param {object} settings
 * @param {{ error?: string, message?: string }} result
 * @returns {string}
 */
function formatProCloudError (settings, result) {
  const code = String(result?.error || '').trim()
  const key = PRO_CLOUD_ERROR_I18N[code]
  if (key) return t(settings, key)
  return String(result?.message || result?.error || t(settings, 'proInvalidKey'))
}

/**
 * @param {object} settings
 * @param {string} licenseKey
 * @param {string} pluginVersion
 */
async function refreshRemote (settings, licenseKey, pluginVersion) {
  const url = resolveEntitlementsUrl(settings)
  if (!url) return { ok: false, error: 'no_license_api' }
  const fingerprint = buildDeviceFingerprint(settings)
  const qs = new URLSearchParams({
    product: 'ima-sync',
    license_key: licenseKey,
    device_id: settings.licenseDeviceId || '',
    device_fingerprint: fingerprint,
    install_id: normalizeTelemetry(settings).installId || '',
    plugin_version: pluginVersion || ''
  })
  const { status, data } = await postJson(`${url}?${qs.toString()}`, { method: 'GET' })
  if (status < 200 || status >= 300 || !data?.ok || !data?.entitlements) {
    return { ok: false, error: data?.error || 'refresh_failed', status }
  }
  return {
    ok: true,
    device_id: data.device_id || settings.licenseDeviceId,
    activate_token: settings.licenseActivateToken,
    entitlements: data.entitlements
  }
}

/**
 * @param {object} settings
 * @param {{ pluginVersion?: string }} [opts]
 */
async function activateProLicenseCloud (settings, opts = {}) {
  const licenseKey = String(settings?.proLicenseKey || '').trim()
  const pluginVersion = String(opts.pluginVersion || '')

  if (!licenseKey) {
    clearCloudLicenseCache(settings)
    settings.proActivated = false
    return { ok: false, error: 'empty_key', mode: 'none' }
  }

  if (settings.entitlementsCacheKey && settings.entitlementsCacheKey !== licenseKey) {
    clearCloudLicenseCache(settings)
  }

  if (!cloudLicenseEnabled(settings)) {
    settings.proActivated = verifyProLicenseKey(licenseKey)
    return {
      ok: settings.proActivated,
      mode: 'legacy',
      error: settings.proActivated ? '' : 'invalid_license'
    }
  }

  const result = settings.licenseMock === true && !isProductionBuild()
    ? mockActivate(settings, licenseKey)
    : await activateRemote(settings, licenseKey, pluginVersion)

  if (result.ok) {
    applyActivateResult(settings, { ...result, licenseKey })
    return result
  }

  applyHardRevokeIfNeeded(settings, result)

  if (!isProductionBuild() && verifyProLicenseKey(licenseKey)) {
    settings.proActivated = true
    return { ...result, fallback: 'legacy' }
  }

  clearCloudLicenseCache(settings)
  settings.proActivated = false
  return result
}

/**
 * @param {object} settings
 * @param {string} pluginVersion
 */
async function maybeRefreshCloudEntitlements (settings, pluginVersion) {
  const licenseKey = String(settings?.proLicenseKey || '').trim()
  if (!licenseKey || !cloudLicenseEnabled(settings)) return { ok: false, skipped: true }
  if (!settings.entitlementsCache || settings.entitlementsCacheKey !== licenseKey) {
    return activateProLicenseCloud(settings, { pluginVersion })
  }
  const cachedAt = Date.parse(settings.entitlementsCachedAt || '')
  if (Number.isFinite(cachedAt) && Date.now() - cachedAt < REFRESH_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: 'fresh' }
  }
  const result = settings.licenseMock === true && !isProductionBuild()
    ? mockActivate(settings, licenseKey)
    : await refreshRemote(settings, licenseKey, pluginVersion)
  if (result.ok) {
    applyActivateResult(settings, { ...result, licenseKey })
  } else {
    applyHardRevokeIfNeeded(settings, result)
  }
  return result
}

module.exports = {
  REFRESH_INTERVAL_MS,
  buildDeviceFingerprint,
  cloudLicenseEnabled,
  resolveActivateUrl,
  resolveEntitlementsUrl,
  clearCloudLicenseCache,
  applyActivateResult,
  activateProLicenseCloud,
  maybeRefreshCloudEntitlements,
  mockActivate,
  normalizeEntitlementsPayload,
  issueEntitlementsForKey,
  legacySignEntitlements,
  formatProCloudError,
  applyHardRevokeIfNeeded,
  HARD_REVOKE_ERRORS
}
