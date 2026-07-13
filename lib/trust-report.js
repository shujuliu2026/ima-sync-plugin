'use strict'

let _randomUUID = () => `rpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
try {
  const nodeCrypto = require('crypto')
  if (typeof nodeCrypto.randomUUID === 'function') {
    _randomUUID = () => nodeCrypto.randomUUID()
  }
} catch {
  // Obsidian / browser bundle
}
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
  _randomUUID = () => crypto.randomUUID()
}

/**
 * @param {object} [opts]
 */
function createEmptyTrustCounts () {
  return {
    total: 0,
    pushed: 0,
    skipped: 0,
    deduped: 0,
    dedup_ambiguous: 0,
    failed: 0,
    verified: 0,
    verify_failed: 0,
    verify_pending: 0
  }
}

class TrustReportCollector {
  /**
   * @param {{ kbId?: string, kbLabel?: string, direction?: string }} [meta]
   */
  constructor (meta = {}) {
    this.id = _randomUUID()
    this.startedAt = new Date().toISOString()
    this.finishedAt = ''
    this.kbId = meta.kbId || ''
    this.kbLabel = meta.kbLabel || ''
    this.direction = meta.direction || 'push'
    this.counts = createEmptyTrustCounts()
    /** @type {Array<{ path: string, action: string, doc_id?: string, verify?: string, error?: string }>} */
    this.items = []
    this.syncLimit = ''
    this.stopped = false
  }

  /** @param {object} patch */
  mergeSummary (patch) {
    if (!patch) return
    if (patch.pushed) this.counts.pushed += patch.pushed
    if (patch.skipped) this.counts.skipped += patch.skipped
    if (patch.deduped) this.counts.deduped += patch.deduped
    if (patch.dedup_ambiguous) this.counts.dedup_ambiguous += patch.dedup_ambiguous
    if (patch.errors?.length) this.counts.failed += patch.errors.length
    if (patch.syncLimit) this.syncLimit = patch.syncLimit
    if (patch.stopped) this.stopped = true
  }

  /**
   * @param {{ path: string, action: string, doc_id?: string, verify?: string, error?: string }} item
   */
  addItem (item) {
    if (!item?.path) return
    this.counts.total++
    this.items.push({
      path: item.path,
      action: item.action,
      doc_id: item.doc_id || '',
      verify: item.verify || '',
      error: item.error || ''
    })
    if (item.action === 'pushed') this.counts.pushed++
    else if (item.action === 'skipped') this.counts.skipped++
    else if (item.action === 'deduped') this.counts.deduped++
    else if (item.action === 'dedup_ambiguous') this.counts.dedup_ambiguous++
    else if (item.action === 'failed') this.counts.failed++

    if (item.verify === 'verified') this.counts.verified++
    else if (item.verify === 'failed') this.counts.verify_failed++
    else if (item.verify === 'pending') this.counts.verify_pending++
  }

  finish () {
    this.finishedAt = new Date().toISOString()
    return this.toJSON()
  }

  toJSON () {
    return {
      id: this.id,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || new Date().toISOString(),
      kbId: this.kbId,
      kbLabel: this.kbLabel,
      direction: this.direction,
      counts: { ...this.counts },
      items: this.items.slice(),
      syncLimit: this.syncLimit || undefined,
      stopped: this.stopped || undefined
    }
  }
}

/**
 * @param {object} report
 * @param {(key: string, vars?: Record<string, string|number>) => string} [tr]
 */
function formatTrustReportMarkdown (report, tr) {
  const t = tr || ((k) => k)
  const c = report.counts || {}
  const lines = [
    `# ${t('trustReportTitle')}`,
    '',
    `- ${t('trustReportStarted')}: ${report.startedAt}`,
    `- ${t('trustReportFinished')}: ${report.finishedAt}`,
    `- ${t('trustReportKb')}: ${report.kbLabel || report.kbId || '—'}`,
    '',
    '## Summary',
    '',
    `| ${t('trustReportMetric')} | ${t('trustReportCount')} |`,
    '| --- | ---: |',
    `| ${t('pushed')} | ${c.pushed || 0} |`,
    `| ${t('skipped')} | ${c.skipped || 0} |`,
    `| ${t('trustDeduped')} | ${c.deduped || 0} |`,
    `| ${t('trustDedupAmbiguous')} | ${c.dedup_ambiguous || 0} |`,
    `| ${t('errors')} | ${c.failed || 0} |`,
    `| ${t('trustVerified')} | ${c.verified || 0} |`,
    `| ${t('trustVerifyFailed')} | ${c.verify_failed || 0} |`,
    `| ${t('trustVerifyPending')} | ${c.verify_pending || 0} |`,
    '',
    '## Items',
    '',
    '| path | action | verify | doc_id | error |',
    '| --- | --- | --- | --- | --- |'
  ]

  for (const item of report.items || []) {
    lines.push(`| ${item.path} | ${item.action} | ${item.verify || ''} | ${item.doc_id || ''} | ${(item.error || '').replace(/\|/g, '\\|')} |`)
  }

  if (report.syncLimit) {
    lines.push('', `> ${t('trustReportSyncLimit')}: ${report.syncLimit}`)
  }
  return lines.join('\n')
}

module.exports = {
  createEmptyTrustCounts,
  TrustReportCollector,
  formatTrustReportMarkdown
}
