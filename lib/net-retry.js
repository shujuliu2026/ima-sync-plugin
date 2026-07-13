'use strict'

/** @param {string} msg */
function isNetworkErrorMessage (msg) {
  const text = String(msg || '')
  return /无法连接 IMA|failed to fetch|networkerror|load failed|net::|IMA_TIMEOUT|ECONNRESET|ETIMEDOUT|ENOTFOUND|网络异常|network/i.test(text)
}

/** @param {unknown} err */
function isRetryableNetworkError (err) {
  const msg = String(err?.message || err || '')
  if (msg.startsWith('IMA_QUOTA_EXCEEDED') || msg.startsWith('IMA_RATE_LIMIT')) return false
  if (/IMA_HTTP_(401|403):/.test(msg)) return false
  if (/密钥无效|无权访问/.test(msg)) return false
  return isNetworkErrorMessage(msg)
}

/** @param {number} ms */
function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * @param {() => Promise<T>} fn
 * @param {{ maxRetries?: number, retryDelayMs?: number, onRetry?: (attempt: number, max: number, delay: number, err: unknown) => void }} [opts]
 * @returns {Promise<T>}
 */
async function withNetworkRetry (fn, opts = {}) {
  const max = Math.max(0, Number(opts.maxRetries ?? 3))
  const baseDelay = Math.max(200, Number(opts.retryDelayMs ?? 1500))
  const onRetry = opts.onRetry || (() => {})
  let lastErr

  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= max || !isRetryableNetworkError(err)) throw err
      const delay = Math.round(baseDelay * Math.pow(2, attempt) + Math.random() * 200)
      onRetry(attempt + 1, max, delay, err)
      await sleep(delay)
    }
  }
  throw lastErr
}

module.exports = { isNetworkErrorMessage, isRetryableNetworkError, withNetworkRetry, sleep }
