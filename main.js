'use strict'

const { Plugin, ItemView, Notice, Setting, PluginSettingTab, Modal, TFile, setIcon } = require('obsidian')
const { ImaApiClient, normalizeApiBase } = require('./lib/ima-api')
const { ImaSyncEngine } = require('./lib/sync-engine')
const { SyncControl } = require('./lib/sync-control')
const { isUnderSyncFolders, resolveWorkingMarkdownFile } = require('./lib/utils')
const { normalizeFrontmatter } = require('./lib/sync-frontmatter-i18n')
const { SyncStatDetailModal, STAT_KIND_BY_LABEL } = require('./lib/sync-stat-modal')
const { t, label, labelExp, renderAbout, formatSyncError, localizeStatus, formatCodeList } = require('./lib/i18n')
const { parseImaError } = require('./lib/ima-errors')
const { resetSystemicFailedMarks } = require('./lib/sync-failed-reset')
const { isNetworkErrorMessage } = require('./lib/net-retry')
const { attachTip, attachHoverTip, addButtonWithTip, applySettingTip, bindPressFeedback, bindSnappyClick } = require('./lib/ui-hints')
const { yieldToUi } = require('./lib/ui-yield')
const { createVaultReadyGate } = require('./lib/vault-ready')
const { FeedbackModal } = require('./lib/feedback-modal')
const { copyPluginShare } = require('./lib/plugin-share')
const { qqGroup: BRAND_QQ_GROUP } = require('./lib/product-config')
const { normalizeTelemetry, touchActiveDay } = require('./lib/telemetry-local')
const {
  maybeReportInstall,
  maybeReportHeartbeat,
  reportSyncSummary,
  reportSyncError,
  reportExperienceTamper,
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
const { isProActive, verifyProLicenseKey, canUseTrust, canUseGovern, canUseFormatFull, canUseEnrich, syncDirectoriesMax, canAddSyncDirectory, effectiveSyncFolders, kbLibrariesMax, canAddKbLibrary, effectiveKbLibraries } = require('./lib/license')
const { isProductionBuild } = require('./lib/build-profile')
const { buildEntitlementBarModel, getEffectiveEntitlements } = require('./lib/entitlements')
const { renderProAdStrip, shouldShowProAdStrip, markProAdStripDismissed } = require('./lib/pro-ad-block')
const {
  shouldShowProAdToast,
  markProAdToastDay,
  resolveProAdToastDelayMs,
  renderProAdToast
} = require('./lib/pro-ad-toast')
const {
  activateProLicenseCloud,
  deactivateLocalDeviceCloud,
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
  countVerifyFailedNotes,
  formatTrustBatchNotice
} = require('./lib/trust-prominence')
const { FailureQueueModal } = require('./lib/failure-queue-modal')
const {
  probeTrustCapabilities,
  formatCapabilitySummary,
  formatReadyLevelHint,
  capIcon
} = require('./lib/trust-capabilities')
const { auditNotes, evaluateNoteRules } = require('./lib/govern-rules')
const { formatGovernReportMarkdown } = require('./lib/govern-report')
const { buildHealthReport } = require('./lib/health-score')
const { formatWeeklyHealthMarkdown } = require('./lib/health-report')
const { HealthDimFolderModal } = require('./lib/health-dim-modal')
const { HealthWeeklyModal, pickOsDirectory, writeOsFile } = require('./lib/health-weekly-modal')
const {
  formatForIma,
  rebuildNoteRaw,
  PRO_RULE_IDS,
  resolveActiveRuleIds,
  formatRuleLabels
} = require('./lib/format-pipeline')
const { formatFormatReportMarkdown } = require('./lib/format-report')
const { enrichNote, enrichTarget } = require('./lib/enrich-pipeline')
const { formatEnrichReportMarkdown } = require('./lib/enrich-report')
const { detectEnrichTargets, extractEnrichUrls } = require('./lib/enrich-detect')
const {
  indexEnrichNotesInFolder,
  planSplitWriteActions,
  buildMergedEnrichNoteRaw,
  safeEnrichBasename
} = require('./lib/enrich-writeback')
const { sleepMs } = require('./lib/enrich-cache')
const {
  checkBatchQuota,
  recordBatchNotes,
  countBatchQuotaNotes,
  batchNotesPerDayMax,
  remainingBatchNotes
} = require('./lib/batch-quota')
const {
  checkEnrichParseQuota,
  recordEnrichParse,
  remainingEnrichParse,
  enrichParsePerDayMax
} = require('./lib/enrich-quota')
const {
  checkFormatPreviewQuota,
  recordFormatPreview,
  remainingFormatPreview,
  formatPreviewPerDayMax
} = require('./lib/format-quota')
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

/** 超过此篇数时，目录/全库同步前弹出确认 */
const LARGE_SYNC_CONFIRM_MIN = 80

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
  proAdToastLastDay: '',
  proAdStripDismissDay: '',
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
  batchQuotaUsage: { date: '', notes: 0 },
  formatTrialUsage: { date: '', count: 0 },
  statsCacheSnapshot: null,
  telemetryEnabled: true,
  telemetryPromptShown: false,
  telemetryUrl: '',
  proLicenseKey: '',
  proLicenseKeyRevoked: '',
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
  lastHealthReport: null,
  priorHealthReport: null,
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
    minBodyChars: 80,
    urlOnlyMaxResidualChars: 40,
    autoAuditBeforeBatch: false,
    weeklyReminder: false,
    sensitivePatterns: []
  },
  format: {
    enabled: true,
    onPush: true,
    preset: 'core',
    hashSource: 'local',
    writeBack: 'off',
    cjkSpacing: false,
    headingNormalize: false,
    freePreviewPerDay: 5
  },
  enrich: {
    enabled: true,
    onPush: false,
    skipMinBodyChars: 500,
    freeParsePerDay: 5,
    writeBack: 'off',
    wechat: true,
    web: true,
    desktopEnhancement: true,
    fetchTimeoutMs: 30000,
    fetchGapMs: 800,
    cacheTtlHours: 72
  },
  enrichTrialUsage: { date: '', count: 0 },
  lastEnrichReport: null,
  enrichUrlCache: {}
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
    this.noticeSlotEl = null
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
    if (snap?.folderKey === folderKey && snap?.data) return snap.data
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

  /** 侧栏唯一滚动层（ItemView.containerEl 即 .view-content） */
  getPanelScrollEl () {
    return this.containerEl?.closest?.('.view-content') || this.containerEl
  }

  ensurePanelScrollPort () {
    const scrollEl = this.getPanelScrollEl()
    if (!scrollEl) return scrollEl
    scrollEl.addClass('ima-sync-view-content')
    this.containerEl.addClass('ima-sync-view-root')
    // 兜底：主题若覆写 overflow/高度，强制填满 leaf 且可滚到底
    scrollEl.style.setProperty('overflow-y', 'auto', 'important')
    scrollEl.style.setProperty('overflow-x', 'hidden', 'important')
    scrollEl.style.setProperty('position', 'absolute', 'important')
    scrollEl.style.setProperty('inset', '0', 'important')
    scrollEl.style.setProperty('top', '0', 'important')
    scrollEl.style.setProperty('right', '0', 'important')
    scrollEl.style.setProperty('bottom', '0', 'important')
    scrollEl.style.setProperty('left', '0', 'important')
    scrollEl.style.setProperty('width', '100%', 'important')
    scrollEl.style.setProperty('height', '100%', 'important')
    scrollEl.style.setProperty('max-height', '100%', 'important')
    scrollEl.style.setProperty('padding', '2px 0 0', 'important')
    scrollEl.style.setProperty('margin', '0', 'important')
    scrollEl.style.setProperty('box-sizing', 'border-box', 'important')
    const leaf = scrollEl.closest?.('.workspace-leaf-content')
    if (leaf) {
      leaf.style.setProperty('position', 'relative', 'important')
      leaf.style.setProperty('overflow', 'hidden', 'important')
      leaf.style.setProperty('height', '100%', 'important')
      leaf.style.setProperty('max-height', '100%', 'important')
      leaf.style.setProperty('min-height', '0', 'important')
    }
    return scrollEl
  }

  async onOpen () {
    this.containerEl.empty()
    this.ensurePanelScrollPort()
    this.root = this.containerEl.createDiv({ cls: 'ima-sync-panel' })
    this.renderShell()
    await this.refresh()
    void this.plugin.refreshRemoteNotices().catch(() => {})
    void this.plugin.maybePromptApiKeyExpiry()
    const scrollEl = this.ensurePanelScrollPort()
    if (scrollEl) scrollEl.scrollTop = 0
  }

  /** 侧板叶节点（不随滚动），供中间广告叠层 */
  getPanelLeafHost () {
    return this.containerEl?.closest?.('.workspace-leaf-content') || this.containerEl
  }

  dismissProAdToast () {
    const host = this.getPanelLeafHost()
    host?.querySelectorAll?.('.ima-pro-ad-toast')?.forEach((el) => el.remove())
  }

  renderShell () {
    this.root.empty()
    // 首屏预算：状态下立刻是推送主控（勿被笔记/Pro 挤出视口）；下方可滚且底部有安全区
    this.headEl = this.root.createDiv({ cls: 'ima-section ima-section-tight ima-panel-head' })
    this.renderPanelHead()
    this.statusEl = this.root.createDiv({ cls: 'ima-section ima-section-tight ima-section-head' })
    this.actionsEl = this.root.createDiv({ cls: 'ima-section ima-section-actions' })
    this.noteEl = this.root.createDiv({ cls: 'ima-section ima-section-note' })
    this.proAdEl = this.root.createDiv({ cls: 'ima-section ima-pro-ad-section' })
    this.proModulesEl = this.root.createDiv({ cls: 'ima-section ima-pro-modules' })
    this.trustEl = this.proModulesEl.createDiv({ cls: 'ima-trust-section' })
    this.governEl = this.proModulesEl.createDiv({ cls: 'ima-govern-section' })
    this.formatEl = this.proModulesEl.createDiv({ cls: 'ima-format-section' })
    this.enrichEl = this.proModulesEl.createDiv({ cls: 'ima-enrich-section' })
    this.logEl = this.root.createDiv({ cls: 'ima-section ima-log' })
    this.footEl = this.root.createDiv({ cls: 'ima-section ima-section-last ima-panel-foot' })
    this.renderPanelFoot()
    this.root.createDiv({ cls: 'ima-panel-scroll-end', attr: { 'aria-hidden': 'true' } })
  }

  /** 版权（含作者）+ 版本·QQ；挂到当前文档「验证本篇」行右侧，底栏不再重复 */
  appendPanelMeta (parentEl) {
    if (!parentEl) return
    const wrap = parentEl.createDiv({ cls: 'ima-note-meta ima-muted' })
    const trail = wrap.createSpan({ cls: 'ima-note-meta-trail' })
    const copyText = String(this.tr('copyrightShort') || '').trim()
    const author = String(this.tr('authorName') || '').trim()
    // 优先完整 © 作者 · 品牌；缺版权短句时回退「© 作者」
    const copyLabel = copyText || (author ? `© ${author}` : '')
    if (copyLabel) {
      trail.createSpan({
        cls: 'ima-note-meta-copy',
        text: copyLabel,
        attr: { title: copyLabel }
      })
    }
    const ver = String(this.plugin.manifest?.version || '').trim()
    const qq = String(BRAND_QQ_GROUP || '').trim()
    if (ver) {
      if (copyLabel) trail.createSpan({ cls: 'ima-panel-foot-sep', text: '·', attr: { 'aria-hidden': 'true' } })
      trail.createSpan({
        cls: 'ima-panel-foot-version',
        text: this.tr('panelFootVersion', { version: ver }),
        attr: { title: this.tr('panelFootVersion', { version: ver }) }
      })
    }
    if (qq) {
      if (copyLabel || ver) trail.createSpan({ cls: 'ima-panel-foot-sep', text: '·', attr: { 'aria-hidden': 'true' } })
      const qqBtn = trail.createEl('button', {
        cls: 'ima-panel-foot-qq',
        text: this.tr('panelFootQq', { group: qq }),
        attr: {
          type: 'button',
          title: this.tr('panelFootQqCopyHint'),
          'aria-label': this.tr('panelFootQqCopyHint')
        }
      })
      bindPressFeedback(qqBtn)
      bindSnappyClick(qqBtn, () => { void this.copyQqGroup(qq) })
    }
  }

  renderPanelFoot () {
    if (!this.footEl) return
    // 版权/版本/QQ 已迁至当前文档卡「验证本篇」行右侧
    this.footEl.empty()
    this.footEl.addClass('ima-panel-foot--empty')
  }

  /** @param {string} group */
  async copyQqGroup (group) {
    const text = String(group || '').trim()
    if (!text) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        new Notice(this.tr('panelFootQqCopied'), 2500)
        return
      }
    } catch { /* fall through */ }
    new Notice(this.tr('panelFootQq', { group: text }), 5000)
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
    const refreshBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn ima-toolbar-refresh',
      attr: { type: 'button', 'aria-label': this.tr('panelRefresh') }
    })
    setIcon(refreshBtn, 'refresh-cw')
    bindPressFeedback(refreshBtn)
    bindSnappyClick(refreshBtn, () => { void this.manualRefresh() })
    attachHoverTip(refreshBtn, this.plugin.settings, 'panelRefresh', this.tipDeps())
    const settingsBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn',
      attr: {
        type: 'button',
        'aria-label': this.tr('panelSettings'),
        title: this.tr('panelSettings')
      }
    })
    setIcon(settingsBtn, 'settings')
    bindPressFeedback(settingsBtn)
    bindSnappyClick(settingsBtn, () => this.plugin.openSettings())
    const helpBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn',
      attr: {
        type: 'button',
        'aria-label': this.tr('panelHelp'),
        title: this.tr('panelHelp')
      }
    })
    setIcon(helpBtn, 'help-circle')
    bindPressFeedback(helpBtn)
    bindSnappyClick(helpBtn, () => {
      new AuthorAboutModal(this.app, this.plugin).open()
    })
    const shareBtn = toolbar.createEl('button', {
      cls: 'ima-toolbar-btn',
      attr: { type: 'button', 'aria-label': this.tr('panelShare') }
    })
    setIcon(shareBtn, 'share-2')
    bindPressFeedback(shareBtn)
    bindSnappyClick(shareBtn, () => { void copyPluginShare(this.plugin.settings, Notice) })
    attachHoverTip(shareBtn, this.plugin.settings, 'panelShare', this.tipDeps())
    // 顶部公告位（原作者/公众号行已移至关于页）；Pro 激活态在「已连接」右侧
    this.noticeSlotEl = this.headEl.createDiv({ cls: 'ima-notice-slot' })
    this.renderRemoteNoticeBanner()
    this.syncRefreshButtonBusy()
  }

  /** @returns {HTMLElement | null} */
  ensureStatusLineTrail () {
    if (!this.statusLineEl) return null
    let trail = this.statusLineEl.querySelector('.ima-status-line-trail')
    if (!trail) trail = this.statusLineEl.createDiv({ cls: 'ima-status-line-trail' })
    return trail
  }

  /** Pro 激活状态 + 到期：挂在「已连接」右侧（点开设置·授权） */
  renderStatusLicenseInline () {
    if (!this.statusLineEl) return
    const trail = this.ensureStatusLineTrail()
    if (!trail) return
    trail.querySelector('.ima-status-license-inline')?.remove()
    const row = trail.createDiv({ cls: 'ima-status-license-inline' })
    const auto = trail.querySelector('.ima-auto-sync-inline')
    if (auto) trail.insertBefore(row, auto)

    const active = isProActive(this.plugin.settings)
    const badge = row.createEl('button', {
      cls: active
        ? 'ima-status-license-tag ima-status-license-tag--on ima-pro-status-tag--click'
        : 'ima-status-license-tag ima-status-license-tag--off',
      text: this.tr(active ? 'proStatusTag' : 'proStatusTagOff'),
      attr: {
        type: 'button',
        title: this.tr('proStatusManage'),
        'aria-label': this.tr('proStatusManage')
      }
    })
    bindPressFeedback(badge)
    bindSnappyClick(badge, () => { this.plugin.openSettings('pro') })

    if (!active) return
    const ent = getEffectiveEntitlements(this.plugin.settings)
    const until = String(ent.valid_until || '').slice(0, 10)
    if (until && !until.startsWith('2099')) {
      row.createSpan({
        cls: 'ima-status-license-until',
        text: this.tr('statusLicenseUntil', { date: until }),
        attr: { title: this.tr('proValidUntil', { date: until }) }
      })
    }
  }

  /** 已连接行右侧：激活态 + 定时间隔 */
  renderStatusLineTrail () {
    this.renderStatusLicenseInline()
    this.renderStatusAutoInterval()
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
        this.renderActions()
      } else {
        this.healthCache = null
        this.invalidateStatsCache()
        this._lastNotePath = ''
        await this.refresh({ soft: false, forceHealth: true, forceHeavy: true, stats: true, note: true, log: false, actions: true })
        await this.plugin.refreshRemoteNotices({ force: true })
      }
      // D-LIC-17c：刷新后后台强制校验权益（不阻塞首屏，避免卡顿）
      void this.plugin.bootstrapProLicenseCloud({ force: true, silent: true }).catch(() => {})
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
    // 进度路径就地更新优先；否则尽快重建（避免 150ms 拖沓感）
    this._actionTimer = window.setTimeout(() => {
      this._actionTimer = null
      if (this.plugin.syncing && this.updateSyncProgress(this.plugin.syncProgress)) return
      if (this.plugin.syncing) this.renderActions()
    }, 32)
  }

  /** 侧栏获焦后仍用最近 Markdown；切换笔记时刷新日常按钮与当前文档卡 */
  scheduleWorkspaceContextRefresh () {
    if (this._wsCtxTimer) window.clearTimeout(this._wsCtxTimer)
    this._wsCtxTimer = window.setTimeout(() => {
      this._wsCtxTimer = null
      if (!this.root?.isConnected) return
      if (this.plugin.syncing) return
      void this.renderCurrentNote(false)
      this.renderActions()
    }, 50)
  }

  resolveWorkingMarkdownFile () {
    return this.plugin.resolveWorkingMarkdownFile()
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

  /** Pro 模块折叠态（刷新后保留展开） */
  ensureModuleOpenState () {
    if (!this._moduleOpen || typeof this._moduleOpen !== 'object') {
      this._moduleOpen = { trust: false, govern: false, format: true }
    }
    return this._moduleOpen
  }

  /**
   * @param {HTMLElement} parentEl
   * @param {'trust'|'govern'|'format'} key
   * @param {string} title
   * @param {string} [tipId]
   */
  openModuleHost (parentEl, key, title, tipId) {
    const openState = this.ensureModuleOpenState()
    const details = parentEl.createEl('details', { cls: 'ima-module-fold' })
    details.open = !!openState[key]
    details.addEventListener('toggle', () => {
      openState[key] = details.open
    })
    const summary = details.createEl('summary', { cls: 'ima-module-fold-summary' })
    summary.createSpan({ cls: 'ima-module-fold-title', text: title })
    if (tipId) attachTip(summary, this.plugin.settings, tipId, this.tipDeps())
    const body = details.createDiv({ cls: 'ima-module-fold-body' })
    return body
  }

  renderProAdSection () {
    if (!this.proAdEl) return
    this.proAdEl.empty()
    this.renderStatusLicenseInline()
    // Free 广告改挂日常区上方叠层条（每日一次）；底部大卡不再常驻占位
  }

  /** 日常功能键上方：Free 叠层广告（每日一次，可关；不顶开 sticky） */
  renderProAdStripAboveActions () {
    if (!this.actionsEl) return
    this.actionsEl.querySelector('.ima-pro-ad-strip-host')?.remove()
    if (isProActive(this.plugin.settings)) {
      this.plugin._proAdStripLive = false
      return
    }
    if (!shouldShowProAdStrip(this.plugin.settings)) {
      this.plugin._proAdStripLive = false
      return
    }
    const host = this.actionsEl.createDiv({ cls: 'ima-pro-ad-strip-host' })
    this.plugin._proAdStripLive = true
    renderProAdStrip(host, this.plugin.settings, {
      onActivate: () => { this.plugin.openSettings('pro') },
      onDismiss: () => {
        markProAdStripDismissed(this.plugin.settings)
        this.plugin._proAdStripLive = false
        void this.plugin.saveSettings()
        host.remove()
      }
    })
  }

  /** 授权变更后刷新侧栏广告/激活态与 Pro 模块 */
  refreshAfterLicenseChange () {
    this.renderProAdSection()
    this.renderStatusLineTrail?.()
    this.renderActions()
    this.renderTrustSection()
    this.renderGovernSection()
    this.renderFormatSection()
    this.renderEnrichSection()
  }

  /** Pro 激活后：单行状态条（详情进设置） */
  renderProStatusCard () {
    const card = this.proAdEl.createDiv({ cls: 'ima-pro-status ima-pro-status--oneline' })
    const head = card.createDiv({ cls: 'ima-pro-status-head' })
    head.createEl('h3', { cls: 'ima-pro-status-title', text: this.tr('proStatusTitle') })
    head.createSpan({ cls: 'ima-pro-status-tag', text: this.tr('proStatusTag') })
    const ent = getEffectiveEntitlements(this.plugin.settings)
    const until = String(ent.valid_until || '').slice(0, 10)
    if (until && !until.startsWith('2099')) {
      head.createSpan({
        cls: 'ima-pro-status-until ima-muted',
        text: this.tr('proValidUntil', { date: until }),
        attr: { title: this.tr('proValidUntil', { date: until }) }
      })
    }
    const manageBtn = head.createEl('button', {
      text: this.tr('proStatusManage'),
      cls: 'ima-btn-secondary ima-btn-compact ima-pro-status-manage',
      attr: { type: 'button' }
    })
    manageBtn.addEventListener('click', () => { this.plugin.openSettings() })
  }

  syncProModulesVisibility () {
    if (!this.proModulesEl) return
    const show = !!(
      this.trustEl?.childElementCount ||
      this.governEl?.childElementCount ||
      this.formatEl?.childElementCount ||
      this.enrichEl?.childElementCount
    )
    this.proModulesEl.toggleClass('ima-pro-modules--empty', !show)
  }

  renderTrustSection () {
    if (!this.trustEl) return
    this.trustEl.empty()

    if (!canUseTrust(this.plugin.settings)) {
      this.syncProModulesVisibility()
      return
    }

    const host = this.openModuleHost(this.trustEl, 'trust', this.tr('trustHeroTitle'), 'trustHero')
    const report = this.plugin.settings.lastTrustReport
    const queue = this.plugin.settings.failedQueue || []
    const m = trustHeroMetrics(report)
    const hero = host.createDiv({ cls: 'ima-trust-hero' })

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

    const verifyCount = countVerifyFailedNotes(this.plugin.settings, this.app)
    const fails = listVerifyFailedNotes(this.plugin.settings, this.app, 6)
    if (fails.length) {
      const list = hero.createDiv({ cls: 'ima-trust-fail-list' })
      list.createDiv({
        cls: 'ima-trust-fail-head',
        text: `${this.tr('trustHeroFailList')} (${verifyCount})`
      })
      for (const item of fails) {
        const row = list.createDiv({ cls: 'ima-trust-fail-item', text: item.path })
        row.setAttr('title', item.detail || item.path)
        row.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(item.path)
          if (f) void this.app.workspace.getLeaf(false).openFile(f)
        })
      }
      if (verifyCount > fails.length) {
        list.createDiv({
          cls: 'ima-muted ima-compact ima-trust-fail-more',
          text: this.tr('fqMoreHint', { n: verifyCount - fails.length })
        }).addEventListener('click', () => {
          this.plugin.openFailureQueue('verify')
        })
      }
    }

    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    const fqBtn = row.createEl('button', {
      text: this.tr('fqOpen', { push: queue.length, verify: verifyCount }),
      cls: 'ima-btn-secondary'
    })
    fqBtn.addEventListener('click', () => {
      this.plugin.openFailureQueue(queue.length ? 'push' : 'verify')
    })
    row.createEl('button', { text: this.tr('trustReportExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportLastTrustReport() })
    this.syncProModulesVisibility()
  }

  renderEntitlementBar (parentEl) {
    const model = buildEntitlementBarModel(this.plugin.settings, this.tr.bind(this))
    const ent = getEffectiveEntitlements(this.plugin.settings)
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
    const until = String(ent.valid_until || '').slice(0, 10)
    if (model.tier !== 'free' && until && !until.startsWith('2099')) {
      block.createDiv({
        cls: 'ima-muted ima-compact ima-ent-until',
        text: this.tr('proValidUntil', { date: until })
      })
    }
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
      this.syncProModulesVisibility()
      return
    }

    const host = this.openModuleHost(this.governEl, 'govern', this.tr('healthHeroTitle'), 'governHero')
    const health = this.plugin.settings.lastHealthReport
    const report = this.plugin.settings.lastGovernReport
    const hero = host.createDiv({ cls: 'ima-govern-hero' })

    this.renderHealthCard(hero, health)

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
          const row = list.createDiv({ cls: 'ima-trust-fail-item ima-govern-issue-row' })
          const pathSpan = row.createSpan({ cls: 'ima-govern-issue-path', text: item.path })
          pathSpan.setAttr('title', (item.codes || []).join(', '))
          pathSpan.addEventListener('click', () => {
            const f = this.app.vault.getAbstractFileByPath(item.path)
            if (f) void this.app.workspace.getLeaf(false).openFile(f)
          })
          if ((item.codes || []).includes('URL_ONLY_BODY')) {
            const enrBtn = row.createEl('button', {
              text: this.tr('enrichUrlOnlyOne'),
              cls: 'ima-btn-secondary ima-btn-compact'
            })
            enrBtn.addEventListener('click', (e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!canUseEnrich(this.plugin.settings)) {
                new Notice(this.tr('enrichUrlOnlyPro'), 6000)
                this.plugin.openSettings('pro')
                return
              }
              void this.plugin.previewEnrichAtPath(item.path)
            })
          }
        }
      }
    } else if (!health?.total) {
      hero.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('governReportNone') })
    }

    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    row.createEl('button', { text: this.tr('healthRefresh'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.auditSyncFolder() })
    row.createEl('button', { text: this.tr('governAuditCurrent'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.auditCurrentNote() })
    row.createEl('button', { text: this.tr('healthWeeklyExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportWeeklyHealthReport() })
    row.createEl('button', { text: this.tr('governReportExport'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.exportLastGovernReport() })
    this.syncProModulesVisibility()
  }

  /**
   * @param {HTMLElement} host
   * @param {ReturnType<typeof buildHealthReport> | null | undefined} health
   */
  renderHealthCard (host, health) {
    if (!health || !health.total) return
    const card = host.createDiv({ cls: 'ima-health-card' })
    const gradeKey = {
      excellent: 'healthGradeExcellent',
      good: 'healthGradeGood',
      needs_work: 'healthGradeNeedsWork'
    }[health.grade] || 'healthGradeNeedsWork'
    const head = card.createDiv({ cls: 'ima-health-card-head' })
    head.createSpan({
      cls: `ima-health-score ima-health-score--${health.grade}`,
      text: String(health.score)
    })
    const meta = head.createDiv({ cls: 'ima-health-card-meta' })
    meta.createDiv({
      cls: 'ima-health-grade',
      text: this.tr(gradeKey)
    })
    meta.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('healthLastAt', {
        time: String(health.scoredAt || '').replace('T', ' ').slice(0, 16)
      })
    })

    const dimLabels = {
      pending: 'healthDimPending',
      duplicateTitle: 'healthDimDuplicate',
      bodyTooShort: 'healthDimShortBody',
      urlOnly: 'healthDimUrlOnly'
    }
    const openDim = (dimKey) => {
      const dim = (health.dimensions || []).find((x) => x.key === dimKey)
      if (!dim || !dim.count) {
        new Notice(this.tr('healthFolderEmpty'))
        return
      }
      new HealthDimFolderModal(this.app, this.plugin, dimKey, health).open()
    }

    const worst = (health.worst || []).slice(0, 2)
    if (worst.length) {
      const worstRow = card.createDiv({ cls: 'ima-health-worst ima-compact' })
      worstRow.createSpan({ text: `${this.tr('healthWorst')}: ` })
      for (const d of worst) {
        const label = this.tr(dimLabels[d.key] || 'healthDimPending')
        const chip = worstRow.createSpan({
          cls: 'ima-health-worst-chip ima-health-dim-chip--click',
          text: `${label} ${d.count}`
        })
        chip.setAttr('title', this.tr('healthDimClickHint'))
        chip.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openDim(d.key)
        })
      }
    }

    const dims = card.createDiv({ cls: 'ima-health-dims' })
    for (const d of health.dimensions || []) {
      const chip = dims.createSpan({
        cls: 'ima-health-dim-chip ima-health-dim-chip--click',
        text: `${this.tr(dimLabels[d.key] || 'healthDimPending')} ${d.count}`
      })
      chip.setAttr(
        'title',
        `${this.tr('healthDimScoreHint', { score: d.score, weight: d.weight })} · ${this.tr('healthDimClickHint')}`
      )
      chip.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        openDim(d.key)
      })
    }
  }

  renderFormatSection () {
    if (!this.formatEl) return
    this.formatEl.empty()
    if (this.plugin.settings.format?.enabled === false) {
      this.syncProModulesVisibility()
      return
    }
    // Free 也可预览核心规则；完整规则与写回仍需 Pro
    const host = this.openModuleHost(this.formatEl, 'format', this.tr('formatHeroTitle'))
    const report = this.plugin.settings.lastFormatReport
    const hero = host.createDiv({ cls: 'ima-format-hero ima-govern-hero' })

    hero.createDiv({
      cls: 'ima-muted ima-compact ima-format-lead',
      text: this.tr('formatOneClickDesc')
    })

    const activeIds = resolveActiveRuleIds(this.plugin.settings, {})
    const meta = hero.createDiv({ cls: 'ima-format-rules-meta ima-compact' })
    meta.createSpan({
      cls: 'ima-format-rules-count',
      text: this.tr('formatActiveRules', { n: activeIds.length })
    })
    if (!canUseFormatFull(this.plugin.settings) && PRO_RULE_IDS.length) {
      meta.createSpan({
        cls: 'ima-muted ima-format-rules-pro',
        text: this.tr('formatActiveRulesPro', { n: PRO_RULE_IDS.length })
      })
    }

    const chips = hero.createDiv({ cls: 'ima-format-rule-chips' })
    const showIds = activeIds.filter((id) => !['NORMALIZE_EOL', 'TRIM_TRAILING_SPACE'].includes(id))
    const shownIds = showIds.slice(0, 8)
    for (const label of formatRuleLabels(shownIds, (k) => this.tr(k))) {
      chips.createSpan({ cls: 'ima-format-rule-chip', text: label })
    }
    if (showIds.length > shownIds.length) {
      chips.createSpan({
        cls: 'ima-format-rule-chip ima-format-rule-chip--more',
        text: `+${showIds.length - shownIds.length}`
      })
    }

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
    const oneClick = row.createEl('button', {
      text: this.tr('formatOneClick'),
      cls: 'mod-cta ima-btn-format'
    })
    oneClick.addEventListener('click', () => { void this.plugin.previewFormatCurrentNote() })
    if (canUseFormatFull(this.plugin.settings)) {
      row.createEl('button', { text: this.tr('formatReportExport'), cls: 'ima-btn-secondary' })
        .addEventListener('click', () => { void this.plugin.exportLastFormatReport() })
    }
    this.syncProModulesVisibility()
  }

  renderEnrichSection () {
    if (!this.enrichEl) return
    this.enrichEl.empty()
    if (this.plugin.settings.enrich?.enabled === false) {
      this.syncProModulesVisibility()
      return
    }
    const proEnrich = canUseEnrich(this.plugin.settings)
    const host = this.openModuleHost(this.enrichEl, 'enrich', this.tr('enrichHeroTitle'))
    const report = this.plugin.settings.lastEnrichReport
    const hero = host.createDiv({ cls: 'ima-enrich-hero ima-govern-hero' })
    hero.createDiv({
      cls: 'ima-muted ima-compact ima-enrich-lead',
      text: this.tr('enrichOneClickDesc')
    })
    const counts = report?.counts
    if (counts?.total) {
      hero.createDiv({
        cls: 'ima-govern-summary ima-compact',
        text: this.tr('enrichHeroSummary', {
          enriched: counts.enriched || 0,
          degraded: counts.degraded || 0,
          failed: counts.failed || 0,
          skipped: counts.skipped || 0
        })
      })
    } else {
      hero.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('enrichReportNone') })
    }
    if (proEnrich) {
      const onPush = this.plugin.settings.enrich?.onPush === true
      hero.createDiv({
        cls: 'ima-muted ima-compact',
        text: onPush ? this.tr('enrichOnPushOn') : this.tr('enrichOnPushOff')
      })
    }
    const row = hero.createDiv({ cls: 'ima-row ima-trust-actions' })
    row.createEl('button', { text: this.tr('enrichPreview'), cls: 'mod-cta ima-btn-secondary' })
      .addEventListener('click', () => { void this.plugin.previewEnrichCurrentNote() })
    if (proEnrich) {
      row.createEl('button', { text: this.tr('enrichReportExport'), cls: 'ima-btn-secondary' })
        .addEventListener('click', () => { void this.plugin.exportLastEnrichReport() })
    }
    this.syncProModulesVisibility()
  }

  renderRequestStats () {
    if (!this.requestStatsEl) return
    const stats = this.plugin.settings.requestStats
    const today = new Date().toISOString().slice(0, 10)
    const count = stats?.date === today ? (stats.count || 0) : 0
    this.requestStatsEl.setText(this.tr('todayRequests', { n: count }))
  }

  /** 侧栏下拉仅显示名称，不附带括号内的知识库编码 */
  kbDropdownLabel (kb) {
    const label = String(kb?.label || '').trim()
    return label || kb?.id || ''
  }

  bindKbSelectorChange (select) {
    select.addEventListener('change', () => {
      if (!select.value) {
        const prev = this.plugin.getActiveKbId() || ''
        if (prev) select.value = prev
        this.plugin.openSettings('kb')
        return
      }
      this.plugin.settings.activeKbId = select.value
      void this.plugin.saveSettings()
    })
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
        text: this.kbDropdownLabel(kb)
      })
      if (kb.id === active) opt.selected = true
    }
    this.bindKbSelectorChange(select)
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
        text: this.kbDropdownLabel(kb)
      })
      if (kb.id === active) opt.selected = true
    }
    this.bindKbSelectorChange(select)
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
    else if (summary.syncLimit === 'auth') parts.push(this.tr('trustAuthFailed'))
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
    }, 120)
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
      const fm = normalizeFrontmatter(this.app.metadataCache.getFileCache(files[i])?.frontmatter)
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

  /** @param {{ total?: number, pending?: number, failed?: number } | null} [stats] */
  updateStatsFoldChrome (stats) {
    const open = !!this._statsFoldEl?.open
    const chevron = this._statsFoldEl?.querySelector('.ima-stats-fold-chevron')
    if (chevron) chevron.setText(open ? '▾' : '▸')
    if (this._statsFoldHintEl) {
      this._statsFoldHintEl.setText(this.tr(open ? 'statsCollapseHint' : 'statsExpandHint'))
    }
    const title = this._statsFoldEl?.querySelector('.ima-stats-fold-title-long')
    if (title) title.setText(this.tr('statsExpand'))
    const titleShort = this._statsFoldEl?.querySelector('.ima-stats-fold-title-short')
    if (titleShort) titleShort.setText(this.tr('statsExpandShort'))

    if (!this._statsFoldBadgesEl) return
    this._statsFoldBadgesEl.empty()
    const folders = this.plugin.getSyncScopeFolders()
    const data = stats || this.getDisplayStats(folders)
    if (!data) return
    const total = Number(data.total) || 0
    const pending = Number(data.pending) || 0
    const failed = Number(data.failed) || 0
    const badgeN = this._statsFoldBadgesEl.createSpan({
      cls: 'ima-stats-fold-badge ima-stats-fold-badge--notes'
    })
    badgeN.createSpan({ cls: 'ima-stats-fold-badge-tag', text: this.tr('statsFoldNotesTag') })
    badgeN.createSpan({ cls: 'ima-stats-fold-badge-num', text: `${total}` })
    badgeN.setAttr('title', this.tr('notes'))
    if (pending > 0) {
      const badgeP = this._statsFoldBadgesEl.createSpan({
        cls: 'ima-stats-fold-badge ima-stats-fold-badge--hot ima-stats-fold-badge--click',
        text: this.tr('statusPulsePending', { n: pending })
      })
      badgeP.setAttr('title', this.tr('statPending'))
      badgeP.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.openStatDetail('statPending')
      })
    }
    if (failed > 0) {
      const badgeF = this._statsFoldBadgesEl.createSpan({
        cls: 'ima-stats-fold-badge ima-stats-fold-badge--bad ima-stats-fold-badge--click',
        text: this.tr('statusPulseFailed', { n: failed })
      })
      badgeF.setAttr(
        'title',
        canUseTrust(this.plugin.settings) ? this.tr('fqBadgeDeepLink') : this.tr('statFailed')
      )
      badgeF.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (canUseTrust(this.plugin.settings)) {
          this.plugin.openFailureQueue('push')
        } else {
          this.openStatDetail('statFailed')
        }
      })
    }
    this.renderHealthFoldBadge()
  }

  /** 折叠头：库体检总分徽章（Free/Pro 均可见） */
  renderHealthFoldBadge () {
    if (!this._statsFoldBadgesEl) return
    this._statsFoldBadgesEl.querySelector('.ima-stats-fold-badge--health')?.remove()
    const health = this.plugin.settings.lastHealthReport
    if (!health || !Number.isFinite(Number(health.score))) return
    const gradeKey = {
      excellent: 'healthGradeExcellent',
      good: 'healthGradeGood',
      needs_work: 'healthGradeNeedsWork'
    }[health.grade] || 'healthGradeNeedsWork'
    const grade = this.tr(gradeKey)
    const badge = this._statsFoldBadgesEl.createSpan({
      cls: `ima-stats-fold-badge ima-stats-fold-badge--health ima-stats-fold-badge--health-${health.grade} ima-stats-fold-badge--click`,
      text: this.tr('healthFoldBadge', { score: health.score, grade })
    })
    badge.setAttr('title', this.tr('healthFoldBadgeTitle'))
    badge.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (this._statsFoldEl && !this._statsFoldEl.open) {
        this._statsFoldEl.open = true
        this._statsOpen = true
        this.updateStatsFoldChrome()
      }
      this._healthStatsEl?.scrollIntoView?.({ block: 'nearest' })
    })
  }

  /** 同步定时间隔：挂在「已连接」行尾（激活态之后） */
  renderStatusAutoInterval () {
    if (!this.statusLineEl) return
    const trail = this.ensureStatusLineTrail()
    if (!trail) return
    trail.querySelector('.ima-auto-sync-inline')?.remove()
    const autoRow = trail.createDiv({ cls: 'ima-auto-sync-inline' })
    autoRow.createSpan({ cls: 'ima-auto-sync-label ima-label-long', text: this.tr('autoSyncPanelLabel') })
    autoRow.createSpan({ cls: 'ima-auto-sync-label ima-label-short', text: this.tr('autoSyncPanelLabelShort') })
    const autoInput = autoRow.createEl('input', {
      type: 'number',
      cls: 'ima-auto-sync-input',
      attr: { min: '0', step: '1' }
    })
    autoInput.value = String(this.plugin.settings.autoSyncMinutes)
    autoInput.addEventListener('change', async () => {
      const n = parseInt(autoInput.value, 10)
      this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n >= 0 ? n : 0
      await this.plugin.saveSettings()
      this.plugin.resetAutoSyncTimer()
      await this.refresh({ soft: true, stats: false, note: false, actions: true })
      this.renderStatusAutoInterval()
    })
    attachHoverTip(autoRow, this.plugin.settings, 'autoSyncMinutes', this.tipDeps())
    attachHoverTip(autoInput, this.plugin.settings, 'autoSyncMinutes', this.tipDeps())
    if (this.plugin.settings.autoSyncMinutes > 0 && this.plugin.settings.autoSyncPaused) {
      autoRow.createSpan({ cls: 'ima-auto-sync-paused', text: this.tr('statusAutoSyncPaused') })
    } else if (this.plugin.settings.autoSyncMinutes === 0 && this.plugin.settings.syncOnSave) {
      autoRow.createSpan({ cls: 'ima-auto-sync-hint', text: this.tr('syncOnSaveActiveHint') })
    }
  }

  /** @param {HTMLElement} [wrap] @param {number} [failedCount] */
  renderResetFailedAction (wrap, failedCount) {
    const host = wrap || this._resetFailedEl
    if (!host) return
    host.empty()
    const folders = this.plugin.getSyncScopeFolders()
    const failed = failedCount != null
      ? Number(failedCount) || 0
      : (Number(this.getDisplayStats(folders)?.failed) || 0)
    if (failed < 20) return
    host.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('resetSystemicFailedHint')
    })
    host.createEl('button', {
      text: this.tr('resetSystemicFailed'),
      cls: 'ima-btn-secondary ima-btn-compact'
    }).addEventListener('click', () => { void this.plugin.resetSystemicFailedMarks() })
  }

  /** @param {HTMLElement} wrap @param {{ total: number, synced: number, pending: number, failed: number, conflict: number }} stats */
  renderStatsBlock (wrap, stats) {
    this.updateStatsFoldChrome(stats)
    this.renderResetFailedAction(undefined, stats.failed)
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
      this.renderHealthStatsSummary(wrap)
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
    this.renderHealthStatsSummary(wrap)
  }

  /**
   * 「同步统计与高级」内库体检摘要：Free 仅总分+等级；Pro 另显最差分项。
   * @param {HTMLElement} wrap
   */
  renderHealthStatsSummary (wrap) {
    if (!wrap) return
    let host = wrap.querySelector('.ima-health-stats')
    if (!host) {
      host = wrap.createDiv({ cls: 'ima-health-stats' })
      const privacy = wrap.querySelector('.ima-stat-privacy')
      if (privacy) wrap.insertBefore(host, privacy)
    } else {
      host.empty()
    }
    this._healthStatsEl = host

    const pro = canUseGovern(this.plugin.settings)
    const health = this.plugin.settings.lastHealthReport
    const head = host.createDiv({ cls: 'ima-health-stats-head' })
    head.createSpan({ cls: 'ima-health-stats-label', text: this.tr('healthStatsActions') })

    if (health && Number.isFinite(Number(health.score))) {
      const gradeKey = {
        excellent: 'healthGradeExcellent',
        good: 'healthGradeGood',
        needs_work: 'healthGradeNeedsWork'
      }[health.grade] || 'healthGradeNeedsWork'
      const scoreRow = host.createDiv({ cls: 'ima-health-stats-score-row' })
      scoreRow.createSpan({
        cls: `ima-health-score ima-health-score--compact ima-health-score--${health.grade}`,
        text: String(health.score)
      })
      scoreRow.createSpan({
        cls: 'ima-health-grade',
        text: this.tr(gradeKey)
      })
      if (health.scoredAt) {
        scoreRow.createSpan({
          cls: 'ima-muted ima-compact',
          text: this.tr('healthLastAt', {
            time: String(health.scoredAt || '').replace('T', ' ').slice(0, 16)
          })
        })
      }
      if (pro) {
        const dimLabels = {
          pending: 'healthDimPending',
          duplicateTitle: 'healthDimDuplicate',
          bodyTooShort: 'healthDimShortBody',
          urlOnly: 'healthDimUrlOnly'
        }
        const worst = (health.worst || []).slice(0, 2)
        if (worst.length) {
          const worstRow = host.createDiv({ cls: 'ima-health-worst ima-compact' })
          worstRow.createSpan({ text: `${this.tr('healthWorst')}: ` })
          for (const d of worst) {
            const label = this.tr(dimLabels[d.key] || 'healthDimPending')
            const chip = worstRow.createSpan({
              cls: 'ima-health-worst-chip ima-health-dim-chip--click',
              text: label
            })
            chip.setAttr('title', this.tr('healthDimClickHint'))
            chip.addEventListener('click', () => {
              new HealthDimFolderModal(this.app, this.plugin, d.key, health).open()
            })
          }
        }
      } else {
        host.createDiv({
          cls: 'ima-muted ima-compact',
          text: this.tr('healthStatsLiteHint')
        })
      }
    } else {
      host.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('governReportNone')
      })
    }

    const row = host.createDiv({ cls: 'ima-row ima-health-stats-actions' })
    row.createEl('button', { text: this.tr('healthRefresh'), cls: 'ima-btn-secondary ima-btn-compact' })
      .addEventListener('click', () => { void this.plugin.auditSyncFolder() })
    row.createEl('button', { text: this.tr('healthWeeklyExport'), cls: 'ima-btn-secondary ima-btn-compact' })
      .addEventListener('click', () => { void this.plugin.exportWeeklyHealthReport() })
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
    const slot = this.noticeSlotEl
    if (!slot) return
    slot.empty()
    this.remoteNoticeEl = null

    const notices = activeNotices(this.plugin.settings, this.plugin.manifest.version)
    if (!notices.length) return

    const wrap = slot.createDiv({ cls: 'ima-remote-notices' })
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
    this.renderEnrichSection()
    void this.renderCurrentNote(true)
    const logTitle = this.logEl?.querySelector('.ima-log-title')
    if (logTitle) logTitle.setText(this.tr('log'))
    const logEmpty = this.logEl?.querySelector('.ima-log-empty')
    if (logEmpty) logEmpty.setText(this.tr('logEmpty'))
  }

  updateStatBlockLocale () {
    this.updateStatsFoldChrome()
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

    this.renderStatusLicenseInline()
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
      this.renderEnrichSection()
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

      this.renderStatusLineTrail()
      this.renderKbSelector()

      const folders = this.plugin.getSyncScopeFolders()
      const folderRow = this.statusEl.createDiv({ cls: 'ima-muted ima-compact ima-folder-row' })
      folderRow.createSpan({
        text: folders.length
          ? `${this.tr('syncFolders')}: ${folders.join(', ')}`
          : this.tr('syncFoldersAll')
      })
      attachTip(folderRow, this.plugin.settings, 'syncFolders', this.tipDeps())

      const details = this.statusEl.createEl('details', { cls: 'ima-stats-fold' })
      details.open = !!this._statsOpen
      details.addEventListener('toggle', () => {
        this._statsOpen = details.open
        this.updateStatsFoldChrome()
      })
      const summary = details.createEl('summary', { cls: 'ima-stats-fold-summary' })
      const sumMain = summary.createDiv({ cls: 'ima-stats-fold-summary-main' })
      sumMain.createSpan({ cls: 'ima-stats-fold-chevron', text: '▸' })
      const sumText = sumMain.createDiv({ cls: 'ima-stats-fold-text' })
      sumText.createSpan({ cls: 'ima-stats-fold-title ima-stats-fold-title-long', text: this.tr('statsExpand') })
      sumText.createSpan({ cls: 'ima-stats-fold-title ima-stats-fold-title-short', text: this.tr('statsExpandShort') })
      this._statsFoldHintEl = sumText.createSpan({
        cls: 'ima-stats-fold-hint',
        text: this.tr(details.open ? 'statsCollapseHint' : 'statsExpandHint')
      })
      this._statsFoldBadgesEl = summary.createDiv({ cls: 'ima-stats-fold-badges' })
      const foldBody = details.createDiv({ cls: 'ima-stats-fold-body' })
      this._statsFoldEl = details
      this.updateStatsFoldChrome()

      const statsHead = foldBody.createDiv({ cls: 'ima-stats-head' })
      statsHead.createSpan({ cls: 'ima-stats-label', text: this.tr('statPanelLabel') })
      attachTip(statsHead, this.plugin.settings, 'stats', this.tipDeps())
      this.statsWrapEl = foldBody.createDiv({ cls: 'ima-stats' })
      this._statEls = null
      if (!skipStats) {
        const cached = this.getDisplayStats(folders)
        if (cached) this.renderStatsBlock(this.statsWrapEl, cached)
        else this.statsWrapEl.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('statsPending') })
      }

      const reqRow = foldBody.createDiv({ cls: 'ima-request-row' })
      this.requestStatsEl = reqRow.createDiv({ cls: 'ima-muted ima-compact ima-request-stats' })
      attachTip(reqRow, this.plugin.settings, 'todayRequests', this.tipDeps())
      this.renderRequestStats()

      const failHint = foldBody.createDiv({ cls: 'ima-reset-failed-row' })
      this._resetFailedEl = failHint
      this.renderResetFailedAction(failHint)

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
    let rebuilt = false
    if (!dot || !msgEl) {
      const keepTrail = this.statusLineEl.querySelector('.ima-status-line-trail')
      this.statusLineEl.empty()
      dot = this.statusLineEl.createSpan({ cls: 'ima-dot' })
      msgEl = this.statusLineEl.createSpan({ cls: 'ima-status-msg' })
      if (keepTrail) this.statusLineEl.appendChild(keepTrail)
      rebuilt = true
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
    if (
      rebuilt ||
      !this.statusLineEl.querySelector('.ima-status-license-inline') ||
      !this.statusLineEl.querySelector('.ima-auto-sync-inline')
    ) {
      this.renderStatusLineTrail()
    }
  }

  async renderCurrentNote (force = false) {
    const file = this.resolveWorkingMarkdownFile()
    if (!file || file.extension !== 'md') {
      const emptyKey = '|none|'
      if (!force && emptyKey === this._lastNotePath && this.noteEl?.querySelector('.ima-empty')) return
      this._lastNotePath = emptyKey
      this.noteEl.empty()
      const noteHead = this.noteEl.createDiv({ cls: 'ima-note-head' })
      noteHead.createEl('h3', { text: this.tr('currentNote') })
      this.noteEl.createDiv({ cls: 'ima-empty', text: this.tr('openMdNote') })
      const noteActions = this.noteEl.createDiv({ cls: 'ima-row ima-note-actions' })
      this.appendPanelMeta(noteActions)
      return
    }

    const cache = this.app.metadataCache.getFileCache(file)
    const fm = normalizeFrontmatter(cache?.frontmatter || {})
    const noteKey = `${file.path}|${fm.sync?.ima || 'none'}|${fm.sync?.ima_verify || ''}|${fm.ima_sync_at || ''}`
    if (!force && noteKey === this._lastNotePath && this.noteEl?.querySelector('.ima-title')) return
    this._lastNotePath = noteKey
    this.noteEl.empty()
    const noteHead = this.noteEl.createDiv({ cls: 'ima-note-head' })
    noteHead.createEl('h3', { text: this.tr('currentNote') })

    const inScope = isUnderSyncFolders(file.path, this.plugin.getSyncScopeFolders())

    this.noteEl.createDiv({ cls: 'ima-title', text: fm.title || file.basename })
    this.noteEl.createDiv({ cls: 'ima-muted ima-compact ima-note-path', text: file.path })

    const syncVal = fm.sync?.ima || 'none'
    const syncLabelKeys = {
      synced: 'statSynced',
      pending: 'statPending',
      failed: 'statFailed',
      conflict: 'statConflict',
      none: 'noteSyncNone'
    }
    const syncMeta = this.noteEl.createDiv({ cls: 'ima-note-sync-meta' })
    const badge = syncMeta.createDiv({ cls: 'ima-compact ima-badge-row' })
    badge.createSpan({
      cls: `ima-badge sync-${syncVal}`,
      text: this.tr(syncLabelKeys[syncVal] || 'noteSyncNone')
    })
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
    if (fm.ima_sync_at) {
      const atDisp = String(fm.ima_sync_at).replace('T', ' ').replace(/\.\d{3}Z$/, '').slice(0, 19)
      syncMeta.createDiv({
        cls: 'ima-note-sync-at',
        text: `${this.tr('lastSync')}: ${atDisp}`
      })
    }

    if (!inScope) {
      const scopeRow = this.noteEl.createDiv({ cls: 'ima-warn ima-compact ima-warn-row' })
      scopeRow.createSpan({ text: this.tr('outOfScope') })
      attachTip(scopeRow, this.plugin.settings, 'outOfScope', this.tipDeps())
    }
    if (vKey === 'failed' && fm.ima_verify_detail) {
      this.noteEl.createDiv({
        cls: 'ima-warn ima-compact ima-trust-note-detail',
        text: formatVerifyDetail(this.tr.bind(this), fm.ima_verify_detail)
      })
    }

    // 当前文档：仅状态；同步/排版主按钮在 sticky 日常区（定稿勿重复）
    // 左：验证本篇（条件）· 右：版权 · 版本 · QQ（精简，原底栏迁入）
    const noteActions = this.noteEl.createDiv({ cls: 'ima-row ima-note-actions' })
    if (canUseTrust(this.plugin.settings) && syncVal === 'synced') {
      const btn = noteActions.createEl('button', {
        text: this.tr('trustVerifyCurrent'),
        cls: 'ima-btn-secondary ima-btn-compact'
      })
      bindPressFeedback(btn)
      bindSnappyClick(btn, () => { void this.plugin.verifyCurrentNote() })
    }
    this.appendPanelMeta(noteActions)
  }

  /** 侧栏是否开启了某种后台自动推送（保存时或定时） */
  hasBackgroundSync () {
    const s = this.plugin.settings
    return !!(s.syncOnSave || (s.autoSyncMinutes > 0))
  }

  /** 聚焦侧栏知识库下拉；无则打开设置 */
  focusKbSelect () {
    const sel = this.statusEl?.querySelector('.ima-kb-dropdown')
    if (sel) {
      sel.focus()
      sel.classList.add('ima-kb-dropdown--flash')
      window.setTimeout(() => sel.classList.remove('ima-kb-dropdown--flash'), 1600)
      return
    }
    this.plugin.openSettings()
  }

  hasActiveKb () {
    return !!this.plugin.getActiveKbId()
  }

  renderActions () {
    this._syncProgressPathEl = null
    this.actionsEl.empty()
    this.renderProAdStripAboveActions()
    const sticky = this.actionsEl.createDiv({ cls: 'ima-actions-sticky' })
    const actionHead = sticky.createDiv({ cls: 'ima-action-head' })
    actionHead.createEl('h3', { text: this.tr('actions') })
    const tip = this.tipDeps()
    const syncing = this.plugin.syncing
    const paused = !!this.plugin.syncControl?.paused
    const hasKb = this.hasActiveKb()
    const active = this.resolveWorkingMarkdownFile()
    const hasMd = !!(active && active.extension === 'md')

    if (syncing) {
      actionHead.createDiv({
        cls: 'ima-sync-hint ima-sync-hint--live',
        text: this.tr('syncingHint')
      })
      const progress = sticky.createDiv({ cls: 'ima-sync-progress' })
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
      const ctrl = sticky.createDiv({ cls: 'ima-row ima-sync-ctrl-live' })
      addButtonWithTip(
        ctrl,
        this.plugin.settings,
        'syncPause',
        paused ? this.tr('syncResume') : this.tr('syncPause'),
        paused ? 'mod-cta' : 'ima-btn-secondary',
        () => { void this.togglePauseSync() },
        tip,
        paused ? this.tr('syncResumeShort') : this.tr('syncPauseShort')
      )
      addButtonWithTip(
        ctrl,
        this.plugin.settings,
        'syncStop',
        this.tr('syncStop'),
        'ima-btn-stop',
        () => {
          this.plugin.syncControl.requestStop()
          this.appendLog(this.tr('syncStopped'))
        },
        tip,
        this.tr('syncStopShort')
      )
      return
    }

    if (!hasKb) {
      actionHead.createDiv({ cls: 'ima-warn ima-compact', text: this.tr('kbNone') })
      const ctrl = sticky.createDiv({ cls: 'ima-sync-ctrl ima-sync-ctrl-main' })
      addButtonWithTip(
        ctrl,
        this.plugin.settings,
        'kbSelect',
        this.tr('kbSelectCta'),
        'mod-cta ima-btn-sync-current',
        () => this.focusKbSelect(),
        tip,
        this.tr('kbSelectCtaShort')
      )
      return
    }

    actionHead.createDiv({ cls: 'ima-sync-hint', text: this.tr('syncModeHint') })

    const primary = sticky.createDiv({ cls: 'ima-sync-zone ima-sync-zone-primary' })
    const zoneHead = primary.createDiv({ cls: 'ima-sync-zone-head' })
    zoneHead.createDiv({ cls: 'ima-sync-zone-label', text: this.tr('zonePrimary') })
    if (!isProActive(this.plugin.settings)) {
      zoneHead.createSpan({ cls: 'ima-free-pill', text: this.tr('freeIncluded') })
    }
    const currentBtn = addButtonWithTip(
      primary,
      this.plugin.settings,
      'syncCurrent',
      this.tr('syncCurrent'),
      hasMd ? 'ima-btn-accent ima-btn-sync-current' : 'ima-btn-secondary ima-btn-sync-current',
      () => { void this.syncCurrentNote() },
      tip,
      this.tr('syncCurrentShort')
    )
    if (!hasMd) {
      currentBtn.setAttr('disabled', 'true')
      primary.createDiv({ cls: 'ima-muted ima-compact', text: this.tr('openMdNote') })
    } else if (active) {
      primary.createDiv({
        cls: 'ima-muted ima-compact ima-sync-target',
        text: this.tr('syncCurrentTarget', { name: active.basename }),
        attr: { title: active.path }
      })
    }
    if (!isProActive(this.plugin.settings)) {
      primary.createDiv({
        cls: 'ima-muted ima-compact ima-free-sync-hint',
        text: this.tr('syncCurrentFreeHint')
      })
    }
    if (this.plugin.settings.format?.enabled !== false || this.plugin.settings.enrich?.enabled !== false) {
      const tools = primary.createDiv({ cls: 'ima-dual-tools' })
      const formatOn = this.plugin.settings.format?.enabled !== false
      const enrichOn = this.plugin.settings.enrich?.enabled !== false

      if (formatOn) {
        const formatMax = formatPreviewPerDayMax(this.plugin.settings)
        const formatRem = remainingFormatPreview(this.plugin.settings)
        const formatExhausted = formatMax > 0 && formatRem <= 0
        // 与「同步当前」同级全宽 accent（勿半宽挤掉视觉）
        const formatBtn = addButtonWithTip(
          tools,
          this.plugin.settings,
          'formatOneClick',
          this.tr('formatOneClick'),
          hasMd && !formatExhausted
            ? 'ima-btn-accent ima-btn-format ima-btn-tool-primary'
            : 'ima-btn-secondary ima-btn-format ima-btn-tool-primary',
          () => {
            this.ensureModuleOpenState().format = true
            this.renderFormatSection()
            void this.plugin.previewFormatCurrentNote()
          },
          tip,
          this.tr('formatOneClickShort')
        )
        if (!hasMd || formatExhausted) formatBtn.setAttr('disabled', 'true')
      }

      if (enrichOn) {
        const enrichMax = enrichParsePerDayMax(this.plugin.settings)
        const enrichRem = remainingEnrichParse(this.plugin.settings)
        const enrichExhausted = enrichMax > 0 && enrichRem <= 0
        // 链接解析次要描边，突出一键排版
        const enrichBtn = addButtonWithTip(
          tools,
          this.plugin.settings,
          'enrichOneClick',
          this.tr('enrichOneClick'),
          'ima-btn-secondary ima-btn-enrich ima-btn-tool-secondary',
          () => {
            this.ensureModuleOpenState().enrich = true
            this.renderEnrichSection()
            void this.plugin.previewEnrichCurrentNote()
          },
          tip,
          this.tr('enrichOneClickShort')
        )
        if (!hasMd || enrichExhausted) enrichBtn.setAttr('disabled', 'true')
      }

      const formatMax = formatOn ? formatPreviewPerDayMax(this.plugin.settings) : 0
      const formatRem = formatOn ? remainingFormatPreview(this.plugin.settings) : 0
      const enrichMax = enrichOn ? enrichParsePerDayMax(this.plugin.settings) : 0
      const enrichRem = enrichOn ? remainingEnrichParse(this.plugin.settings) : 0
      if (formatMax > 0 || enrichMax > 0) {
        const anyExhausted = (formatMax > 0 && formatRem <= 0) || (enrichMax > 0 && enrichRem <= 0)
        const quotaRow = primary.createDiv({
          cls: anyExhausted ? 'ima-warn ima-compact ima-dual-quota' : 'ima-muted ima-compact ima-dual-quota'
        })
        /** @param {string} label @param {string} section @param {boolean} exhausted */
        const appendQuotaBit = (label, section, exhausted) => {
          if (quotaRow.childElementCount) {
            quotaRow.createSpan({ cls: 'ima-dual-quota-sep', text: ' · ' })
          }
          quotaRow.createSpan({ text: label })
          quotaRow.createSpan({ text: ' ' })
          const link = quotaRow.createEl('a', {
            cls: 'ima-quota-pro-link',
            text: exhausted ? this.tr('quotaProUpgradeLink') : this.tr('quotaProUnlimitedLink'),
            href: '#'
          })
          link.setAttr('title', this.tr('quotaProLinkTip'))
          link.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            this.plugin.openSettings(section)
          })
        }
        if (formatMax > 0) {
          appendQuotaBit(
            formatRem <= 0
              ? this.tr('formatQuotaExhaustedShort', { max: formatMax })
              : this.tr('formatQuotaRemainShort', { remaining: formatRem, max: formatMax }),
            'format',
            formatRem <= 0
          )
        }
        if (enrichMax > 0) {
          appendQuotaBit(
            enrichRem <= 0
              ? this.tr('enrichQuotaExhaustedShort', { max: enrichMax })
              : this.tr('enrichQuotaRemainShort', { remaining: enrichRem, max: enrichMax }),
            'enrich',
            enrichRem <= 0
          )
        }
      }
    }

    const rest = this.actionsEl.createDiv({ cls: 'ima-actions-rest' })
    const batch = rest.createDiv({ cls: 'ima-sync-zone ima-sync-zone-batch' })
    batch.createDiv({ cls: 'ima-sync-zone-label', text: this.tr('zoneBatch') })
    const batchMax = batchNotesPerDayMax(this.plugin.settings)
    if (batchMax > 0) {
      const rem = remainingBatchNotes(this.plugin.settings)
      const remainText = this.tr('batchQuotaRemain', {
        remaining: rem === Infinity ? batchMax : rem,
        max: batchMax
      })
      batch.createDiv({
        cls: rem > 0 ? 'ima-muted ima-compact ima-batch-quota' : 'ima-warn ima-compact ima-batch-quota',
        text: `${remainText} · ${this.tr('batchQuotaHint')}`
      })
    } else if (isProActive(this.plugin.settings)) {
      batch.createDiv({
        cls: 'ima-muted ima-compact ima-batch-quota',
        text: this.tr('batchQuotaUnlimited')
      })
    } else {
      batch.createDiv({ cls: 'ima-muted ima-compact ima-sync-zone-desc', text: this.tr('zoneBatchDesc') })
    }
    const batchBlocked = batchMax > 0 && remainingBatchNotes(this.plugin.settings) <= 0
    const batchRow = batch.createDiv({ cls: 'ima-row ima-sync-ctrl-sub' })
    const pushBtn = addButtonWithTip(
      batchRow,
      this.plugin.settings,
      'syncPush',
      this.tr('syncPush'),
      'ima-btn-secondary',
      () => { void this.runSync('push', 'pushDone') },
      tip,
      this.tr('syncPushShort')
    )
    const folderBtn = addButtonWithTip(
      batchRow,
      this.plugin.settings,
      'syncFolder',
      this.tr('syncFolder'),
      'ima-btn-secondary',
      () => this.pickFolderToSync(),
      tip,
      this.tr('syncFolderShort')
    )
    if (batchBlocked) {
      pushBtn.setAttr('disabled', 'true')
      folderBtn.setAttr('disabled', 'true')
    }

    const more = rest.createDiv({ cls: 'ima-actions-more' })

    if (hasMd) {
      const curFolderBtn = addButtonWithTip(
        more,
        this.plugin.settings,
        'syncCurrentFolder',
        this.tr('syncCurrentFolder'),
        'ima-btn-secondary',
        () => { void this.syncCurrentFolder() },
        tip,
        this.tr('syncCurrentFolderShort')
      )
      if (batchBlocked) curFolderBtn.setAttr('disabled', 'true')
    }

    if (this.hasBackgroundSync()) {
      addButtonWithTip(
        more,
        this.plugin.settings,
        'autoSyncPaused',
        this.plugin.settings.autoSyncPaused ? this.tr('syncResumeAuto') : this.tr('syncPauseAuto'),
        this.plugin.settings.autoSyncPaused ? 'mod-cta' : 'ima-btn-secondary',
        () => { void this.togglePauseSync() },
        tip,
        this.plugin.settings.autoSyncPaused ? this.tr('syncResumeAutoShort') : this.tr('syncPauseAutoShort')
      )
    }

    if (EXPERIMENTAL_UI && this.plugin.settings.showExperimental) {
      this.renderExperimentalActions(more)
    }

    const fbWrap = more.createDiv({ cls: 'ima-btn-with-tip' })
    const feedbackBtn = fbWrap.createEl('button', {
      text: this.tr('feedbackBtn'),
      cls: 'ima-btn-secondary ima-btn-feedback',
      attr: { type: 'button' }
    })
    bindPressFeedback(feedbackBtn)
    bindSnappyClick(feedbackBtn, (e) => {
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
    return this.plugin.settings.autoSyncPaused ? this.tr('syncResumeAuto') : this.tr('syncPauseAuto')
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
    // 先改 UI，再落盘——避免点「暂停自动同步」等 saveSettings 才有反馈
    this.renderActions()
    this.renderSyncPauseBanner()
    this.applyStatusLocale()
    new Notice(
      this.plugin.settings.autoSyncPaused
        ? this.tr('statusAutoSyncPaused')
        : (this.plugin.settings.autoSyncMinutes > 0
            ? this.tr('autoSyncEvery', { n: this.plugin.settings.autoSyncMinutes })
            : this.tr('syncResumeAuto')),
      3000
    )
    await this.plugin.saveSettings({ actions: false })
  }

  async syncCurrentNote () {
    if (!this.plugin.getActiveKbId()) {
      new Notice(this.tr('kbNone'))
      return
    }
    const file = this.resolveWorkingMarkdownFile()
    if (!file || file.extension !== 'md') {
      new Notice(this.tr('openNoteFirst'))
      return
    }
    if (this.plugin.syncing) {
      new Notice(this.tr('syncing'))
      return
    }
    // 同步当前文档：不计入免费批量日额度，始终放行（IMA 限频仍单独处理）
    this.plugin.beginSyncRun({ progress: file.path, batch: false })
    try {
      await yieldToUi()
      const engine = this.getEngine()
      const r = await engine.pushNote(file, false)
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

  countMdUnderFolder (folderPath) {
    const prefix = folderPath ? `${folderPath.replace(/\\/g, '/').replace(/\/$/, '')}/` : ''
    const scope = this.plugin.getSyncScopeFolders()
    const all = this.app.vault.getMarkdownFiles()
    const inFolder = !prefix
      ? all
      : all.filter(f => f.path === folderPath || f.path.startsWith(prefix))
    return inFolder.filter(f => isUnderSyncFolders(f.path, scope)).length
  }

  /**
   * @param {number} count
   * @returns {Promise<boolean>}
   */
  confirmLargeSync (count) {
    if (count < LARGE_SYNC_CONFIRM_MIN) return Promise.resolve(true)
    return new Promise((resolve) => {
      new SyncBatchConfirmModal(this.app, this.plugin, {
        count,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      }).open()
    })
  }

  pickFolderToSync () {
    new FolderPickerModal(this.app, this.plugin.settings, (folder) => {
      void (async () => {
        const n = this.countMdUnderFolder(folder)
        if (!(await this.confirmLargeSync(n))) return
        await this.runPushFolder(folder)
      })()
    }, { titleKey: 'pickFolderToSync' }).open()
  }

  async syncCurrentFolder () {
    const file = this.resolveWorkingMarkdownFile()
    if (!file || file.extension !== 'md') {
      new Notice(this.tr('openNoteFirst'))
      return
    }
    const folder = file.parent?.path || ''
    if (!(await this.confirmLargeSync(this.countMdUnderFolder(folder)))) return
    await this.runPushFolder(folder)
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
    const planned = this.countMdUnderFolder(folderPath)
    if (!(await this.plugin.guardBatchQuota(planned))) return
    this.plugin.beginSyncRun({
      progress: folderPath || this.tr('vaultRoot'),
      batch: true
    })
    try {
      await yieldToUi()
      const engine = this.getEngine()
      const summary = await engine.pushFolder(folderPath)
      await this.plugin.commitBatchQuotaFromSummary(summary)
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
      this.plugin.storeEnrichReport(summary)
      void this.plugin.onSyncTelemetry(summary)
      this.scheduleStatsRefresh()
      this.renderTrustSection()
      this.renderFormatSection()
      this.renderEnrichSection()
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
    if (direction === 'push' || direction === 'both') {
      const n = (await this.getEngine().listSyncFiles()).length
      if (!(await this.plugin.guardBatchQuota(n))) return
      if (!(await this.confirmLargeSync(n))) return
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
      if (direction === 'push' || direction === 'both') {
        await this.plugin.commitBatchQuotaFromSummary(summary)
      }
      this.plugin.storeTrustReport(summary)
      this.plugin.storeFormatReport(summary)
      this.plugin.storeEnrichReport(summary)
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
      this.renderTrustSection()
      this.renderGovernSection()
      this.renderFormatSection()
      this.renderEnrichSection()
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

class SyncBatchConfirmModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {{ settings: object }} plugin
   * @param {{ count: number, onConfirm: () => void, onCancel: () => void }} opts
   */
  constructor (app, plugin, opts) {
    super(app)
    this.plugin = plugin
    this.count = opts.count
    this.onConfirm = opts.onConfirm
    this.onCancel = opts.onCancel
    this._settled = false
  }

  tr (key, vars) {
    return t(this.plugin.settings, key, vars)
  }

  settle (ok) {
    if (this._settled) return
    this._settled = true
    if (ok) this.onConfirm()
    else this.onCancel()
  }

  onOpen () {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: this.tr('syncBatchConfirmTitle') })
    contentEl.createEl('p', {
      cls: 'ima-muted',
      text: this.tr('syncBatchConfirmBody', { n: this.count })
    })
    const row = contentEl.createDiv({ cls: 'ima-row' })
    row.createEl('button', {
      text: this.tr('syncBatchConfirmOk'),
      cls: 'mod-cta'
    }).addEventListener('click', () => {
      this.settle(true)
      this.close()
    })
    row.createEl('button', {
      text: this.tr('syncBatchConfirmCancel'),
      cls: 'ima-btn-secondary'
    }).addEventListener('click', () => {
      this.settle(false)
      this.close()
    })
  }

  onClose () {
    if (!this._settled) this.settle(false)
    this.contentEl.empty()
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
    /** @type {Record<string, boolean>} 设置页折叠展开态（display 重建后保留） */
    this._settingsFoldOpen = {
      apiKeyExpiry: false,
      trust: false,
      govern: false,
      format: false
    }
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
    const el = containerEl.createEl('h3', { cls: 'ima-settings-section', text: this.lbl(key) })
    el.setAttribute('data-ima-section', key)
    return el
  }

  /**
   * 浅色双色分区容器（A/B 交替）
   * @param {HTMLElement} parent
   * @param {'a'|'b'} tone
   * @param {string} sectionKey
   * @returns {HTMLElement}
   */
  settingsGroup (parent, tone, sectionKey) {
    const group = parent.createDiv({
      cls: `ima-settings-group ima-settings-group--${tone === 'b' ? 'b' : 'a'}`,
      attr: { 'data-ima-group': sectionKey }
    })
    this.section(group, sectionKey)
    return group
  }

  /**
   * 设置页顶部导航（滚动到分区）
   * @param {HTMLElement} containerEl
   * @param {{ key: string, label?: string }[]} items
   */
  renderSettingsNav (containerEl, items) {
    const toolbar = containerEl.createDiv({ cls: 'ima-settings-toolbar' })
    const nav = toolbar.createDiv({ cls: 'ima-settings-nav' })
    for (const item of items) {
      const btn = nav.createEl('button', {
        cls: 'ima-settings-nav-btn',
        text: item.label || this.lbl(item.key),
        attr: { type: 'button', 'data-ima-nav': item.key }
      })
      bindPressFeedback(btn)
      bindSnappyClick(btn, () => {
        nav.querySelectorAll('.ima-settings-nav-btn').forEach((el) => el.removeClass('is-active'))
        btn.addClass('is-active')
        this.scrollToSettingsSection(item.key)
      })
    }
    return toolbar
  }

  /**
   * 打开设置后滚动到指定分区（openSettings 传入的短名或 section* key）
   * @param {string} sectionId
   */
  scrollToSettingsSection (sectionId) {
    if (!sectionId || !this.containerEl) return
    const aliases = {
      pro: 'sectionPro',
      kb: 'sectionKb',
      connection: 'sectionConnection',
      sync: 'sectionSync',
      advanced: 'sectionAdvanced',
      about: 'settingsSectionAbout',
      format: 'sectionPro',
      enrich: 'sectionPro'
    }
    const foldId = sectionId === 'format' || sectionId === 'enrich' ? sectionId : ''
    const key = aliases[sectionId] || sectionId
    const group = this.containerEl.querySelector(`[data-ima-group="${key}"]`)
    const heading = this.containerEl.querySelector(`[data-ima-section="${key}"]`)
    let el = group || heading
    if (foldId) {
      const fold = this.containerEl.querySelector(`[data-ima-fold="${foldId}"]`)
      if (fold) {
        fold.open = true
        this._settingsFoldOpen[foldId] = true
        el = fold
        fold.addClass('ima-settings-fold--flash')
        window.setTimeout(() => fold.removeClass('ima-settings-fold--flash'), 900)
      }
    }
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (group && !foldId) {
      group.addClass('ima-settings-group--flash')
      window.setTimeout(() => group.removeClass('ima-settings-group--flash'), 900)
    }
    const navBtn = this.containerEl.querySelector(`.ima-settings-nav-btn[data-ima-nav="${key}"]`)
    if (navBtn) {
      this.containerEl.querySelectorAll('.ima-settings-nav-btn').forEach((b) => b.removeClass('is-active'))
      navBtn.addClass('is-active')
    }
  }

  /**
   * 设置页折叠块：合并次要项，首屏更短
   * @param {HTMLElement} parent
   * @param {string} foldId
   * @param {string} titleKey i18n key
   * @returns {HTMLElement} body
   */
  settingsFold (parent, foldId, titleKey) {
    const details = parent.createEl('details', {
      cls: 'ima-settings-fold',
      attr: { 'data-ima-fold': foldId }
    })
    if (this._settingsFoldOpen[foldId]) details.open = true
    details.createEl('summary', { text: this.tr(titleKey) })
    const body = details.createDiv({ cls: 'ima-settings-fold-body' })
    details.addEventListener('toggle', () => {
      this._settingsFoldOpen[foldId] = details.open
    })
    return body
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

  /** @param {HTMLElement} el @param {object} s */
  renderProTrustSettings (el, s) {
    if (!s.trust || typeof s.trust !== 'object') s.trust = { ...DEFAULT_SETTINGS.trust }

    new Setting(el)
      .setName(this.lbl('trustVerifyAfterPush'))
      .addToggle(t => t
        .setValue(s.trust.verifyAfterPush !== false)
        .onChange(async (v) => {
          s.trust.verifyAfterPush = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('trustDedupBeforePush'))
      .addToggle(t => t
        .setValue(s.trust.dedupBeforePush !== false)
        .onChange(async (v) => {
          s.trust.dedupBeforePush = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('trustVerifyDelayMs'))
      .setDesc(this.tr('trustVerifyDelayMs'))
      .addText(t => t
        .setValue(String(s.trust.verifyDelayMs ?? 2000))
        .onChange(async (v) => {
          const n = parseInt(v, 10)
          s.trust.verifyDelayMs = Number.isFinite(n) && n >= 0 ? n : 2000
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('trustVerifyRetries'))
      .addText(t => t
        .setValue(String(s.trust.verifyRetries ?? 2))
        .onChange(async (v) => {
          const n = parseInt(v, 10)
          s.trust.verifyRetries = Number.isFinite(n) && n >= 1 ? n : 2
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('trustDedupAmbiguous'))
      .addDropdown(d => d
        .addOption('warn-push', this.tr('trustDedupAmbiguousPush'))
        .addOption('skip', this.tr('trustDedupAmbiguousSkip'))
        .setValue(s.trust.dedupAmbiguous || 'warn-push')
        .onChange(async (v) => {
          s.trust.dedupAmbiguous = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('trustReportAutoSave'))
      .setDesc(this.tr('trustReportAutoSaveDesc'))
      .addToggle(t => t
        .setValue(s.trust.reportAutoSave === true)
        .onChange(async (v) => {
          s.trust.reportAutoSave = v
          await this.plugin.saveSettings()
        }))
  }

  /** @param {HTMLElement} el @param {object} s */
  renderProGovernSettings (el, s) {
    if (!s.govern || typeof s.govern !== 'object') s.govern = { ...DEFAULT_SETTINGS.govern }

    new Setting(el)
      .setName(this.lbl('governAutoAuditBeforeBatch'))
      .setDesc(this.tr('governAutoAuditBeforeBatchDesc'))
      .addToggle(t => t
        .setValue(s.govern.autoAuditBeforeBatch === true)
        .onChange(async (v) => {
          s.govern.autoAuditBeforeBatch = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('governMaxBodyChars'))
      .setDesc(this.tr('governMaxBodyCharsDesc'))
      .addText(t => t
        .setValue(String(s.govern.maxBodyChars ?? 12000))
        .onChange(async (v) => {
          const n = parseInt(v, 10)
          s.govern.maxBodyChars = Number.isFinite(n) && n >= 1000 ? n : 12000
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('governMinTitleChars'))
      .setDesc(this.tr('governMinTitleCharsDesc'))
      .addText(t => t
        .setValue(String(s.govern.minTitleChars ?? 4))
        .onChange(async (v) => {
          const n = parseInt(v, 10)
          s.govern.minTitleChars = Number.isFinite(n) && n >= 2 ? n : 4
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('governMinBodyChars'))
      .setDesc(this.tr('governMinBodyCharsDesc'))
      .addText(t => t
        .setValue(String(s.govern.minBodyChars ?? 80))
        .onChange(async (v) => {
          const n = parseInt(v, 10)
          s.govern.minBodyChars = Number.isFinite(n) && n >= 1 ? Math.min(n, 5000) : 80
          await this.plugin.saveSettings()
        }))

    new Setting(el)
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
  }

  /** @param {HTMLElement} el @param {object} s */
  renderProFormatSettings (el, s) {
    if (!s.format || typeof s.format !== 'object') s.format = { ...DEFAULT_SETTINGS.format }

    new Setting(el)
      .setName(this.lbl('formatEnabled'))
      .setDesc(this.tr('formatEnabledDesc'))
      .addToggle(t => t
        .setValue(s.format.enabled !== false)
        .onChange(async (v) => {
          s.format.enabled = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('formatOnPush'))
      .addToggle(t => t
        .setValue(s.format.onPush !== false)
        .onChange(async (v) => {
          s.format.onPush = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
      .setName(this.lbl('formatPreset'))
      .addDropdown(d => d
        .addOption('core', this.tr('formatPresetCore'))
        .addOption('standard', this.tr('formatPresetStandard'))
        .setValue(s.format.preset || 'core')
        .onChange(async (v) => {
          s.format.preset = v
          await this.plugin.saveSettings()
        }))

    new Setting(el)
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
      new Setting(el)
        .setName(this.lbl('formatWriteBackSetting'))
        .setDesc(this.tr('formatWriteBackSettingDesc'))
        .addDropdown(d => d
          .addOption('off', this.tr('formatWriteBackOff'))
          .addOption('confirm', this.tr('formatWriteBackOnConfirm'))
          .setValue(s.format.writeBack || 'off')
          .onChange(async (v) => {
            s.format.writeBack = v === 'confirm' ? 'confirm' : 'off'
            await this.plugin.saveSettings()
          }))
    }
  }

  renderProEnrichSettings (el, s) {
    if (!s.enrich || typeof s.enrich !== 'object') s.enrich = { ...DEFAULT_SETTINGS.enrich }

    new Setting(el)
      .setName(this.lbl('enrichEnabled'))
      .setDesc(this.tr('enrichEnabledDesc'))
      .addToggle(t => t
        .setValue(s.enrich.enabled !== false)
        .onChange(async (v) => {
          s.enrich.enabled = v
          await this.plugin.saveSettings()
          const view = this.plugin.getPanelView()
          if (view) view.renderEnrichSection()
        }))

    new Setting(el)
      .setName(this.lbl('enrichOnPush'))
      .setDesc(this.tr('enrichOnPushDesc'))
      .addToggle(t => t
        .setValue(s.enrich.onPush === true)
        .onChange(async (v) => {
          s.enrich.onPush = v
          await this.plugin.saveSettings()
          const view = this.plugin.getPanelView()
          if (view) view.renderEnrichSection()
        }))
  }

  display () {
    const { containerEl } = this
    const s = this.plugin.settings
    containerEl.empty()
    containerEl.addClass('ima-settings-root')
    containerEl.createEl('h2', { text: this.lbl('settingsTitle') })
    this.renderSettingsNav(containerEl, [
      { key: 'sectionConnection' },
      { key: 'sectionKb' },
      { key: 'sectionSync' },
      { key: 'sectionPro', label: this.tr('settingsNavPro') },
      { key: 'sectionAdvanced' },
      { key: 'settingsSectionAbout', label: this.tr('settingsSectionAbout') }
    ])
    containerEl.createDiv({ cls: 'ima-muted ima-settings-hint', text: this.tr('settingsScrollHint') })

    let body = this.settingsGroup(containerEl, 'a', 'sectionConnection')

    new Setting(body)
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

    applySettingTip(
      new Setting(body)
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
      new Setting(body)
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
      new Setting(body)
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

    this.renderApiKeyExpirySettings(
      this.settingsFold(body, 'apiKeyExpiry', 'settingsFoldApiKeyExpiry'),
      s
    )

    body = this.settingsGroup(containerEl, 'b', 'sectionKb')
    this.renderKbList(body)

    applySettingTip(
      new Setting(body)
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
      new Setting(body)
        .setName(this.lbl('kbIdInput'))
        .setDesc(
          isProActive(s) || kbLibrariesMax(s) === 0
            ? this.tr('kbLibrariesDesc')
            : this.tr('kbLibrariesDescFree', { max: kbLibrariesMax(s) })
        )
        .addText(t => t
          .setPlaceholder(this.lbl('kbIdInput'))
          .setValue(this.draftKbId)
          .onChange((v) => { this.draftKbId = v.trim() }))
        .addText(t => t
          .setPlaceholder(this.tr('kbLabelPlaceholder'))
          .setValue(this.draftKbLabel)
          .onChange((v) => { this.draftKbLabel = v.trim() }))
        .addButton(b => b
          .setButtonText(this.tr('addKb'))
          .onClick(async () => {
            const id = (this.draftKbId || '').trim()
            if (!id) {
              new Notice(this.tr('kbIdRequired'))
              return
            }
            if (!(await this.plugin.addKbLibrary({ id, label: this.draftKbLabel }))) return
            this.draftKbId = ''
            this.draftKbLabel = ''
            this.display()
          })),
      s,
      'kbSetting',
      Notice
    )

    body = this.settingsGroup(containerEl, 'a', 'sectionSync')

    this.renderFolderList(body)

    applySettingTip(
      new Setting(body)
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
            const file = this.plugin.resolveWorkingMarkdownFile()
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
      new Setting(body)
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
        new Setting(body)
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
      new Setting(body)
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
      new Setting(body)
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
      body.createDiv({ cls: 'ima-exp-note ima-pull-off-note' })
        .setText(this.tr('experimentalPullOffNote'))
    }

    body = this.settingsGroup(containerEl, 'b', 'sectionPro')
    body.createDiv({
      cls: 'ima-muted ima-compact',
      text: isProActive(s) ? this.tr('proActivated') : this.tr('proInactive')
    })

    new Setting(body)
      .setName(this.lbl('proLicenseKey'))
      .setDesc(this.tr('proLicenseKeyDesc'))
      .addText(t => {
        t.setPlaceholder('IMAPRO-XXXX-XXXX-XXXX-XXXX')
          .setValue(s.proLicenseKey || '')
          .onChange(async (v) => {
            s.proLicenseKey = v.trim()
            s.proActivated = verifyProLicenseKey(s.proLicenseKey)
            await this.plugin.saveSettings()
            const view = this.plugin.getPanelView()
            if (view) view.refreshAfterLicenseChange()
          })
        t.inputEl.addClass('ima-license-key-input')
        t.inputEl.setAttribute('spellcheck', 'false')
        t.inputEl.setAttribute('autocomplete', 'off')
      })

    if (cloudLicenseEnabled(s)) {
      new Setting(body)
        .setName(this.lbl('proCloudActivate'))
        .setDesc(this.tr('proCloudActivateDesc'))
        .addButton(btn => btn
          .setButtonText(this.tr('proCloudActivate'))
          .setCta()
          .onClick(() => { void this.plugin.syncProLicenseCloud() }))
      if (s.entitlementsCachedAt || s.licenseDeviceId || isProActive(s)) {
        new Setting(body)
          .setName(this.lbl('proDeactivateLocal'))
          .setDesc(this.tr('proDeactivateLocalDesc'))
          .addButton(btn => btn
            .setButtonText(this.tr('proDeactivateLocal'))
            .setWarning()
            .onClick(() => { void this.plugin.deactivateLocalDevice() }))
      }
      if (s.entitlementsCachedAt) {
        body.createDiv({
          cls: 'ima-muted ima-compact',
          text: this.tr('proCloudCachedAt', { at: s.entitlementsCachedAt.slice(0, 19).replace('T', ' ') })
        })
      }
    } else {
      body.createDiv({
        cls: 'ima-muted ima-compact',
        text: this.tr('proCloudDisabled')
      })
    }

    if (isProActive(s)) {
      this.renderProTrustSettings(
        this.settingsFold(body, 'trust', 'settingsFoldTrust'),
        s
      )
      this.renderProGovernSettings(
        this.settingsFold(body, 'govern', 'settingsFoldGovern'),
        s
      )
      this.renderProFormatSettings(
        this.settingsFold(body, 'format', 'settingsFoldFormat'),
        s
      )
      this.renderProEnrichSettings(
        this.settingsFold(body, 'enrich', 'settingsFoldEnrich'),
        s
      )

      applySettingTip(
        new Setting(body)
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

    body = this.settingsGroup(containerEl, 'a', 'sectionAdvanced')
    new Setting(body)
      .setName(this.lbl('showAdvanced'))
      .addToggle(t => t
        .setValue(s.showAdvanced)
        .onChange(async (v) => {
          s.showAdvanced = v
          await this.plugin.saveSettings()
          this.display()
        }))

    if (s.showAdvanced) {
      if (EXPERIMENTAL_UI) {
        applySettingTip(
          new Setting(body)
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

      new Setting(body)
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
          new Setting(body)
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
        new Setting(body)
          .setName(this.lblExp('pullNew'))
          .setDesc(this.tr('pullNewDesc'))
          .addToggle(t => t
            .setValue(s.pullNewFromIma)
            .onChange(async (v) => {
              s.pullNewFromIma = v
              await this.plugin.saveSettings()
            }))
      }

      new Setting(body)
        .setName(this.lbl('openOnStart'))
        .addToggle(t => t
          .setValue(s.openPanelOnStart)
          .onChange(async (v) => {
            s.openPanelOnStart = v
            await this.plugin.saveSettings()
          }))

      applySettingTip(
        new Setting(body)
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
        new Setting(body)
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
        new Setting(body)
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
        new Setting(body)
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

      new Setting(body)
        .setName(this.lbl('networkRetryCount'))
        .setDesc(this.tr('networkRetryCountDesc'))
        .addText(t => t
          .setValue(String(s.networkRetryCount ?? 3))
          .onChange(async (v) => {
            s.networkRetryCount = Math.max(0, parseInt(v, 10) || 0)
            await this.plugin.saveSettings()
          }))

      new Setting(body)
        .setName(this.lbl('networkRetryDelayMs'))
        .setDesc(this.tr('networkRetryDelayMsDesc'))
        .addText(t => t
          .setValue(String(s.networkRetryDelayMs ?? 1500))
          .onChange(async (v) => {
            s.networkRetryDelayMs = Math.max(200, parseInt(v, 10) || 1500)
            await this.plugin.saveSettings()
          }))

      applySettingTip(
        new Setting(body)
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

    body = this.settingsGroup(containerEl, 'b', 'settingsSectionAbout')
    renderAbout(
      body.createDiv({ cls: 'ima-settings-about ima-settings-about-foot' }),
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
        const exists = list.some(k => k.id === kb.id)
        if (!exists) {
          if (!(await this.plugin.addKbLibrary({ id: kb.id, label: kb.label || kb.id }))) return
        } else {
          s.activeKbId = kb.id
          await this.plugin.saveSettings({ kb: true })
        }
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
    // D-LIC-17c：启动强制校验（后台，不挡注册视图）
    void this.bootstrapProLicenseCloud({ force: true }).catch(() => {})

    // 尽早注册视图，避免侧栏残留标签显示「插件不再活动」
    this.registerView(VIEW_TYPE, (leaf) => new ImaSyncPanelView(leaf, this))

    this.vaultReadyGate = createVaultReadyGate(this.app)
    this._proAdToastInFlight = false
    this._proAdToastSessionDone = false
    this.normalizeTelemetrySettings()
    this.maybePromptTelemetryOptIn()
    void maybeReportInstall(this).catch(() => {})
    void maybeReportHeartbeat(this).catch(() => {})
    void this.refreshRemoteNotices().catch(() => {})

    this.vaultReadyGate.bind(this)

    this.addRibbonIcon('refresh-cw', t(this.settings, 'ribbon'), () => this.activateView())
    this.addRibbonIcon('file-up', t(this.settings, 'syncCurrent'), () => {
      const view = this.getPanelView()
      if (view) void view.syncCurrentNote()
      else void this.quickPushCurrent()
    })

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
            new Notice(t(this.settings, this.settings.autoSyncPaused ? 'statusAutoSyncPaused' : 'syncResumeAuto'))
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
        const file = this.resolveWorkingMarkdownFile()
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
      id: 'ima-sync-failure-queue',
      name: t(this.settings, 'cmdFailureQueue'),
      callback: () => { this.openFailureQueue('push') }
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
      id: 'ima-sync-health-weekly',
      name: t(this.settings, 'cmdHealthWeekly'),
      callback: () => { void this.exportWeeklyHealthReport() }
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
    this.addCommand({
      id: 'ima-enrich-preview',
      name: t(this.settings, 'cmdEnrichPreview'),
      callback: () => { void this.previewEnrichCurrentNote() }
    })
    this.addCommand({
      id: 'ima-enrich-export-report',
      name: t(this.settings, 'cmdEnrichExport'),
      callback: () => { void this.exportLastEnrichReport() }
    })

    this.addSettingTab(this._settingTab = new ImaSyncSettingTab(this.app, this))

    this.registerEvent(
      this.app.vault.on('modify', (file) => this.onVaultModify(file))
    )
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        this.rememberWorkingMarkdown(file)
        const view = this.getPanelView()
        if (view) view.scheduleWorkspaceContextRefresh()
      })
    )
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        const file = leaf?.view?.file
        if (file?.extension === 'md') this.rememberWorkingMarkdown(file)
        const view = this.getPanelView()
        if (view) view.scheduleWorkspaceContextRefresh()
      })
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

  /** @param {{ path?: string, extension?: string } | null | undefined} file */
  rememberWorkingMarkdown (file) {
    if (file?.extension === 'md' && file.path) {
      this._lastWorkingMdPath = file.path
    }
  }

  /**
   * 侧栏获焦时 workspace 当前文件常为空；回退最近 Markdown 编辑叶。
   * @returns {import('obsidian').TFile | null}
   */
  resolveWorkingMarkdownFile () {
    const file = resolveWorkingMarkdownFile(this.app, this._lastWorkingMdPath || '')
    if (file?.extension === 'md') this._lastWorkingMdPath = file.path
    return file
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

  /** @param {object} summary */
  storeEnrichReport (summary) {
    if (!summary?.enrichReport) return
    this.settings.lastEnrichReport = summary.enrichReport
    void this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderEnrichSection()
  }

  /**
   * @param {import('obsidian').TFile} file
   * @param {string} formattedBody
   * @param {{ confirm?: boolean }} [opts]
   */
  async writeBackFormattedNote (file, formattedBody, opts = {}) {
    if (!canUseFormatFull(this.settings)) {
      new Notice(t(this.settings, 'formatWriteBackProOnly'))
      return false
    }
    const allow = opts.confirm === true || this.settings.format?.writeBack === 'confirm'
    if (!allow) {
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
    try {
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
          : formatReadyLevelHint(caps, (k, v) => t(this.settings, k, v))
        new Notice(msg, caps.readyLevel === 'full' ? 3000 : 8000)
      }
      return caps
    } catch (e) {
      if (!opts.silent) new Notice(formatSyncError(this.settings, e), 6000)
      return null
    }
  }

  /** @deprecated alias */
  async testTrustApi () {
    return this.probeTrustCapabilities()
  }

  /**
   * @param {{ silent?: boolean, force?: boolean }} [opts]
   */
  async bootstrapProLicenseCloud (opts = {}) {
    const key = String(this.settings.proLicenseKey || '').trim()
    if (!key || !cloudLicenseEnabled(this.settings)) return { ok: false, skipped: true }
    let result
    if (this.settings.entitlementsCache && this.settings.entitlementsCacheKey === key) {
      result = await maybeRefreshCloudEntitlements(this.settings, this.manifest.version, {
        force: opts.force === true
      })
    } else {
      result = await activateProLicenseCloud(this.settings, { pluginVersion: this.manifest.version })
    }
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.refreshAfterLicenseChange()
    return result
  }

  /**
   * 设置页打开时刷新 Pro 区（联网激活后否则仍显示「未激活」）
   * @param {string} [sectionId]
   */
  refreshOpenSettingsTab (sectionId = 'pro') {
    const tab = this._settingTab
    if (!tab || typeof tab.display !== 'function') return
    if (this.app.setting?.activeTab !== tab) return
    if (sectionId) this._pendingSettingsSection = sectionId
    tab.display()
    const tryScroll = () => {
      const pending = this._pendingSettingsSection
      if (!pending) return
      if (typeof tab.scrollToSettingsSection === 'function') {
        this._pendingSettingsSection = null
        tab.scrollToSettingsSection(pending)
      }
    }
    requestAnimationFrame(() => {
      tryScroll()
      window.setTimeout(tryScroll, 80)
    })
  }

  /**
   * @param {{ silent?: boolean }} [opts]
   */
  async syncProLicenseCloud (opts = {}) {
    let result
    try {
      result = await activateProLicenseCloud(this.settings, {
        pluginVersion: this.manifest.version
      })
    } catch (err) {
      const msg = String(err?.message || err || '')
      result = {
        ok: false,
        error: msg.startsWith('LICENSE_ENT_') ? msg : 'activate_failed',
        message: msg
      }
    }
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.refreshAfterLicenseChange()
    this.refreshOpenSettingsTab('pro')
    if (!opts.silent) {
      if (result.ok && (result.mode === 'mock' || result.mode === 'remote' || result.mode === 'legacy')) {
        new Notice(t(this.settings, 'proCloudActivateOk'), 4000)
      } else if (result.fallback === 'legacy') {
        new Notice(t(this.settings, 'proCloudActivateLegacy'), 6000)
      } else if (!result.ok) {
        const detail = formatProCloudError(this.settings, result)
        new Notice(t(this.settings, 'proCloudActivateFail', { detail }), 8000)
      }
    }
    return result
  }

  async deactivateLocalDevice () {
    if (!window.confirm(t(this.settings, 'proDeactivateLocalConfirm'))) {
      return { ok: false, cancelled: true }
    }
    const result = await deactivateLocalDeviceCloud(this.settings, {
      pluginVersion: this.manifest.version
    })
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.refreshAfterLicenseChange()
    this.refreshOpenSettingsTab('pro')
    if (result.ok) {
      new Notice(t(this.settings, 'proDeactivateLocalOk'), 5000)
    } else if (result.error === 'cooldown_exceeded') {
      new Notice(result.message || t(this.settings, 'proDeactivateLocalCooldown'), 8000)
    } else {
      const detail = formatProCloudError(this.settings, result)
      new Notice(t(this.settings, 'proDeactivateLocalFail', { detail }), 8000)
    }
    return result
  }

  async resetSystemicFailedMarks () {
    if (this.syncing) {
      new Notice(t(this.settings, 'syncing'))
      return
    }
    new Notice(t(this.settings, 'resetSystemicFailedBusy'), 2500)
    const view = this.getPanelView()
    try {
      const { cleared } = await resetSystemicFailedMarks(this.app, this.settings, {
        onProgress: (done) => {
          if (done > 0 && done % 200 === 0) {
            this.setSyncProgress(t(this.settings, 'resetSystemicFailedBusy') + ` ${done}`)
          }
        }
      })
      if (view) view.invalidateStatsCache()
      this.schedulePersistStatsCache(null)
      this.settings.statsCacheSnapshot = null
      await this.saveData(this.settings)
      new Notice(
        cleared
          ? t(this.settings, 'resetSystemicFailedDone', { n: cleared })
          : t(this.settings, 'resetSystemicFailedEmpty'),
        5000
      )
      if (view) {
        view.scheduleStatsRefresh()
        await view.refresh({ soft: true, stats: true, note: false, actions: false, forceHeavy: true })
      }
    } catch (e) {
      new Notice(formatSyncError(this.settings, e), 6000)
    } finally {
      this.setSyncProgress('')
    }
  }

  /**
   * @param {'push'|'verify'} [tab]
   */
  openFailureQueue (tab = 'push') {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return
    }
    new FailureQueueModal(this.app, this, tab).open()
  }

  /**
   * Ignore = leave queue only (does not edit note body / frontmatter).
   * @param {string} notePath
   */
  async ignoreFailedEntry (notePath) {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return false
    }
    const path = String(notePath || '').trim()
    if (!path) return false
    const before = (this.settings.failedQueue || []).length
    this.settings.failedQueue = removeFailedEntry(this.settings.failedQueue || [], path)
    if (this.settings.failedQueue.length === before) return false
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderTrustSection()
    return true
  }

  /**
   * @param {{ paths?: string[] }} [opts]
   */
  async retryFailedQueue (opts = {}) {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return
    }
    const wanted = Array.isArray(opts.paths)
      ? opts.paths.map((p) => String(p || '').trim()).filter(Boolean)
      : null
    const queue = wanted && wanted.length
      ? wanted
      : (this.settings.failedQueue || []).map(e => e.path).filter(Boolean)
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
      this.storeEnrichReport(summary)
      new Notice(t(this.settings, 'pushDone') + this.getPanelView()?.formatSummary(summary))
      if (view) {
        view.scheduleStatsRefresh()
        view.renderTrustSection()
      }
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
    const files = this.listGovernScopeFiles()
    const notes = await this.collectGovernNotes(files)
    const report = auditNotes(notes, this.settings)
    const health = buildHealthReport(report, notes, this.settings)
    if (this.settings.lastHealthReport?.total) {
      this.settings.priorHealthReport = this.settings.lastHealthReport
    }
    this.settings.lastGovernReport = report
    this.settings.lastHealthReport = health
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) {
      view.renderGovernSection()
      view.renderFormatSection()
      view.renderEnrichSection()
      if (view.statsWrapEl) {
        const folders = this.getSyncScopeFolders()
        const stats = view.getDisplayStats?.(folders) || null
        if (stats) view.renderStatsBlock(view.statsWrapEl, stats)
        else {
          view.updateStatsFoldChrome?.()
          view.renderHealthStatsSummary?.(view.statsWrapEl)
        }
      } else {
        view.updateStatsFoldChrome?.()
      }
    }
    if (!opts.silent) {
      new Notice(t(this.settings, 'healthAuditDone', {
        score: health.score,
        grade: t(this.settings, ({
          excellent: 'healthGradeExcellent',
          good: 'healthGradeGood',
          needs_work: 'healthGradeNeedsWork'
        })[health.grade] || 'healthGradeNeedsWork'),
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
    const file = this.resolveWorkingMarkdownFile()
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
      view.renderEnrichSection()
      void view.renderCurrentNote(true)
    }
    const item = report.items[0]
    const msg = item?.codes?.length
      ? t(this.settings, 'governCurrentIssues', { codes: formatCodeList(this.settings, item.codes) })
      : t(this.settings, 'governCurrentOk')
    new Notice(msg, 4000)
    return report
  }

  /** @param {string} filePath @param {string} md */
  async writeReportMarkdown (filePath, md) {
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
    return filePath
  }

  /**
   * Open first markdown under folder (or Notice path). Used by health dim modal.
   * @param {string} folderPath
   */
  async revealHealthFolder (folderPath) {
    const folder = String(folderPath || '').replace(/\\/g, '/')
    const display = folder === '(root)' ? this.trRootFolder() : folder
    const files = this.app.vault.getMarkdownFiles().filter((f) => {
      const p = f.path.replace(/\\/g, '/')
      if (folder === '(root)') return !p.includes('/')
      return p === folder || p.startsWith(`${folder}/`)
    })
    if (!files.length) {
      new Notice(t(this.settings, 'healthFolderNoNotes', { folder: display }), 4000)
      return false
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    await this.app.workspace.getLeaf(false).openFile(files[0])
    new Notice(t(this.settings, 'healthFolderOpened', { folder: display }), 3500)
    return true
  }

  trRootFolder () {
    return t(this.settings, 'healthFolderRoot')
  }

  async exportWeeklyHealthReport () {
    let health = this.settings.lastHealthReport
    if (!health?.total) {
      const report = await this.auditSyncFolder({ silent: true })
      health = this.settings.lastHealthReport
      if (!report?.total || !health?.total) {
        new Notice(t(this.settings, 'governReportNone'))
        return false
      }
    }
    const tier = canUseGovern(this.settings) ? 'pro' : 'free'
    const md = formatWeeklyHealthMarkdown(
      health,
      tier === 'pro' ? this.settings.lastGovernReport : null,
      (k, vars) => t(this.settings, k, vars),
      {
        tier,
        prior: tier === 'pro' ? this.settings.priorHealthReport : null
      }
    )
    const day = String(health.scoredAt || new Date().toISOString()).slice(0, 10)
    const fileName = `ima-health-weekly-${day}.md`
    new HealthWeeklyModal(this.app, this, { markdown: md, fileName, tier }).open()
    return true
  }

  /**
   * @param {string} md
   * @param {string} fileName
   */
  saveWeeklyHealthToVaultFolder (md, fileName) {
    new FolderPickerModal(this.app, this.settings, (folder) => {
      void this.writeWeeklyHealthVaultFile(md, fileName, folder)
    }, { titleKey: 'healthWeeklyPickFolder' }).open()
  }

  /**
   * @param {string} md
   * @param {string} fileName
   * @param {string} folder vault-relative folder ('' = vault root → default reports dir)
   */
  async writeWeeklyHealthVaultFile (md, fileName, folder) {
    const safeName = String(fileName || 'ima-health-weekly.md').replace(/[\\/:*?"<>|]/g, '-')
    const base = String(folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const filePath = base
      ? `${base}/${safeName}`
      : `_ima-sync/reports/${safeName}`
    try {
      if (!base) {
        await this.writeReportMarkdown(filePath, md)
      } else {
        const parts = base.split('/').filter(Boolean)
        let acc = ''
        for (const p of parts) {
          acc = acc ? `${acc}/${p}` : p
          if (!this.app.vault.getAbstractFileByPath(acc)) {
            await this.app.vault.createFolder(acc)
          }
        }
        const existing = this.app.vault.getAbstractFileByPath(filePath)
        if (existing) await this.app.vault.modify(existing, md)
        else await this.app.vault.create(filePath, md)
      }
      new Notice(t(this.settings, 'healthWeeklySaved', { path: filePath }), 4500)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  /**
   * @param {string} md
   * @param {string} fileName
   */
  async saveWeeklyHealthToOsFolder (md, fileName) {
    const picked = await pickOsDirectory(t(this.settings, 'healthWeeklyPickOsFolder'))
    if (!picked.ok) {
      if (picked.reason === 'unavailable') {
        new Notice(t(this.settings, 'healthWeeklyOsUnavailable'), 5000)
      }
      return false
    }
    try {
      const full = writeOsFile(picked.path, fileName, md)
      new Notice(t(this.settings, 'healthWeeklySaved', { path: full }), 5000)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  async exportLastGovernReport () {
    if (!canUseGovern(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return false
    }
    const report = this.settings.lastGovernReport
    if (!report?.total) {
      new Notice(t(this.settings, 'governReportNone'))
      return false
    }
    const md = formatGovernReportMarkdown(report, (k, vars) => t(this.settings, k, vars))
    const stamp = (report.auditedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `_ima-sync/reports/ima-govern-report-${stamp}.md`
    try {
      await this.writeReportMarkdown(filePath, md)
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
      new Notice(`${t(this.settings, 'formatReportExport')}: ${filePath}`)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  async previewFormatCurrentNote () {
    const file = this.resolveWorkingMarkdownFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    if (!(await this.guardFormatPreviewQuota())) return
    try {
      const raw = await this.app.vault.read(file)
      const { frontmatter, body } = parseNoteFile(raw)
      const title = frontmatter.title || file.basename
      const result = formatForIma({ path: file.path, title, body, frontmatter }, this.settings)
      if (result.unchanged || !result.rulesApplied?.length) {
        new Notice(t(this.settings, 'formatPreviewEmpty'))
        return
      }
      await this.commitFormatPreviewTrial()
      new FormatPreviewModal(this.app, this, file, {
        title: file.basename,
        before: body,
        after: result.body,
        rules: result.rulesApplied
      }).open()
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
    }
  }

  async exportLastEnrichReport () {
    if (!canUseEnrich(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return false
    }
    const report = this.settings.lastEnrichReport
    if (!report?.counts?.total) {
      new Notice(t(this.settings, 'enrichReportNone'))
      return false
    }
    const md = formatEnrichReportMarkdown(report, (k, vars) => t(this.settings, k, vars))
    const stamp = (report.finishedAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19)
    const filePath = `_ima-sync/reports/ima-enrich-report-${stamp}.md`
    try {
      await this.writeReportMarkdown(filePath, md)
      new Notice(`${t(this.settings, 'enrichReportExport')}: ${filePath}`)
      return true
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
      return false
    }
  }

  /**
   * @param {string} folderPath
   */
  async ensureVaultFolder (folderPath) {
    const folder = String(folderPath || '').replace(/^\/+|\/+$/g, '')
    if (!folder) return
    const parts = folder.split('/').filter(Boolean)
    let cur = ''
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur)
      }
    }
  }

  /**
   * Write enrich payloads into folder (split). Skips same source_url (D-IS-ENR-WB-01).
   * @param {string} folderPath
   * @param {Array<{ sourceUrl: string, payload: string, title?: string }>} items
   * @returns {Promise<{ created: string[], skipped: string[] }>}
   */
  async writeEnrichItemsToFolder (folderPath, items) {
    const folder = String(folderPath || '').replace(/^\/+|\/+$/g, '')
    await this.ensureVaultFolder(folder)
    const index = await indexEnrichNotesInFolder(this.app, folder)
    const plans = planSplitWriteActions(items, index)
    /** @type {string[]} */
    const created = []
    /** @type {string[]} */
    const skipped = []
    for (const p of plans) {
      if (p.action !== 'create' || !p.raw) {
        skipped.push(p.existingPath || p.sourceUrl || p.basename)
        continue
      }
      let path = folder ? `${folder}/${p.basename}.md` : `${p.basename}.md`
      let n = 0
      while (this.app.vault.getAbstractFileByPath(path)) {
        n += 1
        path = folder ? `${folder}/${p.basename}-${n}.md` : `${p.basename}-${n}.md`
      }
      await this.app.vault.create(path, p.raw)
      created.push(path)
    }
    return { created, skipped }
  }

  /**
   * @param {string} folderPath
   * @param {Array<{ sourceUrl: string, payload: string, title?: string }>} items
   */
  async writeMergedEnrichToFolder (folderPath, items) {
    const folder = String(folderPath || '').replace(/^\/+|\/+$/g, '')
    await this.ensureVaultFolder(folder)
    const raw = buildMergedEnrichNoteRaw(items)
    const title = `解析合集-${new Date().toISOString().slice(0, 10)}`
    const basename = safeEnrichBasename(title, items.map(i => i.sourceUrl).join('|'))
    let path = folder ? `${folder}/${basename}.md` : `${basename}.md`
    let n = 0
    while (this.app.vault.getAbstractFileByPath(path)) {
      n += 1
      path = folder ? `${folder}/${basename}-${n}.md` : `${basename}-${n}.md`
    }
    await this.app.vault.create(path, raw)
    return path
  }

  async previewEnrichCurrentNote () {
    const file = this.resolveWorkingMarkdownFile()
    return this.previewEnrichFile(file)
  }

  /**
   * Open note then enrich preview (Govern URL_ONLY 一键富化).
   * @param {string} path
   */
  async previewEnrichAtPath (path) {
    const file = this.app.vault.getAbstractFileByPath(String(path || ''))
    if (!file || !(file instanceof TFile) || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    try {
      await this.app.workspace.getLeaf(false).openFile(file)
    } catch (_) { /* still try enrich */ }
    return this.previewEnrichFile(file)
  }

  /**
   * @param {import('obsidian').TFile | null | undefined} file
   */
  async previewEnrichFile (file) {
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    if (!(await this.guardEnrichParseQuota())) return
    try {
      const raw = await this.app.vault.read(file)
      const { frontmatter, body } = parseNoteFile(raw)
      const urls = extractEnrichUrls(body)
      if (!urls.length) {
        const plan = detectEnrichTargets(body, frontmatter, this.settings)
        new Notice(t(this.settings, 'enrichPreviewSkip', { reason: plan.skipReason || 'no_url' }), 5000)
        return
      }
      // 多链接：拆写/合并/同步须 Pro；「多链接合并」明确为 Pro
      if (urls.length > 1 && !isProActive(this.settings)) {
        new Notice(t(this.settings, 'enrichMultiProRequired'), 8000)
        this.openSettings('pro')
        return
      }
      const plan = detectEnrichTargets(body, frontmatter, this.settings)
      if (!plan.needsEnrich && urls.length <= 1) {
        new Notice(t(this.settings, 'enrichPreviewSkip', { reason: plan.skipReason || 'not_needed' }), 5000)
        return
      }
      new Notice(t(this.settings, 'enrichPreviewRunning'), 2500)
      const createDocument = (html) => {
        if (typeof DOMParser === 'undefined') return null
        return new DOMParser().parseFromString(String(html || ''), 'text/html')
      }
      const timeoutMs = Math.max(1000, Number(this.settings.enrich?.fetchTimeoutMs) || 30000)
      const gapMs = Math.max(0, Number(this.settings.enrich?.fetchGapMs) || 800)
      const fetchOpts = {
        timeoutMs,
        createDocument,
        desktopEnhancement: this.settings.enrich?.desktopEnhancement !== false,
        settings: this.settings
      }
      const targets = urls.length > 1 ? urls : [urls[0]]
      /** @type {Array<{ status: string, codes: string[], sourceUrl: string, payload: string, title: string, kind: string }>} */
      const items = []
      let fetchedNet = 0
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        if (fetchedNet > 0 && gapMs > 0) await sleepMs(gapMs)
        const result = await enrichTarget(target, fetchOpts)
        if (!result.cacheHit) fetchedNet += 1
        if (result.status === 'skipped') continue
        if (!result.payloadMarkdown) {
          items.push({
            status: result.status || 'failed',
            codes: result.codes || [],
            sourceUrl: result.source_url || target.url,
            payload: '',
            title: '',
            kind: target.kind
          })
          continue
        }
        const title = String(result.fields?.title || '').trim() ||
          (result.payloadMarkdown.match(/^#\s+(.+)$/m) || [])[1] ||
          ''
        items.push({
          status: result.status,
          codes: result.codes || [],
          sourceUrl: result.source_url || target.url,
          payload: result.payloadMarkdown,
          title,
          kind: target.kind
        })
      }
      if (Object.keys(this.settings.enrichUrlCache || {}).length) {
        await this.saveSettings({ actions: false })
      }
      await this.commitEnrichParseTrial()
      const okItems = items.filter(i => i.payload)
      if (!okItems.length) {
        new Notice(t(this.settings, 'enrichPreviewFailed', {
          code: (items[0]?.codes || [])[0] || 'failed'
        }), 6000)
        return
      }
      new EnrichPreviewModal(this.app, this, file, {
        status: okItems[0].status,
        codes: okItems.flatMap(i => i.codes || []),
        sourceUrl: okItems[0].sourceUrl,
        payload: okItems[0].payload,
        items: okItems,
        urlCount: urls.length
      }).open()
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
    }
  }

  /**
   * 免费链接解析日试用；Pro 不限
   * @param {{ silent?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  async guardEnrichParseQuota (opts = {}) {
    const check = checkEnrichParseQuota(this.settings)
    if (check.ok) return true
    if (!opts.silent) {
      new Notice(t(this.settings, 'enrichQuotaExhausted', { max: check.max }), 8000)
      this.openSettings('enrich')
    }
    const view = this.getPanelView()
    if (view) view.renderActions()
    return false
  }

  async commitEnrichParseTrial () {
    if (enrichParsePerDayMax(this.settings) <= 0) return
    recordEnrichParse(this.settings)
    await this.saveSettings({ actions: true })
  }

  /**
   * 免费一键排版日试用；Pro 不限
   * @param {{ silent?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  async guardFormatPreviewQuota (opts = {}) {
    const check = checkFormatPreviewQuota(this.settings)
    if (check.ok) return true
    if (!opts.silent) {
      new Notice(t(this.settings, 'formatQuotaExhausted', { max: check.max }), 8000)
      this.openSettings('format')
    }
    const view = this.getPanelView()
    if (view) view.renderActions()
    return false
  }

  async commitFormatPreviewTrial () {
    if (formatPreviewPerDayMax(this.settings) <= 0) return
    recordFormatPreview(this.settings)
    await this.saveSettings({ actions: true })
  }

  async verifyCurrentNote () {
    if (!canUseTrust(this.settings)) {
      new Notice(t(this.settings, 'proInactive'))
      return
    }
    const file = this.resolveWorkingMarkdownFile()
    if (!file || file.extension !== 'md') {
      new Notice(t(this.settings, 'openNoteFirst'))
      return
    }
    try {
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
    } catch (e) {
      new Notice(formatSyncError(this.settings, e), 6000)
    }
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
    s.kbLibraries = effectiveKbLibraries(s, s.kbLibraries)
    const active = (s.activeKbId || '').trim()
    if (active && s.kbLibraries.length && !s.kbLibraries.some(k => k.id === active)) {
      s.activeKbId = ''
    }
    if (!s.activeKbId && s.kbLibraries.length) {
      s.activeKbId = s.kbLibraries[0].id
    }
  }

  /**
   * @param {{ id: string, label?: string }} kb
   * @returns {Promise<boolean>}
   */
  async addKbLibrary (kb) {
    const id = String(kb?.id || '').trim()
    if (!id) {
      new Notice(t(this.settings, 'kbIdRequired'))
      return false
    }
    const list = Array.isArray(this.settings.kbLibraries) ? [...this.settings.kbLibraries] : []
    if (list.some(k => k.id === id)) {
      this.settings.activeKbId = id
      await this.saveSettings({ kb: true })
      return true
    }
    if (!canAddKbLibrary(this.settings, list.length)) {
      const max = kbLibrariesMax(this.settings) || 1
      new Notice(t(this.settings, 'kbLimitReached', { max }), 6000)
      return false
    }
    const label = String(kb.label || id).trim() || id
    list.push({ id, label })
    this.settings.kbLibraries = list
    this.settings.activeKbId = id
    await this.saveSettings({ kb: true })
    return true
  }

  normalizeSyncFrequencySettings () {
    const s = this.settings
    if (!s.requestStats || typeof s.requestStats !== 'object') {
      s.requestStats = { date: '', count: 0 }
    }
    if (!s.batchQuotaUsage || typeof s.batchQuotaUsage !== 'object') {
      s.batchQuotaUsage = { date: '', notes: 0 }
    }
    if (!s.formatTrialUsage || typeof s.formatTrialUsage !== 'object') {
      s.formatTrialUsage = { date: '', count: 0 }
    }
    if (s.uploadGapMs == null || s.uploadGapMs < 500) s.uploadGapMs = 500
    if (s.batchSize == null || s.batchSize < 1) s.batchSize = 80
    if (s.batchPauseSeconds == null) s.batchPauseSeconds = 30
    if (!s.rateLimitBackoffSec) s.rateLimitBackoffSec = '60,120,300'
  }

  /**
   * 免费日额度：仅拦批量；超限仍可打开笔记、改设置、同步当前文档
   * @param {number} plannedNotes
   * @param {{ silent?: boolean }} [opts]
   * @returns {Promise<boolean>}
   */
  async guardBatchQuota (plannedNotes, opts = {}) {
    const check = checkBatchQuota(this.settings, plannedNotes)
    if (check.ok) return true
    if (!opts.silent) {
      const key = check.reason === 'exhausted' ? 'batchQuotaExhausted' : 'batchQuotaTooMany'
      new Notice(t(this.settings, key, {
        max: check.max,
        remaining: check.remaining,
        planned: check.planned
      }), 8000)
    }
    const view = this.getPanelView()
    if (view) view.renderActions()
    return false
  }

  /**
   * @param {{ pushed?: number, errors?: unknown[] }|null|undefined} summary
   */
  async commitBatchQuotaFromSummary (summary) {
    const n = countBatchQuotaNotes(summary)
    if (n <= 0 || batchNotesPerDayMax(this.settings) <= 0) return
    recordBatchNotes(this.settings, n)
    await this.saveSettings()
    const view = this.getPanelView()
    if (view) view.renderActions()
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
    this.normalizeGovernSettings()
    this.normalizeFormatSettings()
    this.normalizeEnrichSettings()
    this.normalizeApiKeyExpirySettings()
    this.syncConnectionMode()
  }

  normalizeEnrichSettings () {
    const s = this.settings
    if (!s.enrich || typeof s.enrich !== 'object') {
      s.enrich = { ...DEFAULT_SETTINGS.enrich }
    } else {
      s.enrich = { ...DEFAULT_SETTINGS.enrich, ...s.enrich }
    }
    const skip = parseInt(String(s.enrich.skipMinBodyChars ?? 500), 10)
    s.enrich.skipMinBodyChars = Number.isFinite(skip) && skip >= 0 ? Math.min(skip, 50000) : 500
    const freeN = parseInt(String(s.enrich.freeParsePerDay ?? 5), 10)
    s.enrich.freeParsePerDay = Number.isFinite(freeN) && freeN >= 0 ? Math.min(freeN, 100) : 5
    const timeout = parseInt(String(s.enrich.fetchTimeoutMs ?? 30000), 10)
    s.enrich.fetchTimeoutMs = Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, 120000) : 30000
    const gap = parseInt(String(s.enrich.fetchGapMs ?? 800), 10)
    s.enrich.fetchGapMs = Number.isFinite(gap) && gap >= 0 ? Math.min(gap, 10000) : 800
    const ttl = parseInt(String(s.enrich.cacheTtlHours ?? 72), 10)
    s.enrich.cacheTtlHours = Number.isFinite(ttl) && ttl >= 0 ? Math.min(ttl, 24 * 30) : 72
    if (!s.enrichUrlCache || typeof s.enrichUrlCache !== 'object') s.enrichUrlCache = {}
    if (s.lastEnrichReport && typeof s.lastEnrichReport !== 'object') {
      s.lastEnrichReport = null
    }
  }

  normalizeGovernSettings () {
    const s = this.settings
    if (!s.govern || typeof s.govern !== 'object') {
      s.govern = { ...DEFAULT_SETTINGS.govern }
    } else {
      s.govern = { ...DEFAULT_SETTINGS.govern, ...s.govern }
    }
    const minBody = parseInt(String(s.govern.minBodyChars ?? 80), 10)
    s.govern.minBodyChars = Number.isFinite(minBody) && minBody >= 1 ? Math.min(minBody, 5000) : 80
    const urlRes = parseInt(String(s.govern.urlOnlyMaxResidualChars ?? 40), 10)
    s.govern.urlOnlyMaxResidualChars = Number.isFinite(urlRes) && urlRes >= 0 ? Math.min(urlRes, 500) : 40
    if (s.lastHealthReport && typeof s.lastHealthReport !== 'object') {
      s.lastHealthReport = null
    }
    if (s.priorHealthReport && typeof s.priorHealthReport !== 'object') {
      s.priorHealthReport = null
    }
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
    const freeN = Number(s.format.freePreviewPerDay)
    if (!Number.isFinite(freeN) || freeN < 0) s.format.freePreviewPerDay = 5
    else s.format.freePreviewPerDay = Math.floor(freeN)
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
    // 默认开启；仅显式 false 为关闭（opt-out）
    if (typeof this.settings.telemetryEnabled !== 'boolean') {
      this.settings.telemetryEnabled = true
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
    if (!this.settings.telemetryEnabled) return
    const { t } = require('./lib/i18n')
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
    // 首次同步成功后：延时随机弹一次中间 Pro 广告
    void this.maybeShowProAdToast(this.getPanelView())
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
      await fetchRemoteNotices(this.settings, this.manifest.version, {
        ...opts,
        onTamper: async (detail) => {
          try {
            await reportExperienceTamper(this, detail)
          } catch { /* noop */ }
        },
        onReset: async () => {
          await this.saveData(this.settings)
        }
      })
      await this.saveData(this.settings)
      if (view) view.renderRemoteNoticeBanner()
    } catch {
      if (view) view.renderRemoteNoticeBanner()
    }
  }

  /** @param {string} [sectionId] */
  openSettings (sectionId) {
    if (sectionId) this._pendingSettingsSection = sectionId
    const { setting } = this.app
    setting.open()
    setting.openTabById(this.manifest.id)
    const tryScroll = () => {
      const pending = this._pendingSettingsSection
      if (!pending) return
      const tab = setting.activeTab
      if (tab?.plugin === this && typeof tab.scrollToSettingsSection === 'function') {
        this._pendingSettingsSection = null
        tab.scrollToSettingsSection(pending)
      }
    }
    requestAnimationFrame(() => {
      tryScroll()
      window.setTimeout(tryScroll, 80)
    })
  }

  /**
   * 首次同步成功后：侧板中间随机弹一次 Pro 广告（延时 1.4–2.8s · 未激活 · 每日最多一次）
   * @param {ImaSyncPanelView | null} [view]
   */
  async maybeShowProAdToast (view) {
    view = view || this.getPanelView()
    if (!view || this._proAdToastInFlight) return
    if (isProActive(this.settings)) return
    if (this._proAdToastSessionDone) return
    // 叠层条正在首屏：同日单通道，不再弹中间 Toast
    if (this._proAdStripLive) return

    this._proAdToastInFlight = true
    try {
      const delayMs = resolveProAdToastDelayMs()
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, delayMs)
        this.register(() => window.clearTimeout(timer))
      })

      if (!view.root?.isConnected) return
      if (isProActive(this.settings)) return
      if (this._proAdStripLive) return
      if (!shouldShowProAdToast(this.settings)) {
        // 未抽中或本日已展示：本会话不再掷骰（即「第一次同步」后只决策一次）
        this._proAdToastSessionDone = true
        return
      }

      const host = typeof view.getPanelLeafHost === 'function'
        ? view.getPanelLeafHost()
        : view.containerEl
      if (!host) return

      markProAdToastDay(this.settings)
      this._proAdToastSessionDone = true
      void this.saveData(this.settings)

      renderProAdToast(host, this.settings, {
        onActivate: () => { this.openSettings('pro') },
        onDismiss: () => {}
      })
    } finally {
      this._proAdToastInFlight = false
    }
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
    if (direction === 'push' || direction === 'both') {
      const engineProbe = this.createEngine(() => {}, () => {})
      const planned = (await engineProbe.listSyncFiles()).length
      if (!(await this.guardBatchQuota(planned, { silent }))) return
    }
    this.beginSyncRun({ progress: t(this.settings, 'syncPush'), batch: true })
    const view = this.getPanelView()
    const onLog = view ? (msg) => view.appendLog(msg) : () => {}
    const onProgress = (path) => this.setSyncProgress(path)
    try {
      await yieldToUi()
      const engine = this.createEngine(onLog, onProgress)
      const summary = await engine.runSync(direction)
      if (direction === 'push' || direction === 'both') {
        await this.commitBatchQuotaFromSummary(summary)
      }
      this.storeTrustReport(summary)
      this.storeFormatReport(summary)
      this.storeEnrichReport(summary)
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

    const schedule = (delayMs, retriesLeft) => {
      const timer = window.setTimeout(async () => {
        this.saveDebounceTimers.delete(file.path)
        if (this.syncing) {
          if (retriesLeft > 0) schedule(2000, retriesLeft - 1)
          return
        }
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
      }, delayMs)
      this.saveDebounceTimers.set(file.path, timer)
    }

    schedule(3000, 3)
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
    const view = this.getPanelView()
    const planned = view
      ? view.countMdUnderFolder(folderPath)
      : this.app.vault.getMarkdownFiles().filter((f) => {
        if (!isUnderSyncFolders(f.path, [folderPath || ''])) return false
        return isUnderSyncFolders(f.path, this.getSyncScopeFolders())
      }).length
    if (!(await this.guardBatchQuota(planned))) return
    this.beginSyncRun({ progress: folderPath || t(this.settings, 'vaultRoot'), batch: true })
    const onLog = view ? (msg) => view.appendLog(msg) : () => {}
    try {
      await yieldToUi()
      const engine = this.createEngine(onLog, (path) => this.setSyncProgress(path))
      const summary = await engine.pushFolder(folderPath)
      await this.commitBatchQuotaFromSummary(summary)
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
      this.storeEnrichReport(summary)
      void this.onSyncTelemetry(summary)
      if (view) {
        view.scheduleStatsRefresh()
        view.renderActions()
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
    const file = this.resolveWorkingMarkdownFile()
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
      const r = await engine.pushNote(file, false)
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

class EnrichPreviewModal extends Modal {
  /**
   * @param {import('obsidian').App} app
   * @param {object} plugin
   * @param {import('obsidian').TFile} file
   * @param {{
   *   status: string,
   *   codes: string[],
   *   sourceUrl: string,
   *   payload: string,
   *   items?: Array<{ status: string, codes: string[], sourceUrl: string, payload: string, title: string, kind: string }>,
   *   urlCount?: number
   * }} data
   */
  constructor (app, plugin, file, data) {
    super(app)
    this.plugin = plugin
    this.settings = plugin.settings
    this.file = file
    this.data = data
    this.items = Array.isArray(data.items) && data.items.length
      ? data.items
      : [{
          status: data.status,
          codes: data.codes || [],
          sourceUrl: data.sourceUrl || '',
          payload: data.payload || '',
          title: '',
          kind: 'web'
        }]
    this.urlCount = Number(data.urlCount) || this.items.length
    this.activeIdx = 0
    /** @type {string[]} */
    this.writtenPaths = []
  }

  tr (key, vars) {
    return t(this.settings, key, vars)
  }

  onOpen () {
    this.renderBody()
  }

  renderBody () {
    const { contentEl, modalEl } = this
    contentEl.empty()
    contentEl.addClass('ima-enrich-preview-modal')
    if (modalEl) {
      modalEl.addClass('ima-enrich-preview-modal-el')
      modalEl.style.width = 'min(720px, 94vw)'
      modalEl.style.maxWidth = '720px'
    }
    const item = this.items[this.activeIdx] || this.items[0]

    contentEl.createEl('h2', { text: this.tr('enrichPreviewTitle') })

    const meta = contentEl.createDiv({ cls: 'ima-enrich-preview-meta' })
    meta.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('enrichPreviewMeta', {
        status: localizeStatus(this.plugin.settings, item?.status || this.data.status),
        codes: formatCodeList(this.plugin.settings, item?.codes || this.data.codes || []) || '—'
      })
    })
    meta.createDiv({
      cls: 'ima-muted ima-compact',
      text: this.tr('enrichPreviewCount', { n: this.items.length, total: this.urlCount })
    })

    if (this.items.length > 1) {
      const tabs = contentEl.createDiv({ cls: 'ima-enrich-preview-tabs' })
      this.items.forEach((it, i) => {
        const label = (it.title || it.sourceUrl || `#${i + 1}`).slice(0, 24)
        const btn = tabs.createEl('button', {
          type: 'button',
          text: label,
          cls: i === this.activeIdx
            ? 'ima-enrich-preview-tab is-active'
            : 'ima-enrich-preview-tab'
        })
        btn.addEventListener('click', () => {
          this.activeIdx = i
          this.renderBody()
        })
      })
    }

    if (item?.sourceUrl) {
      const urlEl = contentEl.createDiv({ cls: 'ima-enrich-preview-url' })
      urlEl.setAttr('title', item.sourceUrl)
      urlEl.setText(item.sourceUrl)
    }

    const panel = contentEl.createDiv({ cls: 'ima-enrich-preview-panel' })
    const pre = panel.createEl('pre', { cls: 'ima-enrich-preview-body' })
    pre.setText(item?.payload || '')

    contentEl.createDiv({
      cls: 'ima-muted ima-compact ima-enrich-preview-hint',
      text: this.tr('enrichPreviewHintBeautified')
    })

    const row = contentEl.createDiv({ cls: 'ima-enrich-preview-actions' })
    row.createEl('button', {
      type: 'button',
      text: this.tr('enrichWriteLocal'),
      cls: 'mod-cta ima-btn-accent'
    }).addEventListener('click', () => { void this.onWriteLocal() })

    const syncBtn = row.createEl('button', {
      type: 'button',
      text: this.tr('enrichSyncIma'),
      cls: 'ima-btn-secondary'
    })
    syncBtn.addEventListener('click', () => { void this.onSyncIma() })

    const mergeBtn = row.createEl('button', {
      type: 'button',
      text: this.tr('enrichMergeLinks'),
      cls: 'ima-btn-secondary'
    })
    if (this.urlCount < 2) {
      mergeBtn.setAttr('disabled', 'true')
      mergeBtn.setAttr('title', this.tr('enrichMergeNeedMulti'))
    }
    mergeBtn.addEventListener('click', () => { void this.onMerge() })

    row.createEl('button', {
      type: 'button',
      text: this.tr('formatPreviewClose'),
      cls: 'ima-btn-secondary'
    }).addEventListener('click', () => this.close())
  }

  requireProForAction (actionKey) {
    if (isProActive(this.settings)) return true
    new Notice(this.tr(actionKey), 8000)
    this.plugin.openSettings('pro')
    return false
  }

  pickFolder () {
    return new Promise((resolve) => {
      let settled = false
      const finish = (v) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      const modal = new FolderPickerModal(this.app, this.settings, (folder) => {
        finish(folder == null ? null : String(folder))
      }, { titleKey: 'enrichPickFolder' })
      const prevClose = modal.onClose.bind(modal)
      modal.onClose = () => {
        prevClose()
        finish(null)
      }
      modal.open()
    })
  }

  async onWriteLocal () {
    if (this.urlCount > 1 && !this.requireProForAction('enrichMultiProRequired')) return
    const folder = await this.pickFolder()
    if (folder == null) return
    try {
      const { created, skipped } = await this.plugin.writeEnrichItemsToFolder(folder, this.items)
      this.writtenPaths = created
      new Notice(this.tr('enrichWriteLocalDone', {
        n: created.length,
        skip: skipped.length
      }), 7000)
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
    }
  }

  async onMerge () {
    // 多链接合并：明确 Pro
    if (!this.requireProForAction('enrichMergeProRequired')) return
    if (this.urlCount < 2) {
      new Notice(this.tr('enrichMergeNeedMulti'), 5000)
      return
    }
    const folder = await this.pickFolder()
    if (folder == null) return
    try {
      const path = await this.plugin.writeMergedEnrichToFolder(folder, this.items)
      this.writtenPaths = [path]
      new Notice(this.tr('enrichMergeDone', { path }), 7000)
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
    }
  }

  async onSyncIma () {
    if (!this.requireProForAction('enrichSyncProRequired')) return
    if (!this.plugin.getActiveKbId()) {
      new Notice(this.tr('kbNone'))
      this.plugin.openSettings('kb')
      return
    }
    try {
      let paths = this.writtenPaths.slice()
      if (!paths.length) {
        const folder = await this.pickFolder()
        if (folder == null) return
        const { created, skipped } = await this.plugin.writeEnrichItemsToFolder(folder, this.items)
        this.writtenPaths = created
        paths = created
        if (skipped.length) {
          new Notice(this.tr('enrichWriteLocalDone', { n: created.length, skip: skipped.length }), 5000)
        }
      }
      if (!paths.length) {
        new Notice(this.tr('enrichSyncNothing'), 5000)
        return
      }
      if (this.plugin.syncing) {
        new Notice(this.tr('syncing'))
        return
      }
      this.plugin.beginSyncRun({ progress: paths[0], batch: paths.length > 1 })
      let pushed = 0
      try {
        const view = this.plugin.getPanelView()
        const engine = view?.getEngine?.() || this.plugin.createEngine(
          () => {},
          (path) => this.plugin.setSyncProgress(path)
        )
        for (const p of paths) {
          const f = this.app.vault.getAbstractFileByPath(p)
          if (!f || !(f instanceof TFile)) continue
          const r = await engine.pushNote(f, true)
          if (!r.skipped) pushed += 1
        }
        new Notice(this.tr('enrichSyncDone', { n: pushed }), 6000)
      } finally {
        this.plugin.endSyncRun()
      }
      this.close()
    } catch (e) {
      new Notice(String(e?.message || e), 6000)
    }
  }

  onClose () {
    this.contentEl.empty()
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
    const { contentEl, modalEl } = this
    contentEl.empty()
    contentEl.addClass('ima-format-preview-modal')
    if (modalEl) {
      modalEl.addClass('ima-format-preview-modal-el')
      modalEl.style.width = 'min(960px, 94vw)'
      modalEl.style.maxWidth = '960px'
    }
    const tr = (k, v) => t(this.settings, k, v)
    const beforeChars = [...this.data.before].length
    const afterChars = [...this.data.after].length
    const delta = afterChars - beforeChars
    const deltaText = delta > 0
      ? tr('formatPreviewDeltaUp', { n: delta })
      : delta < 0
        ? tr('formatPreviewDeltaDown', { n: delta })
        : tr('formatPreviewDeltaSame')
    const ruleIds = this.data.rules || []
    contentEl.createEl('h2', { text: tr('formatPreviewTitle') })
    contentEl.createEl('p', {
      cls: 'ima-muted ima-format-preview-meta',
      text: tr('formatPreviewMeta', {
        title: this.data.title,
        beforeChars,
        afterChars,
        delta: deltaText,
        ruleCount: ruleIds.length
      })
    })

    if (ruleIds.length) {
      const chips = contentEl.createDiv({ cls: 'ima-format-rule-chips ima-format-preview-chips' })
      chips.createSpan({ cls: 'ima-format-preview-chips-label', text: tr('formatPreviewRules') })
      for (const label of formatRuleLabels(ruleIds, (k) => tr(k))) {
        chips.createSpan({ cls: 'ima-format-rule-chip ima-format-rule-chip--hit', text: label })
      }
    }
    if (!canUseFormatFull(this.settings)) {
      contentEl.createDiv({
        cls: 'ima-muted ima-compact ima-format-preview-teaser',
        text: tr('formatPreviewProTeaser')
      })
    }

    const grid = contentEl.createDiv({ cls: 'ima-format-preview-grid' })
    const colA = grid.createDiv({ cls: 'ima-format-preview-col' })
    const headA = colA.createDiv({ cls: 'ima-format-preview-col-head' })
    headA.createEl('h3', { text: tr('formatPreviewBefore') })
    headA.createSpan({ cls: 'ima-muted ima-format-preview-chars', text: `${beforeChars}` })
    const preA = colA.createEl('pre', {
      cls: 'ima-format-preview-pre',
      text: this.data.before.slice(0, 20000)
    })

    const colB = grid.createDiv({ cls: 'ima-format-preview-col ima-format-preview-col--after' })
    const headB = colB.createDiv({ cls: 'ima-format-preview-col-head' })
    headB.createEl('h3', { text: tr('formatPreviewAfter') })
    headB.createSpan({ cls: 'ima-muted ima-format-preview-chars', text: `${afterChars}` })
    const preB = colB.createEl('pre', {
      cls: 'ima-format-preview-pre',
      text: this.data.after.slice(0, 20000)
    })

    let syncing = false
    const syncScroll = (from, to) => {
      from.addEventListener('scroll', () => {
        if (syncing) return
        syncing = true
        to.scrollTop = from.scrollTop
        to.scrollLeft = from.scrollLeft
        syncing = false
      })
    }
    syncScroll(preA, preB)
    syncScroll(preB, preA)

    const actions = contentEl.createDiv({ cls: 'ima-format-preview-actions' })
    actions.createEl('button', { text: tr('formatPreviewClose'), cls: 'ima-btn-secondary' })
      .addEventListener('click', () => this.close())

    if (canUseFormatFull(this.settings)) {
      const writeBtn = actions.createEl('button', {
        text: tr('formatWriteBack'),
        cls: 'mod-cta ima-btn-accent'
      })
      writeBtn.addEventListener('click', () => {
        const ok = window.confirm(tr('formatWriteBackConfirm'))
        if (!ok) return
        void this.plugin.writeBackFormattedNote(this.file, this.data.after, { confirm: true }).then((done) => {
          if (done) this.close()
        })
      })
    }
  }

  onClose () {
    this.contentEl.empty()
  }
}
