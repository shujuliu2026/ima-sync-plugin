'use strict'

const { isProductionBuild } = require('./build-profile')

const PRO_TEST_KEYS = new Set(['IMA-PRO-TEST', 'ima-pro-selftest'])
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** @param {string} seed */
function sig8 (seed) {
  let h = 5381
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8)
}

/** @param {string} payload15 */
function licenseKeyCheckChar (payload15) {
  const s = String(payload15 || '').toUpperCase()
  let h = 0
  for (let i = 0; i < s.length; i++) {
    const idx = CROCKFORD.indexOf(s[i])
    h = (h * 33 + (idx >= 0 ? idx : s.charCodeAt(i))) % 32
  }
  return CROCKFORD[h]
}

function isLongLicenseKeyFormat (key) {
  return /^IMAPRO-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/i.test(
    String(key || '').trim()
  )
}

function verifyLongLicenseKeyChecksum (key) {
  if (!isLongLicenseKeyFormat(key)) return false
  const body = String(key).trim().replace(/^IMAPRO-/i, '').replace(/-/g, '').toUpperCase()
  if (body.length !== 16) return false
  return licenseKeyCheckChar(body.slice(0, 15)) === body[15]
}

/**
 * 客户端形态校验：仅长码校验位；测试 Key 仅非生产；短码一律无效
 * @param {string} key
 * @returns {boolean}
 */
function verifyProLicenseKey (key) {
  const trimmed = String(key || '').trim()
  if (!trimmed) return false
  if (PRO_TEST_KEYS.has(trimmed)) return !isProductionBuild()
  if (isLongLicenseKeyFormat(trimmed)) return verifyLongLicenseKeyChecksum(trimmed)
  return false
}

/**
 * 自测/演示用确定性长码（非加密随机；生产请走服务端 generateLicenseKey）
 * @param {string} [seed]
 */
function buildValidLongLicenseKey (seed = 'ima-sync-selftest') {
  let s = String(seed || 'demo')
  let payload = ''
  for (let i = 0; i < 15; i++) {
    let h = 5381
    for (let j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j) + i) >>> 0
    payload += CROCKFORD[h % 32]
    s += String(i)
  }
  const body = payload + licenseKeyCheckChar(payload)
  return `IMAPRO-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`
}

module.exports = {
  PRO_TEST_KEYS,
  verifyProLicenseKey,
  sig8,
  isLongLicenseKeyFormat,
  verifyLongLicenseKeyChecksum,
  buildValidLongLicenseKey
}
