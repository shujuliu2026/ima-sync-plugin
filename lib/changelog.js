'use strict'

/** 与 manifest.json version 保持同步 */
const PLUGIN_VERSION = '1.5.41'

/** 更新历史禁止出现打赏/捐款/赞赏/赞助等措辞（功能可在关于页展示，不入 changelog） */
const CHANGELOG_FORBIDDEN = /打赏|捐款|赞赏|赞助|支付宝|ima\.install|后台统计|安装.*统计|安装.*上报|自动.*统计/

/**
 * @typedef {{ version: string, date?: string, zh: string[], en: string[] }} ChangelogEntry
 */

/** @type {ChangelogEntry[]} 新版本在前 */
/** 1.5.36+ 为静默更新：manifest 递增，用户可见更新历史止于 1.5.35；1.5.39 起 Trust Pro 可见 */
const CHANGELOG = [
  {
    version: '1.5.41',
    date: '2026-07-13',
    zh: [
      'Pro 授权收紧：正式包须通过云端 License 激活，本地测试 bypass 已关闭',
      '云权益包强制验签，防止缓存被篡改',
      '匿名遥测改为默认关闭，首次启动提示可在设置中开启',
      '远程公告支持 max_version，可对旧版用户定向推送升级提示'
    ],
    en: [
      'Pro licensing tightened: production builds require cloud License activation',
      'Cloud entitlements must pass signature verification',
      'Anonymous telemetry off by default; first-run hint to opt in via Settings',
      'Remote notices support max_version for targeted upgrade prompts on older builds'
    ]
  },
  {
    version: '1.5.40',
    date: '2026-07-13',
    zh: [
      '连接、知识库、定时同步、Key 到期等设置项增加 ? 帮助',
      '侧栏 Trust / 治理、刷新、反馈等关键点补充可点击说明',
      '文案去技术化：统计、笔记状态、限频参数等更贴近日常用户'
    ],
    en: [
      'Help (?) on connection, KB, schedule, key expiry, and more settings',
      'Panel tips for Trust, Govern, refresh, and feedback',
      'Plain-language copy for stats, note status, and rate-limit options'
    ]
  },
  {
    version: '1.5.39',
    date: '2026-07-12',
    zh: [
      'Pro Trust：侧栏「IMA 里搜得到吗？」Hero、可检索百分比、验证失败列表',
      '推送后自动验证可检索（默认等待 2s + 重试）、智能去重、同步报告导出',
      'Free 用户侧栏常驻 Trust 痛点引导；设置内可测试 Trust API 与鉴权诊断',
      '批量结束可选自动保存报告至 _ima-sync/reports/',
      '连接设置可填 API Key 到期日：到期前弹窗/横幅提醒，鉴权失败时引导续期'
    ],
    en: [
      'Pro Trust: sidebar hero “Searchable on IMA?”, searchable %, verify-fail list',
      'Post-push verify (2s delay + retries), dedup, sync report export',
      'Free users see Trust pain-point CTA; settings: Test Trust API + auth hints',
      'Optional auto-save batch report to _ima-sync/reports/',
      'Connection: API Key expiry date with modal/banner reminders before renewal'
    ]
  },
  {
    version: '1.5.35',
    date: '2026-06-17',
    zh: [
      '修复侧栏刷新按钮在库已加载后仍一直转圈（vault 就绪等待加超时、busy 态与 DOM 同步）',
      'Obsidian 布局就绪后不再长期显示「库索引加载中」，改为连接检测'
    ],
    en: [
      'Fix refresh button spinning after vault is loaded (vault-ready timeout + busy state sync)',
      'After Obsidian layout is ready, show connection check instead of long vault indexing'
    ]
  },
  {
    version: '1.5.34',
    date: '2026-06-16 22:00',
    zh: [
      '批量推送显示篇数进度与每篇 ✓/✗ 日志，完成后写入侧栏日志',
      '单篇上传增加超时（含 frontmatter 写入），避免永久卡在「正在上传」',
      '纯推送模式跳过 pull 用的全库预扫描，加快开始推送'
    ],
    en: [
      'Batch push shows file index progress and per-file ✓/✗ log lines',
      'Per-file sync timeout including frontmatter write to avoid stuck uploading',
      'Push-only sync skips pull prep scan over entire vault'
    ]
  },
  {
    version: '1.5.33',
    date: '2026-06-16 21:00',
    zh: [
      '修复重载插件后侧栏永久「库索引加载中」（metadata 就绪检测改用 resolved + 探测 + 8s 兜底）'
    ],
    en: [
      'Fix panel stuck on vault indexing after plugin reload (metadata gate uses resolved + probe + 8s fallback)'
    ]
  },
  {
    version: '1.5.32',
    date: '2026-06-16 20:00',
    zh: [
      '修复全库同步时统计缓存无法读写（folderKey 为空）',
      '同步进行中状态行显示「正在同步」，不再与「库索引加载中」冲突',
      '打开侧栏时若正在上传，优先显示上次统计与进度'
    ],
    en: [
      'Fix stats cache read/write for whole-vault sync (empty folderKey)',
      'Status line shows Syncing during upload instead of vault indexing',
      'Reopening panel during sync keeps last stats and progress'
    ]
  },
  {
    version: '1.5.31',
    date: '2026-06-16 19:00',
    zh: [
      '修复 zip 解压后无 ima-sync 文件夹导致安装失败',
      '尽早注册侧栏视图，设置损坏时不再显示「插件不再活动」'
    ],
    en: [
      'Fix zip layout: includes ima-sync/ folder for correct install',
      'Register panel view earlier; corrupt settings no longer orphan tabs'
    ]
  },
  {
    version: '1.5.30',
    date: '2026-06-16 18:00',
    zh: [
      '修复重载插件后库就绪检测可能不触发的问题',
      '插件加载失败时在 Obsidian 内弹出错误提示'
    ],
    en: [
      'Fix vault-ready gate after plugin reload when layout is already ready',
      'Show in-app notice when plugin onload fails'
    ]
  },
  {
    version: '1.5.29',
    date: '2026-06-16 16:00',
    zh: [
      'Obsidian 库索引完成后再执行统计扫描与连接检测',
      '启动侧栏默认显示上次持久化统计，索引期间显示「库索引加载中」'
    ],
    en: [
      'Defer stats scan and health check until Obsidian vault indexing finishes',
      'Panel shows last persisted stats on startup; vault loading hint while indexing'
    ]
  },
  {
    version: '1.5.28',
    date: '2026-06-16 14:00',
    zh: [
      '优化冷启动打开侧栏卡顿：先显示按钮与上次统计，连接检测与统计后台并行',
      '同步统计持久化到本机，重启 Obsidian 后仍先显示上次结果'
    ],
    en: [
      'Faster panel open on cold start: actions + last stats first; health & stats run in parallel',
      'Persist sync stats locally so last counts show right after Obsidian restart'
    ]
  },
  {
    version: '1.5.27',
    date: '2026-06-16 01:30',
    zh: [
      '修复官网未启用 HTTPS 时关于页联网图片无法显示（自动尝试 HTTP）'
    ],
    en: [
      'Fix about-page remote image when the site has no HTTPS yet (fallback to HTTP)'
    ]
  },
  {
    version: '1.5.26',
    date: '2026-06-14 12:00',
    zh: [
      '修复关于页联网图片在部分 Obsidian 版本下无法显示'
    ],
    en: [
      'Fix about-page remote image not showing on some Obsidian versions'
    ]
  },
  {
    version: '1.5.18',
    date: '2026-06-09 14:30',
    zh: [
      '优化侧栏卡顿：保存设置不再清空状态区、不再每次重算统计',
      '统计优先显示缓存，大库（>5000 篇）延长缓存时间',
      'API 地址/密钥输入防抖，减少连接探测频率',
      '修复侧栏自动同步间隔修改时误触发整页刷新'
    ],
    en: [
      'Reduce panel lag: saving settings no longer clears status or recomputes stats',
      'Show cached stats first; longer cache TTL for large vaults (>5000 notes)',
      'Debounce API URL/key input to reduce connection checks',
      'Fix auto-sync interval change triggering full panel rebuild'
    ]
  },
  {
    version: '1.5.17',
    date: '2026-06-09 02:23',
    zh: [
      '同步统计卡片可点击查看笔记列表',
      '侧栏统计区提示：本地记录历史信息，不外传',
      '更新历史时间精确到小时分钟',
      '修复切换中英文时侧栏卡顿（仅更新文案，不重算统计）'
    ],
    en: [
      'Click sync stat cards to view note lists',
      'Sidebar privacy note: local history only, not shared externally',
      'Changelog timestamps include hour and minute',
      'Fix panel lag when switching UI language'
    ]
  },
  {
    version: '1.5.16',
    date: '2026-06-08 09:31',
    zh: ['文件夹选择改为树形：默认只显示一级，点击箭头展开子目录'],
    en: ['Folder picker tree: top level only by default, expand with chevron']
  },
  {
    version: '1.5.15',
    date: '2026-06-08 09:16',
    zh: ['侧栏作者旁增加「关注公众号获取最新版本」'],
    en: ['Author line: follow WeChat for latest version hint']
  },
  {
    version: '1.5.14',
    date: '2026-06-08 09:01',
    zh: [
      '修复设置里添加知识库后侧栏仍显示「未选择」',
      '有知识库列表时自动选中首个；手动添加时默认激活'
    ],
    en: [
      'Fix sidebar still showing no KB after adding one in settings',
      'Auto-select first KB; newly added KB becomes active'
    ]
  },
  {
    version: '1.5.13',
    date: '2026-06-08 08:46',
    zh: [
      '修复获取知识库列表为空：解析 IMA 返回的 info_list / kb_name',
      '合并 get_addable_knowledge_base_list 可推送目标库'
    ],
    en: [
      'Fix empty KB list: parse IMA info_list and kb_name fields',
      'Merge get_addable_knowledge_base_list for push targets'
    ]
  },
  {
    version: '1.5.12',
    date: '2026-06-08 08:31',
    zh: [
      '修复反馈发送 Failed to fetch：上报改用 Obsidian requestUrl',
      '反馈文字（最多 500 字）随 ima.feedback 一并上报'
    ],
    en: [
      'Fix feedback Failed to fetch: telemetry uses Obsidian requestUrl',
      'Include feedback text (up to 500 chars) in ima.feedback payload'
    ]
  },
  {
    version: '1.5.11',
    date: '2026-06-08 08:16',
    zh: [
      '修复获取知识库列表：IMA 要求 limit 在 1–20 之间（此前传 30 会报错）'
    ],
    en: [
      'Fix KB list fetch: IMA limit must be 1–20 (was sending 30)'
    ]
  },
  {
    version: '1.5.10',
    date: '2026-06-08 08:01',
    zh: [
      '设置页「从 IMA 获取知识库列表」旁增加刷新按钮'
    ],
    en: [
      'Refresh button next to Fetch KB list from IMA in settings'
    ]
  },
  {
    version: '1.5.9',
    date: '2026-06-08 07:46',
    zh: [
      '修复设置页在 API 密钥后截断：帮助 ? 改为行末 extraButton',
      '默认定时同步关闭（0）；侧栏可直接改间隔',
      '反馈按钮改为独立按钮，避免点不动'
    ],
    en: [
      'Fix settings page truncating after API Key; tips use extraButton',
      'Default scheduled sync off (0); edit interval in sidebar',
      'Feedback button as standalone control for reliable clicks'
    ]
  },
  {
    version: '1.5.8',
    date: '2026-06-08 07:31',
    zh: [
      '设置页：简介/更新历史移至底部，首屏直接显示连接与同步选项',
      '设置页更新历史默认只显示最近 3 个版本'
    ],
    en: [
      'Settings: about/changelog moved to footer; connection & sync visible first',
      'Settings changelog shows latest 3 versions only'
    ]
  },
  {
    version: '1.5.7',
    date: '2026-06-08 07:16',
    zh: [
      '侧栏操作区新增「反馈与帮助改进」按钮（本机摘要、复制诊断、可选匿名统计）',
      '侧栏 UI 对齐参考稿：五列统计、青蓝主按钮、工具栏刷新/帮助'
    ],
    en: [
      'Feedback button in panel: local summary, copy diagnostics, optional anonymous stats',
      'Panel UI polish: 5-column stats, teal primary button, toolbar refresh/help'
    ]
  },
  {
    version: '1.5.6',
    date: '2026-06-08 07:01',
    zh: [
      '侧栏五列同步统计单行展示',
      '标题栏刷新与帮助按钮成组'
    ],
    en: [
      'Five-column sync stats in one row',
      'Grouped refresh and help buttons in header'
    ]
  },
  {
    version: '1.5.5',
    date: '2026-06-08 06:46',
    zh: [
      '修复侧栏 ? 提示被拉成横条导致操作区布局错乱',
      '恢复侧栏纵向滚动；日志区移至底部并压缩空态高度'
    ],
    en: [
      'Fix tip buttons stretched to bars breaking action layout',
      'Restore panel scroll; log moved to bottom with smaller empty state'
    ]
  },
  {
    version: '1.5.4',
    date: '2026-06-08 06:31',
    zh: [
      '实验功能（拉取/全部同步/设置开关）默认不在界面展示，底层代码保留',
      '知识库下拉恢复常规展示与说明'
    ],
    en: [
      'Experimental pull UI hidden by default; engine code kept',
      'KB dropdown back to normal labels & tips'
    ]
  },
  {
    version: '1.5.3',
    date: '2026-06-08 06:16',
    zh: [
      '侧栏标题旁增加刷新按钮：重测连接、更新统计与当前笔记',
      '同步进行中禁用；日志区保留不清空'
    ],
    en: [
      'Panel refresh button: re-check connection, stats & current note',
      'Disabled while syncing; log preserved'
    ]
  },
  {
    version: '1.5.2',
    date: '2026-06-08 06:01',
    zh: [
      '侧栏与设置页易混淆功能旁增加可点击 ? 提示',
      '用用户视角说明统计数字、推送按钮、限流参数等'
    ],
    en: [
      'Clickable ? tips beside confusing panel & settings items',
      'User-friendly help for stats, push actions, rate-limit options'
    ]
  },
  {
    version: '1.5.1',
    date: '2026-06-08 05:46',
    zh: [
      '侧栏统计/状态/进度改为就地更新，减少 empty 重绘导致的界面闪烁',
      '同步中跳过统计重算；断线重连不再触发全量刷新',
      '大库统计缓存延长至 30s'
    ],
    en: [
      'In-place panel updates to reduce flicker from full re-renders',
      'Skip stats recompute while syncing; lighter reconnect UI',
      'Stats cache TTL extended to 30s for large vaults'
    ]
  },
  {
    version: '1.5.0',
    date: '2026-06-08 05:31',
    zh: [
      '按 IMA 官方限流建议：单请求间隔 ≥200ms（默认 500ms）',
      '批量推送每 80 篇休息 30 秒，可配置分批大小与批间暂停',
      '遇 429/限频自动退避重试（默认 60s→120s→300s）',
      '侧栏显示今日 API 请求本地计数'
    ],
    en: [
      'IMA rate-limit aware pacing: ≥200ms gap (default 500ms)',
      'Batch pause every 80 notes / 30s (configurable)',
      '429 backoff retry 60s→120s→300s',
      'Sidebar shows local daily API request count'
    ]
  },
  {
    version: '1.4.0',
    date: '2026-06-08 05:16',
    zh: [
      '腾讯 IMA OpenAPI 推送；多知识库切换；同步当前笔记 / 指定文件夹',
      '实验拉取默认关闭；修复 note_id 解析；简介与更新历史',
      '同步进度防卡顿；超量/限频友好提示；断网重试与自动重连',
      '修复侧栏同步按钮不显示'
    ],
    en: [
      'Tencent IMA push; multi-KB; sync current note / folder',
      'Experimental pull off by default; note_id fix; changelog in About',
      'Upload progress; quota/rate hints; network retry & auto-reconnect',
      'Fix sync buttons missing on panel open'
    ]
  },
  {
    version: '1.2.3',
    date: '2026-06-08 05:01',
    zh: ['作者简介增加公众号「临忆录」'],
    en: ['Author line includes WeChat account 临忆录']
  },
  {
    version: '1.2.2',
    date: '2026-06-08 04:46',
    zh: ['Client ID 移至连接区，紧挨 API Key'],
    en: ['Client ID moved to Connection, next to API Key']
  },
  {
    version: '1.2.1',
    date: '2026-06-08 04:31',
    zh: ['拉取 / 全部同步 / 拉取新文档标注为实验功能'],
    en: ['Pull / sync-all / pull-new marked experimental']
  },
  {
    version: '1.2.0',
    date: '2026-06-08 04:16',
    zh: [
      '批量同步暂停 / 停止',
      '暂停自动同步（保留间隔、暂不后台推送）',
      '弱化「双向同步」表述，主推推送到 IMA'
    ],
    en: [
      'Pause / stop during batch sync',
      'Pause auto-sync while keeping interval',
      'De-emphasize bidirectional sync; push-first wording'
    ]
  },
  {
    version: '1.1.4',
    date: '2026-06-08 04:01',
    zh: ['esbuild 单文件打包，修复 lib/ 子目录加载失败'],
    en: ['esbuild single-file bundle; fix lib/ load failures']
  },
  {
    version: '1.1.3',
    date: '2026-06-08 03:46',
    zh: [
      '修复已配置仍 Mock、首推附件丢失、保存误触发',
      'API Key 密码遮罩；连接状态 30s 缓存',
      '简介增加邮箱链接'
    ],
    en: [
      'Fix mock when configured, first-push attachments, save trigger',
      'API Key password mask; 30s health cache',
      'Email link in About'
    ]
  },
  {
    version: '1.1.2',
    date: '2026-06-08 03:31',
    zh: ['更新简介文案'],
    en: ['About description wording update']
  },
  {
    version: '1.1.1',
    date: '2026-06-08 03:16',
    zh: ['设置页与侧栏作者简介块'],
    en: ['About block in settings & sidebar']
  },
  {
    version: '1.1.0',
    date: '2026-06-08 03:01',
    zh: [
      '中英文界面（自动 / 中文 / English）',
      '简约三步配置；同步目录芯片标签'
    ],
    en: [
      'Bilingual UI (auto / zh / en)',
      'Compact 3-step settings; folder chip tags'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-06-08 02:46',
    zh: [
      '首发：推送 / 拉取、增量 hash、附件上传',
      '冲突处理、自动定时、配置面板'
    ],
    en: [
      'Initial: push / pull, incremental hash, attachments',
      'Conflict handling, auto timer, settings panel'
    ]
  }
]

/**
 * @param {'zh'|'en'} lang
 * @returns {ChangelogEntry[]}
 */
function getChangelog (lang) {
  return CHANGELOG.map(entry => ({
    version: entry.version,
    date: entry.date,
    items: entry[lang] || entry.en
  }))
}

/**
 * @param {HTMLElement} containerEl
 * @param {{ language?: string }} settings
 * @param {string} [currentVersion]
 */
/**
 * @param {HTMLElement} containerEl
 * @param {{ language?: string }} settings
 * @param {string} [currentVersion]
 * @param {{ limit?: number }} [opts] limit=0 表示全部
 */
function renderChangelog (containerEl, settings, currentVersion = PLUGIN_VERSION, opts = {}) {
  const { resolveLang, t } = require('./i18n')
  const lang = resolveLang(settings)
  const limit = Number(opts.limit) || 0
  const entries = getChangelog(lang)
  const shown = limit > 0 ? entries.slice(0, limit) : entries
  const block = containerEl.createDiv({ cls: 'ima-changelog' })
  block.createEl('h4', { cls: 'ima-about-title ima-changelog-head', text: t(settings, 'sectionChangelog') })

  const list = block.createEl('ul', { cls: 'ima-changelog-list' })
  for (const entry of shown) {
    const li = list.createEl('li', {
      cls: `ima-changelog-item${entry.version === currentVersion ? ' is-current' : ''}`
    })
    const head = li.createDiv({ cls: 'ima-changelog-ver' })
    head.setText(`v${entry.version}`)
    if (entry.date) {
      head.createSpan({ cls: 'ima-changelog-date', text: ` · ${entry.date}` })
    }
    if (entry.version === currentVersion) {
      head.createSpan({ cls: 'ima-changelog-current', text: ` · ${t(settings, 'changelogCurrent')}` })
    }
    const ul = li.createEl('ul', { cls: 'ima-changelog-ul' })
    for (const line of entry.items) {
      ul.createEl('li', { text: line })
    }
  }
}

module.exports = { PLUGIN_VERSION, CHANGELOG, CHANGELOG_FORBIDDEN, getChangelog, renderChangelog }
