#!/usr/bin/env node
/**
 * 安装 ima-sync 到 Obsidian vault（单文件 bundle）
 *
 * npm run install -- --vault D:/projects/obsidian
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { getPaths } from './_paths.mjs'

const PLUGIN_ID = 'ima-sync'

function parseArgs (argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--vault' && argv[i + 1]) {
      out.vault = argv[++i]
      continue
    }
    if (argv[i].startsWith('--vault=')) {
      out.vault = argv[i].slice(8)
    }
  }
  return out
}

function bundle (pluginRoot) {
  const r = spawnSync('node', [path.join(pluginRoot, 'scripts/bundle.mjs')], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, IMA_SYNC_ROOT: pluginRoot }
  })
  return r.status === 0
}

const { pluginRoot, distDir } = getPaths()
const a = parseArgs(process.argv)
const vault = path.resolve(a.vault || process.env.OBSIDIAN_VAULT || '')

if (!vault || !fs.existsSync(vault)) {
  console.error('用法: npm run install -- --vault <Obsidian库路径>')
  console.error('  或设置环境变量 OBSIDIAN_VAULT')
  process.exit(1)
}

console.log('[ima-sync:install] 正在打包插件…')
if (!bundle(pluginRoot)) process.exit(1)

const obsidianDir = path.join(vault, '.obsidian')
const destDir = path.join(obsidianDir, 'plugins', PLUGIN_ID)

/** 保留用户设置，避免重装时丢掉 data.json */
const preserveNames = new Set(['data.json'])
const preserved = new Map()
if (fs.existsSync(destDir)) {
  for (const name of preserveNames) {
    const p = path.join(destDir, name)
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      preserved.set(name, fs.readFileSync(p))
    }
  }
  fs.rmSync(destDir, { recursive: true, force: true })
}
fs.mkdirSync(destDir, { recursive: true })

const installFiles = ['main.js', 'manifest.json', 'styles.css', 'LICENSE']
for (const name of installFiles) {
  const src = path.join(distDir, name)
  if (!fs.existsSync(src)) {
    console.error(`缺少打包产物：${src}`)
    process.exit(1)
  }
  fs.copyFileSync(src, path.join(destDir, name))
}

for (const [name, buf] of preserved) {
  fs.writeFileSync(path.join(destDir, name), buf)
  console.log(`[ima-sync:install] 已保留 ${name}`)
}

const readme = path.join(distDir, 'README.md')
if (fs.existsSync(readme)) {
  fs.copyFileSync(readme, path.join(destDir, 'README.md'))
}

const assetsSrc = path.join(distDir, 'assets')
const assetsDest = path.join(destDir, 'assets')
if (fs.existsSync(assetsSrc)) {
  fs.mkdirSync(assetsDest, { recursive: true })
  for (const name of fs.readdirSync(assetsSrc)) {
    const src = path.join(assetsSrc, name)
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(assetsDest, name))
    }
  }
}

const communityPath = path.join(obsidianDir, 'community-plugins.json')
let enabled = []
if (fs.existsSync(communityPath)) {
  try {
    enabled = JSON.parse(fs.readFileSync(communityPath, 'utf8'))
  } catch {
    enabled = []
  }
}
if (!enabled.includes(PLUGIN_ID)) {
  enabled.push(PLUGIN_ID)
  fs.writeFileSync(communityPath, JSON.stringify(enabled, null, 2), 'utf8')
}

console.log('[ima-sync:install] 已安装（单文件 bundle）')
console.log(`  plugin → ${destDir}`)
console.log(`  root   → ${pluginRoot}`)

const pluginsRoot = path.join(obsidianDir, 'plugins')
if (fs.existsSync(pluginsRoot)) {
  const dups = fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== PLUGIN_ID)
    .filter((e) => {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(pluginsRoot, e.name, 'manifest.json'), 'utf8'))
        return m?.id === PLUGIN_ID
      } catch {
        return false
      }
    })
    .map((e) => e.name)
  if (dups.length) {
    console.warn('[ima-sync:install] 警告：发现同 id 的重复插件目录，会导致无法启用：')
    for (const name of dups) console.warn(`  - plugins/${name}（文件夹名必须是 ima-sync）`)
    console.warn('  请移出或删除上述目录后 Ctrl+R 重载')
  }
}

console.log('')
console.log('下一步: Obsidian → 设置 → 第三方插件 → 关闭「受限模式」→ 启用 IMA Sync → Ctrl+R 重载')
