'use strict'

const { ImaApiClient } = require('./ima-api')
const { parseImaError } = require('./ima-errors')
const { backoffMsList, sleep } = require('./rate-limit')
const { yieldToUi, withTimeout } = require('./ui-yield')
const { syncAttachments } = require('./attachments')
const { detectConflict, resolveConflict } = require('./conflicts')
const { t } = require('./i18n')
const { canUseTrust, trustDedupAllowed, trustVerifyAllowed, effectiveSyncFolders } = require('./license')
const { evaluateDedup } = require('./trust-dedup')
const { shouldRunDedup, shouldRunVerify } = require('./trust-capabilities')
const { verifyPushedNote, writeVerifyFrontmatter } = require('./trust-verify')
const { TrustReportCollector } = require('./trust-report')
const { formatForIma, pickContentHashBody, shouldFormatNote } = require('./format-pipeline')
const { buildFormatReport } = require('./format-report')
const {
  computeContentHash,
  parseNoteFile,
  isUnderSyncFolders,
  parseTime,
  normalizePath
} = require('./utils')

class ImaSyncEngine {
  /**
   * @param {import('obsidian').App} app
   * @param {object} settings
   * @param {(msg: string) => void} [onLog]
   * @param {import('./sync-control').SyncControl} [control]
   * @param {(path: string) => void} [onProgress]
   * @param {(entry: { path: string, error: string }) => void} [onFailedEntry]
   */
  constructor (app, settings, onLog, control, onProgress, onFailedEntry) {
    this.app = app
    this.settings = settings
    this.onLog = onLog || (() => {})
    this.onProgress = onProgress || (() => {})
    this.onFailedEntry = onFailedEntry || (() => {})
    this.onRequest = settings.onRequest || (() => {})
    this.control = control || null
    this._pushBatchCounter = 0
    /** @type {TrustReportCollector | null} */
    this._trustReport = null
    /** @type {Array<{ path: string, status: string, rulesApplied?: string[], deltaChars?: number }>} */
    this._formatItems = []
    this._buildClient()
    this.running = false
  }

  resetBatchCounter () {
    this._pushBatchCounter = 0
  }

  /** @param {number} [n] */
  recordRequest (n = 1) {
    if (n > 0) this.onRequest(n)
  }

  _buildClient () {
    const s = this.settings
    this.client = new ImaApiClient({
      apiUrl: s.apiUrl,
      apiKey: s.apiKey,
      clientId: s.clientId,
      kbId: s.kbId,
      ingestUrl: s.ingestUrl,
      mock: s.mockMode,
      timeout: s.timeout,
      chunkSize: s.chunkSize,
      chunkOverlap: s.chunkOverlap,
      networkRetryCount: s.networkRetryCount,
      networkRetryDelayMs: s.networkRetryDelayMs,
      trustMock: s.trustMock,
      onRetry: ({ attempt, max, delay }) => {
        const sec = Math.max(1, Math.round(delay / 1000))
        this.onLog(this.tr('networkRetry', { attempt, max, delay: sec }))
      }
    })
  }

  trustEnabled () {
    return canUseTrust(this.settings)
  }

  /** @param {object} summary */
  initTrustSummary (summary) {
    summary.deduped = 0
    summary.dedup_ambiguous = 0
    summary.verified = 0
    summary.verify_failed = 0
    summary.verify_pending = 0
    summary.formatted = 0
    summary.format_unchanged = 0
    this._formatItems = []
    this._activeSummary = summary
    if (this.trustEnabled()) {
      this._trustReport = new TrustReportCollector({
        kbId: this.settings.kbId || '',
        kbLabel: this.settings.kbLabel || '',
        direction: summary.direction || 'push'
      })
      summary.trustReport = this._trustReport
    } else {
      this._trustReport = null
      summary.trustReport = null
    }
  }

  /** @param {object} summary */
  finalizeFormatSummary (summary) {
    if (this._formatItems?.length) {
      summary.formatReport = buildFormatReport(this._formatItems)
    } else {
      summary.formatReport = null
    }
    this._formatItems = []
    this._activeSummary = null
  }

  /** @param {object} summary */
  finalizeTrustSummary (summary) {
    if (this._trustReport) {
      summary.trustReport = this._trustReport.finish()
      this._trustReport = null
    }
  }

  /**
   * @param {object} summary
   * @param {import('obsidian').TFile} file
   * @param {{ action: string, doc_id?: string, verify?: string, error?: string }} item
   */
  recordTrustItem (summary, file, item) {
    if (!this._trustReport) return
    this._trustReport.addItem({ path: file.path, ...item })
    if (item.action === 'deduped') summary.deduped = (summary.deduped || 0) + 1
    else if (item.action === 'dedup_ambiguous') summary.dedup_ambiguous = (summary.dedup_ambiguous || 0) + 1
    else if (item.action === 'failed') summary.failed = summary.failed || summary.errors?.length
    if (item.verify === 'verified') summary.verified = (summary.verified || 0) + 1
    else if (item.verify === 'failed') summary.verify_failed = (summary.verify_failed || 0) + 1
    else if (item.verify === 'pending') summary.verify_pending = (summary.verify_pending || 0) + 1
  }

  /** @returns {Promise<boolean>} */
  async gateStep () {
    if (!this.control) return true
    return this.control.gate()
  }

  /** @param {keyof import('./i18n').STR['zh']} key @param {Record<string, string|number>} [vars] */
  tr (key, vars) {
    return t(this.settings, key, vars)
  }

  refreshClient () {
    this._buildClient()
  }

  /** @returns {Promise<void>} */
  async uploadGap () {
    if (!this.client.isTencentIma()) return
    const ms = Math.max(200, Number(this.settings.uploadGapMs) || 500)
    if (ms > 0) await sleep(ms)
  }

  /** @returns {Promise<'ok'|'stop'>} */
  async afterPushStep () {
    await this.uploadGap()
    this._pushBatchCounter++
    const batchSize = Math.max(1, Number(this.settings.batchSize) || 80)
    const pauseSec = Math.max(0, Number(this.settings.batchPauseSeconds) ?? 30)
    if (this._pushBatchCounter < batchSize || pauseSec <= 0) {
      return (await this.gateStep()) ? 'ok' : 'stop'
    }
    this.onLog(this.tr('batchPause', { n: batchSize, sec: pauseSec }))
    if (!(await this.gateStep())) return 'stop'
    await sleep(pauseSec * 1000)
    this._pushBatchCounter = 0
    return (await this.gateStep()) ? 'ok' : 'stop'
  }

  /**
   * @param {object} summary
   * @param {import('obsidian').TFile} file
   * @param {unknown} err
   * @returns {boolean} 是否应停止批量同步
   */
  async handlePushError (summary, file, err) {
    const limit = parseImaError(err)
    const message = limit?.message || String(err?.message || err)
    summary.errors.push({ file: file.path, error: message })
    this.onLog(`✗ ${file.path}: ${message.slice(0, 160)}`)
    await this.markFailed(file, err)
    this.onFailedEntry({ path: file.path, error: message })
    this.recordTrustItem(summary, file, { action: 'failed', error: message })
    if (limit) {
      summary.syncLimit = limit.kind
      summary.stopped = true
      this.onLog(`⚠ ${this.tr(limit.kind === 'quota' ? 'quotaExceeded' : 'rateLimitExceeded')}`)
      return true
    }
    return false
  }

  /**
   * @param {object} summary
   * @param {import('obsidian').TFile} file
   * @param {unknown} err
   * @param {() => Promise<object>} retryFn
   * @returns {Promise<boolean>} 是否继续批量
   */
  async handlePushErrorWithRetry (summary, file, err, retryFn) {
    const limit = parseImaError(err)
    if (limit?.kind !== 'rate') {
      return !(await this.handlePushError(summary, file, err))
    }

    const backoffs = backoffMsList(this.settings.rateLimitBackoffSec)
    for (let i = 0; i < backoffs.length; i++) {
      const delay = backoffs[i]
      const sec = Math.max(1, Math.round(delay / 1000))
      this.onLog(this.tr('rateLimitBackoff', { sec, attempt: i + 1, max: backoffs.length }))
      if (!(await this.gateStep())) {
        summary.stopped = true
        return false
      }
      await sleep(delay)
      try {
        const r = await retryFn()
        if (r.skipped) summary.skipped++
        else if (r.pushed) {
          summary.pushed++
          const step = await this.afterPushStep()
          if (step === 'stop') {
            summary.stopped = true
            return false
          }
        }
        return true
      } catch (e2) {
        if (parseImaError(e2)?.kind !== 'rate') {
          return !(await this.handlePushError(summary, file, e2))
        }
        err = e2
      }
    }

    summary.syncLimit = 'rate'
    summary.stopped = true
    summary.errors.push({ file: file.path, error: this.tr('rateLimitExceeded') })
    await this.markFailed(file, err)
    this.onLog(`⚠ ${this.tr('rateLimitExceeded')}`)
    return false
  }

  /**
   * @param {object} summary
   * @param {import('obsidian').TFile} file
   * @param {boolean} [force]
   * @returns {Promise<'ok'|'stop'>}
   */
  async pushOneInBatch (summary, file, force = false) {
    try {
      const r = await this.pushNote(file, force)
      if (r.skipped) {
        if (r.deduped) {
          summary.deduped = (summary.deduped || 0) + 1
          this.recordTrustItem(summary, file, { action: 'deduped' })
        } else if (r.dedup_ambiguous) {
          summary.dedup_ambiguous = (summary.dedup_ambiguous || 0) + 1
          this.recordTrustItem(summary, file, { action: 'dedup_ambiguous' })
        } else {
          summary.skipped++
          this.recordTrustItem(summary, file, { action: 'skipped' })
        }
        return (await this.gateStep()) ? 'ok' : 'stop'
      }
      if (r.pushed) {
        summary.pushed++
        this.recordTrustItem(summary, file, {
          action: 'pushed',
          doc_id: r.doc_id,
          verify: r.verify
        })
        const step = await this.afterPushStep()
        return step === 'stop' ? 'stop' : 'ok'
      }
      return (await this.gateStep()) ? 'ok' : 'stop'
    } catch (err) {
      const cont = await this.handlePushErrorWithRetry(summary, file, err, () => this.pushNote(file, force))
      return cont ? 'ok' : 'stop'
    }
  }

  /** @returns {Promise<import('obsidian').TFile[]>} */
  async listSyncFiles () {
    const files = this.app.vault.getMarkdownFiles()
    const folders = effectiveSyncFolders(this.settings, this.settings.syncFolders)
    return files.filter(f => isUnderSyncFolders(f.path, folders))
  }

  /** @param {number} index @param {number} total @param {string} path */
  reportFileProgress (index, total, path) {
    if (total > 0) {
      this.onProgress(this.tr('syncFileProgress', { i: index, n: total, path }))
    } else {
      this.onProgress(path)
    }
  }

  /**
   * @param {import('obsidian').TFile} file
   * @param {boolean} [force]
   */
  async pushNote (file, force = false) {
    const fileTimeoutMs = Math.max(60000, Number(this.settings.timeout) || 30000) * 4
    return withTimeout(this._pushNoteInner(file, force), fileTimeoutMs, 'IMA_FILE_SYNC_TIMEOUT')
  }

  /**
   * @param {import('obsidian').TFile} file
   * @param {boolean} [force]
   */
  async _pushNoteInner (file, force = false) {
    const raw = await this.app.vault.read(file)
    const { frontmatter, body } = parseNoteFile(raw)
    const title = frontmatter.title || file.basename
    const formatOnPush = this.settings.format?.onPush !== false && shouldFormatNote(frontmatter, this.settings)
    const formatted = formatOnPush
      ? formatForIma({ path: file.path, title, body, frontmatter }, this.settings)
      : { body, rulesApplied: [], skipped: true, unchanged: true }
    const pushBody = formatted.body
    const hashBody = pickContentHashBody(body, pushBody, this.settings)
    const contentHash = computeContentHash(hashBody)
    const syncedHash = frontmatter.ima_content_hash || ''
    const syncIma = frontmatter.sync?.ima

    if (formatOnPush && !formatted.skipped && formatted.rulesApplied?.length) {
      this._formatItems.push({
        path: file.path,
        status: 'formatted',
        rulesApplied: formatted.rulesApplied,
        deltaChars: pushBody.length - body.length
      })
      if (this._activeSummary) this._activeSummary.formatted = (this._activeSummary.formatted || 0) + 1
    } else if (formatOnPush) {
      this._formatItems.push({ path: file.path, status: 'unchanged', rulesApplied: [] })
      if (this._activeSummary) this._activeSummary.format_unchanged = (this._activeSummary.format_unchanged || 0) + 1
    }

    if (!force && syncIma === 'synced' && contentHash === syncedHash) {
      return { skipped: true, reason: 'unchanged', file: file.path }
    }

    if (formatOnPush && formatted.rulesApplied?.length) {
      this.onLog(this.tr('formatApplied', { path: file.path, rules: formatted.rulesApplied.join(', ') }))
    }

    const titleForPush = title

    if (this.trustEnabled() && this.settings.trust?.dedupBeforePush !== false && trustDedupAllowed(this.settings) && shouldRunDedup(this.settings.trustCapabilities)) {
      const dedup = await evaluateDedup(this.client, this.settings, {
        title,
        basename: file.basename,
        frontmatter,
        contentHash,
        force
      })
      this.recordRequest(dedup.apiCalls)
      if (dedup.action === 'skip') {
        const action = dedup.reason === 'dedup_ambiguous' ? 'dedup_ambiguous' : 'deduped'
        this.onLog(`↷ ${file.path} (${dedup.reason})`)
        return { skipped: true, reason: dedup.reason, file: file.path, deduped: action === 'deduped', dedup_ambiguous: action === 'dedup_ambiguous' }
      }
      if (dedup.action === 'ambiguous') {
        this.onLog(this.tr('trustDedupAmbiguousWarn', { path: file.path }))
      }
    } else if (this.trustEnabled() && this.settings.trust?.dedupBeforePush !== false && !trustDedupAllowed(this.settings)) {
      if (!this._loggedDedupEntSkip) {
        this._loggedDedupEntSkip = true
        this.onLog(this.tr('trustEntDedupOff'))
      }
    }

    const importKey = frontmatter.import_key || titleForPush
    let docId = frontmatter.ima_doc_id || ''
    const meta = {
      note_path: file.path,
      content_hash: contentHash,
      type: frontmatter.type,
      era: frontmatter.era,
      tags: frontmatter.tags
    }

    this.onProgress(file.path)
    await yieldToUi()
    this.onLog(`↑ ${file.path} …`)

    let result = await this.client.uploadDocument({
      title: titleForPush,
      body: pushBody,
      importKey,
      docId,
      metadata: meta
    })
    this.recordRequest()
    docId = result.doc_id

    const attachResult = await syncAttachments(this.app, this.client, docId, pushBody, file.path)
    if (attachResult.uploaded.length && attachResult.body !== pushBody) {
      this.onLog(this.tr('syncAttachmentRetry', { path: file.path }))
      result = await this.client.uploadDocument({
        title: titleForPush,
        body: attachResult.body,
        importKey,
        docId,
        metadata: meta
      })
      this.recordRequest()
    }

    await withTimeout(
      this.app.fileManager.processFrontMatter(file, (fm) => {
        if (!fm.sync || typeof fm.sync !== 'object') fm.sync = {}
        fm.sync.ima = 'synced'
        fm.ima_doc_id = docId
        fm.ima_sync_at = new Date().toISOString()
        fm.ima_content_hash = contentHash
        fm.ima_sync_error = ''
        if (!fm.import_key) fm.import_key = importKey
        if (formatted.rulesApplied?.length) {
          if (!fm.format || typeof fm.format !== 'object') fm.format = {}
          fm.format.last_push = new Date().toISOString()
          fm.format.status = 'formatted'
          fm.format.rules_applied = formatted.rulesApplied.join(',')
        }
      }),
      20000,
      'IMA_FM_TIMEOUT'
    )

    let verifyResult = { status: 'skipped', query: '' }
    if (this.trustEnabled()) {
      if (trustVerifyAllowed(this.settings) && shouldRunVerify(this.settings.trustCapabilities)) {
        verifyResult = await verifyPushedNote(this.client, this.settings, {
          title,
          docId,
          basename: file.basename
        })
        this.recordRequest(1)
        await writeVerifyFrontmatter(this.app, file, verifyResult)
        if (verifyResult.status === 'verified') {
          this.onLog(`✓ ${file.path} → ${docId} · ${this.tr('trustVerifiedShort')}`)
        } else if (verifyResult.status === 'failed') {
          this.onLog(`? ${file.path} → ${docId} · ${this.tr('trustVerifyFailedShort')}`)
        }
      } else if (!trustVerifyAllowed(this.settings)) {
        verifyResult = { status: 'skipped', query: '', detail: 'ENT_VERIFY_OFF' }
        if (!this._loggedVerifyEntSkip) {
          this._loggedVerifyEntSkip = true
          this.onLog(this.tr('trustEntVerifyOff'))
        }
      } else if (this.settings.trustCapabilities?.checkedAt) {
        verifyResult = { status: 'skipped', query: '', detail: 'NO_VERIFY_PERMISSION' }
        if (!this._loggedVerifyCapSkip) {
          this._loggedVerifyCapSkip = true
          this.onLog(this.tr('trustCapVerifySkip'))
        }
      }
    } else {
      this.onLog(`✓ ${file.path} → ${docId}${result.mock ? ' (mock)' : ''}`)
    }

    this.onFailedEntry({ path: file.path, error: '', clear: true })

    return {
      pushed: true,
      file: file.path,
      doc_id: docId,
      mock: result.mock,
      attachments: attachResult.uploaded,
      verify: verifyResult.status,
      verify_query: verifyResult.query
    }
  }

  /**
   * @param {import('obsidian').TFile} file
   * @param {object} remote
   */
  async pullNote (file, remote) {
    const content = String(remote.content || '').trim()
    if (!content) return { skipped: true, reason: 'empty_remote', file: file.path }

    const raw = await this.app.vault.read(file)
    const { frontmatter } = parseNoteFile(raw)
    const contentHash = computeContentHash(content)

    const fmBlock = buildFrontmatterPatch(frontmatter, remote, contentHash)
    const newRaw = `---\n${fmBlock}\n---\n\n${content}\n`
    await this.app.vault.modify(file, newRaw)

    this.onLog(`↓ ${file.path} ← ${remote.doc_id}`)
    return { pulled: true, file: file.path, doc_id: remote.doc_id }
  }

  /**
   * @param {object} remote
   */
  async createNoteFromRemote (remote) {
    const importKey = remote.external_id || remote.import_key || remote.title
    const folder = effectiveSyncFolders(this.settings, this.settings.syncFolders)[0] || ''
    const safeName = sanitizeFilename(importKey || remote.title || remote.doc_id)
    let path = folder ? `${normalizePath(folder)}/${safeName}.md` : `${safeName}.md`

    if (this.app.vault.getAbstractFileByPath(path)) {
      path = path.replace(/\.md$/, `-${Date.now().toString(36)}.md`)
    }

    const content = String(remote.content || '').trim()
    const contentHash = computeContentHash(content)
    const fm = [
      '---',
      `title: ${yamlQuote(remote.title || safeName)}`,
      `import_key: ${yamlQuote(importKey)}`,
      'sync:',
      '  ima: synced',
      `ima_doc_id: ${yamlQuote(remote.doc_id)}`,
      `ima_sync_at: ${yamlQuote(new Date().toISOString())}`,
      `ima_content_hash: ${yamlQuote(contentHash)}`,
      '---',
      '',
      content,
      ''
    ].join('\n')

    const file = await this.app.vault.create(path, fm)
    this.onLog(`+ 新建 ${path} ← ${remote.doc_id}`)
    return { created: true, file: file.path, doc_id: remote.doc_id }
  }

  /** @param {string} [folderPath] 空字符串表示库根 */
  listFilesInFolder (folderPath) {
    const files = this.app.vault.getMarkdownFiles()
    return files.filter(f => isUnderSyncFolders(f.path, [folderPath || '']))
  }

  /**
   * 推送指定文件夹内全部笔记
   * @param {string} folderPath
   */
  async pushFolder (folderPath) {
    const label = folderPath || this.tr('vaultRoot')
    const files = this.listFilesInFolder(folderPath)
    const summary = {
      folder: folderPath,
      total: files.length,
      pushed: 0,
      skipped: 0,
      stopped: false,
      errors: [],
      direction: 'push-folder'
    }
    this.initTrustSummary(summary)

    this.onLog(`→ ${label} (${files.length})`)
    this.resetBatchCounter()

    for (const file of files) {
      if (!(await this.gateStep())) {
        summary.stopped = true
        break
      }
      const step = await this.pushOneInBatch(summary, file)
      if (step === 'stop') {
        if (!summary.stopped) summary.stopped = !(await this.gateStep())
        break
      }
    }

    this.finalizeTrustSummary(summary)
    this.finalizeFormatSummary(summary)
    return summary
  }

  /** @param {'push'|'pull'|'both'} direction */
  assertPullEnabled (direction) {
    if ((direction === 'pull' || direction === 'both') && !this.settings.showExperimental) {
      throw new Error(this.tr('pullDisabled'))
    }
  }

  /** @param {'push'|'pull'|'both'} direction */
  async runSync (direction = 'both') {
    this.assertPullEnabled(direction)
    if (this.running) throw new Error('SYNC_BUSY')
    this.running = true

    const summary = {
      pushed: 0,
      pulled: 0,
      created: 0,
      skipped: 0,
      conflicts: 0,
      stopped: false,
      errors: [],
      direction: direction === 'push' ? 'push' : direction
    }

    try {
      const files = await this.listSyncFiles()
      const fileByImportKey = new Map()
      const fileByDocId = new Map()
      const total = files.length

      if (direction === 'pull' || direction === 'both') {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (i > 0 && i % 25 === 0) {
            this.onProgress(this.tr('syncPrepProgress', { i, n: total }))
            await yieldToUi()
            if (!(await this.gateStep())) {
              summary.stopped = true
              return summary
            }
          }
          const raw = await this.app.vault.read(file)
          const { frontmatter } = parseNoteFile(raw)
          const importKey = frontmatter.import_key || file.basename
          fileByImportKey.set(importKey, file)
          if (frontmatter.ima_doc_id) fileByDocId.set(frontmatter.ima_doc_id, file)
        }
      }

      let remoteItems = []
      if (direction === 'pull' || direction === 'both') {
        const list = await this.client.listDocuments({ limit: 500 })
        remoteItems = list.items || []
      }

      if (direction === 'push' || direction === 'both') {
        this.initTrustSummary(summary)
        this.onLog(this.tr('syncBatchStart', { n: total }))
        this.resetBatchCounter()
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (!(await this.gateStep())) { summary.stopped = true; break }
          this.reportFileProgress(i + 1, total, file.path)
          if (i > 0 && i % 10 === 0) await yieldToUi()
          try {
            const raw = await this.app.vault.read(file)
            const { frontmatter, body } = parseNoteFile(raw)
            const contentHash = computeContentHash(body)
            const docId = frontmatter.ima_doc_id
            const remote = docId
              ? remoteItems.find(r => r.doc_id === docId)
              : remoteItems.find(r => (r.external_id || r.import_key) === (frontmatter.import_key || file.basename))

            if (remote && direction === 'both') {
              const conflict = detectConflict({
                body,
                contentHash,
                syncedHash: frontmatter.ima_content_hash,
                ima_sync_at: frontmatter.ima_sync_at,
                mtimeIso: new Date(file.stat.mtime).toISOString()
              }, remote)

              if (conflict.kind === 'both_changed') {
                const action = await resolveConflict(this.app, {
                  file,
                  localHash: conflict.localHash,
                  remoteHash: conflict.remoteHash
                }, this.settings.conflictStrategy, (k, v) => this.tr(k, v))

                if (action === 'pull') {
                  await this.pullNote(file, remote)
                  summary.pulled++
                  continue
                }
                if (action === 'skip') {
                  await this.markConflict(file)
                  summary.conflicts++
                  continue
                }
              } else if (conflict.kind === 'remote_newer' && this.settings.conflictStrategy !== 'local') {
                await this.pullNote(file, remote)
                summary.pulled++
                continue
              }
            }

            const r = await this.pushNote(file)
            if (r.skipped) {
              if (r.deduped) {
                summary.deduped = (summary.deduped || 0) + 1
                this.recordTrustItem(summary, file, { action: 'deduped' })
              } else if (r.dedup_ambiguous) {
                summary.dedup_ambiguous = (summary.dedup_ambiguous || 0) + 1
                this.recordTrustItem(summary, file, { action: 'dedup_ambiguous' })
              } else {
                summary.skipped++
                this.recordTrustItem(summary, file, { action: 'skipped' })
              }
              if (!(await this.gateStep())) { summary.stopped = true; break }
              continue
            }
            if (r.pushed) {
              summary.pushed++
              this.recordTrustItem(summary, file, {
                action: 'pushed',
                doc_id: r.doc_id,
                verify: r.verify
              })
              const step = await this.afterPushStep()
              if (step === 'stop') { summary.stopped = true; break }
            }
          } catch (err) {
            const cont = await this.handlePushErrorWithRetry(summary, file, err, () => this.pushNote(file))
            if (!cont) break
          }
        }
        if (summary.pushed || summary.skipped || summary.errors.length) {
          this.onLog(this.tr('syncBatchDone', {
            pushed: summary.pushed,
            skipped: summary.skipped,
            errors: summary.errors.length
          }))
        }
        this.finalizeTrustSummary(summary)
    this.finalizeFormatSummary(summary)
      }

      if ((direction === 'pull' || direction === 'both') && !summary.stopped) {
        for (const remote of remoteItems) {
          if (!(await this.gateStep())) { summary.stopped = true; break }
          const importKey = remote.external_id || remote.import_key
          let file = remote.doc_id ? fileByDocId.get(remote.doc_id) : null
          if (!file && importKey) file = fileByImportKey.get(importKey)

          if (!file && importKey && this.settings.pullNewFromIma) {
            try {
              await this.createNoteFromRemote(remote)
              summary.created++
            } catch (err) {
              summary.errors.push({ remote: remote.doc_id, error: err.message || String(err) })
            }
            continue
          }

          if (!file) continue

          try {
            const raw = await this.app.vault.read(file)
            const { frontmatter, body } = parseNoteFile(raw)
            const conflict = detectConflict({
              body,
              contentHash: computeContentHash(body),
              syncedHash: frontmatter.ima_content_hash,
              ima_sync_at: frontmatter.ima_sync_at
            }, remote)

            if (conflict.kind === 'both_changed') {
              if (direction === 'both') continue
              const action = await resolveConflict(this.app, {
                file,
                localHash: conflict.localHash,
                remoteHash: conflict.remoteHash
              }, this.settings.conflictStrategy, (k, v) => this.tr(k, v))
              if (action !== 'pull') {
                if (action === 'skip') {
                  await this.markConflict(file)
                  summary.conflicts++
                }
                continue
              }
            } else if (conflict.kind === 'local_newer') {
              continue
            } else if (conflict.kind === 'none') {
              summary.skipped++
              continue
            }

            const remoteTime = parseTime(remote.updated_at)
            const localSyncTime = parseTime(frontmatter.ima_sync_at)
            if (remoteTime <= localSyncTime && conflict.kind !== 'remote_newer') {
              summary.skipped++
              continue
            }

            await this.pullNote(file, remote)
            summary.pulled++
          } catch (err) {
            summary.errors.push({ file: file.path, error: err.message || String(err) })
          }
        }
      }

      return summary
    } finally {
      this.running = false
    }
  }

  /** @param {string[]} paths */
  async retryFailedPaths (paths) {
    const list = (paths || []).filter(Boolean)
    const summary = {
      pushed: 0,
      skipped: 0,
      stopped: false,
      errors: [],
      direction: 'retry-failed'
    }
    this.initTrustSummary(summary)
    this.resetBatchCounter()

    for (const notePath of list) {
      const files = this.app.vault.getMarkdownFiles()
      const file = files.find(f => f.path === notePath)
      if (!file) {
        summary.errors.push({ file: notePath, error: 'FILE_NOT_FOUND' })
        continue
      }
      if (!(await this.gateStep())) {
        summary.stopped = true
        break
      }
      const step = await this.pushOneInBatch(summary, file, true)
      if (step === 'stop') {
        summary.stopped = true
        break
      }
    }

    this.finalizeTrustSummary(summary)
    this.finalizeFormatSummary(summary)
    return summary
  }

  /** @param {import('obsidian').TFile} file */
  async markFailed (file, err) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!fm.sync || typeof fm.sync !== 'object') fm.sync = {}
      fm.sync.ima = 'failed'
      fm.ima_sync_error = String(err.message || err).slice(0, 500)
      fm.ima_sync_at = new Date().toISOString()
    })
  }

  /** @param {import('obsidian').TFile} file */
  async markConflict (file) {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!fm.sync || typeof fm.sync !== 'object') fm.sync = {}
      fm.sync.ima = 'conflict'
    })
  }
}

/** @param {Record<string, unknown>} fm @param {object} remote @param {string} contentHash */
function buildFrontmatterPatch (fm, remote, contentHash) {
  const next = { ...fm }
  if (!next.sync || typeof next.sync !== 'object') next.sync = {}
  next.sync.ima = 'synced'
  next.ima_doc_id = remote.doc_id
  next.ima_sync_at = new Date().toISOString()
  next.ima_content_hash = contentHash
  next.ima_sync_error = ''
  if (!next.import_key) next.import_key = remote.external_id || remote.import_key || next.title

  const lines = []
  for (const [k, v] of Object.entries(next)) {
    if (k === 'sync' && v && typeof v === 'object') {
      lines.push('sync:')
      for (const [sk, sv] of Object.entries(v)) {
        lines.push(`  ${sk}: ${yamlScalar(sv)}`)
      }
    } else {
      lines.push(`${k}: ${yamlScalar(v)}`)
    }
  }
  return lines.join('\n')
}

/** @param {unknown} v */
function yamlScalar (v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return JSON.stringify(v)
  return yamlQuote(String(v))
}

/** @param {string} s */
function yamlQuote (s) {
  if (/[:#{}[\],&*!|>'"%@`]/.test(s) || s.includes('\n')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

/** @param {string} name */
function sanitizeFilename (name) {
  return String(name).replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'untitled'
}

module.exports = { ImaSyncEngine }
