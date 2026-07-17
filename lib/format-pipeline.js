'use strict'

const { canUseFormatFull } = require('./license')
const { normalizeFrontmatter } = require('./sync-frontmatter-i18n')

/** @typedef {{ path: string, title: string, body: string, frontmatter: Record<string, unknown>, rulesApplied: string[], skipped: boolean, skipReason?: string, unchanged?: boolean }} FormatCtx */

/** Free 可用：推到 IMA 前最常需要的结构/语法降级 */
const CORE_RULE_IDS = [
  'NORMALIZE_EOL',
  'TRIM_TRAILING_SPACE',
  'COLLAPSE_INLINE_SPACES',
  'COMMENT_STRIP',
  'HR_NORMALIZE',
  'WIKILINK',
  'HIGHLIGHT',
  'TASK_LIST',
  'BLOCK_ID_STRIP',
  'CALLOUT',
  'LIST_SPACING',
  'TABLE_SPACING',
  // 放在列表/表格间距之后，避免它们再插出多余空行
  'COLLAPSE_BLANKS',
  'ENSURE_H1'
]

/** Pro 专用：阅读体验增强（中英间距、标题跳级等） */
const PRO_RULE_IDS = [
  'HEADING_NORMALIZE',
  'CJK_SPACING',
  'PUNCT_NORMALIZE',
  'STRIP_HTML'
]

const PRESET_RULES = {
  minimal: [
    'NORMALIZE_EOL',
    'TRIM_TRAILING_SPACE',
    'COLLAPSE_INLINE_SPACES',
    'COLLAPSE_BLANKS',
    'COMMENT_STRIP'
  ],
  core: [...CORE_RULE_IDS],
  standard: [
    ...CORE_RULE_IDS,
    'HEADING_NORMALIZE',
    'PUNCT_NORMALIZE',
    'STRIP_HTML'
  ]
}

/** @param {Record<string, unknown>} [frontmatter] @param {object} [settings] */
function shouldFormatNote (frontmatter, settings) {
  if (settings?.format?.enabled === false) return false
  const fm = normalizeFrontmatter(frontmatter)
  const flag = String(fm?.format || '').trim().toLowerCase()
  if (flag === 'skip') return false
  return true
}

/**
 * @param {object} settings
 * @param {Record<string, unknown>} [frontmatter]
 * @returns {string[]}
 */
function resolveActiveRuleIds (settings, frontmatter = {}) {
  const fm = normalizeFrontmatter(frontmatter)
  const fmt = settings?.format || {}
  const preset = String(fmt.preset || 'core').trim()
  /** @type {string[]} */
  let base = PRESET_RULES[preset] ? [...PRESET_RULES[preset]] : [...PRESET_RULES.core]

  if (preset === 'custom' && fmt.rules && typeof fmt.rules === 'object') {
    base = Object.keys(fmt.rules).filter(k => fmt.rules[k] === true)
  }

  // Free 不可用 frontmatter format:force 绕过 Pro 规则（D-IS 门控）
  if (!canUseFormatFull(settings)) {
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

/** @param {string[]} ruleIds @param {(k: string) => string} tr */
function formatRuleLabels (ruleIds, tr) {
  return (ruleIds || []).map((id) => {
    const key = `formatRule_${id}`
    const label = tr(key)
    return label && label !== key ? label : id
  })
}

/** @param {string} body */
function ruleNormalizeEol (body) {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** @param {string} body */
function ruleTrimTrailingSpace (body) {
  return body.split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n')
}

/**
 * 行内连续空格/制表压成单个空格；保留行首缩进；跳过围栏代码与行内代码。
 * @param {string} body
 */
function ruleCollapseInlineSpaces (body) {
  const text = String(body || '')
  if (!text) return text
  const parts = []
  const re = /(```[\s\S]*?```|`[^`\n]+`)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    parts.push(collapseInlineSpacesOutsideCode(text.slice(last, m.index)))
    parts.push(m[0])
    last = m.index + m[0].length
  }
  parts.push(collapseInlineSpacesOutsideCode(text.slice(last)))
  return parts.join('')
}

/** @param {string} chunk */
function collapseInlineSpacesOutsideCode (chunk) {
  return chunk.split('\n').map((line) => {
    const m = line.match(/^([ \t]*)(.*)$/)
    if (!m) return line
    return m[1] + m[2].replace(/[ \t]{2,}/g, ' ')
  }).join('\n')
}

/** @param {string} body */
function ruleCollapseBlanks (body) {
  return body.replace(/\n{3,}/g, '\n\n')
}

/** @param {string} body */
function ruleCommentStrip (body) {
  return body
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/^\s*%%.*$/gm, '')
    // 去掉注释后可能残留的「字  字」双空格
    .replace(/([^ \t\n])[ \t]{2,}([^ \t\n])/g, '$1 $2')
}

/** @param {string} body */
function ruleHrNormalize (body) {
  return body.replace(/^(?:\*{3,}|_{3,})\s*$/gm, '---')
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

/** @param {string} body */
function ruleTaskList (body) {
  return body
    .replace(/^(\s*)[-*+]\s+\[(?:x|X)\]\s+/gm, '$1- ☑ ')
    .replace(/^(\s*)[-*+]\s+\[\s?\]\s+/gm, '$1- ☐ ')
}

/** @param {string} body */
function ruleBlockIdStrip (body) {
  return body
    .replace(/\s+\^[a-zA-Z0-9_-]+\s*$/gm, '')
    .replace(/\[\[([^\]|#]+)#\^[^\]]+\]\]/g, '$1')
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

/**
 * 列表与前后非列表段落之间保留至多一个空行；列表项之间不插空行。
 * @param {string} body
 */
function ruleListSpacing (body) {
  const lines = String(body || '').split('\n')
  /** @type {string[]} */
  const out = []
  const isList = (l) => /^(?:[ \t]*[-*+] |\d+\. )/.test(l)
  const isBlank = (l) => l == null || !String(l).trim()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = out.length ? out[out.length - 1] : null
    if (prev != null && !isBlank(prev) && !isBlank(line)) {
      if (isList(prev) !== isList(line)) out.push('')
    }
    out.push(line)
  }
  // 去掉列表项之间已有的多余空行
  return out.join('\n').replace(
    /(^(?:[ \t]*[-*+] |\d+\. ).+)\n\n+(?=^(?:[ \t]*[-*+] |\d+\. ))/gm,
    '$1\n'
  )
}

/** @param {string} body */
function ruleTableSpacing (body) {
  const lines = String(body || '').split('\n')
  /** @type {string[]} */
  const out = []
  const isTable = (l) => /^\|.*\|/.test(l)
  const isBlank = (l) => l == null || !String(l).trim()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = out.length ? out[out.length - 1] : null
    if (prev != null && !isBlank(prev) && !isBlank(line)) {
      if (isTable(prev) !== isTable(line)) out.push('')
    }
    out.push(line)
  }
  return out.join('\n').replace(
    /(^\|.*\|)\n\n+(?=^\|)/gm,
    '$1\n'
  )
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
  COLLAPSE_INLINE_SPACES: (body) => ruleCollapseInlineSpaces(body),
  COLLAPSE_BLANKS: (body) => ruleCollapseBlanks(body),
  COMMENT_STRIP: (body) => ruleCommentStrip(body),
  HR_NORMALIZE: (body) => ruleHrNormalize(body),
  WIKILINK: (body) => ruleWikilink(body),
  HIGHLIGHT: (body) => ruleHighlight(body),
  TASK_LIST: (body) => ruleTaskList(body),
  BLOCK_ID_STRIP: (body) => ruleBlockIdStrip(body),
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
  formatRuleLabels,
  formatForIma,
  pickContentHashBody,
  rebuildNoteRaw,
  ruleNormalizeEol,
  ruleCollapseInlineSpaces,
  ruleCollapseBlanks,
  ruleListSpacing,
  ruleWikilink,
  ruleHighlight,
  ruleTaskList,
  ruleCommentStrip,
  ruleCallout,
  ruleCjkSpacing,
  ruleEnsureH1
}
