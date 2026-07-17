'use strict'

/**
 * 同步元数据 frontmatter 中英对照。
 * 磁盘可写中文键/值（中文 UI）；引擎读写前一律 normalize 为英文规范键。
 */

const TOP_KEY_ZH_TO_EN = {
  同步: 'sync',
  同步错误: 'ima_sync_error',
  同步时间: 'ima_sync_at',
  文档编号: 'ima_doc_id',
  文档ID: 'ima_doc_id',
  内容指纹: 'ima_content_hash',
  导入键: 'import_key',
  排版: 'format',
  核验时间: 'ima_verify_at',
  核验查询: 'ima_verify_query',
  核验详情: 'ima_verify_detail'
}

const TOP_KEY_EN_TO_ZH = {
  sync: '同步',
  ima_sync_error: '同步错误',
  ima_sync_at: '同步时间',
  ima_doc_id: '文档编号',
  ima_content_hash: '内容指纹',
  import_key: '导入键',
  format: '排版',
  ima_verify_at: '核验时间',
  ima_verify_query: '核验查询',
  ima_verify_detail: '核验详情'
}

const SYNC_NESTED_ZH_TO_EN = {
  状态: 'ima',
  核验: 'ima_verify'
}

const FORMAT_NESTED_ZH_TO_EN = {
  上次推送: 'last_push',
  状态: 'status',
  已应用规则: 'rules_applied',
  跳过: 'skip'
}

/** @type {Record<string, string[]>} */
const SYNC_IMA_ALIASES = {
  synced: ['synced', '已同步'],
  pending: ['pending', '待同步'],
  failed: ['failed', 'error', '失败'],
  conflict: ['conflict', '冲突']
}

/** @type {Record<string, string[]>} */
const VERIFY_ALIASES = {
  verified: ['verified', '已核验', '已通过'],
  failed: ['failed', '核验失败', '未通过'],
  skipped: ['skipped', '已跳过'],
  pending: ['pending', '待核验']
}

/** @type {Record<string, string[]>} */
const FORMAT_STATUS_ALIASES = {
  formatted: ['formatted', '已排版']
}

const RULE_ID_TO_ZH = {
  NORMALIZE_EOL: '统一换行',
  TRIM_TRAILING_SPACE: '去行尾空格',
  COLLAPSE_INLINE_SPACES: '合并行内空格',
  COLLAPSE_BLANKS: '合并空行',
  COMMENT_STRIP: '去掉注释',
  HR_NORMALIZE: '分割线规范化',
  WIKILINK: '双链转纯文本',
  HIGHLIGHT: '高亮转加粗',
  TASK_LIST: '任务列表对齐',
  BLOCK_ID_STRIP: '去掉块引用ID',
  CALLOUT: '提示框降级',
  LIST_SPACING: '列表间距',
  TABLE_SPACING: '表格间距',
  ENSURE_H1: '补一级标题',
  HEADING_NORMALIZE: '标题层级',
  CJK_SPACING: '中英间距',
  PUNCT_NORMALIZE: '标点统一',
  STRIP_HTML: '清除HTML'
}

const RULE_ZH_TO_ID = Object.fromEntries(
  Object.entries(RULE_ID_TO_ZH).map(([id, zh]) => [zh, id])
)

/** @param {string} v @param {Record<string, string[]>} table */
function canonFromAliases (v, table) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  for (const [canon, alts] of Object.entries(table)) {
    if (alts.includes(s)) return canon
  }
  return s
}

/** @param {string} canon @param {'zh'|'en'} lang @param {Record<string, string[]>} table */
function labelFromCanon (canon, lang, table) {
  const alts = table[canon]
  if (!alts || !alts.length) return canon
  return lang === 'en' ? alts[0] : (alts.find(a => /[\u4e00-\u9fff]/.test(a)) || alts[0])
}

/** @param {unknown} raw */
function pickRaw (fm, enKey, zhKey) {
  if (!fm || typeof fm !== 'object') return undefined
  if (fm[enKey] !== undefined && fm[enKey] !== null && fm[enKey] !== '') return fm[enKey]
  if (zhKey && fm[zhKey] !== undefined) return fm[zhKey]
  return fm[enKey]
}

/**
 * 将磁盘 frontmatter（中/英键值）规范为引擎英文键。
 * @param {Record<string, unknown>} [fm]
 * @returns {Record<string, unknown>}
 */
function normalizeFrontmatter (fm) {
  if (!fm || typeof fm !== 'object') return {}
  /** @type {Record<string, unknown>} */
  const out = { ...fm }

  for (const [zh, en] of Object.entries(TOP_KEY_ZH_TO_EN)) {
    if (out[zh] !== undefined && (out[en] === undefined || out[en] === null || out[en] === '')) {
      out[en] = out[zh]
    }
  }

  const syncRaw = out.sync ?? out['同步']
  if (syncRaw && typeof syncRaw === 'object' && !Array.isArray(syncRaw)) {
    /** @type {Record<string, unknown>} */
    const sync = {}
    const src = /** @type {Record<string, unknown>} */ (syncRaw)
    const ima = src.ima ?? src['状态']
    const verify = src.ima_verify ?? src['核验']
    if (ima !== undefined && ima !== null && ima !== '') {
      sync.ima = canonFromAliases(String(ima), SYNC_IMA_ALIASES)
    }
    if (verify !== undefined && verify !== null && verify !== '') {
      sync.ima_verify = canonFromAliases(String(verify), VERIFY_ALIASES)
    }
    out.sync = sync
  }

  const formatRaw = out.format ?? out['排版']
  if (typeof formatRaw === 'string') {
    const flag = formatRaw.trim()
    if (flag === '跳过' || flag.toLowerCase() === 'skip') out.format = 'skip'
    else if (flag === '强制' || flag.toLowerCase() === 'force') out.format = 'force'
    else out.format = flag
  } else if (formatRaw && typeof formatRaw === 'object' && !Array.isArray(formatRaw)) {
    const src = /** @type {Record<string, unknown>} */ (formatRaw)
    /** @type {Record<string, unknown>} */
    const format = {}
    const lastPush = src.last_push ?? src['上次推送']
    const status = src.status ?? src['状态']
    const rules = src.rules_applied ?? src['已应用规则']
    if (lastPush !== undefined) format.last_push = lastPush
    if (status !== undefined && status !== null && status !== '') {
      format.status = canonFromAliases(String(status), FORMAT_STATUS_ALIASES)
    }
    if (rules !== undefined) format.rules_applied = normalizeRulesApplied(rules)
    out.format = format
  }

  if (out.ima_sync_error === undefined && out['同步错误'] !== undefined) {
    out.ima_sync_error = out['同步错误']
  }
  if (out.ima_sync_at === undefined && out['同步时间'] !== undefined) {
    out.ima_sync_at = out['同步时间']
  }
  if (out.ima_doc_id === undefined && (out['文档编号'] !== undefined || out['文档ID'] !== undefined)) {
    out.ima_doc_id = out['文档编号'] ?? out['文档ID']
  }
  if (out.ima_content_hash === undefined && out['内容指纹'] !== undefined) {
    out.ima_content_hash = out['内容指纹']
  }
  if (out.import_key === undefined && out['导入键'] !== undefined) {
    out.import_key = out['导入键']
  }
  if (out.ima_verify_at === undefined && out['核验时间'] !== undefined) {
    out.ima_verify_at = out['核验时间']
  }
  if (out.ima_verify_query === undefined && out['核验查询'] !== undefined) {
    out.ima_verify_query = out['核验查询']
  }
  if (out.ima_verify_detail === undefined && out['核验详情'] !== undefined) {
    out.ima_verify_detail = out['核验详情']
  }

  return out
}

/** @param {unknown} rules */
function normalizeRulesApplied (rules) {
  const raw = Array.isArray(rules) ? rules.join(',') : String(rules || '')
  if (!raw.trim()) return ''
  return raw
    .split(/[,，]/)
    .map((part) => {
      const s = part.trim()
      if (!s) return ''
      if (RULE_ID_TO_ZH[s]) return s
      if (RULE_ZH_TO_ID[s]) return RULE_ZH_TO_ID[s]
      return s
    })
    .filter(Boolean)
    .join(',')
}

/**
 * @param {string[]} ruleIds
 * @param {'zh'|'en'} lang
 */
function formatRulesForFrontmatter (ruleIds, lang) {
  return (ruleIds || [])
    .map((id) => (lang === 'en' ? id : (RULE_ID_TO_ZH[id] || id)))
    .filter(Boolean)
    .join(',')
}

/** 清除所有已知中/英同步键，避免双语并存 */
function clearImaSyncKeys (fm) {
  if (!fm || typeof fm !== 'object') return
  for (const k of Object.keys(TOP_KEY_EN_TO_ZH)) delete fm[k]
  for (const k of Object.keys(TOP_KEY_ZH_TO_EN)) delete fm[k]
}

/**
 * 仅保留用户手动开关（跳过/强制）；推送审计块（上次推送/已应用规则）不再写盘。
 * @param {unknown} format
 * @returns {'skip'|'force'|string|null}
 */
function compactFormatFlag (format) {
  if (typeof format === 'string') {
    const s = format.trim()
    if (!s) return null
    if (s === '跳过' || s.toLowerCase() === 'skip') return 'skip'
    if (s === '强制' || s.toLowerCase() === 'force') return 'force'
    return null
  }
  return null
}

/**
 * 写盘精简策略（核心信息）：
 * - 必写：同步.状态 / 同步.核验(若有) / 文档编号 / 内容指纹 / 导入键 / 同步时间
 * - 失败时才写：同步错误、核验详情
 * - 不写：空串、核验时间/查询、排版审计块（上次推送/规则列表）
 * - 仍保留用户手动：排版: 跳过|强制
 *
 * @param {Record<string, unknown>} fm
 * @param {{
 *   syncIma?: string,
 *   syncVerify?: string,
 *   syncError?: string,
 *   syncAt?: string,
 *   docId?: string,
 *   contentHash?: string,
 *   importKey?: string,
 *   format?: Record<string, unknown>|string|null,
 *   verifyAt?: string,
 *   verifyQuery?: string,
 *   verifyDetail?: string,
 *   clearVerify?: boolean
 * }} patch
 * @param {'zh'|'en'} lang
 */
function patchImaFrontmatter (fm, patch, lang) {
  const cur = normalizeFrontmatter(fm)
  const syncIma = patch.syncIma !== undefined ? patch.syncIma : cur.sync?.ima
  const syncVerify = patch.syncVerify !== undefined
    ? patch.syncVerify
    : (/** @type {{ ima_verify?: string }} */ (cur.sync || {})).ima_verify
  const syncErrorRaw = patch.syncError !== undefined ? patch.syncError : cur.ima_sync_error
  const syncError = syncErrorRaw != null && String(syncErrorRaw).trim() !== ''
    ? String(syncErrorRaw)
    : undefined
  const syncAt = patch.syncAt !== undefined ? patch.syncAt : cur.ima_sync_at
  const docId = patch.docId !== undefined ? patch.docId : cur.ima_doc_id
  const contentHash = patch.contentHash !== undefined ? patch.contentHash : cur.ima_content_hash
  const importKey = patch.importKey !== undefined ? patch.importKey : cur.import_key
  const formatSrc = patch.format !== undefined ? patch.format : cur.format
  const formatFlag = compactFormatFlag(formatSrc)
  const verifyDetailRaw = patch.clearVerify
    ? undefined
    : (patch.verifyDetail !== undefined ? patch.verifyDetail : cur.ima_verify_detail)
  const verifyDetail = verifyDetailRaw != null && String(verifyDetailRaw).trim() !== ''
    ? String(verifyDetailRaw).slice(0, 120)
    : undefined

  clearImaSyncKeys(fm)

  const useZh = lang !== 'en'

  if (useZh) {
    /** @type {Record<string, string>} */
    const syncObj = {}
    if (syncIma) syncObj['状态'] = labelFromCanon(String(syncIma), 'zh', SYNC_IMA_ALIASES)
    if (syncVerify) syncObj['核验'] = labelFromCanon(String(syncVerify), 'zh', VERIFY_ALIASES)
    if (Object.keys(syncObj).length) fm['同步'] = syncObj

    if (syncError) fm['同步错误'] = syncError
    if (syncAt) fm['同步时间'] = syncAt
    if (docId) fm['文档编号'] = docId
    if (contentHash) fm['内容指纹'] = contentHash
    if (importKey) fm['导入键'] = importKey
    if (formatFlag === 'skip') fm['排版'] = '跳过'
    else if (formatFlag === 'force') fm['排版'] = '强制'
    if (verifyDetail) fm['核验详情'] = verifyDetail
    return
  }

  /** @type {Record<string, string>} */
  const syncObj = {}
  if (syncIma) syncObj.ima = String(syncIma)
  if (syncVerify) syncObj.ima_verify = String(syncVerify)
  if (Object.keys(syncObj).length) fm.sync = syncObj

  if (syncError) fm.ima_sync_error = syncError
  if (syncAt) fm.ima_sync_at = syncAt
  if (docId) fm.ima_doc_id = docId
  if (contentHash) fm.ima_content_hash = contentHash
  if (importKey) fm.import_key = importKey
  if (formatFlag) fm.format = formatFlag
  if (verifyDetail) fm.ima_verify_detail = verifyDetail
}

/**
 * @param {Record<string, unknown>} fm
 * @param {object} remote
 * @param {string} contentHash
 * @param {'zh'|'en'} lang
 * @returns {string} YAML block inner (no ---)
 */
function buildLocalizedFrontmatterYaml (fm, remote, contentHash, lang) {
  const cur = normalizeFrontmatter(fm)
  /** @type {Record<string, unknown>} */
  const scratch = { ...cur }
  patchImaFrontmatter(scratch, {
    syncIma: 'synced',
    syncError: '',
    syncAt: new Date().toISOString(),
    docId: remote.doc_id,
    contentHash,
    importKey: cur.import_key || remote.external_id || remote.import_key || cur.title
  }, lang)

  const lines = []
  for (const [k, v] of Object.entries(scratch)) {
    if (v === undefined) continue
    if (k === 'sync' || k === '同步' || k === 'format' || k === '排版') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        lines.push(`${k}:`)
        for (const [sk, sv] of Object.entries(v)) {
          lines.push(`  ${sk}: ${yamlScalar(sv)}`)
        }
      } else {
        lines.push(`${k}: ${yamlScalar(v)}`)
      }
      continue
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      lines.push(`${k}:`)
      for (const [sk, sv] of Object.entries(v)) {
        lines.push(`  ${sk}: ${yamlScalar(sv)}`)
      }
      continue
    }
    lines.push(`${k}: ${yamlScalar(v)}`)
  }
  return lines.join('\n')
}

/** @param {unknown} v */
function yamlScalar (v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) {
    try { return JSON.stringify(v) } catch { return '[]' }
  }
  const s = String(v)
  if (/[:#\[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s) || s === '') {
    return JSON.stringify(s)
  }
  return s
}

module.exports = {
  normalizeFrontmatter,
  patchImaFrontmatter,
  clearImaSyncKeys,
  formatRulesForFrontmatter,
  buildLocalizedFrontmatterYaml,
  canonSyncIma: (v) => canonFromAliases(String(v || ''), SYNC_IMA_ALIASES),
  canonVerify: (v) => canonFromAliases(String(v || ''), VERIFY_ALIASES),
  TOP_KEY_ZH_TO_EN,
  RULE_ID_TO_ZH
}
