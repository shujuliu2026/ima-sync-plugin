'use strict'

const { isProductionBuild } = require('./build-profile')

const PRO_TEST_KEYS = new Set(['IMA-PRO-TEST', 'ima-pro-selftest'])

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
 * @param {string} key
 * @returns {boolean}
 */
function verifyProLicenseKey (key) {
  const trimmed = String(key || '').trim()
  if (!trimmed) return false
  if (PRO_TEST_KEYS.has(trimmed)) return !isProductionBuild()
  const m = /^IMAPRO-([A-F0-9]{8})$/i.exec(trimmed)
  if (!m) return false
  if (isProductionBuild()) return false
  const expected = sig8(`ima-sync-pro|${trimmed.slice(0, 7)}`)
  return m[1].toUpperCase() === expected
}

module.exports = {
  PRO_TEST_KEYS,
  verifyProLicenseKey,
  sig8
}
