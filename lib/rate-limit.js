'use strict'

const { sleep } = require('./net-retry')

/** @param {string} [raw] @param {number[]} [fallbackSec] */
function parseBackoffSeconds (raw, fallbackSec = [60, 120, 300]) {
  const parts = String(raw || '')
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n > 0)
  return parts.length ? parts : fallbackSec
}

/** @param {string} [raw] */
function backoffMsList (raw) {
  return parseBackoffSeconds(raw).map(s => s * 1000)
}

module.exports = { parseBackoffSeconds, backoffMsList, sleep }
