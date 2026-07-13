'use strict'

const { canUseFormatFull } = require('./license')

/** @typedef {{ path: string, title: string, body: string, frontmatter: Record<string, unknown>, rulesApplied: string[], skipped: boolean, skipReason?: string, unchanged?: boolean }} FormatCtx */

const CORE_RULE_IDS = [
  'NORMALIZE_EOL',
  'TRIM_TRAILING_SPACE',
  'COLLAPSE_BLANKS',
  'WIKILINK',
  'HIGHLIGHT',
  'ENSURE_H1'
]

const PRO_RULE_IDS = [
  'CALLOUT',
  'LIST_SPACING',
  'TABLE_SPACING',
  'HEADING_NORMALIZE',
  'CJK_SPACING',
  'PUNCT_NORMALIZE',
  'STRIP_HTML'
]

const PRESET_RULES = {
  minimal: ['NORMALIZE_EOL', 'TRIM_TRAILING_SPACE'],
  core: [...CORE_RULE_IDS],
  standard: [
    ...CORE_RULE_IDS,
    'CALLOUT',
    'LIST_SPACING',
    'TABLE_SPACING',
    'PUNCT_NORMALIZE',
    'STRIP_HTML'
  ]
}

/** @param {Record<string, unknown>} [frontmatter] @param {object} [settings] */
function shouldFormatNote (frontmatter, settings) {
  if (settings?.format?.enabled === false) return false
  const flag = String(frontmatter?.format || '').trim().toLowerCase()
  if (flag === 'skip') return false
  return true
}

/**
 * @param {object} settings
 * @param {Record<string, unknown>} [frontmatter]
 * @returns {string[]}
 */
function resolveActiveRuleIds (settings, frontmatter = {}) {
  const fmt = settings?.format || {}
  const forceFull = String(frontmatter?.format || '').trim().toLowerCase() === 'force'
  const preset = String(fmt.preset || 'core').trim()
  /** @type {string[]} */
  let base = PRESET_RULES[preset] ? [...PRESET_RULES[preset]] : [...PRESET_RULES.core]

  if (preset === 'custom' && fmt.rules && typeof fmt.rules === 'object') {
    base = Object.keys(fmt.rules).filter(k => fmt.rules[k] === true)
  }

  if (!canUseFormatFull(settings) && !forceFull) {
    base = base.filter(id => CORE_RULE_IDS.includes(id))
  }

  if (fmt.cjkSpacing === true && canUseFormatFull(settings)) {
    if (!base.includes('CJK_SPACING')) base.push('CJK_SPACING')
  }
  if (fmt.headingNormalize === true && canUseFormatFull(settings)) {
    if (!base.includes('HEADING_NORMALIZE')) base.push('HEADING_NORMALIZE')
  }

  return [...new Set(base)]
}

/** @param {string} body */
function ruleNormalizeEol (body) {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** @param {string} body */
function ruleTrimTrailingSpace (body) {
  return body.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
}

/** @param {string} body */
function ruleCollapseBlanks (body) {
  return body.replace(/\n{3,}/g, '\n\n')
}

/** @param {string} body */
function ruleWikilink (body) {
  return body
    .replace(/!\[\[([^\]|#]+)(?:\|([^\]]*))?(?:#[^\]]*)?\]\]/g, (_m, target, alias) => {
      const name = String(alias || target || '').trim()
      return name ? `![${name}](${String(target).trim()})` : ''
    })
    .replace(/\[\[([^\]|#]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, '$1')
}

/** @param {string} body */
function ruleHighlight (body) {
  return body.replace(/==([^=\n]+)==/g, '**$1**')
}

/**
 * @param {string} body
 * @param {string} title
 */
function ruleEnsureH1 (body, title) {
  const trimmed = body.trimStart()
  if (/^#\s/.test(trimmed)) return body
  const safeTitle = String(title || '').trim()
  if (!safeTitle) return body
  return `# ${safeTitle}\n\n${body.trim()}`
}

/** @param {string} body */
function ruleCallout (body) {
  return body.replace(
    /^>\s*\[!(\w+)\]\s*(.*)\n((?:>.*\n?)*)/gm,
    (_m, _type, title, rest) => {
      const lines = String(rest || '')
        .split('\n')
        .map(l => l.replace(/^>\s?/, '').trim())
        .filter(Boolean)
      const head = String(title || '').trim()
      const block = head ? `> **${head}**\n` : '> \n'
      return block + lines.map(l => `> ${l}`).join('\n') + '\n'
    }
  )
}

/** @param {string} body */
function ruleListSpacing (body) {
  return body
    .replace(/([^\n])\n([-*+] |\d+\. )/g, '$1\n\n$2')
    .replace(/(^[-*+] .+\n(?:  .+\n)*)/gm, '$1\n')
}

/** @param {string} body */
function ruleTableSpacing (body) {
  return body
    .replace(/([^\n])\n(\|[^\n]+\|)/g, '$1\n\n$2')
    .replace(/((?:\|[^\n]+\|\n)+)/g, '$1\n')
}

/** @param {string} body */
function ruleHeadingNormalize (body) {
  const lines = body.split('\n')
  let lastLevel = 0
  return lines.map(line => {
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (!m) return line
    let level = m[1].length
    if (lastLevel > 0 && level > lastLevel + 1) {
      level = lastLevel + 1
      lastLevel = level
      return `${'#'.repeat(level)} ${m[2]}`
    }
    lastLevel = level
    return line
  }).join('\n')
}

/** @param {string} body */
function ruleCjkSpacing (body) {
  return body
    .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, '$1 $2')
}

/** @param {string} body */
function rulePunctNormalize (body) {
  return body
    .replace(/，/g, ',')
    .replace(/。/g, '.')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
}

/** @param {string} body */
function ruleStripHtml (body) {
  return body.replace(/<[^>\n]+>/g, '')
}

const RULE_FNS = {
  NORMALIZE_EOL: (body) => ruleNormalizeEol(body),
  TRIM_TRAILING_SPACE: (body) => ruleTrimTrailingSpace(body),
  COLLAPSE_BLANKS: (body) => ruleCollapseBlanks(body),
  WIKILINK: (body) => ruleWikilink(body),
  HIGHLIGHT: (body) => ruleHighlight(body),
  ENSURE_H1: (body, ctx) => ruleEnsureH1(body, ctx.title),
  CALLOUT: (body) => ruleCallout(body),
  LIST_SPACING: (body) => ruleListSpacing(body),
  TABLE_SPACING: (body) => ruleTableSpacing(body),
  HEADING_NORMALIZE: (body) => ruleHeadingNormalize(body),
  CJK_SPACING: (body) => ruleCjkSpacing(body),
  PUNCT_NORMALIZE: (body) => rulePunctNormalize(body),
  STRIP_HTML: (body) => ruleStripHtml(body)
}

/**
 * @param {Omit<FormatCtx, 'rulesApplied'|'skipped'|'skipReason'|'unchanged'>} input
 * @param {object} [settings]
 * @returns {FormatCtx}
 */
function formatForIma (input, settings = {}) {
  const ctx = {
    path: input.path || '',
    title: input.title || '',
    body: String(input.body || ''),
    frontmatter: input.frontmatter || {},
    rulesApplied: [],
    skipped: false
  }

  if (!shouldFormatNote(ctx.frontmatter, settings)) {
    ctx.skipped = true
    ctx.skipReason = 'DISABLED_OR_SKIP'
    ctx.unchanged = true
    return ctx
  }

  const before = ctx.body
  const ruleIds = resolveActiveRuleIds(settings, ctx.frontmatter)

  for (const id of ruleIds) {
    const fn = RULE_FNS[id]
    if (!fn) continue
    const next = fn(ctx.body, ctx)
    if (next !== ctx.body) {
      ctx.body = next
      ctx.rulesApplied.push(id)
    }
  }

  ctx.body = ctx.body.trim()
  ctx.unchanged = ctx.body === String(before || '').trim()
  if (ctx.unchanged && !ctx.rulesApplied.length) {
    ctx.skipped = true
    ctx.skipReason = 'UNCHANGED'
  }

  return ctx
}

/**
 * @param {string} localBody
 * @param {string} formattedBody
 * @param {object} [settings]
 */
function pickContentHashBody (localBody, formattedBody, settings = {}) {
  return settings?.format?.hashSource === 'formatted' ? formattedBody : localBody
}

/**
 * @param {string} raw
 * @param {string} newBody
 */
function rebuildNoteRaw (raw, newBody) {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (m) return `---\n${m[1].trim()}\n---\n\n${String(newBody).trim()}\n`
  return `${String(newBody).trim()}\n`
}

module.exports = {
  CORE_RULE_IDS,
  PRO_RULE_IDS,
  PRESET_RULES,
  shouldFormatNote,
  resolveActiveRuleIds,
  formatForIma,
  pickContentHashBody,
  rebuildNoteRaw,
  ruleNormalizeEol,
  ruleWikilink,
  ruleHighlight,
  ruleCjkSpacing,
  ruleEnsureH1
}
