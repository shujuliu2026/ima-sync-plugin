'use strict'

const { isImaAuthError } = require('./ima-errors')

/**
 * @param {unknown} err
 */
function captureTrustAuthError (err) {
  const msg = String(err?.message || err || '')
  if (!isImaAuthError(msg)) return null
  return msg.replace(/^IMA_AUTH:\s*/i, '').trim() || msg
}

/**
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @param {string} [raw]
 */
function formatTrustAuthHint (tr, raw) {
  const detail = String(raw || '').trim()
  if (!detail) return tr('trustAuthFailed')
  if (/skill auth failed/i.test(detail)) return tr('trustAuthSkillFailed')
  return `${tr('trustAuthFailed')}: ${detail.slice(0, 100)}`
}

/**
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @param {string} [raw]
 */
function formatVerifyDetail (tr, raw) {
  const detail = String(raw || '').trim()
  if (!detail) return ''
  if (/AUTH_FAILED/i.test(detail)) {
    return formatTrustAuthHint(tr, detail.replace(/^AUTH_FAILED:\s*/i, ''))
  }
  return tr('trustVerifyDetail', { detail: detail.slice(0, 120) })
}

/**
 * @param {string} [detail]
 * @returns {'auth'|'not_found'|'other'}
 */
function verifyDetailKind (detail) {
  const d = String(detail || '')
  if (/AUTH_FAILED/i.test(d)) return 'auth'
  if (/NOT_FOUND/i.test(d)) return 'not_found'
  return 'other'
}

module.exports = { captureTrustAuthError, formatTrustAuthHint, isImaAuthError, formatVerifyDetail, verifyDetailKind }
