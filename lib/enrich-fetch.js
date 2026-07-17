'use strict'

/**
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   headers?: Record<string, string>,
 *   fetchHtml?: (url: string, opts: object) => Promise<{ status: number, text: string }>
 * }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, text: string, code?: string }>}
 */
async function fetchEnrichHtml (url, opts = {}) {
  const timeoutMs = Math.max(50, Number(opts.timeoutMs) || 30000)
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    ...(opts.headers || {})
  }

  if (typeof opts.fetchHtml === 'function') {
    try {
      const r = await Promise.race([
        opts.fetchHtml(url, { headers, timeoutMs }),
        new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'FETCH_TIMEOUT' })), timeoutMs))
      ])
      const status = Number(r?.status) || 0
      const text = String(r?.text || '')
      if (status >= 200 && status < 300 && text) {
        return { ok: true, status, text }
      }
      return { ok: false, status, text, code: 'WEB_FETCH_FAILED' }
    } catch (e) {
      if (e && e.code === 'FETCH_TIMEOUT') {
        return { ok: false, status: 0, text: '', code: 'FETCH_TIMEOUT' }
      }
      return { ok: false, status: 0, text: '', code: 'WEB_FETCH_FAILED' }
    }
  }

  try {
    const { requestUrl } = require('obsidian')
    const pending = requestUrl({ url, method: 'GET', headers, throw: false })
    const res = await Promise.race([
      pending,
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'FETCH_TIMEOUT' })), timeoutMs))
    ])
    const status = Number(res?.status) || 0
    let text = ''
    if (typeof res?.text === 'string') text = res.text
    else if (typeof res?.text === 'function') text = String(await res.text())
    else text = String(res?.text || '')
    if (status >= 200 && status < 300 && text) {
      return { ok: true, status, text }
    }
    return { ok: false, status, text, code: 'WEB_FETCH_FAILED' }
  } catch (e) {
    if (e && e.code === 'FETCH_TIMEOUT') {
      return { ok: false, status: 0, text: '', code: 'FETCH_TIMEOUT' }
    }
    return { ok: false, status: 0, text: '', code: 'WEB_FETCH_FAILED' }
  }
}

module.exports = { fetchEnrichHtml }
