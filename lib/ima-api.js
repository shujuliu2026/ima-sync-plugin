'use strict'

const { requestUrl } = require('obsidian')
const { chunkText } = require('./utils')
const { buildImaHttpError, classifyImaError } = require('./ima-errors')
const { withNetworkRetry } = require('./net-retry')

/** @param {unknown} err @param {string} [url] */
function friendlyNetError (err, url = '') {
  const msg = String(err?.message || err || '')
  if (/failed to fetch|networkerror|load failed|net::/i.test(msg)) {
    const host = url ? `（${url}）` : ''
    return `无法连接 IMA 服务${host}：请检查服务地址、网络与服务是否启动`
  }
  return msg
}

/** @param {string} raw */
function normalizeApiBase (raw) {
  let base = String(raw || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  base = base.replace(/\/agent-interface\/?$/i, '')
  if (/\/openapi\//i.test(base)) {
    base = base.replace(/\/openapi\/.*$/i, '')
  }
  return base.replace(/\/+$/, '')
}

/** @param {string} url */
function isTencentHost (url) {
  return /ima\.qq\.com/i.test(String(url || ''))
}

/** @param {string} boundary @param {Record<string, string | { bytes: Uint8Array, filename: string, contentType?: string }>} parts */
function buildMultipartBody (boundary, parts) {
  const encoder = new TextEncoder()
  /** @type {Uint8Array[]} */
  const chunks = []
  for (const [name, value] of Object.entries(parts)) {
    if (value == null || value === '') continue
    chunks.push(encoder.encode(`--${boundary}\r\n`))
    if (typeof value === 'object' && value.bytes) {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\n`
      ))
      chunks.push(encoder.encode(
        `Content-Type: ${value.contentType || 'application/octet-stream'}\r\n\r\n`
      ))
      chunks.push(value.bytes)
      chunks.push(encoder.encode('\r\n'))
    } else {
      chunks.push(encoder.encode(`Content-Disposition: form-data; name="${name}"\r\n\r\n`))
      chunks.push(encoder.encode(String(value)))
      chunks.push(encoder.encode('\r\n'))
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out.buffer
}

/** @param {object} raw */
function extractImaNoteId (raw) {
  if (!raw || typeof raw !== 'object') return ''

  /** @type {object[]} */
  const roots = [raw]
  if (raw.data && typeof raw.data === 'object') roots.push(raw.data)

  for (const d of roots) {
    const docInfo = d.doc_info
    const basic =
      docInfo?.basic_info?.basic_info ||
      docInfo?.basic_info ||
      docInfo

    const id =
      d.doc_id ||
      d.document_id ||
      d.content_id ||
      d.note_id ||
      d.media_id ||
      d.id ||
      d.docid ||
      basic?.docid ||
      basic?.doc_id ||
      ''
    if (id) return String(id)
  }
  return ''
}

/** @param {object} raw */
function describeImaResponseKeys (raw) {
  if (!raw || typeof raw !== 'object') return ''
  const keys = Object.keys(raw).filter(k => !['code', 'msg', 'message', 'errmsg'].includes(k))
  return keys.length ? keys.slice(0, 10).join(', ') : ''
}

/**
 * IMA REST 客户端（Obsidian requestUrl，绕过 CORS）
 */
class ImaApiClient {
  /**
   * @param {object} cfg
   * @param {string} cfg.apiUrl
   * @param {string} cfg.apiKey
   * @param {string} [cfg.clientId]
   * @param {string} [cfg.kbId]
   * @param {string} [cfg.ingestUrl]
   * @param {boolean} [cfg.mock]
   * @param {number} [cfg.timeout]
   * @param {number} [cfg.chunkSize]
   * @param {number} [cfg.chunkOverlap]
   * @param {number} [cfg.networkRetryCount]
   * @param {number} [cfg.networkRetryDelayMs]
   * @param {(info: { attempt: number, max: number, delay: number, err: unknown }) => void} [cfg.onRetry]
   */
  constructor (cfg = {}) {
    const { mockMode, mock: mockFlag, ...rest } = cfg
    const mock = mockFlag ?? mockMode
    this.cfg = {
      timeout: 30000,
      chunkSize: 1500,
      chunkOverlap: 200,
      networkRetryCount: 3,
      networkRetryDelayMs: 1500,
      ...rest,
      mock: mock ?? true
    }
  }

  _retryOpts () {
    return {
      maxRetries: Math.max(0, Number(this.cfg.networkRetryCount ?? 3)),
      retryDelayMs: Math.max(200, Number(this.cfg.networkRetryDelayMs ?? 1500)),
      onRetry: (attempt, max, delay, err) => {
        if (this.cfg.onRetry) {
          this.cfg.onRetry({ attempt, max, delay, err })
        }
      }
    }
  }

  /**
   * @param {string} url
   * @param {object} [opts]
   */
  async _rawFetch (url, opts = {}) {
    const method = opts.method || 'GET'
    const headers = { ...(opts.headers || {}) }
    const contentType = opts.contentType || headers['Content-Type']
    if (opts.contentType) delete headers['Content-Type']

    const timeoutMs = this.cfg.timeout || 30000
    const req = requestUrl({
      url,
      method,
      headers,
      body: opts.body,
      contentType,
      throw: false
    })
    let timerId = 0
    const timer = new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(`IMA_TIMEOUT: ${timeoutMs}ms`)), timeoutMs)
    })

    try {
      return await Promise.race([req, timer])
    } catch (err) {
      throw new Error(friendlyNetError(err, url))
    } finally {
      if (timerId) window.clearTimeout(timerId)
    }
  }

  get configured () {
    const apiKey = (this.cfg.apiKey || '').trim()
    const apiUrl = (this.cfg.apiUrl || '').trim()
    const ingestUrl = (this.cfg.ingestUrl || '').trim()
    return Boolean(apiKey && (ingestUrl || apiUrl))
  }

  buildHeaders (json = true) {
    /** @type {Record<string, string>} */
    const headers = { Accept: 'application/json' }
    if (json) headers['Content-Type'] = 'application/json'
    const clientId = (this.cfg.clientId || '').trim()
    const apiKey = (this.cfg.apiKey || '').trim()
    if (this.isTencentIma()) {
      if (clientId) headers['ima-openapi-clientid'] = clientId
      if (apiKey) headers['ima-openapi-apikey'] = apiKey
      return headers
    }
    if (clientId) {
      headers['X-Client-Id'] = clientId
      headers['Client-Id'] = clientId
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
      headers['X-API-Key'] = apiKey
    }
    return headers
  }

  isTencentIma () {
    return isTencentHost(this.resolveBase())
  }

  /** @param {string} path */
  openapiUrl (path) {
    const base = this.resolveBase()
    if (!base) return ''
    return `${base}/${String(path || '').replace(/^\/+/, '')}`
  }

  resolveBase () {
    const explicit = (this.cfg.ingestUrl || '').trim()
    if (explicit) return normalizeApiBase(explicit)

    let base = normalizeApiBase(this.cfg.apiUrl || '')
    if (!base) return ''
    if (/\/(ask|query|chat|search|completion|health)/i.test(base)) {
      return base.replace(/\/(ask|query|chat|search|completion|health)\/?$/i, '')
    }
    return base
  }

  documentsUrl () {
    const base = this.resolveBase()
    if (!base) return ''
    if (base.endsWith('/documents')) return base
    return `${base}/documents`
  }

  documentUrl (id) {
    const base = this.documentsUrl()
    if (!base || !id) return ''
    return `${base}/${encodeURIComponent(id)}`
  }

  attachmentsUrl (docId) {
    const doc = this.documentUrl(docId)
    if (!doc) return ''
    return `${doc}/attachments`
  }

  healthUrl () {
    const base = this.resolveBase()
    if (!base) return ''
    return `${base}/health`
  }

  mockDocId (prefix = 'ima') {
    return `mock-${prefix}-${Date.now().toString(36)}`
  }

  shouldMock () {
    if (!this.configured) return true
    return Boolean(this.cfg.mock)
  }

  healthProbeUrls () {
    /** @type {string[]} */
    const urls = []
    const health = this.healthUrl()
    if (health) urls.push(health)

    const docs = this.documentsUrl()
    const kbId = (this.cfg.kbId || '').trim()
    if (docs) {
      const params = new URLSearchParams()
      if (kbId) {
        params.set('kb_id', kbId)
        params.set('knowledge_base_id', kbId)
      }
      params.set('limit', '1')
      urls.push(`${docs}?${params}`)
    }

    const ingest = (this.cfg.ingestUrl || '').trim().replace(/\/$/, '')
    if (ingest && !urls.includes(ingest)) urls.push(ingest)

    return urls
  }

  /**
   * @param {string} url
   * @param {object} [opts]
   * @returns {Promise<{ ok: boolean, status: number, data: object, message: string }>}
   */
  async probe (url, opts = {}) {
    const run = async () => {
      const res = await this._rawFetch(url, opts)
      let data = {}
      try {
        data = res.json ?? (res.text ? JSON.parse(res.text) : {})
      } catch {
        data = {}
      }
      const code = data.code ?? data.errcode
      const message = data.msg || data.errmsg || data.message || data.error || res.text || `HTTP ${res.status}`
      let ok = res.status >= 200 && res.status < 300 && !data.errcode && !data.error
      if (isTencentHost(url) && code !== undefined) {
        ok = res.status >= 200 && res.status < 300 && code === 0
      }
      return { ok, status: res.status, code, data, message: String(message) }
    }

    try {
      return await withNetworkRetry(run, this._retryOpts())
    } catch (e) {
      return {
        ok: false,
        status: 0,
        code: undefined,
        data: {},
        message: friendlyNetError(e, url)
      }
    }
  }

  /**
   * @param {string} url
   * @param {object} opts
   * @param {string} [opts.method]
   * @param {Record<string, string>} [opts.headers]
   * @param {string | ArrayBuffer} [opts.body]
   * @param {string} [opts.contentType]
   */
  async request (url, opts = {}) {
    if (!url) throw new Error('IMA_URL_MISSING')

    return withNetworkRetry(async () => {
      const res = await this._rawFetch(url, opts)

      let data = {}
      try {
        data = res.json ?? (res.text ? JSON.parse(res.text) : {})
      } catch {
        data = {}
      }

      const code = data.code ?? data.errcode
      if (isTencentHost(url)) {
        if (res.status < 200 || res.status >= 300 || (code !== undefined && code !== 0)) {
          const msg = data.msg || data.message || data.errmsg || `IMA_${code ?? res.status}`
          throw buildImaHttpError(res.status, code, msg)
        }
        const payload = data.data && typeof data.data === 'object' ? data.data : {}
        return { ...data, ...payload }
      }

      if (res.status < 200 || res.status >= 300 || data.errcode || data.error) {
        const msg = data.errmsg || data.message || data.error || `HTTP ${res.status}`
        throw buildImaHttpError(res.status, data.errcode ?? data.code, msg)
      }
      return data
    }, this._retryOpts())
  }

  normalizeDoc (raw) {
    const d = raw?.data ?? raw ?? {}
    const docId = extractImaNoteId(d) || extractImaNoteId(raw)
    return {
      doc_id: docId,
      title: d.title || '',
      content: d.content || d.body || '',
      external_id: d.external_id || d.import_key || d.externalId || '',
      import_key: d.import_key || d.external_id || '',
      updated_at: d.updated_at || d.updatedAt || d.sync_at || d.modified_at || '',
      content_hash: d.content_hash || d.contentHash || '',
      attachments: d.attachments || d.files || []
    }
  }

  mockReason () {
    const apiKey = (this.cfg.apiKey || '').trim()
    const hasUrl = Boolean((this.cfg.ingestUrl || '').trim() || (this.cfg.apiUrl || '').trim())
    if (!apiKey) return 'no_key'
    if (!hasUrl) return 'no_url'
    if (this.cfg.mock) return 'mock_on'
    return ''
  }

  /**
   * @param {object} data IMA search / addable 响应（已 merge data.data）
   * @returns {Array<{ id: string, label: string }>}
   */
  normalizeKbListResponse (data) {
    const raw =
      data?.info_list ||
      data?.knowledge_bases ||
      data?.addable_knowledge_base_list ||
      data?.data?.info_list ||
      data?.data?.knowledge_bases ||
      data?.data?.addable_knowledge_base_list ||
      data?.list ||
      []

    if (!Array.isArray(raw)) return []

    return raw.map((kb) => {
      const id = String(
        kb?.kb_id || kb?.knowledge_base_id || kb?.id || ''
      ).trim()
      const label = String(
        kb?.kb_name || kb?.name || kb?.title || kb?.knowledge_base_name || id
      ).trim()
      return { id, label }
    }).filter((kb) => kb.id)
  }

  /**
   * @param {Map<string, { id: string, label: string }>} merged
   * @param {Array<{ id: string, label: string }>} items
   */
  _mergeKbItems (merged, items) {
    for (const kb of items) {
      if (kb.id && !merged.has(kb.id)) merged.set(kb.id, kb)
    }
  }

  /**
   * 腾讯 IMA：列出当前账号下的知识库（用于获取 knowledge_base_id）
   * @param {{ query?: string, cursor?: string, limit?: number }} [opts]
   * @returns {Promise<Array<{ id: string, label: string }>>}
   */
  async listKnowledgeBases (opts = {}) {
    if (!this.isTencentIma()) {
      throw new Error('IMA_KB_LIST_UNSUPPORTED: 仅腾讯 IMA 支持自动获取知识库列表')
    }
    const clientId = (this.cfg.clientId || '').trim()
    const apiKey = (this.cfg.apiKey || '').trim()
    if (!apiKey) throw new Error('IMA_KB_LIST_NO_KEY: 请先填写 API Key')
    if (!clientId) throw new Error('IMA_KB_LIST_NO_CLIENT: 请先填写 Client ID')

    const limit = Math.min(20, Math.max(1, Number(opts.limit) || 20))
    const query = String(opts.query || '')
    const url = this.openapiUrl('openapi/wiki/v1/search_knowledge_base')
    /** @type {Map<string, { id: string, label: string }>} */
    const merged = new Map()

    let cursor = String(opts.cursor || '')
    for (let page = 0; page < 5; page++) {
      const data = await this.request(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ query, cursor, limit })
      })
      const batch = this.normalizeKbListResponse(data)
      this._mergeKbItems(merged, batch)
      const next = String(data?.next_cursor || data?.nextCursor || '').trim()
      const isEnd = data?.is_end === true || data?.isEnd === true
      if (!next || isEnd || batch.length < limit) break
      cursor = next
    }

    try {
      const addableUrl = this.openapiUrl('openapi/wiki/v1/get_addable_knowledge_base_list')
      const addData = await this.request(addableUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ cursor: '', limit })
      })
      this._mergeKbItems(merged, this.normalizeKbListResponse(addData))
    } catch {
      // 部分账号可能无此接口权限，忽略
    }

    return [...merged.values()]
  }

  async tencentCheckHealth () {
    const clientId = (this.cfg.clientId || '').trim()
    const apiKey = (this.cfg.apiKey || '').trim()
    if (!apiKey) return { ok: false, message: '请填写 API Key' }
    if (!clientId) return { ok: false, message: '请填写 Client ID（腾讯 IMA 必填）' }

    const url = this.openapiUrl('openapi/wiki/v1/search_knowledge_base')
    try {
      const r = await this.probe(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ query: '', cursor: '', limit: 1 })
      })
      if (r.ok) return { ok: true, mock: false, message: '已连接' }
      const limitKind = classifyImaError(r.status, r.code, r.message)
      if (limitKind === 'quota') {
        return { ok: false, syncLimit: 'quota', message: '超过今日同步次数，请明日再试' }
      }
      if (limitKind === 'rate' || r.code === 20002) {
        return { ok: false, syncLimit: 'rate', message: '请求过于频繁，请稍后重试' }
      }
      if (r.status === 401 || r.status === 403 || r.code === 401 || r.code === 403) {
        return { ok: false, message: '密钥无效或无权访问' }
      }
      return { ok: false, message: r.message || `IMA 错误 ${r.code ?? r.status}` }
    } catch (e) {
      return { ok: false, message: friendlyNetError(e, url) }
    }
  }

  async checkHealth () {
    const reason = this.mockReason()
    if (reason) {
      return { ok: true, mock: true, reason, message: 'Mock 模式' }
    }

    if (this.isTencentIma()) {
      return this.tencentCheckHealth()
    }

    const headers = this.buildHeaders(false)
    let lastMsg = '未配置 API 地址'

    for (const url of this.healthProbeUrls()) {
      try {
        const r = await this.probe(url, { method: 'GET', headers })
        if (r.ok) return { ok: true, mock: false, message: '已连接' }
        if (r.status === 401 || r.status === 403) {
          return { ok: false, message: '密钥无效或无权访问（服务已可达）' }
        }
        // 腾讯 IMA 等无 /health；GET-only 上传口常返回 405
        if (r.status === 405) {
          return { ok: true, mock: false, message: '已连接' }
        }
        if (r.status === 404) {
          lastMsg = `IMA_HTTP_404: ${r.message}`
          continue
        }
        lastMsg = `IMA_HTTP_${r.status}: ${r.message}`
      } catch (e) {
        lastMsg = friendlyNetError(e, url)
      }
    }

    const docs = this.documentsUrl()
    if (docs) {
      try {
        const r = await this.probe(docs, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ probe: true })
        })
        if (r.ok || r.status === 400 || r.status === 422) {
          return { ok: true, mock: false, message: '已连接' }
        }
        if (r.status === 401 || r.status === 403) {
          return { ok: false, message: '密钥无效或无权访问（服务已可达）' }
        }
        if (r.status !== 404) lastMsg = `IMA_HTTP_${r.status}: ${r.message}`
      } catch (e) {
        lastMsg = friendlyNetError(e, docs)
      }
    }

    return { ok: false, message: lastMsg }
  }

  /**
   * @param {object} opts
   */
  async uploadDocument (opts) {
    const {
      title,
      body,
      importKey = '',
      metadata = {},
      docId = ''
    } = opts

    if (!title || !body) throw new Error('IMA_UPLOAD_INVALID: title 与 body 必填')

    const chunks = chunkText(body, {
      size: this.cfg.chunkSize,
      overlap: this.cfg.chunkOverlap
    })

    if (this.shouldMock()) {
      return {
        ok: true,
        mock: true,
        doc_id: docId || this.mockDocId('ima'),
        chunk_count: chunks.length,
        updated_at: new Date().toISOString(),
        hint: 'Mock 模式或未配置 API Key'
      }
    }

    if (this.isTencentIma()) {
      return this.tencentUploadDocument({ title, body, docId, importKey, metadata, chunks })
    }

    const ingestUrl = this.documentsUrl()
    const kbId = (this.cfg.kbId || '').trim()
    const payload = {
      title: title.slice(0, 256),
      content: body,
      chunks,
      external_id: importKey || undefined,
      import_key: importKey || undefined,
      knowledge_base_id: kbId || undefined,
      kb_id: kbId || undefined,
      metadata
    }

    const clientId = (this.cfg.clientId || '').trim()
    if (clientId) {
      payload.client_id = clientId
      payload.clientId = clientId
    }
    if (docId) {
      payload.doc_id = docId
      payload.document_id = docId
    }

    const data = await this.request(ingestUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload)
    })

    const doc = this.normalizeDoc(data)
    if (!doc.doc_id) throw new Error('IMA_UPLOAD_FAIL: 响应缺少 doc_id')

    return {
      ok: true,
      mock: false,
      doc_id: doc.doc_id,
      chunk_count: chunks.length,
      updated_at: doc.updated_at || new Date().toISOString(),
      hint: 'IMA 文档已上传'
    }
  }

  /**
   * @param {object} opts
   */
  async tencentUploadDocument (opts) {
    const { title, body, docId = '', chunks } = opts
    const kbId = (this.cfg.kbId || '').trim()
    if (!kbId) throw new Error('IMA_KB_ID_MISSING: 请选择知识库')

    const safeTitle = title.slice(0, 256)
    const content = body.trimStart().startsWith('#') ? body : `# ${safeTitle}\n\n${body}`
    let noteId = String(docId || '').trim()
    const isMockDoc = noteId.startsWith('mock-')

    if (noteId && !isMockDoc) {
      const appendUrl = this.openapiUrl('openapi/note/v1/append_doc')
      const appendData = await this.request(appendUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          doc_id: noteId,
          content_format: 1,
          content: `\n\n---\n\n${content}`
        })
      })
      noteId = extractImaNoteId(appendData) || noteId
      return {
        ok: true,
        mock: false,
        doc_id: noteId,
        chunk_count: chunks.length,
        updated_at: new Date().toISOString(),
        hint: 'IMA 笔记已更新'
      }
    }

    const importUrl = this.openapiUrl('openapi/note/v1/import_doc')
    const importData = await this.request(importUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        content_format: 1,
        content,
        title: safeTitle
      })
    })
    noteId = extractImaNoteId(importData)
    if (!noteId) {
      const hint = describeImaResponseKeys(importData)
      throw new Error(`IMA_UPLOAD_FAIL: import_doc 未返回 doc_id${hint ? `（响应字段: ${hint}）` : ''}`)
    }

    const addUrl = this.openapiUrl('openapi/wiki/v1/add_knowledge')
    await this.request(addUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        media_type: 11,
        note_info: { content_id: noteId },
        title: safeTitle,
        knowledge_base_id: kbId
      })
    })

    return {
      ok: true,
      mock: false,
      doc_id: noteId,
      chunk_count: chunks.length,
      updated_at: new Date().toISOString(),
      hint: 'IMA 知识库已添加'
    }
  }

  /**
   * @param {string} docId
   * @param {object} patch
   */
  async updateDocument (docId, patch) {
    if (this.shouldMock()) {
      return {
        ok: true,
        mock: true,
        doc_id: docId,
        updated_at: new Date().toISOString()
      }
    }

    const url = this.documentUrl(docId)
    const data = await this.request(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify(patch)
    })
    const doc = this.normalizeDoc(data)
    return { ok: true, doc_id: doc.doc_id || docId, updated_at: doc.updated_at || new Date().toISOString() }
  }

  async getDocument (docId) {
    if (this.shouldMock()) {
      return {
        mock: true,
        doc_id: docId,
        title: `Mock ${docId}`,
        content: '',
        external_id: '',
        updated_at: new Date().toISOString(),
        content_hash: ''
      }
    }

    const url = this.documentUrl(docId)
    const data = await this.request(url, { method: 'GET', headers: this.buildHeaders(false) })
    return this.normalizeDoc(data)
  }

  /**
   * @param {Array<{ name: string, media_type: number }>} params
   * @param {{ kbId?: string, folderId?: string }} [opts]
   * @returns {Promise<Array<{ name: string, is_repeated: boolean }>>}
   */
  async checkRepeatedNames (params, opts = {}) {
    const list = Array.isArray(params) ? params : []
    if (!list.length) return []

    if (this.shouldMock()) {
      const mockMap = this.cfg.trustMock?.repeated || {}
      return list.map(p => ({
        name: p.name,
        is_repeated: Boolean(mockMap[p.name] ?? mockMap['*'])
      }))
    }

    if (!this.isTencentIma()) {
      return list.map(p => ({ name: p.name, is_repeated: false }))
    }

    const kbId = (opts.kbId || this.cfg.kbId || '').trim()
    if (!kbId) throw new Error('IMA_KB_ID_MISSING: 请选择知识库')

    const url = this.openapiUrl('openapi/wiki/v1/check_repeated_names')
    const data = await this.request(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        knowledge_base_id: kbId,
        folder_id: opts.folderId || '',
        params: list
      })
    })

    const raw =
      data?.results ||
      data?.params ||
      data?.info_list ||
      data?.list ||
      (Array.isArray(data) ? data : [])

    if (!Array.isArray(raw)) {
      const globalRepeated = data?.is_repeated === true
      return list.map(p => ({ name: p.name, is_repeated: globalRepeated }))
    }

    return list.map((p, i) => {
      const row = raw[i] || raw.find(r => r?.name === p.name) || {}
      return {
        name: p.name,
        is_repeated: row.is_repeated === true || row.repeated === true
      }
    })
  }

  /**
   * 腾讯 IMA search_knowledge 单页 limit 须 1–20
   * @param {string} query
   * @param {{ kbId?: string, limit?: number, cursor?: string }} [opts]
   */
  async searchKnowledge (query, opts = {}) {
    const q = String(query || '').trim()
    const limit = Math.min(20, Math.max(1, Number(opts.limit) || 20))
    const cursor = String(opts.cursor || '')

    if (this.shouldMock()) {
      const hits = this.cfg.trustMock?.searchHits || []
      const qLower = q.toLowerCase()
      const items = hits.filter(h => {
        const title = String(h.title || '').toLowerCase()
        const id = String(h.doc_id || '')
        return (title && (title.includes(qLower) || qLower.includes(title))) ||
          (h.matchDocId && id === h.matchDocId)
      }).map(h => this.normalizeDoc(h))
      return { items, mock: true, next_cursor: '', is_end: true }
    }

    if (!this.isTencentIma()) {
      return { items: [], mock: false, next_cursor: '', is_end: true }
    }

    const kbId = (opts.kbId || this.cfg.kbId || '').trim()
    const url = this.openapiUrl('openapi/wiki/v1/search_knowledge')
    const data = await this.request(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        query: q,
        knowledge_base_id: kbId,
        cursor,
        limit
      })
    })
    const list = data.info_list || data.knowledge_list || data.items || []
    const items = Array.isArray(list) ? list.map(d => this.normalizeDoc(d)) : []
    const next = String(data?.next_cursor || data?.nextCursor || '').trim()
    const isEnd = data?.is_end === true || data?.isEnd === true || !next
    return { items, mock: false, next_cursor: next, is_end: isEnd }
  }

  async listDocuments (opts = {}) {
    if (this.shouldMock()) return { items: [], mock: true }

    if (this.isTencentIma()) {
      const want = Math.min(500, Math.max(1, Number(opts.limit) || 100))
      /** @type {object[]} */
      const merged = []
      let cursor = ''
      for (let page = 0; page < 25 && merged.length < want; page++) {
        const take = Math.min(20, want - merged.length)
        const res = await this.searchKnowledge('', {
          kbId: opts.kbId,
          limit: take,
          cursor
        })
        if (res.mock) return { items: merged.concat(res.items || []), mock: true }
        const batch = res.items || []
        merged.push(...batch)
        if (res.is_end || !res.next_cursor || !batch.length) break
        cursor = res.next_cursor
      }
      return { items: merged.slice(0, want), mock: false }
    }

    const base = this.documentsUrl()
    const kbId = (this.cfg.kbId || '').trim()
    const params = new URLSearchParams()
    if (kbId) {
      params.set('knowledge_base_id', kbId)
      params.set('kb_id', kbId)
    }
    if (opts.page) params.set('page', String(opts.page))
    if (opts.limit) params.set('limit', String(opts.limit || 100))
    if (opts.since) params.set('updated_since', opts.since)

    const url = params.toString() ? `${base}?${params}` : base
    const data = await this.request(url, { method: 'GET', headers: this.buildHeaders(false) })

    const list = data.items || data.documents || data.data?.items || data.data || []
    const items = Array.isArray(list) ? list.map(d => this.normalizeDoc(d)) : []
    return { items, mock: false }
  }

  /**
   * @param {string} docId
   * @param {Blob | ArrayBuffer} file
   * @param {string} filename
   */
  async uploadAttachment (docId, file, filename) {
    if (this.shouldMock()) {
      return {
        ok: true,
        mock: true,
        url: `mock://ima/attachments/${encodeURIComponent(filename)}`,
        filename
      }
    }

    if (this.isTencentIma()) {
      return {
        ok: false,
        skipped: true,
        filename,
        hint: '腾讯 IMA 附件上传暂未支持（需 COS 流程）'
      }
    }

    const url = this.attachmentsUrl(docId)
    const kbId = (this.cfg.kbId || '').trim()
    const bytes = file instanceof Blob
      ? new Uint8Array(await file.arrayBuffer())
      : new Uint8Array(file)
    const boundary = `----ImaSync${Date.now().toString(36)}`
    /** @type {Record<string, string | { bytes: Uint8Array, filename: string }>} */
    const parts = {
      file: { bytes, filename }
    }
    if (kbId) {
      parts.knowledge_base_id = kbId
      parts.kb_id = kbId
    }

    const authHeaders = this.buildHeaders(false)
    delete authHeaders['Content-Type']

    const res = await this.request(url, {
      method: 'POST',
      headers: authHeaders,
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: buildMultipartBody(boundary, parts)
    })

    return {
      ok: true,
      url: res.url || res.file_url || res.data?.url || '',
      filename: res.filename || filename,
      attachment_id: res.id || res.attachment_id || ''
    }
  }
}

module.exports = { ImaApiClient, normalizeApiBase, isTencentHost, extractImaNoteId, parseImaError: require('./ima-errors').parseImaError, isSyncLimitError: require('./ima-errors').isSyncLimitError }
