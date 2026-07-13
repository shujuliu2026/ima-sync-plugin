'use strict'

/**
 * 生产构建守卫：默认收紧 legacy/mock 绕过；仅 selftest 或 IMA_SYNC_DEV_BYPASS=1 时放开。
 * bundle.mjs 通过 esbuild define 注入 __IMA_SYNC_PRODUCTION__。
 */
function isDevBypassEnabled () {
  if (typeof globalThis !== 'undefined' && globalThis.__IMA_SYNC_DEV_BYPASS__ === true) {
    return true
  }
  try {
    if (typeof process !== 'undefined' && process?.env?.IMA_SYNC_DEV_BYPASS === '1') {
      return true
    }
  } catch { /* Obsidian 环境可能无 process */ }
  return false
}

function isProductionBuild () {
  if (isDevBypassEnabled()) return false
  // eslint-disable-next-line no-undef
  if (typeof __IMA_SYNC_PRODUCTION__ !== 'undefined') {
    // eslint-disable-next-line no-undef
    return __IMA_SYNC_PRODUCTION__ === true || __IMA_SYNC_PRODUCTION__ === 'true'
  }
  return true
}

module.exports = {
  isDevBypassEnabled,
  isProductionBuild
}
