'use strict'

const { noteFileName } = require('./trust-dedup')
const { captureTrustAuthError } = require('./trust-auth')

/**
 * @returns {import('./trust-capabilities').TrustCapabilities}
 */
function emptyCapabilities () {
  return {
    checkedAt: '',
    base: null,
    dedup: null,
    verify: null,
    canDedup: false,
    canVerify: false,
    readyLevel: 'unknown',
    errors: {}
  }
}

/**
 * @param {{ base?: boolean|null, dedup?: boolean|null, verify?: boolean|null, errors?: object, checkedAt?: string }} caps
 */
function summarizeCapabilities (caps) {
  const base = caps.base === true
  const dedup = caps.dedup === true
  const verify = caps.verify === true
  /** @type {'full'|'partial'|'push-only'|'blocked'|'unknown'} */
  let readyLevel = 'unknown'
  if (verify && dedup) readyLevel = 'full'
  else if (dedup || verify) readyLevel = 'partial'
  else if (base) readyLevel = 'push-only'
  else if (caps.base === false) readyLevel = 'blocked'
  return {
    checkedAt: caps.checkedAt || new Date().toISOString(),
    base: caps.base ?? null,
    dedup: caps.dedup ?? null,
    verify: caps.verify ?? null,
    canDedup: dedup,
    canVerify: verify,
    readyLevel,
    errors: caps.errors || {}
  }
}

/**
 * @param {import('./ima-api').ImaApiClient} client
 * @param {object} settings
 */
async function probeTrustCapabilities (client, settings) {
  /** @type {Record<string, string>} */
  const errors = {}
  let base = null
  let dedup = null
  let verify = null

  try {
    if (typeof client.listKnowledgeBases === 'function') {
      await client.listKnowledgeBases({ limit: 1 })
    } else {
      await client.searchKnowledge('', { limit: 1 })
    }
    base = true
  } catch (err) {
    base = false
    errors.base = captureTrustAuthError(err) || String(err?.message || err).slice(0, 120)
  }

  const probeName = noteFileName(`__ima-cap-probe-${Date.now()}`, 'probe')
  try {
    await client.checkRepeatedNames([{ name: probeName, media_type: 11 }])
    dedup = true
  } catch (err) {
    dedup = false
    errors.dedup = captureTrustAuthError(err) || String(err?.message || err).slice(0, 120)
  }

  try {
    const { items } = await client.searchKnowledge('测试', { limit: 3 })
    verify = Array.isArray(items)
    if (!verify) errors.verify = 'bad response'
  } catch (err) {
    verify = false
    errors.verify = captureTrustAuthError(err) || String(err?.message || err).slice(0, 120)
  }

  return summarizeCapabilities({ base, dedup, verify, errors })
}

/**
 * @param {import('./trust-capabilities').TrustCapabilities | null | undefined} caps
 */
function shouldRunDedup (caps) {
  if (!caps?.checkedAt) return true
  return caps.canDedup === true
}

/**
 * @param {import('./trust-capabilities').TrustCapabilities | null | undefined} caps
 */
function shouldRunVerify (caps) {
  if (!caps?.checkedAt) return true
  return caps.canVerify === true
}

/**
 * @param {import('./trust-capabilities').TrustCapabilities | null | undefined} caps
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatCapabilitySummary (caps, tr) {
  if (!caps?.checkedAt) return tr('trustCapUnknown')
  const parts = [
    `${tr('trustCapBase')}${capIcon(caps.base)}`,
    `${tr('trustCapDedup')}${capIcon(caps.dedup)}`,
    `${tr('trustCapVerify')}${capIcon(caps.verify)}`
  ]
  return parts.join(' · ')
}

/** @param {boolean|null|undefined} ok */
function capIcon (ok) {
  if (ok === true) return ' ✓'
  if (ok === false) return ' ✗'
  return ' ?'
}

/**
 * @param {import('./trust-capabilities').TrustCapabilities | null | undefined} caps
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatReadyLevelHint (caps, tr) {
  if (!caps?.checkedAt) return tr('trustCapHintUnknown')
  const key = {
    full: 'trustCapHintFull',
    partial: 'trustCapHintPartial',
    'push-only': 'trustCapHintPushOnly',
    blocked: 'trustCapHintBlocked',
    unknown: 'trustCapHintUnknown'
  }[caps.readyLevel] || 'trustCapHintUnknown'
  return tr(key)
}

module.exports = {
  emptyCapabilities,
  summarizeCapabilities,
  probeTrustCapabilities,
  shouldRunDedup,
  shouldRunVerify,
  formatCapabilitySummary,
  formatReadyLevelHint,
  capIcon
}
