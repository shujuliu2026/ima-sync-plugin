#!/usr/bin/env node
/**
 * ima-sync · esbuild 单文件打包
 *
 * 独立 repo: npm run bundle
 * wikimap:   npm run chronicle:bundle-ima-sync
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { getPaths, resolveEsbuildCwd } from './_paths.mjs'

const { pluginRoot, distDir } = getPaths()
const ENTRY = path.join(pluginRoot, 'main.js')
const BUNDLE_OUT = path.join(distDir, 'main.js')

fs.mkdirSync(distDir, { recursive: true })

const syncVersions = spawnSync('node', [path.join(pluginRoot, 'scripts/sync-versions.mjs')], {
  cwd: pluginRoot,
  env: { ...process.env, IMA_SYNC_ROOT: pluginRoot },
  shell: true,
  stdio: 'inherit'
})
if (syncVersions.status !== 0) process.exit(1)

const sponsorPng = path.join(pluginRoot, 'assets', 'sponsor-alipay.png')
const md5Path = path.join(pluginRoot, 'assets', 'sponsor-alipay.md5')
if (fs.existsSync(sponsorPng)) {
  const md5 = crypto.createHash('md5').update(fs.readFileSync(sponsorPng)).digest('hex')
  fs.writeFileSync(md5Path, `${md5}\n`, 'utf8')
  console.log(`[ima-sync:bundle] sponsor-alipay.md5=${md5}`)
} else {
  console.warn('[ima-sync:bundle] 未找到 assets/sponsor-alipay.png，跳过 MD5 文件生成')
}

const esbuildCwd = resolveEsbuildCwd(pluginRoot)
const r = spawnSync(
  'npx',
  [
    'esbuild',
    ENTRY,
    '--bundle',
    '--platform=node',
    '--external:obsidian',
    '--target=es2020',
    '--define:__IMA_SYNC_PRODUCTION__=true',
    `--outfile=${BUNDLE_OUT}`
  ],
  { cwd: esbuildCwd, shell: true, stdio: 'inherit' }
)

if (r.status !== 0) {
  console.error('[ima-sync:bundle] esbuild 失败')
  process.exit(1)
}

for (const name of ['manifest.json', 'styles.css', 'README.md', 'README.en.md', 'README.dev.md', 'LICENSE', 'product-manifest.json', 'versions.json']) {
  const src = path.join(pluginRoot, name)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(distDir, name))
  }
}

function copyDir (srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) copyDir(src, dest)
    else fs.copyFileSync(src, dest)
  }
}

copyDir(path.join(pluginRoot, 'assets'), path.join(distDir, 'assets'))

console.log('[ima-sync:bundle] 完成')
console.log(`  → ${distDir}`)
console.log('  安装：npm run install-plugin -- --vault <Obsidian库路径>')
