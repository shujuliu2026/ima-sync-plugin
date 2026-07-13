'use strict'

const { Plugin, ItemView, Notice, Setting, PluginSettingTab, Modal, TFile, setIcon } = require('obsidian')
const { ImaApiClient, normalizeApiBase } = require('./lib/ima-api')
const { ImaSyncEngine } = require('./lib/sync-engine')
const { SyncControl } = require('./lib/sync-control')
const { isUnderSyncFolders } = require('./lib/utils')
const { SyncStatDetailModal, STAT_KIND_BY_LABEL } = require('./lib/sync-stat-modal')
const { t, label, labelExp, renderPanelAuthor, renderAbout, formatSyncError } = require('./lib/i18n')
const { parseImaError } = require('./lib/ima-errors')
const { isNetworkErrorMessage } = require('./lib/net-retry')
const { attachTip, addButtonWithTip, applySettingTip } = require('./lib/ui-hints')
const { yieldToUi } = require('./lib/ui-yield')
const { createVaultReadyGate } = require('./lib/vault-ready')
const { FeedbackModal } = require('./lib/feedback-modal')
const { normalizeTelemetry, touchActiveDay } = require('./lib/telemetry-local')
const {
  maybeReportInstall,
  maybeReportHeartbeat,
  reportSyncSummary,
  reportSyncError,
  telemetryCtx,
  enqueueEvent,
  flushPending
} = require('./lib/telemetry-report')
const { HOOKS, buildEvent, classifyTelemetryError } = require('./lib/telemetry')
const {
  fetchRemoteNotices,
  dismissRemoteNotice,
  activeNotices
} = require('./lib/remote-notices')
const { isProActive, verifyProLicenseKey, canUseTrust, canUseGovern, canUseFormatFull, syncDirectoriesMax, canAddSyncDirectory, effectiveSyncFolders } = require('./lib/license')
const { isProductionBuild } = require('./lib/build-profile')
const { buildEntitlementBarModel } = require('./lib/entitlements')
const { renderProAdBlock } = require('./lib/pro-ad-block')
const {
  activateProLicenseCloud,
  maybeRefreshCloudEntitlements,
  cloudLicenseEnabled,
  formatProCloudError
} = require('./lib/license-cloud')
const { upsertFailedEntry, removeFailedEntry, normalizeFailedQueue } = require('./lib/failed-queue')
const { formatTrustReportMarkdown } = require('./lib/trust-report')
const { verifyPushedNote, writeVerifyFrontmatter } = require('./lib/trust-verify')
const { noteFileName } = require('./lib/trust-dedup')
const { captureTrustAuthError, formatTrustAuthHint, formatVerifyDetail, verifyDetailKind } = require('./lib/trust-auth')
const {
  noteVerifyBadge,
  trustHeroMetrics,
  listVerifyFailedNotes,
  formatTrustBatchNotice
} = require('./lib/trust-prominence')
const {
  probeTrustCapabilities,
  formatCapabilitySummary,
  formatReadyLevelHint,
  capIcon
} = require('./lib/trust-capabilities')
const { auditNotes, evaluateNoteRules } = require('./lib/govern-rules')
const { formatGovernReportMarkdown } = require('./lib/govern-report')
const { formatForIma, rebuildNoteRaw } = require('./lib/format-pipeline')
const { formatFormatReportMarkdown } = require('./lib/format-report')
const { parseNoteFile } = require('./lib/utils')
const {
  getApiKeyExpiryState,
  shouldShowApiKeyExpiryReminder,
  markApiKeyExpiryReminderShown,
  isLikelyAuthFailure,
  isInvalidApiKeyExpiresAtInput,
  normalizeApiKeyExpiresAtInput,
  clearApiKeyExpiryReminders,
  apiKeyExpiryStatusKey,
  isSettingsTabOpen,
  shouldShowApiKeyExpiryBanner
} = require('./lib/api-key-expiry')
const { ApiKeyExpiryModal } = require('./lib/api-key-expiry-modal')

const VIEW_TYPE = 'ima-sync-panel'

/** 实验功能 UI（拉取/全部同步/KB 实验提示等）；代码保留，默认不展示 */
const EXPERIMENTAL_UI = false

const DEFAULT_SETTINGS = {
  language: 'auto',
  apiUrl: '',
  apiKey: '',
  clientId: '',
  apiKeyExpiresAt: '',
  apiKeyExpiryRemindDays: 7,
  apiKeyExpirySnoozeUntil: '',
  apiKeyExpiryLastReminderDay: '',
  apiKeyExpiryLastReminderLevel: '',
  kbId: '',
  kbLibraries: [],
  activeKbId: '',
  ingestUrl: '',
  syncFolders: [],
  autoSyncMinutes: 0,
  conflictStrategy: 'ask',
  mockMode: false,
  chunkSize: 1500,
  chunkOverlap: 200,
  timeout: 30000,
  syncOnSave: true,
  pullNewFromIma: false,
  openPanelOnStart: false,
  showAdvanced: false,
  showExperimental: false,
  autoSyncPaused: false,
  uploadGapMs: 500,
  batchSize: 80,
  batchPauseSeconds: 30,
  rateLimitBackoffSec: '60,120,300',
  networkRetryCount: 3,
  networkRetryDelayMs: 1500,
  autoReconnectSeconds: 60,
  requestStats: { date: '', count: 0 },
  statsCacheSnapshot: null,
  telemetryEnabled: false,
  telemetryPromptShown: false,
  telemetryUrl: '',
  proLicenseKey: '',
  proActivated: false,
  mockPro: false,
  licenseApiUrl: '',
  licenseCloudEnabled: true,
  licenseMock: false,
  entitlementsCache: null,
  entitlementsCachedAt: '',
  entitlementsCacheKey: '',
  licenseDeviceId: '',
  licenseActivateToken: '',
  failedQueue: [],
  lastTrustReport: null,
  lastGovernReport: null,
  lastFormatReport: null,
  trustApiStatus: null,
  trustCapabilities: null,
  trust: {
    verifyAfterPush: true,
    dedupBeforePush: true,
    dedupAmbiguous: 'warn-push',
    verifyGapMs: 600,
    verifyDelayMs: 2000,
    verifyRetries: 2,
    verifyRetryDelayMs: 3000,
    reportAutoSave: false
  },
  govern: {
    enabled: true,
    maxBodyChars: 12000,
    minTitleChars: 4,
    autoAuditBeforeBatch: false,
    sensitivePatterns: []
  },
  format: {
    enabled: true,
    onPush: true,
    preset: 'core',
    hashSource: 'local',
    writeBack: 'off',
    cjkSpacing: false,
    headingNormalize: false
  }
}

class ImaSyncPanelView extends ItemView {
  constructor (leaf, plugin) {
    super(leaf)
    this.plugin = plugin
    this.logLines = []
    this.healthCache = null
    this.statsCache = null
    this.renderGen = 0
    this._refreshTimer = null
    this.statsWrapEl = null
    this.pauseBannerEl = null
    this.limitBannerEl = null
    this.apiKeyExpiryBannerEl = null
    this.remoteNoticeEl = null
    this._logRenderTimer = null
    this._actionTimer = null
    this._statsRefreshTimer = null
    this._deferredStatusTimer = null
    this.statusLineEl = null
    this.reconnecting = false
    this.vaultLoading = false
    this.requestStatsEl = null
    this._statEls = null
    this._lastNotePath = ''
    this._syncProgressPathEl = null
    this._panelRefreshing = false
    this.headEl = null
    this.hydrateStatsCacheFromSettings()
  }

  hydrateStatsCacheFromSettings () {
    const snap = this.plugin.readStatsCacheSnapshot()
    if (snap) this.statsCache = snap
  }

  /** @param {string[]} folders */
  getDisplayStats (folders) {
    const folderKey = this.syncStatsFolderKey(folders)
    if (this.statsCache?.folderKey === folderKey && this.statsCache.data) {
      return this.statsCache.data
    }
    const snap = this.plugin.readStatsCacheSnapshot()
    if (snap?.data) return snap.data
    if (this.statsCache?.data) return this.statsCache.data
    return null
  }

  getViewType () { return VIEW_TYPE }
  getDisplayText () { return t(this.plugin.settings, 'pluginName') }
  getIcon () { return 'refresh-cw' }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  tipDeps () {
    return { Notice, settings: this.plugin.settings }
  }

  lblExp (key) {
    return labelExp(this.plugin.settings, key)
  }

  mockStatusText (reason) {
    if (reason === 'no_key') return this.tr('statusMockNoKey')
    if (reason === 'no_url') return this.tr('statusMockNoUrl')
    if (reason === 'mock_on') return this.tr('statusMockOn')
    return this.tr('statusMock')
  }

  formatDisconnectMsg (message) {
    const msg = String(message || '')
    if (/404|agent-interface\/documents|Cannot GET/i.test(msg)) {
      return `${this.tr('statusDisconnected')}: ${this.tr('statusTencentHint')}`
    }
    if (isLikelyAuthFailure(msg)) {
      const exp = getApiKeyExpiryState(this.plugin.settings)
      if (exp.level === 'expired') {
        return `${this.tr('statusDisconnected')}: ${this.tr('apiKeyExpiryDisconnectExpired', { date: exp.displayDate })}`
      }
      if (exp.level === 'none') {
        return `${this.tr('statusDisconnected')}: ${this.tr('apiKeyExpiryDisconnectNoDate')}`
      }
    }
    const short = msg.length > 100 ? `${msg.slice(0, 97)}…` : msg
    return `${this.tr('statusDisconnected')}: ${short}`
  }

  async onOpen () {
    this.containerEl.empty()
    this.containerEl.addClass('ima-sync-view-root')
    this.containerEl.closest('.view-content')?.addClass('ima-sync-view-content')
    this.root = this.containerEl.createDiv({ cls: 'ima-sync-panel' })
    this.renderShell()
    await this.refresh()
    void this.plugin.refreshRemoteNotices().catch(() => {})
    void this.plugin.maybePromptApiKeyExpiry()
    this.containerEl.scrollTop = 0
    this.containerEl.closest('.view-content')?.scrollTo(0, 0)
  }

  renderShell () {
    this.root.empty()
    this.headEl = this.root.createDiv({ cls: 'ima-section ima-section-tight ima-panel-head' })
    this.renderPanelHead()
    this.statusEl = this.root.createDiv({ cls: 'ima-section ima-section-tight ima-section-head' })
    this.proAdEl = this.root.createDiv({ cls: 'ima-section ima-pro-ad-section' })
    this.trustEl = this.root.createDiv({ cls: 'ima-section ima-trust-section' })
    this.governEl = this.root.createDiv({ cls: 'ima-section ima-govern-section' })
    this.formatEl = this.root.createDiv({ cls: 'ima-section ima-format-section' })
    this.noteEl = this.root.createDiv({ cls: 'ima-section' })
    this.actionsEl = this.root.createDiv({ cls: 'ima-section' })
    this.logEl = this.root.createDiv({ cls: 'ima-section ima-log' })
    this.footEl = this.root.createDiv({ cls: 'ima-section ima-section-last ima-panel-foot' })
    this.renderPanelFoot()
  }

  renderPanelFoot () {
    if (!this.footEl) return
    this.footEl.empty()
    this.footEl.createDiv({ cls: 'ima-copyright-line ima-muted', text: this.tr('copyrightShort') })
  }

  /** 刷新按钮 busy 态与 _panelRefreshing 同步（renderPanelHead 重建 DOM 后仍正确） */
  syncRefreshButtonBusy () {
    const btn = this.headEl?.querySelector('.ima-toolbar-refresh')
    if (!btn) return
    if (this._panelRefreshing) btn.addClass('is-busy')
    else btn.removeClass('is-busy')
  }

  renderPanelHead () {
    if (!this.headEl) return
    this.headEl.empty()
    const titleRow = this.headEl.createDiv({ cls: 'ima-panel-title-row' })
    titleRow.createEl('h2', { text: this.tr('panelTitle') })
    const toolbar = titleRow.createDiv({ cls: 'ima-panel-toolbar' })
    const refreshWrap = toolbar.createDiv({ cls: 'ima-toolbar-group' })
    const refreshBtn = refreshWrap.createEl('button', {
      cls: 'ima-toolbar-btn ima-toolbar-refresh',
      attr: { type: 'button', 'aria-label': this.tr('panelRefresh') }
    })
    setIcon(refreshBtn, 'refresh-cw')
    refreshBtn.addEventListener('click', () => { void this.manualRefresh() })
    attachTip(refreshWrap, this.plugin.settings, 'panelRefresh', this.tipDeps())
    const settingsBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn',
      attr: { type: 'button', 'aria-label': this.tr('panelSettings') }
    })
    setIcon(settingsBtn, 'settings')
    settingsBtn.addEventListener('click', () => this.plugin.openSettings())
    const helpBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn',
      attr: { type: 'button', 'aria-label': this.tr('panelHelp') }
    })
    setIcon(helpBtn, 'help-circle')
    helpBtn.addEventListener('click', () => {
      new AuthorAboutModal(this.app, this.plugin).open()
    })
    renderPanelAuthor(this.headEl, this.plugin.settings, {
      onAuthorClick: () => new AuthorAboutModal(this.app, this.plugin).open()
    })
    this.syncRefreshButtonBusy()
  }

  applyHealthWatch (health) {
    if (health?.ok && !health.mock) this.plugin.clearConnectionWatch()
    else if (health && !health.ok && isNetworkErrorMessage(health.message)) {
      this.plugin.scheduleConnectionWatch()
    }
  }

  async manualRefresh () {
    if (this._panelRefreshing) return
    if (this.plugin.syncing) {
      new Notice(this.tr('panelRefreshBusy'), 3000)
      return
    }
    this._panelRefreshing = true
    this.syncRefreshButtonBusy()
    if (this._statsRefreshTimer) {
      window.clearTimeout(this._statsRefreshTimer)
      this._statsRefreshTimer = null
    }

    const gen = ++this.renderGen
    const warmPanel = Boolean(this.statusLineEl?.isConnected && this.statsWrapEl?.isConnected)

    try {
      if (warmPanel) {
        // 不阻塞等全库 metadata；Obsidian 文件已可见即可刷新统计与连接
        await this.plugin.whenVaultReady({ timeoutMs: 4000 })
        this.vaultLoading = false
        this.healthCache = null
        this._lastNotePath = ''
        this.reconnecting = true
        this.updateHealthLine(this.healthCache?.data || { ok: false, message: '' })

        const [health, stats] = await Promise.all([
          this.checkHealthCached(true),
          this.computeSyncStats({ force: true })
        ])
        if (gen !== this.renderGen) return

        this.reconnecting = false
        this.updateHealthLine(health)
        this.applyHealthWatch(health)
        if (health.syncLimit) this.plugin.markSyncLimit(health.syncLimit)

        if (this.statsWrapEl?.isConnected) this.renderStatsBlock(this.statsWrapEl, stats)
        this.applyStatusLocale()
        this.renderSyncPauseBanner()
        this.renderSyncLimitBanner()
        this.renderApiKeyExpiryBanner()
        this.renderRemoteNoticeBanner()
        await this.renderCurrentNote(true)
      } else {
        this.healthCache = null
        this.invalidateStatsCache()
        this._lastNotePath = ''
        await this.refresh({ soft: false, forceHealth: true, forceHeavy: true, stats: true, note: true, log: false, actions: true })
        await this.plugin.refreshRemoteNotices({ force: true })
      }
      new Notice(this.tr('panelRefreshDone'), 2000)
    } finally {
      this.reconnecting = false
      this._panelRefreshing = false
      this.syncRefreshButtonBusy()
    }
  }

  appendLog (msg) {
    const ts = new Date().toLocaleTimeString()
    this.logLines.unshift(`[${ts}] ${msg}`)
    if (this.logLines.length > 30) this.logLines.length = 30
    if (this.logEl) this.scheduleLogRender()
  }

  scheduleLogRender () {
    if (this._logRenderTimer) window.clearTimeout(this._logRenderTimer)
    this._logRenderTimer = window.setTimeout(() => {
      this._logRenderTimer = null
      this.renderLog()
    }, 80)
  }

  flushLogRender () {
    if (this._logRenderTimer) {
      window.clearTimeout(this._logRenderTimer)
      this._logRenderTimer = null
      this.renderLog()
    }
  }

  scheduleRenderActions () {
    if (this._actionTimer) window.clearTimeout(this._actionTimer)
    this._actionTimer = window.setTimeout(() => {
      this._actionTimer = null
      if (this.plugin.syncing && this.updateSyncProgress(this.plugin.syncProgress)) return
      if (this.plugin.syncing) this.renderActions()
    }, 150)
  }

  /** @param {string} [text] @returns {boolean} 是否已就地更新 */
  updateSyncProgress (text) {
    const pathEl = this._syncProgressPathEl || this.actionsEl?.querySelector('.ima-sync-progress-path')
    if (!pathEl?.isConnected) {
      this._syncProgressPathEl = null
      return false
    }
    this._syncProgressPathEl = pathEl
    pathEl.setText(text || this.tr('syncingWait'))
    const full = text || this.tr('syncingWait')
    if (full) pathEl.setAttr('title', full)
    return true
  }

  renderLog () {
    if (!this.logEl) return
    this.logEl.empty()
    this.logEl.createEl('h3', { cls: 'ima-log-title', text: this.tr('log') })
    const body = this.logEl.createDiv({ cls: 'ima-log-body' })
    if (!this.logLines.length) {
      body.createDiv({ cls: 'ima-log-empty', text: this.tr('logEmpty') })
      return
    }
    const pre = body.createEl('pre', { cls: 'ima-log-pre' })
    pre.setText(this.logLines.join('\n'))
  }

  getEngine () {
    return this.plugin.createEngine(
      (msg) => this.appendLog(msg),
      (path) => this.plugin.setSyncProgress(path)
    )
  }

  renderProAdSection () {
    if (!this.proAdEl) return
    this.proAdEl.empty()
    if (isProActive(this.plugin.settings)) return
    renderProAdBlock(this.proAdEl, this.plugin.settings, {
      onActivate: () => { void this.plugin.syncProLicenseCloud() }
    })
  }

  renderTrustSection () {
    if (!this.trustEl) return
    this.trustEl.empty()
    this.renderEntitlementBar(this.trustEl)

    if (!canUseTrust(this.plugin.settings)) {
      return
    }

    const report = this.plugin.settings.lastTrustReport
    const queue = this.plugin.settings.failedQueue || []
    const m = trustHeroMetrics(report)
    const hero = this.trustEl.createDiv({ cls: 'ima-trust-hero' })
    const heroHead = hero.createDiv({ cls: 'ima-trust-hero-head' })
    heroHead.createEl('h3', { cls: 'ima-trust-hero-title', text: this.tr('trustHeroTitle') })
    attachTip(heroHead, this.plugin.settings, 'trustHero', this.tipDeps())

    const apiStatus = this.plugin.settings.trustApiStatus
    const caps = this.plugin.settings.trustCapabilities
    if (caps?.checkedAt) {
      this.renderCapabilityRadar(hero, caps)
    } else if (apiStatus && apiStatus.ok === false) {
      hero.createDiv({
        cls: 'ima-warn ima-compact ima-trust-auth-banner',
        text: formatTrustAuthHint(this.tr.bind(this), apiStatus.message)
      })
    }

    const pctWrap = hero.createDiv({ cls: 'ima-trust-pct-wrap' })
    if (m.pct != null && m.denom > 0) {
      const pctBox = pctWrap.createDiv({ cls: `ima-trust-pct ${m.failed ? 'ima-trust-pct--warn' : 'ima-trust-pct--ok'}` })
      pctBox.createSpan({ cls: 'ima-trust-pct-num', text: this.tr('trustHeroPct', { pct: m.pct }) })
      pctBox.createSpan({ cls: 'ima-trust-pct-label', text: this.tr('trustHeroSearchable') })
      pctWrap.createDiv({
        cls: 'ima-trust-pct-meta ima-muted ima-compact',
        text: `${m.verified}/${m.denom} · ${this.tr('trustDeduped')} ${report?.counts?.deduped || 0} · ${this.tr('errors')} ${report?.counts?.failed || queue.length}`
      })
    } else {
      pctWrap.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('trustReportNone') })
    }
    hero.createDiv({ cls: 'ima-trust-hero-sub ima-muted ima-compact', text: this.tr('trustHeroSub') })

    const fails = listVerifyFailedNotes(this.plugin.settings, this.app, 6)
    if (fails.length) {
      const list = hero.createDiv({ cls: 'ima-trust-fail-list' })
      list.createDiv({
        cls: 'ima-trust-fail-head',
        text: `${this.tr('trustHeroFailList')} (${fails.length})`
      })
      for (const item of fails) {
        const row = list.createDiv({ cls: 'ima-trust-fail-item', text: item.path })
        row.setAttr('title', item.detail || item.path)
        row.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(item.path)
          if (f) void this.app.workspace.getLeaf(false).openFile(f)
        })
      }
    }

    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    row.createEl('button', { text: this.tr('trustReportExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportLastTrustReport() })
    const retryBtn = row.createEl('button', {
      text: `${this.tr('trustRetryFailed')} (${queue.length})`,
      cls: 'ima-btn-secondary'
    })
    retryBtn.disabled = !queue.length || this.plugin.syncing
    retryBtn.addEventListener('click', () => { void this.plugin.retryFailedQueue() })
  }

  renderEntitlementBar (parentEl) {
    const model = buildEntitlementBarModel(this.plugin.settings, this.tr.bind(this))
    const block = parentEl.createDiv({ cls: 'ima-ent-block ima-trust-cap-block' })
    block.createDiv({ cls: 'ima-trust-cap-title ima-compact', text: this.tr('entTitle') })
    const head = block.createDiv({ cls: 'ima-ent-head' })
    head.createSpan({ cls: `ima-ent-tier tier-${model.tier}`, text: model.tierLabel })
    const statusCls = model.status === 'active'
      ? 'cap-ok'
      : model.status === 'grace'
        ? 'cap-unk'
        : 'cap-fail'
    head.createSpan({ cls: `ima-ent-status ima-trust-cap-chip ${statusCls}`, text: model.statusLabel })
    if (model.modules.length) {
      const row = block.createDiv({ cls: 'ima-trust-cap-row' })
      for (const mod of model.modules) {
        row.createSpan({ cls: 'ima-trust-cap-chip cap-ok', text: mod.label })
      }
    } else if (model.tier === 'free') {
      block.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('entModCoreFree') })
    }
    if (model.limitsNote) {
      block.createDiv({ cls: 'ima-warn ima-compact ima-ent-limits', text: model.limitsNote })
    }
    if (model.source === 'cloud-cache') {
      const cachedAt = String(this.plugin.settings.entitlementsCachedAt || '').slice(0, 19).replace('T', ' ')
      if (cachedAt) {
        block.createDiv({
          cls: 'ima-muted ima-compact ima-ent-cloud-meta',
          text: this.tr('proCloudCachedAt', { at: cachedAt })
        })
      }
    }
  }

  renderCapabilityRadar (hero, caps) {
    const block = hero.createDiv({ cls: 'ima-trust-cap-block' })
    const capHead = block.createDiv({ cls: 'ima-trust-cap-head' })
    capHead.createDiv({ cls: 'ima-trust-cap-title ima-compact', text: this.tr('trustCapTitle') })
    attachTip(capHead, this.plugin.settings, 'trustCap', this.tipDeps())
    const row = block.createDiv({ cls: 'ima-trust-cap-row' })
    /** @type {[keyof typeof caps, string][]} */
    const items = [
      ['base', 'trustCapBase'],
      ['dedup', 'trustCapDedup'],
      ['verify', 'trustCapVerify']
    ]
    for (const [key, labelKey] of items) {
      const val = caps[key]
      const state = val === true ? 'ok' : val === false ? 'fail' : 'unk'
      row.createSpan({
        cls: `ima-trust-cap-chip cap-${state}`,
        text: `${this.tr(labelKey)}${capIcon(val)}`
      })
    }
    const hintCls = caps.readyLevel === 'blocked' || caps.readyLevel === 'push-only'
      ? 'ima-warn ima-compact'
      : 'ima-muted ima-compact'
    block.createDiv({ cls: `${hintCls} ima-trust-cap-hint`, text: formatReadyLevelHint(caps, this.tr.bind(this)) })
    if (caps.readyLevel === 'blocked') {
      block.createDiv({ cls: 'ima-trust-cap-steps ima-compact', text: this.tr('trustCapBlockedSteps') })
    }
    if (!caps.checkedAt) {
      block.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('trustCapHintUnknown') })
    }
    block.createEl('button', { text: this.tr('trustCapProbe'), cls: 'ima-btn-secondary ima-btn-compact ima-trust-cap-btn' })
      .addEventListener('click', () => { void this.plugin.probeTrustCapabilities() })
  }

  renderGovernSection () {
    if (!this.governEl) return
    this.governEl.empty()

    if (!canUseGovern(this.plugin.settings)) {
      return
    }

    const report = this.plugin.settings.lastGovernReport
    const hero = this.governEl.createDiv({ cls: 'ima-govern-hero' })
    const governHead = hero.createDiv({ cls: 'ima-trust-hero-head' })
    governHead.createEl('h3', { cls: 'ima-trust-hero-title', text: this.tr('governHeroTitle') })
    attachTip(governHead, this.plugin.settings, 'governHero', this.tipDeps())

    if (report?.total) {
      hero.createDiv({
        cls: 'ima-govern-summary ima-compact',
        text: this.tr('governHeroSummary', {
          total: report.total,
          high: report.highRisk || 0,
          medium: report.counts?.medium || 0
        })
      })
      const fails = (report.items || []).filter(i => i.risk === 'high' || i.risk === 'medium').slice(0, 6)
      if (fails.length) {
        const list = hero.createDiv({ cls: 'ima-trust-fail-list' })
        list.createDiv({ cls: 'ima-trust-fail-head', text: `${this.tr('governIssueList')} (${fails.length})` })
        for (const item of fails) {
          const row = list.createDiv({ cls: 'ima-trust-fail-item', text: item.path })
          row.setAttr('title', (item.codes || []).join(', '))
          row.addEventListener('click', () => {
            const f = this.app.vault.getAbstractFileByPath(item.path)
            if (f) void this.app.workspace.getLeaf(false).openFile(f)
          })
        }
      }
    } else {
      hero.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('governReportNone') })
    }

    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    row.createEl('button', { text: this.tr('governAuditFolder'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.auditSyncFolder() })
    row.createEl('button', { text: this.tr('governAuditCurrent'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.auditCurrentNote() })
    row.createEl('button', { text: this.tr('governReportExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportLastGovernReport() })
  }

  renderFormatSection () {
    if (!this.formatEl) return
    this.formatEl.empty()
    if (this.plugin.settings.format?.enabled === false) return

    const report = this.plugin.settings.lastFormatReport
    const hero = this.formatEl.createDiv({ cls: 'ima-format-hero ima-govern-hero' })
    const head = hero.createDiv({ cls: 'ima-trust-hero-head' })
    head.createEl('h3', { cls: 'ima-trust-hero-title', text: this.tr('formatHeroTitle') })

    const counts = report?.counts
    if (counts?.total) {
      hero.createDiv({
        cls: 'ima-govern-summary ima-compact',
        text: this.tr('formatHeroSummary', {
          formatted: counts.formatted || 0,
          unchanged: counts.unchanged || 0
        })
      })
    } else {
      hero.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('formatReportNone') })
    }

    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    row.createEl('button', { text: this.tr('formatPreviewCurrent'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.previewFormatCurrentNote() })
    row.createEl('button', { text: this.tr('cmdFormatExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportLastFormatReport() })
  }

  renderRequestStats () {
    if (!this.requestStatsEl) return
    const stats = this.plugin.settings.requestStats
    const today = new Date().toISOString().slice(0, 10)
    const count = stats?.date === today ? (stats.count || 0) : 0
    this.requestStatsEl.setText(this.tr('todayRequests', { n: count }))
  }

  renderKbSelector () {
    const libs = this.plugin.settings.kbLibraries || []
    const block = this.statusEl.createDiv({ cls: 'ima-kb-block' })
    if (!libs.length) {
      block.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('kbNone') })
      return
    }
    const wrap = block.createDiv({ cls: 'ima-kb-select' })
    wrap.createSpan({ cls: 'ima-kb-label', text: this.tr('kbSelect') })
    attachTip(wrap, this.plugin.settings, 'kbSelect', this.tipDeps())
    const select = wrap.createEl('select', { cls: 'ima-kb-dropdown' })
    const active = this.plugin.getActiveKbId()
    select.createEl('option', {
      value: '',
      text: this.tr('kbSelectPlaceholder'),
      selected: !active
    })
    for (const kb of libs) {
      const opt = select.createEl('option', {
        value: kb.id,
        text: kb.label && kb.label !== kb.id ? `${kb.label} (${kb.id})` : kb.id
      })
      if (kb.id === active) opt.selected = true
    }
    select.addEventListener('change', () => {
      this.plugin.settings.activeKbId = select.value
      void this.plugin.saveSettings()
    })
  }

  /** 设置页改知识库后刷新侧栏下拉（无需整页重绘） */
  refreshKbSelector () {
    if (!this.statusEl || !this.statusLineEl?.isConnected) return false
    this.statusEl.querySelector('.ima-kb-block')?.remove()
    const block = this.statusEl.createDiv({ cls: 'ima-kb-block' })
    this.statusLineEl.insertAdjacentElement('afterend', block)
    const libs = this.plugin.settings.kbLibraries || []
    if (!libs.length) {
      block.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('kbNone') })
      return true
    }
    const wrap = block.createDiv({ cls: 'ima-kb-select' })
    wrap.createSpan({ cls: 'ima-kb-label', text: this.tr('kbSelect') })
    attachTip(wrap, this.plugin.settings, 'kbSelect', this.tipDeps())
    const select = wrap.createEl('select', { cls: 'ima-kb-dropdown' })
    const active = this.plugin.getActiveKbId()
    select.createEl('option', {
      value: '',
      text: this.tr('kbSelectPlaceholder'),
      selected: !active
    })
    for (const kb of libs) {
      const opt = select.createEl('option', {
        value: kb.id,
        text: kb.label && kb.label !== kb.id ? `${kb.label} (${kb.id})` : kb.id
      })
      if (kb.id === active) opt.selected = true
    }
    select.addEventListener('change', () => {
      this.plugin.settings.activeKbId = select.value
      void this.plugin.saveSettings()
    })
    return true
  }

  /** 切换语言时更新知识库下拉文案，避免整块 DOM 重建 */
  updateKbSelectorLocale () {
    const block = this.statusEl?.querySelector('.ima-kb-block')
    if (!block) return
    const label = block.querySelector('.ima-kb-label')
    if (label) label.setText(this.tr('kbSelect'))
    const placeholder = block.querySelector('.ima-kb-dropdown option[value=""]')
    if (placeholder) placeholder.setText(this.tr('kbSelectPlaceholder'))
    if (!block.querySelector('.ima-kb-select')) {
      const none = block.querySelector('.ima-muted.ima-compact')
      if (none) none.setText(this.tr('kbNone'))
    }
  }

  formatSummary (summary) {
    const parts = []
    if (summary.syncLimit === 'quota') parts.push(this.tr('quotaExceeded'))
    else if (summary.syncLimit === 'rate') parts.push(this.tr('rateLimitExceeded'))
    if (summary.stopped) parts.push(this.tr('syncStopped'))
    if (summary.pushed) parts.push(`${this.tr('pushed')} ${summary.pushed}`)
    if (summary.pulled) parts.push(`${this.tr('pulled')} ${summary.pulled}`)
    if (summary.created) parts.push(`${this.tr('created')} ${summary.created}`)
    if (summary.conflicts) parts.push(`${this.tr('conflicts')} ${summary.conflicts}`)
    if (summary.skipped) parts.push(`${this.tr('skipped')} ${summary.skipped}`)
    if (summary.deduped) parts.push(`${this.tr('trustDeduped')} ${summary.deduped}`)
    if (summary.formatted) parts.push(`${this.tr('formatFormatted')} ${summary.formatted}`)
    if (summary.format_unchanged) parts.push(`${this.tr('formatUnchanged')} ${summary.format_unchanged}`)
    if (summary.verified != null && summary.pushed) {
      parts.push(`${this.tr('trustVerified')} ${summary.verified}/${summary.pushed}`)
    }
    if (summary.verify_failed) parts.push(`${this.tr('trustVerifyFailed')} ${summary.verify_failed}`)
    if (summary.errors.length) parts.push(`${this.tr('errors')} ${summary.errors.length}`)
    return parts.length ? ` (${parts.join(' · ')})` : ''
  }

  invalidateStatsCache () {
    this._statEls = null
    this.hydrateStatsCacheFromSettings()
  }

  /** 库就绪后刷新统计与连接（防抖） */
  scheduleDeferredStatusRefresh () {
    if (this._deferredStatusTimer) window.clearTimeout(this._deferredStatusTimer)
    this._deferredStatusTimer = window.setTimeout(() => {
      this._deferredStatusTimer = null
      void this.plugin.whenVaultReady({ timeoutMs: 12000 }).then(() => {
        if (!this.statsWrapEl?.isConnected) return
        if (this.plugin.syncing) return
        this.vaultLoading = false
        void this.runStatusHeavyWork({ gen: this.renderGen, forceHealth: false, skipStats: false })
      })
    }, 200)
  }

  /** 同步结束后防抖重算统计，避免连续推送多次全库扫描 */
  scheduleStatsRefresh () {
    this.invalidateStatsCache()
    if (this._statsRefreshTimer) window.clearTimeout(this._statsRefreshTimer)
    this._statsRefreshTimer = window.setTimeout(() => {
      this._statsRefreshTimer = null
      void this.plugin.whenVaultReady({ timeoutMs: 12000 }).then(() => {
        void this.refresh({ soft: true, stats: true, note: false, actions: false, log: false })
      })
    }, 700)
  }

  /** 设置里改 API 后仅更新连接状态行，不重建侧栏、不重算统计 */
  async refreshConnectionQuiet () {
    if (!this.statusLineEl?.isConnected) return
    const health = await this.checkHealthCached(true)
    if (!this.statusLineEl?.isConnected) return
    this.updateHealthLine(health)
    if (health.ok && !health.mock) {
      this.plugin.clearConnectionWatch()
    } else if (!health.ok && isNetworkErrorMessage(health.message)) {
      this.plugin.scheduleConnectionWatch()
    }
  }

  /** @param {{ soft?: boolean, status?: boolean, log?: boolean, actions?: boolean, note?: boolean, full?: boolean }} [opts] */
  scheduleRefresh (opts = {}) {
    if (this._refreshTimer) window.clearTimeout(this._refreshTimer)
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = null
      void this.refresh(opts)
    }, 320)
  }

  /**
   * 分片统计，避免大库一次性阻塞 UI
   * @returns {Promise<{ total: number, synced: number, pending: number, failed: number, conflict: number }>}
   */
  syncStatsFolderKey (folders) {
    return (folders || []).slice().sort().join('\0')
  }

  async computeSyncStats (opts = {}) {
    const force = Boolean(opts.force)
    const folders = this.plugin.getSyncScopeFolders()
    const folderKey = this.syncStatsFolderKey(folders)
    const all = this.app.vault.getMarkdownFiles()
    const files = folders.length
      ? all.filter(f => isUnderSyncFolders(f.path, folders))
      : all
    const ttl = this.plugin.syncing ? 120000 : (files.length > 5000 ? 120000 : 30000)
    if (
      !force &&
      this.statsCache &&
      this.statsCache.folderKey === folderKey &&
      Date.now() - this.statsCache.at < ttl
    ) {
      return this.statsCache.data
    }

    let synced = 0
    let pending = 0
    let failed = 0
    let conflict = 0
    let searchable = 0
    let verifyFailed = 0
    let verifyPending = 0
    const chunk = 120

    for (let i = 0; i < files.length; i++) {
      const fm = this.app.metadataCache.getFileCache(files[i])?.frontmatter
      const sync = fm?.sync?.ima
      if (sync === 'synced') synced++
      else if (sync === 'failed') failed++
      else if (sync === 'conflict') conflict++
      else pending++

      if (fm?.sync?.ima === 'synced') {
        const v = fm?.sync?.ima_verify
        if (v === 'verified') searchable++
        else if (v === 'failed') verifyFailed++
        else if (v === 'pending') verifyPending++
      }

      if (i > 0 && i % chunk === 0) {
        await yieldToUi()
      }
    }

    const data = {
      total: files.length,
      synced,
      pending,
      failed,
      conflict,
      searchable,
      verifyFailed,
      verifyPending
    }
    this.statsCache = { at: Date.now(), folderKey, data }
    this.plugin.schedulePersistStatsCache(this.statsCache)
    return data
  }

  /** @param {import('./lib/sync-stats').SyncStatKind} labelKey */
  openStatDetail (labelKey) {
    const kind = STAT_KIND_BY_LABEL[labelKey]
    if (!kind) return
    new SyncStatDetailModal(this.app, this.plugin, kind).open()
  }

  /** @param {HTMLElement} wrap @param {{ total: number, synced: number, pending: number, failed: number, conflict: number }} stats */
  renderStatsBlock (wrap, stats) {
    const nums = [stats.total, stats.synced, stats.pending, stats.failed, stats.conflict]
    if (this._statEls?.length === 5 && wrap.contains(this._statEls[0])) {
      for (let i = 0; i < 5; i++) {
        if (this._statEls[i].textContent !== String(nums[i])) {
          this._statEls[i].setText(String(nums[i]))
        }
      }
      if (canUseTrust(this.plugin.settings)) {
        this.renderTrustStatsBlock(wrap, stats)
      }
      return
    }

    wrap.empty()
    this._statEls = []
    const row = wrap.createDiv({ cls: 'ima-stats-row ima-stats-row-5' })
    const items = [
      [stats.total, 'notes'],
      [stats.synced, 'statSynced'],
      [stats.pending, 'statPending'],
      [stats.failed, 'statFailed'],
      [stats.conflict, 'statConflict']
    ]
    for (const [n, l] of items) {
      const box = row.createDiv({ cls: 'ima-stat ima-stat-clickable' })
      box.setAttr('role', 'button')
      box.setAttr('tabindex', '0')
      box.setAttr('title', this.tr('statDetailClickHint'))
      const numEl = box.createSpan({ cls: 'n', text: String(n) })
      this._statEls.push(numEl)
      box.createSpan({ cls: 'l', text: this.tr(l) })
      const open = () => this.openStatDetail(l)
      box.addEventListener('click', open)
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    }

    wrap.createDiv({
      cls: 'ima-stat-privacy ima-muted ima-compact',
      text: this.tr('statLocalPrivacy')
    })

    if (canUseTrust(this.plugin.settings)) {
      this.renderTrustStatsBlock(wrap, stats)
    }
  }

  /** @param {HTMLElement} wrap @param {object} stats */
  renderTrustStatsBlock (wrap, stats) {
    let row = wrap.querySelector('.ima-stats-row-trust')
    if (!row) {
      row = wrap.createDiv({ cls: 'ima-stats-row ima-stats-row-3 ima-stats-row-trust' })
      wrap.insertBefore(row, wrap.querySelector('.ima-stat-privacy'))
    } else {
      row.empty()
    }
    const items = [
      [stats.searchable || 0, 'statSearchable'],
      [stats.verifyFailed || 0, 'statVerifyFailed'],
      [stats.verifyPending || 0, 'statVerifyPending']
    ]
    for (const [n, l] of items) {
      const box = row.createDiv({ cls: 'ima-stat ima-stat-clickable ima-stat-trust' })
      box.setAttr('role', 'button')
      box.setAttr('tabindex', '0')
      box.createSpan({ cls: 'n', text: String(n) })
      box.createSpan({ cls: 'l', text: this.tr(l) })
      const open = () => this.openStatDetail(l)
      box.addEventListener('click', open)
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    }
  }

  renderSyncLimitBanner () {
    if (!this.statusEl) return
    if (this.limitBannerEl?.isConnected) this.limitBannerEl.remove()
    this.limitBannerEl = null

    const until = this.plugin.syncLimitUntil || 0
    if (!until || Date.now() > until) return

    const key = this.plugin.syncLimitKind === 'quota' ? 'quotaExceededBanner' : 'rateLimitBanner'
    this.limitBannerEl = this.statusEl.createDiv({ cls: 'ima-warn ima-limit-banner' })
    this.limitBannerEl.setText(this.tr(key))
  }

  renderApiKeyExpiryBanner () {
    if (!this.statusEl) return
    if (this.apiKeyExpiryBannerEl?.isConnected) this.apiKeyExpiryBannerEl.remove()
    this.apiKeyExpiryBannerEl = null

    const s = this.plugin.settings
    const state = getApiKeyExpiryState(s)
    if (!shouldShowApiKeyExpiryBanner(s, state)) return

    const expired = state.level === 'expired'
    const lineKey = expired ? 'apiKeyExpiryBannerLineExpired' : 'apiKeyExpiryBannerLineSoon'
    this.apiKeyExpiryBannerEl = this.statusEl.createDiv({
      cls: `ima-warn ima-compact ima-api-key-expiry-banner${expired ? ' ima-api-key-expiry-banner--expired' : ''}`
    })
    this.apiKeyExpiryBannerEl.setText(this.tr(lineKey, {
      date: state.displayDate,
      days: state.daysLeft ?? 0
    }))
    this.apiKeyExpiryBannerEl.setAttr('role', 'button')
    this.apiKeyExpiryBannerEl.setAttr('tabindex', '0')
    const open = () => this.plugin.openSettings()
    this.apiKeyExpiryBannerEl.addEventListener('click', open)
    this.apiKeyExpiryBannerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    })
  }

  renderRemoteNoticeBanner () {
    if (!this.statusEl) return
    if (this.remoteNoticeEl?.isConnected) this.remoteNoticeEl.remove()
    this.remoteNoticeEl = null

    const notices = activeNotices(this.plugin.settings, this.plugin.manifest.version)
    if (!notices.length) return

    const wrap = this.statusEl.createDiv({ cls: 'ima-remote-notices' })
    this.remoteNoticeEl = wrap

    for (const notice of notices) {
      const level = notice.level === 'urgent' || notice.level === 'warn' ? notice.level : 'info'
      const box = wrap.createDiv({ cls: `ima-remote-notice ima-remote-notice--${level}` })
      box.createDiv({ cls: 'ima-remote-notice__title', text: notice.title })
      box.createEl('p', { cls: 'ima-remote-notice__body', text: notice.body })
      const actions = box.createDiv({ cls: 'ima-remote-notice__actions' })
      if (notice.link_url) {
        const link = actions.createEl('a', {
          cls: 'ima-remote-notice__link',
          text: notice.link_label || this.tr('remoteNoticeLink'),
          href: notice.link_url
        })
        link.setAttr('target', '_blank')
        link.setAttr('rel', 'noopener noreferrer')
      }
      if (notice.dismissible !== false) {
        const btn = actions.createEl('button', {
          text: this.tr('remoteNoticeDismiss'),
          cls: 'ima-btn-secondary'
        })
        btn.setAttr('type', 'button')
        btn.addEventListener('click', () => {
          dismissRemoteNotice(this.plugin.settings, notice.id)
          void this.plugin.saveData(this.plugin.settings).then(() => {
            this.renderRemoteNoticeBanner()
          })
        })
      }
    }
  }

  renderSyncPauseBanner () {
    if (!this.statusEl) return
    if (this.pauseBannerEl?.isConnected) this.pauseBannerEl.remove()
    this.pauseBannerEl = null
    if (this.plugin.syncing && this.plugin.syncControl?.paused) {
      this.pauseBannerEl = this.statusEl.createDiv({ cls: 'ima-warn ima-compact' })
      this.pauseBannerEl.setText(this.tr('statusPaused'))
    }
  }

  /**
   * 切换语言：只更新文案，不重建状态区、不重算统计、不探测连接
   */
  refreshLocale () {
    ++this.renderGen
    this.renderPanelHead()
    this.renderPanelFoot()
    this.applyStatusLocale()
    this.renderActions()
    this.renderProAdSection()
    this.renderTrustSection()
    this.renderGovernSection()
    this.renderFormatSection()
    void this.renderCurrentNote(true)
    const logTitle = this.logEl?.querySelector('.ima-log-title')
    if (logTitle) logTitle.setText(this.tr('log'))
    const logEmpty = this.logEl?.querySelector('.ima-log-empty')
    if (logEmpty) logEmpty.setText(this.tr('logEmpty'))
  }

  updateStatBlockLocale () {
    if (!this.statsWrapEl) return
    const keys = ['notes', 'statSynced', 'statPending', 'statFailed', 'statConflict']
    const labels = this.statsWrapEl.querySelectorAll('.ima-stat .l')
    keys.forEach((k, i) => {
      if (labels[i]) labels[i].setText(this.tr(k))
    })
    this.statsWrapEl.querySelectorAll('.ima-stat').forEach((box) => {
      box.setAttr('title', this.tr('statDetailClickHint'))
    })
    const privacy = this.statsWrapEl.querySelector('.ima-stat-privacy')
    if (privacy) privacy.setText(this.tr('statLocalPrivacy'))
    const statsHeadLabel = this.statusEl?.querySelector('.ima-stats-label')
    if (statsHeadLabel) statsHeadLabel.setText(this.tr('statPanelLabel'))
  }

  applyStatusLocale () {
    if (!this.statusEl) return
    const health = this.healthCache?.data
    if (health) this.updateHealthLine(health)

    const folderSpan = this.statusEl.querySelector('.ima-folder-row > span')
    if (folderSpan) {
      const folders = this.plugin.getSyncScopeFolders()
      folderSpan.setText(
        folders.length
          ? `${this.tr('syncFolders')}: ${folders.join(', ')}`
          : this.tr('syncFoldersAll')
      )
    }

    this.updateStatBlockLocale()

    const autoLabel = this.statusEl.querySelector('.ima-auto-sync-label')
    if (autoLabel) autoLabel.setText(this.tr('autoSyncPanelLabel'))
    const autoInput = this.statusEl.querySelector('.ima-auto-sync-input')
    if (autoInput) autoInput.setAttr('title', this.tr('autoSyncDesc'))
    const pausedEl = this.statusEl.querySelector('.ima-auto-sync-paused')
    if (pausedEl) pausedEl.setText(this.tr('statusAutoSyncPaused'))
    const saveHint = this.statusEl.querySelector('.ima-auto-sync-hint')
    if (saveHint) saveHint.setText(this.tr('syncOnSaveActiveHint'))

    this.renderRequestStats()
    this.renderSyncPauseBanner()
    this.renderSyncLimitBanner()
    this.renderApiKeyExpiryBanner()
    this.renderRemoteNoticeBanner()
    this.updateKbSelectorLocale()
  }

  /**
   * @param {{ soft?: boolean }} [opts]
   */
  async refresh (opts = {}) {
    const soft = Boolean(opts.soft)
    const wantStatus = opts.status !== false
    const wantStats = opts.stats !== false
    const wantLog = opts.log === true
    const wantActions = opts.actions !== false
    const wantNote = opts.note !== false
    const forceHealth = Boolean(opts.forceHealth)

    if (wantActions) {
      this.renderProAdSection()
      this.renderTrustSection()
      this.renderGovernSection()
      this.renderFormatSection()
    }
    if (wantNote) await this.renderCurrentNote(soft)
    if (wantActions) this.renderActions()
    if (wantStatus) await this.renderStatus({ soft, skipStats: !wantStats, forceHealth, forceHeavy: Boolean(opts.forceHeavy) })
    else if (opts.kb === true) this.refreshKbSelector()
    if (wantLog) this.renderLog()
  }

  /** @param {boolean} force @param {number} gen */
  async probeStatusHealth (force, gen) {
    this.reconnecting = true
    if (this.statusLineEl?.isConnected) {
      this.updateHealthLine(this.healthCache?.data || { ok: false, message: '' })
    }
    const data = await this.checkHealthCached(force)
    if (gen !== this.renderGen) return null
    this.reconnecting = false
    if (data.syncLimit) this.plugin.markSyncLimit(data.syncLimit)
    if (this.statusLineEl?.isConnected) this.updateHealthLine(data)
    this.applyHealthWatch(data)
    if (!data.ok && isLikelyAuthFailure(data.message)) {
      void this.plugin.maybePromptApiKeyExpiry({ authFailure: true })
    }
    return data
  }

  /** @param {{ gen: number, forceHealth?: boolean, skipStats?: boolean }} opts */
  async runStatusHeavyWork (opts) {
    const { gen, forceHealth = false, skipStats = false } = opts
    if (!this.statsWrapEl?.isConnected) return

    const now = Date.now()
    const healthFresh = this.healthCache && now - this.healthCache.at < 30000
    let health = healthFresh && !forceHealth ? this.healthCache.data : null
    const needHealthProbe = !health || forceHealth
    const healthTask = needHealthProbe
      ? this.probeStatusHealth(forceHealth, gen)
      : Promise.resolve(health)
    const statsTask = !skipStats ? this.computeSyncStats() : Promise.resolve(null)

    this.vaultLoading = false
    const [, stats] = await Promise.all([healthTask, statsTask])
    if (gen !== this.renderGen) return
    if (stats) this.renderStatsBlock(this.statsWrapEl, stats)
    this.renderSyncPauseBanner()
    this.renderSyncLimitBanner()
    this.renderApiKeyExpiryBanner()
    this.renderRemoteNoticeBanner()
    if (!needHealthProbe && health) this.applyHealthWatch(health)
  }

  /**
   * @param {{ soft?: boolean, forceHeavy?: boolean }} [opts]
   */
  async renderStatus (opts = {}) {
    const soft = Boolean(opts.soft)
    const skipStats = Boolean(opts.skipStats)
    const forceHealth = Boolean(opts.forceHealth)
    const forceHeavy = Boolean(opts.forceHeavy)
    const gen = ++this.renderGen
    const vaultReady = this.plugin.isVaultReady()
    /** @type {{ ok?: boolean, mock?: boolean, reason?: string, message?: string, syncLimit?: string } | null} */
    let health = null

    if (!soft) {
      this.statusEl.empty()
      this.statsWrapEl = null
      this.pauseBannerEl = null
      this.limitBannerEl = null
      this.apiKeyExpiryBannerEl = null

      const now = Date.now()
      const healthFresh = this.healthCache && now - this.healthCache.at < 30000
      health = healthFresh && !forceHealth ? this.healthCache.data : null

      this.statusLineEl = this.statusEl.createDiv({ cls: 'ima-status-line' })
      if (this.plugin.syncing) {
        this.vaultLoading = false
        this.reconnecting = false
        this.updateHealthLine(health || { ok: true })
      } else if (health) {
        this.vaultLoading = false
        this.reconnecting = false
        this.updateHealthLine(health)
      } else if (!vaultReady && !forceHeavy) {
        const layoutUp = Boolean(this.app.workspace?.layoutReady)
        this.vaultLoading = !layoutUp
        this.reconnecting = layoutUp
        this.updateHealthLine({ ok: false, message: '' })
      } else {
        this.vaultLoading = false
        this.reconnecting = true
        this.updateHealthLine({ ok: false, message: '' })
      }

      this.renderKbSelector()

      const folders = this.plugin.getSyncScopeFolders()
      const folderRow = this.statusEl.createDiv({ cls: 'ima-muted ima-compact ima-folder-row' })
      folderRow.createSpan({
        text: folders.length
          ? `${this.tr('syncFolders')}: ${folders.join(', ')}`
          : this.tr('syncFoldersAll')
      })
      attachTip(folderRow, this.plugin.settings, 'syncFolders', this.tipDeps())

      const statsHead = this.statusEl.createDiv({ cls: 'ima-stats-head' })
      statsHead.createSpan({ cls: 'ima-stats-label', text: this.tr('statPanelLabel') })
      attachTip(statsHead, this.plugin.settings, 'stats', this.tipDeps())
      this.statsWrapEl = this.statusEl.createDiv({ cls: 'ima-stats' })
      this._statEls = null
      if (!skipStats) {
        const cached = this.getDisplayStats(folders)
        if (cached) this.renderStatsBlock(this.statsWrapEl, cached)
        else this.statsWrapEl.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('statsPending') })
      }

      const autoRow = this.statusEl.createDiv({ cls: 'ima-muted ima-compact ima-auto-sync-row' })
      autoRow.createSpan({ cls: 'ima-auto-sync-label', text: this.tr('autoSyncPanelLabel') })
      const autoInput = autoRow.createEl('input', {
        type: 'number',
        cls: 'ima-auto-sync-input',
        attr: { min: '0', step: '1', title: this.tr('autoSyncDesc') }
      })
      autoInput.value = String(this.plugin.settings.autoSyncMinutes)
      autoInput.addEventListener('change', async () => {
        const n = parseInt(autoInput.value, 10)
        this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n >= 0 ? n : 0
        await this.plugin.saveSettings()
        this.plugin.resetAutoSyncTimer()
        await this.refresh({ soft: true, stats: false, note: false, actions: false })
        this.applyStatusLocale()
      })
      attachTip(autoRow, this.plugin.settings, 'autoSyncMinutes', this.tipDeps())
      if (this.plugin.settings.autoSyncMinutes > 0 && this.plugin.settings.autoSyncPaused) {
        autoRow.createSpan({ cls: 'ima-auto-sync-paused', text: this.tr('statusAutoSyncPaused') })
      } else if (this.plugin.settings.autoSyncMinutes === 0 && this.plugin.settings.syncOnSave) {
        autoRow.createSpan({ cls: 'ima-auto-sync-hint', text: this.tr('syncOnSaveActiveHint') })
      }

      const reqRow = this.statusEl.createDiv({ cls: 'ima-request-row' })
      this.requestStatsEl = reqRow.createDiv({ cls: 'ima-muted ima-compact ima-request-stats' })
      attachTip(reqRow, this.plugin.settings, 'todayRequests', this.tipDeps())
      this.renderRequestStats()

      await yieldToUi()
    }

    if (!this.statsWrapEl) return

    if (!vaultReady && !forceHeavy && !this.plugin.syncing) {
      this.scheduleDeferredStatusRefresh()
      return
    }

    await this.runStatusHeavyWork({ gen, forceHealth, skipStats })
  }

  /** @param {{ ok?: boolean, mock?: boolean, reason?: string, message?: string }} health */
  updateHealthLine (health) {
    if (!this.statusLineEl) return
    let dot = this.statusLineEl.querySelector('.ima-dot')
    let msgEl = this.statusLineEl.querySelector('.ima-status-msg')
    if (!dot || !msgEl) {
      this.statusLineEl.empty()
      dot = this.statusLineEl.createSpan({ cls: 'ima-dot' })
      msgEl = this.statusLineEl.createSpan({ cls: 'ima-status-msg' })
    }
    const syncing = this.plugin.syncing
    const reconnecting = this.reconnecting
    let dotClass = 'bad'
    let text = this.formatDisconnectMsg(health.message)
    if (syncing) {
      dotClass = 'ok'
      text = this.tr('statusSyncing')
    } else if (this.vaultLoading) {
      dotClass = 'reconnect'
      text = this.tr('statusVaultLoading')
    } else if (reconnecting) {
      dotClass = 'reconnect'
      text = this.healthCache?.data ? this.tr('reconnecting') : this.tr('statusChecking')
    } else if (health.ok) {
      dotClass = 'ok'
      text = health.mock ? this.mockStatusText(health.reason) : this.tr('statusConnected')
    }
    dot.className = `ima-dot ${dotClass}`
    if (msgEl.getText() !== text) msgEl.setText(text)
  }

  async renderCurrentNote (force = false) {
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      const emptyKey = '|none|'
      if (!force && emptyKey === this._lastNotePath && this.noteEl?.querySelector('.ima-empty')) return
      this._lastNotePath = emptyKey
      this.noteEl.empty()
      const noteHead = this.noteEl.createDiv({ cls: 'ima-note-head' })
      noteHead.createEl('h3', { text: this.tr('currentNote') })
      this.noteEl.createDiv({ cls: 'ima-empty', text: this.tr('openMdNote') })
      return
    }

    const cache = this.app.metadataCache.getFileCache(file)
    const fm = cache?.frontmatter || {}
    const noteKey = `${file.path}|${fm.sync?.ima || 'none'}|${fm.sync?.ima_verify || ''}|${fm.ima_sync_at || ''}`
    if (!force && noteKey === this._lastNotePath && this.noteEl?.querySelector('.ima-title')) return
    this._lastNotePath = noteKey
    this.noteEl.empty()
    const noteHead = this.noteEl.createDiv({ cls: 'ima-note-head' })
    noteHead.createEl('h3', { text: this.tr('currentNote') })

    const inScope = isUnderSyncFolders(file.path, this.plugin.getSyncScopeFolders())

    this.noteEl.createDiv({ cls: 'ima-title', text: fm.title || file.basename })
    this.noteEl.createDiv({ cls: 'ima-muted ima-compact', text: file.path })

    const syncVal = fm.sync?.ima || 'none'
    const badge = this.noteEl.createDiv({ cls: 'ima-compact ima-badge-row' })
    badge.createSpan({ cls: `ima-badge sync-${syncVal}`, text: syncVal })
    const vKey = noteVerifyBadge(fm)
    if (canUseTrust(this.plugin.settings) && vKey !== 'none') {
      const detailKind = vKey === 'failed' ? verifyDetailKind(fm.ima_verify_detail) : 'other'
      const vLabels = {
        verified: 'trustNoteSearchable',
        failed: detailKind === 'auth' ? 'trustNoteAuthFailed' : 'trustNoteNotFound',
        pending: 'trustNotePending',
        skipped: 'skipped'
      }
      badge.createSpan({
        cls: `ima-badge verify-${vKey}`,
        text: this.tr(vLabels[vKey] || 'trustNotePending')
      })
    }
    attachTip(badge, this.plugin.settings, 'noteBadge', this.tipDeps())

    if (!inScope) {
      const scopeRow = this.noteEl.createDiv({ cls: 'ima-warn ima-compact ima-warn-row' })
      scopeRow.createSpan({ text: this.tr('outOfScope') })
      attachTip(scopeRow, this.plugin.settings, 'outOfScope', this.tipDeps())
    }
    if (fm.ima_sync_at) {
      this.noteEl.createDiv({ cls: 'ima-muted ima-compact', text: `${this.tr('lastSync')}: ${fm.ima_sync_at}` })
    }
    if (vKey === 'failed' && fm.ima_verify_detail) {
      this.noteEl.createDiv({
        cls: 'ima-warn ima-compact ima-trust-note-detail',
        text: formatVerifyDetail(this.tr.bind(this), fm.ima_verify_detail)
      })
    }
    if (canUseTrust(this.plugin.settings) && syncVal === 'synced') {
      const vRow = this.noteEl.createDiv({ cls: 'ima-row ima-note-verify-row' })
      vRow.createEl('button', {
        text: this.tr('trustVerifyCurrent'),
        cls: 'ima-btn-secondary ima-btn-compact'
      }).addEventListener('click', () => { void this.plugin.verifyCurrentNote() })
    }
  }

  renderActions () {
    this._syncProgressPathEl = null
    this.actionsEl.empty()
    const actionHead = this.actionsEl.createDiv({ cls: 'ima-action-head' })
    actionHead.createEl('h3', { text: this.tr('actions') })
    const actions = this.actionsEl.createDiv({ cls: 'ima-actions' })
    const syncing = this.plugin.syncing
    const paused = this.plugin.syncControl?.paused

    if (syncing) {
      const progress = actions.createDiv({ cls: 'ima-sync-progress' })
      progress.createSpan({
        cls: 'ima-sync-progress-label',
        text: this.tr('syncingUpload')
      })
      const progressPath = this.plugin.syncProgress || this.tr('syncingWait')
      this._syncProgressPathEl = progress.createDiv({
        cls: 'ima-sync-progress-path',
        text: progressPath,
        attr: progressPath ? { title: progressPath } : undefined
      })

      const ctrl = actions.createDiv({ cls: 'ima-row ima-sync-ctrl' })
      const pauseBtn = ctrl.createEl('button', {
        text: paused ? this.tr('syncResume') : this.tr('syncPause'),
        cls: paused ? 'mod-cta' : ''
      })
      pauseBtn.addEventListener('click', () => { void this.togglePauseSync() })
      if (this.plugin.isBatchSync) {
        ctrl.createEl('button', { text: this.tr('syncStop'), cls: 'ima-btn-stop' })
          .addEventListener('click', () => {
            this.plugin.syncControl.requestStop()
            this.appendLog(this.tr('syncStopped'))
          })
      }
      return
    }

    actionHead.createDiv({ cls: 'ima-sync-hint', text: this.tr('syncModeHint') })

    const tip = this.tipDeps()
    addButtonWithTip(actions, this.plugin.settings, 'syncPush', this.tr('syncPush'), 'ima-btn-primary', () => this.runSync('push', 'pushDone'), tip)

    if (EXPERIMENTAL_UI && this.plugin.settings.showExperimental) {
      this.renderExperimentalActions(actions)
    }

    const row2 = actions.createDiv({ cls: 'ima-row' })
    addButtonWithTip(row2, this.plugin.settings, 'syncCurrent', this.tr('syncCurrent'), 'ima-btn-secondary', () => this.syncCurrentNote(), tip)
    addButtonWithTip(row2, this.plugin.settings, 'syncFolder', this.tr('syncFolder'), 'ima-btn-secondary', () => this.pickFolderToSync(), tip)

    const active = this.app.workspace.getActiveFile()
    if (active?.extension === 'md') {
      addButtonWithTip(actions, this.plugin.settings, 'syncFolder', this.tr('syncCurrentFolder'), 'ima-btn-secondary', () => this.syncCurrentFolder(), tip)
    }

    addButtonWithTip(
      actions,
      this.plugin.settings,
      'autoSyncPaused',
      this.pauseSyncButtonLabel(),
      this.plugin.settings.autoSyncPaused ? 'mod-cta' : 'ima-btn-secondary',
      () => { void this.togglePauseSync() },
      tip
    )

    const fbWrap = actions.createDiv({ cls: 'ima-btn-with-tip' })
    const feedbackBtn = fbWrap.createEl('button', {
      text: this.tr('feedbackBtn'),
      cls: 'ima-btn-secondary ima-btn-feedback',
      attr: { type: 'button' }
    })
    feedbackBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      new FeedbackModal(this.app, this.plugin).open()
    })
    attachTip(fbWrap, this.plugin.settings, 'feedback', tip)
  }

  renderExperimentalActions (actions) {
    const row = actions.createDiv({ cls: 'ima-row ima-exp-row' })
    row.createEl('button', { text: this.lblExp('syncPull'), cls: 'ima-btn-exp' })
      .addEventListener('click', () => this.runSync('pull', 'pullDone'))
    row.createEl('button', { text: this.lblExp('syncAll'), cls: 'ima-btn-exp' })
      .addEventListener('click', () => this.runSync('both', 'syncAllDone'))
    actions.createDiv({ cls: 'ima-exp-note', text: this.tr('pullExperimentalNote') })
  }

  async checkHealthCached (force = false) {
    const now = Date.now()
    if (!force && this.healthCache && now - this.healthCache.at < 30000) {
      return this.healthCache.data
    }
    const client = new ImaApiClient(this.plugin.resolvedSettings())
    const data = await client.checkHealth()
    this.healthCache = { at: now, data }
    return data
  }

  pauseSyncButtonLabel () {
    if (this.plugin.syncing) {
      return this.plugin.syncControl?.paused ? this.tr('syncResume') : this.tr('syncPause')
    }
    return this.plugin.settings.autoSyncPaused ? this.tr('syncResume') : this.tr('syncPause')
  }

  async togglePauseSync () {
    if (this.plugin.syncing && this.plugin.syncControl) {
      if (this.plugin.syncControl.paused) {
        this.plugin.syncControl.resume()
        this.appendLog(this.tr('syncResume'))
        new Notice(this.tr('syncResume'), 2500)
      } else {
        this.plugin.syncControl.pause()
        this.appendLog(this.tr('syncPaused'))
        new Notice(this.tr('syncPaused'), 2500)
      }
      this.renderActions()
      this.renderSyncPauseBanner()
      return
    }

    this.plugin.settings.autoSyncPaused = !this.plugin.settings.autoSyncPaused
    await this.plugin.saveSettings({ actions: true })
    new Notice(
      this.plugin.settings.autoSyncPaused
        ? this.tr('statusAutoSyncPaused')
        : (this.plugin.settings.autoSyncMinutes > 0
            ? this.tr('autoSyncEvery', { n: this.plugin.settings.autoSyncMinutes })
            : this.tr('syncResume')),
      3000
    )
    await this.refresh({ soft: true, stats: false, note: false, actions: true })
    this.applyStatusLocale()
  }

  async syncCurrentNote () {
    if (!this.plugin.getActiveKbId()) {
      new Notice(this.tr('kbNone'))
      return
    }
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(this.tr('openNoteFirst'))
      return
    }
    if (this.plugin.syncing) {
      new Notice(this.tr('syncing'))
      return
    }
    this.plugin.beginSyncRun({ progress: file.path, batch: false })
    try {
      await yieldToUi()
      const engine = this.getEngine()
      const r = await engine.pushNote(file, true)
      new Notice(r.skipped ? this.tr('unchanged') : this.tr('currentPushed'))
      void this.plugin.onSyncTelemetry({
        pushed: r.skipped ? 0 : 1,
        errors: [],
        skipped: r.skipped ? 1 : 0
      })
      this.scheduleStatsRefresh()
      await this.refresh({ soft: true, stats: false, note: true, log: false, actions: false })
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.plugin.markSyncLimit(limit.kind)
      void this.plugin.onSyncTelemetryError(e)
      new Notice(formatSyncError(this.plugin.settings, e), 6000)
    } finally {
      this.plugin.endSyncRun()
    }
  }

  pickFolderToSync () {
    new FolderPickerModal(this.app, this.plugin.settings, (folder) => {
      this.runPushFolder(folder)
    }, { titleKey: 'pickFolderToSync' }).open()
  }

  async syncCurrentFolder () {
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(this.tr('openNoteFirst'))
      return
    }
    await this.runPushFolder(file.parent?.path || '')
  }

  async runPushFolder (folderPath) {
    if (!this.plugin.getActiveKbId()) {
      new Notice(this.tr('kbNone'))
      return
    }
    if (this.plugin.syncing) {
      new Notice(this.tr('syncing'))
      return
    }
    this.plugin.beginSyncRun({
      progress: folderPath || this.tr('vaultRoot'),
      batch: true
    })
    try {
      await yieldToUi()
      const engine = this.getEngine()
      const summary = await engine.pushFolder(folderPath)
      if (summary.total === 0) {
        new Notice(this.tr('folderEmpty'))
      } else {
        const title = summary.stopped ? this.tr('syncStopped') : this.tr('folderPushDone')
        const trustNotice = formatTrustBatchNotice(
          this.plugin.settings,
          summary,
          (k, v) => this.tr(k, v)
        )
        new Notice(trustNotice || (title + this.formatSummary(summary)), trustNotice ? 9000 : 5000)
      }
      if (summary.syncLimit) this.plugin.markSyncLimit(summary.syncLimit)
      this.plugin.storeTrustReport(summary)
      this.plugin.storeFormatReport(summary)
      void this.plugin.onSyncTelemetry(summary)
      this.scheduleStatsRefresh()
      this.renderTrustSection()
      await this.refresh({ soft: true, stats: false, note: true, log: false, actions: false })
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.plugin.markSyncLimit(limit.kind)
      void this.plugin.onSyncTelemetryError(e)
      new Notice(formatSyncError(this.plugin.settings, e), 6000)
    } finally {
      this.plugin.endSyncRun()
    }
  }

  async runSync (direction, okKey) {
    if (!this.plugin.getActiveKbId()) {
      new Notice(this.tr('kbNone'))
      return
    }
    if (this.plugin.syncing) {
      new Notice(this.tr('syncing'))
      return
    }
    this.plugin.beginSyncRun({ progress: this.tr('syncPush'), batch: true })
    try {
      if (canUseTrust(this.plugin.settings) && !this.plugin.settings.trustCapabilities?.checkedAt) {
        await this.plugin.probeTrustCapabilities({ silent: true })
      }
      if (canUseGovern(this.plugin.settings) && this.plugin.settings.govern?.autoAuditBeforeBatch) {
        await this.plugin.auditSyncFolder({ silent: true })
      }
      await yieldToUi()
      const engine = this.getEngine()
      const summary = await engine.runSync(direction)
      this.plugin.storeTrustReport(summary)
      this.plugin.storeFormatReport(summary)
      const trustNotice = formatTrustBatchNotice(
        this.plugin.settings,
        summary,
        (k, v) => this.tr(k, v)
      )
      const title = summary.stopped ? 'syncStopped' : okKey
      const doneMsg = trustNotice || (this.tr(title) + this.formatSummary(summary))
      new Notice(doneMsg, trustNotice ? 9000 : 5000)
      this.appendLog(doneMsg)
      if (summary.syncLimit) this.plugin.markSyncLimit(summary.syncLimit)
      void this.plugin.onSyncTelemetry(summary)
      this.scheduleStatsRefresh()
      this.renderProAdSection()
      this.renderTrustSection()
      this.renderGovernSection()
      this.renderFormatSection()
      await this.refresh({ soft: true, stats: false, note: true, log: false, actions: false })
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.plugin.markSyncLimit(limit.kind)
      void this.plugin.onSyncTelemetryError(e)
      new Notice(formatSyncError(this.plugin.settings, e), 6000)
    } finally {
      this.plugin.endSyncRun()
    }
  }
}

class AuthorAboutModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('./main')} plugin
   * @param {{ scrollToSponsor?: boolean }} [opts]
   */
  constructor (app, plugin, opts = {}) {
    super(app)
    this.plugin = plugin
    this.scrollToSponsor = Boolean(opts.scrollToSponsor)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-about-modal')
    renderAbout(contentEl, this.plugin.settings, this.plugin.manifest.version, {
      app: this.app,
      pluginDir: this.plugin.manifest.dir
    })
    if (this.scrollToSponsor) {
      window.setTimeout(() => {
        const el = contentEl.querySelector('#ima-sponsor, .ima-sponsor')
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el?.classList.add('ima-sponsor-highlight')
        window.setTimeout(() => el?.classList.remove('ima-sponsor-highlight'), 1800)
      }, 80)
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

class KbPickerModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {object} settings
   * @param {Array<{ id: string, label: string }>} libraries
   * @param {(kb: { id: string, label: string }) => void} onPick
   */
  constructor (app, settings, libraries, onPick) {
    super(app)
    this.settings = settings
    this.libraries = libraries
    this.onPick = onPick
  }

  tr (key, vars) {
    return t(this.settings, key, vars)
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: this.tr('pickKbFromIma') })
    contentEl.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('pickKbFromImaHint') })

    const list = contentEl.createDiv({ cls: 'ima-folder-list ima-kb-pick-list' })
    for (const kb of this.libraries) {
      const text = kb.label && kb.label !== kb.id ? `${kb.label}\n${kb.id}` : kb.id
      const btn = list.createEl('button', { text, cls: 'ima-folder-btn ima-kb-pick-btn' })
      btn.addEventListener('click', () => {
        this.onPick(kb)
        this.close()
      })
    }
    if (!this.libraries.length) {
      list.createDiv({ text: this.tr('kbListEmpty') })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

class FolderPickerModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {object} settings
   * @param {(folder: string) => void} onPick
   * @param {{ titleKey?: keyof typeof import('./lib/i18n').STR['zh'] }} [opts]
   */
  constructor (app, settings, onPick, opts = {}) {
    super(app)
    this.settings = settings
    this.onPick = onPick
    this.titleKey = opts.titleKey || 'pickFolder'
  }

  tr (key, vars) {
    return t(this.settings, key, vars)
  }

  /**
   * @param {HTMLElement} parentEl
   * @param {import('obsidian').TFolder} folder
   */
  renderFolderTreeNode (parentEl, folder) {
    const subfolders = folder.children.filter(c => 'children' in c)
    const hasSubfolders = subfolders.length > 0

    const row = parentEl.createDiv({ cls: 'ima-folder-tree-row' })

    if (hasSubfolders) {
      const expandBtn = row.createEl('button', {
        cls: 'ima-folder-expand',
        attr: { type: 'button', 'aria-label': this.tr('folderExpand') }
      })
      setIcon(expandBtn, 'chevron-right')
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const childWrap = row.nextElementSibling
        if (childWrap?.classList.contains('ima-folder-tree-children')) {
          const open = childWrap.classList.toggle('is-open')
          setIcon(expandBtn, open ? 'chevron-down' : 'chevron-right')
          expandBtn.setAttr('aria-label', this.tr(open ? 'folderCollapse' : 'folderExpand'))
          return
        }
        setIcon(expandBtn, 'chevron-down')
        expandBtn.setAttr('aria-label', this.tr('folderCollapse'))
        const wrap = parentEl.createDiv({ cls: 'ima-folder-tree-children is-open' })
        row.insertAdjacentElement('afterend', wrap)
        for (const sub of subfolders) {
          this.renderFolderTreeNode(wrap, sub)
        }
      })
    } else {
      row.createSpan({ cls: 'ima-folder-expand-spacer' })
    }

    const pickBtn = row.createEl('button', {
      cls: 'ima-folder-tree-btn',
      text: folder.name,
      attr: { type: 'button', title: folder.path }
    })
    pickBtn.addEventListener('click', () => {
      this.onPick(folder.path)
      this.close()
    })
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-folder-picker-modal')
    contentEl.createEl('h2', { text: this.tr(this.titleKey) })

    const root = this.app.vault.getRoot()
    const tree = contentEl.createDiv({ cls: 'ima-folder-tree' })

    const rootRow = tree.createDiv({ cls: 'ima-folder-tree-row ima-folder-tree-root' })
    rootRow.createSpan({ cls: 'ima-folder-expand-spacer' })
    rootRow.createEl('button', {
      cls: 'ima-folder-tree-btn',
      text: this.tr('vaultRoot'),
      attr: { type: 'button', title: this.tr('vaultRoot') }
    }).addEventListener('click', () => {
      this.onPick('')
      this.close()
    })

    const topFolders = root.children.filter(c => 'children' in c)
    for (const folder of topFolders) {
      this.renderFolderTreeNode(tree, folder)
    }

    if (!topFolders.length) {
      tree.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('noSubfolders') })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}

class ImaSyncSettingTab extends PluginSettingTab {
  constructor (app, plugin) {
    super(app, plugin)
    this.plugin = plugin
    this.draftKbId = ''
    this.draftKbLabel = ''
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  lbl (key) {
    return label(this.plugin.settings, key)
  }

  lblExp (key) {
    return labelExp(this.plugin.settings, key)
  }

  section (containerEl, key) {
    containerEl.createEl('h3', { cls: 'ima-settings-section', text: this.lbl(key) })
  }

  updateApiKeyExpiryStatusEl (s = this.plugin.settings) {
    if (!this.apiKeyExpiryStatusEl) return
    const raw = String(s.apiKeyExpiresAt || '').trim()
    this.apiKeyExpiryStatusEl.removeClass(
      'ima-api-key-expiry-status--soon',
      'ima-api-key-expiry-status--expired',
      'ima-api-key-expiry-status--invalid',
      'is-hidden'
    )

    const invalid = isInvalidApiKeyExpiresAtInput(raw)
    const state = getApiKeyExpiryState(s)
    if (!invalid && state.level !== 'soon' && state.level !== 'expired') {
      this.apiKeyExpiryStatusEl.addClass('is-hidden')
      this.apiKeyExpiryStatusEl.setText('')
      return
    }

    const key = apiKeyExpiryStatusKey(state, invalid)
    const levelCls = invalid
      ? 'ima-api-key-expiry-status--invalid'
      : state.level === 'soon'
        ? 'ima-api-key-expiry-status--soon'
        : 'ima-api-key-expiry-status--expired'
    this.apiKeyExpiryStatusEl.addClass(levelCls)
    this.apiKeyExpiryStatusEl.setText(this.tr(key, {
      date: state.displayDate,
      days: state.daysLeft ?? 0,
      remind: s.apiKeyExpiryRemindDays ?? 7
    }))
  }

  renderApiKeyExpirySettings (containerEl, s) {
    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('apiKeyExpiresAt'))
        .setDesc(this.tr('apiKeyExpiresAtDesc'))
        .addText(t => {
          t.setPlaceholder('YYYY-MM-DD')
            .setValue(s.apiKeyExpiresAt || '')
          t.inputEl.type = 'date'
          t.onChange(async (v) => {
            s.apiKeyExpiresAt = v.trim()
            clearApiKeyExpiryReminders(s)
            this.updateApiKeyExpiryStatusEl(s)
            this.plugin.scheduleSaveSettings({ apiKeyExpiry: true })
          })
        }),
      s,
      'apiKeyExpiry',
      Notice
    )

    this.apiKeyExpiryStatusEl = containerEl.createDiv({ cls: 'ima-api-key-expiry-status' })
    this.updateApiKeyExpiryStatusEl(s)

    const remindPresets = [7, 14, 30]
    const remindVal = remindPresets.includes(s.apiKeyExpiryRemindDays)
      ? String(s.apiKeyExpiryRemindDays)
      : '7'
    new Setting(containerEl)
      .setName(this.lbl('apiKeyExpiryRemindDays'))
      .setDesc(this.tr('apiKeyExpiryRemindDaysDesc'))
      .addDropdown(d => {
        for (const n of remindPresets) {
          d.addOption(String(n), this.tr('apiKeyExpiryRemindOption', { n }))
        }
        d.setValue(remindVal)
        d.onChange(async (v) => {
          s.apiKeyExpiryRemindDays = parseInt(v, 10) || 7
          this.plugin.scheduleSaveSettings({ apiKeyExpiry: true })
        })
      })
  }

  display () {
    const { containerEl } = this
    const s = this.plugin.settings
    containerEl.empty()
    containerEl.createEl('h2', { text: this.lbl('settingsTitle') })
    containerEl.createDiv({ cls: 'ima-muted ima-settings-hint', text: this.tr('settingsScrollHint') })

    new Setting(containerEl)
      .setName(this.lbl('lang'))
      .setDesc(this.tr('langDesc'))
      .addDropdown(d => d
        .addOption('auto', this.tr('langAuto'))
        .addOption('zh', this.tr('langZh'))
        .addOption('en', this.tr('langEn'))
        .setValue(s.language || 'auto')
        .onChange(async (v) => {
          s.language = v
          await this.plugin.saveData(this.plugin.settings)
          requestAnimationFrame(() => this.display())
          const view = this.plugin.getPanelView()
          if (view) view.refreshLocale()
        }))

    this.section(containerEl, 'sectionConnection')

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('apiUrl'))
        .setDesc(this.tr('apiUrlDesc'))
        .addText(t => t
          .setPlaceholder('https://api.example.com/ima')
          .setValue(s.apiUrl)
          .onChange(async (v) => {
            s.apiUrl = v.trim()
            this.plugin.syncConnectionMode()
            this.plugin.scheduleSaveSettings({ connection: true })
          })),
      s,
      'apiUrl',
      Notice
    )

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('apiKey'))
        .setDesc(this.tr('apiKeyDesc'))
        .addText(t => {
          t.setPlaceholder('sk-…')
            .setValue(s.apiKey)
            .onChange(async (v) => {
              const prev = s.apiKey
              s.apiKey = v.trim()
              if (s.apiKey && s.apiKey !== prev) clearApiKeyExpiryReminders(s)
              this.plugin.syncConnectionMode()
              this.plugin.scheduleSaveSettings({ connection: true })
            })
          t.inputEl.type = 'password'
        }),
      s,
      'apiKey',
      Notice
    )

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('clientId'))
        .setDesc(this.tr('clientIdDesc'))
        .addText(t => t
          .setPlaceholder('')
          .setValue(s.clientId)
          .onChange(async (v) => {
            const prev = s.clientId
            s.clientId = v.trim()
            if (s.clientId && s.clientId !== prev) clearApiKeyExpiryReminders(s)
            this.plugin.scheduleSaveSettings({ connection: true })
          })),
      s,
      'clientId',
      Notice
    )

    this.renderApiKeyExpirySettings(containerEl, s)

    this.section(containerEl, 'sectionKb')
    this.renderKbList(containerEl)

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('fetchKbFromIma'))
        .setDesc(this.tr('fetchKbFromImaDesc'))
        .addButton(b => b
          .setButtonText(this.tr('fetchKbFromIma'))
          .onClick(() => { void this.fetchKbListFromIma() }))
        .addButton(b => b
          .setIcon('refresh-cw')
          .setTooltip(this.tr('fetchKbRefresh'))
          .onClick(() => { void this.fetchKbListFromIma() })),
      s,
      'fetchKb',
      Notice
    )

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('kbIdInput'))
        .setDesc(this.tr('kbLibrariesDesc'))
        .addText(t => t
          .setPlaceholder('')
          .setValue(this.draftKbId)
          .onChange((v) => { this.draftKbId = v.trim() }))
        .addButton(b => b
          .setButtonText(this.tr('addKb'))
          .onClick(async () => {
            const id = (this.draftKbId || '').trim()
            if (!id) {
              new Notice(this.tr('kbIdRequired'))
              return
            }
            const list = s.kbLibraries || []
            if (list.some(k => k.id === id)) {
              new Notice(this.tr('kbExists'))
              return
            }
            const label = (this.draftKbLabel || id).trim() || id
            list.push({ id, label })
            s.kbLibraries = list
            if (!s.activeKbId) s.activeKbId = id
            this.draftKbId = ''
            this.draftKbLabel = ''
            await this.plugin.saveSettings()
            this.display()
          })),
      s,
      'kbSetting',
      Notice
    )

    new Setting(containerEl)
      .setName(this.lbl('kbLabelInput'))
      .addText(t => t
        .setPlaceholder(this.tr('kbLabelPlaceholder'))
        .setValue(this.draftKbLabel)
        .onChange((v) => { this.draftKbLabel = v.trim() }))

    this.section(containerEl, 'sectionSync')

    this.renderFolderList(containerEl)

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('syncFoldersSetting'))
        .setDesc(
          isProActive(s) || syncDirectoriesMax(s) === 0
            ? this.tr('syncFoldersDesc')
            : this.tr('syncFoldersDescFree', { max: syncDirectoriesMax(s) })
        )
        .addButton(b => b
          .setButtonText(this.tr('addFolder'))
          .onClick(() => {
            new FolderPickerModal(this.app, s, async (folder) => {
              if (await this.plugin.addSyncFolder(folder)) {
                this.display()
              }
            }).open()
          }))
        .addButton(b => b
          .setButtonText(this.tr('addCurrentFolder'))
          .onClick(async () => {
            const file = this.app.workspace.getActiveFile()
            if (!file) {
              new Notice(this.tr('openNoteFirst'))
              return
            }
            const dir = file.parent?.path || ''
            if (await this.plugin.addSyncFolder(dir)) {
              this.display()
            }
          })),
      s,
      'syncFoldersSetting',
      Notice
    )

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('autoSyncMin'))
        .setDesc(this.tr('autoSyncDesc'))
        .addText(t => t
          .setPlaceholder('0')
          .setValue(String(s.autoSyncMinutes))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            s.autoSyncMinutes = Number.isFinite(n) && n >= 0 ? n : 0
            await this.plugin.saveSettings()
            this.plugin.resetAutoSyncTimer()
          })),
      s,
      'autoSyncMin',
      Notice
    )

    if (s.autoSyncMinutes > 0) {
      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('autoSyncPaused'))
          .setDesc(this.tr('autoSyncPausedDesc'))
          .addToggle(t => t
            .setValue(s.autoSyncPaused)
            .onChange(async (v) => {
              s.autoSyncPaused = v
              await this.plugin.saveSettings()
            })),
        s,
        'autoSyncPaused',
        Notice
      )
    }

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('syncOnSave'))
        .setDesc(this.tr('syncOnSaveDesc'))
        .addToggle(t => t
          .setValue(s.syncOnSave)
          .onChange(async (v) => {
            s.syncOnSave = v
            await this.plugin.saveSettings()
          })),
      s,
      'syncOnSave',
      Notice
    )

    applySettingTip(
      new Setting(containerEl)
        .setName(this.lbl('conflict'))
        .addDropdown(d => d
          .addOption('ask', this.tr('conflictAsk'))
          .addOption('local', this.tr('conflictLocal'))
          .addOption('remote', this.tr('conflictRemote'))
          .setValue(s.conflictStrategy)
          .onChange(async (v) => {
            s.conflictStrategy = v
            await this.plugin.saveSettings()
          })),
      s,
      'conflict',
      Notice
    )

    if (EXPERIMENTAL_UI) {
      containerEl.createDiv({ cls: 'ima-exp-note ima-pull-off-note' })
        .setText(this.tr('experimentalPullOffNote'))
    }

    this.section(containerEl, 'sectionPro')
    containerEl.createDiv({
      cls: 'ima-muted ima-compact',
      text: isProActive(s) ? this.tr('proActivated') : this.tr('proInactive')
    })

    new Setting(containerEl)
      .setName(this.lbl('proLicenseKey'))
      .setDesc(this.tr('proLicenseKeyDesc'))
      .addText(t => t
        .setPlaceholder('IMAPRO-…')
        .setValue(s.proLicenseKey || '')
        .onChange(async (v) => {
          s.proLicenseKey = v.trim()
          s.proActivated = verifyProLicenseKey(s.proLicenseKey)
          await this.plugin.saveSettings()
          const view = this.plugin.getPanelView()
          if (view) {
            view.renderProAdSection()
            view.renderTrustSection()
            view.renderGovernSection()
      view.renderFormatSection()
            view.renderFormatSection()
          }
        }))

    if (cloudLicenseEnabled(s)) {
      new Setting(containerEl)
        .setName(this.lbl('proCloudActivate'))
        .setDesc(this.tr('proCloudActivateDesc'))
        .addButton(btn => btn
          .setButtonText(this.tr('proCloudActivate'))
          .setCta()
          .onClick(() => { void this.plugin.syncProLicenseCloud() }))
      if (s.entitlementsCachedAt) {
        containerEl.createDiv({
          cls: 'ima-muted ima-compact',
          text: this.tr('proCloudCachedAt', { at: s.entitlementsCachedAt.slice(0, 19).replace('T', ' ') })
        })
      }
    } else {
      containerEl.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('proCloudDisabled')
      })
    }

    if (isProActive(s)) {
      if (!s.trust || typeof s.trust !== 'object') s.trust = { ...DEFAULT_SETTINGS.trust }

      new Setting(containerEl)
        .setName(this.lbl('trustVerifyAfterPush'))
        .addToggle(t => t
          .setValue(s.trust.verifyAfterPush !== false)
          .onChange(async (v) => {
            s.trust.verifyAfterPush = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('trustDedupBeforePush'))
        .addToggle(t => t
          .setValue(s.trust.dedupBeforePush !== false)
          .onChange(async (v) => {
            s.trust.dedupBeforePush = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('trustVerifyDelayMs'))
        .setDesc(this.tr('trustVerifyDelayMs'))
        .addText(t => t
          .setValue(String(s.trust.verifyDelayMs ?? 2000))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            s.trust.verifyDelayMs = Number.isFinite(n) && n >= 0 ? n : 2000
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('trustVerifyRetries'))
        .addText(t => t
          .setValue(String(s.trust.verifyRetries ?? 2))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            s.trust.verifyRetries = Number.isFinite(n) && n >= 1 ? n : 2
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('trustDedupAmbiguous'))
        .addDropdown(d => d
          .addOption('warn-push', this.tr('trustDedupAmbiguousPush'))
          .addOption('skip', this.tr('trustDedupAmbiguousSkip'))
          .setValue(s.trust.dedupAmbiguous || 'warn-push')
          .onChange(async (v) => {
            s.trust.dedupAmbiguous = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('trustReportAutoSave'))
        .setDesc(this.tr('trustReportAutoSaveDesc'))
        .addToggle(t => t
          .setValue(s.trust.reportAutoSave === true)
          .onChange(async (v) => {
            s.trust.reportAutoSave = v
            await this.plugin.saveSettings()
          }))

      if (!s.govern || typeof s.govern !== 'object') s.govern = { ...DEFAULT_SETTINGS.govern }

      new Setting(containerEl)
        .setName(this.lbl('governAutoAuditBeforeBatch'))
        .setDesc(this.tr('governAutoAuditBeforeBatchDesc'))
        .addToggle(t => t
          .setValue(s.govern.autoAuditBeforeBatch === true)
          .onChange(async (v) => {
            s.govern.autoAuditBeforeBatch = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('governMaxBodyChars'))
        .setDesc(this.tr('governMaxBodyCharsDesc'))
        .addText(t => t
          .setValue(String(s.govern.maxBodyChars ?? 12000))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            s.govern.maxBodyChars = Number.isFinite(n) && n >= 1000 ? n : 12000
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('governMinTitleChars'))
        .setDesc(this.tr('governMinTitleCharsDesc'))
        .addText(t => t
          .setValue(String(s.govern.minTitleChars ?? 4))
          .onChange(async (v) => {
            const n = parseInt(v, 10)
            s.govern.minTitleChars = Number.isFinite(n) && n >= 2 ? n : 4
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('governSensitivePatterns'))
        .setDesc(this.tr('governSensitivePatternsDesc'))
        .addTextArea(t => t
          .setValue((s.govern.sensitivePatterns || []).join('\n'))
          .onChange(async (v) => {
            s.govern.sensitivePatterns = String(v || '')
              .split(/\r?\n/)
              .map(line => line.trim())
              .filter(Boolean)
            await this.plugin.saveSettings()
          }))

      if (!s.format || typeof s.format !== 'object') s.format = { ...DEFAULT_SETTINGS.format }

      new Setting(containerEl)
        .setName(this.lbl('formatEnabled'))
        .setDesc(this.tr('formatEnabledDesc'))
        .addToggle(t => t
          .setValue(s.format.enabled !== false)
          .onChange(async (v) => {
            s.format.enabled = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('formatOnPush'))
        .addToggle(t => t
          .setValue(s.format.onPush !== false)
          .onChange(async (v) => {
            s.format.onPush = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('formatPreset'))
        .addDropdown(d => d
          .addOption('core', this.tr('formatPresetCore'))
          .addOption('standard', this.tr('formatPresetStandard'))
          .setValue(s.format.preset || 'core')
          .onChange(async (v) => {
            s.format.preset = v
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('formatHashSource'))
        .addDropdown(d => d
          .addOption('local', this.tr('formatHashLocal'))
          .addOption('formatted', this.tr('formatHashFormatted'))
          .setValue(s.format.hashSource || 'local')
          .onChange(async (v) => {
            s.format.hashSource = v
            await this.plugin.saveSettings()
          }))

      if (canUseFormatFull(s)) {
        new Setting(containerEl)
          .setName(this.lbl('formatWriteBackSetting'))
          .setDesc(this.tr('formatWriteBackSettingDesc'))
          .addDropdown(d => d
            .addOption('off', 'off')
            .addOption('confirm', 'confirm')
            .setValue(s.format.writeBack || 'off')
            .onChange(async (v) => {
              s.format.writeBack = v === 'confirm' ? 'confirm' : 'off'
              await this.plugin.saveSettings()
            }))
      }

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('trustCapProbe'))
          .setDesc(this.tr('trustTestApiDesc'))
          .addButton(b => b
            .setButtonText(this.tr('trustCapProbe'))
            .onClick(() => { void this.plugin.probeTrustCapabilities() })),
        s,
        'trustCap',
        Notice
      )
    }

    new Setting(containerEl)
      .setName(this.lbl('showAdvanced'))
      .addToggle(t => t
        .setValue(s.showAdvanced)
        .onChange(async (v) => {
          s.showAdvanced = v
          await this.plugin.saveSettings()
          this.display()
        }))

    if (s.showAdvanced) {
      this.section(containerEl, 'sectionAdvanced')

      if (EXPERIMENTAL_UI) {
        applySettingTip(
          new Setting(containerEl)
            .setName(this.lblExp('showExperimental'))
            .setDesc(this.tr('showExperimentalDesc'))
            .addToggle(t => t
              .setValue(s.showExperimental)
              .onChange(async (v) => {
                s.showExperimental = v
                if (!v) s.pullNewFromIma = false
                await this.plugin.saveSettings()
                if (v) new Notice(this.tr('pullExperimentalNote'), 6000)
                this.display()
                const view = this.plugin.getPanelView()
                if (view) view.renderActions()
              })),
          s,
          'showExperimental',
          Notice
        )
      }

      new Setting(containerEl)
        .setName(this.lbl('ingestUrl'))
        .setDesc(this.tr('ingestUrlDesc', { api: s.apiUrl || '…' }))
        .addText(t => t
          .setValue(s.ingestUrl)
          .onChange(async (v) => {
            s.ingestUrl = v.trim()
            this.plugin.syncConnectionMode()
            this.plugin.scheduleSaveSettings({ connection: true })
          }))

      if (!this.plugin.isConfigured(s)) {
        applySettingTip(
          new Setting(containerEl)
            .setName(this.lbl('mockMode'))
            .setDesc(this.tr('mockModeDesc'))
            .addToggle(t => t
              .setValue(s.mockMode)
              .onChange(async (v) => {
                s.mockMode = v
                await this.plugin.saveSettings({ connection: true })
              })),
          s,
          'mockMode',
          Notice
        )
      }

      if (EXPERIMENTAL_UI && s.showExperimental) {
        new Setting(containerEl)
          .setName(this.lblExp('pullNew'))
          .setDesc(this.tr('pullNewDesc'))
          .addToggle(t => t
            .setValue(s.pullNewFromIma)
            .onChange(async (v) => {
              s.pullNewFromIma = v
              await this.plugin.saveSettings()
            }))
      }

      new Setting(containerEl)
        .setName(this.lbl('openOnStart'))
        .addToggle(t => t
          .setValue(s.openPanelOnStart)
          .onChange(async (v) => {
            s.openPanelOnStart = v
            await this.plugin.saveSettings()
          }))

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('uploadGapMs'))
          .setDesc(this.tr('uploadGapMsDesc'))
          .addText(t => t
            .setValue(String(s.uploadGapMs ?? 500))
            .onChange(async (v) => {
              const n = Math.max(200, parseInt(v, 10) || 500)
              s.uploadGapMs = n
              await this.plugin.saveSettings()
            })),
        s,
        'uploadGapMs',
        Notice
      )

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('batchSize'))
          .setDesc(this.tr('batchSizeDesc'))
          .addText(t => t
            .setValue(String(s.batchSize ?? 80))
            .onChange(async (v) => {
              s.batchSize = Math.max(1, parseInt(v, 10) || 80)
              await this.plugin.saveSettings()
            })),
        s,
        'batchSize',
        Notice
      )

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('batchPauseSeconds'))
          .setDesc(this.tr('batchPauseSecondsDesc'))
          .addText(t => t
            .setValue(String(s.batchPauseSeconds ?? 30))
            .onChange(async (v) => {
              s.batchPauseSeconds = Math.max(0, parseInt(v, 10) || 0)
              await this.plugin.saveSettings()
            })),
        s,
        'batchPauseSeconds',
        Notice
      )

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('rateLimitBackoffSec'))
          .setDesc(this.tr('rateLimitBackoffSecDesc'))
          .addText(t => t
            .setValue(String(s.rateLimitBackoffSec ?? '60,120,300'))
            .onChange(async (v) => {
              s.rateLimitBackoffSec = v.trim() || '60,120,300'
              await this.plugin.saveSettings()
            })),
        s,
        'rateLimitBackoffSec',
        Notice
      )

      new Setting(containerEl)
        .setName(this.lbl('networkRetryCount'))
        .setDesc(this.tr('networkRetryCountDesc'))
        .addText(t => t
          .setValue(String(s.networkRetryCount ?? 3))
          .onChange(async (v) => {
            s.networkRetryCount = Math.max(0, parseInt(v, 10) || 0)
            await this.plugin.saveSettings()
          }))

      new Setting(containerEl)
        .setName(this.lbl('networkRetryDelayMs'))
        .setDesc(this.tr('networkRetryDelayMsDesc'))
        .addText(t => t
          .setValue(String(s.networkRetryDelayMs ?? 1500))
          .onChange(async (v) => {
            s.networkRetryDelayMs = Math.max(200, parseInt(v, 10) || 1500)
            await this.plugin.saveSettings()
          }))

      applySettingTip(
        new Setting(containerEl)
          .setName(this.lbl('autoReconnectSeconds'))
          .setDesc(this.tr('autoReconnectSecondsDesc'))
          .addText(t => t
            .setValue(String(s.autoReconnectSeconds ?? 60))
            .onChange(async (v) => {
              s.autoReconnectSeconds = Math.max(0, parseInt(v, 10) || 0)
              await this.plugin.saveSettings()
              this.plugin.resetConnectionWatch()
            })),
        s,
        'autoReconnectSeconds',
        Notice
      )
    }

    renderAbout(
      containerEl.createDiv({ cls: 'ima-settings-about ima-settings-about-foot' }),
      s,
      this.plugin.manifest.version,
      {
        showChangelog: true,
        changelogLimit: 3,
        app: this.app,
        pluginDir: this.plugin.manifest.dir
      }
    )
  }

  async fetchKbListFromIma () {
    const s = this.plugin.settings
    if (!(s.apiKey || '').trim() || !(s.clientId || '').trim()) {
      new Notice(this.tr('kbListNeedAuth'), 5000)
      return
    }
    const client = new ImaApiClient({
      apiUrl: s.apiUrl,
      apiKey: s.apiKey,
      clientId: s.clientId,
      mock: false
    })
    try {
      const libs = await client.listKnowledgeBases({ limit: 20 })
      if (!libs.length) {
        new Notice(this.tr('kbListEmpty'), 4000)
        return
      }
      new KbPickerModal(this.app, s, libs, async (kb) => {
        const list = s.kbLibraries || []
        if (!list.some(k => k.id === kb.id)) {
          list.push({ id: kb.id, label: kb.label || kb.id })
          s.kbLibraries = list
        }
        s.activeKbId = kb.id
        await this.plugin.saveSettings({ kb: true })
        this.display()
        new Notice(this.tr('kbAdded', { name: kb.label || kb.id }), 3000)
      }).open()
    } catch (e) {
      new Notice(formatSyncError(s, e), 6000)
    }
  }

  renderKbList (containerEl) {
    const libs = this.plugin.settings.kbLibraries || []
    if (!libs.length) return

    const wrap = containerEl.createDiv({ cls: 'ima-kb-chips' })
    for (const kb of libs) {
      const chip = wrap.createDiv({ cls: 'ima-kb-chip' })
      const text = kb.label && kb.label !== kb.id ? `${kb.label} · ${kb.id}` : kb.id
      chip.createSpan({ text })
      if (kb.id === this.plugin.settings.activeKbId) {
        chip.createSpan({ cls: 'ima-kb-active', text: '✓' })
      }
      const btn = chip.createEl('button', { text: '×', cls: 'ima-chip-remove' })
      btn.addEventListener('click', async () => {
        const next = libs.filter(k => k.id !== kb.id)
        this.plugin.settings.kbLibraries = next
        if (this.plugin.settings.activeKbId === kb.id) {
          this.plugin.settings.activeKbId = ''
        }
        await this.plugin.saveSettings({ kb: true })
        this.display()
      })
    }
  }

  renderFolderList (containerEl) {
    const folders = this.plugin.settings.syncFolders || []
    if (!folders.length) return

    const effective = this.plugin.getSyncScopeFolders()
    const wrap = containerEl.createDiv({ cls: 'ima-folder-chips' })
    for (const folder of folders) {
      const active = effective.includes(folder)
      const chip = wrap.createDiv({ cls: `ima-folder-chip${active ? '' : ' ima-folder-chip-inactive'}` })
      chip.createSpan({ text: folder || this.tr('vaultRoot') })
      const syncBtn = chip.createEl('button', {
        text: '↗',
        cls: 'ima-chip-sync',
        attr: { 'aria-label': this.tr('syncFolder') }
      })
      syncBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await this.plugin.quickPushFolder(folder)
      })
      const btn = chip.createEl('button', { text: '×', cls: 'ima-chip-remove' })
      btn.addEventListener('click', async () => {
        this.plugin.settings.syncFolders = folders.filter(f => f !== folder)
        await this.plugin.saveSettings({ statusFolders: true })
        this.display()
      })
    }
  }
}

module.exports = class ImaSyncPlugin extends Plugin {
  async onload () {
    try {
      await this._onloadImpl()
    } catch (err) {
      console.error('[ima-sync] onload failed', err)
      new Notice(`IMA Sync 加载失败：${err?.message || err}`, 8000)
    }
  }

  async _onloadImpl () {
    this.syncing = false
    this.isBatchSync = false
    this.syncProgress = ''
    this.syncLimitUntil = 0
    this.syncLimitKind = ''
    this.syncControl = new SyncControl()
    this.saveDebounceTimers = new Map()
    this._saveSettingsTimer = 0
    this._pendingSaveOpts = {}
    this._statsPersistTimer = 0

    try {
      await this.loadSettings()
    } catch (err) {
      console.error('[ima-sync] loadSettings failed', err)
      this.settings = Object.assign({}, DEFAULT_SETTINGS)
      new Notice(`IMA Sync 设置读取失败，已恢复默认：${err?.message || err}`, 6000)
    }
    void this.bootstrapProLicenseCloud().catch(() => {})

    // 尽早注册视图，避免侧栏残留标签显示「插件不再活动」
    this.registerView(VIEW_TYPE, (leaf) => new ImaSyncPanelView(leaf, this))

    this.vaultReadyGate = createVaultReadyGate(this.app)
    this.normalizeTelemetrySettings()
    this.maybePromptTelemetryOptIn()
    void maybeReportInstall(this).catch(() => {})
    void maybeReportHeartbeat(this).catch(() => {})
    void this.refreshRemoteNotices().catch(() => {})

    this.vaultReadyGate.bind(this)

    this.addRibbonIcon('refresh-cw', t(this.settings, 'ribbon'), () => this.activateView())

    this.addCommand({
      id: 'open-ima-sync',
      name: t(this.settings, 'cmdOpen'),
      callback: () => this.activateView()
    })
    this.addCommand({
      id: 'ima-sync-push',
      name: t(this.settings, 'cmdPush'),
      callback: () => this.quickSync('push')
    })
    if (EXPERIMENTAL_UI && this.settings.showExperimental) {
      this.addCommand({
        id: 'ima-sync-pull',
        name: t(this.settings, 'cmdPull'),
        callback: () => this.quickSync('pull')
      })
      this.addCommand({
        id: 'ima-sync-all',
        name: t(this.settings, 'cmdAll'),
        callback: () => this.quickSync('both')
      })
    }
    this.addCommand({
      id: 'ima-sync-pause',
      name: t(this.settings, 'cmdPause'),
      callback: () => {
        const view = this.getPanelView()
        if (view) void view.togglePauseSync()
        else if (this.syncing && this.syncControl) {
          if (this.syncControl.paused) this.syncControl.resume()
          else this.syncControl.pause()
          new Notice(t(this.settings, this.syncControl.paused ? 'syncPaused' : 'syncResume'))
        } else {
          this.settings.autoSyncPaused = !this.settings.autoSyncPaused
          void this.saveSettings().then(() => {
            new Notice(t(this.settings, this.settings.autoSyncPaused ? 'statusAutoSyncPaused' : 'syncResume'))
          })
        }
      }
    })
    this.addCommand({
      id: 'ima-sync-stop',
      name: t(this.settings, 'cmdStop'),
      callback: () => {
        if (this.syncing && this.syncControl) {
          this.syncControl.requestStop()
          new Notice(t(this.settings, 'syncStopped'))
        }
      }
    })
    this.addCommand({
      id: 'ima-sync-current',
      name: t(this.settings, 'cmdCurrent'),
      callback: () => {
        const view = this.getPanelView()
        if (view) view.syncCurrentNote()
        else this.quickPushCurrent()
      }
    })
    this.addCommand({
      id: 'ima-sync-folder',
      name: t(this.settings, 'cmdFolder'),
      callback: () => {
        const view = this.getPanelView()
        if (view) view.pickFolderToSync()
        else this.quickPushFolderPrompt()
      }
    })
    this.addCommand({
      id: 'ima-sync-current-folder',
      name: t(this.settings, 'cmdCurrentFolder'),
      callback: () => {
        const file = this.app.workspace.getActiveFile()
        if (!file || file.extension !== 'md') {
          new Notice(t(this.settings, 'openNoteFirst'))
          return
        }
        const folder = file.parent?.path || ''
        const view = this.getPanelView()
        if (view) view.runPushFolder(folder)
        else this.quickPushFolder(folder)
      }
    })
    this.addCommand({
      id: 'ima-sync-trust-export',
      name: t(this.settings, 'cmdTrustExport'),
      callback: () => { void this.exportLastTrustReport() }
    })
    this.addCommand({
      id: 'ima-sync-trust-retry',
      name: t(this.settings, 'cmdTrustRetry'),
      callback: () => { void this.retryFailedQueue() }
    })
    this.addCommand({
      id: 'ima-sync-trust-verify',
      name: t(this.settings, 'cmdTrustVerify'),
      callback: () => { void this.verifyCurrentNote() }
    })
    this.addCommand({
      id: 'ima-sync-govern-audit',
      name: t(this.settings, 'cmdGovernAudit'),
      callback: () => { void this.auditSyncFolder() }
    })
    this.addCommand({
      id: 'ima-sync-govern-audit-current',
      name: t(this.settings, 'cmdGovernAuditCurrent'),
      callback: () => { void this.auditCurrentNote() }
    })
    this.addCommand({
      id: 'ima-sync-govern-export',
      name: t(this.settings, 'cmdGovernExport'),
      callback: () => { void this.exportLastGovernReport() }
    })
    this.addCommand({
      id: 'ima-sync-format-preview',
      name: t(this.settings, 'cmdFormatPreview'),
      callback: () => { void this.previewFormatCurrentNote() }
    })
    this.addCommand({
      id: 'ima-sync-format-export',
      name: t(this.settings, 'cmdFormatExport'),
      callback: () => { void this.exportLastFormatReport() }
    })

    this.addSettingTab(this._settingTab = new ImaSyncSettingTab(this.app, this))

    this.registerEvent(
      this.app.vault.on('modify', (file) => this.onVaultModify(file))
    )

    this.resetAutoSyncTimer()

    if (this.settings.openPanelOnStart) {
      this.app.workspace.onLayoutReady(() => this.activateView())
    }

    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => { void this.maybePromptApiKeyExpiry() }, 2000)
    })
  }

  onunload () {
    if (this._saveSettingsTimer) window.clearTimeout(this._saveSettingsTimer)
    if (this._statsPersistTimer) window.clearTimeout(this._statsPersistTimer)
    const view = this.getPanelView()
    if (view?._statsRefreshTimer) window.clearTimeout(view._statsRefreshTimer)
    if (view?._deferredStatusTimer) window.clearTimeout(view._deferredStatusTimer)
    this.clearAutoSyncTimer()
    this.clearConnectionWatch()
    this.app.workspace.detachLeavesOfType(VIEW_TYPE)
  }

  isConfigured (s = this.settings) {
    return Boolean(s.apiKey?.trim() && (s.ingestUrl?.trim() || s.apiUrl?.trim()))
  }

  syncConnectionMode () {
    const s = this.settings
    if (this.isConfigured(s)) {
      s.mockMode = false
    } else {
      s.mockMode = true
    }
  }

  getActiveKbId () {
    return (this.settings.activeKbId || '').trim()
  }

  isVaultReady () {
    return this.vaultReadyGate.isReady()
  }

  whenVaultReady (opts = {}) {
    return this.vaultReadyGate.whenReady(opts)
  }

  resolvedSettings () {
    return { ...this.settings, kbId: this.getActiveKbId() }
  }

  engineSettings () {
    const activeKb = this.getActiveKbId()
    const lib = (this.settings.kbLibraries || []).find(k => k.id === activeKb)
    return {
      ...this.resolvedSettings(),
      kbLabel: lib?.label || activeKb || '',
      showExperimental: EXPERIMENTAL_UI && this.settings.showExperimental === true,
      pullNewFromIma: EXPERIMENTAL_UI && this.settings.pullNewFromIma === true,
      onRequest: (n) => this.bumpRequestCount(n)
    }
  }

  /**
   * @param {(msg: string) => void} [onLog]
   * @param {(path: string) => void} [onProgress]
   */
  createEngine (onLog, onProgress) {
    return new ImaSyncEngine(
      this.app,
      this.engineSettings(),
      onLog || (() => {}),
      this.syncControl,
      onProgress || (() => {}),
      (entry) => this.handleFailedEntry(entry)
    )
  }

  /** @param {{ path: string, error?: string, clear?: boolean }} entry */
  handleFailedEntry (entry) {
    if (!entry?.path) return
    if (!Array.isArray(this.settings.failedQueue)) {
      this.settings.failedQueue = []
    }
    if (entry.clear) {
      this.settings.failedQueue = removeFailedEntry(this.settings.failedQueue, entry.path)
    } else if (entry.error) {
      this.settings.failedQueue = upsertFailedEntry(this.settings.failedQueue, entry.path, entry.error)
    }
    void this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderTrustSection()
  }

  /** @param {object} summary */
  storeTrustReport (summary) {
    if (!summary?.trustReport) return
    this.settings.lastTrustReport = summary.trustReport
    void this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderTrustSection()
      view.invalidateStatsCache()
    }
    if (this.settings.trust?.reportAutoSave) {
      void this.exportLastTrustReport({ silent: true })
    }
  }

  /** @param {object} summary */
  storeFormatReport (summary) {
    if (!summary?.formatReport) return
    this.settings.lastFormatReport = summary.formatReport
    void this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderFormatSection()
  }

  /**
   * @param {import('obsidian').TFile} file
   * @param {string} formattedBody
   */
  async writeBackFormattedNote (file, formattedBody) {
    if (!canUseFormatFull(this.settings)) {
      new Notice(t(this.settings, 'formatWriteBackProOnly'))
      return false
    }
    if (this.settings.format?.writeBack !== 'confirm') {
      new Notice(t(this.settings, 'formatWriteBackProOnly'))
      return false
    }
    const raw = await this.app.vault.read(file)
    const next = rebuildNoteRaw(raw, formattedBody)
    await this.app.vault.modify(file, next)
    new Notice(t(this.settings, 'formatWriteBackDone'))
    return true
  }

  /**
   * @param {{ pushed?: boolean, verify?: string, file?: string, doc_id?: string }} pushResult
   */
  storeMiniTrustReport (pushResult) {
    if (!canUseTrust(this.settings) || !pushResult?.pushed) return
    const verified = pushResult.verify === 'verified' ? 1 : 0
    const verify_failed = pushResult.verify === 'failed' ? 1 : 0
    const verify_pending = pushResult.verify === 'pending' ? 1 : 0
    const now = new Date().toISOString()
    this.settings.lastTrustReport = {
      id: `mini-${Date.now()}`,
      startedAt: now,
      finishedAt: now,
      kbId: this.getActiveKbId(),
      kbLabel: '',
      direction: 'push-one',
      counts: {
        total: 1,
        pushed: 1,
        skipped: 0,
        deduped: 0,
        dedup_ambiguous: 0,
        failed: 0,
        verified,
        verify_failed,
        verify_pending
      },
      items: [{
        path: pushResult.file || '',
        action: 'pushed',
        doc_id: pushResult.doc_id || '',
        verify: pushResult.verify || ''
      }]
    }
    void this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderTrustSection()
      void view.renderCurrentNote(true)
    }
  }

  async exportLastTrustReport (opts = {}) {
    const report = this.settings.lastTrustReport
    if (!report) {
      if (!opts.silent) new Notice(t(this.settings, 'trustReportNone'))
      return false
    }
    const md = formatTrustReportMarkdown(report, (k, vars) => t(this.settings, k, vars))
    const stamp = (report.finishedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `_ima-sync/reports/ima-sync-report-${stamp}.md`
    try {
      const dir = '_ima-sync/reports'
      if (!this.app.vault.getAbstractFileByPath('_ima-sync')) {
        await this.app.vault.createFolder('_ima-sync')
      }
      if (!this.app.vault.getAbstractFileByPath(dir)) {
        await this.app.vault.createFolder(dir)
      }
      const existing = this.app.vault.getAbstractFileByPath(filePath)
      if (existing) await this.app.vault.modify(existing, md)
      else await this.app.vault.create(filePath, md)
      if (!opts.silent) new Notice(`${t(this.settings, 'trustReportExport')}: ${filePath}`)
      return true
    } catch (e) {
      if (!opts.silent) new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  async probeTrustCapabilities (opts = {}) {
    if (!canUseTrust(this.settings)) {
      if (!opts.silent) new Notice(t(this.settings, 'proInactive'))
      return null
    }
    if (!this.isConfigured()) {
      if (!opts.silent) new Notice(t(this.settings, 'statusNotConfigured'))
      return null
    }
    const client = new ImaApiClient(this.engineSettings())
    const caps = await probeTrustCapabilities(client, this.settings)
    this.settings.trustCapabilities = caps
    this.settings.trustApiStatus = {
      ok: caps.readyLevel !== 'blocked',
      checkedAt: caps.checkedAt,
      message: caps.errors.base || caps.errors.dedup || caps.errors.verify || ''
    }
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderTrustSection()
    if (!opts.silent) {
      const msg = caps.readyLevel === 'full'
        ? t(this.settings, 'trustTestApiOk')
        : formatReadyLevelHint((k, v) => t(this.settings, k, v), caps)
      new Notice(msg, caps.readyLevel === 'full' ? 3000 : 8000)
    }
    return caps
  }

  /** @deprecated alias */
  async testTrustApi () {
    return this.probeTrustCapabilities()
  }

  /**
   * @param {{ silent?: boolean }} [opts]
   */
  async bootstrapProLicenseCloud (opts = {}) {
    const key = String(this.settings.proLicenseKey || '').trim()
    if (!key || !cloudLicenseEnabled(this.settings)) return { ok: false, skipped: true }
    let result
    if (this.settings.entitlementsCache && this.settings.entitlementsCacheKey === key) {
      result = await maybeRefreshCloudEntitlements(this.settings, this.manifest.version)
    } else {
      result = await activateProLicenseCloud(this.settings, { pluginVersion: this.manifest.version })
    }
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderProAdSection()
      view.renderTrustSection()
      view.renderGovernSection()
      view.renderFormatSection()
    }
    return result
  }

  /**
   * @param {{ silent?: boolean }} [opts]
   */
  async syncProLicenseCloud (opts = {}) {
    const result = await activateProLicenseCloud(this.settings, {
      pluginVersion: this.manifest.version
    })
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderProAdSection()
      view.renderTrustSection()
      view.renderGovernSection()
      view.renderFormatSection()
    }
    if (!opts.silent) {
      if (result.ok && (result.mode === 'mock' || result.mode === 'remote')) {
        new Notice(t(this.settings, 'proCloudActivateOk'), 4000)
      } else if (result.fallback === 'legacy' && result.ok) {
        new Notice(t(this.settings, 'proCloudActivateLegacy'), 6000)
      } else if (!result.ok) {
        const detail = formatProCloudError(this.settings, result)
        new Notice(t(this.settings, 'proCloudActivateFail', { detail }), 8000)
      }
    }
    return result
  }

  async retryFailedQueue () {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return
    }
    const queue = (this.settings.failedQueue || []).map(e => e.path).filter(Boolean)
    if (!queue.length) {
      new Notice(t(this.settings, 'trustFailedEmpty'))
      return
    }
    if (this.syncing) {
      new Notice(t(this.settings, 'syncing'))
      return
    }
    this.beginSyncRun({ progress: t(this.settings, 'trustRetryFailed'), batch: true })
    const view = this.getPanelView()
    try {
      const engine = this.createEngine(
        view ? (msg) => view.appendLog(msg) : () => {},
        (path) => this.setSyncProgress(path)
      )
      const summary = await engine.retryFailedPaths(queue)
      this.storeTrustReport(summary)
      this.storeFormatReport(summary)
      new Notice(t(this.settings, 'pushDone') + this.getPanelView()?.formatSummary(summary))
      if (view) view.scheduleStatsRefresh()
      void this.onSyncTelemetry(summary)
    } catch (e) {
      new Notice(formatSyncError(this.settings, e), 6000)
    } finally {
      this.endSyncRun()
    }
  }

  /** @param {import('obsidian').TFile[]} files */
  async collectGovernNotes (files) {
    const { parseNoteFile } = require('./lib/utils')
    /** @type {Array<{ path: string, basename: string, title: string, body: string, frontmatter: object }>} */
    const out = []
    for (const file of files) {
      if (file.extension !== 'md') continue
      const raw = await this.app.vault.read(file)
      const { frontmatter, body } = parseNoteFile(raw)
      out.push({
        path: file.path,
        basename: file.basename,
        title: frontmatter.title || file.basename,
        body,
        frontmatter
      })
    }
    return out
  }

  listGovernScopeFiles () {
    const folders = this.getSyncScopeFolders()
    const all = this.app.vault.getMarkdownFiles()
    if (!folders.length) return all
    return all.filter(f => isUnderSyncFolders(f.path, folders))
  }

  /** @returns {string[]} */
  getSyncScopeFolders () {
    return effectiveSyncFolders(this.settings, this.settings.syncFolders)
  }

  /**
   * @param {string} folder
   * @returns {Promise<boolean>}
   */
  async addSyncFolder (folder) {
    const dir = folder == null ? '' : String(folder)
    const list = (this.settings.syncFolders || []).filter(f => f != null && f !== '')
    if (list.includes(dir)) return true
    if (!canAddSyncDirectory(this.settings, list.length)) {
      const max = syncDirectoriesMax(this.settings) || 1
      new Notice(t(this.settings, 'syncDirLimitReached', { max }))
      return false
    }
    list.push(dir)
    this.settings.syncFolders = list
    await this.saveSettings({ statusFolders: true })
    return true
  }

  /** @param {{ silent?: boolean }} [opts] */
  async auditSyncFolder (opts = {}) {
    if (!canUseGovern(this.settings)) {
      if (!opts.silent) new Notice(t(this.settings, 'proInactive'))
      return null
    }
    const files = this.listGovernScopeFiles()
    const notes = await this.collectGovernNotes(files)
    const report = auditNotes(notes, this.settings)
    this.settings.lastGovernReport = report
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderGovernSection()
      view.renderFormatSection()
      view.renderFormatSection()
    }
    if (!opts.silent) {
      new Notice(t(this.settings, 'governAuditDone', {
        total: report.total,
        high: report.highRisk
      }), 5000)
    }
    return report
  }

  async auditCurrentNote () {
    if (!canUseGovern(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return null
    }
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return null
    }
    const notes = await this.collectGovernNotes([file])
    const report = auditNotes(notes, this.settings)
    this.settings.lastGovernReport = report
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderGovernSection()
      view.renderFormatSection()
      void view.renderCurrentNote(true)
    }
    const item = report.items[0]
    const msg = item?.codes?.length
      ? t(this.settings, 'governCurrentIssues', { codes: item.codes.join(', ') })
      : t(this.settings, 'governCurrentOk')
    new Notice(msg, 4000)
    return report
  }

  async exportLastGovernReport () {
    const report = this.settings.lastGovernReport
    if (!report?.total) {
      new Notice(t(this.settings, 'governReportNone'))
      return false
    }
    const md = formatGovernReportMarkdown(report, (k, vars) => t(this.settings, k, vars))
    const stamp = (report.auditedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `_ima-sync/reports/ima-govern-report-${stamp}.md`
    try {
      const dir = '_ima-sync/reports'
      if (!this.app.vault.getAbstractFileByPath('_ima-sync')) {
        await this.app.vault.createFolder('_ima-sync')
      }
      if (!this.app.vault.getAbstractFileByPath(dir)) {
        await this.app.vault.createFolder(dir)
      }
      const existing = this.app.vault.getAbstractFileByPath(filePath)
      if (existing) await this.app.vault.modify(existing, md)
      else await this.app.vault.create(filePath, md)
      new Notice(`${t(this.settings, 'governReportExport')}: ${filePath}`)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  async exportLastFormatReport () {
    const report = this.settings.lastFormatReport
    if (!report?.counts?.total) {
      new Notice(t(this.settings, 'formatReportNone'))
      return false
    }
    const md = formatFormatReportMarkdown(report, (k, vars) => t(this.settings, k, vars))
    const stamp = (report.finishedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `_ima-sync/reports/ima-format-report-${stamp}.md`
    try {
      const dir = '_ima-sync/reports'
      if (!this.app.vault.getAbstractFileByPath('_ima-sync')) {
        await this.app.vault.createFolder('_ima-sync')
      }
      if (!this.app.vault.getAbstractFileByPath(dir)) {
        await this.app.vault.createFolder(dir)
      }
      const existing = this.app.vault.getAbstractFileByPath(filePath)
      if (existing) await this.app.vault.modify(existing, md)
      else await this.app.vault.create(filePath, md)
      new Notice(`${t(this.settings, 'cmdFormatExport')}: ${filePath}`)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  async previewFormatCurrentNote () {
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    const raw = await this.app.vault.read(file)
    const { frontmatter, body } = parseNoteFile(raw)
    const title = frontmatter.title || file.basename
    const result = formatForIma({ path: file.path, title, body, frontmatter }, this.settings)
    if (result.unchanged || !result.rulesApplied?.length) {
      new Notice(t(this.settings, 'formatPreviewEmpty'))
      return
    }
    new FormatPreviewModal(this.app, this, file, {
      title: file.basename,
      before: body,
      after: result.body,
      rules: result.rulesApplied
    }).open()
  }

  async verifyCurrentNote () {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return
    }
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    const raw = await this.app.vault.read(file)
    const { parseNoteFile } = require('./lib/utils')
    const { frontmatter } = parseNoteFile(raw)
    const client = new ImaApiClient(this.engineSettings())
    const result = await verifyPushedNote(client, this.engineSettings(), {
      title: frontmatter.title || file.basename,
      docId: frontmatter.ima_doc_id || '',
      basename: file.basename
    })
    await writeVerifyFrontmatter(this.app, file, result)
    this.storeMiniTrustReport({
      pushed: true,
      verify: result.status,
      file: file.path,
      doc_id: frontmatter.ima_doc_id || ''
    })
    const msg = result.status === 'verified'
      ? t(this.settings, 'trustVerifiedShort')
      : t(this.settings, 'trustVerifyFailedShort')
    new Notice(msg)
  }

  normalizeApiUrl () {
    const s = this.settings
    const raw = (s.apiUrl || '').trim()
    if (!raw) return
    const normalized = normalizeApiBase(raw)
    if (normalized && normalized !== raw) {
      s.apiUrl = normalized
    }
  }

  normalizeKbSettings () {
    const s = this.settings
    if (!Array.isArray(s.kbLibraries)) s.kbLibraries = []
    const legacy = (s.kbId || '').trim()
    if (legacy && !s.kbLibraries.some(k => k.id === legacy)) {
      s.kbLibraries.push({ id: legacy, label: legacy })
    }
    if (legacy) s.kbId = ''
    const active = (s.activeKbId || '').trim()
    if (active && s.kbLibraries.length && !s.kbLibraries.some(k => k.id === active)) {
      s.activeKbId = ''
    }
    if (!s.activeKbId && s.kbLibraries.length) {
      s.activeKbId = s.kbLibraries[0].id
    }
  }

  normalizeSyncFrequencySettings () {
    const s = this.settings
    if (!s.requestStats || typeof s.requestStats !== 'object') {
      s.requestStats = { date: '', count: 0 }
    }
    if (s.uploadGapMs == null || s.uploadGapMs < 200) s.uploadGapMs = 500
    if (s.batchSize == null || s.batchSize < 1) s.batchSize = 80
    if (s.batchPauseSeconds == null) s.batchPauseSeconds = 30
    if (!s.rateLimitBackoffSec) s.rateLimitBackoffSec = '60,120,300'
  }

  bumpRequestCount (n = 1) {
    const today = new Date().toISOString().slice(0, 10)
    if (!this.settings.requestStats || this.settings.requestStats.date !== today) {
      this.settings.requestStats = { date: today, count: 0 }
    }
    this.settings.requestStats.count += n
    this._requestStatsDirty = true
    const view = this.getPanelView()
    if (!view) return
    if (this._requestStatsUiTimer) window.clearTimeout(this._requestStatsUiTimer)
    this._requestStatsUiTimer = window.setTimeout(() => {
      this._requestStatsUiTimer = null
      view.renderRequestStats()
    }, 500)
  }

  async flushRequestStats () {
    if (!this._requestStatsDirty) return
    this._requestStatsDirty = false
    await this.saveData(this.settings)
  }

  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    if (!Array.isArray(this.settings.syncFolders)) {
      this.settings.syncFolders = []
    }
    this.normalizeSyncFrequencySettings()
    this.normalizeApiUrl()
    this.normalizeKbSettings()
    this.normalizeExperimentalSettings()
    this.normalizeTelemetrySettings()
    this.normalizeStatsCacheSnapshot()
    this.normalizeTrustSettings()
    this.normalizeFormatSettings()
    this.normalizeApiKeyExpirySettings()
    this.syncConnectionMode()
  }

  normalizeApiKeyExpirySettings () {
    const s = this.settings
    if (s.apiKeyExpiresAt == null) s.apiKeyExpiresAt = ''
    if (s.apiKeyExpiresAt) {
      const normalized = normalizeApiKeyExpiresAtInput(s.apiKeyExpiresAt)
      if (!isInvalidApiKeyExpiresAtInput(normalized)) s.apiKeyExpiresAt = normalized
    }
    const days = parseInt(String(s.apiKeyExpiryRemindDays ?? 7), 10)
    s.apiKeyExpiryRemindDays = Number.isFinite(days) && days >= 1 ? Math.min(days, 90) : 7
  }

  normalizeTrustSettings () {
    const s = this.settings
    if (!s.trust || typeof s.trust !== 'object') {
      s.trust = { ...DEFAULT_SETTINGS.trust }
    }
    s.failedQueue = normalizeFailedQueue(s)
    if (s.lastTrustReport && typeof s.lastTrustReport !== 'object') {
      s.lastTrustReport = null
    }
  }

  normalizeFormatSettings () {
    const s = this.settings
    if (!s.format || typeof s.format !== 'object') {
      s.format = { ...DEFAULT_SETTINGS.format }
    }
    const preset = String(s.format.preset || 'core')
    if (!['core', 'standard', 'minimal', 'custom'].includes(preset)) {
      s.format.preset = 'core'
    }
    if (s.format.hashSource !== 'formatted') s.format.hashSource = 'local'
    if (s.format.writeBack !== 'confirm') s.format.writeBack = 'off'
    if (s.lastFormatReport && typeof s.lastFormatReport !== 'object') {
      s.lastFormatReport = null
    }
  }

  normalizeStatsCacheSnapshot () {
    const snap = this.settings.statsCacheSnapshot
    if (!snap || typeof snap !== 'object') {
      this.settings.statsCacheSnapshot = null
      return
    }
    const data = snap.data
    if (!data || typeof data.total !== 'number' || typeof snap.folderKey !== 'string') {
      this.settings.statsCacheSnapshot = null
    }
  }

  readStatsCacheSnapshot () {
    const snap = this.settings.statsCacheSnapshot
    if (!snap?.data || typeof snap.folderKey !== 'string') return null
    return {
      at: Number(snap.at) || 0,
      folderKey: snap.folderKey,
      data: {
        total: snap.data.total || 0,
        synced: snap.data.synced || 0,
        pending: snap.data.pending || 0,
        failed: snap.data.failed || 0,
        conflict: snap.data.conflict || 0
      }
    }
  }

  schedulePersistStatsCache (cache) {
    if (!cache?.data || typeof cache.folderKey !== 'string') return
    this.settings.statsCacheSnapshot = {
      at: cache.at,
      folderKey: cache.folderKey,
      data: { ...cache.data }
    }
    if (this._statsPersistTimer) window.clearTimeout(this._statsPersistTimer)
    this._statsPersistTimer = window.setTimeout(() => {
      this._statsPersistTimer = 0
      void this.saveData(this.settings)
    }, 800)
  }

  normalizeTelemetrySettings () {
    normalizeTelemetry(this.settings)
    if (this.settings.telemetryEnabled !== true) {
      this.settings.telemetryEnabled = false
    }
    if (isProductionBuild()) {
      this.settings.mockPro = false
      this.settings.licenseMock = false
    }
  }

  maybePromptTelemetryOptIn () {
    if (this.settings.telemetryPromptShown) return
    this.settings.telemetryPromptShown = true
    void this.saveData(this.settings)
    if (this.settings.telemetryEnabled) return
    const { t, resolveLang } = require('./lib/i18n')
    new Notice(t(this.settings, 'telemetryOptInNotice'), 7000)
  }

  /** @param {object} summary */
  telemetryErrorTypes (summary) {
    const list = summary?.errors
    if (!Array.isArray(list)) return []
    return list.map((e) => classifyTelemetryError(e?.error || e))
  }

  /** @param {object} summary */
  async onSyncTelemetry (summary) {
    if (!summary) return
    try {
      await reportSyncSummary(this, {
        pushed: summary.pushed || 0,
        errors: Array.isArray(summary.errors) ? summary.errors.length : (summary.errors || 0),
        skipped: summary.skipped || 0,
        errorTypes: this.telemetryErrorTypes(summary)
      })
    } catch { /* 统计失败不影响同步 */ }
  }

  async onSyncTelemetryError (err) {
    try {
      await reportSyncError(this, err)
    } catch { /* noop */ }
  }

  async onPanelTelemetry () {
    touchActiveDay(this.settings)
    void this.refreshRemoteNotices().catch(() => {})
    if (!this.settings.telemetryEnabled) return
    try {
      const { resolveLang } = require('./lib/i18n')
      const ctx = telemetryCtx(
        this.settings,
        this.manifest.version,
        resolveLang(this.settings),
        this.isConfigured()
      )
      enqueueEvent(this.settings, buildEvent({
        hook: HOOKS.PANEL_OPEN,
        installId: ctx.installId,
        sessionId: ctx.sessionId,
        payload: {
          plugin_version: ctx.pluginVersion,
          lang: ctx.lang,
          configured: ctx.configured
        }
      }))
      await this.saveData(this.settings)
      await flushPending(this.settings, ctx)
    } catch { /* noop */ }
  }

  openFeedbackModal () {
    new FeedbackModal(this.app, this).open()
  }

  async refreshRemoteNotices (opts = {}) {
    const view = this.getPanelView()
    try {
      await fetchRemoteNotices(this.settings, this.manifest.version, opts)
      await this.saveData(this.settings)
      if (view) view.renderRemoteNoticeBanner()
    } catch {
      if (view) view.renderRemoteNoticeBanner()
    }
  }

  openSettings () {
    const { setting } = this.app
    setting.open()
    setting.openTabById(this.manifest.id)
  }

  /**
   * @param {{ force?: boolean, authFailure?: boolean }} [opts]
   */
  maybePromptApiKeyExpiry (opts = {}) {
    const { force = false, authFailure = false } = opts
    if (this._apiKeyExpiryModalOpen) return
    if (!force && isSettingsTabOpen(this.app, this.manifest.id)) return

    const state = getApiKeyExpiryState(this.settings)

    if (authFailure && (state.level === 'none' || state.level === 'ok')) {
      if (state.level === 'none') {
        new Notice(t(this.settings, 'apiKeyExpiryAuthNoDate'), 6000)
      }
      return
    }

    if (state.level === 'none' || state.level === 'ok') return

    let shouldShow = force
    if (!shouldShow && authFailure && (state.level === 'expired' || state.level === 'soon')) {
      shouldShow = true
    }
    if (!shouldShow) shouldShow = shouldShowApiKeyExpiryReminder(this.settings, state)
    if (!shouldShow) return

    this._apiKeyExpiryModalOpen = true
    markApiKeyExpiryReminderShown(this.settings, state)
    void this.saveData(this.settings)

    const modal = new ApiKeyExpiryModal(this.app, this, state)
    const origClose = modal.onClose.bind(modal)
    modal.onClose = () => {
      this._apiKeyExpiryModalOpen = false
      origClose()
    }
    modal.open()

    const view = this.getPanelView()
    if (view) view.renderApiKeyExpiryBanner()

    const tab = this.app.setting?.activeTab
    if (tab?.updateApiKeyExpiryStatusEl) tab.updateApiKeyExpiryStatusEl(this.settings)
  }

  normalizeExperimentalSettings () {
    const s = this.settings
    if (!EXPERIMENTAL_UI || s.showExperimental !== true) {
      s.showExperimental = false
      s.pullNewFromIma = false
    }
  }

  /**
   * @param {{ connection?: boolean, kb?: boolean, statusFolders?: boolean, actions?: boolean, apiKeyExpiry?: boolean }} [opts]
   */
  async saveSettings (opts = {}) {
    this.normalizeApiUrl()
    this.normalizeKbSettings()
    this.normalizeApiKeyExpirySettings()
    this.syncConnectionMode()
    await this.saveData(this.settings)
    const view = this.getPanelView()
    if (!view) return

    if (opts.connection) {
      view.healthCache = null
      void view.refreshConnectionQuiet()
      return
    }

    if (opts.apiKeyExpiry) {
      view.renderApiKeyExpiryBanner()
      const tab = this._settingTab || this.app.setting?.activeTab
      if (tab?.updateApiKeyExpiryStatusEl) tab.updateApiKeyExpiryStatusEl(this.settings)
      return
    }

    if (opts.kb) {
      view.refreshKbSelector()
      return
    }

    if (opts.statusFolders) {
      view.scheduleStatsRefresh()
      view.applyStatusLocale()
      return
    }

    if (opts.actions) {
      view.renderActions()
    }
  }

  /** 防抖保存设置，避免输入 API 地址/密钥时频繁刷新侧栏 */
  scheduleSaveSettings (opts = {}) {
    this._pendingSaveOpts = { ...this._pendingSaveOpts, ...opts }
    if (this._saveSettingsTimer) window.clearTimeout(this._saveSettingsTimer)
    this._saveSettingsTimer = window.setTimeout(() => {
      this._saveSettingsTimer = 0
      const pending = this._pendingSaveOpts
      this._pendingSaveOpts = {}
      void this.saveSettings(pending)
    }, 400)
  }

  getPanelView () {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
    return leaf?.view
  }

  async activateView () {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0]
    if (!leaf) {
      const right = workspace.getRightLeaf(false)
      if (!right) return
      await right.setViewState({ type: VIEW_TYPE, active: true })
      leaf = workspace.getLeavesOfType(VIEW_TYPE)[0]
    }
    workspace.revealLeaf(leaf)
    window.setTimeout(() => { void this.onPanelTelemetry() }, 0)
  }

  clearAutoSyncTimer () {
    if (this.autoSyncTimer) {
      window.clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  resetAutoSyncTimer () {
    this.clearAutoSyncTimer()
    const mins = this.settings.autoSyncMinutes
    if (!mins || mins <= 0) return
    this.autoSyncTimer = window.setInterval(() => {
      if (this.syncing || this.settings.autoSyncPaused) return
      this.quickSync('push', true)
    }, mins * 60 * 1000)
  }

  clearConnectionWatch () {
    if (this.connectionWatchTimer) {
      window.clearInterval(this.connectionWatchTimer)
      this.connectionWatchTimer = null
    }
  }

  scheduleConnectionWatch () {
    if (this.connectionWatchTimer) return
    this.resetConnectionWatch()
  }

  resetConnectionWatch () {
    this.clearConnectionWatch()
    const sec = Number(this.settings.autoReconnectSeconds ?? 60)
    if (!sec || sec <= 0) return
    if (!this.isConfigured()) return

    const tick = async () => {
      if (this.syncing) return
      const view = this.getPanelView()
      if (!view) return

      const cached = view.healthCache?.data
      if (cached?.ok && !cached?.mock) return
      if (cached && !isNetworkErrorMessage(cached.message)) return

      view.reconnecting = true
      view.updateHealthLine(cached || { ok: false, message: '' })
      try {
        const health = await view.checkHealthCached(true)
        view.healthCache = { at: Date.now(), data: health }
        view.reconnecting = false
        view.updateHealthLine(health)

        if (health.ok) {
          new Notice(t(this.settings, 'reconnected'))
          view.updateHealthLine(health)
          this.clearConnectionWatch()
        } else if (!isNetworkErrorMessage(health.message)) {
          this.clearConnectionWatch()
        }
      } catch {
        view.reconnecting = false
        if (cached) view.updateHealthLine(cached)
      }
    }

    void tick()
    this.connectionWatchTimer = window.setInterval(() => {
      void tick()
    }, sec * 1000)
  }

  beginSyncRun ({ progress, batch = false } = {}) {
    this.syncControl.reset()
    this.syncing = true
    this.isBatchSync = batch
    this.syncProgress = progress || t(this.settings, 'syncingWait')
    const view = this.getPanelView()
    if (view) {
      view.vaultLoading = false
      view.reconnecting = false
      if (view.statusLineEl?.isConnected) {
        view.updateHealthLine(view.healthCache?.data || { ok: true })
      }
      view.flushLogRender()
      view.renderActions()
    }
  }

  setSyncProgress (text) {
    this.syncProgress = text
    const view = this.getPanelView()
    if (view?.updateSyncProgress(text)) return
    if (view) view.scheduleRenderActions()
  }

  endSyncRun () {
    this.syncing = false
    this.isBatchSync = false
    this.syncProgress = ''
    this.syncControl.reset()
    void this.flushRequestStats()
    const view = this.getPanelView()
    if (view) {
      view.renderActions()
      if (view.statusLineEl?.isConnected) {
        view.updateHealthLine(view.healthCache?.data || { ok: false, message: '' })
      }
    }
  }

  /** @param {'quota'|'rate'} kind */
  markSyncLimit (kind) {
    if (kind === 'quota') {
      const until = new Date()
      until.setDate(until.getDate() + 1)
      until.setHours(0, 0, 0, 0)
      this.syncLimitUntil = until.getTime()
      this.syncLimitKind = 'quota'
    } else if (kind === 'rate') {
      this.syncLimitUntil = Date.now() + 2 * 60 * 1000
      this.syncLimitKind = 'rate'
    }
    const view = this.getPanelView()
    if (view) {
      view.renderSyncLimitBanner()
      view.renderRemoteNoticeBanner()
      view.renderActions()
    }
  }

  async quickSync (direction, silent = false) {
    if ((direction === 'pull' || direction === 'both') && (!EXPERIMENTAL_UI || !this.settings.showExperimental)) {
      if (!silent) new Notice(t(this.settings, 'pullDisabled'), 5000)
      return
    }
    if (this.syncing) {
      if (!silent) new Notice(t(this.settings, 'syncing'))
      return
    }
    this.beginSyncRun({ progress: t(this.settings, 'syncPush'), batch: true })
    const view = this.getPanelView()
    const onLog = view ? (msg) => view.appendLog(msg) : () => {}
    const onProgress = (path) => this.setSyncProgress(path)
    try {
      await yieldToUi()
      const engine = this.createEngine(onLog, onProgress)
      const summary = await engine.runSync(direction)
      this.storeTrustReport(summary)
      this.storeFormatReport(summary)
      if (!silent) {
        const parts = []
        if (summary.stopped) parts.push(t(this.settings, 'syncStopped'))
        if (summary.pushed) parts.push(`${t(this.settings, 'pushed')} ${summary.pushed}`)
        if (summary.pulled) parts.push(`${t(this.settings, 'pulled')} ${summary.pulled}`)
        if (summary.created) parts.push(`${t(this.settings, 'created')} ${summary.created}`)
        if (summary.deduped) parts.push(`${t(this.settings, 'trustDeduped')} ${summary.deduped}`)
        if (summary.verified != null && summary.pushed) {
          parts.push(`${t(this.settings, 'trustVerified')} ${summary.verified}/${summary.pushed}`)
        }
        if (summary.errors.length) parts.push(`${t(this.settings, 'errors')} ${summary.errors.length}`)
        const title = summary.stopped ? t(this.settings, 'syncStopped') : t(this.settings, 'syncDone')
        const doneMsg = title + (parts.length ? ` (${parts.join(' · ')})` : '')
        new Notice(doneMsg)
        if (view) view.appendLog(doneMsg)
      }
      if (summary.syncLimit) this.markSyncLimit(summary.syncLimit)
      void this.onSyncTelemetry(summary)
      if (view) {
        view.scheduleStatsRefresh()
      }
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.markSyncLimit(limit.kind)
      void this.onSyncTelemetryError(e)
      if (!silent) new Notice(formatSyncError(this.settings, e), 6000)
    } finally {
      this.endSyncRun()
    }
  }

  /** @param {import('obsidian').TAbstractFile} file */
  onVaultModify (file) {
    if (!this.settings.syncOnSave) return
    if (!(file instanceof TFile) || file.extension !== 'md') return
    if (!isUnderSyncFolders(file.path, this.getSyncScopeFolders())) return

    const prev = this.saveDebounceTimers.get(file.path)
    if (prev) window.clearTimeout(prev)

    const timer = window.setTimeout(async () => {
      this.saveDebounceTimers.delete(file.path)
      if (this.syncing) return
      this.beginSyncRun({ progress: file.path, batch: false })
      try {
        await yieldToUi()
        const engine = this.createEngine(
          (msg) => {
            const view = this.getPanelView()
            if (view) view.appendLog(msg)
          },
          (path) => this.setSyncProgress(path)
        )
        const r = await engine.pushNote(file)
        this.storeMiniTrustReport(r)
        void this.onSyncTelemetry({
          pushed: r.skipped ? 0 : 1,
          errors: [],
          skipped: r.skipped ? 1 : 0
        })
        const view = this.getPanelView()
        if (view) {
          view.scheduleStatsRefresh()
          await view.refresh({ soft: true, note: true, stats: false, log: false, actions: false })
        }
      } catch (err) {
        const limit = parseImaError(err)
        if (limit) this.markSyncLimit(limit.kind)
        void this.onSyncTelemetryError(err)
        const view = this.getPanelView()
        if (view) view.appendLog(`✗ ${file.path}: ${formatSyncError(this.settings, err)}`)
      } finally {
        this.endSyncRun()
      }
    }, 3000)

    this.saveDebounceTimers.set(file.path, timer)
  }

  async quickPushFolder (folderPath) {
    if (!this.getActiveKbId()) {
      new Notice(t(this.settings, 'kbNone'))
      return
    }
    if (this.syncing) {
      new Notice(t(this.settings, 'syncing'))
      return
    }
    this.beginSyncRun({ progress: folderPath || t(this.settings, 'vaultRoot'), batch: true })
    const view = this.getPanelView()
    const onLog = view ? (msg) => view.appendLog(msg) : () => {}
    try {
      await yieldToUi()
      const engine = this.createEngine(onLog, (path) => this.setSyncProgress(path))
      const summary = await engine.pushFolder(folderPath)
      if (summary.total === 0) {
        new Notice(t(this.settings, 'folderEmpty'))
      } else {
        const title = summary.stopped
          ? t(this.settings, 'syncStopped')
          : t(this.settings, 'folderPushDone')
        const viewRef = this.getPanelView()
        new Notice(title + (viewRef ? viewRef.formatSummary(summary) : ''))
      }
      this.storeTrustReport(summary)
      this.storeFormatReport(summary)
      void this.onSyncTelemetry(summary)
      if (view) view.scheduleStatsRefresh()
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.markSyncLimit(limit.kind)
      void this.onSyncTelemetryError(e)
      new Notice(formatSyncError(this.settings, e), 6000)
    } finally {
      this.endSyncRun()
    }
  }

  quickPushFolderPrompt () {
    new FolderPickerModal(this.app, this.settings, (folder) => {
      this.quickPushFolder(folder)
    }, { titleKey: 'pickFolderToSync' }).open()
  }

  async quickPushCurrent () {
    if (!this.getActiveKbId()) {
      new Notice(t(this.settings, 'kbNone'))
      return
    }
    const file = this.app.workspace.getActiveFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    this.beginSyncRun({ progress: file.path, batch: false })
    try {
      await yieldToUi()
      const engine = this.createEngine(
        () => {},
        (path) => this.setSyncProgress(path)
      )
      const r = await engine.pushNote(file, true)
      this.storeMiniTrustReport(r)
      new Notice(r.skipped ? t(this.settings, 'unchanged') : t(this.settings, 'currentPushed'))
      void this.onSyncTelemetry({
        pushed: r.skipped ? 0 : 1,
        errors: [],
        skipped: r.skipped ? 1 : 0
      })
      const view = this.getPanelView()
      if (view) {
        view.scheduleStatsRefresh()
        await view.refresh({ soft: true, stats: false, note: true, log: false, actions: false })
      }
    } catch (e) {
      const limit = parseImaError(e)
      if (limit) this.markSyncLimit(limit.kind)
      void this.onSyncTelemetryError(e)
      new Notice(formatSyncError(this.settings, e), 6000)
    } finally {
      this.endSyncRun()
    }
  }
}

class FormatPreviewModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {import('./main').default} plugin
   * @param {import('obsidian').TFile} file
   * @param {{ title: string, before: string, after: string, rules: string[] }} data
   */
  constructor (app, plugin, file, data) {
    super(app)
    this.plugin = plugin
    this.settings = plugin.settings
    this.file = file
    this.data = data
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.addClass('ima-format-preview-modal')
    const tr = (k, v) => t(this.settings, k, v)
    contentEl.createEl('h2', { text: tr('formatPreviewTitle') })
    contentEl.createEl('p', { cls: 'ima-muted', text: `${this.data.title} · ${tr('formatPreviewRules')}: ${this.data.rules.join(', ')}` })
    const grid = contentEl.createDiv({ cls: 'ima-format-preview-grid' })
    const colA = grid.createDiv({ cls: 'ima-format-preview-col' })
    colA.createEl('h3', { text: tr('formatPreviewBefore') })
    colA.createEl('pre', { text: this.data.before.slice(0, 8000) })
    const colB = grid.createDiv({ cls: 'ima-format-preview-col' })
    colB.createEl('h3', { text: tr('formatPreviewAfter') })
    colB.createEl('pre', { text: this.data.after.slice(0, 8000) })

    const actions = contentEl.createDiv({ cls: 'ima-row ima-format-preview-actions' })
    const canWriteBack = canUseFormatFull(this.settings) && this.settings.format?.writeBack === 'confirm'
    if (canWriteBack) {
      actions.createEl('button', { text: tr('formatWriteBack'), cls: 'mod-cta' })
        .addEventListener('click', () => {
          const ok = window.confirm(tr('formatWriteBackConfirm'))
          if (!ok) return
          void this.plugin.writeBackFormattedNote(this.file, this.data.after).then((done) => {
            if (done) this.close()
          })
        })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}
