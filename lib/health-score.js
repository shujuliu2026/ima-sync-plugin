'use strict'

const { normalizeTitleKey } = require('./govern-rules')

/** @typedef {'excellent'|'good'|'needs_work'} HealthGrade */

const DEFAULT_WEIGHTS = {
  pending: 25,
  duplicateTitle: 25,
  bodyTooShort: 25,
  urlOnly: 25
}

/**
 * @param {number} ratio 0～1
 * @param {number} weight
 * @param {number} [soft] start deduct
 * @param {number} [hard] zero score
 */
function scoreByRatio (ratio, weight, soft = 0.2, hard = 0.5) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0))
  const w = Math.max(0, Number(weight) || 0)
  if (r <= soft) return w
  if (r >= hard) return 0
  const span = hard - soft || 0.3
  return Math.round(w * (1 - (r - soft) / span))
}

/**
 * @param {number} score 0～100
 * @returns {HealthGrade}
 */
function gradeFromScore (score) {
  const n = Math.max(0, Math.min(100, Number(score) || 0))
  if (n >= 80) return 'excellent'
  if (n >= 60) return 'good'
  return 'needs_work'
}

/**
 * @param {string} path
 */
function folderOf (path) {
  const p = String(path || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i <= 0 ? '(root)' : p.slice(0, i)
}

/**
 * @param {object | undefined} frontmatter
 * @returns {'synced'|'pending'|'failed'|'conflict'}
 */
function classifySync (frontmatter) {
  const sync = frontmatter?.sync?.ima
  if (sync === 'synced') return 'synced'
  if (sync === 'failed') return 'failed'
  if (sync === 'conflict') return 'conflict'
  return 'pending'
}

/**
 * @param {ReturnType<import('./govern-rules').auditNotes>} audit
 * @param {Array<{ path: string, title?: string, frontmatter?: object }>} notes
 * @param {object} [settings]
 */
function buildHealthReport (audit, notes, settings) {
  const weights = { ...DEFAULT_WEIGHTS, ...(settings?.govern?.healthWeights || {}) }
  const total = Number(audit?.total) || (notes || []).length || 0
  const items = audit?.items || []
  const noteByPath = new Map((notes || []).map(n => [n.path, n]))

  let pending = 0
  let shortBody = 0
  let urlOnly = 0
  let highRisk = 0
  /** @type {Map<string, string[]>} */
  const titlePaths = new Map()

  for (const it of items) {
    const note = noteByPath.get(it.path)
    const sync = classifySync(note?.frontmatter)
    if (sync === 'pending') pending++
    if ((it.codes || []).includes('BODY_TOO_SHORT')) shortBody++
    if ((it.codes || []).includes('URL_ONLY_BODY')) urlOnly++
    if (it.risk === 'high') highRisk++
    const key = normalizeTitleKey(it.title || note?.title || '')
    if (key) {
      if (!titlePaths.has(key)) titlePaths.set(key, [])
      titlePaths.get(key).push(it.path)
    }
  }

  let duplicateNotes = 0
  let duplicateGroups = 0
  for (const paths of titlePaths.values()) {
    if (paths.length >= 2) {
      duplicateGroups++
      duplicateNotes += paths.length
    }
  }

  const dimPending = {
    key: 'pending',
    count: pending,
    ratio: total ? pending / total : 0,
    score: scoreByRatio(total ? pending / total : 0, weights.pending),
    weight: weights.pending
  }
  const dimDup = {
    key: 'duplicateTitle',
    count: duplicateNotes,
    groups: duplicateGroups,
    ratio: total ? duplicateNotes / total : 0,
    score: scoreByRatio(total ? duplicateNotes / total : 0, weights.duplicateTitle),
    weight: weights.duplicateTitle
  }
  const dimShort = {
    key: 'bodyTooShort',
    count: shortBody,
    ratio: total ? shortBody / total : 0,
    score: scoreByRatio(total ? shortBody / total : 0, weights.bodyTooShort),
    weight: weights.bodyTooShort
  }
  const dimUrl = {
    key: 'urlOnly',
    count: urlOnly,
    ratio: total ? urlOnly / total : 0,
    score: scoreByRatio(total ? urlOnly / total : 0, weights.urlOnly),
    weight: weights.urlOnly
  }

  let score = dimPending.score + dimDup.score + dimShort.score + dimUrl.score
  const highPenalty = Math.min(score, highRisk * 2)
  score = Math.max(0, Math.min(100, score - highPenalty))

  const dimensions = [dimPending, dimDup, dimShort, dimUrl]
  const worst = [...dimensions]
    .map(d => ({ ...d, gap: d.weight - d.score }))
    .filter(d => d.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2)

  /** @type {Record<string, { path: string, pending: number, duplicateTitle: number, bodyTooShort: number, urlOnly: number, high: number }>} */
  const byFolder = {}
  for (const it of items) {
    const folder = folderOf(it.path)
    if (!byFolder[folder]) {
      byFolder[folder] = {
        path: folder,
        pending: 0,
        duplicateTitle: 0,
        bodyTooShort: 0,
        urlOnly: 0,
        high: 0
      }
    }
    const bucket = byFolder[folder]
    const note = noteByPath.get(it.path)
    if (classifySync(note?.frontmatter) === 'pending') bucket.pending++
    const codes = it.codes || []
    if (codes.includes('DUPLICATE_TITLE')) bucket.duplicateTitle++
    if (codes.includes('BODY_TOO_SHORT')) bucket.bodyTooShort++
    if (codes.includes('URL_ONLY_BODY')) bucket.urlOnly++
    if (it.risk === 'high') bucket.high++
  }

  return {
    scoredAt: audit?.auditedAt || new Date().toISOString(),
    total,
    score,
    grade: gradeFromScore(score),
    highRisk,
    highPenalty,
    dimensions,
    worst,
    byFolder,
    counts: {
      pending,
      duplicateTitle: duplicateNotes,
      duplicateGroups,
      bodyTooShort: shortBody,
      urlOnly
    }
  }
}

module.exports = {
  DEFAULT_WEIGHTS,
  scoreByRatio,
  gradeFromScore,
  folderOf,
  classifySync,
  buildHealthReport
}
