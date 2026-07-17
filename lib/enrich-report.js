'use strict'

/**
 * @param {Array<{
 *   path: string,
 *   status: string,
 *   source_url?: string,
 *   kind?: string,
 *   codes?: string[],
 *   preview?: string,
 *   error?: string
 * }>} items
 */
function buildEnrichReport (items) {
  const list = Array.isArray(items) ? items : []
  const counts = {
    total: list.length,
    enriched: 0,
    degraded: 0,
    failed: 0,
    skipped: 0
  }
  for (const it of list) {
    if (it.status === 'enriched') counts.enriched++
    else if (it.status === 'degraded') counts.degraded++
    else if (it.status === 'failed') counts.failed++
    else counts.skipped++
  }
  return {
    finishedAt: new Date().toISOString(),
    counts,
    items: list.map((it) => ({
      path: it.path,
      status: it.status,
      source_url: it.source_url || '',
      kind: it.kind || '',
      codes: Array.isArray(it.codes) ? it.codes.slice(0, 8) : [],
      preview: String(it.preview || '').slice(0, 80),
      error: it.error || ''
    }))
  }
}

/**
 * @param {ReturnType<typeof buildEnrichReport>} report
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatEnrichReportMarkdown (report, tr) {
  const c = report.counts || {}
  const lines = [
    `# ${tr('enrichReportTitle')}`,
    '',
    `- ${tr('enrichReportFinished')}: ${report.finishedAt || ''}`,
    `- ${tr('enrichReportTotal')}: ${c.total || 0}`,
    `- ${tr('enrichReportEnriched')}: ${c.enriched || 0}`,
    `- ${tr('enrichReportDegraded')}: ${c.degraded || 0}`,
    `- ${tr('enrichReportFailed')}: ${c.failed || 0}`,
    `- ${tr('enrichReportSkipped')}: ${c.skipped || 0}`,
    '',
    `| ${tr('enrichReportColPath')} | ${tr('enrichReportColStatus')} | ${tr('enrichReportColUrl')} | ${tr('enrichReportColCodes')} |`,
    '| --- | --- | --- | --- |'
  ]
  for (const it of report.items || []) {
    const path = String(it.path || '').replace(/\|/g, '/')
    const url = String(it.source_url || '').replace(/\|/g, '/')
    const codes = (it.codes || []).join(',')
    lines.push(`| ${path} | ${it.status || ''} | ${url} | ${codes} |`)
  }
  lines.push('')
  return lines.join('\n')
}

module.exports = {
  buildEnrichReport,
  formatEnrichReportMarkdown
}
