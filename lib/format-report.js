'use strict'

/**
 * @param {Array<{ path: string, status: string, rulesApplied?: string[], deltaChars?: number, error?: string }>} items
 */
function buildFormatReport (items) {
  const list = Array.isArray(items) ? items : []
  const counts = {
    total: list.length,
    formatted: 0,
    skipped: 0,
    unchanged: 0,
    failed: 0
  }
  for (const it of list) {
    if (it.status === 'formatted') counts.formatted++
    else if (it.status === 'skipped' || it.status === 'unchanged') counts.unchanged++
    else if (it.status === 'failed') counts.failed++
    else counts.skipped++
  }
  return {
    finishedAt: new Date().toISOString(),
    counts,
    items: list
  }
}

/**
 * @param {ReturnType<typeof buildFormatReport>} report
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatFormatReportMarkdown (report, tr) {
  const c = report.counts || {}
  const lines = [
    `# ${tr('formatReportTitle')}`,
    '',
    `- ${tr('formatReportFinished')}: ${report.finishedAt || ''}`,
    `- ${tr('formatReportTotal')}: ${c.total || 0}`,
    `- ${tr('formatReportFormatted')}: ${c.formatted || 0}`,
    `- ${tr('formatReportUnchanged')}: ${c.unchanged || 0}`,
    `- ${tr('formatReportFailed')}: ${c.failed || 0}`,
    '',
    `| ${tr('formatReportColPath')} | ${tr('formatReportColStatus')} | ${tr('formatReportColRules')} | ${tr('formatReportColDelta')} |`,
    '| --- | --- | --- | --- |'
  ]
  for (const it of report.items || []) {
    const rules = (it.rulesApplied || []).join(', ')
    lines.push(`| ${it.path || ''} | ${it.status || ''} | ${rules} | ${it.deltaChars ?? ''} |`)
  }
  return lines.join('\n')
}

module.exports = {
  buildFormatReport,
  formatFormatReportMarkdown
}
