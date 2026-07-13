'use strict'

const { requestUrl } = require('obsidian')
const { md5Hex, parseServerMd5 } = require('./md5')
const { sponsorBases, sponsorBase, brandSiteHost, sponsorAssetPath } = require('./product-config')

const SPONSOR_ASSET_PATH = sponsorAssetPath
const SPONSOR_HOST = brandSiteHost
/** 优先 HTTPS；生产未签证书时回退 HTTP（同一 host + MD5 校验） */
const SPONSOR_BASES = sponsorBases
const SPONSOR_BASE = sponsorBase
/** 官方打赏图（写死在代码中，不可经 settings 修改） */
const SPONSOR_QR_URL = `${SPONSOR_BASE}/sponsor-alipay.png`
/** 服务器 MD5 sidecar（与 PNG 同步发布） */
const SPONSOR_MD5_URL = `${SPONSOR_BASE}/sponsor-alipay.md5`

const REQUEST_TIMEOUT_MS = 12000

/**
 * @param {import('obsidian').RequestUrlResponsePromise} pending
 * @param {'arrayBuffer' | 'text'} field
 * @returns {Promise<ArrayBuffer | string | null>}
 */
async function readPendingBody (pending, field) {
  const fn = pending?.[field]
  if (typeof fn !== 'function') return null
  try {
    const raw = await fn.call(pending)
    if (field === 'text') return typeof raw === 'string' ? raw : String(raw ?? '')
    return raw ?? null
  } catch {
    return null
  }
}

/**
 * @param {string} url
 * @param {'binary' | 'text'} kind
 * @returns {Promise<{ status: number, body: ArrayBuffer | string | null } | null>}
 */
async function requestGet (url, kind) {
  const pending = requestUrl({
    url,
    method: 'GET',
    throw: false,
    headers: {
      Accept: kind === 'binary'
        ? 'image/png,application/octet-stream,*/*'
        : 'text/plain,*/*'
    }
  })
  const earlyBody = kind === 'binary'
    ? readPendingBody(pending, 'arrayBuffer')
    : readPendingBody(pending, 'text')

  const timer = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('SPONSOR_QR_TIMEOUT')), REQUEST_TIMEOUT_MS)
  })

  let res
  try {
    res = await Promise.race([pending, timer])
  } catch {
    return null
  }
  if (!res || res.status < 200 || res.status >= 300) return null

  let body = await earlyBody
  if (kind === 'binary') {
    body = body || await resolveArrayBuffer(res)
  } else {
    body = body || await resolveText(res)
  }
  return { status: res.status, body }
}

/**
 * Obsidian requestUrl 的 body 字段可能是 Promise 或 async 方法，需正确解析。
 * @param {Record<string, unknown> | null | undefined} res
 * @param {'arrayBuffer' | 'text'} field
 * @returns {Promise<ArrayBuffer | string | null>}
 */
async function resolveBodyField (res, field) {
  const v = res?.[field]
  if (v == null) return field === 'text' ? '' : null
  const raw = typeof v === 'function' ? await v.call(res) : await v
  if (field === 'text') return String(raw ?? '')
  return raw ?? null
}

/**
 * @param {{ arrayBuffer?: ArrayBuffer | Promise<ArrayBuffer> | (() => Promise<ArrayBuffer>) } | null | undefined} res
 * @returns {Promise<ArrayBuffer | null>}
 */
async function resolveArrayBuffer (res) {
  let ab = await resolveBodyField(res, 'arrayBuffer')
  if (ab instanceof ArrayBuffer && ab.byteLength > 0) return ab
  if (ArrayBuffer.isView(ab) && ab.byteLength > 0) {
    return ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength)
  }
  const text = await resolveBodyField(res, 'text')
  if (!text || typeof text !== 'string' || text.length < 64) return null
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes.buffer
}

/**
 * @param {{ text?: string | Promise<string> | (() => Promise<string>) } | null | undefined} res
 * @returns {Promise<string>}
 */
async function resolveText (res) {
  const text = await resolveBodyField(res, 'text')
  return typeof text === 'string' ? text : ''
}

/**
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function toDataUrlPng (buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function toBlobUrlPng (buf) {
  const blob = new Blob([buf], { type: 'image/png' })
  return URL.createObjectURL(blob)
}

/**
 * @param {{ body?: ArrayBuffer | string | null }} pngRes
 * @param {{ body?: ArrayBuffer | string | null }} md5Res
 * @returns {{ ok: true, buffer: ArrayBuffer, dataUrl: string, blobUrl: string } | { ok: false }}
 */
function verifyPngMd5Pair (pngRes, md5Res) {
  if (!pngRes?.body || !md5Res?.body) return { ok: false }

  const buf = pngRes.body instanceof ArrayBuffer ? pngRes.body : null
  const md5Text = typeof md5Res.body === 'string' ? md5Res.body : ''
  if (!buf || buf.byteLength < 64) return { ok: false }

  const expected = parseServerMd5(md5Text)
  if (!expected) return { ok: false }

  const actual = md5Hex(buf)
  if (actual !== expected) return { ok: false }

  return {
    ok: true,
    buffer: buf,
    dataUrl: toDataUrlPng(buf),
    blobUrl: toBlobUrlPng(buf)
  }
}

/**
 * @param {string} base
 * @returns {Promise<{ ok: true, buffer: ArrayBuffer, dataUrl: string, blobUrl: string } | { ok: false }>}
 */
async function fetchVerifiedFromBase (base) {
  try {
    const [pngRes, md5Res] = await Promise.all([
      requestGet(`${base}/sponsor-alipay.png`, 'binary'),
      requestGet(`${base}/sponsor-alipay.md5`, 'text')
    ])
    return verifyPngMd5Pair(pngRes, md5Res)
  } catch {
    return { ok: false }
  }
}

/**
 * 从官网拉取 PNG + MD5，二者一致才返回图片；HTTPS 失败则尝试 HTTP。
 * @returns {Promise<{ ok: boolean, dataUrl?: string, blobUrl?: string, buffer?: ArrayBuffer }>}
 */
async function fetchVerifiedSponsorQr () {
  for (const base of SPONSOR_BASES) {
    const result = await fetchVerifiedFromBase(base)
    if (result.ok) return result
  }
  return { ok: false }
}

module.exports = {
  SPONSOR_BASES,
  SPONSOR_QR_URL,
  SPONSOR_MD5_URL,
  fetchVerifiedSponsorQr,
  fetchVerifiedFromBase,
  verifyPngMd5Pair,
  readPendingBody,
  resolveBodyField,
  resolveArrayBuffer,
  resolveText,
  md5Hex,
  parseServerMd5,
  toDataUrlPng,
  toBlobUrlPng
}
