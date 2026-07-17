'use strict'

/**
 * @param {number} status
 * @param {number|string|undefined} code
 * @param {string} msg
 * @returns {'quota'|'rate'|null}
 */
function classifyImaError (status, code, msg) {
  const text = String(msg || '')
  const c = code !== undefined && code !== null && code !== '' ? Number(code) : NaN

  if (
    status === 429 ||
    c === 429 ||
    c === 20002 ||
    /429|限频|频率超限|请求频率|过于频繁|rate.?limit|too many|try again later/i.test(text)
  ) {
    return 'rate'
  }
  if (
    /超量|明日再试|超过.*次数|同步次数|quota|daily.*limit|volume exceeded/i.test(text) ||
    (status === 403 && /超量|明日|次数/i.test(text))
  ) {
    return 'quota'
  }
  // 腾讯 IMA 偶发把限频/超量打成 HTTP 403；文案未命中时仍按可中止类错误处理
  if (status === 403 && /超限|频繁|稍后|明日/i.test(text)) {
    return /明日|超量|次数/i.test(text) ? 'quota' : 'rate'
  }
  return null
}

/**
 * @param {number} status
 * @param {number|string|undefined} code
 * @param {string} msg
 */
function buildImaHttpError (status, code, msg) {
  const kind = classifyImaError(status, code, msg)
  if (kind === 'quota') return new Error('IMA_QUOTA_EXCEEDED: 超过今日同步次数，请明日再试')
  if (kind === 'rate') {
    const hint = status === 429 ? '（HTTP 429）' : ''
    return new Error(`IMA_RATE_LIMIT: 请求过于频繁${hint}，请 1–5 分钟后再试`)
  }
  return new Error(`IMA_HTTP_${status}: ${msg}`)
}

/**
 * @param {unknown} err
 * @returns {{ kind: 'quota'|'rate', message: string } | null}
 */
function parseImaError (err) {
  const msg = String(err?.message || err || '')
  if (msg.startsWith('IMA_QUOTA_EXCEEDED')) {
    return { kind: 'quota', message: msg.replace(/^IMA_QUOTA_EXCEEDED:\s*/, '') || '超过今日同步次数，请明日再试' }
  }
  if (msg.startsWith('IMA_RATE_LIMIT')) {
    return { kind: 'rate', message: msg.replace(/^IMA_RATE_LIMIT:\s*/, '') || '请求过于频繁，请稍后再试' }
  }
  const m = msg.match(/^IMA_HTTP_(\d+):\s*(.+)$/)
  if (m) {
    const kind = classifyImaError(Number(m[1]), undefined, m[2])
    if (kind === 'quota') return { kind, message: '超过今日同步次数，请明日再试' }
    if (kind === 'rate') return { kind, message: '请求过于频繁，请稍后再试' }
  }
  if (/超量|明日再试|超过.*同步次数/.test(msg)) {
    return { kind: 'quota', message: '超过今日同步次数，请明日再试' }
  }
  if (/20002|限频|频率超限|请求频率|过于频繁/.test(msg)) {
    return { kind: 'rate', message: '请求过于频繁，请稍后再试' }
  }
  if (isImaAuthError(msg)) {
    return { kind: 'auth', message: msg.replace(/^IMA_AUTH:\s*/i, '') || '鉴权失败，请检查 Client ID / API Key' }
  }
  return null
}

/** @param {unknown} err */
function isSyncLimitError (err) {
  const kind = parseImaError(err)?.kind
  return kind === 'quota' || kind === 'rate'
}

/**
 * 鉴权失败、限频、超量等「系统性」错误：应中止整批，勿把未推笔记逐条标成失败。
 * @param {unknown} err
 */
function isSystemicBatchError (err) {
  const kind = parseImaError(err)?.kind
  return kind === 'quota' || kind === 'rate' || kind === 'auth'
}

/**
 * 笔记上的失败标记是否来自系统性错误（可安全重置为待推）。
 * @param {unknown} msg
 */
function isSystemicFailedMark (msg) {
  const text = String(msg?.message || msg || '')
  if (!text) return false
  return isSystemicBatchError(text) || isImaAuthError(text)
}

/**
 * @param {unknown} msg
 */
function isImaAuthError (msg) {
  const text = String(msg?.message || msg || '')
  return (
    /^IMA_AUTH:/i.test(text) ||
    /skill auth failed|鉴权失败|auth failed|unauthorized|invalid.*apikey|invalid.*client/i.test(text)
  )
}

module.exports = {
  classifyImaError,
  buildImaHttpError,
  parseImaError,
  isSyncLimitError,
  isSystemicBatchError,
  isSystemicFailedMark,
  isImaAuthError
}
