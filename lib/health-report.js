'use strict'

/** @typedef {'pending'|'duplicateTitle'|'bodyTooShort'|'urlOnly'} HealthDimKey */
/** @typedef {'free'|'pro'} HealthReportTier */

const DIM_FIELD = {
  pending: 'pending',
  duplicateTitle: 'duplicateTitle',
  bodyTooShort: 'bodyTooShort',
  urlOnly: 'urlOnly'
}

const DIM_I18N = {
  pending: 'healthDimPending',
  duplicateTitle: 'healthDimDuplicate',
  bodyTooShort: 'healthDimShortBody',
  urlOnly: 'healthDimUrlOnly'
}

/**
 * @param {object} health
 * @param {HealthDimKey} dimKey
 * @returns {Array<{ path: string, count: number }>}
 */
function foldersForDimension (health, dimKey) {
  const field = DIM_FIELD[dimKey]
  if (!field) return []
  return Object.values(health?.byFolder || {})
    .map((f) => ({
      path: f.path,
      count: Number(f[field]) || 0,
      pending: f.pending || 0,
      duplicateTitle: f.duplicateTitle || 0,
      bodyTooShort: f.bodyTooShort || 0,
      urlOnly: f.urlOnly || 0,
      high: f.high || 0
    }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
}

/**
 * @param {object} health
 * @param {number} [limit]
 */
function topFoldersOverall (health, limit = 8) {
  return Object.values(health?.byFolder || {})
    .map((f) => {
      const weight =
        (f.pending || 0) +
        (f.duplicateTitle || 0) +
        (f.bodyTooShort || 0) +
        (f.urlOnly || 0) +
        (f.high || 0)
      return { path: f.path, weight, ...f }
    })
    .filter((f) => f.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path))
    .slice(0, limit)
}

/**
 * @param {object | null | undefined} health
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function gradeLabel (health, tr) {
  const gradeKey = {
    excellent: 'healthGradeExcellent',
    good: 'healthGradeGood',
    needs_work: 'healthGradeNeedsWork'
  }[health?.grade] || 'healthGradeNeedsWork'
  return tr(gradeKey)
}

/**
 * One-line conclusion. Free must not expose dimension counts.
 * @param {object} health
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @param {HealthReportTier} tier
 */
function formatHealthConclusion (health, tr, tier) {
  const grade = gradeLabel(health, tr)
  const score = health?.score ?? '—'
  if (tier !== 'pro') {
    return tr('healthWeeklyConclusionFree', { score, grade })
  }
  const worst = (health?.worst || [])[0]
  if (worst?.key) {
    const dim = tr(DIM_I18N[worst.key] || 'healthDimPending')
    return tr('healthWeeklyConclusionPro', { score, grade, dim })
  }
  return tr('healthWeeklyConclusionFree', { score, grade })
}

/**
 * Pro-only: top actions from worst dims + folders.
 * @param {object} health
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @param {number} [limit]
 */
function formatHealthPriorities (health, tr, limit = 3) {
  const lines = []
  const worst = (health?.worst || []).slice(0, 2)
  for (const d of worst) {
    const label = tr(DIM_I18N[d.key] || 'healthDimPending')
    const tops = foldersForDimension(health, d.key).slice(0, 1)
    const folder = tops[0]?.path
    if (folder) {
      lines.push(tr('healthWeeklyPriorityDimFolder', { dim: label, folder }))
    } else {
      lines.push(tr('healthWeeklyPriorityDim', { dim: label }))
    }
  }
  if (lines.length < limit) {
    for (const f of topFoldersOverall(health, limit)) {
      if (lines.length >= limit) break
      const already = lines.some((l) => l.includes(f.path))
      if (already) continue
      lines.push(tr('healthWeeklyPriorityFolder', { folder: f.path }))
    }
  }
  return lines.slice(0, limit)
}

/**
 * Scoring standards table (Pro weekly).
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 */
function formatHealthScoreStandardsMarkdown (tr) {
  return [
    `## ${tr('healthWeeklyStandards')}`,
    '',
    `- ${tr('healthWeeklyStdPending')}`,
    `- ${tr('healthWeeklyStdDuplicate')}`,
    `- ${tr('healthWeeklyStdShort')}`,
    `- ${tr('healthWeeklyStdUrlOnly')}`,
    `- ${tr('healthWeeklyStdHighRisk')}`,
    `- ${tr('healthWeeklyStdGrades')}`,
    ''
  ]
}

/**
 * Weekly checkup MD — no note bodies, no keys.
 * Free: score + grade only (+ conclusion + upsell).
 * Pro: core analysis, dims, folders, govern excerpt, delta.
 *
 * @param {object} health
 * @param {object | null | undefined} governReport
 * @param {(k: string, v?: Record<string, string|number>) => string} tr
 * @param {{ tier?: HealthReportTier, prior?: object | null }} [opts]
 */
function formatWeeklyHealthMarkdown (health, governReport, tr, opts = {}) {
  const tier = opts.tier === 'pro' ? 'pro' : 'free'
  const prior = opts.prior || null
  const grade = gradeLabel(health, tr)

  const lines = [
    `# ${tr('healthWeeklyTitle')}`,
    '',
    `- ${tr('healthWeeklyScoredAt')}: ${health?.scoredAt || ''}`,
    `- ${tr('healthWeeklyScore')}: ${health?.score ?? '—'}（${grade}）`,
    `- ${tr('governReportTotal')}: ${health?.total ?? 0}`,
    ''
  ]

  lines.push(`## ${tr('healthWeeklyCoreAnalysis')}`, '')
  lines.push(`- ${formatHealthConclusion(health, tr, tier)}`, '')

  if (tier === 'pro' && prior && Number.isFinite(Number(prior.score))) {
    const delta = Number(health?.score || 0) - Number(prior.score)
    const sign = delta > 0 ? '+' : ''
    lines.push(
      `- ${tr('healthWeeklyDelta', {
        delta: `${sign}${delta}`,
        prev: prior.score,
        prevGrade: gradeLabel(prior, tr)
      })}`,
      ''
    )
  }

  if (tier === 'free') {
    lines.push(`_${tr('healthWeeklyProUpsell')}_`, '')
    lines.push(`_${tr('healthWeeklyFooter')}_`, '')
    return lines.join('\n')
  }

  const priorities = formatHealthPriorities(health, tr, 3)
  if (priorities.length) {
    lines.push(`## ${tr('healthWeeklyPriorityTitle')}`, '')
    for (const p of priorities) lines.push(`1. ${p}`)
    lines.push('')
  }

  lines.push(...formatHealthScoreStandardsMarkdown(tr))

  lines.push(`## ${tr('healthWeeklyDims')}`, '')
  for (const d of health?.dimensions || []) {
    const label = tr(DIM_I18N[d.key] || 'healthDimPending')
    lines.push(`- **${label}**: ${d.count} · ${tr('healthDimScoreHint', { score: d.score, weight: d.weight })}`)
  }

  lines.push('', `## ${tr('healthWeeklyTopFolders')}`, '')
  const tops = topFoldersOverall(health, 10)
  if (!tops.length) {
    lines.push(`- ${tr('healthFolderEmpty')}`)
  } else {
    lines.push(
      `| ${tr('healthFolderCol')} | ${tr('healthDimPending')} | ${tr('healthDimDuplicate')} | ${tr('healthDimShortBody')} | ${tr('healthDimUrlOnly')} |`,
      '| --- | ---: | ---: | ---: | ---: |'
    )
    for (const f of tops) {
      lines.push(
        `| ${f.path} | ${f.pending || 0} | ${f.duplicateTitle || 0} | ${f.bodyTooShort || 0} | ${f.urlOnly || 0} |`
      )
    }
  }

  if (governReport?.total) {
    lines.push('', `## ${tr('healthWeeklyGovernSection')}`, '')
    lines.push(
      `- ${tr('governHeroSummary', {
        total: governReport.total,
        high: governReport.highRisk || 0,
        medium: governReport.counts?.medium || 0
      })}`
    )
    const issues = (governReport.items || [])
      .filter((i) => i.risk === 'high' || i.risk === 'medium')
      .slice(0, 40)
    if (issues.length) {
      lines.push(
        '',
        `| ${tr('governReportPath')} | ${tr('governReportRisk')} | ${tr('governReportCodes')} |`,
        '| --- | --- | --- |'
      )
      for (const item of issues) {
        lines.push(`| ${item.path} | ${item.risk} | ${(item.codes || []).join(', ')} |`)
      }
    }
  }

  lines.push('', `_${tr('healthWeeklyFooter')}_`, '')
  return lines.join('\n')
}

/**
 * Paths flagged URL_ONLY_BODY in last Govern audit.
 * @param {object | null | undefined} governReport
 * @returns {Array<{ path: string, codes: string[] }>}
 */
function listUrlOnlyNotes (governReport) {
  return (governReport?.items || [])
    .filter((it) => Array.isArray(it?.codes) && it.codes.includes('URL_ONLY_BODY'))
    .map((it) => ({
      path: String(it.path || ''),
      codes: it.codes.slice()
    }))
    .filter((it) => it.path)
    .sort((a, b) => a.path.localeCompare(b.path))
}

module.exports = {
  DIM_FIELD,
  DIM_I18N,
  foldersForDimension,
  topFoldersOverall,
  gradeLabel,
  formatHealthConclusion,
  formatHealthPriorities,
  formatHealthScoreStandardsMarkdown,
  formatWeeklyHealthMarkdown,
  listUrlOnlyNotes
}
