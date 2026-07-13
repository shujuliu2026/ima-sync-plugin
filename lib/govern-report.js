'use strict'

/**
 * @param {ReturnType<import('./govern-rules').auditNotes>} audit
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatGovernReportMarkdown (audit, tr) {
  const lines = [
    `# ${tr('governReportTitle')}`,
    '',
    `- ${tr('governReportFinished')}: ${audit.auditedAt}`,
    `- ${tr('governReportTotal')}: ${audit.total}`,
    `- ${tr('governReportHigh')}: ${audit.highRisk}`,
    `- ${tr('governReportOk')}: ${audit.counts.ok || 0} · ${tr('governReportLow')}: ${audit.counts.low || 0} · ${tr('governReportMedium')}: ${audit.counts.medium || 0} · ${tr('governReportHigh')}: ${audit.counts.high || 0}`,
    '',
    `| ${tr('governReportPath')} | ${tr('governReportRisk')} | ${tr('governReportCodes')} |`,
    '| --- | --- | --- |'
  ]
  for (const item of audit.items || []) {
    if (item.risk === 'ok') continue
    lines.push(`| ${item.path} | ${item.risk} | ${(item.codes || []).join(', ')} |`)
  }
  lines.push('', `_${tr('governReportFooter')}_`, '')
  return lines.join('\n')
}

module.exports = { formatGovernReportMarkdown }
